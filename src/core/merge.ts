import type {
  Job,
  JobCategory,
  JobDefinition,
  JobRuntime,
  JobState,
} from "../types";
import type { ListEntry, PrintInfo } from "./launchctl";
import { nextRun } from "./schedule";

// category は SPEC の規則どおり上から順に評価し、最初に一致したものを採用する
export function categorize(
  runtime: JobRuntime,
  nextRun: Date | undefined,
): JobCategory {
  if (runtime.pid !== undefined) return "busy";
  if (runtime.lastExitCode !== undefined && runtime.lastExitCode !== 0) {
    return "failed";
  }
  if (!runtime.enabled || !runtime.loaded) return "disabled";
  if (nextRun !== undefined) return "scheduled";
  return "idle";
}

// launchctl print の state 表記 (running / not running / waiting 等) を
// JobState に落とす。未知の表記は unknown にする
function toJobState(
  printState: string | undefined,
  loaded: boolean,
  enabled: boolean,
  pid: number | undefined,
): JobState {
  if (!loaded) return enabled ? "not-loaded" : "disabled";
  if (printState === "running") return "running";
  if (printState === "waiting") return "waiting";
  if (pid !== undefined) return "running";
  return "unknown";
}

export interface RuntimeSources {
  list: Map<string, ListEntry>;
  prints: Map<string, PrintInfo>;
  disabledLabels: Set<string>;
}

export function emptySources(): RuntimeSources {
  return { list: new Map(), prints: new Map(), disabledLabels: new Set() };
}

export function buildRuntime(
  label: string,
  sources: RuntimeSources,
): JobRuntime {
  const listEntry = sources.list.get(label);
  const print = sources.prints.get(label);
  const enabled = !sources.disabledLabels.has(label);
  // print が未取得 (初回描画) の間は launchctl list に載っていればロード済みとみなす
  const loaded = print?.loaded ?? listEntry !== undefined;
  const pid = print?.pid ?? listEntry?.pid;
  return {
    label,
    loaded,
    pid,
    state: toJobState(print?.state, loaded, enabled, pid),
    lastExitCode: print?.lastExitCode ?? listEntry?.lastExitCode,
    runCount: print?.runCount,
    enabled,
  };
}

// plist 定義に launchctl の状態を Label でマージする。
// launchctl list には LaunchAgents 以外の大量のジョブ (XPC サービス等) も載るが、
// SPEC のスコープは両 LaunchAgents ディレクトリの plist なので定義側を正とする
export function mergeJobs(
  definitions: JobDefinition[],
  sources: RuntimeSources,
  now: Date,
): Job[] {
  return definitions
    .map((def) => {
      const runtime = buildRuntime(def.label, sources);
      // 未ロード / 無効のジョブは launchd に予定が無いので nextRun を出さない
      const run =
        runtime.loaded && runtime.enabled ? nextRun(def, now) : undefined;
      return { ...def, runtime, nextRun: run, category: categorize(runtime, run) };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
