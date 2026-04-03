import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SearchFilterBar } from "./SearchFilterBar";
import { useDocumentStore } from "../store/documentStore";

describe("SearchFilterBar", () => {
  beforeEach(() => {
    useDocumentStore.setState({
      searchFilters: { documentType: null, dateFrom: null, dateTo: null },
    });
  });

  it("renders document type chips", () => {
    render(<SearchFilterBar />);
    expect(screen.getByText("Alla")).toBeInTheDocument();
    expect(screen.getByText("Kvitton")).toBeInTheDocument();
    expect(screen.getByText("Fakturor")).toBeInTheDocument();
    expect(screen.getByText("Kontrakt")).toBeInTheDocument();
  });

  it("renders date range chips", () => {
    render(<SearchFilterBar />);
    expect(screen.getByText("All tid")).toBeInTheDocument();
    expect(screen.getByText("Idag")).toBeInTheDocument();
    expect(screen.getByText("7 dagar")).toBeInTheDocument();
    expect(screen.getByText("30 dagar")).toBeInTheDocument();
  });

  it("sets document type filter on click", () => {
    render(<SearchFilterBar />);
    fireEvent.click(screen.getByText("Fakturor"));
    expect(useDocumentStore.getState().searchFilters.documentType).toBe("invoice");
  });

  it("clears document type filter when Alla is clicked", () => {
    useDocumentStore.setState({
      searchFilters: { documentType: "invoice", dateFrom: null, dateTo: null },
    });
    render(<SearchFilterBar />);
    fireEvent.click(screen.getByText("Alla"));
    expect(useDocumentStore.getState().searchFilters.documentType).toBeNull();
  });
});
