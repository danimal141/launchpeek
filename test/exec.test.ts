import { describe, expect, test } from "bun:test";
import { exec } from "../src/util/exec";

describe("exec", () => {
  test("文字列を子プロセスの標準入力へ渡す", async () => {
    const result = await exec(["/bin/cat"], undefined, "hello");

    expect(result).toEqual({ exitCode: 0, stdout: "hello", stderr: "" });
  });
});
