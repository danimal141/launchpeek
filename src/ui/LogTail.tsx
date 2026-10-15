import { Box, Text } from "ink";
import type { logViewport } from "../core/log-view";
import type { Job } from "../types";

interface Props {
  job?: Job;
  viewport: ReturnType<typeof logViewport>;
  paused: boolean;
  height: number;
}

export function LogTail({ job, viewport, paused, height }: Props) {
  const paths = [job?.stdoutPath, job?.stderrPath]
    .filter((p): p is string => p !== undefined)
    .join("  ");
  const shown = viewport.lines;
  const range = shown.length ? `${viewport.top + 1}-${viewport.top + shown.length}/${viewport.total}` : "0/0";
  const headers = [
    <Text key="job" bold color="cyan" wrap="truncate-end">
      {job?.label ?? "-"} <Text dimColor>{paths || "(no log files)"}</Text>
    </Text>,
    <Text key="position" wrap="truncate-end">
      {`${paused ? "PAUSED (G:follow)" : "FOLLOW"}  rows: ${range}`}
    </Text>,
  ];
  return (
    <Box flexDirection="column" height={Math.max(0, height)} overflow="hidden">
      {headers.slice(0, Math.max(0, height))}
      {shown.length === 0 ? (
        <Text dimColor>
          {job && paths === "" ? "no log files configured" : "no output yet"}
        </Text>
      ) : (
        shown.map((line, i) => (
          <Text
            // ログ行に安定した key は無いので index で十分
            key={i}
            wrap="truncate-end"
          >
            {line || " "}
          </Text>
        ))
      )}
    </Box>
  );
}
