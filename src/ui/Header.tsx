import { Box, Text } from "ink";
import { formatTime } from "../util/format";

interface Props {
  jobCount: number;
  visibleCount: number;
  filter: string;
  lastUpdated?: Date;
  loading: boolean;
}

export function Header({
  jobCount,
  visibleCount,
  filter,
  lastUpdated,
  loading,
}: Props) {
  return (
    <Box justifyContent="space-between">
      <Text bold color="magenta">
        launchpeek{" "}
        <Text bold={false} color="white">
          {filter === ""
            ? `${jobCount} jobs`
            : `${visibleCount}/${jobCount} jobs (filter: ${filter})`}
        </Text>
      </Text>
      <Text dimColor>
        {loading ? "loading… " : ""}
        {lastUpdated ? `updated ${formatTime(lastUpdated)}` : ""}
      </Text>
    </Box>
  );
}
