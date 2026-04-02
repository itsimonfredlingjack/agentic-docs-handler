import { Button } from "./Button";

type ErrorBannerProps = {
  title?: string;
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
  className?: string;
};

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function ErrorBanner({
  title = "Något gick fel",
  message,
  retryLabel = "Försök igen",
  onRetry,
  className,
}: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className={cx(
        "rounded-[var(--card-radius)] border border-[rgba(var(--invoice-color-rgb),0.35)] bg-[rgba(var(--invoice-color-rgb),0.12)] px-3 py-2.5",
        className,
      )}
    >
      <p className="text-sm-ui font-semibold text-[var(--invoice-color)]">{title}</p>
      <p className="mt-1 text-sm-ui text-[var(--text-secondary)]">{message}</p>
      {onRetry ? (
        <div className="mt-2">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
