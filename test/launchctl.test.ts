import { describe, expect, test } from "bun:test";
import { parseList, parsePrint, parsePrintDisabled } from "../src/core/launchctl";

const readFixture = (name: string) =>
  Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).text();

const fixture = await readFixture("launchctl-list.txt");

describe("parseList", () => {
  const entries = parseList(fixture);

  test("ヘッダ行と解釈できない行を無視する", () => {
    expect(entries.map((e) => e.label)).not.toContain("Label");
    expect(entries).toHaveLength(8);
  });

  test("PID が - のジョブは pid undefined", () => {
    const entry = entries.find(
      (e) => e.label === "org.danimal141.weekly-summary-87",
    );
    expect(entry).toBeDefined();
    expect(entry?.pid).toBeUndefined();
    expect(entry?.lastExitCode).toBe(0);
  });

  test("PID が数値のジョブは running として pid を持つ", () => {
    const entry = entries.find(
      (e) => e.label === "com.apple.dataaccess.dataaccessd",
    );
    expect(entry?.pid).toBe(21380);
  });

  test("非 0 の Status を last exit code として読む", () => {
    const entry = entries.find((e) => e.label === "com.example.failing-job");
    expect(entry?.lastExitCode).toBe(78);
  });

  test("負の Status (シグナル) も読める", () => {
    const entry = entries.find(
      (e) => e.label === "com.example.killed-by-signal",
    );
    expect(entry?.lastExitCode).toBe(-9);
  });

  test("空文字列は空配列", () => {
    expect(parseList("")).toEqual([]);
  });
});

describe("parsePrint", () => {
  test("running なジョブの pid / state / runs を読む", async () => {
    const info = parsePrint(await readFixture("launchctl-print-running.txt"), 0);
    expect(info).toEqual({
      loaded: true,
      pid: 1477,
      state: "running",
      // (never exited) は undefined になる
      lastExitCode: undefined,
      runCount: 1,
    });
  });

  test("not running な state (スペース入り) も読める", async () => {
    const info = parsePrint(
      await readFixture("launchctl-print-not-running.txt"),
      0,
    );
    expect(info).toMatchObject({
      loaded: true,
      pid: undefined,
      state: "not running",
      runCount: 0,
    });
  });

  test("run count 表記と数値の last exit code を読む", async () => {
    const info = parsePrint(await readFixture("launchctl-print-failed.txt"), 0);
    expect(info).toMatchObject({ lastExitCode: 78, runCount: 5 });
  });

  test("終了コード非 0 は未ロード", () => {
    expect(parsePrint("Could not find service", 113)).toEqual({ loaded: false });
  });

  test("空出力でも落ちない", () => {
    expect(parsePrint("", 0)).toEqual({
      loaded: true,
      pid: undefined,
      state: undefined,
      lastExitCode: undefined,
      runCount: undefined,
    });
  });
});

describe("parsePrintDisabled", () => {
  test("disabled の label だけを集める", async () => {
    const disabled = parsePrintDisabled(
      await readFixture("launchctl-print-disabled.txt"),
    );
    expect([...disabled].sort()).toEqual([
      "com.apple.ManagedClientAgent.enrollagent",
      "com.apple.Siri.agent",
      "com.apple.rcd",
    ]);
    expect(disabled.has("com.docker.helper")).toBe(false);
  });
});
