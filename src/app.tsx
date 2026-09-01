import { Text, useApp, useInput } from "ink";

export function App() {
  const { exit } = useApp();

  useInput((input) => {
    if (input === "q") {
      exit();
    }
  });

  return <Text>launchpeek (q to quit)</Text>;
}
