import type { ActionKind, ActionResult, Job } from "../types";
import { exec } from "../util/exec";

// コマンド組み立てを純粋関数に分けてテスト可能にする
export function actionCommand(
  kind: ActionKind,
  job: Job,
  uid: number,
): string[] {
  const target = `gui/${uid}/${job.label}`;
  switch (kind) {
    case "kickstart":
      // -k で実行中でも再起動する
      return ["launchctl", "kickstart", "-k", target];
    case "enable":
      return ["launchctl", "enable", target];
    case "disable":
      return ["launchctl", "disable", target];
    case "bootstrap":
      return ["launchctl", "bootstrap", `gui/${uid}`, job.plistPath];
    case "bootout":
      return ["launchctl", "bootout", target];
    case "kill":
      return ["launchctl", "kill", "SIGTERM", target];
  }
}

export async function runAction(
  kind: ActionKind,
  job: Job,
): Promise<ActionResult> {
  const uid = process.getuid?.() ?? 0;
  const result = await exec(actionCommand(kind, job, uid));
  if (result.exitCode === 0) {
    return { ok: true, message: `${kind} ${job.label}: ok` };
  }
  const firstLine = result.stderr.split("\n")[0]?.trim();
  return {
    ok: false,
    message: `${kind} ${job.label}: ${firstLine !== undefined && firstLine !== "" ? firstLine : `exit ${result.exitCode}`}`,
  };
}
