import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useUxState } from "./useUxState";

describe("useUxState", () => {
  it("starts in idle", () => {
    const { result } = renderHook(() => useUxState());
    expect(result.current.state).toBe("idle");
  });

  it("transitions through working -> success", () => {
    const { result } = renderHook(() => useUxState());
    act(() => result.current.start());
    expect(result.current.state).toBe("working");
    act(() => result.current.succeed());
    expect(result.current.state).toBe("success");
  });

  it("stores error on fail", () => {
    const { result } = renderHook(() => useUxState());
    act(() => result.current.fail("oops"));
    expect(result.current.state).toBe("error");
    expect(result.current.error).toBe("oops");
  });
});
