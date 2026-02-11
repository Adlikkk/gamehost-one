import type { ReactNode } from "react";
import { classNames } from "../../utils/classNames";

export function SubtleButton({
  onClick,
  children,
  disabled,
  className
}: {
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      className={classNames(
        "rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-text transition hover:-translate-y-0.5 hover:bg-white/20 hover:shadow-soft",
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white/10",
        className
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function PrimaryButton({
  onClick,
  children,
  disabled,
  className
}: {
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      className={classNames(
        "rounded-full bg-one px-5 py-2 text-sm font-semibold text-white shadow-soft transition hover:-translate-y-0.5 hover:bg-one/90 hover:shadow-[0_10px_30px_rgba(79,209,197,0.2)] disabled:cursor-not-allowed disabled:opacity-70",
        className
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
