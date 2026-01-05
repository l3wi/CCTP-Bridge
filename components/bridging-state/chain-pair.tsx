import { ArrowRight } from "lucide-react";
import { ChainIcon } from "@/components/chain-icon";
import type { ChainPairProps } from "./types";

export function ChainPair({ from, to, amount, status }: ChainPairProps) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <ChainIcon chainId={from.value} size={24} />
        <div>
          <div className="font-medium">{from.label}</div>
          <div className="text-xs text-slate-400">{amount} USDC</div>
        </div>
      </div>
      <ArrowRight className="text-slate-500" />
      <div className="flex items-center gap-2">
        <ChainIcon chainId={to.value} size={24} />
        <div>
          <div className="font-medium">{to.label}</div>
          <div className="text-xs text-slate-400">
            {status === "success" ? "Minted" : "Pending"}
          </div>
        </div>
      </div>
    </div>
  );
}
