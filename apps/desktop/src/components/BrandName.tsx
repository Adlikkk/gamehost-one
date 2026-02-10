type BrandNameProps = {
  className?: string;
  accentClassName?: string;
};

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function BrandName({ className, accentClassName }: BrandNameProps) {
  return (
    <span className={cx("inline-flex items-center gap-1", className)}>
      <span>Gamehost</span>
      <span className={cx("text-one", accentClassName)}>ONE</span>
    </span>
  );
}
