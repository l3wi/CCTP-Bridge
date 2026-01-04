"use client";

import { NetworkIcon } from "@web3icons/react/dynamic";
import Image from "next/image";

interface ChainIconProps {
  chainId: number;
  size: number;
  className?: string;
}

export function ChainIcon({ chainId, size, className }: ChainIconProps) {
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
        />
      }
    />
  );
}
