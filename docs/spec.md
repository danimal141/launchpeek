# launchpeek Implementation Brief

This file is an implementation request for Claude Code. Follow the specification and steps written here to implement `launchpeek` to completion. When in doubt, give priority to the "Default decisions" section, and ask questions only when that still does not settle it.

This is an English translation of [spec.ja.md](./spec.ja.md). If the two disagree, the Japanese version is canonical and this translation is updated to match.

## Overview

A terminal app for macOS launchd jobs (LaunchAgents), in the spirit of the Sidekiq dashboard: browse the job list, inspect details and logs, and run kickstart, enable / disable, and other actions right there.

* The only user is the developer. It only needs to work locally
* Implemented with Bun + TypeScript + Ink
* launchd has no public API, so the app relies on `launchctl` output and reading plists

## Deliverables

* An app started with `bun run src/index.tsx`
* A single binary `launchpeek` that can be produced with `bun build --compile`
* A README (how to start, key bindings, known limitations)
* Unit tests for the data-access layer and schedule calculation

## Environment

* macOS 13 or later
* Bun installed
* During development, only the user domain (`gui/<uid>`) is handled. No sudo or privileged helper is needed

## Tech stack

* Runtime: Bun
* Language: TypeScript (strict)
* UI: Ink, React
* plist parsing: the `plist` package
* Process execution: `Bun.spawn`
* File watching: `fs.watch`
* Tests: `bun test`

As a rule, do not add dependencies beyond the above. If one becomes necessary, write the reason in the commit message.

## Scope

In scope

* plists in `~/Library/LaunchAgents` and `/Library/LaunchAgents`
* Job list, details, log tail
* kickstart, enable / disable, bootstrap / bootout, kill

Out of scope (do not implement)

* `/Library/LaunchDaemons` and `/System/Library/Launch*`
* Editing or creating plists
* Notifications, running as a resident process

## Directory layout

```
launchpeek/
  src/
    index.tsx            Entry point. render(<App />)
    app.tsx              Mode switching and key bindings
    state.ts             reducer and Action types
    types.ts             Type definitions such as Job
    core/
      plist.ts           Finding and loading plists
      launchctl.ts       Running launchctl and parsing its output
      merge.ts           Merging definitions and state by Label
      schedule.ts        Computing nextRun from StartInterval / StartCalendarInterval
      actions.ts         Actions such as kickstart
      logs.ts            Tailing log files
      watcher.ts         Watching the LaunchAgents directories
    ui/
      Header.tsx
      JobList.tsx
      JobDetail.tsx
      LogTail.tsx
      StatusBar.tsx
      FilterInput.tsx
    util/
      exec.ts            Thin wrapper around Bun.spawn
      format.ts          Column width adjustment, time formatting
  test/
    plist.test.ts
    launchctl.test.ts
    schedule.test.ts
    fixtures/            Sample launchctl print output, sample plists
    e2e/                 E2E tests that launch the app in a pseudo-terminal
  README.md              English version
  README.ja.md           Japanese version
  package.json
  tsconfig.json
```

`ui/` does not call `core/` directly; it receives data through `state.ts`. `core/` does not depend on Ink.

## Type definitions

`src/types.ts` is based on the following. Fields may be added as needed, but must not be removed or renamed.

```ts
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

export interface Job extends JobDefinition {
  runtime: JobRuntime;
  nextRun?: Date;
  category: "busy" | "scheduled" | "failed" | "idle" | "disabled";
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
```

Rules for category

* busy: has a pid
* failed: lastExitCode is not 0
* disabled: enabled is false, or loaded is false
* scheduled: nextRun can be computed
* idle: none of the above

Evaluate from the top and use the first rule that matches.

## Loading plists

* Enumerate `~/Library/LaunchAgents/*.plist` and `/Library/LaunchAgents/*.plist`
* Skip files that cannot be read and record a warning in state (the app must not crash)
* Support binary plists (if the `plist` package cannot read one, fall back to `plutil -convert xml1 -o - <path>`)
* Ignore plists without a `Label`
* If there is no `Program` but there is `ProgramArguments`, treat its first element as program
* Accept `StartCalendarInterval` as either a dict or an array of dicts, and always normalize it to an array
* Accept `KeepAlive` as either a bool or a dict; a dict is treated as true

## launchctl

Run everything asynchronously through `util/exec.ts`. The timeout is 5 seconds.

Listing

* Run `launchctl list` and read `PID`, `Status`, and `Label` from each line
* A PID of `-` means not running; a number means running
* Treat Status as the last exit code (negative values are signals)

Details

* Run `launchctl print gui/<uid>/<label>`
* Pick the following out of the output with regular expressions. Anything that cannot be found is undefined
  * `pid = <n>`
  * `state = <word>`
  * `last exit code = <n>` or `last exit code = (never exited)`
  * `run count = <n>` or `runs = <n>`
* If the exit code is not 0 (the job is not loaded), set loaded to false
* The output format can change between macOS versions, so verify the parser against multiple samples in `test/fixtures/` and ignore unknown lines

Determining enabled

* Run `launchctl print-disabled gui/<uid>` once, and collect the `"<label>" => disabled` lines to decide

Getting the uid

* Use `process.getuid()`

## Schedule calculation

`nextRun(def: JobDefinition, now: Date): Date | undefined` in `core/schedule.ts`

* With `StartInterval`: the time of the last run is unknown, so return `now + StartInterval` seconds (state in the README that this is approximate)
* With `StartCalendarInterval`: for each CalendarInterval, search minute by minute for the first time at or after now that satisfies it, and return the earliest. The search limit is 366 days
* Fields that are not specified are wildcards (as in cron)
* Both 0 and 7 for weekday mean Sunday
* If neither is present, return undefined

Make this module pure functions and give it the most thorough tests.

## Actions

`runAction(kind: ActionKind, job: Job): Promise<ActionResult>` in `core/actions.ts`

* kickstart: `launchctl kickstart -k gui/<uid>/<label>`
* enable: `launchctl enable gui/<uid>/<label>`
* disable: `launchctl disable gui/<uid>/<label>`
* bootstrap: `launchctl bootstrap gui/<uid> <plistPath>`
* bootout: `launchctl bootout gui/<uid>/<label>`
* kill: `launchctl kill SIGTERM gui/<uid>/<label>`

* Exit code 0 means ok. Otherwise, use the first line of stderr as the message
* Always reload the state after running an action
* bootout and kill ask for confirmation with `y` in the StatusBar before running

## Logs

`core/logs.ts`

* Covers stdoutPath and stderrPath, plus `extraLogPaths[label]` from the optional `~/.config/launchpeek/config.json`. When both stdout and stderr exist, prefix lines with `[out]` and `[err]`; do not interleave them chronologically, but read the last N lines of each file and concatenate them
* N is 200, and state keeps only that many lines
* While in logs mode, stat each file every second, and re-read the tail on an inode change, shrinkage, an mtime change at the same size, or recovery from a read error. On growth, read only the difference. Do not re-render if the content is the same
* If a file does not exist or cannot be read, say so on screen

## UI

### Screen modes

list

* Header at the top, JobList in the middle, StatusBar at the bottom
* Decide the number of visible rows from the terminal height, and scroll so the selected row is always visible
* Columns: category, label, pid, last exit, next run, schedule summary
* Use a different color per category (busy: green, failed: red, disabled: gray, scheduled: cyan, idle: white)

detail

* A narrowed JobList on the left, JobDetail on the right
* JobDetail shows label, plistPath, program and arguments, schedule, keepAlive / runAtLoad, stdout / stderr paths, pid, state, lastExitCode, runCount, and nextRun

logs

* LogTail in full screen. The top line shows the label and file paths

### Key bindings

* `j` / `k` or arrow keys: move up / down
* `g` / `G`: top / bottom
* `Enter`: open detail
* `l`: open logs
* `y`: copy the selected job's label to the clipboard
* `r`: kickstart
* `e`: enable
* `d`: disable
* `u`: bootout (with confirmation)
* `U`: bootstrap
* `x`: kill (with confirmation)
* `/`: filter input. Substring match on label. `Esc` clears it
* `R`: reload manually
* `q` / `Esc`: go back to the previous mode. Quits when pressed in list

### StatusBar

* Normally: the list of keys available in the current mode
* After an action: show the result message for 3 seconds, then go back
* Waiting for confirmation: show something like `bootout <label>? (y/n)`

## State management

Define a reducer for `useReducer` in `src/state.ts`.

```ts
export interface AppState {
  jobs: Job[];
  warnings: string[];
  selectedIndex: number;
  mode: "list" | "detail" | "logs";
  filter: string;
  filterEditing: boolean;
  message?: string;
  pendingConfirm?: { kind: ActionKind; job: Job };
  logLines: string[];
  lastUpdated?: Date;
  loading: boolean;
}
```

* The list is reloaded by polling every 3 seconds. When `watcher.ts` detects a plist change, reload immediately
* The UI stays usable while reloading. Keep showing the previous jobs and swap them in when ready
* Keep the selected label after a reload (follow by label, not by index)

## Non-functional requirements

* Limit concurrent launchctl calls to 8
* The app never crashes on any exception; it reports through warnings or message
* From startup to the first render, use only the result of `launchctl list`, and fill in details from `launchctl print` afterwards
* Operation must not stutter with around 100 jobs

## Work steps

Proceed in the following order, checking that things work and committing at the end of each step.

* Project setup: `bun init`, add dependencies, tsconfig (strict, jsx: react-jsx), and an empty App for which `bun run` and `bun test` pass
* `list` parsing in `core/launchctl.ts` with tests. Prepare `test/fixtures/launchctl-list.txt`
* Build `JobList` and `Header`, and finish a list mode where j / k changes the selection
* Implement `core/plist.ts`, `core/merge.ts`, and `print` parsing in `core/launchctl.ts` to complete the Job model. Add fixtures
* `core/schedule.ts` with tests. Show next run in the list
* detail mode and `JobDetail`
* logs mode and `LogTail`
* `core/actions.ts` with each key binding, the confirmation flow, and StatusBar messages
* Integrate `watcher.ts` with polling, and follow the selection by label
* Build the binary with `bun build --compile src/index.tsx --outfile launchpeek`, and write the README

## Verification

* All of `bun test` passes
* All of `bun run test:e2e` passes. The E2E tests launch the real app in a pseudo-terminal and check the following against a fake `launchctl` and a `HOME` in a temporary directory
  * LaunchAgents jobs appear in the list
  * `r` kickstarts a job, and pid and run count are updated
  * `e` / `d` toggle enabled
  * Pressing `l` on a job with logs shows them, and appended lines show up
  * Adding or removing a plist is reflected in the list, and the selection follows the label
  * `u` asks y/n before running, and `U` bootstraps the job again
  * The single binary built with `bun run build` starts and shows the list
* The E2E tests do not check behavior against the real launchd. To check it by hand, use `test/fixtures/com.example.launchpeek-demo.plist` (a job that only writes date to stdout every 60 seconds). The README has the bootstrap steps

## Coding conventions

* TypeScript strict. No `any`. Narrow external input (launchctl output, plists) from unknown
* `core/` is pure modules that do not depend on Ink or React
* Always wrap async work in try / catch, and report failures through return values or warnings
* Comments explain why. Wherever the code depends on the launchctl output format, always say so
* Follow Biome (`bun run lint`) for formatting and linting
* Split commits by work step

## Do not

* Hard-code the `launchctl` output format and throw on unknown lines
* Add anything that needs the system domain or sudo
* Rewrite plists
* Load whole log files into state
* Add UI libraries not called for here (such as ink-table)

## Default decisions

When in doubt, do the following.

* Poll every 3 seconds; logs every second
* For jobs where `launchctl print` fails, show them using only the information from `launchctl list`, with state set to unknown
* When the terminal is narrower than 80 columns, omit the next run and schedule columns
* Use only Ink's standard color names
* Show dates and times as `MM-DD HH:mm` in local time
* Filtering is case-insensitive
* Where tests are hard to write, add fixtures and write them anyway. The UI is checked by the E2E tests (`test/e2e/`)

## Definition of done

* Every work step is done and committed
* `bun test` and `bun run test:e2e` pass
* The `launchpeek` binary is produced, starts, and shows the list

## Extra log configuration

`core/config.ts` reads the optional `~/.config/launchpeek/config.json` and
returns the array of paths for the label in `extraLogPaths` that matches exactly.
Only absolute paths and a leading `~` are expanded, and duplicate paths are removed.
If the JSON is broken, the whole config is ignored; invalid labels or elements are ignored individually with a warning.
The config is reloaded at the same interval as the list, and changes apply even while the logs screen is open.
Without a config, the existing behavior is kept, and logs are shown in the order stdout / stderr, then extra logs.
