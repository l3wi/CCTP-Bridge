import { getBridgeBurnStatistics } from "../lib/db/bridgeBurnSubmissions";
import {
  parseBridgeStatisticsDays,
  renderBridgeStatistics,
} from "../lib/reporting/bridgeStatistics";

const main = async (): Promise<void> => {
  const days = parseBridgeStatisticsDays(process.argv.slice(2));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1_000);
  const statistics = await getBridgeBurnStatistics({ since });

  console.log(renderBridgeStatistics({ days, statistics }));
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
