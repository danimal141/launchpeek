import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FakeLaunchdState } from "./fake-launchctl";

const ROOT = join(import.meta.dir, "../..");

export interface PlistSpec {
  label: string;
  startInterval?: number;
  stdoutPath?: string;
}

export function plistXml(spec: PlistSpec): string {
  const entries = [
    `<key>Label</key><string>${spec.label}</string>`,
    "<key>Program</key><string>/bin/true</string>",
  ];
  if (spec.startInterval !== undefined) {
    entries.push(
      `<key>StartInterval</key><integer>${spec.startInterval}</integer>`,
    );
  }
  if (spec.stdoutPath !== undefined) {
    entries.push(
      `<key>StandardOutPath</key><string>${spec.stdoutPath}</string>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>${entries.join("")}</dict></plist>
`;
}

export interface AppHandle {
  home: string;
  agentsDir: string;
  press(keys: string): void;
  // 直前の press 以降に描画された画面から探す。古いフレームの一致で通らないようにするため
  waitFor(pattern: RegExp, timeoutMs?: number): Promise<RegExpMatchArray>;
  // 最新の一覧フレーム (最後の CATEGORY ヘッダ以降) が条件を満たすまで待つ。
  // 「表示されなくなった」ことは過去のフレームを含む waitFor では確かめられないため
  waitForFrame(
    predicate: (frame: string) => boolean,
    timeoutMs?: number,
  ): Promise<string>;
  state(): Promise<FakeLaunchdState>;
  stop(): Promise<void>;
}

export async function startApp(
  plists: PlistSpec[],
  launchd: FakeLaunchdState,
): Promise<AppHandle> {
  const home = await mkdtemp(join(tmpdir(), "launchpeek-e2e-"));
  const agentsDir = join(home, "Library/LaunchAgents");
  const binDir = join(home, "bin");
  const statePath = join(home, "launchd.json");
  await mkdir(agentsDir, { recursive: true });
  await mkdir(binDir);
  for (const spec of plists) {
    await writeFile(join(agentsDir, `${spec.label}.plist`), plistXml(spec));
  }
  await writeFile(statePath, JSON.stringify(launchd));
  const shim = join(binDir, "launchctl");
  await writeFile(
    shim,
    `#!/bin/sh\nexec "${process.execPath}" "${join(import.meta.dir, "fake-launchctl.ts")}" "$@"\n`,
  );
  await chmod(shim, 0o755);

  let output = "";
  let mark = 0;
  const decoder = new TextDecoder();
  const proc = Bun.spawn([process.execPath, join(ROOT, "src/index.tsx")], {
    cwd: ROOT,
    // Ink は CI 等の環境変数があると対話的な再描画をやめるため、必要なものだけ渡す
    env: {
      HOME: home,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      TERM: "xterm-256color",
      LANG: "en_US.UTF-8",
      FAKE_LAUNCHD_STATE: statePath,
    },
    terminal: {
      cols: 120,
      rows: 30,
      data(_term, chunk) {
        output += decoder.decode(chunk, { stream: true });
      },
    },
  });

  const handle: AppHandle = {
    home,
    agentsDir,
    press(keys) {
      mark = output.length;
      proc.terminal?.write(keys);
    },
    async waitFor(pattern, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const match = Bun.stripANSI(output.slice(mark)).match(pattern);
        if (match) return match;
        await Bun.sleep(50);
      }
      throw new Error(
        `timed out waiting for ${pattern}\n--- screen ---\n${Bun.stripANSI(output.slice(mark)).slice(-3000)}`,
      );
    },
    async waitForFrame(predicate, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      let frame = "";
      while (Date.now() < deadline) {
        const screen = Bun.stripANSI(output);
        frame = screen.slice(screen.lastIndexOf("CATEGORY"));
        if (predicate(frame)) return frame;
        await Bun.sleep(50);
      }
      throw new Error(`timed out waiting for frame\n--- frame ---\n${frame}`);
    },
    async state() {
      return (await Bun.file(statePath).json()) as FakeLaunchdState;
    },
    async stop() {
      proc.kill();
      await proc.exited;
      await rm(home, { recursive: true, force: true });
    },
  };
  return handle;
}
