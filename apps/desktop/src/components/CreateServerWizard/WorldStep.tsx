import type { WorldCopyProgress, WorldImportMode, WorldValidationResult } from "../../types";
import { classNames } from "../../utils/classNames";
import { PrimaryButton, SubtleButton } from "../ui/Buttons";

const ONE_GB = 1024 * 1024 * 1024;

export function WorldStep({
  mode,
  sourcePath,
  validation,
  error,
  busy,
  copyProgress,
  copyDone,
  onModeChange,
  onPickFolder,
  onPickZip,
  onClear
}: {
  mode: WorldImportMode;
  sourcePath: string | null;
  validation: WorldValidationResult | null;
  error: string | null;
  busy: boolean;
  copyProgress: WorldCopyProgress | null;
  copyDone: boolean;
  onModeChange: (next: WorldImportMode) => void;
  onPickFolder: () => void;
  onPickZip: () => void;
  onClear: () => void;
}) {
  const showProgress = Boolean(validation && validation.size_bytes >= ONE_GB && copyProgress);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="text-xs uppercase tracking-[0.2em] text-muted">World</label>
        <div className="flex flex-wrap items-center gap-2">
          {validation?.valid && (
            <span className="rounded-full bg-secondary/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-secondary">
              World validated
            </span>
          )}
          {copyDone && (
            <span className="rounded-full bg-one/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-one">
              Files copied
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          className={classNames(
            "rounded-2xl border border-white/10 px-4 py-3 text-left text-sm transition",
            mode === "generate"
              ? "border-one/40 bg-one/15 text-text"
              : "bg-white/5 text-muted hover:bg-white/10"
          )}
          onClick={() => onModeChange("generate")}
        >
          <p className="text-sm font-semibold text-text">Generate new world</p>
          <p className="text-xs text-muted">Start fresh with a new seed.</p>
        </button>
        <button
          type="button"
          className={classNames(
            "rounded-2xl border border-white/10 px-4 py-3 text-left text-sm transition",
            mode === "import"
              ? "border-one/40 bg-one/15 text-text"
              : "bg-white/5 text-muted hover:bg-white/10"
          )}
          onClick={() => onModeChange("import")}
        >
          <p className="text-sm font-semibold text-text">Import existing world</p>
          <p className="text-xs text-muted">Continue where you left off.</p>
        </button>
      </div>

      {mode === "import" && (
        <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
          <p className="text-xs text-muted">Import your existing world and continue where you left off.</p>
          <div className="flex flex-wrap items-center gap-2">
            <PrimaryButton onClick={onPickFolder} disabled={busy}>
              Select world folder
            </PrimaryButton>
            <SubtleButton onClick={onPickZip} disabled={busy}>
              Select .zip
            </SubtleButton>
            {sourcePath && (
              <SubtleButton onClick={onClear} disabled={busy}>
                Clear
              </SubtleButton>
            )}
          </div>

          {sourcePath && (
            <p className="text-xs text-muted break-all">{sourcePath}</p>
          )}
          {busy && <p className="text-xs text-muted">Validating world...</p>}

          {validation?.valid && (
            <div className="grid gap-2 text-xs text-muted">
              {validation.detected_version && (
                <p>Detected version: {validation.detected_version}</p>
              )}
              {validation.detected_type && (
                <p>Detected type: {validation.detected_type === "forge" ? "Forge" : "Vanilla"}</p>
              )}
              {validation.detected_type === "forge" && (
                <p className="text-amber-200">This world may require the same mods to run properly.</p>
              )}
              <div className="flex flex-wrap gap-2">
                {validation.has_playerdata && (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-muted">
                    playerdata
                  </span>
                )}
                {validation.has_data && (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-muted">
                    data
                  </span>
                )}
                {validation.has_dim_nether && (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-muted">
                    DIM-1
                  </span>
                )}
                {validation.has_dim_end && (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-muted">
                    DIM1
                  </span>
                )}
              </div>
            </div>
          )}

          {showProgress && copyProgress && (
            <div className="grid gap-2">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Copying world files...</span>
                <span>{copyProgress.percent}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-one transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, copyProgress.percent))}%` }}
                />
              </div>
            </div>
          )}

          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
