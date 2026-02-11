import { PrimaryButton, SubtleButton } from "../ui/Buttons";

export function LauncherModal({
  open,
  onClose,
  onChoose,
  launcherPath,
  onPickLauncherPath,
  onClearLauncherPath
}: {
  open: boolean;
  onClose: () => void;
  onChoose: (choice: "official" | "tlauncher") => void;
  launcherPath?: string | null;
  onPickLauncherPath: () => void;
  onClearLauncherPath: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 px-6">
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-surface p-6 text-sm text-text shadow-soft">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">Launcher</p>
            <h3 className="mt-2 font-display text-xl text-text">Choose your Minecraft launcher</h3>
          </div>
          <button
            className="rounded-full border border-white/10 px-3 py-1 text-xs text-muted transition hover:bg-white/10 hover:text-text"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="mt-5 grid gap-3">
          <PrimaryButton onClick={() => onChoose("official")}>Official Minecraft Launcher</PrimaryButton>
          <SubtleButton onClick={() => onChoose("tlauncher")}>TLauncher</SubtleButton>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-muted">
            <p className="text-xs uppercase tracking-[0.2em] text-muted">Custom launcher path</p>
            <p className="mt-2 break-all">{launcherPath ?? "Not set"}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <SubtleButton onClick={onPickLauncherPath}>Browse launcher exe</SubtleButton>
              {launcherPath && (
                <SubtleButton onClick={onClearLauncherPath} className="text-danger">
                  Clear
                </SubtleButton>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
