import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfigPath, extraLogPathsFor, loadConfig, parseConfig, resolveLogPath } from "../src/core/config";

const dir = await mkdtemp(join(tmpdir(), "launchpeek-config-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

test("設定パスとユーザーパスを解決し、シェル展開はしない", () => {
  expect(defaultConfigPath()).toBe(join(homedir(), ".config/launchpeek/config.json"));
  expect(resolveLogPath("~")).toBe(homedir());
  expect(resolveLogPath("~/logs/a")).toBe(join(homedir(), "logs/a"));
  expect(resolveLogPath("/tmp/a")).toBe("/tmp/a");
  for (const path of ["a", "$HOME/a", "~someone/a"]) expect(resolveLogPath(path)).toBeUndefined();
});

test("完全一致labelに紐付け、正規化後の重複を除き、不正な項目だけを警告する", () => {
  const result = parseConfig({ extraLogPaths: {
    job: ["/tmp/a", "/tmp/./a", "~/logs/b", "", 1, "relative"],
    broken: false, "": ["/tmp/c"], other: ["/tmp/d"],
  } });
  expect(extraLogPathsFor(result.config, "job")).toEqual(["/tmp/a", join(homedir(), "logs/b")]);
  expect(extraLogPathsFor(result.config, "other")).toEqual(["/tmp/d"]);
  expect(extraLogPathsFor(result.config, "jo")).toEqual([]);
  expect(extraLogPathsFor(result.config, "missing")).toEqual([]);
  expect(result.warnings).toHaveLength(5);
});

test("壊れた設定は警告し、設定無しは正常として扱う", () => {
  for (const value of [null, [], "x", 3, { extraLogPaths: [] }, { extraLogPaths: false }]) {
    const result = parseConfig(value);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(Object.keys(result.config.extraLogPaths)).toHaveLength(0);
  }
  expect(parseConfig({}).warnings).toEqual([]);
  expect(parseConfig({ typo: {} }).warnings).toHaveLength(1);
});

test("prototype名のlabelも安全に扱う", () => {
  const result = parseConfig(JSON.parse('{"extraLogPaths":{"__proto__":["/tmp/a"],"constructor":["/tmp/b"]}}'));
  expect(extraLogPathsFor(result.config, "__proto__")).toEqual(["/tmp/a"]);
  expect(extraLogPathsFor(result.config, "constructor")).toEqual(["/tmp/b"]);
  expect(extraLogPathsFor({ extraLogPaths: {} }, "toString")).toEqual([]);
});

test("ファイルの読み込み・設定変更・JSON破損・不存在・読めないパス", async () => {
  const path = join(dir, "config.json");
  expect((await loadConfig(path)).warnings).toEqual([]);
  await writeFile(path, '{"extraLogPaths":{"job":["/tmp/a"]}}');
  expect(extraLogPathsFor((await loadConfig(path)).config, "job")).toEqual(["/tmp/a"]);
  await writeFile(path, '{"extraLogPaths":{"job":["/tmp/b"]}}');
  expect(extraLogPathsFor((await loadConfig(path)).config, "job")).toEqual(["/tmp/b"]);
  await writeFile(path, "{invalid");
  const broken = await loadConfig(path);
  expect(broken.warnings[0]).toContain(path);
  expect(Object.keys(broken.config.extraLogPaths)).toHaveLength(0);
  const directory = join(dir, "directory");
  await mkdir(directory);
  expect(Object.keys((await loadConfig(directory)).config.extraLogPaths)).toHaveLength(0);
});
