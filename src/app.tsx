import { Box, useApp, useInput, useStdout } from "ink";
import { useEffect, useReducer } from "react";
import {
  fetchDisabledLabels,
  fetchList,
  fetchPrint,
  type ListEntry,
  type PrintInfo,
} from "./core/launchctl";
import { emptySources, mergeJobs, type RuntimeSources } from "./core/merge";
import { loadDefinitions } from "./core/plist";
import { initialState, reducer, selectedJob, visibleJobs } from "./state";
import { Header } from "./ui/Header";
import { JobDetail } from "./ui/JobDetail";
import { JobList } from "./ui/JobList";
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

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      // 一つ前のモードへ戻る。list で押した場合は終了 (SPEC)
      if (state.mode === "list") {
        exit();
      } else {
        dispatch({ type: "set-mode", mode: "list" });
      }
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
  });

  // pty によっては columns/rows が 0 になるため ?? ではなく || で補正する
  const width = stdout.columns || 80;
  const height = stdout.rows || 24;
  const listHeight = Math.max(3, height - 2);
  // detail モードでは左 4 割を縮小 JobList に使う
  const listWidth = Math.max(24, Math.floor(width * 0.4));
  const visible = visibleJobs(state);

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
