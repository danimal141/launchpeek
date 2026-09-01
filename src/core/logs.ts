import { stat } from "node:fs/promises";
import type { Job } from "../types";

// ログ全体を state に読み込まないための上限 (SPEC: 末尾 200 行のみ保持)
export const TAIL_LINES = 200;
// 200 行分を拾うために末尾から読む最大バイト数
const TAIL_READ_BYTES = 256 * 1024;

export interface LogFileTail {
  kind: "out" | "err";
  path: string;
  lines: string[];
  // 前回読んだ時点のファイルサイズ。差分読みの起点
  size: number;
  error?: string;
}

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  // 末尾改行で終わるファイルの空要素を落とす
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export async function tailFile(
  kind: "out" | "err",
  path: string,
  maxLines = TAIL_LINES,
): Promise<LogFileTail> {
  try {
    const info = await stat(path);
    const start = Math.max(0, info.size - TAIL_READ_BYTES);
    const text = await Bun.file(path).slice(start, info.size).text();
    const lines = splitLines(text);
    // 途中から読んだ場合、先頭は行の断片なので捨てる
    if (start > 0 && lines.length > 0) lines.shift();
    return { kind, path, lines: lines.slice(-maxLines), size: info.size };
  } catch (err) {
    return { kind, path, lines: [], size: 0, error: String(err) };
  }
}

export interface RefreshResult {
  tail: LogFileTail;
  changed: boolean;
}

// 1 秒ごとのポーリングから呼ばれる。サイズが増えていれば差分だけ読む
export async function refreshTail(prev: LogFileTail): Promise<RefreshResult> {
  let size: number;
  try {
    size = (await stat(prev.path)).size;
  } catch (err) {
    const errored = { ...prev, lines: [], size: 0, error: String(err) };
    return { tail: errored, changed: prev.error === undefined };
  }
  if (prev.error !== undefined || size < prev.size) {
    // 消えていたファイルの復活やローテーションは末尾から読み直す
    return { tail: await tailFile(prev.kind, prev.path), changed: true };
  }
  if (size === prev.size) {
    return { tail: prev, changed: false };
  }
  try {
    const text = await Bun.file(prev.path).slice(prev.size, size).text();
    const lines = [...prev.lines, ...splitLines(text)].slice(-TAIL_LINES);
    return { tail: { ...prev, lines, size }, changed: true };
  } catch (err) {
    return {
      tail: { ...prev, lines: [], size: 0, error: String(err) },
      changed: true,
    };
  }
}

export function logSourcesOf(job: Job): Array<{ kind: "out" | "err"; path: string }> {
  const sources: Array<{ kind: "out" | "err"; path: string }> = [];
  if (job.stdoutPath !== undefined) {
    sources.push({ kind: "out", path: job.stdoutPath });
  }
  if (job.stderrPath !== undefined && job.stderrPath !== job.stdoutPath) {
    sources.push({ kind: "err", path: job.stderrPath });
  }
  return sources;
}

// 表示用: ファイルごとに末尾 N 行を連結する (時系列に混ぜない、SPEC)
export function formatLogLines(tails: LogFileTail[]): string[] {
  const lines: string[] = [];
  for (const tail of tails) {
    const prefix = `[${tail.kind}]`;
    if (tail.error !== undefined) {
      lines.push(`${prefix} (cannot read ${tail.path}: ${tail.error})`);
      continue;
    }
    for (const line of tail.lines) {
      lines.push(`${prefix} ${line}`);
    }
  }
  return lines;
}
