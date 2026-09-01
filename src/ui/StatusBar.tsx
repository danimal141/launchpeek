import { Text } from "ink";
import type { Mode } from "../state";

const MODE_KEYS: Record<Mode, string> = {
  list: "j/k:move  g/G:top/bottom  Enter:detail  q:quit",
  detail: "j/k:move  q/Esc:back",
  logs: "q/Esc:back",
};

interface Props {
  mode: Mode;
  message?: string;
  confirmPrompt?: string;
  warnings: string[];
}

export function StatusBar({ mode, message, confirmPrompt, warnings }: Props) {
  if (confirmPrompt !== undefined) {
    return (
      <Text color="yellow" bold>
        {confirmPrompt}
      </Text>
    );
  }
  if (message !== undefined) {
    return <Text color="yellow">{message}</Text>;
  }
  return (
    <Text dimColor>
      {MODE_KEYS[mode]}
      {warnings.length > 0 ? `  (${warnings.length} warnings)` : ""}
    </Text>
  );
}
