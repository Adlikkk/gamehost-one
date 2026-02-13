import { useRef } from "react";

export function useConsoleHistory() {
  const historyRef = useRef<string[]>([]);
  const indexRef = useRef(-1);
  const draftRef = useRef("");

  const record = (command: string) => {
    const trimmed = command.trim();
    if (!trimmed) return;
    historyRef.current.push(trimmed);
    indexRef.current = -1;
    draftRef.current = "";
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    currentValue: string,
    onChange: (value: string) => void
  ) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();

    const history = historyRef.current;
    if (history.length === 0) return;

    if (indexRef.current === -1) {
      draftRef.current = currentValue;
    }

    if (event.key === "ArrowUp") {
      indexRef.current = Math.min(history.length - 1, indexRef.current + 1);
    } else {
      indexRef.current = Math.max(-1, indexRef.current - 1);
    }

    if (indexRef.current === -1) {
      onChange(draftRef.current);
      return;
    }

    const next = history[history.length - 1 - indexRef.current];
    onChange(next ?? "");
  };

  return { record, handleKeyDown };
}
