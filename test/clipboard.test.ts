import { describe, expect, test } from "bun:test";
import { copyLabel } from "../src/core/clipboard";

describe("copyLabel", () => {
  test("label を pbcopy の標準入力へ渡す", async () => {
    const calls: Array<{ cmd: string[]; stdin?: string }> = [];
    const result = await copyLabel("com.example.demo", async (cmd, _, stdin) => {
      calls.push({ cmd, stdin });
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    expect(calls).toEqual([
      { cmd: ["pbcopy"], stdin: "com.example.demo" },
    ]);
    expect(result).toEqual({
      ok: true,
      message: "copied com.example.demo",
    });
  });

  test("失敗時は stderr の先頭行を返す", async () => {
    const result = await copyLabel("com.example.demo", async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "clipboard unavailable\nmore detail",
    }));

    expect(result).toEqual({
      ok: false,
      message: "copy com.example.demo: clipboard unavailable",
    });
  });
});
