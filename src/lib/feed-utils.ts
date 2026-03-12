export function getTimeGroup(isoDate: string, now: number = Date.now()): string {
  const diff = now - new Date(isoDate).getTime();
  const seconds = diff / 1000;
  const minutes = seconds / 60;
  const hours = minutes / 60;
  const days = hours / 24;

  if (seconds < 60) return "Just nu";
  if (minutes < 60) return `${Math.floor(minutes)} min sedan`;
  if (hours < 2) return "1 timme sedan";
  if (hours < 24) return `${Math.floor(hours)} timmar sedan`;
  if (days < 2) return "Igår";

  const date = new Date(isoDate);
  const monthNames = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  return `${date.getDate()} ${monthNames[date.getMonth()]}`;
}

/**
 * Groups an ordered array of items by time group label.
 * Items must already be sorted newest-first.
 */
export function groupByTime<T>(
  items: T[],
  getDate: (item: T) => string,
  now?: number,
): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = [];
  let currentLabel = "";

  for (const item of items) {
    const label = getTimeGroup(getDate(item), now);
    if (label !== currentLabel) {
      groups.push({ label, items: [] });
      currentLabel = label;
    }
    groups[groups.length - 1].items.push(item);
  }

  return groups;
}
