import { describe, expect, test } from "bun:test";
import type { ListEntry, PrintInfo } from "../src/core/launchctl";
import { buildRuntime, categorize, emptySources, mergeJobs } from "../src/core/merge";
import type { JobDefinition, JobRuntime } from "../src/types";

function runtime(overrides: Partial<JobRuntime>): JobRuntime {
  return {
    label: "test",
    loaded: true,
    state: "unknown",
    enabled: true,
    ...overrides,
  };
}

describe("categorize", () => {
  test("pid があれば busy (最優先)", () => {
    expect(categorize(runtime({ pid: 1, lastExitCode: 1, enabled: false }), new Date())).toBe("busy");
  });

  test("lastExitCode 非 0 は failed", () => {
    expect(categorize(runtime({ lastExitCode: 78 }), undefined)).toBe("failed");
    expect(categorize(runtime({ lastExitCode: -9 }), undefined)).toBe("failed");
  });

  test("enabled false または loaded false は disabled", () => {
    expect(categorize(runtime({ enabled: false }), new Date())).toBe("disabled");
    expect(categorize(runtime({ loaded: false }), new Date())).toBe("disabled");
  });

  test("nextRun があれば scheduled、無ければ idle", () => {
    expect(categorize(runtime({}), new Date())).toBe("scheduled");
    expect(categorize(runtime({}), undefined)).toBe("idle");
  });
});

function definition(label: string): JobDefinition {
  return {
    label,
    plistPath: `/tmp/${label}.plist`,
    domain: "user",
    arguments: [],
    keepAlive: false,
    runAtLoad: false,
    raw: {},
  };
}

describe("buildRuntime", () => {
  test("print 未取得なら launchctl list の情報でロード済みとみなす", () => {
    const sources = emptySources();
    sources.list.set("a", { label: "a", pid: 123, lastExitCode: 0 } satisfies ListEntry);
    const rt = buildRuntime("a", sources);
    expect(rt).toMatchObject({ loaded: true, pid: 123, state: "running" });
  });

  test("list にも print にも無ければ not-loaded", () => {
    const rt = buildRuntime("missing", emptySources());
    expect(rt).toMatchObject({ loaded: false, state: "not-loaded" });
  });

  test("print の情報が list より優先される", () => {
    const sources = emptySources();
    sources.list.set("a", { label: "a", lastExitCode: 0 });
    sources.prints.set("a", {
      loaded: true,
      state: "not running",
      lastExitCode: 78,
      runCount: 5,
    } satisfies PrintInfo);
    const rt = buildRuntime("a", sources);
    expect(rt).toMatchObject({
      loaded: true,
      lastExitCode: 78,
      runCount: 5,
      state: "unknown",
    });
  });

  test("disabled 一覧に載っていれば enabled false", () => {
    const sources = emptySources();
    sources.disabledLabels.add("a");
    sources.prints.set("a", { loaded: false });
    const rt = buildRuntime("a", sources);
    expect(rt).toMatchObject({ enabled: false, state: "disabled" });
  });
});

describe("mergeJobs", () => {
  test("定義を正として label 順にマージする", () => {
    const sources = emptySources();
    sources.list.set("b.job", { label: "b.job", pid: 42 });
    // list にしか無いジョブ (LaunchAgents 外の XPC サービス等) は含まれない
    sources.list.set("zz.not-mine", { label: "zz.not-mine" });
    const jobs = mergeJobs([definition("b.job"), definition("a.job")], sources);
    expect(jobs.map((j) => j.label)).toEqual(["a.job", "b.job"]);
    expect(jobs[1]?.category).toBe("busy");
    expect(jobs[0]?.category).toBe("disabled"); // 未ロードなので
  });
});
