import * as Select from "@radix-ui/react-select";
import * as Switch from "@radix-ui/react-switch";
import type { Difficulty, GameMode, ServerSettings } from "../types";
import { DIFFICULTY_OPTIONS, GAMEMODE_OPTIONS } from "../constants/serverOptions";
import { SettingRow } from "./ui/SettingRow";

export function ServerSettingsFields({
  settings,
  onChange,
  variant
}: {
  settings: ServerSettings;
  onChange: (next: ServerSettings) => void;
  variant: "basic" | "advanced" | "all";
}) {
  const update = (patch: Partial<ServerSettings>) => onChange({ ...settings, ...patch });

  return (
    <div className="grid gap-4">
      {(variant === "basic" || variant === "all") && (
        <>
          <SettingRow label="Difficulty" description="Choose how challenging mobs and survival will feel.">
            <Select.Root value={settings.difficulty} onValueChange={(value) => update({ difficulty: value as Difficulty })}>
              <Select.Trigger className="flex w-44 items-center justify-between rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs font-semibold text-text transition focus:border-one/60 focus:outline-none">
                <Select.Value />
                <Select.Icon className="text-muted">▾</Select.Icon>
              </Select.Trigger>
              <Select.Portal>
                <Select.Content className="select-content z-50 overflow-hidden rounded-2xl border border-white/10 shadow-soft">
                  <Select.Viewport className="bg-surface p-1">
                    {DIFFICULTY_OPTIONS.map((level) => (
                      <Select.Item
                        key={level}
                        value={level}
                        className="cursor-pointer rounded-xl px-3 py-2 text-sm text-text outline-none data-highlighted:bg-white/15 data-highlighted:text-white"
                      >
                        <Select.ItemText>{level}</Select.ItemText>
                      </Select.Item>
                    ))}
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
          </SettingRow>
          <SettingRow label="Game mode" description="Set the default mode for new players.">
            <Select.Root value={settings.gameMode} onValueChange={(value) => update({ gameMode: value as GameMode })}>
              <Select.Trigger className="flex w-44 items-center justify-between rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs font-semibold text-text transition focus:border-one/60 focus:outline-none">
                <Select.Value />
                <Select.Icon className="text-muted">▾</Select.Icon>
              </Select.Trigger>
              <Select.Portal>
                <Select.Content className="select-content z-50 overflow-hidden rounded-2xl border border-white/10 shadow-soft">
                  <Select.Viewport className="bg-surface p-1">
                    {GAMEMODE_OPTIONS.map((mode) => (
                      <Select.Item
                        key={mode}
                        value={mode}
                        className="cursor-pointer rounded-xl px-3 py-2 text-sm text-text outline-none data-highlighted:bg-white/15 data-highlighted:text-white"
                      >
                        <Select.ItemText>{mode}</Select.ItemText>
                      </Select.Item>
                    ))}
                  </Select.Viewport>
                </Select.Content>
              </Select.Portal>
            </Select.Root>
          </SettingRow>
          <SettingRow label="PvP" description="Allow player-versus-player combat.">
            <Switch.Root
              checked={settings.pvp}
              onCheckedChange={(value) => update({ pvp: value })}
              className="relative h-6 w-11 rounded-full bg-white/15 transition data-[state=checked]:bg-one"
            >
              <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition data-[state=checked]:translate-x-5" />
            </Switch.Root>
          </SettingRow>
          <SettingRow label="Allow flight" description="Allow flying for jetpacks and creative-style mods.">
            <Switch.Root
              checked={settings.allowFlight}
              onCheckedChange={(value) => update({ allowFlight: value })}
              className="relative h-6 w-11 rounded-full bg-white/15 transition data-[state=checked]:bg-one"
            >
              <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition data-[state=checked]:translate-x-5" />
            </Switch.Root>
          </SettingRow>
          <SettingRow label="Max players" description="How many players can join at once.">
            <input
              type="number"
              min={1}
              max={200}
              value={settings.maxPlayers}
              onChange={(event) =>
                update({ maxPlayers: Math.max(1, Math.min(200, Number(event.target.value) || 1)) })
              }
              className="w-24 rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-text focus:border-one/60 focus:outline-none"
            />
          </SettingRow>
        </>
      )}

      {(variant === "advanced" || variant === "all") && (
        <>
          <SettingRow label="Required sleeping players" description="How many players must sleep to skip the night.">
            <input
              type="number"
              min={1}
              max={10}
              value={settings.sleepPlayers}
              onChange={(event) =>
                update({ sleepPlayers: Math.max(1, Math.min(10, Number(event.target.value) || 1)) })
              }
              className="w-20 rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-text focus:border-one/60 focus:outline-none"
            />
          </SettingRow>
          <SettingRow label="View distance" description="How far players can see chunks.">
            <input
              type="number"
              min={4}
              max={32}
              value={settings.viewDistance}
              onChange={(event) =>
                update({ viewDistance: Math.max(4, Math.min(32, Number(event.target.value) || 4)) })
              }
              className="w-20 rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-text focus:border-one/60 focus:outline-none"
            />
          </SettingRow>
        </>
      )}
    </div>
  );
}
