import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const GENERATED_DIR = join(process.cwd(), ".generated", "metadata");

const placeholders: Array<{ path: string; data: unknown }> = [
  {
    path: join(GENERATED_DIR, "cctp.generated.json"),
    data: {
      version: 1,
      generatedAt: new Date(0).toISOString(),
      source: "placeholder",
      chains: [],
    },
  },
  {
    path: join(GENERATED_DIR, "rpc.generated.json"),
    data: {
      version: 1,
      generatedAt: new Date(0).toISOString(),
      source: "placeholder",
      validation: {
        corsOrigin: "",
        requestTimeoutMs: 0,
        maxCandidatesPerChain: 0,
        maxValidUrlsPerChain: 0,
      },
      evm: [],
      solana: [],
      missingChainIds: [],
    },
  },
];

async function ensureGeneratedMetadata(): Promise<void> {
  let created = 0;

  for (const entry of placeholders) {
    if (existsSync(entry.path)) {
      continue;
    }

    await mkdir(dirname(entry.path), { recursive: true });
    await writeFile(entry.path, `${JSON.stringify(entry.data, null, 2)}\n`, "utf8");
    created += 1;
    console.log(`[ensure-generated-metadata] created ${entry.path}`);
  }

  if (created === 0) {
    console.log("[ensure-generated-metadata] generated metadata already present");
  }
}

ensureGeneratedMetadata().catch((error) => {
  console.error("[ensure-generated-metadata] failed:", error);
  process.exitCode = 1;
});
