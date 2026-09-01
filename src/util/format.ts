import type { JobDefinition } from "../types";

export function truncatePad(value: string, width: number): string {
  if (value.length > width) {
    if (width <= 1) return value.slice(0, width);
    return `${value.slice(0, width - 1)}…`;
  }
  return value.padEnd(width);
}

// 既定の判断: 日時は MM-DD HH:mm のローカル時刻
export function formatTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function summarizeSchedule(def: JobDefinition): string {
  if (def.startInterval !== undefined) {
    return `every ${def.startInterval}s`;
  }
  const intervals = def.startCalendarInterval;
  if (intervals !== undefined && intervals.length > 0) {
    const parts = intervals.map((ci) => {
      const fields: string[] = [];
      if (ci.month !== undefined) fields.push(`mon=${ci.month}`);
      if (ci.day !== undefined) fields.push(`day=${ci.day}`);
      if (ci.weekday !== undefined) fields.push(`wd=${ci.weekday}`);
      if (ci.hour !== undefined) fields.push(`h=${ci.hour}`);
      if (ci.minute !== undefined) fields.push(`m=${ci.minute}`);
      return fields.length > 0 ? fields.join(" ") : "*";
    });
    return `cal ${parts.join(" | ")}`;
  }
  if (def.keepAlive) return "keepalive";
  return "";
}
