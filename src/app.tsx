import { Box, useApp, useInput, useStdout } from "ink";
import { useEffect, useReducer } from "react";
import { fetchList } from "./core/launchctl";
import { jobFromListEntry } from "./core/merge";
import { initialState, reducer, visibleJobs } from "./state";
import { Header } from "./ui/Header";
import { JobList } from "./ui/JobList";
import { StatusBar } from "./ui/StatusBar";

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const entries = await fetchList();
        if (cancelled) return;
        dispatch({
          type: "jobs-updated",
          jobs: entries.map(jobFromListEntry),
          warnings: [],
          at: new Date(),
        });
      } catch (err) {
        if (cancelled) return;
        dispatch({
          type: "jobs-updated",
          jobs: [],
          warnings: [String(err)],
          at: new Date(),
        });
      }
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
