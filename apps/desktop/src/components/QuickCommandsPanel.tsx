import { useMemo, useState } from "react";
import { SubtleButton } from "./ui/Buttons";
import { classNames } from "../utils/classNames";

const GAMEMODE_OPTIONS = ["survival", "creative", "adventure", "spectator"] as const;

export function QuickCommandsPanel({
  players,
  onSendCommand
}: {
  players: string[];
  onSendCommand: (command: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [playerInput, setPlayerInput] = useState("");
  const [gamemode, setGamemode] = useState<(typeof GAMEMODE_OPTIONS)[number]>("survival");

  const playerOptions = useMemo(() => players.filter(Boolean), [players]);

  const target = playerInput.trim();

  const run = (command: string) => onSendCommand(command);
  const runWithPlayer = (prefix: string) => {
    if (!target) return;
    onSendCommand(`${prefix} ${target}`);
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <button
        className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-[0.2em] text-muted"
        onClick={() => setOpen((prev) => !prev)}
        type="button"
      >
        Quick commands
        <span className={classNames("text-xs transition", open ? "rotate-180" : "")}>▾</span>
      </button>
      {open && (
        <div className="mt-3 grid gap-3">
          <div className="flex flex-wrap gap-2">
            <SubtleButton onClick={() => run("save-all")}>Save all</SubtleButton>
            <SubtleButton onClick={() => run("list")}>List players</SubtleButton>
            <SubtleButton onClick={() => run("time set day")}>Day</SubtleButton>
            <SubtleButton onClick={() => run("time set night")}>Night</SubtleButton>
            <SubtleButton onClick={() => run("weather clear")}>Clear weather</SubtleButton>
          </div>

          <div className="grid gap-2">
            <label className="text-xs uppercase tracking-[0.2em] text-muted">Player target</label>
            <input
              value={playerInput}
              onChange={(event) => setPlayerInput(event.target.value)}
              placeholder="Player name"
              list="console-player-list"
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-text transition focus:border-one/60 focus:outline-none"
            />
            <datalist id="console-player-list">
              {playerOptions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>

          <div className="flex flex-wrap gap-2">
            <SubtleButton onClick={() => runWithPlayer("whitelist add")}>Whitelist add</SubtleButton>
            <SubtleButton onClick={() => runWithPlayer("kick")}>Kick player</SubtleButton>
            <SubtleButton onClick={() => runWithPlayer("op")}>Op player</SubtleButton>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={gamemode}
              onChange={(event) => setGamemode(event.target.value as typeof gamemode)}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-text transition focus:border-one/60 focus:outline-none"
            >
              {GAMEMODE_OPTIONS.map((mode) => (
                <option key={mode} value={mode} className="bg-surface text-text">
                  {mode}
                </option>
              ))}
            </select>
            <SubtleButton onClick={() => (target ? run(`gamemode ${gamemode} ${target}`) : undefined)}>
              Set gamemode
            </SubtleButton>
          </div>
        </div>
      )}
    </div>
  );
}
