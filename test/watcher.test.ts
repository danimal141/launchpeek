import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchAgentDirs } from "../src/core/watcher";

const dir = await mkdtemp(join(tmpdir(), "launchpeek-watch-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

function waitFor(check: () => boolean, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (check() || Date.now() - start > timeoutMs) {
        clearInterval(timer);
        resolve(check());
      }
    }, 50);
  });
}

describe("watchAgentDirs", () => {
  test("plist の追加で onChange が呼ばれる (debounce 込み)", async () => {
    let calls = 0;
    const stop = watchAgentDirs(() => calls++, [dir]);
    try {
      await writeFile(join(dir, "com.example.a.plist"), "x");
      await writeFile(join(dir, "com.example.b.plist"), "y");
      expect(await waitFor(() => calls > 0)).toBe(true);
      // 連続イベントは debounce で 1 回にまとまる
      expect(calls).toBe(1);
    } finally {
      stop();
    }
  });

  test("plist 以外のファイルは無視する", async () => {
    let calls = 0;
    const stop = watchAgentDirs(() => calls++, [dir]);
    try {
      await writeFile(join(dir, "notes.txt"), "x");
      expect(await waitFor(() => calls > 0, 700)).toBe(false);
    } finally {
      stop();
    }
  });

  test("存在しないディレクトリでも落ちない", () => {
    const stop = watchAgentDirs(() => {}, ["/does/not/exist"]);
    stop();
  });
});
