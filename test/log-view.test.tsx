import { expect, test } from "bun:test";
import { renderToString } from "ink";
import { logBodyRows, logViewport } from "../src/core/log-view";
import { initialState, reducer } from "../src/state";
import { LogTail } from "../src/ui/LogTail";

const lines = ["[out] first", "[out] second", "[err] third", "[err] fourth"];
const loaded = reducer(initialState, { type: "log-lines", lines });

test("複数ファイルの順序を維持し、折り返し後の最新行を表示する", () => {
  const viewport = logViewport(lines, {}, 80, 4);
  expect(viewport.lines).toEqual(lines);
  const long = logViewport(["a".repeat(80) + "END"], {}, 10, 2);
  expect(long.lines).toEqual(["aaaaaaaaaa", "END"]);
  expect(logViewport(["中古戸建=12"], {}, 6, 5).lines).toEqual(["中古戸", "建=12"]);
  expect(logViewport(["abc\tZ", ""], {}, 8, 5).lines).toEqual(["abc     ", "Z", ""]);
  const colored = logViewport(["\x1b[31mabcdef\x1b[39m"], {}, 3, 5).lines;
  expect(colored).toHaveLength(2);
  expect(colored[1]).toContain("def");
});

test("スクロール中の内容を追記・ローテーションでも固定し、Gで現在のログに戻す", () => {
  let state = reducer(loaded, { type: "log-scroll", movement: -1, width: 80, rows: 2 });
  expect(logViewport(state.logLines, state.logView, 80, 2).lines).toEqual(lines.slice(1, 3));
  for (const updated of [[...lines, "new"], ["rotated"]]) {
    state = reducer(state, { type: "log-lines", lines: updated });
    expect(logViewport(state.logLines, state.logView, 80, 2).lines).toEqual(lines.slice(1, 3));
  }
  state = reducer(state, { type: "log-follow" });
  expect(logViewport(state.logLines, state.logView, 80, 2).lines).toEqual(["rotated"]);
});

test("g・連続キー・画面の開閉・リサイズを扱う", () => {
  let state = reducer(loaded, { type: "log-scroll", movement: "first", width: 80, rows: 2 });
  expect(logViewport(state.logLines, state.logView, 80, 2).lines).toEqual(lines.slice(0, 2));
  for (let i = 0; i < 2; i++) state = reducer(state, { type: "log-scroll", movement: 1, width: 80, rows: 2 });
  expect(state.logView.paused?.top).toBe(2);
  for (const width of [1, 2, 8, 80]) {
    for (const rows of [0, 1, 4, 20]) expect(logViewport(state.logLines, state.logView, width, rows).lines.length).toBeLessThanOrEqual(rows);
  }
  state = reducer(state, { type: "open-logs" });
  expect(state.logView).toEqual({});
  state = reducer(state, { type: "close-logs" });
  expect(state.logLines).toEqual([]);
});

test("Inkでも複数ログの全文を描画でき、画面高を超えない", () => {
  for (const width of [40, 80, 120]) {
    for (const height of [1, 2, 8, 24]) {
      const viewport = logViewport(["[out] 日本語 ".repeat(10), "[err] END"], {}, width, logBodyRows(height));
      const output = renderToString(<LogTail viewport={viewport} paused={false} height={height} />, { columns: width });
      expect(output.split("\n").length).toBeLessThanOrEqual(height);
      if (height >= 8) expect(output).toContain("[err] END");
    }
  }
  const output = renderToString(<LogTail viewport={logViewport(lines, {}, 80, 10)} paused height={12} />);
  expect(output).toContain("PAUSED");
  expect(output).toContain("[out] first");
  expect(output).toContain("[err] fourth");
});
