import type { Job } from "../src/types";
import { afterAll, describe, expect, test } from "bun:test";
import {
  appendFile,
  mkdir,
  mkdtemp,
  rename,
  rm,
  stat,
  symlink,
  truncate,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  refreshTail,
  formatLogLines,
  logSourcesOf,
  tailFile,
  TAIL_LINES,
  type LogFileTail,
} from "../src/core/logs";


const dir = await mkdtemp(join(tmpdir(), "launchpeek-logs-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("tailFile", () => {
  test("末尾 N 行だけを読む", async () => {
    const path = join(dir, "long.log");
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`);
    await writeFile(path, `${lines.join("\n")}\n`);
    const result = await tailFile("out", path);
    expect(result.lines).toHaveLength(TAIL_LINES);
    expect(result.lines[0]).toBe("line 300");
    expect(result.lines[TAIL_LINES - 1]).toBe("line 499");
    expect(result.error).toBeUndefined();
    // 置き換え判定の起点になるので必ず入っていること
    expect(result.ino).toBeGreaterThan(0);
    expect(result.mtimeMs).toBeGreaterThan(0);
  });

  test("存在しないファイルは error になる", async () => {
    const result = await tailFile("err", join(dir, "missing.log"));
    expect(result.error).toBeDefined();
    expect(result.lines).toEqual([]);
  });

  test("読めないパス (ディレクトリ) でも落ちずに error になる", async () => {
    // 設定にディレクトリを書いてしまったケース。stat は通るが読み出しで失敗する
    const path = join(dir, "a-directory");
    await mkdir(path, { recursive: true });
    const result = await tailFile("out", path);
    expect(result.error).toBeDefined();
    expect(result.lines).toEqual([]);
    expect(result.path).toBe(path);
  });
});

describe("refreshTail", () => {
  test("追記分だけを差分で読む", async () => {
    const path = join(dir, "grow.log");
    await writeFile(path, "first\n");
    const prev = await tailFile("out", path);
    expect(prev.lines).toEqual(["first"]);

    const unchanged = await refreshTail(prev);
    expect(unchanged.changed).toBe(false);

    await appendFile(path, "second\nthird\n");
    const grown = await refreshTail(prev);
    expect(grown.changed).toBe(true);
    expect(grown.tail.lines).toEqual(["first", "second", "third"]);
  });

  test("サイズが縮んだら (ローテーション) 読み直す", async () => {
    const path = join(dir, "rotate.log");
    await writeFile(path, "old content that is long\n");
    const prev = await tailFile("out", path);
    await writeFile(path, "new\n");
    const result = await refreshTail(prev);
    expect(result.changed).toBe(true);
    expect(result.tail.lines).toEqual(["new"]);
  });

  test("truncate 後に書き直しても古い内容を出し続けない", async () => {
    const path = join(dir, "truncate.log");
    await writeFile(path, "old line 1\nold line 2\n");
    const prev = await tailFile("out", path);
    await truncate(path, 0);
    await appendFile(path, "fresh\n");
    const result = await refreshTail(prev);
    expect(result.changed).toBe(true);
    expect(result.tail.lines).toEqual(["fresh"]);
  });

  test("同じサイズで中身が入れ替わったら読み直す", async () => {
    const path = join(dir, "same-size.log");
    await writeFile(path, "aaaa\n");
    const prev = await tailFile("out", path);
    // 同じ長さで書き直す。writeFile は inode を保つので mtime だけが手掛かりになる
    await writeFile(path, "bbbb\n");
    // FS のタイムスタンプ粒度に依存させないため明示的に進める
    await utimes(path, new Date(), new Date(prev.mtimeMs + 5000));

    const info = await stat(path);
    expect(info.size).toBe(prev.size);
    expect(info.ino).toBe(prev.ino);

    const result = await refreshTail(prev);
    expect(result.changed).toBe(true);
    expect(result.tail.lines).toEqual(["bbbb"]);
  });

  test("size と mtime が同じでも inode が違えば読み直す", async () => {
    const path = join(dir, "same-stat.log");
    await writeFile(path, "aaaa\n");
    const prev = await tailFile("out", path);
    await rename(path, join(dir, "same-stat.log.1"));
    await writeFile(path, "bbbb\n");
    const info = await stat(path);
    // size と mtime を新ファイルに揃え、inode の違いだけが検知の根拠になる状態にする
    const sameStat: LogFileTail = {
      ...prev,
      size: info.size,
      mtimeMs: info.mtimeMs,
    };
    expect(info.ino).not.toBe(prev.ino);

    const result = await refreshTail(sameStat);
    expect(result.changed).toBe(true);
    expect(result.tail.lines).toEqual(["bbbb"]);
  });

  test("symlink の張り替えに追従する", async () => {
    const a = join(dir, "target-a.log");
    const b = join(dir, "target-b.log");
    const link = join(dir, "current.log");
    await writeFile(a, "from a\n");
    await writeFile(b, "from b\n");
    await symlink(a, link);
    const prev = await tailFile("out", link);
    expect(prev.lines).toEqual(["from a"]);

    await unlink(link);
    await symlink(b, link);
    const result = await refreshTail(prev);
    expect(result.changed).toBe(true);
    expect(result.tail.lines).toEqual(["from b"]);
  });

  test("mtime だけ動いて中身が同じなら changed にしない", async () => {
    // /dev/null のように size 0 のまま mtime が動くファイルで毎秒再描画しないこと
    const path = join(dir, "touch-only.log");
    await writeFile(path, "same\n");
    const prev = await tailFile("out", path);
    await utimes(path, new Date(), new Date(prev.mtimeMs + 5000));
    const result = await refreshTail(prev);
    expect(result.changed).toBe(false);
    // ino / mtime を更新しておかないと次回も同じ判定を繰り返す
    expect(result.tail.mtimeMs).not.toBe(prev.mtimeMs);
    expect(result.tail.lines).toEqual(["same"]);

    // 更新後の tail をそのまま渡しても再度読み直しにならない
    expect((await refreshTail(result.tail)).changed).toBe(false);
  });

  test("/dev/null は毎回 changed にならない", async () => {
    const prev = await tailFile("out", "/dev/null");
    expect(prev.error).toBeUndefined();
    await Bun.write("/dev/null", "mtime を動かす\n");
    expect((await refreshTail(prev)).changed).toBe(false);
  });

  test("読めないままのパスは繰り返し changed にしない", async () => {
    const path = join(dir, "still-a-directory");
    await mkdir(path, { recursive: true });
    const prev = await tailFile("out", path);
    expect(prev.error).toBeDefined();
    const result = await refreshTail(prev);
    expect(result.tail.error).toBeDefined();
    expect(result.changed).toBe(false);
  });

  test("消えたファイルは error に落ち、復活したら読み直す", async () => {
    const path = join(dir, "vanish.log");
    await writeFile(path, "hello\n");
    const prev = await tailFile("out", path);
    await rm(path);
    const gone = await refreshTail(prev);
    expect(gone.changed).toBe(true);
    expect(gone.tail.error).toBeDefined();

    await writeFile(path, "back\n");
    const revived = await refreshTail(gone.tail);
    expect(revived.tail.lines).toEqual(["back"]);
    expect(revived.tail.error).toBeUndefined();
    expect(revived.tail.ino).toBeGreaterThan(0);
    expect(revived.tail.mtimeMs).toBeGreaterThan(0);
  });
});

describe("formatLogLines / logSourcesOf", () => {
  const job = {
    stdoutPath: "/tmp/a.out",
    stderrPath: "/tmp/a.err",
  } as Job;

  test("out と err を混ぜずにファイルごとに連結する", () => {
    const lines = formatLogLines([
      { kind: "out", path: "/tmp/a.out", lines: ["o1", "o2"], size: 0, ino: 0, mtimeMs: 0 },
      { kind: "err", path: "/tmp/a.err", lines: ["e1"], size: 0, ino: 0, mtimeMs: 0 },
    ]);
    expect(lines).toEqual(["[out] o1", "[out] o2", "[err] e1"]);
  });

  test("読めないファイルはその旨を表示する", () => {
    const lines = formatLogLines([
      { kind: "out", path: "/tmp/x", lines: [], size: 0, ino: 0, mtimeMs: 0, error: "ENOENT" },
    ]);
    expect(lines[0]).toContain("cannot read /tmp/x");
  });

  test("stdout と stderr が同じパスなら 1 つにまとめる", () => {
    const same = { ...job, stderrPath: "/tmp/a.out" } as Job;
    expect(logSourcesOf(same)).toHaveLength(1);
    expect(logSourcesOf(job)).toHaveLength(2);
  });
});
