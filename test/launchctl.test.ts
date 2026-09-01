import { describe, expect, test } from "bun:test";
import { parseList } from "../src/core/launchctl";

const fixture = await Bun.file(
  new URL("./fixtures/launchctl-list.txt", import.meta.url),
).text();

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
