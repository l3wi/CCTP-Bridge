"use client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ArrowRight, Clock, DollarSign, Zap } from "lucide-react";
import Image from "next/image";
import { parseUnits } from "viem";
import { BridgeSummaryState, V2FastBurnFeesResponse } from "@/lib/types";
import { isV2Supported, domains, getContracts } from "@/constants/contracts";
import { blockConfirmations } from "@/constants/endpoints";
import { useState, useEffect } from "react";
import { useBridge } from "@/lib/hooks/useBridge";
import ApproveGuard from "@/components/guards/ApproveGuard";
import FastTransferAllowanceGuard from "@/components/guards/FastTransferAllowanceGuard";
import { useAccount } from "wagmi";

interface BridgeSummaryProps {
  summary: BridgeSummaryState;
  onConfirm: (
    version: "v1" | "v2",
    transferType: "standard" | "fast",
    fee?: number
  ) => void;
  onBack: () => void;
  isLoading?: boolean;
}

export function BridgeSummary({
  summary,
  onConfirm,
  onBack,
  isLoading = false,
}: BridgeSummaryProps) {
  const [selectedTransferType, setSelectedTransferType] = useState<
    "standard" | "fast"
  >("fast");
  const [feeData, setFeeData] = useState<V2FastBurnFeesResponse | null>(null);
  const [loadingFee, setLoadingFee] = useState(false);

  const { getFastTransferFee } = useBridge();
  const { address } = useAccount();

  const isV2Available =
    isV2Supported(summary.sourceChain.id) &&
    isV2Supported(summary.targetChain.id);

  // Determine version based on transfer type and availability
  const selectedVersion: "v1" | "v2" =
    selectedTransferType === "fast" ||
    (selectedTransferType === "standard" && isV2Available)
      ? "v2"
      : "v1";

  // Get the appropriate contract addresses for approval
  const sourceContracts = getContracts(summary.sourceChain.id, selectedVersion);

  // Convert amount to bigint for approval guard
  const amountBigInt = parseUnits(summary.amount.str, 6);

  // Reset to standard if fast is selected but V2 is not available
  useEffect(() => {
    if (!isV2Available && selectedTransferType === "fast") {
      setSelectedTransferType("standard");
    }
  }, [isV2Available, selectedTransferType]);

  // Fetch fees for fast transfers
  useEffect(() => {
    if (selectedVersion === "v2" && selectedTransferType === "fast") {
      const fetchFees = async () => {
        setLoadingFee(true);
        try {
          const sourceDomain = domains[summary.sourceChain.id];
          const destDomain = domains[summary.targetChain.id];

          if (sourceDomain !== undefined && destDomain !== undefined) {
            const fees = await getFastTransferFee(sourceDomain, destDomain);
            setFeeData(fees);
          }
        } catch (error) {
          console.error("Failed to fetch fast transfer fees:", error);
          setFeeData(null);
        } finally {
          setLoadingFee(false);
        }
      };

      fetchFees();
    } else {
      setFeeData(null);
      setLoadingFee(false);
    }
  }, [
    selectedVersion,
    selectedTransferType,
    summary.sourceChain.id,
    summary.targetChain.id,
    getFastTransferFee,
  ]);

  const getEstimatedTime = (
    version: "v1" | "v2",
    transferType: "standard" | "fast"
  ) => {
    if (version === "v2" && transferType === "fast") {
      return (
        blockConfirmations.fast[
          summary.sourceChain.id as keyof typeof blockConfirmations.fast
        ]?.time || "~8-20 seconds"
      );
    }
    return (
      blockConfirmations.standard[
        summary.sourceChain.id as keyof typeof blockConfirmations.standard
      ]?.time || "13-19 minutes"
    );
  };

  const getFee = (version: "v1" | "v2", transferType: "standard" | "fast") => {
    if (version === "v2" && transferType === "fast") {
      if (loadingFee) {
        return "Loading...";
      }
      if (feeData) {
        const feeBPS = feeData.minimumFee;
        if (feeBPS === 0) return "Free";

        // Calculate actual fee amount from BPS
        const feeAmount = getFeeAmount(version, transferType);
        const feePercentage = (feeBPS / 10000) * 100; // Convert BPS to percentage

        return `${feeAmount
          .toFixed(6)
          .replace(/\.?0+$/, "")} USDC (${feePercentage}%)`;
      }
      return "Error loading fee";
    }
    return "Free";
  };

  const getFeeAmount = (
    version: "v1" | "v2",
    transferType: "standard" | "fast"
  ): number => {
    if (version === "v2" && transferType === "fast" && feeData) {
      const feeBPS = BigInt(feeData.minimumFee);
      // Calculate fee using bigInt: (amount * feeBPS) / 10000
      // Then convert back to number with proper decimals (6 for USDC)
      const feeInWei = (summary.amount.bigInt * feeBPS) / BigInt(10000);
      return Number(feeInWei) / 1000000; // Convert from wei to USDC (6 decimals)
    }
    return 0;
  };

  const getReceiveAmount = (): string => {
    const originalAmount = parseFloat(summary.amount.str);
    const feeAmount = getFeeAmount(selectedVersion, selectedTransferType);
    const netAmount = originalAmount - feeAmount;

    // Ensure we don't show negative amounts
    return Math.max(0, netAmount)
      .toFixed(6)
      .replace(/\.?0+$/, "");
  };

  const currentEstimatedTime = getEstimatedTime(
    selectedVersion,
    selectedTransferType
  );
  const currentFee = getFee(selectedVersion, selectedTransferType);
  const receiveAmount = getReceiveAmount();

  // Check if we need fast transfer allowance check
  const needsFastTransferCheck =
    selectedVersion === "v2" && selectedTransferType === "fast";

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex items-center justify-between mb-2">
        <span>Bridge Summary</span>
        <Badge variant={selectedVersion === "v2" ? "default" : "secondary"}>
          via CCTP {selectedVersion.toUpperCase()}
        </Badge>
      </div>
      {/* Route Summary */}
      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
        <div className="flex items-center space-x-3">
          <Image
            src={`/${summary.sourceChain.id}.svg`}
            width={32}
            height={32}
            alt={summary.sourceChain.name}
            className="w-8 h-8"
          />
          <div>
            <p className="font-medium text-sm">{summary.sourceChain.name}</p>
            <p className="text-xs text-gray-500">{summary.amount.str} USDC</p>
          </div>
        </div>

        <ArrowRight className="w-5 h-5 text-gray-400" />

        <div className="flex items-center space-x-3">
          <Image
            src={`/${summary.targetChain.id}.svg`}
            width={32}
            height={32}
            alt={summary.targetChain.name}
            className="w-8 h-8"
          />
          <div>
            <p className="font-medium text-sm">{summary.targetChain.name}</p>
            <p className="text-xs text-gray-500">
              {summary.targetAddress.slice(0, 6)}...
              {summary.targetAddress.slice(-4)}
            </p>
          </div>
        </div>
      </div>

      {/* Transfer Speed Selection (only show if V2 is available for fast option) */}
      {isV2Available && (
        <>
          <div className="space-y-3">
            <Label className="text-sm font-medium">Transfer Speed</Label>
            <RadioGroup
              value={selectedTransferType}
              onValueChange={(value: "standard" | "fast") =>
                setSelectedTransferType(value)
              }
              className="space-y-2"
            >
              <div className="flex items-start space-x-3 p-3 border rounded-lg">
                <RadioGroupItem value="fast" id="fast" className="mt-1" />
                <div className="flex-1">
                  <Label
                    htmlFor="fast"
                    className="flex items-center space-x-2 cursor-pointer"
                  >
                    <Zap className="w-4 h-4" />
                    <span className="font-medium">Fast Transfer</span>
                    <Badge variant="default" className="text-xs">
                      Premium
                    </Badge>
                  </Label>
                  <p className="text-xs text-gray-500 mt-1">8-20 seconds</p>
                </div>
              </div>
              <div className="flex items-start space-x-3 p-3 border rounded-lg">
                <RadioGroupItem
                  value="standard"
                  id="standard"
                  className="mt-1"
                />
                <div className="flex-1">
                  <Label
                    htmlFor="standard"
                    className="flex items-center space-x-2 cursor-pointer"
                  >
                    <Clock className="w-4 h-4" />
                    <span className="font-medium">Standard Transfer</span>
                    <Badge variant="secondary" className="text-xs">
                      Free
                    </Badge>
                  </Label>
                  <p className="text-xs text-gray-500 mt-1">13-19 minutes</p>
                </div>
              </div>
            </RadioGroup>
          </div>

          <Separator />
        </>
      )}

      {/* Transaction Details */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Clock className="w-4 h-4 text-gray-500" />
            <span className="text-sm">Estimated Time</span>
          </div>
          <span className="text-sm font-medium">{currentEstimatedTime}</span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <DollarSign className="w-4 h-4 text-gray-500" />
            <span className="text-sm">Bridge Fee</span>
          </div>
          <span className="text-sm font-medium">{currentFee}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm">You will receive</span>
          <span className="text-sm font-medium">{receiveAmount} USDC</span>
        </div>
      </div>

      <Separator />

      {/* Action Buttons */}
      <div className="flex space-x-3">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={isLoading}
          className="flex-1"
        >
          Back
        </Button>

        {/* Approval Guards */}
        {!address ? (
          <Button disabled className="flex-1">
            Connect Wallet
          </Button>
        ) : !sourceContracts ? (
          <Button disabled className="flex-1">
            Contract not found
          </Button>
        ) : (
          <ApproveGuard
            token={sourceContracts.Usdc as `0x${string}`}
            spender={sourceContracts.TokenMessenger as `0x${string}`}
            amount={amountBigInt}
          >
            <FastTransferAllowanceGuard
              transferAmount={summary.amount.str}
              isEnabled={needsFastTransferCheck}
            >
              <Button
                onClick={() => {
                  // Pass the BPS value for fast transfers, not the calculated amount
                  const feeBPS =
                    selectedVersion === "v2" &&
                    selectedTransferType === "fast" &&
                    feeData
                      ? feeData.minimumFee
                      : 0;
                  onConfirm(selectedVersion, selectedTransferType, feeBPS);
                }}
                disabled={isLoading}
                className="flex-1"
              >
                {isLoading ? "Processing..." : `Confirm Bridge`}
              </Button>
            </FastTransferAllowanceGuard>
          </ApproveGuard>
        )}
      </div>

      {/* Disclaimer */}
      <div className="text-xs text-gray-500 text-center p-3 bg-gray-50 rounded-lg">
        {selectedTransferType === "fast"
          ? "Fast transfers use CCTP V2 and include additional fees for faster processing."
          : "This transaction will be processed using Circle's Cross-Chain Transfer Protocol."}
      </div>
    </div>
  );
}
