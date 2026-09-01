import { Box, Text } from "ink";
import type { Job } from "../types";
import { formatTime, summarizeSchedule } from "../util/format";

interface Props {
  job?: Job;
  height: number;
}

function Row({ name, value }: { name: string; value: string }) {
  return (
    <Box>
      <Box width={14} flexShrink={0}>
        <Text dimColor>{name}</Text>
      </Box>
      <Text wrap="truncate-end">{value}</Text>
    </Box>
  );
}

export function JobDetail({ job, height }: Props) {
  if (!job) {
    return (
      <Box height={height} paddingLeft={1}>
        <Text dimColor>no job selected</Text>
      </Box>
    );
  }
  const rt = job.runtime;
  return (
    <Box
      flexDirection="column"
      height={height}
      paddingLeft={1}
      borderStyle="single"
      borderColor="gray"
    >
      <Text bold color="cyan" wrap="truncate-end">
        {job.label}
      </Text>
      <Row name="plist" value={job.plistPath || "-"} />
      <Row name="program" value={job.program ?? "-"} />
      <Row
        name="arguments"
        value={job.arguments.length > 0 ? job.arguments.join(" ") : "-"}
      />
      <Row name="schedule" value={summarizeSchedule(job) || "-"} />
      <Row
        name="keepAlive"
        value={`${job.keepAlive}  runAtLoad: ${job.runAtLoad}`}
      />
      <Row name="stdout" value={job.stdoutPath ?? "-"} />
      <Row name="stderr" value={job.stderrPath ?? "-"} />
      <Row name="pid" value={rt.pid?.toString() ?? "-"} />
      <Row
        name="state"
        value={`${rt.state}${rt.loaded ? "" : " (not loaded)"}${rt.enabled ? "" : " (disabled)"}`}
      />
      <Row name="last exit" value={rt.lastExitCode?.toString() ?? "-"} />
      <Row name="run count" value={rt.runCount?.toString() ?? "-"} />
      <Row name="next run" value={job.nextRun ? formatTime(job.nextRun) : "-"} />
    </Box>
  );
}
