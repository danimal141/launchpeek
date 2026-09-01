import { exec } from "../util/exec";

export interface ListEntry {
  label: string;
  pid?: number;
  lastExitCode?: number;
}

// `launchctl list` の出力 (タブ区切りの PID / Status / Label) をパースする。
// 出力形式は macOS バージョンで変わりうるため、解釈できない行は黙って無視する
export function parseList(output: string): ListEntry[] {
  const entries: ListEntry[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^(\d+|-)\t(-?\d+|-)\t(.+)$/);
    if (!match) continue;
    const [, pidField, statusField, label] = match;
    if (pidField === undefined || statusField === undefined || !label) continue;
    entries.push({
      label,
      pid: pidField === "-" ? undefined : Number(pidField),
      lastExitCode: statusField === "-" ? undefined : Number(statusField),
    });
  }
  return entries;
}

export async function fetchList(): Promise<ListEntry[]> {
  const result = await exec(["launchctl", "list"]);
  if (result.exitCode !== 0) {
    throw new Error(
      `launchctl list failed: ${result.stderr.split("\n")[0] ?? ""}`,
    );
  }
  return parseList(result.stdout);
}

export interface PrintInfo {
  loaded: boolean;
  pid?: number;
  state?: string;
  lastExitCode?: number;
  runCount?: number;
}

// `launchctl print gui/<uid>/<label>` の出力から必要な行だけ正規表現で拾う。
// 形式は macOS バージョンで変わりうるため、取れない項目は undefined のまま残し
// 未知の行はすべて無視する
export function parsePrint(output: string, exitCode: number): PrintInfo {
  // 終了コード非 0 はジョブが当該ドメインに未ロード
  if (exitCode !== 0) return { loaded: false };

  const pid = output.match(/^\s*pid = (\d+)$/m)?.[1];
  const state = output.match(/^\s*state = (.+)$/m)?.[1];
  const exit = output.match(/^\s*last exit code = (-?\d+|\(never exited\))/m)?.[1];
  const runs = output.match(/^\s*(?:run count|runs) = (\d+)$/m)?.[1];

  return {
    loaded: true,
    pid: pid !== undefined ? Number(pid) : undefined,
    state: state?.trim(),
    lastExitCode:
      exit !== undefined && exit !== "(never exited)" ? Number(exit) : undefined,
    runCount: runs !== undefined ? Number(runs) : undefined,
  };
}

export async function fetchPrint(uid: number, label: string): Promise<PrintInfo> {
  const result = await exec(["launchctl", "print", `gui/${uid}/${label}`]);
  return parsePrint(result.stdout, result.exitCode);
}

// `launchctl print-disabled gui/<uid>` の `"<label>" => disabled` 行を集める
export function parsePrintDisabled(output: string): Set<string> {
  const disabled = new Set<string>();
  for (const match of output.matchAll(/"([^"]+)" => disabled/g)) {
    const label = match[1];
    if (label !== undefined) disabled.add(label);
  }
  return disabled;
}

export async function fetchDisabledLabels(uid: number): Promise<Set<string>> {
  const result = await exec(["launchctl", "print-disabled", `gui/${uid}`]);
  if (result.exitCode !== 0) return new Set();
  return parsePrintDisabled(result.stdout);
}
