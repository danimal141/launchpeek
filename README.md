# launchpeek

English | [日本語](./README.ja.md)

A terminal app for macOS launchd jobs (LaunchAgents), in the spirit of the Sidekiq dashboard: browse the job list, inspect details and logs, and run kickstart / enable / disable and other actions right there.

The specification is in [docs/spec.md](./docs/spec.md), an English translation of the canonical Japanese version, [docs/spec.ja.md](./docs/spec.ja.md). Design decisions and their rationale are in [docs/design.md](./docs/design.md) (Japanese only).

## Getting started

```sh
# Run in development
bun install
bun start            # = bun run src/index.tsx

# Single binary
bun run build        # = bun run scripts/build.ts → ./launchpeek
./launchpeek

# Make it available from anywhere (link it into a directory on PATH)
ln -s "$PWD/launchpeek" ~/.local/bin/launchpeek
launchpeek
```

The link points at the binary inside the repository, so rebuilding with `bun run build` takes effect immediately.

Requirements: macOS 13 or later, with Bun installed. Only the user domain (`gui/<uid>`) is handled, so sudo is not needed.

## Screens

- **list**: The job list. Category, label, pid, last exit, next run, and a schedule summary
- **detail**: Opened with `Enter`. A narrowed list on the left; plist path, program, schedule, pid, state, run count, and more on the right
- **logs**: Opened with `l`. Shows the last 200 lines of stdout / stderr prefixed with `[out]` / `[err]`, picking up appended lines every second

Category colors: busy=green / failed=red / disabled=gray / scheduled=cyan / idle=white

## Key bindings

| Key | Action |
| --- | --- |
| `j` / `k`, arrow keys, `Ctrl+N` / `Ctrl+P` | Move up / down |
| `g` / `G` | Jump to top / bottom |
| `Enter` | Open detail |
| `l` | Open logs |
| `y` | Copy the selected job's label to the clipboard |
| `r` | kickstart (`launchctl kickstart -k`) |
| `e` / `d` | enable / disable |
| `u` | bootout (asks y/n) |
| `U` | bootstrap |
| `x` | kill SIGTERM (asks y/n) |
| `/` | Filter (substring match on label, case-insensitive). `Enter` to apply, `Esc` to clear |
| `R` | Refresh manually |
| `q` / `Esc` | Go back to the previous mode. Quits from list (`Esc` clears the filter first if one is set) |

## Known limitations

- **next run is approximate**. For `StartInterval` jobs, launchd does not expose the time of the last run, so `now + interval` is shown. It can differ from the actual firing time
- Only jobs with a plist in `~/Library/LaunchAgents` or `/Library/LaunchAgents` are listed. Jobs that only appear in `launchctl list` (XPC services, `/Library/LaunchDaemons`, and so on) are out of scope
- The output format of `launchctl print` can change between macOS versions. Fields that cannot be parsed show as `-` (undefined), and unknown lines are ignored
- The list is refreshed by polling every 3 seconds plus change detection on the LaunchAgents directories. Logs are polled every second
- The binary is built with `scripts/build.ts` (Bun.build) rather than the `bun build --compile` CLI. ink imports its optional peer `react-devtools-core`, which has to be replaced with an empty module through a plugin

## Demo job for manual checks

A job that only writes `date` to stdout every 60 seconds is included.

```sh
cp test/fixtures/com.example.launchpeek-demo.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.example.launchpeek-demo.plist
# Log: /tmp/launchpeek-demo.out.log

# Clean up
launchctl bootout gui/$(id -u)/com.example.launchpeek-demo
rm ~/Library/LaunchAgents/com.example.launchpeek-demo.plist
```

## Development

```sh
bun run lint         # Format and lint (Biome)
bun run typecheck    # Type check
bun test             # Unit tests (core / state)
bun run test:e2e     # E2E tests
```

The E2E tests launch the real app in a pseudo-terminal and check what is rendered in response to key presses.
`launchctl` is replaced with `test/e2e/fake-launchctl.ts` and `HOME` with a temporary directory, so your local launchd is never touched.
CI (GitHub Actions) runs all of these on every PR and push.

## Extra log files

For jobs that write logs to files other than the plist's stdout / stderr, you can add files to display in the optional
`~/.config/launchpeek/config.json`. Without this file, behavior is unchanged.

```json
{
  "extraLogPaths": {
    "com.example.myjob": ["~/Library/Logs/example/run.log"]
  }
}
```

Labels must match exactly. Paths must be absolute or start with `~/`; relative paths and environment variables are not supported.
Extra logs are shown as `[log1]`, `[log2]`, and so on in the configured order, and duplicate paths are shown only once.
The config is reloaded at the same interval as the list. Config warnings are shown on the logs screen and in the status bar.
Invalid entries are ignored while the remaining valid entries are still loaded. Missing files are shown as read errors.
