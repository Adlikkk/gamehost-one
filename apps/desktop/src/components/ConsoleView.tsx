import { useEffect, useMemo, useRef, useState } from "react";
import { PrimaryButton, SubtleButton } from "./ui/Buttons";
import { classNames } from "../utils/classNames";
import type { ConsoleEntry, ConsoleLineType } from "../services/consoleParser";
import { QuickCommandsPanel } from "./QuickCommandsPanel";
import { useConsoleHistory } from "../hooks/useConsoleHistory";

const COMMANDS = [
  "save-all",
  "list",
  "stop",
  "whitelist add",
  "whitelist remove",
  "kick",
  "op",
  "deop",
  "gamemode survival",
  "gamemode creative",
  "gamemode spectator",
  "time set day",
  "difficulty normal",
  "say"
];

const ROW_HEIGHT = 20;
const BUFFER = 20;

type FilterMode = "all" | "warn" | "error";

const toneByType: Record<ConsoleLineType, string> = {
  info: "text-muted",
  warn: "text-amber-200",
  error: "text-danger",
  join: "text-secondary",
  leave: "text-orange-200"
};

export function ConsoleView({
  entries,
  players,
  onSendCommand
}: {
  entries: ConsoleEntry[];
  players: string[];
  onSendCommand: (command: string) => void;
}) {
  const [input, setInput] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { record, handleKeyDown } = useConsoleHistory();

  const filtered = useMemo(() => {
    if (filter === "all") return entries;
    if (filter === "warn") return entries.filter((entry) => entry.type === "warn");
    return entries.filter((entry) => entry.type === "error");
  }, [entries, filter]);

  const totalHeight = filtered.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
  const endIndex = Math.min(filtered.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + BUFFER);
  const slice = filtered.slice(startIndex, endIndex);
  const topPadding = startIndex * ROW_HEIGHT;
  const bottomPadding = totalHeight - endIndex * ROW_HEIGHT;

  const suggestions = useMemo(() => {
    const value = input.trim();
    if (!value) return [];
    return COMMANDS.filter((command) => command.startsWith(value)).slice(0, 4);
  }, [input]);

  const helperText = input.trim().startsWith("whitelist ") ? "whitelist add <player>" : null;

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    observer.observe(el);
    setViewportHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!autoScroll || !containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [filtered.length, autoScroll]);

  const handleSend = () => {
    if (!input.trim()) return;
    onSendCommand(input.trim());
    record(input.trim());
    setInput("");
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSend();
      return;
    }
    if (event.key === "Tab") {
      if (suggestions.length > 0) {
        event.preventDefault();
        setInput(suggestions[0]);
      }
      return;
    }
    handleKeyDown(event, input, setInput);
  };

  const handleScroll = () => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    setScrollTop(el.scrollTop);
    const atBottom = el.scrollHeight - (el.scrollTop + el.clientHeight) < 20;
    setAutoScroll(atBottom);
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {([
            { value: "all", label: "Show all" },
            { value: "warn", label: "Warnings" },
            { value: "error", label: "Errors" }
          ] as const).map((option) => (
            <SubtleButton
              key={option.value}
              onClick={() => setFilter(option.value)}
              className={filter === option.value ? "bg-one/20 text-one ring-1 ring-one/40" : ""}
            >
              {option.label}
            </SubtleButton>
          ))}
        </div>
        <SubtleButton onClick={() => setAutoScroll((prev) => !prev)}>
          {autoScroll ? "Auto-scroll on" : "Auto-scroll off"}
        </SubtleButton>
      </div>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-72 overflow-y-auto rounded-2xl border border-white/10 bg-black/40 p-4 text-xs"
      >
        {filtered.length === 0 ? (
          <p className="text-muted">Server output will appear here.</p>
        ) : (
          <div style={{ height: totalHeight, position: "relative" }}>
            <div style={{ transform: `translateY(${topPadding}px)` }}>
              {slice.map((entry) => (
                <div
                  key={entry.id}
                  className={classNames("leading-5", toneByType[entry.type])}
                  style={{ height: ROW_HEIGHT }}
                >
                  {entry.text}
                </div>
              ))}
            </div>
            {bottomPadding > 0 && <div style={{ height: bottomPadding }} />}
          </div>
        )}
      </div>

      <QuickCommandsPanel players={players} onSendCommand={onSendCommand} />

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-3 md:flex-row">
          <input
            className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text transition focus:border-one/60 focus:outline-none"
            placeholder="Send a command to the server"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
          <PrimaryButton onClick={handleSend}>Send</PrimaryButton>
        </div>
        {helperText && <p className="text-xs text-muted">{helperText}</p>}
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setInput(suggestion)}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-muted transition hover:border-one/40 hover:text-text"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
