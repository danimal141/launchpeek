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
import { initialState, reducer, visibleJobs } from "./state";
import { Header } from "./ui/Header";
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
      dispatch({
        type: "jobs-updated",
        jobs: mergeJobs(definitions, sources),
        warnings,
        at: new Date(),
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
      exit();
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
    }
  });

  // pty によっては columns/rows が 0 になるため ?? ではなく || で補正する
  const width = stdout.columns || 80;
  const height = stdout.rows || 24;
  const listHeight = Math.max(3, height - 2);
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
      <JobList
        jobs={visible}
        selectedIndex={state.selectedIndex}
        height={listHeight}
        width={width}
      />
      <StatusBar
        mode={state.mode}
        message={state.message}
        warnings={state.warnings}
      />
    </Box>
  );
}
