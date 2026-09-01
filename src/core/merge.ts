import type { Job, JobCategory, JobRuntime } from "../types";
import type { ListEntry } from "./launchctl";

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

// launchctl list の情報だけで表示する暫定 Job。
// plist 定義と launchctl print の詳細は後続の取得で埋める
export function jobFromListEntry(entry: ListEntry): Job {
  const runtime: JobRuntime = {
    label: entry.label,
    // launchctl list に載っている時点で user ドメインにロード済み
    loaded: true,
    pid: entry.pid,
    state: entry.pid !== undefined ? "running" : "unknown",
    lastExitCode: entry.lastExitCode,
    enabled: true,
  };
  return {
    label: entry.label,
    plistPath: "",
    domain: "user",
    arguments: [],
    keepAlive: false,
    runAtLoad: false,
    raw: {},
    runtime,
    category: categorize(runtime, undefined),
  };
}
