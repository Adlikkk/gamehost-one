import type { ImportAnalysis } from "../../types";
import { classNames } from "../../utils/classNames";
import { PrimaryButton, SubtleButton } from "../ui/Buttons";

export function ImportServerModal({
  open,
  importPath,
  importAnalysis,
  importName,
  importMode,
  importBusy,
  onClose,
  onPick,
  onNameChange,
  onModeChange,
  onImport
}: {
  open: boolean;
  importPath: string | null;
  importAnalysis: ImportAnalysis | null;
  importName: string;
  importMode: "copy" | "link";
  importBusy: boolean;
  onClose: () => void;
  onPick: () => void;
  onNameChange: (value: string) => void;
  onModeChange: (value: "copy" | "link") => void;
  onImport: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-surface p-6 shadow-soft">
        <p className="text-xs uppercase tracking-[0.2em] text-muted">Import server</p>
        <h3 className="mt-2 font-display text-xl text-text">Import existing Minecraft server</h3>
        <p className="mt-2 text-sm text-muted">
          Link an existing server folder or copy it into Gamehost ONE.
        </p>

        <div className="mt-4 grid gap-3">
          <button
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-text transition hover:border-one/40 hover:bg-white/10"
            onClick={onPick}
          >
            {importPath ? importPath : "Select server folder"}
          </button>

          {importAnalysis && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-muted">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-text">Detected {importAnalysis.server_type} server</span>
                <span>Version {importAnalysis.detected_version}</span>
              </div>
              <div className="mt-2 grid gap-1 text-xs">
                <span>{importAnalysis.has_properties ? "server.properties found" : "server.properties missing"}</span>
                <span>{importAnalysis.has_world ? "world folder found" : "world folder missing"}</span>
                {importAnalysis.detected_ram_gb ? (
                  <span>Detected RAM: {importAnalysis.detected_ram_gb} GB</span>
                ) : (
                  <span>No RAM config detected</span>
                )}
              </div>
              {importAnalysis.warnings.length > 0 && (
                <div className="mt-3 grid gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  {importAnalysis.warnings.map((warning) => (
                    <span key={warning}>{warning}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid gap-2">
            <label className="text-xs uppercase tracking-[0.2em] text-muted">Server name</label>
            <input
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text transition focus:border-one/60 focus:outline-none"
              value={importName}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Imported server"
            />
          </div>

          <div className="grid gap-2">
            <label className="text-xs uppercase tracking-[0.2em] text-muted">Import mode</label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={classNames(
                  "rounded-full px-4 py-2 text-xs font-semibold transition",
                  importMode === "copy"
                    ? "bg-one text-white"
                    : "bg-white/10 text-text hover:bg-white/20"
                )}
                onClick={() => onModeChange("copy")}
              >
                Copy into Gamehost (recommended)
              </button>
              <button
                type="button"
                className={classNames(
                  "rounded-full px-4 py-2 text-xs font-semibold transition",
                  importMode === "link"
                    ? "bg-one text-white"
                    : "bg-white/10 text-text hover:bg-white/20"
                )}
                onClick={() => onModeChange("link")}
              >
                Link folder
              </button>
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-3">
          <SubtleButton onClick={onClose}>Cancel</SubtleButton>
          <PrimaryButton onClick={onImport} disabled={!importPath || !importName.trim() || importBusy}>
            {importBusy ? "Importing..." : "Finish import"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
