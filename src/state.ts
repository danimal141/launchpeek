import type { ActionKind, Job } from "./types";

export type Mode = "list" | "detail" | "logs";

export interface AppState {
  jobs: Job[];
  warnings: string[];
  selectedIndex: number;
  mode: Mode;
  filter: string;
  filterEditing: boolean;
  message?: string;
  pendingConfirm?: { kind: ActionKind; job: Job };
  logLines: string[];
  lastUpdated?: Date;
  loading: boolean;
  // logs モードは list と detail の両方から入れるため、戻り先を覚えておく
  logsReturnMode: "list" | "detail";
}

export const initialState: AppState = {
  jobs: [],
  warnings: [],
  selectedIndex: 0,
  mode: "list",
  filter: "",
  filterEditing: false,
  logLines: [],
  loading: true,
  logsReturnMode: "list",
};

export type Action =
  | { type: "jobs-updated"; jobs: Job[]; warnings: string[]; at: Date }
  | { type: "move-selection"; delta: number }
  | { type: "select-first" }
  | { type: "select-last" }
  | { type: "set-mode"; mode: Mode }
  | { type: "open-logs" }
  | { type: "close-logs" }
  | { type: "log-lines"; lines: string[] }
  | { type: "set-message"; message: string }
  | { type: "clear-message" }
  | { type: "confirm-request"; kind: ActionKind; job: Job }
  | { type: "confirm-clear" }
  | { type: "filter-editing"; editing: boolean }
  // 複数キーが 1 チャンクで届いたとき stale な filter 値で上書きしないよう、
  // 編集は reducer 内で完結する相対操作にする
  | { type: "filter-append"; char: string }
  | { type: "filter-backspace" }
  | { type: "filter-clear" }
  | { type: "set-loading"; loading: boolean };

export function visibleJobs(state: AppState): Job[] {
  if (state.filter === "") return state.jobs;
  const needle = state.filter.toLowerCase();
  return state.jobs.filter((job) => job.label.toLowerCase().includes(needle));
}

export function selectedJob(state: AppState): Job | undefined {
  return visibleJobs(state)[state.selectedIndex];
}

// フィルタで表示が変わっても選択中の label を追従させる
function withFilter(state: AppState, filter: string): AppState {
  const prevLabel = selectedJob(state)?.label;
  const next: AppState = { ...state, filter };
  const visible = visibleJobs(next);
  const followed = visible.findIndex((job) => job.label === prevLabel);
  next.selectedIndex = followed >= 0 ? followed : 0;
  return next;
}

function clampIndex(index: number, length: number): number {
  if (length === 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "jobs-updated": {
      // 再取得のたびに順序が変わりうるため、選択は index ではなく label で追従する
      const prevLabel = selectedJob(state)?.label;
      const next: AppState = {
        ...state,
        jobs: action.jobs,
        warnings: action.warnings,
        lastUpdated: action.at,
        loading: false,
      };
      const visible = visibleJobs(next);
      const followed = visible.findIndex((job) => job.label === prevLabel);
      next.selectedIndex =
        followed >= 0
          ? followed
          : clampIndex(state.selectedIndex, visible.length);
      return next;
    }
    case "move-selection": {
      const visible = visibleJobs(state);
      return {
        ...state,
        selectedIndex: clampIndex(
          state.selectedIndex + action.delta,
          visible.length,
        ),
      };
    }
    case "set-mode":
      return { ...state, mode: action.mode };
    case "open-logs":
      if (state.mode === "logs") return state;
      return {
        ...state,
        mode: "logs",
        logsReturnMode: state.mode,
        logLines: [],
      };
    case "close-logs":
      return { ...state, mode: state.logsReturnMode, logLines: [] };
    case "log-lines":
      return { ...state, logLines: action.lines };
    case "set-message":
      return { ...state, message: action.message };
    case "clear-message":
      return { ...state, message: undefined };
    case "confirm-request":
      return { ...state, pendingConfirm: { kind: action.kind, job: action.job } };
    case "confirm-clear":
      return { ...state, pendingConfirm: undefined };
    case "filter-editing":
      return { ...state, filterEditing: action.editing };
    case "filter-append":
      return withFilter(state, state.filter + action.char);
    case "filter-backspace":
      return withFilter(state, state.filter.slice(0, -1));
    case "filter-clear":
      return withFilter(state, "");
    case "set-loading":
      return { ...state, loading: action.loading };
    case "select-first":
      return { ...state, selectedIndex: 0 };
    case "select-last": {
      const visible = visibleJobs(state);
      return { ...state, selectedIndex: clampIndex(visible.length - 1, visible.length) };
    }
  }
}
