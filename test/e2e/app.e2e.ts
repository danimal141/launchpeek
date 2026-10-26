// 実物のアプリを PTY で起動し、キー入力に対する画面と launchctl への操作を確かめる。
// launchctl は fake-launchctl.ts に差し替えるので、launchd 側の実際の挙動は検証しない
import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type AppHandle, plistXml, startApp } from "./harness";

const TICK = "com.example.tick";
const TIMEOUT_MS = 20000;

let app: AppHandle | undefined;

afterEach(async () => {
  await app?.stop();
  app = undefined;
});

// macOS では /Library/LaunchAgents の実ジョブも一覧に混ざるため、フィルタで対象だけを選ぶ
// 入力モードの切り替えが描画される前に次のキーを送ると取りこぼすので、1 段ずつ表示を待つ
async function selectOnly(handle: AppHandle, text: string) {
  handle.press("/");
  await handle.waitFor(/Enter:確定/);
  handle.press(text);
  await handle.waitFor(new RegExp(`/${text}`));
  handle.press("\r");
  await handle.waitForFrame((frame) => frame.includes("Enter:detail"));
}

describe("launchpeek e2e", () => {
  test(
    "LaunchAgents の plist が一覧に表示される",
    async () => {
      app = await startApp(
        [{ label: TICK, startInterval: 60 }, { label: "com.example.idle" }],
        { loaded: { [TICK]: { runs: 0 } }, disabled: [] },
      );
      await app.waitFor(/scheduled\s+com\.example\.tick/);
      await app.waitFor(/disabled\s+com\.example\.idle/);
    },
    TIMEOUT_MS,
  );

  test(
    "r で kickstart すると pid と run count が更新される",
    async () => {
      app = await startApp([{ label: TICK, startInterval: 60 }], {
        loaded: { [TICK]: { runs: 0 } },
        disabled: [],
      });
      await app.waitFor(/com\.example\.tick/);
      await selectOnly(app, "tick");
      app.press("\r");
      await app.waitFor(/run count\s+0/);

      app.press("r");
      await app.waitFor(/kickstart com\.example\.tick: ok/);
      await app.waitFor(/run count\s+1/);
      await app.waitFor(/pid\s+40001/);
    },
    TIMEOUT_MS,
  );

  test(
    "d / e で disabled と scheduled が切り替わる",
    async () => {
      app = await startApp([{ label: TICK, startInterval: 60 }], {
        loaded: { [TICK]: { runs: 0 } },
        disabled: [],
      });
      await app.waitFor(/scheduled\s+com\.example\.tick/);
      await selectOnly(app, "tick");

      app.press("d");
      await app.waitFor(/disabled\s+com\.example\.tick/);
      expect((await app.state()).disabled).toContain(TICK);

      app.press("e");
      await app.waitFor(/scheduled\s+com\.example\.tick/);
      expect((await app.state()).disabled).not.toContain(TICK);
    },
    TIMEOUT_MS,
  );

  test(
    "l でログを開き、表示中の追記が反映される",
    async () => {
      const logPath = join(
        process.env.TMPDIR ?? "/tmp",
        `launchpeek-e2e-${process.pid}.log`,
      );
      await writeFile(logPath, "first line\n");
      try {
        app = await startApp(
          [{ label: TICK, startInterval: 60, stdoutPath: logPath }],
          { loaded: { [TICK]: { runs: 0 } }, disabled: [] },
        );
        await app.waitFor(/com\.example\.tick/);
        await selectOnly(app, "tick");
        app.press("l");
        await app.waitFor(/first line/);

        await appendFile(logPath, "appended line\n");
        // logs モードは 1 秒間隔で差分を読む (spec)
        await app.waitFor(/appended line/, 3000);
      } finally {
        await rm(logPath, { force: true });
      }
    },
    TIMEOUT_MS,
  );

  test(
    "plist の追加と削除が一覧に反映され、選択は label で追従する",
    async () => {
      app = await startApp([{ label: TICK, startInterval: 60 }], {
        loaded: { [TICK]: { runs: 0 } },
        disabled: [],
      });
      await app.waitFor(/com\.example\.tick/);
      await selectOnly(app, "example");

      // 選択中の tick より前に並ぶ label を足しても、選択は tick のまま
      const added = "com.example.aaa";
      const addedPath = join(app.agentsDir, `${added}.plist`);
      await writeFile(addedPath, plistXml({ label: added }));
      await app.waitForFrame((frame) => frame.includes(added));
      app.press("\r");
      // detail の枠の先頭行は選択中ジョブの label
      const detail = await app.waitFor(/│ (com\.example\.[a-z]+)\s+│/);
      expect(detail[1]).toBe(TICK);
      app.press("q");

      await rm(addedPath);
      await app.waitForFrame(
        (frame) => frame.includes(TICK) && !frame.includes(added),
      );
    },
    TIMEOUT_MS,
  );

  test(
    "u は確認を挟み、n で取り消し、y で bootout する。U で bootstrap し直せる",
    async () => {
      app = await startApp([{ label: TICK, startInterval: 60 }], {
        loaded: { [TICK]: { runs: 0 } },
        disabled: [],
      });
      await app.waitFor(/scheduled\s+com\.example\.tick/);
      await selectOnly(app, "tick");

      app.press("u");
      await app.waitFor(/bootout com\.example\.tick\? \(y\/n\)/);
      app.press("n");
      await Bun.sleep(300);
      expect((await app.state()).loaded[TICK]).toBeDefined();

      app.press("u");
      await app.waitFor(/\(y\/n\)/);
      app.press("y");
      await app.waitFor(/bootout com\.example\.tick: ok/);
      expect((await app.state()).loaded[TICK]).toBeUndefined();

      app.press("U");
      await app.waitFor(/bootstrap com\.example\.tick: ok/);
      expect((await app.state()).loaded[TICK]).toBeDefined();
    },
    TIMEOUT_MS,
  );
});
