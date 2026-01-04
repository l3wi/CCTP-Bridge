import { useState, useMemo, useEffect, useCallback } from "react";
import { useAccount, useChains, useSwitchChain } from "wagmi";
import { Chain } from "viem";
import { TransferSpeed } from "@circle-fin/bridge-kit";
import { getSupportedEvmChains, getCctpConfirmations } from "@/lib/bridgeKit";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/use-toast";

export interface ChainOption {
  value: string;
  label: string;
  id: number;
  chain: Chain;
}

interface UseChainSelectionOptions {
  initialTransferSpeed?: TransferSpeed;
}

interface UseChainSelectionReturn {
  // State
  sourceChainId: number | null;
  targetChainId: number | null;
  setSourceChainId: (id: number | null) => void;
  setTargetChainId: (id: number | null) => void;

  // Derived chain values
  selectedSourceChain: Chain | null;
  targetChain: Chain | null;
  activeSourceChainId: number | null;

  // Chain options
  chainOptions: ChainOption[];
  sourceChainOptions: ChainOption[];
  destinationOptions: ChainOption[];
  chainOptionById: Map<number, ChainOption>;

  // Flags
  isSourceChainSynced: boolean;
  fastTransferSupported: boolean;
  isSwitchingChain: boolean;
  supportedChains: Chain[];

  // Transfer speed
  activeTransferSpeed: TransferSpeed;
  setActiveTransferSpeed: (speed: TransferSpeed) => void;

  // Handlers
  handleSwitchChain: (chainId: string) => Promise<void>;
}

export function useChainSelection(
  options?: UseChainSelectionOptions
): UseChainSelectionReturn {
  const { chain } = useAccount();
  const chains = useChains();
  const { switchChain } = useSwitchChain();
  const { toast } = useToast();

  // State
  const [sourceChainId, setSourceChainId] = useState<number | null>(
    () => chain?.id ?? null
  );
  const [targetChainId, setTargetChainId] = useState<number | null>(null);
  const [isSwitchingChain, setIsSwitchingChain] = useState(false);
  const [activeTransferSpeed, setActiveTransferSpeed] = useState<TransferSpeed>(
    options?.initialTransferSpeed ?? TransferSpeed.FAST
  );
  const [supportedChains, setSupportedChains] = useState<Chain[]>([]);

  // Bridge Kit chains
  const bridgeKitChains = useMemo(() => {
    try {
      return getSupportedEvmChains();
    } catch (e) {
      console.error("Failed to load supported chains:", e);
      return [];
    }
  }, []);

  const supportedChainIds = useMemo(
    () => new Set(bridgeKitChains.map((c) => c.chainId)),
    [bridgeKitChains]
  );

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

  // Chain options
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

  // Derived chain values
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

  // Sync source chain to wallet chain when wallet connects or changes chain
  useEffect(() => {
    if (walletChainId && supportedChainIds.has(walletChainId)) {
      setSourceChainId(walletChainId);
      return;
    }

    // Fallback: set first supported chain if no wallet or unsupported chain
    if (sourceChainId == null && supportedChains.length > 0) {
      setSourceChainId(supportedChains[0].id);
    }
  }, [walletChainId, supportedChainIds, supportedChains, sourceChainId]);

  // Keep the destination list consistent with the selected source chain
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

  // Reset transfer speed if FAST not supported
  useEffect(() => {
    if (
      activeSourceChainId &&
      !fastTransferSupported &&
      activeTransferSpeed === TransferSpeed.FAST
    ) {
      setActiveTransferSpeed(TransferSpeed.SLOW);
    }
  }, [activeSourceChainId, fastTransferSupported, activeTransferSpeed]);

  // Chain switch handler
  const handleSwitchChain = useCallback(
    async (chainIdStr: string) => {
      const parsedChainId = Number(chainIdStr);
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
    },
    [switchChain, toast]
  );

  return {
    // State
    sourceChainId,
    targetChainId,
    setSourceChainId,
    setTargetChainId,

    // Derived chain values
    selectedSourceChain,
    targetChain,
    activeSourceChainId,

    // Chain options
    chainOptions,
    sourceChainOptions,
    destinationOptions,
    chainOptionById,

    // Flags
    isSourceChainSynced,
    fastTransferSupported,
    isSwitchingChain,
    supportedChains,

    // Transfer speed
    activeTransferSpeed,
    setActiveTransferSpeed,

    // Handlers
    handleSwitchChain,
  };
}
