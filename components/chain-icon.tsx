"use client";

import { NetworkIcon, TokenIcon } from "@web3icons/react/dynamic";
import Image from "next/image";
import type { ChainId } from "@/lib/types";
import { isSolanaChain } from "@/lib/types";

interface ChainIconProps {
  chainId: ChainId;
  size: number;
  className?: string;
}

export function ChainIcon({ chainId, size, className }: ChainIconProps) {
  // Handle Solana chains using TokenIcon with SOL symbol
  if (isSolanaChain(chainId)) {
    return (
      <TokenIcon
        symbol="SOL"
        size={size}
        variant="branded"
        className={className}
      />
    );
  }

  // Handle EVM chains
  return (
    <NetworkIcon
      chainId={chainId}
      size={size}
      variant="branded"
      className={className}
      fallback={
        <Image
          src={`/${chainId}.svg`}
          width={size}
          height={size}
          alt={`Chain ${chainId}`}
          className={className}
          style={{ width: size, height: size }}
        />
      }
    />
  );
}
