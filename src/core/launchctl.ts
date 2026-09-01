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
