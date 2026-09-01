export type Domain = "user" | "system";

export type JobState =
  | "running"
  | "waiting"
  | "disabled"
  | "not-loaded"
  | "unknown";

export interface CalendarInterval {
  minute?: number;
  hour?: number;
  day?: number;
  weekday?: number;
  month?: number;
}

export interface JobDefinition {
  label: string;
  plistPath: string;
  domain: Domain;
  program?: string;
  arguments: string[];
  startInterval?: number;
  startCalendarInterval?: CalendarInterval[];
  keepAlive: boolean;
  runAtLoad: boolean;
  stdoutPath?: string;
  stderrPath?: string;
  workingDirectory?: string;
  raw: Record<string, unknown>;
}

export interface JobRuntime {
  label: string;
  loaded: boolean;
  pid?: number;
  state: JobState;
  lastExitCode?: number;
  runCount?: number;
  enabled: boolean;
}

export type JobCategory = "busy" | "scheduled" | "failed" | "idle" | "disabled";

export interface Job extends JobDefinition {
  runtime: JobRuntime;
  nextRun?: Date;
  category: JobCategory;
}

export type ActionKind =
  | "kickstart"
  | "enable"
  | "disable"
  | "bootstrap"
  | "bootout"
  | "kill";

export interface ActionResult {
  ok: boolean;
  message: string;
}
