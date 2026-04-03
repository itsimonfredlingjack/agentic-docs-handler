import { useDocumentStore } from "../store/documentStore";

const DOC_TYPES = [
  { value: null, label: "Alla" },
  { value: "receipt", label: "Kvitton" },
  { value: "invoice", label: "Fakturor" },
  { value: "contract", label: "Kontrakt" },
  { value: "meeting_notes", label: "Mötesanteckningar" },
  { value: "generic", label: "Generella" },
] as const;

const DATE_RANGES = [
  { value: null, label: "All tid" },
  { value: "today", label: "Idag" },
  { value: "7d", label: "7 dagar" },
  { value: "30d", label: "30 dagar" },
] as const;

function dateRangeToISO(range: string | null): { dateFrom: string | null; dateTo: string | null } {
  if (!range) return { dateFrom: null, dateTo: null };
  const now = new Date();
  const dateTo = now.toISOString();
  if (range === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { dateFrom: start.toISOString(), dateTo };
  }
  if (range === "7d") {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { dateFrom: start.toISOString(), dateTo };
  }
  if (range === "30d") {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { dateFrom: start.toISOString(), dateTo };
  }
  return { dateFrom: null, dateTo: null };
}

export function SearchFilterBar() {
  const searchFilters = useDocumentStore((s) => s.searchFilters);
  const setSearchFilters = useDocumentStore((s) => s.setSearchFilters);

  const activeDocType = searchFilters.documentType;
  const activeDateRange = searchFilters.dateFrom
    ? DATE_RANGES.find((r) => {
        const { dateFrom } = dateRangeToISO(r.value);
        return dateFrom === searchFilters.dateFrom;
      })?.value ?? "custom"
    : null;

  return (
    <div className="flex items-center gap-4 px-4 py-2 border-b border-[var(--surface-4)]">
      <div className="flex items-center gap-1.5">
        <span className="text-xs-ui font-semibold uppercase tracking-[0.08em] text-[var(--text-disabled)] mr-1">Typ</span>
        {DOC_TYPES.map((dt) => (
          <button
            key={dt.value ?? "all"}
            type="button"
            onClick={() => setSearchFilters({ documentType: dt.value })}
            className={`px-2 py-0.5 text-xs-ui rounded-[var(--badge-radius)] transition-colors ${
              activeDocType === dt.value
                ? "bg-[var(--accent-surface)] text-[var(--accent-primary)] font-medium"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-4)]"
            }`}
          >
            {dt.label}
          </button>
        ))}
      </div>
      <div className="h-3 w-px bg-[var(--surface-8)]" />
      <div className="flex items-center gap-1.5">
        <span className="text-xs-ui font-semibold uppercase tracking-[0.08em] text-[var(--text-disabled)] mr-1">Period</span>
        {DATE_RANGES.map((dr) => (
          <button
            key={dr.value ?? "all"}
            type="button"
            onClick={() => {
              const { dateFrom, dateTo } = dateRangeToISO(dr.value);
              setSearchFilters({ dateFrom, dateTo });
            }}
            className={`px-2 py-0.5 text-xs-ui rounded-[var(--badge-radius)] transition-colors ${
              activeDateRange === dr.value
                ? "bg-[var(--accent-surface)] text-[var(--accent-primary)] font-medium"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-4)]"
            }`}
          >
            {dr.label}
          </button>
        ))}
      </div>
    </div>
  );
}
