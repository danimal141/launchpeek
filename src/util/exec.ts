export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

// launchctl を大量のジョブに対して同時実行すると launchd 側が詰まるため、
// 並列数を 8 に制限する (SPEC の非機能要件)
const MAX_CONCURRENCY = 8;
const DEFAULT_TIMEOUT_MS = 5000;

let running = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (running < MAX_CONCURRENCY) {
    running++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
}

function release(): void {
  const next = waiters.shift();
  if (next) {
    // 空きスロットをそのまま待機者に引き渡すので running は変えない
    next();
  } else {
    running--;
  }
}

export async function exec(
  cmd: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  stdin?: string,
): Promise<ExecResult> {
  await acquire();
  try {
    const proc = Bun.spawn({
      cmd,
      stdin:
        stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { exitCode, stdout, stderr };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    // spawn 失敗 (コマンド不在等) もアプリを落とさず失敗として返す
    return { exitCode: -1, stdout: "", stderr: String(err) };
  } finally {
    release();
  }
}
