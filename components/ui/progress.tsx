import { cn } from "@/lib/utils";

function Progress({
  value = 0,
  indeterminate = false,
  className,
  indicatorClassName,
}: {
  value?: number;
  indeterminate?: boolean;
  className?: string;
  indicatorClassName?: string;
}) {
  const clampedValue = Math.max(0, Math.min(100, value));

  return (
    <div
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-muted",
        className,
      )}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : clampedValue}
      aria-busy={indeterminate}
    >
      <div
        className={cn(
          "h-full rounded-full bg-foreground transition-[width,transform] duration-300 ease-out",
          indeterminate && "absolute inset-y-0 w-1/3 animate-[progress-indeterminate_1.2s_ease-in-out_infinite]",
          indicatorClassName,
        )}
        style={indeterminate ? undefined : { width: `${clampedValue}%` }}
      />
    </div>
  );
}

export { Progress };
