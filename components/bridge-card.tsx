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
import {
  AmountState,
  LocalTransaction,
  ChainId,
  getChainType,
  isSolanaChain,
} from "@/lib/types";
import { useCrossEcosystemBridge } from "@/lib/hooks/useCrossEcosystemBridge";
import { createSolanaAdapter } from "@/lib/solanaAdapter";
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
import { TransferSpeed } from "@circle-fin/bridge-kit";
import {
  createReadonlyAdapter,
  getBridgeChainByIdUniversal,
  getCctpConfirmationsUniversal,
  getBridgeKit,
  resolveBridgeChain,
  resolveBridgeChainUniversal,
  getAllSupportedChains,
  getProviderFromWalletClient,
  getChainName,
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
  const { bridge, isLoading: isBridgeLoading } = useCrossEcosystemBridge();
  const { usdcBalance: evmUsdcBalance, usdcFormatted: evmUsdcFormatted, isUsdcLoading: evmIsUsdcLoading } = useBalance();
  const solanaWallet = useWallet();
  const { usdcBalance: solanaUsdcBalance, usdcFormatted: solanaUsdcFormatted, isLoading: solanaIsUsdcLoading } = useSolanaBalance();
  const { data: walletClient } = useWalletClient();
  const provider = getProviderFromWalletClient(walletClient);

  // State
  const [sourceChainId, setSourceChainId] = useState<ChainId | null>(
    () => chain?.id ?? null
  );
  const [targetChainId, setTargetChainId] = useState<ChainId | null>(null);
  const [amount, setAmount] = useState<AmountState | null>(null);
  const [activeTransferSpeed, setActiveTransferSpeed] = useState<TransferSpeed>(
    TransferSpeed.FAST
  );
  const [diffWallet, setDiffWallet] = useState(false);
  const [targetAddress, setTargetAddress] = useState<string | undefined>(undefined);
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

  type ChainOption = {
    value: string;
    label: string;
    id: ChainId;
    chain?: Chain; // Optional - not present for Solana chains
    chainType: "evm" | "solana";
  };

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
  const chainOptions = useMemo<ChainOption[]>(() => {
    const evmOptions: ChainOption[] = supportedEvmChains.map((c) => ({
      value: c.id.toString(),
      label: c.name,
      id: c.id,
      chain: c,
      chainType: "evm" as const,
    }));

    const solanaChains = allBridgeKitChains.filter(c => c.type === "solana");
    const solanaOptions: ChainOption[] = solanaChains.map((c) => ({
      value: c.chain as string,
      label: c.name || (c.chain as string),
      id: c.chain as ChainId,
      chainType: "solana" as const,
    }));

    return [...evmOptions, ...solanaOptions];
  }, [supportedEvmChains, allBridgeKitChains]);

  const chainOptionById = useMemo(() => {
    const map = new Map<ChainId, ChainOption>();
    chainOptions.forEach((option) => map.set(option.id, option));
    return map;
  }, [chainOptions]);

  const destinationOptionsBySource = useMemo(() => {
    const map = new Map<ChainId, ChainOption[]>();
    chainOptions.forEach((source) => {
      map.set(
        source.id,
        chainOptions.filter((option) => option.id !== source.id)
      );
    });
    return map;
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

    // Sort: connected chains first, then rest alphabetically
    return [...baseOptions].sort((a, b) => {
      const aConnected = isChainConnected(a);
      const bConnected = isChainConnected(b);
      if (aConnected && !bConnected) return -1;
      if (!aConnected && bConnected) return 1;
      return a.label.localeCompare(b.label);
    });
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

  const fastTransferSupported = useMemo(() => {
    if (!activeSourceChainId) return false;
    // Fast transfer supported for any source chain that has fast confirmations
    // Per CCTP docs: Solana supports Fast Transfer as both source and destination
    return Boolean(getCctpConfirmationsUniversal(activeSourceChainId)?.fast);
  }, [activeSourceChainId]);

  const walletChainId = chain?.id;

  const sourceChainOptions = useMemo(() => {
    // Sort: connected chains first, then rest alphabetically
    return [...chainOptions].sort((a, b) => {
      const aConnected = isChainConnected(a);
      const bConnected = isChainConnected(b);
      if (aConnected && !bConnected) return -1;
      if (!aConnected && bConnected) return 1;
      return a.label.localeCompare(b.label);
    });
  }, [chainOptions, isChainConnected]);

  // Track the previous wallet chain to detect actual wallet chain changes
  const prevWalletChainRef = useRef<number | undefined>(walletChainId);

  // Sync source chain to wallet chain ONLY when wallet chain actually changes
  // Don't override if user explicitly selected a different chain (like Solana)
  useEffect(() => {
    const prevWalletChain = prevWalletChainRef.current;
    prevWalletChainRef.current = walletChainId;

    // Only sync if wallet chain changed (not on every sourceChainId change)
    if (walletChainId && walletChainId !== prevWalletChain && evmChainIds.has(walletChainId)) {
      setSourceChainId(walletChainId);
      return;
    }

    // Fallback: set first supported chain if no source chain selected
    if (sourceChainId == null && chainOptions.length > 0) {
      setSourceChainId(chainOptions[0].id);
    }
  }, [walletChainId, evmChainIds, chainOptions, sourceChainId]);

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

  // Auto-set address input for cross-ecosystem bridging
  useEffect(() => {
    if (isCrossEcosystem) {
      // Force diffWallet mode for cross-ecosystem and pre-fill with target ecosystem wallet
      setDiffWallet(true);
      if (crossEcosystemTargetAddress) {
        setTargetAddress(crossEcosystemTargetAddress);
      }
    } else {
      // Reset to default for same-ecosystem bridging
      setDiffWallet(false);
      setTargetAddress(undefined);
    }
  }, [isCrossEcosystem, crossEcosystemTargetAddress]);

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
        isCustomAddress: diffWallet,
        targetAddress,
      }),
    [
      amount,
      targetChain?.id,
      targetChainId,
      activeSourceChainId,
      usdcBalance,
      address,
      diffWallet,
      targetAddress,
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
  const hasCompleteForm = useMemo(() => {
    const hasWalletForSource = sourceChainType === "solana"
      ? solanaWallet.connected
      : !!chain;
    return hasWalletForSource && isSourceChainSynced && (!!targetChain || !!targetChainId) && !!amount;
  }, [sourceChainType, solanaWallet.connected, chain, isSourceChainSynced, targetChain, targetChainId, amount]);

  // Can we estimate via SDK?
  // SDK requires adapters for BOTH source and destination
  // - EVM chains: Can use readonly adapter (no wallet needed)
  // - Solana chains: Requires connected wallet (no readonly mode)
  const hasSolanaWallet = solanaWallet.connected && !!solanaWallet.wallet?.adapter;
  const canEstimate =
    amountForEstimate.isValid &&
    chainSelectionValid &&
    activeSourceChainId != null &&
    targetChainId != null &&
    // If source is Solana, need wallet; EVM always works
    (sourceChainType !== "solana" || hasSolanaWallet) &&
    // If target is Solana, need wallet; EVM always works
    (targetChainType !== "solana" || hasSolanaWallet);

  const estimateBridge = useCallback(
    async (transferSpeed: TransferSpeed): Promise<BridgeEstimateResult> => {
      const sourceId = sourceChainId ?? chain?.id;
      const targetId = targetChainId;

      if (!sourceId || !targetId || !amount) {
        throw new Error("Bridge parameters incomplete");
      }

      const sourceChainDef = resolveBridgeChainUniversal(sourceId);
      const destinationChainDef = resolveBridgeChainUniversal(targetId);

      // Create source adapter based on chain type
      const sourceAdapter = isSolanaChain(sourceId)
        ? await createSolanaAdapter(solanaWallet.wallet!.adapter)
        : await createReadonlyAdapter(sourceId as number);

      // Create destination adapter based on chain type
      const destAdapter = isSolanaChain(targetId)
        ? await createSolanaAdapter(solanaWallet.wallet!.adapter)
        : await createReadonlyAdapter(targetId as number);

      return getBridgeKit().estimate({
        from: {
          adapter: sourceAdapter,
          chain: sourceChainDef as Parameters<typeof getBridgeKit>["0"] extends undefined ? never : any,
        },
        to: {
          adapter: destAdapter,
          chain: destinationChainDef as Parameters<typeof getBridgeKit>["0"] extends undefined ? never : any,
        },
        amount: formatUnits(amount.bigInt, 6),
        token: "USDC",
        config: { transferSpeed },
      });
    },
    [sourceChainId, targetChainId, amount, chain?.id, solanaWallet.wallet]
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
      targetChainId, // Use targetChainId instead of targetChain?.id for Solana support
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
      targetChainId, // Use targetChainId instead of targetChain?.id for Solana support
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
          ? getBridgeChainByIdUniversal(activeSourceChainId)
          : undefined;
      const confirmations =
        activeSourceChainId != null ? getCctpConfirmationsUniversal(activeSourceChainId) : null;
      const blocks =
        speed === TransferSpeed.FAST ? confirmations?.fast : confirmations?.standard;
      const finality = sourceChain
        ? getFinalityEstimate(
            sourceChain.name || String(sourceChain.chain),
            speed
          )?.averageTime
        : undefined;

      // Show time estimate with block count, e.g., "~8 Sec (1 Block)"
      const blockLabel = blocks ? `${blocks} ${blocks === 1 ? "Block" : "Blocks"}` : null;
      if (finality && blockLabel) {
        return `${finality} (${blockLabel})`;
      }
      return finality ?? blockLabel ?? "Estimate unavailable";
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

  const handleSwitchChain = async (chainIdValue: string) => {
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
        !targetChainId ||
        !amount
      ) {
        return;
      }

      try {
        resolveBridgeChainUniversal(selectedSourceId);
        resolveBridgeChainUniversal(targetChainId);
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
      // Only set bridgeTargetChain if it's an EVM chain (has chain property)
      const targetOption = chainOptionById.get(targetChainId);
      if (targetOption?.chain) {
        setBridgeTargetChain(targetOption.chain);
      }

      let pendingHash: string | null = null;
      try {
        const transferType = transferSpeed === TransferSpeed.FAST ? "fast" : "standard";
        // Use custom address if specified, otherwise use connected wallet
        // For Solana source, use Solana address; for EVM source, use EVM address
        const senderAddress = sourceChainType === "solana"
          ? solanaWallet.publicKey?.toBase58()
          : address;
        const finalTargetAddress = diffWallet && validation.data.targetAddress
          ? validation.data.targetAddress
          : senderAddress;

        const result = await bridge(
          {
            amount: validation.data.amount,
            sourceChainId: selectedSourceId,
            targetChainId: targetChainId,
            targetAddress: finalTargetAddress,
            transferType,
          },
          {
            onPendingHash: (hash) => {
              pendingHash = hash;
              setBridgeTransactionHash(hash as `0x${string}`);
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
                      address: senderAddress ?? "",
                      chain: resolveBridgeChainUniversal(selectedSourceId) as unknown as ChainDefinition,
                    },
                  destination:
                    next.destination ??
                    prev?.destination ?? {
                      address: finalTargetAddress ?? "",
                      chain: resolveBridgeChainUniversal(targetChainId) as unknown as ChainDefinition,
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
      diffWallet,
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

  // Loading states
  const showChainLoader = !chainOptions.length; // Only show loader when chains haven't loaded
  const showBalanceLoader = isUsdcLoading && !!address && !!chain;
  const hasAmountInput = !!amount?.str;

  const renderSpeedCard = (
    speed: TransferSpeed,
    estimate: BridgeEstimateResult | null | undefined,
    isEstimating: boolean
  ) => {
    const feeTotal = getTotalProtocolFee(estimate);

    // Estimate blocking conditions
    // Need Solana wallet if source OR destination is Solana
    const needsSolanaWallet = sourceChainType === "solana" || targetChainType === "solana";
    const blockedEstimateLabel = !amountForEstimate.isValid
      ? "Complete the form"
      : !isSourceChainSynced
      ? "Switch wallet to selected chain"
      : !chainSelectionValid
      ? "Select different chains"
      : needsSolanaWallet && !hasSolanaWallet
      ? "Connect Solana wallet"
      : null;

    const feeLabel = !hasAmountInput
      ? "Enter amount"
      : blockedEstimateLabel
      ? blockedEstimateLabel
      : isEstimating
      ? "Fetching..."
      : estimate
      ? `${feeTotal.toFixed(6)} USDC`
      : "Awaiting estimate";

    const receiveLabel = !hasAmountInput
      ? "Enter amount"
      : blockedEstimateLabel
      ? blockedEstimateLabel
      : estimate
      ? getYouWillReceive(feeTotal)
      : "Enter amount";

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

        {/* Use appropriate connect guard based on source chain type */}
        {sourceChainType === "solana" ? (
          <SolanaConnectGuard>
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
          </SolanaConnectGuard>
        ) : (
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
        )}
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
              provider: loadedTransaction.provider ?? "CCTPV2BridgingProvider",
              source: {
                address: loadedTransaction.targetAddress || "",
                chain: sourceChainDef as unknown as ChainDefinition,
              },
              destination: {
                address: loadedTransaction.targetAddress || "",
                chain: destChainDef as unknown as ChainDefinition,
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

      const recipientAddressValue = (diffWallet && targetAddress) ? targetAddress : (address ?? undefined);
      const sourceChainIdForResult = sourceId ?? (fromChain.value ? Number(fromChain.value) : undefined);
      const targetChainIdForResult =
        targetId ?? (toChain.value ? Number(toChain.value) : undefined);

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
          estimatedTimeLabel={getEtaLabel(activeTransferSpeed, finalityEstimate)}
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
                  <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-slate-700/50 border border-slate-600">
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
                  </div>
                  <Input
                    placeholder={targetChainType === "solana" ? "Solana address..." : "0x..."}
                    value={targetAddress || ""}
                    onChange={(e) => setTargetAddress(e.target.value)}
                    className={`bg-slate-700/50 border-slate-600 text-white ${
                      addressValidation.error && !addressValidation.isValidating
                        ? "border-red-500 focus:border-red-500"
                        : ""
                    }`}
                    disabled={isLoading}
                  />
                </div>
              )}
            </div>
          )}

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
          ) : sourceChainType === "solana" ? (
            <SolanaConnectGuard>
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
            </SolanaConnectGuard>
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
