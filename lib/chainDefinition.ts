import type { ChainDefinition } from "@circle-fin/bridge-kit";
import type { UniversalChainMetadata } from "@/lib/metadata/types";

type ChainCctp = NonNullable<ChainDefinition["cctp"]>;
type ChainContracts = NonNullable<ChainCctp["contracts"]>;

const normalizeVersionConfig = (
  config:
    | {
        type?: string;
        contract?: string;
        tokenMessenger?: string;
        messageTransmitter?: string;
        confirmations?: number;
      }
    | undefined
): ChainContracts["v1"] | undefined => {
  if (!config || typeof config.confirmations !== "number") {
    return undefined;
  }

  if (
    config.type === "split" &&
    config.tokenMessenger &&
    config.messageTransmitter
  ) {
    return {
      type: "split",
      tokenMessenger: config.tokenMessenger,
      messageTransmitter: config.messageTransmitter,
      confirmations: config.confirmations,
    };
  }

  if (config.type === "merged" && config.contract) {
    return {
      type: "merged",
      contract: config.contract,
      confirmations: config.confirmations,
    };
  }

  return undefined;
};

const toCctpConfig = (
  chain: UniversalChainMetadata
): ChainDefinition["cctp"] => {
  if (chain.cctp?.domain === undefined) {
    return null;
  }

  const v1 = normalizeVersionConfig(chain.cctp.contracts?.v1);
  const v2Base = normalizeVersionConfig(chain.cctp.contracts?.v2);
  const v2 =
    v2Base && typeof chain.cctp.contracts?.v2?.fastConfirmations === "number"
      ? {
          ...v2Base,
          fastConfirmations: chain.cctp.contracts.v2.fastConfirmations,
        }
      : undefined;

  const contracts: ChainContracts = {};
  if (v1) contracts.v1 = v1;
  if (v2) contracts.v2 = v2;

  return {
    domain: chain.cctp.domain,
    contracts,
  };
};

export const toChainDefinition = (
  chain: UniversalChainMetadata
): ChainDefinition => {
  const base = {
    chain: chain.chain as ChainDefinition["chain"],
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    isTestnet: chain.isTestnet,
    explorerUrl: chain.explorerUrl ?? "",
    rpcEndpoints: chain.rpcEndpoints ?? [],
    eurcAddress: chain.eurcAddress ?? null,
    usdcAddress: chain.usdcAddress ?? null,
    cctp: toCctpConfig(chain),
  };

  if (chain.type === "evm") {
    return {
      ...base,
      type: "evm",
      chainId: chain.chainId,
    };
  }

  return {
    ...base,
    type: "solana",
  };
};
