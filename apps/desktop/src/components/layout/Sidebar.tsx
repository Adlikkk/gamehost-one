import type { ServerConfig, ServerStatus, View } from "../../types";
import { classNames } from "../../utils/classNames";

export function Sidebar({
  view,
  setView,
  sidebarExpanded,
  setSidebarExpanded,
  servers,
  selectedServer,
  isServerView,
  serverIcons,
  serverStatusFor,
  handleOpenServer
}: {
  view: View;
  setView: (next: View) => void;
  sidebarExpanded: boolean;
  setSidebarExpanded: (value: boolean) => void;
  servers: ServerConfig[];
  selectedServer: ServerConfig | null;
  isServerView: boolean;
  serverIcons: Record<string, string>;
  serverStatusFor: (server: ServerConfig) => ServerStatus | "STOPPED";
  handleOpenServer: (server: ServerConfig) => void;
}) {
  return (
    <aside
      className={classNames(
        "flex min-h-full flex-col border-r border-white/5 bg-surface/80 backdrop-blur",
        sidebarExpanded ? "w-64" : "w-20",
        "transition-[width] duration-300"
      )}
    >
      {sidebarExpanded ? (
        <div className="mt-4 px-3 text-[11px] uppercase tracking-[0.2em] text-muted">Home</div>
      ) : null}
      <nav className="mt-2 flex flex-col gap-1 px-2">
        <button
          className={classNames(
            "flex w-full items-center rounded-xl py-2 text-sm transition whitespace-nowrap",
            view === "library" ? "bg-white/10 text-one" : "text-muted hover:bg-white/10",
            sidebarExpanded ? "px-3 gap-3" : "justify-center px-2 gap-0"
          )}
          onClick={() => setView("library")}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-one">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 11l9-7 9 7" />
              <path d="M5 10v9h14v-9" />
            </svg>
          </span>
          {sidebarExpanded && <span>Games</span>}
        </button>
      </nav>

      {sidebarExpanded ? (
        <div className="mt-6 px-3 text-[11px] uppercase tracking-[0.2em] text-muted">Last used</div>
      ) : (
        <div className="mx-4 mt-6 h-px bg-white/10" />
      )}
      <nav className="mt-2 flex flex-col gap-1 px-2">
        <button
          className={classNames(
            "flex w-full items-center gap-3 rounded-xl py-2 text-sm transition",
            view === "servers" || view === "wizard" || view === "migration" || view === "detail"
              ? "bg-white/10 text-one"
              : "text-muted hover:bg-white/10",
            sidebarExpanded ? "px-3" : "justify-center px-2"
          )}
          onClick={() => setView("servers")}
        >
          <img src="/MC-logo.webp" alt="Minecraft" className="h-6 w-6 object-contain" />
          {sidebarExpanded && <span>Minecraft</span>}
        </button>
      </nav>

      {sidebarExpanded ? (
        <div className="mt-6 px-3 text-[11px] uppercase tracking-[0.2em] text-muted">Servers</div>
      ) : (
        <div className="mx-4 mt-6 h-px bg-white/10" />
      )}
      <nav className="mt-2 flex flex-1 flex-col gap-1 overflow-y-auto px-2 pb-4">
        {servers.length === 0 && sidebarExpanded && (
          <span className="px-3 text-xs text-muted">No servers yet</span>
        )}
        {servers.map((server) => (
          <button
            key={server.name}
            className={classNames(
              "flex w-full items-center gap-3 rounded-xl py-2 text-sm transition",
              selectedServer?.name === server.name && isServerView
                ? "bg-white/10 text-one"
                : "text-muted hover:bg-white/10",
              sidebarExpanded ? "px-3" : "justify-center px-2"
            )}
            onClick={() => handleOpenServer(server)}
          >
            <span className="relative">
              <img
                src={serverIcons[server.name] ?? "/logo.png"}
                alt={server.name}
                className="h-8 w-8 rounded-lg object-cover"
              />
              {serverStatusFor(server) === "RUNNING" && (
                <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-secondary shadow-[0_0_0_2px_rgba(21,26,33,0.9)]" />
              )}
            </span>
            {sidebarExpanded && <span className="truncate">{server.name}</span>}
          </button>
        ))}
      </nav>

      <div className={classNames("px-2", sidebarExpanded ? "pb-3" : "pb-2")}>
        <button
          className={classNames(
            "flex w-full items-center rounded-xl py-2 text-sm transition whitespace-nowrap",
            view === "settings" ? "bg-white/10 text-one" : "text-muted hover:bg-white/10",
            sidebarExpanded ? "px-3 gap-3" : "justify-center px-2 gap-0"
          )}
          onClick={() => setView("settings")}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-one">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .33 1.82l.03.03a2 2 0 1 1-2.83 2.83l-.03-.03a1.7 1.7 0 0 0-1.82-.33 1.7 1.7 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.06a1.7 1.7 0 0 0-1-1.51 1.7 1.7 0 0 0-1.82.33l-.03.03a2 2 0 1 1-2.83-2.83l.03-.03a1.7 1.7 0 0 0 .33-1.82 1.7 1.7 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.06a1.7 1.7 0 0 0 1.51-1 1.7 1.7 0 0 0-.33-1.82l-.03-.03a2 2 0 1 1 2.83-2.83l.03.03a1.7 1.7 0 0 0 1.82.33 1.7 1.7 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.06a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.82-.33l.03-.03a2 2 0 1 1 2.83 2.83l-.03.03a1.7 1.7 0 0 0-.33 1.82 1.7 1.7 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.06a1.7 1.7 0 0 0-1.51 1z" />
            </svg>
          </span>
          {sidebarExpanded && <span>Settings</span>}
        </button>
      </div>

      <div className="px-4 pb-5">
        <button
          className={classNames(
            "no-drag flex w-full items-center justify-center rounded-full border border-white/10 bg-white/5 py-2 text-one transition hover:bg-white/10",
            sidebarExpanded ? "" : "mx-auto"
          )}
          onClick={() => setSidebarExpanded(!sidebarExpanded)}
          aria-label={sidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          <span
            className={classNames(
              "text-base transition-transform duration-300",
              sidebarExpanded ? "rotate-180" : "rotate-0"
            )}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="M13 6l6 6-6 6" />
            </svg>
          </span>
        </button>
      </div>

    </aside>
  );
}
