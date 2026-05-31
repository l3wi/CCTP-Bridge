import type { SolanaChainId } from "@/lib/types";

export type BridgeEnvironment = "mainnet" | "testnet";

export interface NativeCurrency {
  name: string;
  symbol: string;
  decimals: number;
}

export interface CctpContractConfig {
  type?: string;
  contract?: string;
  tokenMessenger?: string;
  messageTransmitter?: string;
  confirmations?: number;
  fastConfirmations?: number;
}

export interface CctpContracts {
  v1?: CctpContractConfig;
  v2?: CctpContractConfig;
}

export interface CctpMetadata {
  domain?: number;
  contracts?: CctpContracts;
  forwarderSupported?: {
    source: boolean;
    destination: boolean;
  };
}

export interface KitContracts {
  bridge?: string;
}

interface BaseChainMetadata {
  name: string;
  isTestnet: boolean;
  explorerUrl?: string;
  usdcAddress?: string;
  eurcAddress?: string;
  usdtAddress?: string;
  nativeCurrency: NativeCurrency;
  cctp?: CctpMetadata;
  kitContracts?: KitContracts;
}

export interface EvmChainMetadata extends BaseChainMetadata {
  type: "evm";
  chain: string;
  chainId: number;
  rpcEndpoints?: string[];
}

export interface SolanaChainMetadata extends BaseChainMetadata {
  type: "solana";
  chain: SolanaChainId;
  rpcEndpoints?: string[];
}

export type UniversalChainMetadata = EvmChainMetadata | SolanaChainMetadata;

export interface GeneratedCctpMetadata {
  version: 1;
  generatedAt: string;
  source: string;
  chains: UniversalChainMetadata[];
}

export interface RpcValidationConfig {
  corsOrigin: string;
  requestTimeoutMs: number;
  maxCandidatesPerChain: number;
  maxValidUrlsPerChain: number;
}

export interface EvmRpcEntry {
  chainId: number;
  chainName: string;
  isTestnet: boolean;
  urls: string[];
  testedCount: number;
  passedCount: number;
  warnings: string[];
}

export interface SolanaRpcEntry {
  chain: SolanaChainId;
  urls: string[];
}

export interface GeneratedRpcMetadata {
  version: 1;
  generatedAt: string;
  source: string;
  validation: RpcValidationConfig;
  evm: EvmRpcEntry[];
  solana: SolanaRpcEntry[];
  missingChainIds: number[];
}
