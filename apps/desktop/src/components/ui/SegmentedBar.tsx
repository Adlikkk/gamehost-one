import { motion } from "framer-motion";
import { classNames } from "../../utils/classNames";

export function SegmentedBar({
  value,
  tone,
  pulse
}: {
  value: number;
  tone: "primary" | "secondary" | "danger";
  pulse?: boolean;
}) {
  const barTone = {
    primary: "bg-one",
    secondary: "bg-secondary",
    danger: "bg-danger"
  }[tone];

  return (
    <div className="h-3 overflow-hidden rounded-full bg-white/10">
      <motion.div
        className={classNames("h-full segmented-bar", barTone, pulse && "animate-pulse")}
        initial={false}
        animate={{ width: `${Math.min(100, value)}%` }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      />
    </div>
  );
}
