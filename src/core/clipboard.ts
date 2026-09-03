import type { ActionResult } from "../types";
import { exec, type ExecResult } from "../util/exec";

type Exec = (
  cmd: string[],
  timeoutMs?: number,
  stdin?: string,
) => Promise<ExecResult>;

export async function copyLabel(
  label: string,
  execute: Exec = exec,
): Promise<ActionResult> {
  const result = await execute(["pbcopy"], undefined, label);
  if (result.exitCode === 0) {
    return { ok: true, message: `copied ${label}` };
  }
  const firstLine = result.stderr.split("\n")[0]?.trim();
  return {
    ok: false,
    message: `copy ${label}: ${firstLine !== undefined && firstLine !== "" ? firstLine : `exit ${result.exitCode}`}`,
  };
}
