import { describe, expect, test } from "bun:test";
import { initialState, reducer, selectedJob, visibleJobs } from "../src/state";
import type { Job } from "../src/types";

function job(label: string): Job {
  return {
    label,
    plistPath: `/tmp/${label}.plist`,
    domain: "user",
    arguments: [],
    keepAlive: false,
    runAtLoad: false,
    raw: {},
    runtime: { label, loaded: true, state: "unknown", enabled: true },
    category: "idle",
  };
}

const jobs = [job("com.example.alpha"), job("com.example.Beta"), job("org.other.gamma")];
const loaded = reducer(initialState, {
  type: "jobs-updated",
  jobs,
  warnings: [],
  at: new Date(),
});

describe("filter", () => {
  test("label の部分一致で大文字小文字を区別しない", () => {
    const s = reducer(loaded, { type: "filter-append", char: "b" });
    expect(visibleJobs(s).map((j) => j.label)).toEqual(["com.example.Beta"]);
  });

  test("append と backspace が積み上がる", () => {
    let s = loaded;
    for (const c of "gam") s = reducer(s, { type: "filter-append", char: c });
    expect(s.filter).toBe("gam");
    expect(visibleJobs(s)).toHaveLength(1);
    s = reducer(s, { type: "filter-backspace" });
    expect(s.filter).toBe("ga");
    s = reducer(s, { type: "filter-clear" });
    expect(s.filter).toBe("");
    expect(visibleJobs(s)).toHaveLength(3);
  });

  test("フィルタ解除後も選択中の label を追従する", () => {
    let s = reducer(loaded, { type: "filter-append", char: "g" });
    expect(selectedJob(s)?.label).toBe("org.other.gamma");
    s = reducer(s, { type: "filter-clear" });
    expect(selectedJob(s)?.label).toBe("org.other.gamma");
    expect(s.selectedIndex).toBe(2);
  });
});

describe("jobs-updated の選択追従", () => {
  test("再取得で並びが変わっても label で追従する", () => {
    let s = reducer(loaded, { type: "move-selection", delta: 2 });
    expect(selectedJob(s)?.label).toBe("org.other.gamma");
    s = reducer(s, {
      type: "jobs-updated",
      jobs: [job("org.other.gamma"), job("com.example.alpha")],
      warnings: [],
      at: new Date(),
    });
    expect(selectedJob(s)?.label).toBe("org.other.gamma");
    expect(s.selectedIndex).toBe(0);
  });

  test("選択していた job が消えたら index を clamp する", () => {
    let s = reducer(loaded, { type: "move-selection", delta: 2 });
    s = reducer(s, {
      type: "jobs-updated",
      jobs: [job("com.example.alpha")],
      warnings: [],
      at: new Date(),
    });
    expect(s.selectedIndex).toBe(0);
  });
});
