import { stat } from "node:fs/promises";
import type { Job } from "../types";

// ログ全体を state に読み込まないための上限 (SPEC: 末尾 200 行のみ保持)
export const TAIL_LINES = 200;
// 200 行分を拾うために末尾から読む最大バイト数
const TAIL_READ_BYTES = 256 * 1024;

export interface LogFileTail {
  kind: "out" | "err" | `log${number}`;
  path: string;
  lines: string[];
  // 前回読んだ時点のファイルサイズ。差分読みの起点
  size: number;
  ino: number;
  mtimeMs: number;
  error?: string;
}

function splitLines(text: string): string[] {
  const lines = text.split("\n");
  // 末尾改行で終わるファイルの空要素を落とす
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export async function tailFile(
  kind: "out" | "err" | `log${number}`,
  path: string,
  maxLines = TAIL_LINES,
): Promise<LogFileTail> {
  try {
    // ino / mtimeMs は refreshTail の置き換え判定の起点になる。
    // 二重 stat で取ると読んだ内容と識別情報がずれるので、必ずこの 1 回から取る
    const info = await stat(path);
    const start = Math.max(0, info.size - TAIL_READ_BYTES);
    const text = await Bun.file(path).slice(start, info.size).text();
    const lines = splitLines(text);
    // 途中から読んだ場合、先頭は行の断片なので捨てる
    if (start > 0 && lines.length > 0) lines.shift();
    return {
      kind, path,
      lines: lines.slice(-maxLines),
      size: info.size,
      ino: info.ino,
      mtimeMs: info.mtimeMs,
    };
  } catch (err) {
    return {
      kind, path,
      lines: [],
      size: 0,
      ino: 0,
      mtimeMs: 0,
      error: String(err),
    };
  }
}

export interface RefreshResult {
  tail: LogFileTail;
  changed: boolean;
}

// 読み直した結果が前回と同じなら再描画する意味が無い。
// /dev/null は size 0 のまま mtime だけが動くため、これが無いと毎秒再描画になる
function sameContent(a: LogFileTail, b: LogFileTail): boolean {
  if (a.error !== b.error) return false;
  if (a.lines.length !== b.lines.length) return false;
  return a.lines.every((line, i) => line === b.lines[i]);
}

// 1 秒ごとのポーリングから呼ばれる。判定は下の順序に意味があるので入れ替えないこと:
// error 復帰を ino 判定より先に見ることで、消えた後に inode を再利用して
// 再作成されたファイルを「変化なし」と誤判定せずに済む。
// また同サイズ書き換えを mtime で拾う代償として、毎回同じサイズで書き換わる
// ファイルは毎ポーリングで読み直しになる (stat 1 回で直す以上避けられない)
export async function refreshTail(prev: LogFileTail): Promise<RefreshResult> {
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(prev.path);
  } catch (err) {
    const errored = {
      ...prev,
      lines: [],
      size: 0,
      ino: 0,
      mtimeMs: 0,
      error: String(err),
    };
    return { tail: errored, changed: prev.error === undefined };
  }
  // 読み直した tail は内容が同じでも必ず採用する。ino / mtime を更新しないと
  // 次のポーリングでも同じ判定に落ちて読み直しを繰り返すため
  const retail = async (): Promise<RefreshResult> => {
    const next = await tailFile(prev.kind, prev.path);
    return { tail: next, changed: !sameContent(prev, next) };
  };
  if (prev.error !== undefined) {
    // 消えていたファイルの復活は末尾から読み直す
    return retail();
  }
  if (info.ino !== prev.ino) {
    // rename + 再作成や symlink の張り替え。stat は symlink を辿るのでここで拾える
    return retail();
  }
  if (info.size < prev.size) {
    // truncate やローテーション
    return retail();
  }
  if (info.size === prev.size) {
    // 同じサイズでも mtime が動いていれば中身が入れ替わっている可能性がある
    if (info.mtimeMs === prev.mtimeMs) return { tail: prev, changed: false };
    return retail();
  }
  try {
    const text = await Bun.file(prev.path).slice(prev.size, info.size).text();
    const lines = [...prev.lines, ...splitLines(text)].slice(-TAIL_LINES);
    return {
      tail: {
        ...prev,
        lines,
        size: info.size,
        ino: info.ino,
        mtimeMs: info.mtimeMs,
      },
      changed: true,
    };
  } catch (err) {
    return {
      tail: {
        ...prev,
        lines: [],
        size: 0,
        ino: 0,
        mtimeMs: 0,
        error: String(err),
      },
      changed: true,
    };
  }
}

export function logSourcesOf(job: Job, extraPaths: readonly string[] = []): Array<{ kind: LogFileTail["kind"]; path: string }> {
  const sources: Array<{ kind: LogFileTail["kind"]; path: string }> = [];
  const seen = new Set<string>();
  const push = (kind: LogFileTail["kind"], path: string | undefined) => {
    if (path === undefined || seen.has(path)) return;
    seen.add(path);
    sources.push({ kind, path });
  };
  push("out", job.stdoutPath);
  push("err", job.stderrPath);
  let extraCount = 0;
  for (const path of extraPaths) {
    if (seen.has(path)) continue;
    push(`log${++extraCount}`, path);
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
