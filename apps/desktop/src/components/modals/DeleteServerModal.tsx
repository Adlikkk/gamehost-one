import type { ServerConfig } from "../../types";
import { classNames } from "../../utils/classNames";
import { SubtleButton } from "../ui/Buttons";

export function DeleteServerModal({
  target,
  confirmText,
  deleteMatches,
  deleteBusy,
  onConfirmTextChange,
  onCancel,
  onDelete
}: {
  target: ServerConfig | null;
  confirmText: string;
  deleteMatches: boolean;
  deleteBusy: boolean;
  onConfirmTextChange: (value: string) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  if (!target) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-surface p-6 shadow-soft">
        <p className="text-xs uppercase tracking-[0.2em] text-danger">Delete server</p>
        <h3 className="mt-2 font-display text-xl text-text">This action is irreversible</h3>
        <p className="mt-2 text-sm text-muted">
          Type the server name to confirm deletion. All files will be removed.
        </p>
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Server name</p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-sm text-text">{target.name}</span>
            <SubtleButton
              onClick={() => navigator.clipboard?.writeText(target.name)}
              className="bg-white/10 text-muted hover:bg-white/20"
            >
              Copy
            </SubtleButton>
          </div>
        </div>
        <input
          className="mt-4 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-text transition focus:border-danger/60 focus:outline-none"
          placeholder="Type server name"
          value={confirmText}
          onChange={(event) => onConfirmTextChange(event.target.value)}
        />
        <div className="mt-5 flex items-center justify-end gap-3">
          <SubtleButton onClick={onCancel}>Cancel</SubtleButton>
          <button
            className={classNames(
              "rounded-full bg-danger px-4 py-2 text-xs font-semibold text-white transition",
              deleteMatches ? "hover:bg-danger/90" : "opacity-50"
            )}
            onClick={onDelete}
            disabled={!deleteMatches || deleteBusy}
          >
            {deleteBusy ? "Deleting..." : "Delete server"}
          </button>
        </div>
      </div>
    </div>
  );
}
