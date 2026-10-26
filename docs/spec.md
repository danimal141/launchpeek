# launchpeek Specification

This document covers the purpose, scope, constraints to keep, and default values. It only keeps what tests cannot express.

* Detailed behavior (category rules, schedule calculation, plist loading rules, launchctl parsing, log reload conditions, and so on) is defined by the unit tests (`test/*.test.ts`)
* Screen and key-binding behavior is defined by the E2E tests (`test/e2e/`) and the README
* The reasoning behind decisions is in [design.md](./design.md) (Japanese only)

This is an English translation of [spec.ja.md](./spec.ja.md). If the two disagree, the Japanese version is canonical and this translation is updated to match.

## Purpose

A terminal app for macOS launchd jobs (LaunchAgents), in the spirit of the Sidekiq dashboard: browse the job list, details, and logs, and run kickstart, enable / disable, and other actions right there.

* The only user is the developer. It only needs to work locally
* launchd has no public API, so the app relies on `launchctl` output and reading plists

## Prerequisites

* macOS 13 or later, with Bun installed
* Only the user domain (`gui/<uid>`) is handled. No sudo or privileged helper is used

## Scope

In scope

* Jobs with a plist in `~/Library/LaunchAgents` or `/Library/LaunchAgents`
* Job list, details, log tail
* kickstart, enable / disable, bootstrap / bootout, kill

Out of scope (do not implement)

* `/Library/LaunchDaemons` and `/System/Library/Launch*`
* Jobs that only appear in `launchctl list` (XPC services and so on)
* Editing or creating plists
* Notifications, running as a resident process

## Constraints

* Do not hard-code the `launchctl` output format. It can change between macOS versions, so ignore unknown lines and leave fields that cannot be read as undefined
* Do not add anything that needs the system domain or sudo
* Do not rewrite plists
* Do not load whole log files into state. Keep at most the last 200 lines
* Ask for confirmation with `y` before irreversible actions (bootout and kill)
* `core/` does not depend on Ink or React. `ui/` does not call `core/` directly; it receives data through `state.ts`
* As a rule, do not add dependencies. When adding one, write the reason in the commit message. Do not use UI libraries not called for here (such as ink-table)

## Non-functional requirements

* Limit concurrent launchctl calls to 8, with a 5-second timeout per call
* The app never crashes on any exception; it reports through warnings or message
* From startup to the first render, use only the plist definitions and the result of `launchctl list`, and fill in details from `launchctl print` afterwards
* Operation must not stutter with around 100 jobs

## Default values

Values decided as part of the specification. When changing one, update this document too.

* The list is reloaded by polling every 3 seconds, and immediately when a plist change is detected
* While in logs mode, logs are checked for appended lines every second
* Action result messages disappear after 3 seconds
* For `StartInterval` jobs, next run is shown as the approximation `now + StartInterval`, because launchd does not expose the time of the last run
* The search limit for the next run of `StartCalendarInterval` is 366 days
* When the terminal is narrower than 80 columns, omit the next run and schedule columns
* Use only Ink's standard color names
* Show dates and times as `MM-DD HH:mm` in local time
* Filtering is case-insensitive
