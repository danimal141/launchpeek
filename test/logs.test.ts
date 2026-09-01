import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatLogLines,
  logSourcesOf,
  refreshTail,
  tailFile,
  TAIL_LINES,
} from "../src/core/logs";
import type { Job } from "../src/types";

const dir = await mkdtemp(join(tmpdir(), "launchpeek-logs-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("tailFile", () => {
  test("末尾 N 行だけを読む", async () => {
    const path = join(dir, "long.log");
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`);
    await writeFile(path, `${lines.join("\n")}\n`);
    const tail = await tailFile("out", path);
    expect(tail.lines).toHaveLength(TAIL_LINES);
    expect(tail.lines[0]).toBe("line 300");
    expect(tail.lines[TAIL_LINES - 1]).toBe("line 499");
    expect(tail.error).toBeUndefined();
  });

  test("存在しないファイルは error になる", async () => {
    const tail = await tailFile("err", join(dir, "missing.log"));
    expect(tail.error).toBeDefined();
    expect(tail.lines).toEqual([]);
  });
});

describe("refreshTail", () => {
  test("追記分だけを差分で読む", async () => {
    const path = join(dir, "grow.log");
    await writeFile(path, "first\n");
    const tail = await tailFile("out", path);
    expect(tail.lines).toEqual(["first"]);

    const unchanged = await refreshTail(tail);
    expect(unchanged.changed).toBe(false);

    await appendFile(path, "second\nthird\n");
    const grown = await refreshTail(tail);
    expect(grown.changed).toBe(true);
    expect(grown.tail.lines).toEqual(["first", "second", "third"]);
  });

  test("サイズが縮んだら (ローテーション) 読み直す", async () => {
    const path = join(dir, "rotate.log");
    await writeFile(path, "old content that is long\n");
    const tail = await tailFile("out", path);
    await writeFile(path, "new\n");
    const result = await refreshTail(tail);
    expect(result.changed).toBe(true);
    expect(result.tail.lines).toEqual(["new"]);
  });

  test("消えたファイルは error に落ち、復活したら読み直す", async () => {
    const path = join(dir, "vanish.log");
    await writeFile(path, "hello\n");
    const tail = await tailFile("out", path);
    await rm(path);
    const gone = await refreshTail(tail);
    expect(gone.changed).toBe(true);
    expect(gone.tail.error).toBeDefined();

    await writeFile(path, "back\n");
    const revived = await refreshTail(gone.tail);
    expect(revived.tail.lines).toEqual(["back"]);
    expect(revived.tail.error).toBeUndefined();
  });
});

describe("formatLogLines / logSourcesOf", () => {
  const job = {
    stdoutPath: "/tmp/a.out",
    stderrPath: "/tmp/a.err",
  } as Job;

  test("out と err を混ぜずにファイルごとに連結する", () => {
    const lines = formatLogLines([
      { kind: "out", path: "/tmp/a.out", lines: ["o1", "o2"], size: 0 },
      { kind: "err", path: "/tmp/a.err", lines: ["e1"], size: 0 },
    ]);
    expect(lines).toEqual(["[out] o1", "[out] o2", "[err] e1"]);
  });

  test("読めないファイルはその旨を表示する", () => {
    const lines = formatLogLines([
      { kind: "out", path: "/tmp/x", lines: [], size: 0, error: "ENOENT" },
    ]);
    expect(lines[0]).toContain("cannot read /tmp/x");
  });

  test("stdout と stderr が同じパスなら 1 つにまとめる", () => {
    const same = { ...job, stderrPath: "/tmp/a.out" } as Job;
    expect(logSourcesOf(same)).toHaveLength(1);
    expect(logSourcesOf(job)).toHaveLength(2);
  });
});
