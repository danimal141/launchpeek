import { describe, expect, test } from "bun:test";
import { nextRun } from "../src/core/schedule";
import type { CalendarInterval, JobDefinition } from "../src/types";

function def(
  overrides: Partial<Pick<JobDefinition, "startInterval" | "startCalendarInterval">>,
): JobDefinition {
  return {
    label: "test",
    plistPath: "/tmp/test.plist",
    domain: "user",
    arguments: [],
    keepAlive: false,
    runAtLoad: false,
    raw: {},
    ...overrides,
  };
}

function cal(ci: CalendarInterval | CalendarInterval[]): JobDefinition {
  return def({ startCalendarInterval: Array.isArray(ci) ? ci : [ci] });
}

// テストはローカルタイムゾーン前提で Date を組み立てる
const at = (
  y: number,
  mon: number,
  d: number,
  h = 0,
  min = 0,
  sec = 0,
): Date => new Date(y, mon - 1, d, h, min, sec);

describe("nextRun", () => {
  test("スケジュールが無ければ undefined", () => {
    expect(nextRun(def({}), at(2026, 9, 1))).toBeUndefined();
  });

  test("StartInterval は now + interval 秒の近似", () => {
    const now = at(2026, 9, 1, 12, 0, 30);
    expect(nextRun(def({ startInterval: 60 }), now)).toEqual(
      at(2026, 9, 1, 12, 1, 30),
    );
  });

  test("StartInterval は StartCalendarInterval より優先される", () => {
    const d = def({
      startInterval: 10,
      startCalendarInterval: [{ hour: 9 }],
    });
    const now = at(2026, 9, 1, 12, 0, 0);
    expect(nextRun(d, now)).toEqual(at(2026, 9, 1, 12, 0, 10));
  });

  describe("StartCalendarInterval", () => {
    test("同日の未来時刻", () => {
      const now = at(2026, 9, 1, 8, 0);
      expect(nextRun(cal({ hour: 9, minute: 30 }), now)).toEqual(
        at(2026, 9, 1, 9, 30),
      );
    });

    test("過ぎていれば翌日", () => {
      const now = at(2026, 9, 1, 10, 0);
      expect(nextRun(cal({ hour: 9, minute: 30 }), now)).toEqual(
        at(2026, 9, 2, 9, 30),
      );
    });

    test("now がちょうど一致する分ならそれを返す", () => {
      const now = at(2026, 9, 1, 9, 30, 0);
      expect(nextRun(cal({ hour: 9, minute: 30 }), now)).toEqual(now);
    });

    test("秒が進んでいれば同じ分は選ばない", () => {
      const now = at(2026, 9, 1, 9, 30, 1);
      expect(nextRun(cal({ hour: 9, minute: 30 }), now)).toEqual(
        at(2026, 9, 2, 9, 30),
      );
    });

    test("未指定フィールドはワイルドカード (minute のみ指定)", () => {
      const now = at(2026, 9, 1, 10, 20);
      expect(nextRun(cal({ minute: 15 }), now)).toEqual(at(2026, 9, 1, 11, 15));
    });

    test("hour のみ指定なら minute は 0 から", () => {
      const now = at(2026, 9, 1, 8, 30);
      expect(nextRun(cal({ hour: 10 }), now)).toEqual(at(2026, 9, 1, 10, 0));
    });

    // 2026-09-01 は火曜
    test("weekday 指定 (月曜 = 1)", () => {
      const now = at(2026, 9, 1, 12, 0);
      expect(nextRun(cal({ weekday: 1, hour: 11, minute: 15 }), now)).toEqual(
        at(2026, 9, 7, 11, 15),
      );
    });

    test("weekday は 0 と 7 をどちらも日曜として扱う", () => {
      const now = at(2026, 9, 1, 12, 0);
      const sunday = at(2026, 9, 6, 0, 0);
      expect(nextRun(cal({ weekday: 0, hour: 0, minute: 0 }), now)).toEqual(sunday);
      expect(nextRun(cal({ weekday: 7, hour: 0, minute: 0 }), now)).toEqual(sunday);
    });

    test("day 指定で月をまたぐ", () => {
      const now = at(2026, 9, 15, 0, 0);
      expect(nextRun(cal({ day: 1, hour: 0, minute: 0 }), now)).toEqual(
        at(2026, 10, 1, 0, 0),
      );
    });

    test("day=31 は 31 日がある月まで飛ぶ", () => {
      // 9 月は 30 日までなので 10-31 になる
      const now = at(2026, 9, 1, 0, 0);
      expect(nextRun(cal({ day: 31, hour: 0, minute: 0 }), now)).toEqual(
        at(2026, 10, 31, 0, 0),
      );
    });

    test("month 指定で年をまたぐ", () => {
      const now = at(2026, 9, 1, 0, 0);
      expect(
        nextRun(cal({ month: 2, day: 1, hour: 0, minute: 0 }), now),
      ).toEqual(at(2027, 2, 1, 0, 0));
    });

    test("うるう日 (2/29) を見つけられる", () => {
      // 2028 年はうるう年。2027-03-01 から 366 日以内に 2028-02-29 がある
      const now = at(2027, 3, 1, 0, 0);
      expect(
        nextRun(cal({ month: 2, day: 29, hour: 0, minute: 0 }), now),
      ).toEqual(at(2028, 2, 29, 0, 0));
    });

    test("366 日以内に一致しなければ undefined", () => {
      // 平年始まりだと 2/29 は 366 日以内に存在しない
      const now = at(2026, 3, 1, 0, 0);
      expect(
        nextRun(cal({ month: 2, day: 29, hour: 0, minute: 0 }), now),
      ).toBeUndefined();
      // 範囲外の値も無限ループせず undefined
      expect(nextRun(cal({ minute: 99 }), now)).toBeUndefined();
    });

    test("複数 interval は最も早いものを返す", () => {
      // 2026-09-01 (火) → 金曜 18:15 (9/4) の方が月曜 10:00 (9/7) より早い
      const now = at(2026, 9, 1, 12, 0);
      expect(
        nextRun(
          cal([
            { weekday: 1, hour: 10, minute: 0 },
            { weekday: 5, hour: 18, minute: 15 },
          ]),
          now,
        ),
      ).toEqual(at(2026, 9, 4, 18, 15));
    });
  });
});
