import type { CalendarInterval, JobDefinition } from "../types";

// 探索上限は 366 日 (SPEC)
const SEARCH_LIMIT_MS = 366 * 24 * 60 * 60 * 1000;
// 各分岐で最低 1 分は前進するので無限ループはしないが、念のためのガード
const MAX_ITERATIONS = 500000;

function matchesMonth(ci: CalendarInterval, t: Date): boolean {
  // plist の Month は 1-12、JS の getMonth は 0-11
  return ci.month === undefined || ci.month === t.getMonth() + 1;
}

function matchesDay(ci: CalendarInterval, t: Date): boolean {
  const dayOk = ci.day === undefined || ci.day === t.getDate();
  // weekday は 0 と 7 を日曜として扱う (SPEC)
  const weekdayOk =
    ci.weekday === undefined || ci.weekday % 7 === t.getDay();
  return dayOk && weekdayOk;
}

// now 以降で最初に ci を満たす時刻を分単位で探索する。
// ミスマッチした単位ごとにまとめて進めるので、実際の反復回数は高々数百
function nextCalendarRun(ci: CalendarInterval, now: Date): Date | undefined {
  const t = new Date(now);
  t.setSeconds(0, 0);
  if (t.getTime() < now.getTime()) {
    t.setMinutes(t.getMinutes() + 1);
  }
  const limit = now.getTime() + SEARCH_LIMIT_MS;

  for (let i = 0; i < MAX_ITERATIONS && t.getTime() <= limit; i++) {
    if (!matchesMonth(ci, t)) {
      t.setMonth(t.getMonth() + 1, 1);
      t.setHours(0, 0, 0, 0);
    } else if (!matchesDay(ci, t)) {
      t.setDate(t.getDate() + 1);
      t.setHours(0, 0, 0, 0);
    } else if (ci.hour !== undefined && ci.hour !== t.getHours()) {
      t.setHours(t.getHours() + 1, 0, 0, 0);
    } else if (ci.minute !== undefined && ci.minute !== t.getMinutes()) {
      t.setMinutes(t.getMinutes() + 1, 0, 0);
    } else {
      return t;
    }
  }
  // 366 日以内に一致しない (day=31 と month=2 の組み合わせ等) は実行予定なし
  return undefined;
}

export function nextRun(def: JobDefinition, now: Date): Date | undefined {
  if (def.startInterval !== undefined) {
    // 直近の実行時刻は launchd から取れないため now + interval の近似 (README に明記)
    return new Date(now.getTime() + def.startInterval * 1000);
  }
  const intervals = def.startCalendarInterval;
  if (intervals !== undefined && intervals.length > 0) {
    let earliest: Date | undefined;
    for (const ci of intervals) {
      const candidate = nextCalendarRun(ci, now);
      if (candidate !== undefined && (earliest === undefined || candidate < earliest)) {
        earliest = candidate;
      }
    }
    return earliest;
  }
  return undefined;
}
