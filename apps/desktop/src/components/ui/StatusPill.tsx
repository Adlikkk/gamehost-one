import { motion } from "framer-motion";
import type { ServerStatus } from "../../types";
import { classNames } from "../../utils/classNames";

const statusMeta: Record<ServerStatus, { label: string; pill: string; dot: string; text: string }> = {
  STOPPED: { label: "Stopped", pill: "bg-danger/20", dot: "bg-danger", text: "text-danger" },
  PREPARING: { label: "Preparing", pill: "bg-primary/20", dot: "bg-primary", text: "text-primary" },
  STARTING: { label: "Starting", pill: "bg-primary/20", dot: "bg-primary", text: "text-primary" },
  RUNNING: { label: "Running", pill: "bg-secondary/20", dot: "bg-secondary", text: "text-secondary" },
  STOPPING: { label: "Stopping", pill: "bg-amber-500/20", dot: "bg-amber-300", text: "text-amber-200" },
  ERROR: { label: "Error", pill: "bg-danger/15", dot: "bg-danger", text: "text-danger" }
};

export function StatusPill({ status }: { status: ServerStatus | string }) {
  const meta = statusMeta[status as ServerStatus] ?? statusMeta.STOPPED;
  return (
    <span className={classNames("flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold", meta.pill, meta.text)}>
      <motion.span
        className={classNames("h-2 w-2 rounded-full", meta.dot)}
        animate={status === "PREPARING" || status === "STARTING" || status === "STOPPING" ? { opacity: [0.4, 1, 0.4], scale: [0.9, 1.1, 0.9] } : undefined}
        transition={status === "PREPARING" || status === "STARTING" || status === "STOPPING" ? { repeat: Infinity, duration: 1.2 } : undefined}
      />
      {meta.label && <span className="font-semibold">{meta.label}</span>}
    </span>
  );
}
