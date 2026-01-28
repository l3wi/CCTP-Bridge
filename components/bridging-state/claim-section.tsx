import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ClaimSectionProps } from "./types";

export function ClaimSection({
  showClaimButton,
  amount,
  destinationLabel,
  onDestinationChain,
  isClaiming,
  isCheckingMint,
  isSwitchingChain,
  onClaim,
  messageExpired,
  onReattest,
  isReattesting,
}: ClaimSectionProps) {
  // Show re-attest button if message has expired
  if (messageExpired && onReattest) {
    return (
      <div className="flex flex-col gap-2">
        <Button
          className="w-full bg-amber-600 hover:bg-amber-700 text-white"
          disabled={isReattesting}
          onClick={onReattest}
        >
          {isReattesting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Requesting new attestation...
            </span>
          ) : (
            "Attestation Expired. Request a new Attestation."
          )}
        </Button>
      </div>
    );
  }

  if (!showClaimButton) return null;

  return (
    <div className="flex flex-col gap-2">
      <Button
        className="w-full bg-blue-600 hover:bg-blue-700 text-white"
        disabled={isSwitchingChain || isClaiming}
        onClick={onClaim}
      >
        {isClaiming ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Claiming...
          </span>
        ) : onDestinationChain ? (
          `Claim ${amount} USDC`
        ) : (
          `Switch chain to ${destinationLabel}`
        )}
      </Button>
      {isCheckingMint && (
        <p className="text-xs text-slate-500 text-center">
          Checking mint status...
        </p>
      )}
    </div>
  );
}
