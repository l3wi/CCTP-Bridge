"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Zap, ArrowRight, Loader2 } from "lucide-react";
import { BridgingState } from "@/components/bridging-state";
import { Skeleton } from "@/components/ui/skeleton";
import Image from "next/image";
import contracts, {
  contractsV2,
  getChainsFromId,
  isV2Supported,
  getContracts,
  getDomain,
  getAllSupportedChainIds,
} from "@/constants/contracts";
import { useAccount, useChains, useSwitchChain } from "wagmi";
import { Chain } from "viem";
import { validateBridgeParams } from "@/lib/validation";
import { getErrorMessage } from "@/lib/errors";
import { AmountState, BridgeSummaryState, LocalTransaction } from "@/lib/types";
import { useBridge } from "@/lib/hooks/useBridge";
import { useBalance } from "@/lib/hooks/useBalance";
import { blockConfirmations } from "@/constants/endpoints";
import { useToast } from "@/components/ui/use-toast";
import {
  LoadingButton,
  BalanceLoader,
  ChainSelectorSkeleton,
} from "@/components/loading/LoadingStates";
import ConnectGuard from "@/components/guards/ConnectGuard";
import ApproveGuard from "@/components/guards/ApproveGuard";
import FastTransferAllowanceGuard from "@/components/guards/FastTransferAllowanceGuard";

interface BridgeCardProps {
  onBurn?: (value: boolean) => void;
  loadedTransaction?: LocalTransaction | null;
  onBackToNew?: () => void;
}

export function BridgeCard({
  onBurn,
  loadedTransaction,
  onBackToNew,
}: BridgeCardProps) {
  // Hooks
  const { address, chain } = useAccount();
  const { toast } = useToast();
  const chains = useChains();
  const { switchChain } = useSwitchChain();
  const { burn, getFastTransferFee, isLoading: isBridgeLoading } = useBridge();
  const {
    usdcBalance,
    usdcFormatted,
    isUsdcLoading,
    hasSufficientBalance,
    needsApproval,
  } = useBalance();

  // State
  const [targetChain, setTargetChain] = useState<Chain | null>(null);
  const [amount, setAmount] = useState<AmountState | null>(null);
  const [fastTransfer, setFastTransfer] = useState(true);
  const [diffWallet, setDiffWallet] = useState(false);
  const [targetAddress, setTargetAddress] = useState<string | undefined>(
    undefined
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isBridging, setIsBridging] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isSwitchingChain, setIsSwitchingChain] = useState(false);
  const [loadedTransactionData, setLoadedTransactionData] = useState<{
    fromChain: { value: string; label: string };
    toChain: { value: string; label: string };
    amount: string;
    estimatedTime: number;
    recipient: string | null;
  } | null>(null);
  const [bridgeTransactionHash, setBridgeTransactionHash] = useState<
    `0x${string}` | null
  >(null);
  const [fetchedFee, setFetchedFee] = useState<number | null>(null);
  const [isFetchingFee, setIsFetchingFee] = useState(false);

  // Memoized values
  const usableChains = useMemo(
    () => (chain && chains ? getChainsFromId(chain.id, chains) : null),
    [chain, chains]
  );

  const availableChains = useMemo(
    () => usableChains?.filter((c) => c && c.id !== chain?.id) || [],
    [usableChains, chain?.id]
  );

  // All supported chains for "From" selector
  const supportedChains = useMemo(() => {
    const supportedChainIds = getAllSupportedChainIds();
    return chains.filter((c) => supportedChainIds.includes(c.id));
  }, [chains]);

  const chainOptions = useMemo(() => {
    return availableChains
      .filter((c): c is Chain => c != null)
      .map((c) => ({
        value: c.id.toString(),
        label: c.name,
        id: c.id,
        chain: c,
      }));
  }, [availableChains]);

  const sourceChainOptions = useMemo(() => {
    return supportedChains.map((c) => ({
      value: c.id.toString(),
      label: c.name,
      id: c.id,
      chain: c,
    }));
  }, [supportedChains]);

  // Handle amount change with validation
  const handleAmountChange = useCallback(
    (inputStr: string) => {
      try {
        // Clean the input string
        const cleanStr = inputStr.replace(/[^0-9.]/g, "");

        if (cleanStr === "") {
          setAmount(null);
          return;
        }

        // Basic format validation
        const decimalCount = (cleanStr.match(/\./g) || []).length;
        if (decimalCount > 1) {
          toast({
            title: "Invalid Format",
            description: "Please enter a valid number",
            variant: "destructive",
          });
          return;
        }

        // Check decimal places
        if (cleanStr.includes(".")) {
          const decimalPart = cleanStr.split(".")[1];
          if (decimalPart && decimalPart.length > 6) {
            toast({
              title: "Too Many Decimals",
              description: "Maximum 6 decimal places allowed",
              variant: "destructive",
            });
            return;
          }
        }

        try {
          // Convert to BigInt for validation
          let divisor = BigInt(1);
          for (let i = 0; i < 6; i++) {
            divisor = divisor * BigInt(10);
          }
          const [integerPart, decimalPart = ""] = cleanStr.split(".");
          const paddedDecimal = decimalPart.padEnd(6, "0");
          const bigIntValue = BigInt(integerPart + paddedDecimal);

          setAmount({
            str: cleanStr,
            bigInt: bigIntValue,
          });
        } catch (error) {
          console.error("Amount parsing error:", error);
          toast({
            title: "Invalid Amount",
            description: "Please enter a valid number",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error("Amount validation error:", error);
        toast({
          title: "Error",
          description: getErrorMessage(error),
          variant: "destructive",
        });
      }
    },
    [toast]
  );

  // Validation
  const validation = useMemo(
    () =>
      validateBridgeParams({
        amount,
        targetChain: targetChain?.id || null,
        targetAddress,
        sourceChain: chain?.id,
        balance: usdcBalance,
        isCustomAddress: diffWallet,
        userAddress: address,
      }),
    [
      amount,
      targetChain?.id,
      targetAddress,
      chain?.id,
      usdcBalance,
      diffWallet,
      address,
    ]
  );

  const handleMaxAmount = () => {
    if (usdcFormatted) {
      handleAmountChange(usdcFormatted);
    }
  };

  const handleSwitchChain = async (chainId: string) => {
    try {
      setIsSwitchingChain(true);
      const targetChainId = parseInt(chainId);
      await switchChain({ chainId: targetChainId });
    } catch (error) {
      console.error("Failed to switch chain:", error);
      toast({
        title: "Chain Switch Failed",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsSwitchingChain(false);
    }
  };

  // Set default chains when chains are available
  useEffect(() => {
    if (chains.length > 0 && !targetChain) {
      // Default to Arbitrum (chainId 42161)
      const defaultTarget = chains.find((c) => c.id === 42161);
      if (defaultTarget) {
        setTargetChain(defaultTarget);
      }
    }
  }, [chains, targetChain]);

  // Handle wallet connection - use connected chain as source and clear destination
  useEffect(() => {
    if (chain && chains.length > 0) {
      // When connected, find first different chain for destination
      const firstDifferentChain = availableChains.find(
        (c) => c && c.id !== chain.id
      );
      if (
        firstDifferentChain &&
        (!targetChain || targetChain.id === chain.id)
      ) {
        setTargetChain(firstDifferentChain);
      }
    }
  }, [chain?.id, chains.length, availableChains, targetChain, chain]);

  // Fetch fast transfer fee when chains change
  useEffect(() => {
    if (
      !chain ||
      !targetChain ||
      !fastTransfer ||
      !isV2Supported(chain.id) ||
      !isV2Supported(targetChain.id)
    ) {
      setFetchedFee(null);
      return;
    }

    const fetchFee = async () => {
      try {
        setIsFetchingFee(true);
        const sourceDomain = getDomain(chain.id);
        const destDomain = getDomain(targetChain.id);

        if (sourceDomain === undefined || destDomain === undefined) {
          console.warn(
            "Could not find domain for chains:",
            chain.id,
            targetChain.id
          );
          setFetchedFee(null);
          return;
        }

        if (sourceDomain === destDomain) {
          // Same-domain transfers aren't valid and Circle responds 400; skip fee lookup.
          setFetchedFee(null);
          return;
        }

        const feeTiers = await getFastTransferFee(sourceDomain, destDomain);
        const fastTier = feeTiers.find(
          (tier) => tier.finalityThreshold <= 1000
        );
        if (!fastTier) {
          console.warn(
            "No fast transfer fee tier returned for domains:",
            sourceDomain,
            destDomain
          );
          setFetchedFee(null);
          return;
        }
        setFetchedFee(fastTier.minimumFee);
      } catch (error) {
        console.error("Failed to fetch fast transfer fee:", error);
        setFetchedFee(null);
      } finally {
        setIsFetchingFee(false);
      }
    };

    fetchFee();
  }, [
    chain?.id,
    targetChain?.id,
    fastTransfer,
    getFastTransferFee,
    chain,
    targetChain,
  ]);

  const handleSend = useCallback(async () => {
    if (
      !validation.isValid ||
      !validation.data ||
      !chain ||
      !targetChain ||
      !amount
    ) {
      return;
    }

    setIsLoading(true);

    try {
      const finalTargetAddress = diffWallet
        ? validation.data.targetAddress
        : (address as `0x${string}`);

      const sourceSupportsV2 = isV2Supported(chain.id);
      const targetSupportsV2 = isV2Supported(targetChain.id);
      const supportsV2 = sourceSupportsV2 && targetSupportsV2;

      const version = supportsV2 ? "v2" : "v1";
      const transferType = fastTransfer && supportsV2 ? "fast" : "standard";

      const contractSet = getContracts(chain.id, version);
      const bridgeParams: any = {
        amount: validation.data.amount,
        sourceChainId: chain.id,
        targetChainId: validation.data.targetChain,
        targetAddress: finalTargetAddress,
        sourceTokenAddress: contractSet?.Usdc,
        version,
        transferType,
      };

      // Add fee for fast transfers if applicable
      if (version === "v2" && transferType === "fast") {
        if (fetchedFee === null) {
          toast({
            title: "Error",
            description: "No fee fetched",
            variant: "destructive",
          });
          return;
        }

        // Calculate the actual fee amount from BPS
        // fetchedFee is in BPS; Circle requires the minimum fee or higher
        // so we round up instead of truncating to avoid insufficient_fee reverts.
        const bps = BigInt(fetchedFee);
        const feeAmount =
          bps === BigInt(0)
            ? BigInt(0)
            : (validation.data.amount * bps + BigInt(9999)) / BigInt(10000);

        // Pass the calculated fee amount as maxFee (not the BPS value)
        bridgeParams.fee = feeAmount;
      }

      // Capture the transaction hash from the burn operation
      const transactionHash = await burn(bridgeParams);
      if (transactionHash) {
        setBridgeTransactionHash(transactionHash);
      }

      setIsLoading(false);
      setIsBridging(true);

      if (onBurn) {
        onBurn(true);
      }
    } catch (error) {
      console.error("Bridge transaction failed:", error);
      setIsLoading(false);
      setBridgeTransactionHash(null); // Reset on error
      toast({
        title: "Transaction Failed",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  }, [
    validation,
    chain,
    targetChain,
    amount,
    diffWallet,
    address,
    fastTransfer,
    fetchedFee,
    burn,
    onBurn,
    toast,
  ]);

  const handleBackToNew = () => {
    setIsBridging(false);
    setIsLoading(false);
    setLoadedTransactionData(null);
    setBridgeTransactionHash(null); // Reset bridge transaction hash
    // Call parent callback to reset loaded transaction
    if (onBackToNew) {
      onBackToNew();
    }
  };

  // Calculate estimated values
  const estimatedTiming = useMemo(() => {
    const fallback = { label: "~8-20s", seconds: 30 };

    if (!chain || !targetChain) {
      return fallback;
    }

    const sourceSupportsV2 = isV2Supported(chain.id);
    const targetSupportsV2 = isV2Supported(targetChain.id);
    const supportsV2 = sourceSupportsV2 && targetSupportsV2;

    if (fastTransfer && supportsV2) {
      const fastData =
        blockConfirmations.fast[
          chain.id as keyof typeof blockConfirmations.fast
        ];
      if (fastData) {
        return {
          label: fastData.time,
          seconds: fastData.seconds ?? fallback.seconds,
        };
      }
      return fallback;
    }
    const standardData =
      blockConfirmations.standard[
        chain.id as keyof typeof blockConfirmations.standard
      ];
    if (standardData) {
      return {
        label: standardData.time,
        seconds: standardData.seconds ?? 15 * 60,
      };
    }
    return { label: "~15m", seconds: 15 * 60 };
  }, [chain, targetChain, fastTransfer]);

  const bridgeFee = useMemo(() => {
    if (!amount) return "0.000000";

    let feePercentage = 0;

    if (fastTransfer) {
      if (fetchedFee !== null) {
        // Convert BPS to percentage: BPS / 10000
        feePercentage = fetchedFee / 10000;
        return (Number.parseFloat(amount.str) * feePercentage).toFixed(6);
      }
    }

    return "0.000000";
  }, [amount, fastTransfer, fetchedFee]);

  const youWillReceive = useMemo(() => {
    if (!amount) return "0.00";
    return (
      Number.parseFloat(amount.str) - Number.parseFloat(bridgeFee)
    ).toFixed(2);
  }, [amount, bridgeFee]);

  // Memoized addresses for ApproveGuard
  const spenderAddress = useMemo(() => {
    if (!chain || !targetChain) return undefined;
    const version =
      isV2Supported(chain.id) && isV2Supported(targetChain.id) ? "v2" : "v1";
    const contractSet = getContracts(chain.id, version);
    return contractSet?.TokenMessenger as `0x${string}`;
  }, [chain, targetChain]);

  const tokenAddress = useMemo(() => {
    if (!chain || !targetChain) return undefined;
    const version =
      isV2Supported(chain.id) && isV2Supported(targetChain.id) ? "v2" : "v1";
    const contractSet = getContracts(chain.id, version);
    return contractSet?.Usdc as `0x${string}`;
  }, [chain, targetChain]);

  // Effect to handle loaded transaction from history
  useEffect(() => {
    if (loadedTransaction && loadedTransaction.status === "pending") {
      // Find the chains for the transaction
      const originChain = chains.find(
        (c) => c.id === loadedTransaction.originChain
      );
      const targetChainData = chains.find(
        (c) => c.id === loadedTransaction.targetChain
      );

      if (originChain && targetChainData && loadedTransaction.amount) {
        const fromChain = {
          value: originChain.id.toString(),
          label: originChain.name,
        };
        const toChain = {
          value: targetChainData.id.toString(),
          label: targetChainData.name,
        };

        // Calculate estimated time based on transaction details
        const version = loadedTransaction.version || "v1";
        const transferType = loadedTransaction.transferType || "standard";
        const fastEntry =
          blockConfirmations.fast[
            originChain.id as keyof typeof blockConfirmations.fast
          ];
        const standardEntry =
          blockConfirmations.standard[
            originChain.id as keyof typeof blockConfirmations.standard
          ];
        const fallbackSeconds =
          version === "v2" && transferType === "fast" ? 30 : 15 * 60;
        const estimatedTime =
          version === "v2" && transferType === "fast"
            ? fastEntry?.seconds ?? fallbackSeconds
            : standardEntry?.seconds ?? fallbackSeconds;

        setLoadedTransactionData({
          fromChain,
          toChain,
          amount: loadedTransaction.amount,
          estimatedTime,
          recipient: loadedTransaction.targetAddress || null,
        });
        setIsBridging(true);
      }
    }
  }, [loadedTransaction, chains]);

  // Loading states
  const showChainLoader = !chains.length; // Only show loader when chains haven't loaded
  const showBalanceLoader = isUsdcLoading && !!address && !!chain;

  if (isBridging) {
    // Use loaded transaction data if available, otherwise use form data
    if (loadedTransactionData && loadedTransaction) {
      // Find the destination chain object for loaded transaction
      const destinationChain = chains.find(
        (c) => c.id === loadedTransaction.targetChain
      );

      return (
        <BridgingState
          fromChain={loadedTransactionData.fromChain}
          toChain={loadedTransactionData.toChain}
          amount={loadedTransactionData.amount}
          estimatedTime={loadedTransactionData.estimatedTime}
          recipientAddress={loadedTransactionData.recipient || undefined}
          onViewHistory={() => setHistoryOpen(true)}
          onBack={handleBackToNew}
          // Required props for attestation fetching
          hash={loadedTransaction.hash}
          originChainId={loadedTransaction.originChain}
          destinationChain={destinationChain}
          version={loadedTransaction.version || "v2"}
        />
      );
    } else if (targetChain && amount && bridgeTransactionHash && chain) {
      const fromChain = {
        value: chain.id.toString(),
        label: chain.name,
      };
      const toChain = {
        value: targetChain.id.toString(),
        label: targetChain.name,
      };

      // Determine version for current bridge
      const sourceSupportsV2 = isV2Supported(chain.id);
      const targetSupportsV2 = isV2Supported(targetChain.id);
      const supportsV2 = sourceSupportsV2 && targetSupportsV2;
      const version = supportsV2 ? "v2" : "v1";

      const recipientAddressValue =
        diffWallet && targetAddress
          ? targetAddress
          : (address as `0x${string}` | undefined);

      return (
        <BridgingState
          fromChain={fromChain}
          toChain={toChain}
          amount={amount.str}
          estimatedTime={estimatedTiming.seconds}
          recipientAddress={recipientAddressValue}
          onViewHistory={() => setHistoryOpen(true)}
          onBack={handleBackToNew}
          // Required props for attestation fetching
          hash={bridgeTransactionHash}
          originChainId={chain.id}
          destinationChain={targetChain}
          version={version}
        />
      );
    }
  }

  return (
    <>
      <Card className="bg-gradient-to-br from-slate-800/95 via-slate-800/98 to-slate-900/100 backdrop-blur-sm border-slate-700/50 text-white">
        <CardContent className="p-6 space-y-6">
          {/* Chain Selectors */}
          <div className="flex items-center gap-3 md:flex-row flex-col">
            <div className="w-full md:flex-1">
              <Label className="text-sm text-slate-300 mb-2 block">From</Label>
              {showChainLoader ? (
                <ChainSelectorSkeleton />
              ) : (
                <Select
                  value={chain?.id.toString() || "1"}
                  onValueChange={handleSwitchChain}
                  disabled={isLoading || isSwitchingChain || !address}
                >
                  <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white">
                    <SelectValue placeholder="Select Chain...">
                      {(() => {
                        const displayChain =
                          chain || chains.find((c) => c.id === 1);
                        return displayChain ? (
                          <div className="flex items-center gap-2">
                            {isSwitchingChain ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Image
                                src={`/${displayChain.id}.svg`}
                                width={16}
                                height={16}
                                className="w-4 h-4"
                                alt={displayChain.name}
                              />
                            )}
                            <span>{displayChain.name}</span>
                            {isSwitchingChain && (
                              <span className="text-xs text-slate-400 ml-auto">
                                Switching...
                              </span>
                            )}
                          </div>
                        ) : null;
                      })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {sourceChainOptions.map((chainOption) => (
                      <SelectItem
                        key={chainOption.value}
                        value={chainOption.value}
                        className="text-white hover:bg-slate-700"
                      >
                        <div className="flex items-center gap-2">
                          <Image
                            src={`/${chainOption.id}.svg`}
                            width={16}
                            height={16}
                            className="w-4 h-4"
                            alt={chainOption.label}
                          />
                          <span>{chainOption.label}</span>
                          {/* Show current chain indicator */}
                          {chain?.id === chainOption.id && (
                            <span
                              className="ml-auto text-green-500"
                              title="Current chain"
                            >
                              ●
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="justify-center pt-6 hidden md:flex">
              <div className="rounded-full bg-slate-700/50 border border-slate-600 h-8 w-8 flex items-center justify-center">
                <ArrowRight className="h-4 w-4 text-slate-400" />
              </div>
            </div>

            <div className="w-full md:flex-1">
              <Label className="text-sm text-slate-300 mb-2 block">To</Label>
              {showChainLoader ? (
                <ChainSelectorSkeleton />
              ) : (
                <Select
                  value={targetChain?.id.toString() || "42161"}
                  onValueChange={(value) => {
                    const selectedChain = supportedChains.find(
                      (c) => c?.id.toString() === value
                    );
                    setTargetChain(selectedChain || null);
                  }}
                  disabled={isLoading}
                >
                  <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white">
                    <SelectValue placeholder="Select Chain...">
                      {(() => {
                        const displayChain =
                          targetChain || chains.find((c) => c.id === 42161);
                        return displayChain ? (
                          <div className="flex items-center gap-2">
                            <Image
                              src={`/${displayChain.id}.svg`}
                              width={16}
                              height={16}
                              className="w-4 h-4"
                              alt={displayChain.name}
                            />
                            <span className="truncate">
                              {displayChain.name}
                            </span>
                            {/* Show lightning bolt if both chains support V2 */}
                            {isV2Supported(chain?.id || 1) &&
                              isV2Supported(displayChain.id) && (
                                <Zap className="h-4 w-4 text-yellow-400" />
                              )}
                          </div>
                        ) : null;
                      })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {supportedChains
                      .filter((c) => c.id !== (chain?.id || 1)) // Exclude current chain or default (Ethereum)
                      .map((c) => ({
                        value: c.id.toString(),
                        label: c.name,
                        id: c.id,
                        chain: c,
                      }))
                      .map((chainOption) => (
                        <SelectItem
                          key={chainOption.value}
                          value={chainOption.value}
                          className="text-white hover:bg-slate-700"
                        >
                          <div className="flex items-center gap-2">
                            <Image
                              src={`/${chainOption.id}.svg`}
                              width={16}
                              height={16}
                              className="w-4 h-4"
                              alt={chainOption.label}
                            />
                            <span>{chainOption.label}</span>
                            {/* Show lightning bolt if both chains support V2 */}
                            {isV2Supported(chain?.id || 1) &&
                              isV2Supported(chainOption.id) && (
                                <Zap className="h-4 w-4 text-yellow-400" />
                              )}
                          </div>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {/* Amount Input */}
          <div className="bg-slate-900/50 rounded-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <Label className="text-sm text-slate-300">Amount</Label>
              <div className="flex items-center gap-2">
                {showBalanceLoader ? (
                  <BalanceLoader />
                ) : (
                  <span className="text-sm text-slate-400">
                    {usdcFormatted ? `Balance: ${usdcFormatted}` : ""}
                  </span>
                )}
                <LoadingButton
                  variant="ghost"
                  onClick={handleMaxAmount}
                  className="text-xs text-blue-400 hover:text-blue-300 h-6 px-2"
                  disabled={!usdcFormatted || isLoading}
                  isLoading={false}
                >
                  Max
                </LoadingButton>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Input
                value={amount?.str || ""}
                onChange={(e) => handleAmountChange(e.target.value)}
                className="bg-transparent border-none text-2xl font-semibold p-0 h-auto focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                placeholder="0.0"
                disabled={isLoading}
              />
              <span className="text-lg text-slate-400">USDC</span>
            </div>
          </div>

          {/* Custom Address Option */}
          {address && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="custom-address"
                checked={diffWallet}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setDiffWallet(true);
                    setTargetAddress(address);
                  } else {
                    setDiffWallet(false);
                    setTargetAddress(undefined);
                  }
                }}
                disabled={isLoading}
              />
              <Label
                htmlFor="custom-address"
                className="text-xs text-slate-300"
              >
                Send USDC to a different wallet
                {targetChain && ` on ${targetChain.name}`}?
              </Label>
            </div>
          )}
          {diffWallet && (
            <div className="space-y-2">
              <Label className="text-sm text-slate-300">
                Destination Wallet
              </Label>
              <Input
                placeholder="0x..."
                value={targetAddress || ""}
                onChange={(e) => setTargetAddress(e.target.value)}
                className="bg-slate-700/50 border-slate-600 text-white"
                disabled={isLoading}
              />
            </div>
          )}

          {/* Send Button */}
          <ConnectGuard>
            {chain && amount && targetChain ? (
              <ApproveGuard
                token={tokenAddress!}
                spender={spenderAddress!}
                amount={amount.bigInt}
              >
                <FastTransferAllowanceGuard
                  transferAmount={amount.str}
                  isEnabled={
                    fastTransfer &&
                    isV2Supported(chain.id) &&
                    isV2Supported(targetChain.id)
                  }
                >
                  <LoadingButton
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3"
                    onClick={handleSend}
                    isLoading={isLoading || isBridgeLoading}
                    disabled={
                      !validation.isValid || isLoading || isBridgeLoading
                    }
                  >
                    {validation.isValid
                      ? "Bridge USDC"
                      : validation.errors[0] || "Complete the form"}
                  </LoadingButton>
                </FastTransferAllowanceGuard>
              </ApproveGuard>
            ) : (
              <LoadingButton
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3"
                onClick={handleSend}
                isLoading={isLoading || isBridgeLoading}
                disabled={!validation.isValid || isLoading || isBridgeLoading}
              >
                {validation.isValid
                  ? "Bridge USDC"
                  : validation.errors[0] || "Complete the form"}
              </LoadingButton>
            )}
          </ConnectGuard>

          {/* Bridge Summary */}
          <div className="space-y-3 pt-2 border-t border-slate-700/50">
            {isV2Supported(chain?.id || 0) &&
              isV2Supported(targetChain?.id || 0) && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-yellow-400" />
                    <Label htmlFor="fast-transfer" className="text-sm">
                      Fast Transfer
                    </Label>
                  </div>
                  <Switch
                    id="fast-transfer"
                    checked={fastTransfer}
                    onCheckedChange={setFastTransfer}
                    disabled={
                      isLoading ||
                      !chain ||
                      !targetChain ||
                      !isV2Supported(chain?.id || 0) ||
                      !isV2Supported(targetChain?.id || 0)
                    }
                  />
                </div>
              )}

            {isLoading ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Recipient address</span>
                  <Skeleton className="h-4 w-24 bg-slate-700" />
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Time spend</span>
                  <Skeleton className="h-4 w-16 bg-slate-700" />
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Transaction fees</span>
                  <Skeleton className="h-4 w-20 bg-slate-700" />
                </div>
                <div className="flex justify-between font-medium">
                  <span className="text-slate-300">You will receive</span>
                  <Skeleton className="h-4 w-24 bg-slate-700" />
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Recipient address</span>
                  <span className="text-slate-300">
                    {diffWallet && targetAddress
                      ? `${targetAddress.slice(0, 6)}...${targetAddress.slice(
                          -4
                        )}`
                      : address
                      ? `${address.slice(0, 6)}...${address.slice(-4)}`
                      : "Not connected"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Time spend</span>
                  <span className="text-slate-300">{estimatedTiming.label}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span className="text-slate-300">You will receive</span>
                  <span className="text-white">
                    {`${youWillReceive} USDC (${bridgeFee} USDC)`}
                  </span>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
