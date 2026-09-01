import { watch, type FSWatcher } from "node:fs";
import { AGENT_DIRS } from "./plist";

const DEBOUNCE_MS = 300;

// LaunchAgents ディレクトリを監視し、plist の追加・削除・変更で onChange を呼ぶ。
// エディタの保存等で複数イベントが連続するため debounce する。
// 戻り値は監視を止める関数
export function watchAgentDirs(
  onChange: () => void,
  dirs: readonly string[] = AGENT_DIRS.map((d) => d.dir),
): () => void {
  const watchers: FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const trigger = (filename: string | null) => {
    // ファイル名が取れないイベントもあるため、その場合は plist 扱いで通知する
    if (filename !== null && !filename.endsWith(".plist")) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(onChange, DEBOUNCE_MS);
  };

  for (const dir of dirs) {
    try {
      watchers.push(watch(dir, (_event, filename) => trigger(filename)));
    } catch {
      // ディレクトリが無い環境では監視しない (ポーリングで拾える)
    }
  }

  return () => {
    if (timer !== undefined) clearTimeout(timer);
    for (const w of watchers) w.close();
  };
}
