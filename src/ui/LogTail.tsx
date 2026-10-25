import { Box, Text } from "ink";
import type { Job } from "../types";

interface Props {
  job?: Job;
  lines: string[];
  height: number;
  extraPaths?: readonly string[];
  warnings?: readonly string[];
}

export function LogTail({ job, lines, height, extraPaths = [], warnings = [] }: Props) {
  const paths = [job?.stdoutPath, job?.stderrPath, ...extraPaths]
    .filter((p): p is string => p !== undefined)
    .join("  ");
  const shownWarnings = warnings.slice(0, Math.max(0, Math.min(3, height - 2)));
  const bodyHeight = Math.max(0, height - 1 - shownWarnings.length);
  const shown = bodyHeight > 0 ? lines.slice(-bodyHeight) : [];
  return (
    <Box flexDirection="column" height={height}>
      <Text bold color="cyan" wrap="truncate-end">
        {job?.label ?? "-"} <Text dimColor>{paths || "(no log files)"}</Text>
      </Text>
      {shownWarnings.map((warning, i) => (
        <Text key={i} color="red" wrap="truncate-end">{`config: ${warning}`}</Text>
      ))}
      {shown.length === 0 ? (
        <Text dimColor>
          {job && paths === "" ? "no log files configured" : "no output yet"}
        </Text>
      ) : (
        shown.map((line, i) => (
          <Text
            // ログ行に安定した key は無いので index で十分
            key={i}
            color={line.startsWith("[err]") ? "red" : undefined}
            wrap="truncate-end"
          >
            {line}
          </Text>
        ))
      )}
    </Box>
  );
}
