export type ConsoleLineType = "info" | "warn" | "error" | "join" | "leave";

export type ConsoleEntry = {
  id: string;
  text: string;
  type: ConsoleLineType;
  timestamp: number;
};

export type PlayerEvent = {
  type: "join" | "leave";
  name: string;
};

export type ConsoleParseResult = {
  entry: ConsoleEntry;
  playerEvent?: PlayerEvent;
  playerList?: string[];
};

const JOIN_REGEX = /^(.+?) joined the game/i;
const LEAVE_REGEX = /^(.+?) left the game/i;
const LIST_REGEX = /players online: (.*)$/i;

function normalizeLine(raw: string) {
  return raw.replace(/^\[[^\]]+\]\s*/g, "").trim();
}

function detectType(line: string): ConsoleLineType {
  if (JOIN_REGEX.test(line)) return "join";
  if (LEAVE_REGEX.test(line)) return "leave";
  if (/\bERROR\b|\bSEVERE\b|Exception/i.test(line)) return "error";
  if (/\bWARN\b|WARNING/i.test(line)) return "warn";
  return "info";
}

function parsePlayerList(line: string) {
  const match = line.match(LIST_REGEX);
  if (!match) return null;
  const names = match[1]
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  return names.length > 0 ? names : [];
}

export function parseConsoleLine(raw: string): ConsoleParseResult {
  const text = normalizeLine(raw);
  const type = detectType(text);
  const entry: ConsoleEntry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    text,
    type,
    timestamp: Date.now()
  };

  const joinMatch = text.match(JOIN_REGEX);
  if (joinMatch) {
    return {
      entry,
      playerEvent: { type: "join", name: joinMatch[1].trim() }
    };
  }

  const leaveMatch = text.match(LEAVE_REGEX);
  if (leaveMatch) {
    return {
      entry,
      playerEvent: { type: "leave", name: leaveMatch[1].trim() }
    };
  }

  const playerList = parsePlayerList(text);
  if (playerList !== null) {
    return { entry, playerList };
  }

  return { entry };
}
