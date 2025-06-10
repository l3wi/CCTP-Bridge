import React, { useState, useEffect } from "react";
import { Button } from "../ui/button";
import { useToast } from "../ui/use-toast";
import { useBridge } from "@/lib/hooks/useBridge";
import { formatUnits } from "viem";

interface FastTransferAllowanceGuardProps {
  transferAmount: string; // Human-readable amount string (e.g., "100.5")
  isEnabled: boolean; // Only check for fast transfers
  children?: React.ReactNode;
}

export default function FastTransferAllowanceGuard({
  transferAmount,
  isEnabled,
  children,
}: FastTransferAllowanceGuardProps) {
  const [allowanceData, setAllowanceData] = useState<{
    allowance: number;
    lastUpdated: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const { getFastTransferAllowance } = useBridge();
  const { toast } = useToast();

  // Convert transfer amount to number for comparison with API allowance
  // The API returns allowance in human-readable format (USDC units)
  // transferAmount is already in human-readable format (e.g., "100.5")
  const transferAmountNumber = parseFloat(transferAmount);

  // Alternative: If API returns allowance in smallest units (1e6), use this instead:
  // const allowanceInUSDC = allowanceData ? allowanceData.allowance / 1e6 : 0;

  useEffect(() => {
    if (!isEnabled) {
      setAllowanceData(null);
      setHasError(false);
      return;
    }

    const fetchAllowance = async () => {
      setIsLoading(true);
      setHasError(false);
      try {
        const data = await getFastTransferAllowance();
        setAllowanceData(data);
      } catch (error) {
        console.error("Failed to fetch fast transfer allowance:", error);
        setHasError(true);
        toast({
          title: "Fast Transfer Allowance Error",
          description:
            "Failed to check fast transfer allowance. Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchAllowance();
  }, [isEnabled, getFastTransferAllowance, toast]);

  // If not enabled (not a fast transfer), just render children
  if (!isEnabled) {
    return <>{children}</>;
  }

  // If still loading allowance data
  if (isLoading) {
    return (
      <Button
        disabled
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3"
      >
        Checking Fast Transfer Allowance...
      </Button>
    );
  }

  // If error fetching allowance
  if (hasError) {
    return (
      <Button
        disabled
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3"
      >
        Error Checking Fast Transfer Allowance
      </Button>
    );
  }

  // Check if allowance is sufficient
  // Both values should be in human-readable USDC format for comparison
  const hasSufficientAllowance = allowanceData
    ? allowanceData.allowance >= transferAmountNumber
    : false;

  // Alternative for smallest units: allowanceInUSDC >= transferAmountNumber

  if (!hasSufficientAllowance) {
    return (
      <div className="space-y-2">
        <Button disabled className="w-full">
          Insufficient Fast Transfer Allowance
        </Button>
        <div className="text-xs text-red-600 text-center">
          Fast transfer allowance: $
          {allowanceData?.allowance?.toFixed(6) || "0"} USDC
          <br />
          Required: ${transferAmountNumber.toFixed(6)} USDC
        </div>
      </div>
    );
  }

  // If allowance is sufficient, render children
  return <>{children}</>;
}
