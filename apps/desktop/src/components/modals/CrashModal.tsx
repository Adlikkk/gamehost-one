import type { CrashReport, CrashReportSummary } from "../../types";
import { SubtleButton } from "../ui/Buttons";

export function CrashModal({
  open,
  crashReports,
  crashLoading,
  activeCrashReport,
  onClose,
  onOpenReport,
  onClear,
  onExport
}: {
  open: boolean;
  crashReports: CrashReportSummary[];
  crashLoading: boolean;
  activeCrashReport: CrashReport | null;
  onClose: () => void;
  onOpenReport: (fileName: string) => void;
  onClear: () => void;
  onExport: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-60 flex items-start justify-center overflow-y-auto bg-black/60 px-6 py-8">
      <div className="w-full max-w-4xl max-h-[calc(100vh-4rem)] overflow-y-auto rounded-3xl border border-white/10 bg-surface p-6 text-sm text-text shadow-soft">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">Crash reports</p>
            <h3 className="mt-2 font-display text-xl text-text">Previous crash detected</h3>
          </div>
          <button
            className="rounded-full border border-white/10 px-3 py-1 text-xs text-muted transition hover:bg-white/10 hover:text-text"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
          <div className="grid gap-3">
            {crashReports.length === 0 ? (
              <p className="text-xs text-muted">No crash reports found.</p>
            ) : (
              crashReports.map((report) => (
                <button
                  key={report.file_name}
                  className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:border-one/40"
                  onClick={() => onOpenReport(report.file_name)}
                >
                  <span className="text-sm text-text">{new Date(report.timestamp).toLocaleString()}</span>
                  <span className="text-xs text-muted">{report.message}</span>
                </button>
              ))
            )}
            {crashReports.length > 0 && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SubtleButton onClick={onExport}>Export reports</SubtleButton>
                  <SubtleButton onClick={onClear} className="text-danger">
                    Clear all
                  </SubtleButton>
                </div>
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
            {crashLoading ? (
              <p className="text-xs text-muted">Loading report...</p>
            ) : activeCrashReport ? (
              <div className="grid gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">Message</p>
                  <p className="mt-2 text-sm text-text">{activeCrashReport.message}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">Environment</p>
                  <p className="mt-2 text-xs text-muted">
                    {activeCrashReport.os} · v{activeCrashReport.app_version}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">Backtrace</p>
                  <pre className="mt-2 max-h-52 overflow-y-auto rounded-2xl bg-black/40 p-3 text-[11px] text-muted">
                    {activeCrashReport.backtrace}
                  </pre>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted">Select a report to view details.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
