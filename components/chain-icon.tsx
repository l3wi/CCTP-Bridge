"use client";

import { useState } from "react";
import { NetworkIcon, TokenIcon } from "@web3icons/react/dynamic";
import Image from "next/image";
import type { ChainId } from "@/lib/types";
import { isSolanaChain } from "@/lib/types";

interface ChainIconProps {
  chainId: ChainId;
  size: number;
  className?: string;
}

function GenericChainPlaceholder({
  chainId,
  size,
  className,
}: ChainIconProps) {
  return (
    <div
      role="img"
      aria-label={`Unknown chain ${chainId}`}
      className={className}
      style={{ width: size, height: size }}
    >
      <div
        className="flex h-full w-full items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-[0.65rem] font-semibold leading-none text-slate-500"
        aria-hidden="true"
      >
        ?
      </div>
    </div>
  );
}

function LocalChainIcon({
  chainId,
  size,
  className,
}: ChainIconProps) {
  const [hasImageError, setHasImageError] = useState(false);

  if (hasImageError) {
    return (
      <GenericChainPlaceholder
        chainId={chainId}
        size={size}
        className={className}
      />
    );
  }

  return (
    <Image
      src={`/${chainId}.svg`}
      width={size}
      height={size}
      alt={`Chain ${chainId}`}
      className={className}
      style={{ width: size, height: size }}
      onError={() => setHasImageError(true)}
    />
  );
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
        <LocalChainIcon chainId={chainId} size={size} className={className} />
      }
    />
  );
}
