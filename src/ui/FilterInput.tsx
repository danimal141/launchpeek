import { Text } from "ink";

export function FilterInput({ value }: { value: string }) {
  return (
    <Text>
      <Text color="yellow">/</Text>
      {value}
      <Text inverse> </Text>
      <Text dimColor>  (Enter:確定  Esc:解除)</Text>
    </Text>
  );
}
