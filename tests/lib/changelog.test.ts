import { describe, expect, it } from "vitest";
import {
  CHANGELOG_AUDIENCES,
  CHANGELOG_CATEGORIES,
  CHANGELOG_IMPORTANCE,
  isPublicChangelog,
  publicChangelog,
} from "@/lib/changelog";

describe("publicChangelog", () => {
  it("matches the public changelog schema", () => {
    expect(isPublicChangelog(publicChangelog)).toBe(true);
    expect(publicChangelog.schemaVersion).toBe(1);
    expect(publicChangelog.generatedFrom).toEqual({
      from: "2026-01-21",
      to: "2026-08-05",
      source: "git-history",
    });
  });

  it("uses unique ids and newest-first entry ordering", () => {
    const ids = publicChangelog.entries.map((entry) => entry.id);
    const dates = publicChangelog.entries.map((entry) =>
      new Date(`${entry.date}T00:00:00.000Z`).getTime()
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it("uses only allowed public field values", () => {
    for (const entry of publicChangelog.entries) {
      expect(CHANGELOG_CATEGORIES).toContain(entry.category);
      expect(CHANGELOG_IMPORTANCE).toContain(entry.importance);

      for (const audience of entry.audience) {
        expect(CHANGELOG_AUDIENCES).toContain(audience);
      }
    }
  });

  it("includes network data for the chain coverage entry", () => {
    const networkCoverage = publicChangelog.entries.find(
      (entry) => entry.id === "2026-02-network-coverage"
    );

    expect(networkCoverage?.category).toBe("chains");
    expect(networkCoverage?.networks).toEqual(
      expect.arrayContaining(["Ethereum", "Base", "Arbitrum", "Solana"])
    );
  });
});
