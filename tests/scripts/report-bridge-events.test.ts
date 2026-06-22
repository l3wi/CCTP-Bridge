import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("report-bridge-events script", () => {
  it("dedupes bridge burn events and splits fast and standard volume", () => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-events-"));
    const csvPath = join(dir, "events.csv");
    writeFileSync(
      csvPath,
      [
        "eventName,eventData",
        "\"bridge_burn_submitted\",\"{\"\"id\"\":\"\"1:0xaaa\"\",\"\"m\"\":\"\"v1,10.000000,1,8453,f,0.005000,0\"\"}\"",
        "\"bridge_burn_submitted\",\"{\"\"id\"\":\"\"1:0xaaa\"\",\"\"m\"\":\"\"v1,10.000000,1,8453,f,0.005000,0\"\"}\"",
        "\"bridge_burn_submitted\",\"{\"\"id\"\":\"\"8453:0xbbb\"\",\"\"m\"\":\"\"v1,5.000000,8453,1,s,0,0\"\"}\"",
      ].join("\n")
    );

    const output = execFileSync("bun", ["run", "scripts/report-bridge-events.ts", csvPath], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("Unique bridge events: 2");
    expect(output).toContain("Duplicate rows ignored: 1");
    expect(output).toContain("Total volume: 15.000000 USDC");
    expect(output).toContain("Fast volume: 10.000000 USDC");
    expect(output).toContain("Standard volume: 5.000000 USDC");
    expect(output).toContain("App fast-fee revenue: 0.005000 USDC");
  });
});
