// E2E 用の launchctl の代役。PATH の先頭に置いて本物の代わりに呼ばれる。
// launchd の状態は FAKE_LAUNCHD_STATE の JSON に持ち、アクションで書き換える。
// 出力形式は test/fixtures の実機出力に合わせ、アプリのパーサが読める最小限だけを返す
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

export interface FakeJob {
  pid?: number;
  lastExitCode?: number;
  runs: number;
}

export interface FakeLaunchdState {
  loaded: Record<string, FakeJob>;
  disabled: string[];
}

const statePath = process.env.FAKE_LAUNCHD_STATE;
if (statePath === undefined) {
  console.error("FAKE_LAUNCHD_STATE is not set");
  process.exit(1);
}
const state = JSON.parse(readFileSync(statePath, "utf8")) as FakeLaunchdState;
const save = () => writeFileSync(statePath, JSON.stringify(state));

const [command, ...args] = process.argv.slice(2);
const labelOf = (target: string | undefined) => target?.split("/")[2] ?? "";

function requireLoaded(label: string): FakeJob {
  const job = state.loaded[label];
  if (job === undefined) {
    console.error(`Could not find service "${label}" in domain for user gui`);
    process.exit(113);
  }
  return job;
}

switch (command) {
  case "list": {
    const lines = ["PID\tStatus\tLabel"];
    for (const [label, job] of Object.entries(state.loaded)) {
      lines.push(`${job.pid ?? "-"}\t${job.lastExitCode ?? 0}\t${label}`);
    }
    console.log(lines.join("\n"));
    break;
  }
  case "print-disabled": {
    const lines = state.disabled.map((label) => `\t\t"${label}" => disabled`);
    console.log(`\tdisabled services = {\n${lines.join("\n")}\n\t}`);
    break;
  }
  case "print": {
    const label = labelOf(args[0]);
    const job = requireLoaded(label);
    const lines = [
      `${args[0]} = {`,
      `\tstate = ${job.pid === undefined ? "not running" : "running"}`,
      `\truns = ${job.runs}`,
    ];
    if (job.pid !== undefined) lines.push(`\tpid = ${job.pid}`);
    lines.push(
      `\tlast exit code = ${job.lastExitCode ?? "(never exited)"}`,
      "}",
    );
    console.log(lines.join("\n"));
    break;
  }
  case "kickstart": {
    const job = requireLoaded(labelOf(args[1]));
    job.runs += 1;
    job.pid = 40000 + job.runs;
    save();
    break;
  }
  case "kill": {
    const job = requireLoaded(labelOf(args[1]));
    job.pid = undefined;
    job.lastExitCode = -15;
    save();
    break;
  }
  case "enable":
  case "disable": {
    const label = labelOf(args[0]);
    state.disabled = state.disabled.filter((l) => l !== label);
    if (command === "disable") state.disabled.push(label);
    save();
    break;
  }
  case "bootout": {
    const label = labelOf(args[0]);
    requireLoaded(label);
    delete state.loaded[label];
    save();
    break;
  }
  case "bootstrap": {
    // plist を読まずにファイル名から label を決める (テストの plist は <label>.plist で置く)
    const label = basename(args[1] ?? "", ".plist");
    state.loaded[label] = { runs: 0 };
    save();
    break;
  }
  default:
    console.error(`fake launchctl: unsupported command ${command}`);
    process.exit(64);
}
