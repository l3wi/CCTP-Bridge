import { TransferSpeed } from "@circle-fin/bridge-kit";

type FinalityEstimate = {
  fast?: { blocks: number; averageTime: string };
  standard?: { blocks: number; averageTime: string };
};

// Derived from Circle's CCTP attestation guidance.
const FINALITY_BY_CHAIN: Record<string, FinalityEstimate> = {
  ethereum: {
    fast: { blocks: 2, averageTime: "~20 seconds" },
    standard: { blocks: 65, averageTime: "~13 to 19 minutes" },
  },
  arbitrum: {
    fast: { blocks: 1, averageTime: "~8 seconds" },
    standard: { blocks: 65, averageTime: "~13 to 19 minutes" },
  },
  base: {
    fast: { blocks: 1, averageTime: "~8 seconds" },
    standard: { blocks: 65, averageTime: "~13 to 19 minutes" },
  },
  codex: {
    fast: { blocks: 1, averageTime: "~8 seconds" },
    standard: { blocks: 65, averageTime: "~13 to 19 minutes" },
  },
  ink: {
    fast: { blocks: 1, averageTime: "~8 seconds" },
    standard: { blocks: 65, averageTime: "~30 minutes" },
  },
  linea: {
    fast: { blocks: 1, averageTime: "~8 seconds" },
    standard: { blocks: 1, averageTime: "~6 to 32 hours" },
  },
  "op mainnet": {
    fast: { blocks: 1, averageTime: "~8 seconds" },
    standard: { blocks: 65, averageTime: "~13 to 19 minutes" },
  },
  plume: {
    fast: { blocks: 1, averageTime: "~8 seconds" },
    standard: { blocks: 65, averageTime: "~13 to 19 minutes" },
  },
  solana: {
    fast: { blocks: 3, averageTime: "~8 seconds" },
    standard: { blocks: 32, averageTime: "~25 seconds" },
  },
  unichain: {
    fast: { blocks: 1, averageTime: "~8 seconds" },
    standard: { blocks: 65, averageTime: "~13 to 19 minutes" },
  },
  "world chain": {
    fast: { blocks: 1, averageTime: "~8 seconds" },
    standard: { blocks: 65, averageTime: "~13 to 19 minutes" },
  },
  "arc testnet": {
    standard: { blocks: 1, averageTime: "~0.5 seconds" },
  },
  avalanche: {
    standard: { blocks: 1, averageTime: "~8 seconds" },
  },
  "bnb smart chain": {
    standard: { blocks: 3, averageTime: "~2 seconds" },
  },
  hyperevm: {
    standard: { blocks: 1, averageTime: "~5 seconds" },
  },
  monad: {
    standard: { blocks: 1, averageTime: "~5 seconds" },
  },
  "polygon pos": {
    standard: { blocks: 3, averageTime: "~8 seconds" },
  },
  sei: {
    standard: { blocks: 1, averageTime: "~5 seconds" },
  },
  sonic: {
    standard: { blocks: 1, averageTime: "~8 seconds" },
  },
  xdc: {
    standard: { blocks: 3, averageTime: "~10 seconds" },
  },
};

export const getFinalityEstimate = (
  chainName: string,
  speed: TransferSpeed
): FinalityEstimate[keyof FinalityEstimate] | undefined => {
  const key = chainName.trim().toLowerCase();
  const entry = FINALITY_BY_CHAIN[key];
  if (!entry) return undefined;
  return speed === TransferSpeed.FAST ? entry.fast ?? entry.standard : entry.standard;
};
