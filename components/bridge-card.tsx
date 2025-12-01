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
  createReadonlyAdapter,
  getBridgeChainById,
  getCctpConfirmations,
  getBridgeKit,
  resolveBridgeChain,
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
  const [sourceChainId, setSourceChainId] = useState<number | null>(
    () => chain?.id ?? null
  );
  const [targetChainId, setTargetChainId] = useState<number | null>(null);
  const [amount, setAmount] = useState<AmountState | null>(null);
  const [activeTransferSpeed, setActiveTransferSpeed] = useState<TransferSpeed>(
    TransferSpeed.FAST
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isBridging, setIsBridging] = useState(false);
  const [bridgeSourceChain, setBridgeSourceChain] = useState<Chain | null>(null);
  const [bridgeTargetChain, setBridgeTargetChain] = useState<Chain | null>(null);
  const [bridgeStartedAt, setBridgeStartedAt] = useState<Date | null>(null);
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

  type ChainOption = {
    value: string;
    label: string;
    id: number;
    chain: Chain;
  };

  // Memoized values
  const bridgeKitChains = useMemo(() => getSupportedEvmChains(), []);
  const supportedChainIds = useMemo(
    () => new Set(bridgeKitChains.map((c) => c.chainId)),
    [bridgeKitChains]
  );

  const [supportedChains, setSupportedChains] = useState<Chain[]>([]);

  // Stabilize supported chains to avoid re-computation on every render
  useEffect(() => {
    const filtered = chains
      .filter((c) => supportedChainIds.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);

    setSupportedChains((prev) => {
      const prevKey = prev.map((c) => c.id).join(",");
      const nextKey = filtered.map((c) => c.id).join(",");
      if (prevKey === nextKey) return prev;
      return filtered;
    });
  }, [chains, supportedChainIds]);

  const chainOptions = useMemo<ChainOption[]>(
    () =>
      supportedChains.map((c) => ({
        value: c.id.toString(),
        label: c.name,
        id: c.id,
        chain: c,
      })),
    [supportedChains]
  );

  const chainOptionById = useMemo(() => {
    const map = new Map<number, ChainOption>();
    chainOptions.forEach((option) => map.set(option.id, option));
    return map;
  }, [chainOptions]);

  const destinationOptionsBySource = useMemo(() => {
    const map = new Map<number, ChainOption[]>();
    chainOptions.forEach((source) => {
      map.set(
        source.id,
        chainOptions.filter((option) => option.id !== source.id)
      );
    });
    return map;
  }, [chainOptions]);

  const destinationOptions = useMemo(() => {
    if (sourceChainId != null) {
      return destinationOptionsBySource.get(sourceChainId) ?? [];
    }
    return chainOptions;
  }, [chainOptions, destinationOptionsBySource, sourceChainId]);

  const destinationOptionsKey = useMemo(
    () => destinationOptions.map((o) => o.id).join(","),
    [destinationOptions]
  );

  const targetChain = useMemo(
    () =>
      targetChainId != null
        ? chainOptionById.get(targetChainId)?.chain ?? null
        : null,
    [chainOptionById, targetChainId]
  );

  const selectedSourceChain = useMemo(
    () =>
      sourceChainId != null
        ? chainOptionById.get(sourceChainId)?.chain ?? null
        : null,
    [chainOptionById, sourceChainId]
  );

  const activeSourceChainId = useMemo(
    () => sourceChainId ?? chain?.id ?? null,
    [chain?.id, sourceChainId]
  );

  const isSourceChainSynced =
    sourceChainId == null ? !!chain : !!chain && chain.id === sourceChainId;

  const fastTransferSupported = useMemo(() => {
    if (!activeSourceChainId) return false;
    return Boolean(getCctpConfirmations(activeSourceChainId)?.fast);
  }, [activeSourceChainId]);

  const walletChainId = chain?.id;

  const sourceChainOptions = useMemo(() => {
    if (!walletChainId) return chainOptions;
    const connectedChain = chainOptions.find((option) => option.id === walletChainId);
    if (!connectedChain) return chainOptions;
    const remaining = chainOptions.filter((option) => option.id !== walletChainId);
    return [connectedChain, ...remaining];
  }, [chainOptions, walletChainId]);

  // Initialize source chain once based on wallet or first supported chain
  useEffect(() => {
    if (sourceChainId != null) return;

    if (walletChainId && supportedChainIds.has(walletChainId)) {
      setSourceChainId(walletChainId);
      return;
    }

    if (supportedChains.length > 0) {
      setSourceChainId(supportedChains[0].id);
    }
  }, [sourceChainId, walletChainId, supportedChainIds, supportedChains]);

  // Keep the destination list consistent with the selected source chain without stomping user choice
  useEffect(() => {
    if (!destinationOptions.length) {
      setTargetChainId(null);
      return;
    }

    setTargetChainId((current) => {
      // Preserve current choice if still valid for this source
      if (current && destinationOptions.some((option) => option.id === current)) {
        return current;
      }

      // Otherwise pick the first available
      return destinationOptions[0]?.id ?? null;
    });
  }, [destinationOptionsKey, destinationOptions, sourceChainId]);

  useEffect(() => {
    if (
      activeSourceChainId &&
      !fastTransferSupported &&
      activeTransferSpeed === TransferSpeed.FAST
    ) {
      setActiveTransferSpeed(TransferSpeed.SLOW);
    }
  }, [activeSourceChainId, fastTransferSupported, activeTransferSpeed]);

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
        targetChain: targetChain?.id || targetChainId || null,
        sourceChain: activeSourceChainId ?? undefined,
        balance: usdcBalance,
        userAddress: address,
      }),
    [
      amount,
      targetChain?.id,
      targetChainId,
      activeSourceChainId,
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
      validateChainSelection(
        activeSourceChainId ?? undefined,
        targetChain?.id || targetChainId || undefined
      ).isValid,
    [activeSourceChainId, targetChain?.id, targetChainId]
  );

  const handleMaxAmount = () => {
    if (usdcFormatted) {
      handleAmountChange(usdcFormatted);
    }
  };

  const hasCompleteForm = !!chain && isSourceChainSynced && !!targetChain && !!amount;
  const canEstimate =
    amountForEstimate.isValid &&
    chainSelectionValid &&
    activeSourceChainId != null &&
    !!targetChain;

  const estimateBridge = useCallback(
    async (transferSpeed: TransferSpeed): Promise<BridgeEstimateResult> => {
      const sourceId = sourceChainId ?? chain?.id;

      if (!sourceId || !targetChain || !amount) {
        throw new Error("Bridge parameters incomplete");
      }

      const sourceChainDef = resolveBridgeChain(sourceId);
      const destinationChainDef = resolveBridgeChain(targetChain.id);

      const adapter = await createReadonlyAdapter(sourceId);

      return getBridgeKit().estimate({
        from: {
          adapter,
          chain: sourceChainDef,
        },
        to: {
          adapter,
          chain: destinationChainDef,
        },
        amount: formatUnits(amount.bigInt, 6),
        token: "USDC",
        config: { transferSpeed },
      });
    },
    [sourceChainId, targetChain, amount, chain?.id]
  );

  const {
    data: standardEstimate,
    isFetching: isStandardEstimating,
    error: standardEstimateError,
    isError: isStandardEstimateError,
  } = useQuery<BridgeEstimateResult>({
    queryKey: [
      "bridge-estimate",
      sourceChainId,
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
    queryKey: [
      "bridge-estimate",
      sourceChainId,
      targetChain?.id,
      amount?.str,
      "fast",
    ],
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

  const getTransferSpeedLabel = useCallback(
    (speed: TransferSpeed) => {
      const sourceChain =
        activeSourceChainId != null
          ? getBridgeChainById(activeSourceChainId)
          : undefined;
      const confirmations =
        activeSourceChainId != null ? getCctpConfirmations(activeSourceChainId) : null;
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
    [activeSourceChainId]
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

  const getEtaLabel = useCallback(
    (speed: TransferSpeed, override?: string | null) =>
      override || (speed === TransferSpeed.FAST ? "~1 minute" : "13-19 minutes"),
    []
  );

  const handleSwitchChain = async (chainId: string) => {
    const parsedChainId = parseInt(chainId, 10);
    if (Number.isNaN(parsedChainId)) return;

    try {
      setIsSwitchingChain(true);
      setSourceChainId(parsedChainId);
      await switchChain({ chainId: parsedChainId });
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

  const handleSend = useCallback(
    async (transferSpeed: TransferSpeed) => {
      const selectedSourceId = sourceChainId ?? chain?.id ?? null;

      if (
        !selectedSourceId ||
        !chain ||
        !isSourceChainSynced
      ) {
        toast({
          title: "Switch network",
          description: `Please switch your wallet to ${
            selectedSourceChain?.name ?? "the selected chain"
          } to bridge.`,
          variant: "destructive",
        });
        return;
      }

      if (
        !validation.isValid ||
        !validation.data ||
        !targetChain ||
        !amount
      ) {
        return;
      }

      try {
        resolveBridgeChain(selectedSourceId);
        resolveBridgeChain(targetChain.id);
      } catch (error) {
        toast({
          title: "Unsupported chain",
          description: getErrorMessage(error),
          variant: "destructive",
        });
        return;
      }

      setIsLoading(true);
      setActiveTransferSpeed(transferSpeed);
      setBridgeResult(null);
      setBridgeStartedAt(new Date());
      const resolvedSourceChain =
        chainOptionById.get(selectedSourceId)?.chain || chain || null;
      setBridgeSourceChain(resolvedSourceChain);
      setBridgeTargetChain(targetChain);

      let pendingHash: `0x${string}` | null = null;
      try {
        const transferType = transferSpeed === TransferSpeed.FAST ? "fast" : "standard";

        const result = await bridge(
          {
            amount: validation.data.amount,
            sourceChainId: selectedSourceId,
            targetChainId: targetChain.id,
            transferType,
          },
          {
            onPendingHash: (hash) => {
              pendingHash = hash;
              setBridgeTransactionHash(hash);
              setIsBridging(true);
            },
            onStateChange: (next) => {
              setIsBridging(true);
              setBridgeResult((prev) => {
                const mergedSteps = next.steps ?? prev?.steps ?? [];
                const mergedState = (next.state as BridgeResult["state"]) ?? prev?.state;
                const provider = next.provider ?? prev?.provider ?? "CCTPV2BridgingProvider";
                const amountStr = next.amount ?? prev?.amount ?? amount.str;
                return {
                  amount: amountStr ?? "0",
                  token: "USDC",
                  state: mergedState ?? "pending",
                  provider,
                  source:
                    next.source ??
                    prev?.source ?? {
                      address: address ?? "",
                      chain: resolveBridgeChain(selectedSourceId),
                    },
                  destination:
                    next.destination ??
                    prev?.destination ?? {
                      address: address ?? "",
                      chain: resolveBridgeChain(targetChain.id),
                    },
                  steps: mergedSteps,
                };
              });

              const txHashFromStep =
                next.steps?.find((step) => step.txHash)?.txHash ||
                next.steps?.[0]?.txHash ||
                null;
              if (txHashFromStep && !bridgeTransactionHash) {
                setBridgeTransactionHash(txHashFromStep as `0x${string}`);
              }
            },
          }
        );

        const primaryHash = result.steps.find((step) => step.txHash)?.txHash;

        setBridgeTransactionHash(
          (primaryHash as `0x${string}` | undefined) || pendingHash
        );

        setBridgeResult(result);

        setIsLoading(false);
        setIsBridging(true);

        if (onBurn) {
          onBurn(true);
        }
      } catch (error) {
        console.error("Bridge transaction failed:", error);
        setIsLoading(false);
        setIsBridging(false);
        setBridgeTransactionHash(pendingHash); // Keep placeholder hash if available
        toast({
          title: "Transaction Failed",
          description: getErrorMessage(error),
          variant: "destructive",
        });
      }
    },
    [
      validation,
      chain,
      targetChain,
      amount,
      bridge,
      onBurn,
      toast,
      isSourceChainSynced,
      selectedSourceChain,
      chainOptionById,
      sourceChainId,
      address,
      bridgeTransactionHash,
    ]
  );

  const handleBackToNew = () => {
    setIsBridging(false);
    setIsLoading(false);
    setLoadedTransactionData(null);
    setBridgeTransactionHash(null); // Reset bridge transaction hash
    setBridgeResult(null);
    setBridgeStartedAt(null);
    setBridgeSourceChain(null);
    setBridgeTargetChain(null);
    // Call parent callback to reset loaded transaction
    if (onBackToNew) {
      onBackToNew();
    }
  };

  // Effect to handle loaded transaction from history
  useEffect(() => {
    if (loadedTransaction) {
      const originChain = supportedChains.find(
        (c) => c.id === loadedTransaction.originChain
      );
      const targetChainData = supportedChains.find(
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
        setBridgeSourceChain(originChain);
        setBridgeTargetChain(targetChainData);
        if (loadedTransaction.date) {
          setBridgeStartedAt(new Date(loadedTransaction.date));
        }
        setIsBridging(true);
      }
    }
  }, [loadedTransaction, supportedChains]);

  // Loading states
  const showChainLoader = !supportedChains.length; // Only show loader when chains haven't loaded
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
      : !isSourceChainSynced
      ? "Switch wallet to selected chain"
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
            disabled={
              !validation.isValid ||
              isLoading ||
              isBridgeLoading ||
              isSwitchingChain
            }
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
          onBridgeResultUpdate={(next) => setBridgeResult(next)}
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
          transferType={
            loadedTransaction.transferType === "fast" ? "fast" : "standard"
          }
          startedAt={loadedTransaction.date ? new Date(loadedTransaction.date) : undefined}
          estimatedTimeLabel={getEtaLabel(
            loadedTransaction.transferType === "fast"
              ? TransferSpeed.FAST
              : TransferSpeed.SLOW,
            loadedTransaction.estimatedTime
          )}
        />
      );
    } else if ((bridgeTargetChain || targetChain) && amount && bridgeTransactionHash) {
      const sourceId = bridgeSourceChain?.id ?? chain?.id ?? sourceChainId ?? null;
      const targetId = bridgeTargetChain?.id ?? targetChain?.id ?? targetChainId ?? null;

      const fromChain = {
        value: sourceId != null ? sourceId.toString() : "",
        label: bridgeSourceChain?.name || chain?.name || "Source",
      };
      const toChain = {
        value: targetId != null ? targetId.toString() : "",
        label: bridgeTargetChain?.name || targetChain?.name || "Destination",
      };

      const recipientAddressValue = address ?? undefined;
      const sourceChainIdForResult = sourceId ?? (fromChain.value ? Number(fromChain.value) : undefined);
      const targetChainIdForResult =
        targetId ?? (toChain.value ? Number(toChain.value) : undefined);

      const sourceChainDef = sourceChainIdForResult
        ? getBridgeChainById(sourceChainIdForResult)
        : null;
      const confirmations = sourceChainIdForResult
        ? getCctpConfirmations(sourceChainIdForResult) || undefined
        : undefined;
      const finalityEstimate = sourceChainDef
        ? getFinalityEstimate(
            sourceChainDef.name || String(sourceChainDef.chain),
            activeTransferSpeed
          )?.averageTime || undefined
        : undefined;

      return (
        <BridgingState
          fromChain={fromChain}
          toChain={toChain}
          amount={amount.str}
          estimatedTime={undefined}
          recipientAddress={recipientAddressValue}
          onBack={handleBackToNew}
          onBridgeResultUpdate={(next) => setBridgeResult(next)}
          confirmations={confirmations}
          finalityEstimate={finalityEstimate}
          transferType={activeTransferSpeed === TransferSpeed.FAST ? "fast" : "standard"}
          startedAt={bridgeStartedAt ?? undefined}
          estimatedTimeLabel={getEtaLabel(activeTransferSpeed, finalityEstimate)}
          bridgeResult={(() => {
            if (bridgeResult) return bridgeResult;
            const destChain = targetChainIdForResult
              ? getBridgeChainById(targetChainIdForResult)
              : null;
            if (sourceChainDef && destChain && bridgeTransactionHash) {
              return {
                amount: amount.str,
                token: "USDC" as const,
                state: "pending" as const,
                provider: "CCTPV2BridgingProvider",
                source: { address: recipientAddressValue || "", chain: sourceChainDef },
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
                  value={sourceChainId != null ? sourceChainId.toString() : ""}
                  onValueChange={handleSwitchChain}
                  disabled={isLoading || isSwitchingChain || !address}
                >
                  <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white">
                    <SelectValue placeholder="Select Chain...">
                      {(() => {
                        const displayChain =
                          selectedSourceChain ||
                          chain ||
                          chainOptions[0]?.chain;
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
                  value={targetChainId != null ? targetChainId.toString() : ""}
                  onValueChange={(value) => {
                    const selectedChain = chainOptionById.get(Number(value));
                    if (selectedChain) {
                      setTargetChainId(selectedChain.id);
                    }
                  }}
                  disabled={isLoading || !destinationOptions.length}
                >
                  <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white">
                    <SelectValue placeholder="Select Chain...">
                      {(() => {
                        const displayChain =
                          targetChain ||
                          (targetChainId != null
                            ? chainOptionById.get(targetChainId)?.chain
                            : undefined);
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
                    {destinationOptions.map((chainOption) => (
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
              disabled={
                !validation.isValid ||
                isLoading ||
                isBridgeLoading ||
                isSwitchingChain
              }
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
