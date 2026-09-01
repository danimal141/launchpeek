import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parsePlistXml, parseBinary } from "plist";
import type { CalendarInterval, Domain, JobDefinition } from "../types";
import { exec } from "../util/exec";

export const AGENT_DIRS: ReadonlyArray<{ dir: string; domain: Domain }> = [
  { dir: join(homedir(), "Library/LaunchAgents"), domain: "user" },
  { dir: "/Library/LaunchAgents", domain: "system" },
];

export interface LoadResult {
  definitions: JobDefinition[];
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function toCalendarInterval(value: unknown): CalendarInterval | undefined {
  if (!isRecord(value)) return undefined;
  return {
    minute: asNumber(value["Minute"]),
    hour: asNumber(value["Hour"]),
    day: asNumber(value["Day"]),
    weekday: asNumber(value["Weekday"]),
    month: asNumber(value["Month"]),
  };
}

// dict でも dict の配列でも受け付け、必ず配列に正規化する (SPEC)
function toCalendarIntervals(
  value: unknown,
): CalendarInterval[] | undefined {
  if (value === undefined) return undefined;
  const items = Array.isArray(value) ? value : [value];
  const intervals = items
    .map(toCalendarInterval)
    .filter((ci): ci is CalendarInterval => ci !== undefined);
  return intervals.length > 0 ? intervals : undefined;
}

export function parseJobDefinition(
  raw: unknown,
  plistPath: string,
  domain: Domain,
): JobDefinition | undefined {
  if (!isRecord(raw)) return undefined;
  const label = asString(raw["Label"]);
  // Label が無い plist は launchd のジョブとして成立しないので無視する (SPEC)
  if (label === undefined) return undefined;

  const args = Array.isArray(raw["ProgramArguments"])
    ? raw["ProgramArguments"].filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const keepAliveRaw = raw["KeepAlive"];

  return {
    label,
    plistPath,
    domain,
    // Program が無ければ ProgramArguments の先頭を program とみなす (SPEC)
    program: asString(raw["Program"]) ?? args[0],
    arguments: args,
    startInterval: asNumber(raw["StartInterval"]),
    startCalendarInterval: toCalendarIntervals(raw["StartCalendarInterval"]),
    // KeepAlive は dict (条件付き keepalive) の場合も true とみなす (SPEC)
    keepAlive: keepAliveRaw === true || isRecord(keepAliveRaw),
    runAtLoad: raw["RunAtLoad"] === true,
    stdoutPath: asString(raw["StandardOutPath"]),
    stderrPath: asString(raw["StandardErrorPath"]),
    workingDirectory: asString(raw["WorkingDirectory"]),
    raw,
  };
}

export interface SingleLoadResult {
  definition?: JobDefinition;
  warning?: string;
}

export async function loadDefinition(
  path: string,
  domain: Domain,
): Promise<SingleLoadResult> {
  let raw: unknown;
  try {
    const file = Bun.file(path);
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      // BOM や先頭空白があると xmldom が stderr にノイズを吐くので除去する
      raw = parsePlistXml(
        new TextDecoder().decode(bytes).replace(/^\uFEFF/, "").trimStart(),
      );
    } catch {
      // バイナリ plist は XML パーサで読めないので parseBinary を試す
      raw = parseBinary(bytes);
    }
  } catch {
    // それでも読めないものは plutil で XML 化してから読む (最後の砦)
    const result = await exec(["plutil", "-convert", "xml1", "-o", "-", path]);
    if (result.exitCode !== 0) {
      return { warning: `failed to read plist: ${path}` };
    }
    try {
      raw = parsePlistXml(result.stdout);
    } catch {
      return { warning: `failed to parse plist: ${path}` };
    }
  }
  return { definition: parseJobDefinition(raw, path, domain) };
}

export async function loadDefinitions(): Promise<LoadResult> {
  const definitions: JobDefinition[] = [];
  const warnings: string[] = [];
  for (const { dir, domain } of AGENT_DIRS) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      // ディレクトリが無い環境 (新規マシン等) は正常系として扱う
      continue;
    }
    for (const name of names.filter((n) => n.endsWith(".plist")).sort()) {
      const { definition, warning } = await loadDefinition(
        join(dir, name),
        domain,
      );
      if (definition) definitions.push(definition);
      if (warning !== undefined) warnings.push(warning);
    }
  }
  return { definitions, warnings };
}
