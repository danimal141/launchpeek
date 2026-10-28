import wrapAnsi from "wrap-ansi";

export interface LogView {
  paused?: { lines: string[]; top: number };
}

export function logBodyRows(height: number, warningCount = 0): number {
  return Math.max(0, height - 2 - Math.min(3, warningCount));
}

export function logViewport(
  lines: string[],
  view: LogView,
  width: number,
  rows: number,
) {
  const source = view.paused?.lines ?? lines;
  const wrapped =
    width < 2
      ? []
      : source.flatMap((line) =>
          wrapAnsi(line, width, {
            hard: true,
            wordWrap: false,
            trim: false,
          }).split("\n"),
        );
  const count = Math.max(0, rows);
  const lastTop = Math.max(0, wrapped.length - count);
  const top = Math.min(view.paused?.top ?? lastTop, lastTop);
  return { top, total: wrapped.length, lines: wrapped.slice(top, top + count) };
}

export function scrollLog(
  lines: string[],
  view: LogView,
  width: number,
  rows: number,
  movement: number | "first",
): LogView {
  const viewport = logViewport(lines, view, width, rows);
  const lastTop = Math.max(0, viewport.total - Math.max(0, rows));
  const top =
    movement === "first"
      ? 0
      : Math.max(0, Math.min(lastTop, viewport.top + movement));
  return { paused: { lines: view.paused?.lines ?? lines, top } };
}
