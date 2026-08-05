"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowRight, Loader2 } from "lucide-react";
import { BridgingState } from "@/components/bridging-state";
import { ChainIcon } from "@/components/chain-icon";
import { useAccount, useChains, useSwitchChain } from "wagmi";
import { Chain } from "viem";
import {
  validateBridgeParams,
  validateAmount,
  validateChainSelection,
} from "@/lib/validation";
import { getErrorMessage } from "@/lib/cctp/errors";
import {
  AmountState,
  LocalTransaction,
  ChainId,
  UniversalTxHash,
  getChainType,
} from "@/lib/types";
import type { BridgeIntent } from "@/lib/bridgeIntent";
import { useCrossEcosystemBridge } from "@/lib/hooks/useCrossEcosystemBridge";
import { estimateBridgeFee } from "@/lib/cctp/estimate";
import type { BridgeEstimate } from "@/lib/cctp/types";
import { useBalance } from "@/lib/hooks/useBalance";
import { useSolanaBalance } from "@/lib/hooks/useSolanaBalance";
import { useWallet } from "@solana/wallet-adapter-react";
import { useDebouncedAddressValidation } from "@/lib/hooks/useDebouncedAddressValidation";
import { useToast } from "@/components/ui/use-toast";
import {
  LoadingButton,
  BalanceLoader,
  ChainSelectorSkeleton,
} from "@/components/loading/LoadingStates";
import ConnectGuard from "@/components/guards/ConnectGuard";
import SolanaConnectGuard from "@/components/guards/SolanaConnectGuard";
import type { BridgeResult, ChainDefinition } from "@circle-fin/bridge-kit";
import {
  TransferSpeed,
  type TransferSpeedValue,
} from "@/lib/cctp/transferSpeed";
import {
  getBridgeChainByIdUniversal,
  getCctpConfirmationsUniversal,
  resolveBridgeChainUniversal,
  getAllSupportedChains,
} from "@/lib/bridgeConfig";
import {
  resolveRecipientForBridgingState,
  resolveRecipientForSend,
} from "@/lib/recipientResolution";
import { resolveEstimatedTimeLabel } from "@/lib/estimatedTime";
import { toChainDefinition } from "@/lib/chainDefinition";
import { useQuery } from "@tanstack/react-query";
import { getFinalityEstimate } from "@/lib/cctpFinality";
import { BridgeComparison } from "@/components/bridge-card/BridgeComparison";
import { StandardTransferSupportDialog } from "@/components/bridge-card/StandardTransferSupportDialog";
import {
  getStandardTransferSupportQuote,
  type StandardTransferSupportQuote,
} from "@/lib/cctp/fastTransferFee";
import { IntentStatusCard } from "@/components/bridge-card/IntentStatusCard";
import {
  buildChainOptionMap,
  buildChainOptions,
  buildDestinationOptionsBySource,
  getEstimateLabels as buildEstimateLabels,
  hasCompleteBridgeForm,
  parseAmountToState,
  sortChainOptionsByConnection,
  type ChainOption,
} from "@/components/bridge-card/utils";

interface BridgeCardProps {
  onBurn?: (value: boolean) => void;
  loadedTransaction?: LocalTransaction | null;
  onBackToNew?: () => void;
  mode?: "full" | "intentOnly" | "executeIntent";
  initialIntent?: BridgeIntent | null;
  onSubmitIntent?: (intent: BridgeSubmissionIntent) => void;
  onPendingHashResolved?: (payload: {
    sourceChainId: ChainId;
    hash: UniversalTxHash;
  }) => void;
  onMessageExpiredNonce?: (payload: {
    sourceChainId: ChainId;
    nonce: string;
  }) => void;
}

export type BridgeSubmissionIntent = BridgeIntent;

export function BridgeCard({
  onBurn,
  loadedTransaction,
  onBackToNew,
  mode = "full",
  initialIntent,
  onSubmitIntent,
  onPendingHashResolved,
  onMessageExpiredNonce,
}: BridgeCardProps) {
  // Hooks
  const { address, chain } = useAccount();
  const { toast } = useToast();
  const chains = useChains();
  const { switchChain } = useSwitchChain();
  const { bridge, isLoading: isBridgeLoading } = useCrossEcosystemBridge();
  const enableFormQueries = mode !== "executeIntent";
  const {
    usdcBalance: evmUsdcBalance,
    usdcFormatted: evmUsdcFormatted,
    isUsdcLoading: evmIsUsdcLoading,
  } = useBalance({ enabled: enableFormQueries });
  const solanaWallet = useWallet();
  const {
    usdcBalance: solanaUsdcBalance,
    usdcFormatted: solanaUsdcFormatted,
    isLoading: solanaIsUsdcLoading,
  } = useSolanaBalance({ enabled: enableFormQueries });

  // State
  const [sourceChainId, setSourceChainId] = useState<ChainId | null>(
    () => chain?.id ?? null
  );
  const [targetChainId, setTargetChainId] = useState<ChainId | null>(null);
  const [amount, setAmount] = useState<AmountState | null>(null);
  const [activeTransferSpeed, setActiveTransferSpeed] = useState<TransferSpeedValue>(
    TransferSpeed.FAST
  );
  const [standardSupportQuote, setStandardSupportQuote] = useState<StandardTransferSupportQuote | null>(null);
  const [declinedStandardSupportKey, setDeclinedStandardSupportKey] = useState<string | null>(null);
  const [standardSupportPromptPresented, setStandardSupportPromptPresented] = useState(false);
  const [standardSupportPromptResolved, setStandardSupportPromptResolved] = useState(false);
  const [diffWallet, setDiffWallet] = useState(false);
  const [targetAddress, setTargetAddress] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [isBridging, setIsBridging] = useState(false);
  const [bridgeSourceChain, setBridgeSourceChain] = useState<Chain | null>(null);
  const [bridgeTargetChain, setBridgeTargetChain] = useState<Chain | null>(null);
  // Track target chain ID directly (works for both EVM and Solana destinations)
  const [bridgeTargetChainId, setBridgeTargetChainId] = useState<ChainId | null>(null);
  const [bridgeStartedAt, setBridgeStartedAt] = useState<Date | null>(null);
  const [isSwitchingChain, setIsSwitchingChain] = useState(false);
  const [submittedRecipientAddress, setSubmittedRecipientAddress] = useState<string | undefined>(undefined);
  const [loadedTransactionData, setLoadedTransactionData] = useState<{
    fromChain: { value: string; label: string };
    toChain: { value: string; label: string };
    amount: string;
    recipient: string | null;
  } | null>(null);
  const [bridgeTransactionHash, setBridgeTransactionHash] = useState<
    UniversalTxHash | null
  >(null);
  const [bridgeResult, setBridgeResult] = useState<BridgeResult | null>(null);
  const [intentHydrated, setIntentHydrated] = useState(false);
  const [intentStarted, setIntentStarted] = useState(false);
  const [intentExecutionState, setIntentExecutionState] = useState<
    "idle" | "attempting" | "started" | "not-started" | "failed"
  >("idle");
  // StrictMode can mount/unmount effects twice; keep dedupe scoped to this instance only.
  const executedIntentKeysRef = useRef(new Set<string>());
  const executeIntentKey = useMemo(
    () => (initialIntent ? JSON.stringify(initialIntent) : null),
    [initialIntent]
  );
  const previousExecuteIntentKeyRef = useRef<string | null>(null);
  const intentBackRequestedRef = useRef(false);

  // Determine target chain type early for validation
  const targetChainType = useMemo(
    () => targetChainId ? getChainType(targetChainId) : null,
    [targetChainId]
  );

  // Debounced address validation for custom recipient
  // Pass target chain type for cross-chain address validation
  const addressValidation = useDebouncedAddressValidation(
    diffWallet ? targetAddress : undefined,
    targetChainType
  );

  // Memoized values - get all supported chains (EVM + Solana) from Bridge Kit
  const allBridgeKitChains = useMemo(() => getAllSupportedChains(), []);
  const evmChainIds = useMemo(
    () => new Set(allBridgeKitChains.filter(c => c.type === "evm").map((c) => c.chainId)),
    [allBridgeKitChains]
  );

  const [supportedEvmChains, setSupportedEvmChains] = useState<Chain[]>([]);

  // Stabilize supported EVM chains to avoid re-computation on every render
  useEffect(() => {
    const filtered = chains
      .filter((c) => evmChainIds.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);

    setSupportedEvmChains((prev) => {
      const prevKey = prev.map((c) => c.id).join(",");
      const nextKey = filtered.map((c) => c.id).join(",");
      if (prevKey === nextKey) return prev;
      return filtered;
    });
  }, [chains, evmChainIds]);

  // Build chain options from all supported chains (EVM + Solana)
  const chainOptions = useMemo<ChainOption[]>(
    () => buildChainOptions({ supportedEvmChains, allBridgeKitChains }),
    [supportedEvmChains, allBridgeKitChains]
  );

  const chainOptionById = useMemo(() => {
    return buildChainOptionMap(chainOptions);
  }, [chainOptions]);

  const destinationOptionsBySource = useMemo(() => {
    return buildDestinationOptionsBySource(chainOptions);
  }, [chainOptions]);

  // Helper to check if a chain option is connected
  const isChainConnected = useCallback((chainOption: ChainOption): boolean => {
    if (chainOption.chainType === "solana") {
      return solanaWallet.connected;
    }
    // EVM: connected if wallet is on this chain
    return chain?.id === chainOption.id;
  }, [chain?.id, solanaWallet.connected]);

  const destinationOptions = useMemo(() => {
    const baseOptions = sourceChainId != null
      ? destinationOptionsBySource.get(sourceChainId) ?? []
      : chainOptions;

    return sortChainOptionsByConnection(baseOptions, isChainConnected);
  }, [chainOptions, destinationOptionsBySource, sourceChainId, isChainConnected]);

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

  // Determine source chain type and appropriate balance
  const sourceChainType = useMemo(
    () => activeSourceChainId ? getChainType(activeSourceChainId) : "evm",
    [activeSourceChainId]
  );

  // Unified balance values based on source chain type
  const usdcBalance = sourceChainType === "solana" ? solanaUsdcBalance : evmUsdcBalance;
  const usdcFormatted = sourceChainType === "solana" ? solanaUsdcFormatted : evmUsdcFormatted;
  const isUsdcLoading = sourceChainType === "solana" ? solanaIsUsdcLoading : evmIsUsdcLoading;
  const disableBalanceCheck = process.env.NEXT_PUBLIC_DISABLE_BALANCE_CHECK === "1";

  // For Solana, check if Solana wallet is connected; for EVM, check if chain matches
  const isSourceChainSynced = useMemo(() => {
    if (sourceChainType === "solana") {
      return solanaWallet.connected;
    }
    return sourceChainId == null ? !!chain : !!chain && chain.id === sourceChainId;
  }, [sourceChainType, solanaWallet.connected, sourceChainId, chain]);

  // Detect cross-ecosystem bridging (EVM↔Solana)
  const isCrossEcosystem = useMemo(() => {
    if (!activeSourceChainId || !targetChainId) return false;
    return getChainType(activeSourceChainId) !== getChainType(targetChainId);
  }, [activeSourceChainId, targetChainId]);

  // Pre-filled address for cross-ecosystem bridging
  // Uses the connected wallet from the target ecosystem
  const crossEcosystemTargetAddress = useMemo(() => {
    if (!isCrossEcosystem || !targetChainType) return undefined;
    // If target is EVM, use connected EVM address; if Solana, use Solana pubkey
    return targetChainType === "evm" ? address : solanaWallet.publicKey?.toBase58();
  }, [isCrossEcosystem, targetChainType, address, solanaWallet.publicKey]);

  // Destination address used for validation when recipient is auto-derived
  const validationTargetAddress = useMemo(() => {
    if (isCrossEcosystem && crossEcosystemTargetAddress) {
      return crossEcosystemTargetAddress;
    }
    return targetAddress;
  }, [isCrossEcosystem, crossEcosystemTargetAddress, targetAddress]);

  // Default destination wallet for non-custom recipient flows
  const defaultTargetWalletAddress = useMemo(
    () => (targetChainType === "solana" ? solanaWallet.publicKey?.toBase58() : address),
    [targetChainType, solanaWallet.publicKey, address]
  );

  const fastTransferSupported = useMemo(() => {
    if (!activeSourceChainId) return false;
    // Fast transfer supported for any source chain that has fast confirmations
    // Per CCTP docs: Solana supports Fast Transfer as both source and destination
    return Boolean(getCctpConfirmationsUniversal(activeSourceChainId)?.fast);
  }, [activeSourceChainId]);

  const walletChainId = chain?.id;

  const sourceChainOptions = useMemo(() => {
    return sortChainOptionsByConnection(chainOptions, isChainConnected);
  }, [chainOptions, isChainConnected]);

  // Track the previous wallet chain to detect actual wallet chain changes
  const prevWalletChainRef = useRef<number | undefined>(walletChainId);

  // Default chain IDs when no wallet connected
  // Source: Arbitrum (mainnet: 42161, testnet: 421614)
  // Target: Solana (mainnet: "Solana", testnet: "Solana_Devnet")
  const defaultSourceChainId = chainOptions.find(
    (c) => c.id === 42161 || c.id === 421614
  )?.id;
  const defaultTargetChainId = chainOptions.find(
    (c) => c.id === "Solana" || c.id === "Solana_Devnet"
  )?.id;

  // Track if user has explicitly changed the source chain
  const userChangedSourceRef = useRef(false);

  // Sync source chain to wallet chain ONLY when wallet chain actually changes
  // Don't override if user explicitly selected a different chain (like Solana)
  useEffect(() => {
    const prevWalletChain = prevWalletChainRef.current;
    prevWalletChainRef.current = walletChainId;

    // Only sync if wallet chain changed (not on every sourceChainId change)
    if (walletChainId && walletChainId !== prevWalletChain && evmChainIds.has(walletChainId)) {
      setSourceChainId(walletChainId);
      userChangedSourceRef.current = true;
      return;
    }

    // Set default chain (Arbitrum) when:
    // 1. No source chain selected yet, OR
    // 2. Default just became available and user hasn't explicitly changed it
    if (defaultSourceChainId && !userChangedSourceRef.current) {
      if (sourceChainId == null || sourceChainId !== defaultSourceChainId) {
        setSourceChainId(defaultSourceChainId);
      }
    } else if (sourceChainId == null && chainOptions.length > 0) {
      // Ultimate fallback if no default available
      setSourceChainId(chainOptions[0].id);
    }
  }, [walletChainId, evmChainIds, chainOptions, sourceChainId, defaultSourceChainId]);

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

      // Prefer Base as default target if available, otherwise first option
      const baseOption = destinationOptions.find(
        (o) => o.id === defaultTargetChainId
      );
      return baseOption?.id ?? destinationOptions[0]?.id ?? null;
    });
  }, [destinationOptionsKey, destinationOptions, sourceChainId, defaultTargetChainId]);

  useEffect(() => {
    if (
      activeSourceChainId &&
      !fastTransferSupported &&
      activeTransferSpeed === TransferSpeed.FAST
    ) {
      setActiveTransferSpeed(TransferSpeed.SLOW);
    }
  }, [activeSourceChainId, fastTransferSupported, activeTransferSpeed]);

  // Auto-set address input for cross-ecosystem bridging
  useEffect(() => {
    if (mode === "executeIntent" && initialIntent) {
      return;
    }

    if (isCrossEcosystem) {
      // Force custom-recipient mode for cross-ecosystem
      setDiffWallet(true);

      // Keep recipient derived from live connected target wallet instead of mutable local state
      if (crossEcosystemTargetAddress) {
        setTargetAddress(undefined);
      }
      return;
    }

    // Reset to default for same-ecosystem bridging
    setDiffWallet(false);
    setTargetAddress(undefined);
  }, [mode, initialIntent, isCrossEcosystem, crossEcosystemTargetAddress]);

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
        balance: disableBalanceCheck ? undefined : usdcBalance,
        userAddress: defaultTargetWalletAddress,
        isCustomAddress: diffWallet,
        targetAddress: validationTargetAddress,
        targetChainType: targetChainType ?? undefined,
      }),
    [
      amount,
      targetChain?.id,
      targetChainId,
      activeSourceChainId,
      usdcBalance,
      disableBalanceCheck,
      defaultTargetWalletAddress,
      diffWallet,
      validationTargetAddress,
      targetChainType,
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

  // Form validation - check wallet based on source chain type
  const hasCompleteForm = useMemo(
    () =>
      hasCompleteBridgeForm({
        sourceChainType,
        solanaConnected: solanaWallet.connected,
        evmChainConnected: !!chain,
        isSourceChainSynced,
        hasTargetChain: !!targetChain || !!targetChainId,
        hasAmount: !!amount,
      }),
    [sourceChainType, solanaWallet.connected, chain, isSourceChainSynced, targetChain, targetChainId, amount]
  );

  // Can we estimate? No wallet required with custom estimate function
  const hasSolanaWallet = solanaWallet.connected && !!solanaWallet.wallet?.adapter;
  const canEstimate =
    amountForEstimate.isValid &&
    chainSelectionValid &&
    activeSourceChainId != null &&
    targetChainId != null;

  const estimateBridge = useCallback(
    async (transferSpeed: TransferSpeedValue): Promise<BridgeEstimate> => {
      const sourceId = sourceChainId ?? chain?.id;
      const targetId = targetChainId;

      if (!sourceId || !targetId || !amount) {
        throw new Error("Bridge parameters incomplete");
      }

      return estimateBridgeFee({
        sourceChainId: sourceId,
        destinationChainId: targetId,
        amount: amount.str,
        speed: transferSpeed === TransferSpeed.FAST ? "fast" : "standard",
      });
    },
    [sourceChainId, targetChainId, amount, chain?.id]
  );

  const {
    data: standardEstimate,
    isFetching: isStandardEstimating,
    error: standardEstimateError,
    isError: isStandardEstimateError,
  } = useQuery<BridgeEstimate>({
    queryKey: [
      "bridge-estimate",
      sourceChainId,
      targetChainId, // Use targetChainId instead of targetChain?.id for Solana support
      amount?.str,
      "standard",
    ],
    queryFn: () => estimateBridge(TransferSpeed.SLOW),
    enabled: canEstimate && enableFormQueries,
    staleTime: 300_000,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });

  const {
    data: fastEstimate,
    isFetching: isFastEstimating,
    error: fastEstimateError,
    isError: isFastEstimateError,
  } = useQuery<BridgeEstimate>({
    queryKey: [
      "bridge-estimate",
      sourceChainId,
      targetChainId, // Use targetChainId instead of targetChain?.id for Solana support
      amount?.str,
      "fast",
    ],
    queryFn: () => estimateBridge(TransferSpeed.FAST),
    enabled: canEstimate && fastTransferSupported && enableFormQueries,
    staleTime: 300_000,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
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

  const getTransferSpeedLabel = useCallback(
    (speed: TransferSpeedValue) => {
      const sourceChain =
        activeSourceChainId != null
          ? getBridgeChainByIdUniversal(activeSourceChainId)
          : undefined;
      const finality = sourceChain
        ? getFinalityEstimate(
            sourceChain.name || String(sourceChain.chain),
            speed
          )?.averageTime
        : undefined;

      return finality ?? "Estimate unavailable";
    },
    [activeSourceChainId]
  );

  const getEtaLabel = useCallback(
    (
      speed: TransferSpeedValue,
      sourceId?: ChainId | null,
      override?: string | null
    ) =>
      resolveEstimatedTimeLabel({
        transferType: speed === TransferSpeed.FAST ? "fast" : "standard",
        sourceChainId: sourceId,
        estimatedTime: override,
      }),
    []
  );

  const handleSwitchChain = async (chainIdValue: string) => {
    // Mark that user has explicitly changed the source chain
    userChangedSourceRef.current = true;

    // Check if this is a Solana chain (string identifier)
    if (chainIdValue.startsWith("Solana")) {
      // For Solana chains, just update the source chain state
      // No need to switch EVM wallet chain
      setSourceChainId(chainIdValue as ChainId);
      return;
    }

    // For EVM chains, parse the integer and switch chain
    const parsedChainId = parseInt(chainIdValue, 10);
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
    async (
      transferSpeed: TransferSpeedValue,
      supportQuote?: StandardTransferSupportQuote
    ): Promise<boolean> => {
      const selectedSourceId = sourceChainId ?? chain?.id ?? null;
      const selectedSourceType = selectedSourceId
        ? getChainType(selectedSourceId)
        : "evm";
      const hasSourceWallet =
        selectedSourceType === "solana" ? solanaWallet.connected : !!chain;

      if (
        !selectedSourceId ||
        !hasSourceWallet ||
        !isSourceChainSynced
      ) {
        toast({
          title: "Switch network",
          description: `Please switch your wallet to ${
            selectedSourceChain?.name ?? "the selected chain"
          } to bridge.`,
          variant: "destructive",
        });
        return false;
      }

      if (
        !validation.isValid ||
        !validation.data ||
        !targetChainId ||
        !amount
      ) {
        return false;
      }

      const senderAddress = selectedSourceType === "solana"
        ? solanaWallet.publicKey?.toBase58()
        : address;

      // Lock recipient at click time using a single source of truth.
      // This prevents stale state from diverging from connected wallet state.
      const resolvedRecipient = resolveRecipientForSend({
        isCrossEcosystem,
        diffWallet,
        crossEcosystemTargetAddress,
        validationTargetAddress,
        targetAddress,
        defaultTargetWalletAddress,
        senderAddress,
      });
      const finalTargetAddress = resolvedRecipient.finalTargetAddress;
      const recipientResolution = resolvedRecipient.recipientResolution;

      if (!finalTargetAddress) {
        toast({
          title: "Missing recipient",
          description: "Destination wallet address is required.",
          variant: "destructive",
        });
        return false;
      }

      let sourceBridgeDefinition: ChainDefinition;
      let targetBridgeDefinition: ChainDefinition;
      try {
        sourceBridgeDefinition = toChainDefinition(
          resolveBridgeChainUniversal(selectedSourceId)
        );
        targetBridgeDefinition = toChainDefinition(
          resolveBridgeChainUniversal(targetChainId)
        );
      } catch (error) {
        toast({
          title: "Unsupported chain",
          description: getErrorMessage(error),
          variant: "destructive",
        });
        return false;
      }

      const transferType = transferSpeed === TransferSpeed.FAST ? "fast" : "standard";

      if (mode === "intentOnly") {
        onSubmitIntent?.({
          sourceChainId: selectedSourceId,
          targetChainId,
          amount: amount.str,
          targetAddress: finalTargetAddress,
          transferType,
          showStandardSupportPrompt: Boolean(supportQuote?.eligible),
        });
        return true;
      }

      setIsLoading(true);
      setActiveTransferSpeed(transferSpeed);
      setBridgeResult(null);
      setBridgeStartedAt(new Date());
      setSubmittedRecipientAddress(finalTargetAddress);
      const resolvedSourceChain =
        chainOptionById.get(selectedSourceId)?.chain || chain || null;
      setBridgeSourceChain(resolvedSourceChain);
      // Track target chain ID for both EVM and Solana destinations
      setBridgeTargetChainId(targetChainId);
      // Only set bridgeTargetChain if it's an EVM chain (has chain property)
      const targetOption = chainOptionById.get(targetChainId);
      if (targetOption?.chain) {
        setBridgeTargetChain(targetOption.chain);
      }

      if (mode === "executeIntent") {
        const pendingSteps =
          selectedSourceType === "evm"
            ? [
                { name: "Approve", state: "pending" as const },
                { name: "Burn", state: "pending" as const },
                { name: "Fetch Attestation", state: "pending" as const },
                { name: "Mint", state: "pending" as const },
              ]
            : [
                { name: "Burn", state: "pending" as const },
                { name: "Fetch Attestation", state: "pending" as const },
                { name: "Mint", state: "pending" as const },
              ];

        setIsBridging(true);
        setBridgeResult({
          amount: amount.str,
          token: "USDC",
          state: "pending",
          provider: "CCTPV2BridgingProvider",
          source: {
            address: senderAddress ?? "",
            chain: sourceBridgeDefinition,
          },
          destination: {
            address: finalTargetAddress,
            chain: targetBridgeDefinition,
          },
          steps: pendingSteps,
        });
      }

      let pendingHash: UniversalTxHash | null = null;
      let pendingHashNotified = false;

      const emitPendingHash = (hash: UniversalTxHash) => {
        pendingHash = hash;
        setBridgeTransactionHash(hash);
        setIsBridging(true);

        if (!pendingHashNotified) {
          pendingHashNotified = true;
          onPendingHashResolved?.({
            sourceChainId: selectedSourceId,
            hash,
          });
        }
      };

      try {
        const result = await bridge(
          {
            amount: validation.data.amount,
            sourceChainId: selectedSourceId,
            targetChainId: targetChainId,
            targetAddress: finalTargetAddress,
            transferType,
            appFeeAmount: supportQuote?.feeAmount,
            appFeeBps: supportQuote?.feeBps,
            appFeeRecipient: supportQuote?.recipient,
          },
          {
            onApprovalStart: () => {
              // Show progress screen immediately when EVM approval starts
              setIsBridging(true);
            },
            onPendingHash: (hash) => {
              emitPendingHash(hash);
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
                      address: senderAddress ?? "",
                      chain: sourceBridgeDefinition,
                    },
                  destination:
                    next.destination ??
                    prev?.destination ?? {
                      address: finalTargetAddress,
                      chain: targetBridgeDefinition,
                    },
                  steps: mergedSteps,
                };
              });

              const txHashFromStep =
                next.steps?.find((step) => step.txHash)?.txHash ||
                next.steps?.[0]?.txHash ||
                null;
              if (txHashFromStep && !bridgeTransactionHash) {
                setBridgeTransactionHash(txHashFromStep as UniversalTxHash);
              }
            },
          }
        );

        const primaryHash = result.steps.find((step) => step.txHash)?.txHash as
          | UniversalTxHash
          | undefined;

        if (primaryHash) {
          emitPendingHash(primaryHash);
        }

        setBridgeTransactionHash(primaryHash || pendingHash);

        setBridgeResult(result);

        setIsLoading(false);
        setIsBridging(true);

        if (onBurn) {
          onBurn(true);
        }
        return true;
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
        return false;
      }
    },
    [
      validation,
      chain,
      amount,
      bridge,
      onBurn,
      mode,
      onSubmitIntent,
      onPendingHashResolved,
      toast,
      isSourceChainSynced,
      selectedSourceChain,
      chainOptionById,
      sourceChainId,
      targetChainId,
      address,
      bridgeTransactionHash,
      diffWallet,
      solanaWallet.publicKey,
      solanaWallet.connected,
      isCrossEcosystem,
      crossEcosystemTargetAddress,
      targetAddress,
      defaultTargetWalletAddress,
    ]
  );

  const getStandardSupportKey = useCallback(
    () => `${activeSourceChainId ?? ""}:${targetChainId ?? ""}:${amount?.bigInt ?? ""}`,
    [activeSourceChainId, amount?.bigInt, targetChainId]
  );

  const handleBridgeClick = useCallback(
    (transferSpeed: TransferSpeedValue) => {
      if (
        transferSpeed !== TransferSpeed.SLOW ||
        !amount ||
        !activeSourceChainId ||
        !targetChainId
      ) {
        void handleSend(transferSpeed);
        return;
      }

      const quote = getStandardTransferSupportQuote({
        amount: amount.bigInt,
        sourceChainId: activeSourceChainId,
      });
      const supportKey = getStandardSupportKey();
      if (!quote.eligible || declinedStandardSupportKey === supportKey) {
        void handleSend(transferSpeed);
        return;
      }

      if (mode === "intentOnly") {
        void handleSend(transferSpeed, quote);
        return;
      }

      setStandardSupportQuote(quote);
    },
    [
      amount,
      activeSourceChainId,
      declinedStandardSupportKey,
      getStandardSupportKey,
      handleSend,
      mode,
      targetChainId,
    ]
  );

  const handleBackToNew = () => {
    intentBackRequestedRef.current = true;
    if (executeIntentKey) {
      executedIntentKeysRef.current.delete(executeIntentKey);
    }
    setIntentStarted(false);
    setIntentExecutionState("not-started");
    setIsBridging(false);
    setIsLoading(false);
    setLoadedTransactionData(null);
    setSubmittedRecipientAddress(undefined);
    setBridgeTransactionHash(null); // Reset bridge transaction hash
    setBridgeResult(null);
    setBridgeStartedAt(null);
    setBridgeSourceChain(null);
    setBridgeTargetChain(null);
    setBridgeTargetChainId(null);
    // Call parent callback to reset loaded transaction
    if (onBackToNew) {
      onBackToNew();
    }
  };

  // Effect to handle loaded transaction from history
  useEffect(() => {
    if (loadedTransaction) {
      const originChainOption = chainOptionById.get(loadedTransaction.originChain);
      const targetChainOption = loadedTransaction.targetChain
        ? chainOptionById.get(loadedTransaction.targetChain)
        : undefined;

      if (originChainOption && targetChainOption && loadedTransaction.amount) {
        const fromChain = {
          value: originChainOption.value,
          label: originChainOption.label,
        };
        const toChain = {
          value: targetChainOption.value,
          label: targetChainOption.label,
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
        // Only set bridgeSourceChain/bridgeTargetChain if EVM (they use Chain type)
        if (originChainOption.chain) {
          setBridgeSourceChain(originChainOption.chain);
        }
        if (targetChainOption.chain) {
          setBridgeTargetChain(targetChainOption.chain);
        }
        if (loadedTransaction.date) {
          setBridgeStartedAt(new Date(loadedTransaction.date));
        }
        setIsBridging(true);
      }
    }
  }, [loadedTransaction, chainOptionById]);

  useEffect(() => {
    if (mode !== "executeIntent") {
      intentBackRequestedRef.current = false;
      previousExecuteIntentKeyRef.current = null;
      return;
    }

    const previousKey = previousExecuteIntentKeyRef.current;
    if (previousKey === executeIntentKey) {
      return;
    }

    if (previousKey) {
      executedIntentKeysRef.current.delete(previousKey);
    }

    previousExecuteIntentKeyRef.current = executeIntentKey;
    intentBackRequestedRef.current = false;
    setIntentHydrated(false);
    setIntentStarted(false);
    setIntentExecutionState("idle");
    setStandardSupportQuote(null);
    setStandardSupportPromptPresented(false);
    setStandardSupportPromptResolved(false);
  }, [mode, executeIntentKey]);

  useEffect(() => {
    if (
      mode !== "executeIntent" ||
      !initialIntent ||
      intentHydrated ||
      intentBackRequestedRef.current
    ) {
      return;
    }

    const parsedAmount = parseAmountToState(initialIntent.amount);

    setSourceChainId(initialIntent.sourceChainId);
    userChangedSourceRef.current = true;
    setTargetChainId(initialIntent.targetChainId);
    setAmount(parsedAmount);
    setTargetAddress(initialIntent.targetAddress);
    setDiffWallet(true);
    setActiveTransferSpeed(
      initialIntent.transferType === "fast"
        ? TransferSpeed.FAST
        : TransferSpeed.SLOW
    );
    setIntentHydrated(true);
    setIntentStarted(false);
    setIntentExecutionState("idle");
  }, [mode, initialIntent, intentHydrated, parseAmountToState]);

  useEffect(() => {
    if (mode !== "executeIntent" || !initialIntent) {
      return;
    }

    if (intentBackRequestedRef.current) {
      return;
    }

    if (!intentHydrated || intentExecutionState !== "idle") {
      return;
    }

    if (sourceChainId !== initialIntent.sourceChainId) {
      return;
    }

    if (targetChainId !== initialIntent.targetChainId) {
      return;
    }

    if (amount?.str !== initialIntent.amount) {
      return;
    }

    const speed =
      initialIntent.transferType === "fast"
        ? TransferSpeed.FAST
        : TransferSpeed.SLOW;

    if (
      initialIntent.showStandardSupportPrompt &&
      !standardSupportPromptPresented
    ) {
      const quote = getStandardTransferSupportQuote({
        amount: amount.bigInt,
        sourceChainId: initialIntent.sourceChainId,
      });
      setStandardSupportPromptPresented(true);
      if (quote.eligible) {
        setStandardSupportQuote(quote);
        return;
      }
      setStandardSupportPromptResolved(true);
    }

    if (
      initialIntent.showStandardSupportPrompt &&
      !standardSupportPromptResolved
    ) {
      return;
    }

    if (!executeIntentKey) {
      return;
    }

    if (executedIntentKeysRef.current.has(executeIntentKey)) {
      return;
    }

    executedIntentKeysRef.current.add(executeIntentKey);
    setIntentStarted(true);
    setIntentExecutionState("attempting");

    void (async () => {
      try {
        const didStart = await handleSend(speed);
        setIntentStarted(didStart);
        setIntentExecutionState(didStart ? "started" : "not-started");
      } catch (error) {
        console.error("Execute intent failed:", error);
        setIntentStarted(false);
        setIntentExecutionState("failed");
      }
    })();
  }, [
    mode,
    initialIntent,
    executeIntentKey,
    intentHydrated,
    intentExecutionState,
    sourceChainId,
    targetChainId,
    amount?.str,
    handleSend,
    standardSupportPromptPresented,
    standardSupportPromptResolved,
  ]);

  const submitSupportChoice = (quote?: StandardTransferSupportQuote) => {
    if (mode !== "executeIntent") {
      void handleSend(TransferSpeed.SLOW, quote);
      return;
    }

    setIntentStarted(true);
    setIntentExecutionState("attempting");
    void (async () => {
      const didStart = await handleSend(TransferSpeed.SLOW, quote);
      setIntentStarted(didStart);
      setIntentExecutionState(didStart ? "started" : "not-started");
    })();
  };

  const standardSupportDialog = standardSupportQuote && amount ? (
    <StandardTransferSupportDialog
      open
      amount={amount.bigInt}
      contribution={standardSupportQuote.feeAmount}
      onOpenChange={(open) => {
        if (!open) {
          setStandardSupportQuote(null);
          setStandardSupportPromptPresented(true);
        }
      }}
      onAccept={() => {
        const quote = standardSupportQuote;
        setStandardSupportQuote(null);
        setStandardSupportPromptPresented(true);
        setStandardSupportPromptResolved(true);
        submitSupportChoice(quote);
      }}
      onDecline={() => {
        setDeclinedStandardSupportKey(getStandardSupportKey());
        setStandardSupportQuote(null);
        setStandardSupportPromptPresented(true);
        setStandardSupportPromptResolved(true);
        submitSupportChoice();
      }}
    />
  ) : null;

  // Loading states
  const showChainLoader = !chainOptions.length; // Only show loader when chains haven't loaded
  const showBalanceLoader = isUsdcLoading && !!address && !!chain;
  const hasAmountInput = !!amount?.str;

  const resolveEstimateLabels = useCallback(
    (
      speed: TransferSpeedValue,
      estimate: BridgeEstimate | null | undefined,
      isEstimating: boolean
    ) => {
      return buildEstimateLabels({
        speed,
        estimate,
        isEstimating,
        amountIsValid: amountForEstimate.isValid,
        chainSelectionValid,
        hasAmountInput,
        amount,
        activeSourceChainId,
        transferSpeedLabel: getTransferSpeedLabel(speed),
      });
    },
    [
      amountForEstimate.isValid,
      chainSelectionValid,
      hasAmountInput,
      amount,
      getTransferSpeedLabel,
      activeSourceChainId,
    ]
  );

  // Render the bridge comparison table (desktop) and cards (mobile)
  const renderBridgeComparison = () => {
    const fastLabels = resolveEstimateLabels(TransferSpeed.FAST, fastEstimate, isFastEstimating);
    const standardLabels = resolveEstimateLabels(TransferSpeed.SLOW, standardEstimate, isStandardEstimating);

    const isFastSubmitting = (isLoading || isBridgeLoading) && activeTransferSpeed === TransferSpeed.FAST;
    const isStandardSubmitting = (isLoading || isBridgeLoading) && activeTransferSpeed === TransferSpeed.SLOW;

    // Show "Enter Address" when bridging from Solana without EVM wallet connected
    const needsDestinationAddress =
      sourceChainType === "solana" &&
      isCrossEcosystem &&
      !crossEcosystemTargetAddress &&
      !validationTargetAddress;
    const validationMessage = validation.isValid ? null : (needsDestinationAddress ? "Enter Address" : validation.errors[0] || "Complete the form");

    const renderButton = (speed: TransferSpeedValue, isPrimary: boolean) => {
      const isSubmitting = speed === TransferSpeed.FAST ? isFastSubmitting : isStandardSubmitting;
      const buttonText = validationMessage || (speed === TransferSpeed.FAST ? "Bridge Fast" : "Bridge Standard");
      const buttonClass = isPrimary
        ? "w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2.5"
        : "w-full border border-slate-700 text-white hover:bg-slate-800 bg-transparent text-sm font-medium py-2.5";

      const button = (
        <LoadingButton
          className={buttonClass}
          onClick={() => handleBridgeClick(speed)}
          isLoading={isSubmitting}
          disabled={!validation.isValid || isLoading || isBridgeLoading || isSwitchingChain}
        >
          {buttonText}
        </LoadingButton>
      );

      return sourceChainType === "solana" ? (
        <SolanaConnectGuard>{button}</SolanaConnectGuard>
      ) : (
        <ConnectGuard>{button}</ConnectGuard>
      );
    };

    return (
      <>
        <BridgeComparison
          fastTransferSupported={fastTransferSupported}
          fastLabels={fastLabels}
          standardLabels={standardLabels}
          renderButton={renderButton}
        />
        {standardSupportDialog}
      </>
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
          confirmations={getCctpConfirmationsUniversal(loadedTransaction.originChain) || undefined}
          finalityEstimate={(() => {
            const chainDef = getBridgeChainByIdUniversal(loadedTransaction.originChain);
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
            const sourceChainDef = getBridgeChainByIdUniversal(loadedTransaction.originChain);
            const destChainDef =
              (loadedTransaction.targetChain &&
                getBridgeChainByIdUniversal(loadedTransaction.targetChain)) ||
              sourceChainDef;

            if (!sourceChainDef || !destChainDef) return undefined;

            return {
              amount: loadedTransaction.amount ?? "0",
              token: "USDC",
              state: loadedTransaction.bridgeState ?? "pending",
              provider: "CCTPV2BridgingProvider",
              source: {
                address: "",
                chain: toChainDefinition(sourceChainDef),
              },
              destination: {
                address: loadedTransaction.targetAddress || "",
                chain: toChainDefinition(destChainDef),
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
            loadedTransaction.originChain,
            loadedTransaction.estimatedTime
          )}
          onMessageExpiredNonce={(nonce) => {
            onMessageExpiredNonce?.({
              sourceChainId: loadedTransaction.originChain,
              nonce,
            });
          }}
        />
      );
    } else if (
      (bridgeTargetChain || bridgeTargetChainId || targetChain) &&
      amount &&
      (bridgeTransactionHash || bridgeResult || mode === "executeIntent")
    ) {
      const sourceId = sourceChainId ?? bridgeSourceChain?.id ?? chain?.id ?? null;
      // Use bridgeTargetChainId for Solana destinations (where bridgeTargetChain is null)
      const targetId = bridgeTargetChainId ?? bridgeTargetChain?.id ?? targetChain?.id ?? targetChainId ?? null;

      const sourceChainOption = sourceId != null
        ? chainOptionById.get(sourceId as ChainId)
        : null;
      // Get target chain label from chainOptionById (works for both EVM and Solana)
      const targetChainOption = targetId != null ? chainOptionById.get(targetId) : null;

      const fromChain = {
        value: sourceId != null ? sourceId.toString() : "",
        label: sourceChainOption?.label || bridgeSourceChain?.name || chain?.name || "Source",
      };
      const toChain = {
        value: targetId != null ? targetId.toString() : "",
        label: targetChainOption?.label || bridgeTargetChain?.name || targetChain?.name || "Destination",
      };

      const recipientAddressValue = resolveRecipientForBridgingState({
        submittedRecipientAddress,
        diffWallet,
        validationTargetAddress,
        defaultTargetWalletAddress,
      });
      const sourceChainIdForResult = sourceId ?? undefined;
      // Use targetId directly - it's already the correct ChainId type (number for EVM, string for Solana)
      const targetChainIdForResult = targetId ?? undefined;
      const sourceAddressValue =
        sourceChainIdForResult && getChainType(sourceChainIdForResult) === "solana"
          ? (solanaWallet.publicKey?.toBase58() ?? "")
          : (address ?? "");

      const sourceChainDef = sourceChainIdForResult
        ? getBridgeChainByIdUniversal(sourceChainIdForResult)
        : null;
      const confirmations = sourceChainIdForResult
        ? getCctpConfirmationsUniversal(sourceChainIdForResult) || undefined
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
          estimatedTimeLabel={getEtaLabel(
            activeTransferSpeed,
            sourceChainIdForResult,
            finalityEstimate
          )}
          bridgeResult={(() => {
            if (bridgeResult) return bridgeResult;
            const destChain = targetChainIdForResult
              ? getBridgeChainByIdUniversal(targetChainIdForResult)
              : null;
            if (sourceChainDef && destChain && bridgeTransactionHash) {
              return {
                amount: amount.str,
                token: "USDC" as const,
                state: "pending" as const,
                provider: "CCTPV2BridgingProvider",
                source: {
                  address: sourceAddressValue,
                  chain: toChainDefinition(sourceChainDef),
                },
                destination: {
                  address: recipientAddressValue || "",
                  chain: toChainDefinition(destChain),
                },
                steps: [],
              };
            }
            return undefined;
          })()}
          onMessageExpiredNonce={(nonce) => {
            if (!sourceChainIdForResult) return;
            onMessageExpiredNonce?.({
              sourceChainId: sourceChainIdForResult,
              nonce,
            });
          }}
        />
      );
    } else if (mode === "executeIntent") {
      return <IntentStatusCard state="submitting-burn" onBack={handleBackToNew} />;
    }
  }

  if (mode === "executeIntent" && !bridgeTransactionHash && !loadedTransactionData) {
    if (standardSupportDialog) {
      return standardSupportDialog;
    }
    const intentDidNotStart =
      intentExecutionState === "not-started" ||
      intentExecutionState === "failed";
    const isSubmitting =
      !intentDidNotStart && (isLoading || isBridgeLoading || intentStarted);

    return (
      <IntentStatusCard
        state={
          intentDidNotStart
            ? "not-started"
            : isSubmitting
            ? "preparing"
            : "waiting"
        }
        onBack={handleBackToNew}
      />
    );
  }

  return (
    <>
      <Card className="bg-gradient-to-br from-slate-800/95 via-slate-800/98 to-slate-900/100 backdrop-blur-sm border-slate-700/50 text-white">
        <CardContent className="p-4 md:p-6 space-y-4">
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
                  disabled={isLoading || isSwitchingChain || (!address && !solanaWallet.connected)}
                >
                  <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white">
                    <SelectValue placeholder="Select Chain...">
                      {(() => {
                        // Get chain option - works for both EVM and Solana chains
                        const chainOption = sourceChainId != null
                          ? chainOptionById.get(sourceChainId)
                          : chain?.id
                            ? chainOptionById.get(chain.id)
                            : chainOptions[0];
                        if (!chainOption) return null;
                        const connected = isChainConnected(chainOption);
                        return (
                          <div className="flex items-center gap-2">
                            {isSwitchingChain ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <ChainIcon chainId={chainOption.id} size={24} />
                            )}
                            <span>{chainOption.label}</span>
                            {isSwitchingChain ? (
                              <span className="text-xs text-slate-400 ml-auto">
                                Switching...
                              </span>
                            ) : connected ? (
                              <span className="text-green-500 ml-auto">●</span>
                            ) : null}
                          </div>
                        );
                      })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {sourceChainOptions.map((chainOption) => {
                      const connected = isChainConnected(chainOption);
                      return (
                        <SelectItem
                          key={chainOption.value}
                          value={chainOption.value}
                          className="text-white hover:bg-slate-700"
                        >
                          <div className="flex items-center gap-2">
                            <ChainIcon chainId={chainOption.id} size={24} />
                            <span>{chainOption.label}</span>
                            {connected && (
                              <span className="ml-auto text-green-500">●</span>
                            )}
                          </div>
                        </SelectItem>
                      );
                    })}
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
                    // Handle both EVM (number) and Solana (string) chain IDs
                    const chainId = value.startsWith("Solana") ? value : Number(value);
                    const selectedChain = chainOptionById.get(chainId as ChainId);
                    if (selectedChain) {
                      setTargetChainId(selectedChain.id);
                    }
                  }}
                  disabled={isLoading || !destinationOptions.length}
                >
                  <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white">
                    <SelectValue placeholder="Select Chain...">
                      {(() => {
                        // Get chain option - works for both EVM and Solana chains
                        const chainOption = targetChainId != null
                          ? chainOptionById.get(targetChainId)
                          : undefined;
                        if (!chainOption) return null;
                        const connected = isChainConnected(chainOption);
                        return (
                          <div className="flex items-center gap-2">
                            <ChainIcon chainId={chainOption.id} size={24} />
                            <span className="truncate">
                              {chainOption.label}
                            </span>
                            {connected && (
                              <span className="text-green-500 ml-auto">●</span>
                            )}
                          </div>
                        );
                      })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {destinationOptions.map((chainOption) => {
                      const connected = isChainConnected(chainOption);
                      return (
                        <SelectItem
                          key={chainOption.value}
                          value={chainOption.value}
                          className="text-white hover:bg-slate-700"
                        >
                          <div className="flex items-center gap-2">
                            <ChainIcon chainId={chainOption.id} size={24} />
                            <span>{chainOption.label}</span>
                            {connected && (
                              <span className="ml-auto text-green-500">●</span>
                            )}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {/* Amount Input */}
          <div className="bg-slate-900/50 rounded-lg px-4 py-3">
            <div className="flex justify-between items-center mb-2">
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

          {/* Custom Recipient Address */}
          {(address || solanaWallet.publicKey) && targetChainId && (
            <div className="space-y-3">
              {/* Show checkbox only for same-ecosystem bridging */}
              {!isCrossEcosystem && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="custom-address"
                    checked={diffWallet}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setDiffWallet(true);
                        setTargetAddress(defaultTargetWalletAddress);
                      } else {
                        setDiffWallet(false);
                        setTargetAddress(undefined);
                      }
                    }}
                    disabled={isLoading}
                  />
                  <Label
                    htmlFor="custom-address"
                    className="text-xs text-slate-300 cursor-pointer"
                  >
                    Send to a different wallet on {chainOptionById.get(targetChainId)?.label || "destination chain"}
                  </Label>
                </div>
              )}
              {/* Cross-ecosystem with connected destination wallet: show read-only address */}
              {isCrossEcosystem && crossEcosystemTargetAddress && (
                <div className="space-y-2">
                  <Label className="text-sm text-slate-300">
                    Destination Wallet on {targetChainType === "solana" ? "Solana" : "EVM"}
                  </Label>
                  <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-slate-700/50 border border-slate-600">
                    <span className="text-white font-mono text-sm truncate">
                      {crossEcosystemTargetAddress}
                    </span>
                    <span className="text-xs text-green-400 whitespace-nowrap">Connected</span>
                  </div>
                </div>
              )}
              {/* Cross-ecosystem without destination wallet OR same-ecosystem diffWallet: show input */}
              {((isCrossEcosystem && !crossEcosystemTargetAddress) || (!isCrossEcosystem && diffWallet)) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm text-slate-300">
                      Destination Wallet
                    </Label>
                    {addressValidation.isValidating && (
                      <span className="text-xs text-slate-400">Validating...</span>
                    )}
                    {addressValidation.error && !addressValidation.isValidating && (
                      <span className="text-xs text-red-400">{addressValidation.error}</span>
                    )}
                    {addressValidation.warning && !addressValidation.error && !addressValidation.isValidating && (
                      <span className="text-xs text-yellow-400">{addressValidation.warning}</span>
                    )}
                  </div>
                  <Input
                    placeholder={targetChainType === "solana" ? "Solana address..." : "0x..."}
                    value={targetAddress || ""}
                    onChange={(e) => setTargetAddress(e.target.value)}
                    className={`bg-slate-700/50 border-slate-600 text-white ${
                      addressValidation.error && !addressValidation.isValidating
                        ? "border-red-500 focus:border-red-500"
                        : addressValidation.warning && !addressValidation.isValidating
                        ? "border-yellow-500 focus:border-yellow-500"
                        : ""
                    }`}
                    disabled={isLoading}
                  />
                </div>
              )}
            </div>
          )}

          {/* Transfer Options - Comparison Table */}
          {renderBridgeComparison()}
        </CardContent>
      </Card>
    </>
  );
}
