import type { DocumentCounts, SidebarFilter } from "../types/documents";
import { t } from "../lib/locale";

export type SidebarFilterItem = {
  id: SidebarFilter;
  label: string;
  countKey: keyof DocumentCounts;
};

type FilterDef = {
  id: SidebarFilter;
  localeKey: string;
  countKey: keyof DocumentCounts;
};

const FILTER_DEFS: FilterDef[] = [
  { id: "all", localeKey: "filter.all", countKey: "all" },
  { id: "recent", localeKey: "filter.recent", countKey: "all" },
  { id: "processing", localeKey: "filter.processing", countKey: "processing" },
  { id: "receipt", localeKey: "filter.receipt", countKey: "receipt" },
  { id: "contract", localeKey: "filter.contract", countKey: "contract" },
  { id: "invoice", localeKey: "filter.invoice", countKey: "invoice" },
  { id: "meeting_notes", localeKey: "filter.meeting_notes", countKey: "meeting_notes" },
  { id: "report", localeKey: "filter.report", countKey: "report" },
  { id: "letter", localeKey: "filter.letter", countKey: "letter" },
  { id: "tax_document", localeKey: "filter.tax_document", countKey: "tax_document" },
  { id: "audio", localeKey: "filter.audio", countKey: "audio" },
  { id: "generic", localeKey: "filter.generic", countKey: "generic" },
  { id: "moved", localeKey: "filter.moved", countKey: "moved" },
];

export function getSidebarFilterItems(): SidebarFilterItem[] {
  return FILTER_DEFS.map((def) => ({
    id: def.id,
    label: t(def.localeKey),
    countKey: def.countKey,
  }));
}

// Backward-compatible constant — evaluates labels at import time (Swedish default)
export const SIDEBAR_FILTER_ITEMS: SidebarFilterItem[] = getSidebarFilterItems();

export function getSidebarFilterLabel(filter: SidebarFilter): string {
  const items = getSidebarFilterItems();
  return items.find((item) => item.id === filter)?.label ?? t("filter.all");
}
