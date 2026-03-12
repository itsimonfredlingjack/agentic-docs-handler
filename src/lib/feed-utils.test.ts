import { describe, it, expect } from "vitest";
import { getTimeGroup } from "./feed-utils";

describe("getTimeGroup", () => {
  it("returns 'Just nu' for documents less than 60 seconds old", () => {
    const now = Date.now();
    expect(getTimeGroup(new Date(now - 30_000).toISOString(), now)).toBe("Just nu");
  });

  it("returns relative minutes for documents 1-59 minutes old", () => {
    const now = Date.now();
    expect(getTimeGroup(new Date(now - 120_000).toISOString(), now)).toBe("2 min sedan");
    expect(getTimeGroup(new Date(now - 600_000).toISOString(), now)).toBe("10 min sedan");
  });

  it("returns relative hours for documents 1-23 hours old", () => {
    const now = Date.now();
    expect(getTimeGroup(new Date(now - 3_600_000).toISOString(), now)).toBe("1 timme sedan");
    expect(getTimeGroup(new Date(now - 7_200_000).toISOString(), now)).toBe("2 timmar sedan");
  });

  it("returns 'Igår' for yesterday", () => {
    const now = Date.now();
    expect(getTimeGroup(new Date(now - 86_400_000 - 3600_000).toISOString(), now)).toBe("Igår");
  });

  it("returns date string for older documents", () => {
    const now = Date.now();
    const old = new Date(now - 5 * 86_400_000).toISOString();
    const result = getTimeGroup(old, now);
    expect(result).not.toBe("Igår");
    expect(result.length).toBeGreaterThan(0);
  });
});
