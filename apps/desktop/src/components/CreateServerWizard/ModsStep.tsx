import type { ModsImportMode, ModsValidationResult } from "../../types";
import { classNames } from "../../utils/classNames";
import { PrimaryButton, SubtleButton } from "../ui/Buttons";

export function ModsStep({
  mode,
  sourcePath,
  validation,
  error,
  busy,
  onModeChange,
  onPickFolder,
  onPickZip,
  onClear
}: {
  mode: ModsImportMode;
  sourcePath: string | null;
  validation: ModsValidationResult | null;
  error: string | null;
  busy: boolean;
  onModeChange: (next: ModsImportMode) => void;
  onPickFolder: () => void;
  onPickZip: () => void;
  onClear: () => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="text-xs uppercase tracking-[0.2em] text-muted">Mods</label>
        {validation?.valid && (
          <span className="rounded-full bg-secondary/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-secondary">
            Mods ready
          </span>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <button
          type="button"
          className={classNames(
            "rounded-2xl border border-white/10 px-4 py-3 text-left text-sm transition",
            mode === "skip"
              ? "border-one/40 bg-one/15 text-text"
              : "bg-white/5 text-muted hover:bg-white/10"
          )}
          onClick={() => onModeChange("skip")}
        >
          <p className="text-sm font-semibold text-text">Skip for now</p>
          <p className="text-xs text-muted">I will import mods later.</p>
        </button>
        <button
          type="button"
          className={classNames(
            "rounded-2xl border border-white/10 px-4 py-3 text-left text-sm transition",
            mode === "zip"
              ? "border-one/40 bg-one/15 text-text"
              : "bg-white/5 text-muted hover:bg-white/10"
          )}
          onClick={() => onModeChange("zip")}
        >
          <p className="text-sm font-semibold text-text">Import modpack (.zip)</p>
          <p className="text-xs text-muted">Modrinth or CurseForge packs.</p>
        </button>
        <button
          type="button"
          className={classNames(
            "rounded-2xl border border-white/10 px-4 py-3 text-left text-sm transition",
            mode === "folder"
              ? "border-one/40 bg-one/15 text-text"
              : "bg-white/5 text-muted hover:bg-white/10"
          )}
          onClick={() => onModeChange("folder")}
        >
          <p className="text-sm font-semibold text-text">Use mods folder</p>
          <p className="text-xs text-muted">Pick a mods folder or modpack folder.</p>
        </button>
      </div>

      {mode !== "skip" && (
        <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
          <p className="text-xs text-muted">Choose mods now to reduce setup later.</p>
          <div className="flex flex-wrap items-center gap-2">
            {mode === "zip" ? (
              <PrimaryButton onClick={onPickZip} disabled={busy}>
                Select modpack zip
              </PrimaryButton>
            ) : (
              <PrimaryButton onClick={onPickFolder} disabled={busy}>
                Select mods folder
              </PrimaryButton>
            )}
            {sourcePath && (
              <SubtleButton onClick={onClear} disabled={busy}>
                Clear
              </SubtleButton>
            )}
          </div>

          {sourcePath && (
            <p className="text-xs text-muted break-all">{sourcePath}</p>
          )}
          {busy && <p className="text-xs text-muted">Validating mods...</p>}

          {validation?.valid && (
            <div className="grid gap-2 text-xs text-muted">
              <p>Mods detected: {validation.mod_count}</p>
              {validation.detected_pack && (
                <p>Detected pack: {validation.detected_pack === "modrinth" ? "Modrinth" : "CurseForge"}</p>
              )}
            </div>
          )}

          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
