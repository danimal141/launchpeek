import { Box, Text } from "ink";
import type { Job } from "../types";

interface Props {
  job?: Job;
  lines: string[];
  height: number;
}

export function LogTail({ job, lines, height }: Props) {
  const paths = [job?.stdoutPath, job?.stderrPath]
    .filter((p): p is string => p !== undefined)
    .join("  ");
  const bodyHeight = Math.max(1, height - 1);
  const shown = lines.slice(-bodyHeight);
  return (
    <Box flexDirection="column" height={height}>
      <Text bold color="cyan" wrap="truncate-end">
        {job?.label ?? "-"} <Text dimColor>{paths || "(no log files)"}</Text>
      </Text>
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
