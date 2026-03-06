const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

export function relativeTime(isoString: string): string {
  const seconds = Math.round((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < MINUTE) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / MINUTE);
  if (minutes < HOUR / MINUTE) return `${minutes}m ago`;
  const hours = Math.floor(seconds / HOUR);
  if (hours < DAY / HOUR) return `${hours}h ago`;
  const days = Math.floor(seconds / DAY);
  return `${days}d ago`;
}
