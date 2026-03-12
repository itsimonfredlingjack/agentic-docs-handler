import type { DocumentCounts, SidebarFilter } from "../types/documents";

export type SidebarFilterItem = {
  id: SidebarFilter;
  label: string;
  countKey: keyof DocumentCounts;
};

export const SIDEBAR_FILTER_ITEMS: SidebarFilterItem[] = [
  { id: "all", label: "Alla", countKey: "all" },
  { id: "processing", label: "Pågår", countKey: "processing" },
  { id: "receipt", label: "Kvitton", countKey: "receipt" },
  { id: "contract", label: "Avtal", countKey: "contract" },
  { id: "invoice", label: "Fakturor", countKey: "invoice" },
  { id: "meeting_notes", label: "Möten", countKey: "meeting_notes" },
  { id: "audio", label: "Ljud", countKey: "audio" },
  { id: "generic", label: "Övrigt", countKey: "generic" },
  { id: "moved", label: "Flyttade", countKey: "moved" },
];

export function getSidebarFilterLabel(filter: SidebarFilter): string {
  return SIDEBAR_FILTER_ITEMS.find((item) => item.id === filter)?.label ?? "Alla";
}
