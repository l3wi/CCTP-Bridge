"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ArrowRight, Loader2 } from "lucide-react";
import { BridgingState } from "@/components/bridging-state";
import Image from "next/image";
import {
  useAccount,
  useChains,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import { Chain, formatUnits } from "viem";
import {
  validateBridgeParams,
  validateAmount,
  validateChainSelection,
} from "@/lib/validation";
import { getErrorMessage } from "@/lib/errors";
import { AmountState, LocalTransaction } from "@/lib/types";
import { useBridge } from "@/lib/hooks/useBridge";
import { useBalance } from "@/lib/hooks/useBalance";
import { useToast } from "@/components/ui/use-toast";
import {
  LoadingButton,
  BalanceLoader,
  ChainSelectorSkeleton,
} from "@/components/loading/LoadingStates";
import ConnectGuard from "@/components/guards/ConnectGuard";
import type { BridgeResult } from "@circle-fin/bridge-kit";
import { TransferSpeed } from "@circle-fin/bridge-kit";
import {
  createViemAdapter,
  getBridgeChainById,
  getCctpConfirmations,
  getBridgeKit,
  getChainIdentifier,
  getSupportedEvmChains,
  getProviderFromWalletClient,
} from "@/lib/bridgeKit";
import { useQuery } from "@tanstack/react-query";
import { getFinalityEstimate } from "@/lib/cctpFinality";

type BridgeEstimateResult = Awaited<
  ReturnType<ReturnType<typeof getBridgeKit>["estimate"]>
>;

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
  const { bridge, isLoading: isBridgeLoading } = useBridge();
  const { usdcBalance, usdcFormatted, isUsdcLoading } = useBalance();
  const { data: walletClient } = useWalletClient();
  const provider = getProviderFromWalletClient(walletClient);

  // State
  const [targetChain, setTargetChain] = useState<Chain | null>(null);
  const [amount, setAmount] = useState<AmountState | null>(null);
  const [activeTransferSpeed, setActiveTransferSpeed] = useState<TransferSpeed>(
    TransferSpeed.FAST
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isBridging, setIsBridging] = useState(false);
  const [isSwitchingChain, setIsSwitchingChain] = useState(false);
  const [loadedTransactionData, setLoadedTransactionData] = useState<{
    fromChain: { value: string; label: string };
    toChain: { value: string; label: string };
    amount: string;
    recipient: string | null;
  } | null>(null);
  const [bridgeTransactionHash, setBridgeTransactionHash] = useState<
    `0x${string}` | null
  >(null);
  const [bridgeResult, setBridgeResult] = useState<BridgeResult | null>(null);

  // Memoized values
  const bridgeKitChains = useMemo(() => getSupportedEvmChains(), []);
  const supportedChainIds = useMemo(
    () => new Set(bridgeKitChains.map((c) => c.chainId)),
    [bridgeKitChains]
  );

  // All supported chains for selectors (only those exposed by Bridge Kit)
  const supportedChains = useMemo(
    () => chains.filter((c) => supportedChainIds.has(c.id)),
    [chains, supportedChainIds]
  );

  const availableChains = useMemo(
    () => supportedChains.filter((c) => c && c.id !== chain?.id),
    [supportedChains, chain?.id]
  );

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

  const fastTransferSupported = useMemo(() => {
    if (!chain) return false;
    return Boolean(getCctpConfirmations(chain.id)?.fast);
  }, [chain]);

  useEffect(() => {
    if (
      chain &&
      !fastTransferSupported &&
      activeTransferSpeed === TransferSpeed.FAST
    ) {
      setActiveTransferSpeed(TransferSpeed.SLOW);
    }
  }, [chain, fastTransferSupported, activeTransferSpeed]);

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
        sourceChain: chain?.id,
        balance: usdcBalance,
        userAddress: address,
      }),
    [
      amount,
      targetChain?.id,
      chain?.id,
      usdcBalance,
      address,
    ]
  );

  const amountForEstimate = useMemo(
    () => (amount ? validateAmount(amount.str) : { isValid: false }),
    [amount]
  );

  const chainSelectionValid = useMemo(
    () =>
      validateChainSelection(chain?.id, targetChain?.id || undefined).isValid,
    [chain?.id, targetChain?.id]
  );

  const handleMaxAmount = () => {
    if (usdcFormatted) {
      handleAmountChange(usdcFormatted);
    }
  };

  const hasCompleteForm = !!chain && !!targetChain && !!amount;
  const canEstimate =
    !!provider &&
    !!walletClient &&
    amountForEstimate.isValid &&
    chainSelectionValid;

  const estimateBridge = useCallback(
    async (transferSpeed: TransferSpeed): Promise<BridgeEstimateResult> => {
      if (!provider || !walletClient || !chain || !targetChain || !amount) {
        throw new Error("Bridge parameters incomplete");
      }

      const sourceIdentifier = getChainIdentifier(chain.id);
      const destinationIdentifier = getChainIdentifier(targetChain.id);

      if (!sourceIdentifier || !destinationIdentifier) {
        throw new Error("Unsupported chain selection for Bridge Kit");
      }

      const adapter = await createViemAdapter(provider);

      return getBridgeKit().estimate({
        from: {
          adapter,
          chain: sourceIdentifier,
        },
        to: {
          adapter,
          chain: destinationIdentifier,
        },
        amount: formatUnits(amount.bigInt, 6),
        token: "USDC",
        config: { transferSpeed },
      });
    },
    [provider, walletClient, chain, targetChain, amount]
  );

  const {
    data: standardEstimate,
    isFetching: isStandardEstimating,
    error: standardEstimateError,
    isError: isStandardEstimateError,
  } = useQuery<BridgeEstimateResult>({
    queryKey: [
      "bridge-estimate",
      chain?.id,
      targetChain?.id,
      amount?.str,
      "standard",
    ],
    queryFn: () => estimateBridge(TransferSpeed.SLOW),
    enabled: canEstimate,
    staleTime: 300_000,
    retry: 1,
  });

  const {
    data: fastEstimate,
    isFetching: isFastEstimating,
    error: fastEstimateError,
    isError: isFastEstimateError,
  } = useQuery<BridgeEstimateResult>({
    queryKey: ["bridge-estimate", chain?.id, targetChain?.id, amount?.str, "fast"],
    queryFn: () => estimateBridge(TransferSpeed.FAST),
    enabled: canEstimate && fastTransferSupported,
    staleTime: 300_000,
    retry: 1,
  });

  useEffect(() => {
    if (isStandardEstimateError && standardEstimateError) {
      toast({
        title: "Estimate unavailable",
        description: getErrorMessage(standardEstimateError),
        variant: "destructive",
      });
    }
  }, [standardEstimateError, isStandardEstimateError, toast]);

  useEffect(() => {
    if (isFastEstimateError && fastEstimateError) {
      toast({
        title: "Fast estimate unavailable",
        description: getErrorMessage(fastEstimateError),
        variant: "destructive",
      });
    }
  }, [fastEstimateError, isFastEstimateError, toast]);

  const getTotalProtocolFee = useCallback(
    (estimate?: BridgeEstimateResult | null) => {
      if (!estimate?.fees) return 0;
      return estimate.fees.reduce(
        (acc, fee) => acc + (fee.amount ? Number(fee.amount) : 0),
        0
      );
    },
    []
  );

  const getGasEstimateLabel = useCallback(
    (estimate?: BridgeEstimateResult | null) => {
      if (!estimate?.gasFees) return null;

      const parts = estimate.gasFees
        .filter((fee) => fee.fees?.fee)
        .map((fee) => `${fee.fees?.fee} ${fee.token}`);

      if (!parts.length) return null;
      return parts.join(" + ");
    },
    []
  );

  const getTransferSpeedLabel = useCallback(
    (speed: TransferSpeed) => {
      const sourceChain = chain ? getBridgeChainById(chain.id) : undefined;
      const confirmations = chain ? getCctpConfirmations(chain.id) : null;
      const blocks =
        speed === TransferSpeed.FAST ? confirmations?.fast : confirmations?.standard;
      const finality = sourceChain
        ? getFinalityEstimate(
            sourceChain.name || String(sourceChain.chain),
            speed
          )?.averageTime
        : undefined;

      const detail = finality ?? (blocks ? `${blocks} blocks` : null);
      return detail ?? "Estimate unavailable";
    },
    [chain]
  );

  const getYouWillReceive = useCallback(
    (feeTotal: number) => {
      if (!amount) return "0.00 USDC";
      const numericAmount = Number(amount.str);
      if (Number.isNaN(numericAmount)) return "0.00 USDC";
      const received = Math.max(0, numericAmount - (feeTotal ?? 0));
      return `${received.toFixed(6)} USDC`;
    },
    [amount]
  );

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

  const handleSend = useCallback(
    async (transferSpeed: TransferSpeed) => {
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
      setActiveTransferSpeed(transferSpeed);

      try {
        const transferType = transferSpeed === TransferSpeed.FAST ? "fast" : "standard";

        const result = await bridge({
          amount: validation.data.amount,
          sourceChainId: chain.id,
          targetChainId: validation.data.targetChain,
          transferType,
        });

        const primaryHash = result.steps.find((step) => step.txHash)?.txHash;

        if (primaryHash) {
          setBridgeTransactionHash(primaryHash as `0x${string}`);
        }

        setBridgeResult(result);

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
    },
    [validation, chain, targetChain, amount, bridge, onBurn, toast]
  );

  const handleBackToNew = () => {
    setIsBridging(false);
    setIsLoading(false);
    setLoadedTransactionData(null);
    setBridgeTransactionHash(null); // Reset bridge transaction hash
    setBridgeResult(null);
    // Call parent callback to reset loaded transaction
    if (onBackToNew) {
      onBackToNew();
    }
  };

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

        setLoadedTransactionData({
          fromChain,
          toChain,
          amount: loadedTransaction.amount,
          recipient: loadedTransaction.targetAddress || null,
        });
        if (loadedTransaction.transferType) {
          setActiveTransferSpeed(
            loadedTransaction.transferType === "fast"
              ? TransferSpeed.FAST
              : TransferSpeed.SLOW
          );
        }
        setIsBridging(true);
      }
    }
  }, [loadedTransaction, chains]);

  // Loading states
  const showChainLoader = !chains.length; // Only show loader when chains haven't loaded
  const showBalanceLoader = isUsdcLoading && !!address && !!chain;
  const hasAmountInput = !!amount?.str;

  const renderSpeedCard = (
    speed: TransferSpeed,
    estimate: BridgeEstimateResult | null | undefined,
    isEstimating: boolean
  ) => {
    const feeTotal = getTotalProtocolFee(estimate);
    const blockedEstimateLabel = !amountForEstimate.isValid
      ? "Complete the form to estimate"
      : !chainSelectionValid
      ? "Select different chains"
      : !canEstimate
      ? "Connect wallet to estimate"
      : null;

    const feeLabel = !hasAmountInput
      ? "Enter amount to calculate fees"
      : blockedEstimateLabel
      ? blockedEstimateLabel
      : isEstimating
      ? "Fetching..."
      : estimate
      ? `${feeTotal.toFixed(6)} USDC`
      : "Awaiting estimate";

    const gasLabel = !hasAmountInput
      ? "Enter amount to calculate gas"
      : blockedEstimateLabel
      ? blockedEstimateLabel
      : isEstimating
      ? "Fetching..."
      : getGasEstimateLabel(estimate) || "Awaiting estimate";

    const receiveLabel =
      hasAmountInput && estimate && !blockedEstimateLabel
        ? getYouWillReceive(feeTotal)
        : blockedEstimateLabel ?? "Enter amount";

    const isSpeedSubmitting =
      (isLoading || isBridgeLoading) && activeTransferSpeed === speed;

    const validationMessage = validation.isValid
      ? null
      : validation.errors[0] || "Complete the form";

    const badgeClasses =
      speed === TransferSpeed.FAST
        ? "bg-amber-500/10 text-amber-300 border-amber-500/40"
        : "bg-slate-700/50 text-slate-200 border-slate-600/60";

    return (
      <div
        key={speed}
        className="rounded-xl border border-slate-700/60 bg-slate-900/50 p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-base font-semibold text-white">
              {speed === TransferSpeed.FAST ? "Fast Bridge" : "Standard Bridge"}
            </p>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full border ${badgeClasses}`}>
            {speed === TransferSpeed.FAST ? "Priority" : "Standard"}
          </span>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-400">Estimate speed</span>
            <span className="text-slate-100">{getTransferSpeedLabel(speed)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Fee amount</span>
            <span className="text-slate-100 text-right">{feeLabel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Estimated gas</span>
            <span className="text-slate-100 text-right">{gasLabel}</span>
          </div>
          <div className="flex justify-between font-medium">
            <span className="text-slate-200">You will receive</span>
            <span className="text-white">{receiveLabel}</span>
          </div>
        </div>

        <ConnectGuard>
          <LoadingButton
            className={
              speed === TransferSpeed.FAST
                ? "w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3"
                : "w-full border border-slate-600 bg-slate-800/80 hover:bg-slate-800 text-white font-medium py-3"
            }
            onClick={() => handleSend(speed)}
            isLoading={isSpeedSubmitting}
            disabled={!validation.isValid || isLoading || isBridgeLoading}
          >
            {validationMessage ||
              (speed === TransferSpeed.FAST ? "Bridge Fast" : "Bridge Standard")}
          </LoadingButton>
        </ConnectGuard>
      </div>
    );
  };

  if (isBridging) {
    // Use loaded transaction data if available, otherwise use form data
    if (loadedTransactionData && loadedTransaction) {
      return (
        <BridgingState
          fromChain={loadedTransactionData.fromChain}
          toChain={loadedTransactionData.toChain}
          amount={loadedTransactionData.amount}
          recipientAddress={loadedTransactionData.recipient || undefined}
          onBack={handleBackToNew}
          confirmations={getCctpConfirmations(loadedTransaction.originChain) || undefined}
          finalityEstimate={(() => {
            const chainDef = getBridgeChainById(loadedTransaction.originChain);
            if (!chainDef) return undefined;
            const speed =
              loadedTransaction.transferType === "fast"
                ? TransferSpeed.FAST
                : TransferSpeed.SLOW;
            return getFinalityEstimate(
              chainDef.name || String(chainDef.chain),
              speed
            )?.averageTime;
          })()}
          bridgeResult={(() => {
            if (loadedTransaction.bridgeResult) return loadedTransaction.bridgeResult;
            if (!loadedTransaction.steps) return undefined;
            const sourceChainDef = getBridgeChainById(loadedTransaction.originChain);
            const destChainDef =
              (loadedTransaction.targetChain &&
                getBridgeChainById(loadedTransaction.targetChain)) ||
              sourceChainDef;

            if (!sourceChainDef || !destChainDef) return undefined;

            return {
              amount: loadedTransaction.amount ?? "0",
              token: "USDC",
              state: loadedTransaction.bridgeState ?? "pending",
              provider: loadedTransaction.provider ?? "CCTPV2BridgingProvider",
              source: {
                address: loadedTransaction.targetAddress || "",
                chain: sourceChainDef,
              },
              destination: {
                address: loadedTransaction.targetAddress || "",
                chain: destChainDef,
              },
              steps: loadedTransaction.steps || [],
            };
          })()}
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

      const recipientAddressValue = address as `0x${string}` | undefined;
      const sourceChain = getBridgeChainById(chain.id);
      const confirmations = getCctpConfirmations(chain.id) || undefined;
      const finalityEstimate =
        sourceChain &&
        getFinalityEstimate(
          sourceChain.name || String(sourceChain.chain),
          activeTransferSpeed
        )?.averageTime;

      return (
        <BridgingState
          fromChain={fromChain}
          toChain={toChain}
          amount={amount.str}
          estimatedTime={undefined}
          recipientAddress={recipientAddressValue}
          onBack={handleBackToNew}
          confirmations={confirmations}
          finalityEstimate={finalityEstimate}
          bridgeResult={(() => {
            if (bridgeResult) return bridgeResult;
            const destChain = getBridgeChainById(targetChain.id);
            if (sourceChain && destChain && bridgeTransactionHash) {
              return {
                amount: amount.str,
                token: "USDC" as const,
                state: "pending" as const,
                provider: "CCTPV2BridgingProvider",
                source: { address: recipientAddressValue || "", chain: sourceChain },
                destination: { address: recipientAddressValue || "", chain: destChain },
                steps: [],
              } as BridgeResult;
            }
            return undefined;
          })()}
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

          {/* Transfer Options */}
          {hasAmountInput ? (
            <div className="space-y-4">
              {fastTransferSupported &&
                renderSpeedCard(
                  TransferSpeed.FAST,
                  fastEstimate,
                  isFastEstimating
                )}
              {renderSpeedCard(
                TransferSpeed.SLOW,
                standardEstimate,
                isStandardEstimating
              )}
            </div>
          ) : (
            <ConnectGuard>
              <LoadingButton
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3"
                onClick={() => handleSend(TransferSpeed.FAST)}
                isLoading={isLoading || isBridgeLoading}
                disabled={!validation.isValid || isLoading || isBridgeLoading}
              >
                {validation.isValid
                  ? "Bridge USDC"
                  : validation.errors[0] || "Enter an amount to bridge"}
              </LoadingButton>
            </ConnectGuard>
          )}
        </CardContent>
      </Card>
    </>
  );
}
