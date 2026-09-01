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
};

export type Action =
  | { type: "jobs-updated"; jobs: Job[]; warnings: string[]; at: Date }
  | { type: "move-selection"; delta: number }
  | { type: "select-first" }
  | { type: "select-last" };

export function visibleJobs(state: AppState): Job[] {
  if (state.filter === "") return state.jobs;
  const needle = state.filter.toLowerCase();
  return state.jobs.filter((job) => job.label.toLowerCase().includes(needle));
}

export function selectedJob(state: AppState): Job | undefined {
  return visibleJobs(state)[state.selectedIndex];
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
    case "select-first":
      return { ...state, selectedIndex: 0 };
    case "select-last": {
      const visible = visibleJobs(state);
      return { ...state, selectedIndex: clampIndex(visible.length - 1, visible.length) };
    }
  }
}
