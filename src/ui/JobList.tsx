import { Box, Text } from "ink";
import type { Job, JobCategory } from "../types";
import { formatTime, summarizeSchedule, truncatePad } from "../util/format";

const CATEGORY_COLORS: Record<JobCategory, string> = {
  busy: "green",
  failed: "red",
  disabled: "gray",
  scheduled: "cyan",
  idle: "white",
};

interface Props {
  jobs: Job[];
  selectedIndex: number;
  height: number;
  width: number;
  // detail モードで左に縮小表示するとき true。category と label だけ出す
  compact?: boolean;
}

const CATEGORY_W = 10;
const PID_W = 6;
const EXIT_W = 5;
const NEXT_RUN_W = 12;
const SCHEDULE_W = 20;

export function JobList({ jobs, selectedIndex, height, width, compact }: Props) {
  // 既定の判断: 端末幅 80 未満では next run と schedule の列を省く
  const wide = !compact && width >= 80;
  const fixed = compact
    ? CATEGORY_W
    : CATEGORY_W + PID_W + EXIT_W + (wide ? NEXT_RUN_W + SCHEDULE_W : 0);
  const labelWidth = Math.max(10, width - fixed - 5);

  // 選択行が常に見えるようにスクロール位置を決める
  const rowCount = Math.max(1, height - 1);
  const offset = Math.min(
    Math.max(0, selectedIndex - rowCount + 1),
    Math.max(0, jobs.length - rowCount),
  );
  const windowJobs = jobs.slice(offset, offset + rowCount);

  return (
    <Box flexDirection="column" height={height}>
      <Text dimColor>
        {truncatePad("CATEGORY", CATEGORY_W)} {truncatePad("LABEL", labelWidth)}
        {compact
          ? ""
          : ` ${truncatePad("PID", PID_W)} ${truncatePad("EXIT", EXIT_W)}`}
        {wide
          ? ` ${truncatePad("NEXT RUN", NEXT_RUN_W)} ${truncatePad("SCHEDULE", SCHEDULE_W)}`
          : ""}
      </Text>
      {jobs.length === 0 ? (
        <Text dimColor>no jobs</Text>
      ) : (
        windowJobs.map((job, i) => {
          const selected = offset + i === selectedIndex;
          const cells = [
            truncatePad(job.category, CATEGORY_W),
            truncatePad(job.label, labelWidth),
          ];
          if (!compact) {
            cells.push(
              truncatePad(job.runtime.pid?.toString() ?? "-", PID_W),
              truncatePad(job.runtime.lastExitCode?.toString() ?? "-", EXIT_W),
            );
          }
          if (wide) {
            cells.push(
              truncatePad(job.nextRun ? formatTime(job.nextRun) : "-", NEXT_RUN_W),
              truncatePad(summarizeSchedule(job), SCHEDULE_W),
            );
          }
          return (
            <Text
              key={job.label}
              color={CATEGORY_COLORS[job.category]}
              inverse={selected}
            >
              {cells.join(" ")}
            </Text>
          );
        })
      )}
    </Box>
  );
}
