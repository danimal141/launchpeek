import { Box, useApp, useInput, useStdout } from "ink";
import { useEffect, useReducer, useRef } from "react";
import {
  fetchDisabledLabels,
  fetchList,
  fetchPrint,
  type ListEntry,
  type PrintInfo,
} from "./core/launchctl";
import {
  formatLogLines,
  logSourcesOf,
  refreshTail,
  tailFile,
  type LogFileTail,
} from "./core/logs";
import { emptySources, mergeJobs, type RuntimeSources } from "./core/merge";
import { loadDefinitions } from "./core/plist";
import { initialState, reducer, selectedJob, visibleJobs } from "./state";
import { Header } from "./ui/Header";
import { JobDetail } from "./ui/JobDetail";
import { JobList } from "./ui/JobList";
import { LogTail } from "./ui/LogTail";
import { StatusBar } from "./ui/StatusBar";

const uid = process.getuid?.() ?? 0;

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    let cancelled = false;

    const publish = (
      definitions: Awaited<ReturnType<typeof loadDefinitions>>["definitions"],
      sources: RuntimeSources,
      warnings: string[],
    ) => {
      if (cancelled) return;
      const now = new Date();
      dispatch({
        type: "jobs-updated",
        jobs: mergeJobs(definitions, sources, now),
        warnings,
        at: now,
      });
    };

    (async () => {
      // 初回描画は plist 定義と launchctl list だけで行い (SPEC 非機能要件)、
      // 遅い launchctl print の詳細は後から埋めて再描画する
      const warnings: string[] = [];
      const sources = emptySources();
      let definitions: Awaited<
        ReturnType<typeof loadDefinitions>
      >["definitions"] = [];
      try {
        const [loadResult, listEntries] = await Promise.all([
          loadDefinitions(),
          fetchList().catch((err): ListEntry[] => {
            warnings.push(String(err));
            return [];
          }),
        ]);
        definitions = loadResult.definitions;
        warnings.push(...loadResult.warnings);
        sources.list = new Map(listEntries.map((e) => [e.label, e]));
      } catch (err) {
        warnings.push(String(err));
      }
      publish(definitions, sources, warnings);

      try {
        const [disabledLabels, prints] = await Promise.all([
          fetchDisabledLabels(uid),
          Promise.all(
            definitions.map(
              async (def): Promise<[string, PrintInfo]> => [
                def.label,
                await fetchPrint(uid, def.label),
              ],
            ),
          ),
        ]);
        sources.disabledLabels = disabledLabels;
        sources.prints = new Map(prints);
      } catch (err) {
        warnings.push(String(err));
      }
      publish(definitions, sources, warnings);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // logs ポーリングの effect が最新の jobs を stale closure なしで引けるようにする
  const jobsRef = useRef(state.jobs);
  jobsRef.current = state.jobs;
  const selectedLabel = selectedJob(state)?.label;

  useEffect(() => {
    if (state.mode !== "logs") return;
    const job = jobsRef.current.find((j) => j.label === selectedLabel);
    if (!job) return;

    let stopped = false;
    let busy = false;
    let tails: LogFileTail[] = [];

    const publish = () => {
      if (!stopped) dispatch({ type: "log-lines", lines: formatLogLines(tails) });
    };

    (async () => {
      tails = await Promise.all(
        logSourcesOf(job).map((s) => tailFile(s.kind, s.path)),
      );
      publish();
    })();

    // logs モードの間は 1 秒ごとにサイズを確認し、増えていれば差分を読む (SPEC)
    const timer = setInterval(async () => {
      if (busy || tails.length === 0) return;
      busy = true;
      try {
        const results = await Promise.all(tails.map(refreshTail));
        tails = results.map((r) => r.tail);
        if (results.some((r) => r.changed)) publish();
      } finally {
        busy = false;
      }
    }, 1000);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [state.mode, selectedLabel]);

  // 高速連打やペーストでは複数キーが 1 チャンクで届くため、1 文字ずつ処理する
  useInput((chunk, key) => {
    const inputs = chunk.length > 1 ? chunk.split("") : [chunk];
    for (const input of inputs) handleKey(input, key);
  });

  function handleKey(input: string, key: Parameters<Parameters<typeof useInput>[0]>[1]) {
    if (input === "q" || key.escape) {
      // 一つ前のモードへ戻る。list で押した場合は終了 (SPEC)
      if (state.mode === "logs") {
        dispatch({ type: "close-logs" });
      } else if (state.mode === "detail") {
        dispatch({ type: "set-mode", mode: "list" });
      } else {
        exit();
      }
      return;
    }
    // logs は全画面表示なので閲覧キー以外は受け付けない
    if (state.mode === "logs") return;
    if (input === "l") {
      dispatch({ type: "open-logs" });
      return;
    }
    if (input === "j" || key.downArrow) {
      dispatch({ type: "move-selection", delta: 1 });
    } else if (input === "k" || key.upArrow) {
      dispatch({ type: "move-selection", delta: -1 });
    } else if (input === "g") {
      dispatch({ type: "select-first" });
    } else if (input === "G") {
      dispatch({ type: "select-last" });
    } else if (key.return && state.mode === "list") {
      dispatch({ type: "set-mode", mode: "detail" });
    }
  }

  // pty によっては columns/rows が 0 になるため ?? ではなく || で補正する
  const width = stdout.columns || 80;
  const height = stdout.rows || 24;
  const listHeight = Math.max(3, height - 2);
  // detail モードでは左 4 割を縮小 JobList に使う
  const listWidth = Math.max(24, Math.floor(width * 0.4));
  const visible = visibleJobs(state);

  if (state.mode === "logs") {
    // 全画面で LogTail。上部 1 行に label とファイルパス (SPEC)
    return (
      <Box flexDirection="column" width={width}>
        <LogTail
          job={selectedJob(state)}
          lines={state.logLines}
          height={height - 1}
        />
        <StatusBar
          mode={state.mode}
          message={state.message}
          warnings={state.warnings}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width}>
      <Header
        jobCount={state.jobs.length}
        visibleCount={visible.length}
        filter={state.filter}
        lastUpdated={state.lastUpdated}
        loading={state.loading}
      />
      {state.mode === "detail" ? (
        <Box height={listHeight}>
          <Box width={listWidth} flexShrink={0}>
            <JobList
              jobs={visible}
              selectedIndex={state.selectedIndex}
              height={listHeight}
              width={listWidth}
              compact
            />
          </Box>
          <JobDetail job={selectedJob(state)} height={listHeight} />
        </Box>
      ) : (
        <JobList
          jobs={visible}
          selectedIndex={state.selectedIndex}
          height={listHeight}
          width={width}
        />
      )}
      <StatusBar
        mode={state.mode}
        message={state.message}
        warnings={state.warnings}
      />
    </Box>
  );
}
