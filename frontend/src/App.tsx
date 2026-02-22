import { useSessionStore } from "@/stores/session-store";
import { SetupScreen } from "@/screens/SetupScreen";
import { SessionScreen } from "@/screens/SessionScreen";
import { ContractsScreen } from "@/screens/ContractsScreen";

export function App() {
  const status = useSessionStore((s) => s.status);

  if (status === "contracts") {
    return <ContractsScreen />;
  }

  if (status === "setup") {
    return <SetupScreen />;
  }

  return <SessionScreen />;
}
