import { beforeEach, describe, expect, it, vi } from "vitest";
import { useToastStore } from "./toastStore";

describe("toastStore", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.useFakeTimers();
  });

  it("show adds a toast with defaults", () => {
    useToastStore.getState().show("Hello");
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe("Hello");
    expect(toasts[0].type).toBe("success");
    expect(toasts[0].duration).toBe(3000);
  });

  it("show accepts custom type and duration", () => {
    useToastStore.getState().show("Error", "error", { duration: 0 });
    const toast = useToastStore.getState().toasts[0];
    expect(toast.type).toBe("error");
    expect(toast.duration).toBe(0);
  });

  it("show accepts an action", () => {
    const onClick = vi.fn();
    useToastStore.getState().show("Retry?", "error", { action: { label: "Retry", onClick } });
    const toast = useToastStore.getState().toasts[0];
    expect(toast.action?.label).toBe("Retry");
  });

  it("dismiss removes a toast by id", () => {
    useToastStore.getState().show("A");
    useToastStore.getState().show("B");
    const idA = useToastStore.getState().toasts[0].id;
    useToastStore.getState().dismiss(idA);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].message).toBe("B");
  });

  it("evicts oldest when exceeding max 3", () => {
    useToastStore.getState().show("A");
    useToastStore.getState().show("B");
    useToastStore.getState().show("C");
    useToastStore.getState().show("D");
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(3);
    expect(toasts[0].message).toBe("B");
  });

  it("info type defaults to 5000ms duration", () => {
    useToastStore.getState().show("Info", "info");
    expect(useToastStore.getState().toasts[0].duration).toBe(5000);
  });

  it("error type defaults to 0ms duration (persistent)", () => {
    useToastStore.getState().show("Err", "error");
    expect(useToastStore.getState().toasts[0].duration).toBe(0);
  });
});
