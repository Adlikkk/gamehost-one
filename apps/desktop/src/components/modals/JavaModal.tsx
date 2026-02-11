import type { JavaStatusResult } from "../../types";
import { PrimaryButton, SubtleButton } from "../ui/Buttons";

export function JavaModal({
  open,
  status,
  downloadProgress,
  busy,
  onClose,
  onDownload,
  onSelect
}: {
  open: boolean;
  status: JavaStatusResult | null;
  downloadProgress: number | null;
  busy: boolean;
  onClose: () => void;
  onDownload: () => void;
  onSelect: () => void;
}) {
  if (!open || !status) return null;

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 px-6">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-surface p-6 text-sm text-text shadow-soft">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">Java required</p>
            <h3 className="mt-2 font-display text-xl text-text">Java is required to run this Minecraft server.</h3>
          </div>
          <button
            className="rounded-full border border-white/10 px-3 py-1 text-xs text-muted transition hover:bg-white/10 hover:text-text"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="mt-4 grid gap-2 text-sm text-muted">
          <p>GameHost ONE can download a secure runtime for you.</p>
          <p>This Java version will be used only by GameHost ONE.</p>
        </div>
        <div className="mt-4 grid gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <p className="text-sm font-semibold text-text">Required: Java {status.required_major}</p>
          {status.status === "missing" && (
            <p className="text-xs text-muted">Not detected on your system</p>
          )}
          {status.status === "unsupported" && (
            <p className="text-xs text-muted">Detected: Java {status.selected_major ?? "unknown"}</p>
          )}
        </div>
        {downloadProgress !== null && (
          <div className="mt-4 grid gap-2">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Downloading Java...</span>
              <span>{Math.round(downloadProgress)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-secondary transition-all"
                style={{ width: `${Math.min(100, Math.max(0, downloadProgress))}%` }}
              />
            </div>
          </div>
        )}
        <div className="mt-5 flex flex-col gap-3">
          <PrimaryButton onClick={onDownload} disabled={busy}>
            {busy ? "Downloading..." : "Download & Install Java (Recommended)"}
          </PrimaryButton>
          <SubtleButton onClick={onSelect} disabled={busy}>
            Select existing Java manually
          </SubtleButton>
        </div>
      </div>
    </div>
  );
}
