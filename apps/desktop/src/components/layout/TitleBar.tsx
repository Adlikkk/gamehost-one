import { AnimatePresence, motion } from "framer-motion";
import { BrandName } from "../BrandName";
import { classNames } from "../../utils/classNames";

export type UiToast = {
  tone: "success" | "error";
  message: string;
  label?: string;
} | null;

export function TitleBar({
  uiToast,
  onMinimize,
  onMaximize,
  onClose
}: {
  uiToast: UiToast;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
}) {
  return (
    <header className="titlebar relative flex items-center justify-between border-b border-white/10 px-5 py-3">
      <div className="flex items-center gap-3">
        <img src="/logo.png" alt="Gamehost ONE" className="h-7 w-7 rounded-lg" />
        <BrandName className="text-sm font-semibold" />
      </div>
      <div className="flex items-center gap-2">
        <button
          className="no-drag flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-muted transition hover:bg-white/10 hover:text-text"
          onClick={onMinimize}
          aria-label="Minimize"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 12h12" />
          </svg>
        </button>
        <button
          className="no-drag flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-muted transition hover:bg-white/10 hover:text-text"
          onClick={onMaximize}
          aria-label="Maximize"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
        <button
          className="no-drag flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-muted transition hover:border-danger/40 hover:bg-danger/40 hover:text-white"
          onClick={onClose}
          aria-label="Close"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M7 7l10 10" />
            <path d="M17 7l-10 10" />
          </svg>
        </button>
      </div>
      <AnimatePresence>
        {uiToast && (
          <motion.div
            className="no-drag pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-text"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
          >
            {uiToast.label === "Welcome" ? (
              <span className="text-text">{uiToast.message}</span>
            ) : (
              <>
                <span
                  className={classNames(
                    "flex h-6 w-6 items-center justify-center rounded-full",
                    uiToast.tone === "success" ? "bg-secondary/20 text-secondary" : "bg-danger/20 text-danger"
                  )}
                >
                  {uiToast.tone === "success" ? (
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  ) : (
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 9v4" />
                      <path d="M12 17h.01" />
                      <circle cx="12" cy="12" r="9" />
                    </svg>
                  )}
                </span>
                <span className="uppercase tracking-[0.2em] text-muted">
                  {uiToast.label ?? (uiToast.tone === "success" ? "Server" : "Notice")}
                </span>
                <span className="text-text">{uiToast.message}</span>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
