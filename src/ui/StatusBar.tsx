import { Text } from "ink";
import type { Mode } from "../state";

const MODE_KEYS: Record<Mode, string> = {
  list: "j/k g/G:move  Enter:detail  l:logs  y:copy  r:kick  e/d:en/dis  u/U:out/strap  x:kill  /:filter  R:reload  q:quit",
  detail:
    "j/k:move  l:logs  y:copy  r:kick  e/d:en/dis  u/U:out/strap  x:kill  q/Esc:back",
  logs: "j/k:scroll  g/G:first/follow  q/Esc:back",
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
      <Text color="yellow" bold wrap="truncate-end">
        {confirmPrompt}
      </Text>
    );
  }
  if (message !== undefined) {
    return (
      <Text color="yellow" wrap="truncate-end">
        {message}
      </Text>
    );
  }
  return (
    <Text dimColor wrap="truncate-end">
      {MODE_KEYS[mode]}
      {warnings.length > 0 ? `  (${warnings.length} warnings)` : ""}
    </Text>
  );
}
