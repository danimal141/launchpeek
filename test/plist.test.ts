import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { loadDefinition, parseJobDefinition } from "../src/core/plist";

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe("loadDefinition", () => {
  test("XML plist を読める (Program / StartInterval / KeepAlive bool)", async () => {
    const { definition, warning } = await loadDefinition(
      fixture("com.example.interval.plist"),
      "user",
    );
    expect(warning).toBeUndefined();
    expect(definition).toMatchObject({
      label: "com.example.interval",
      program: "/usr/local/bin/tick",
      startInterval: 60,
      keepAlive: true,
      runAtLoad: true,
      stdoutPath: "/tmp/tick.out.log",
      stderrPath: "/tmp/tick.err.log",
      workingDirectory: "/tmp",
      domain: "user",
    });
  });

  test("StartCalendarInterval の dict を配列に正規化する", async () => {
    const { definition } = await loadDefinition(
      fixture("com.example.calendar.plist"),
      "user",
    );
    expect(definition?.startCalendarInterval).toEqual([
      { minute: 30, hour: 9, day: undefined, weekday: undefined, month: undefined },
    ]);
    // Program が無い場合は ProgramArguments の先頭が program になる
    expect(definition?.program).toBe("/bin/bash");
    expect(definition?.arguments).toEqual(["/bin/bash", "-c", "echo hello"]);
  });

  test("StartCalendarInterval の配列と KeepAlive dict を受け付ける", async () => {
    const { definition } = await loadDefinition(
      fixture("com.example.calendar-array.plist"),
      "user",
    );
    expect(definition?.startCalendarInterval).toHaveLength(2);
    expect(definition?.startCalendarInterval?.[1]).toMatchObject({
      weekday: 5,
      hour: 18,
      minute: 15,
    });
    // KeepAlive が dict の場合は true とみなす (SPEC)
    expect(definition?.keepAlive).toBe(true);
  });

  test("バイナリ plist を読める", async () => {
    const { definition, warning } = await loadDefinition(
      fixture("binary.plist"),
      "user",
    );
    expect(warning).toBeUndefined();
    expect(definition?.label).toBe("com.example.interval");
    expect(definition?.startInterval).toBe(60);
  });

  test("Label の無い plist は無視する", async () => {
    const { definition, warning } = await loadDefinition(
      fixture("no-label.plist"),
      "user",
    );
    expect(definition).toBeUndefined();
    expect(warning).toBeUndefined();
  });

  test("読めないファイルは warning になる", async () => {
    const { definition, warning } = await loadDefinition(
      fixture("broken.plist"),
      "user",
    );
    expect(definition).toBeUndefined();
    expect(warning).toContain("broken.plist");
  });
});

describe("parseJobDefinition", () => {
  test("dict 以外は無視する", () => {
    expect(parseJobDefinition("string", "/x.plist", "user")).toBeUndefined();
    expect(parseJobDefinition(null, "/x.plist", "user")).toBeUndefined();
    expect(parseJobDefinition([1, 2], "/x.plist", "user")).toBeUndefined();
  });

  test("型が合わないフィールドは undefined に落とす", () => {
    const def = parseJobDefinition(
      { Label: "a", StartInterval: "60", RunAtLoad: "yes", KeepAlive: false },
      "/x.plist",
      "system",
    );
    expect(def).toMatchObject({
      label: "a",
      startInterval: undefined,
      runAtLoad: false,
      keepAlive: false,
      domain: "system",
    });
  });
});
