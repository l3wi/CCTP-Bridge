"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { History, CheckCircle, ExternalLink, Clock, Plus, X, ArrowLeft, Loader2 } from "lucide-react";
import { useChains } from "wagmi";
import { LocalTransaction, type UniversalTxHash, type ChainId, isValidTxHash, isValidEvmTxHash, isSolanaChain, getChainType } from "@/lib/types";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { ChainIcon } from "@/components/chain-icon";
import { getExplorerTxUrlUniversal, getAllSupportedChains, BRIDGEKIT_ENV, getBridgeChainByIdUniversal, type UniversalChainDefinition } from "@/lib/bridgeKit";
import { fetchAttestationUniversal } from "@/lib/iris";
import { getChainIdFromDomainUniversal, getChainInfoFromDomainAllChains, isNonceUsed } from "@/lib/contracts";
import type { BridgeResult, ChainDefinition } from "@circle-fin/bridge-kit";

interface HistoryModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onLoadBridging?: (transaction: LocalTransaction) => void;
}

type ModalView = "history" | "add-transaction";

export function HistoryModal({
  open,
  onOpenChange,
  onLoadBridging,
}: HistoryModalProps) {
  const [isOpen, setIsOpen] = useState(open || false);
  const [view, setView] = useState<ModalView>("history");
  const { transactions, updateTransaction, addTransaction, removeTransaction } = useTransactionStore();
  const chains = useChains();

  const handleOpenChange = (newOpen: boolean) => {
    setIsOpen(newOpen);
    onOpenChange?.(newOpen);
    if (!newOpen) {
      setView("history");
    }
  };

  const handleDeleteTransaction = (hash: UniversalTxHash) => {
    removeTransaction(hash);
  };

  const handleAddTransactionSuccess = () => {
    setView("history");
  };

  // Sort transactions by date (newest first)
  const sortedTransactions = useMemo(
    () =>
      [...transactions].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      ),
    [transactions]
  );

  const handleTransactionClick = (transaction: LocalTransaction) => {
    if (onLoadBridging) {
      onLoadBridging(transaction);
      handleOpenChange(false);
    }
  };

  const pendingCount = useMemo(
    () =>
      transactions.filter((tx) => {
        // If status is explicitly claimed/failed, it's not pending
        if (tx.status === "claimed" || tx.status === "failed") return false;
        // Check pending indicators
        return (
          tx.status === "pending" ||
          tx.bridgeState === "pending" ||
          tx.bridgeResult?.state === "pending"
        );
      }).length,
    [transactions]
  );

  const claimableCount = useMemo(() => {
    return transactions.filter((tx) => {
      // If already claimed or failed, not claimable
      if (tx.status === "claimed" || tx.status === "failed") return false;
      const steps = tx.steps || tx.bridgeResult?.steps || [];
      // Heuristic: look for a step that mentions claim and is pending/ready
      return steps.some((step) => {
        const state = step.state as string;
        return /claim/i.test(step.name) && (state === "pending" || state === "ready");
      });
    }).length;
  }, [transactions]);

  // Create a set of existing tx hashes for duplicate detection
  const existingHashes = useMemo(
    () => new Set(transactions.map((tx) => tx.hash.toLowerCase())),
    [transactions]
  );

  const badgeLabel =
    claimableCount > 0
      ? `${claimableCount} Claimable`
      : pendingCount > 0
      ? `${pendingCount} Pending`
      : null;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700/50 hover:text-white flex items-center gap-2 px-3"
          >
            <History className="h-4 w-4" />
            {badgeLabel && (
              <span className="text-xs font-medium text-slate-100 bg-slate-700/80 px-2 py-1 rounded-full">
                {badgeLabel}
              </span>
            )}
          </Button>
        </DialogTrigger>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-2xl p-3 sm:p-6">
          {view === "history" ? (
            <>
              <DialogHeader className="flex flex-row items-center justify-between pr-8">
                <DialogTitle>Transaction History</DialogTitle>
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-slate-700 border-slate-600 text-white hover:bg-slate-600"
                  onClick={() => setView("add-transaction")}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  <span className="sm:hidden">Add</span>
                  <span className="hidden sm:inline">Add Transaction</span>
                </Button>
              </DialogHeader>
              <div className="space-y-4 max-h-96 has-[>*:nth-child(4)]:max-h-[36rem] overflow-y-auto" data-scrollable="true">
                {sortedTransactions.length > 0 ? (
                  sortedTransactions.map((tx) => (
                    <TransactionRow
                      key={tx.hash}
                      tx={tx}
                      chains={chains}
                      updateTransaction={updateTransaction}
                      onTransactionClick={handleTransactionClick}
                      onDelete={handleDeleteTransaction}
                    />
                  ))
                ) : (
                  <div className="text-center py-8 text-slate-400">
                    <p>No transactions yet</p>
                    <p className="text-sm mt-1">
                      Your bridge transactions will appear here
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <AddTransactionView
              onBack={() => setView("history")}
              onSuccess={handleAddTransactionSuccess}
              addTransaction={addTransaction}
              existingHashes={existingHashes}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

interface TransactionRowProps {
  tx: LocalTransaction;
  chains: ReturnType<typeof useChains>;
  updateTransaction: (
    hash: `0x${string}`,
    updates: Partial<LocalTransaction>
  ) => void;
  onTransactionClick: (transaction: LocalTransaction) => void;
  onDelete: (hash: UniversalTxHash) => void;
}

function TransactionRow({
  tx,
  chains,
  updateTransaction,
  onTransactionClick,
  onDelete,
}: TransactionRowProps) {
  // Get chain information - use Bridge Kit for universal support (EVM + Solana)
  const originChainDef = useMemo(
    () => getBridgeChainByIdUniversal(tx.originChain),
    [tx.originChain]
  );

  const destinationChainDef = useMemo(
    () => tx.targetChain ? getBridgeChainByIdUniversal(tx.targetChain) : null,
    [tx.targetChain]
  );

  const isBridgeKit = !!tx.provider;

  const renderStatus = () => {
    if (tx.status === "claimed") {
      return (
        <div className="flex items-center gap-1">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <span className="hidden sm:inline text-sm text-green-400">Completed</span>
        </div>
      );
    }

    if (tx.status === "failed") {
      return (
        <div className="flex items-center gap-1">
          <Clock className="h-4 w-4 text-red-500" />
          <span className="hidden sm:inline text-sm text-red-400">Failed</span>
        </div>
      );
    }

    if (tx.status === "pending") {
      return (
        <div className="flex items-center gap-1">
          <Clock className="h-4 w-4 text-yellow-500" />
          <span className="hidden sm:inline text-sm text-yellow-400">Pending</span>
        </div>
      );
    }

    return null;
  };

  const originName = originChainDef?.name?.split(" ")[0] || String(tx.originChain);
  const destinationName =
    destinationChainDef?.name?.split(" ")[0] ||
    (tx.targetChain ? String(tx.targetChain) : "Unknown");

  return (
    <div
      className={`bg-slate-900/50 rounded-lg p-4 space-y-2 ${
        tx.status === "pending"
          ? "cursor-pointer hover:bg-slate-900/70 transition-colors"
          : ""
      }`}
      onClick={() => onTransactionClick(tx)}
    >
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="flex items-center">
              <ChainIcon chainId={tx.originChain} size={24} className="mr-2" />
              {(() => {
                const url = getExplorerTxUrlUniversal(tx.originChain, tx.hash);
                return url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 text-sm font-medium hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {originName}
                  </a>
                ) : (
                  <span className="text-slate-300 text-sm font-medium">
                    {originName}
                  </span>
                );
              })()}
            </div>
            <span className="text-slate-400">→</span>
            {tx.targetChain && (
              <div className="flex items-center">
                <ChainIcon chainId={tx.targetChain} size={24} className="mr-2" />
                {tx.claimHash && tx.targetChain ? (
                  (() => {
                    const claimUrl = getExplorerTxUrlUniversal(
                      tx.targetChain,
                      tx.claimHash
                    );
                    return claimUrl ? (
                      <a
                        href={claimUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 text-sm font-medium hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {destinationName}
                      </a>
                    ) : (
                      <span className="text-slate-400 text-sm font-medium">
                        {destinationName}
                      </span>
                    );
                  })()
                ) : (
                  <span className="text-slate-400 text-sm font-medium">
                    {destinationName}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="text-lg font-semibold">{tx.amount} USDC</div>
          <div className="text-sm text-slate-400">
            {new Date(tx.date).toLocaleDateString()}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {renderStatus()}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 hover:bg-slate-700"
            onClick={(e) => {
              e.stopPropagation();
              const originUrl = getExplorerTxUrlUniversal(tx.originChain, tx.hash);
              if (originUrl) {
                window.open(originUrl, "_blank");
              }
            }}
          >
            <ExternalLink className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 hover:bg-slate-700 hover:text-red-400"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(tx.hash);
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

interface AddTransactionViewProps {
  onBack: () => void;
  onSuccess: () => void;
  addTransaction: (transaction: Omit<LocalTransaction, "date">) => void;
  existingHashes: Set<string>;
}

function AddTransactionView({ onBack, onSuccess, addTransaction, existingHashes }: AddTransactionViewProps) {
  const [selectedChainId, setSelectedChainId] = useState<ChainId | null>(null);
  const [txHash, setTxHash] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get all supported chains (EVM + Solana)
  const supportedChains = useMemo(() => getAllSupportedChains(BRIDGEKIT_ENV), []);

  // Helper to get chain identifier for the select value
  const getChainSelectId = (chain: UniversalChainDefinition): string => {
    if (chain.type === "evm") return String((chain as { chainId: number }).chainId);
    if (chain.type === "solana") return (chain as { chain: string }).chain;
    return "";
  };

  // Helper to parse chain ID from select value
  const parseChainSelectId = (value: string): ChainId => {
    if (value.startsWith("Solana")) return value as ChainId;
    return Number(value);
  };

  // Determine if selected chain is Solana (for UI hints)
  const isSolanaSelected = selectedChainId !== null && isSolanaChain(selectedChainId);

  const handleSubmit = async () => {
    if (!selectedChainId || !txHash) {
      setError("Please select a chain and enter a transaction hash");
      return;
    }

    // Normalize tx hash based on chain type
    const trimmedHash = txHash.trim();
    const isSolana = isSolanaChain(selectedChainId);

    // For EVM, lowercase the hash; for Solana, keep as-is (Base58 is case-sensitive)
    const normalizedHash = isSolana ? trimmedHash : trimmedHash.toLowerCase();

    // Validate tx hash format based on chain type
    if (!isValidTxHash(normalizedHash)) {
      if (isSolana) {
        setError("Invalid Solana transaction signature. Expected Base58 format (80-90 characters).");
      } else {
        setError("Invalid transaction hash format. Expected 0x followed by 64 hex characters.");
      }
      return;
    }

    // Check for duplicate transaction (case-insensitive for EVM, case-sensitive for Solana)
    const hashToCheck = isSolana ? normalizedHash : normalizedHash.toLowerCase();
    if (existingHashes.has(hashToCheck)) {
      setError("This transaction has already been added");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const attestationData = await fetchAttestationUniversal(selectedChainId, normalizedHash);

      if (!attestationData) {
        setError("Transaction not found. Make sure the chain and hash are correct.");
        setIsLoading(false);
        return;
      }

      // Get target chain from destination domain (supports both EVM and Solana)
      const targetChainId = getChainIdFromDomainUniversal(attestationData.destinationDomain, BRIDGEKIT_ENV);

      if (!targetChainId) {
        // Check if the domain exists but is wrong environment
        const chainInfo = getChainInfoFromDomainAllChains(attestationData.destinationDomain);
        if (chainInfo) {
          if (chainInfo.isTestnet !== (BRIDGEKIT_ENV === "testnet")) {
            const expected = BRIDGEKIT_ENV === "testnet" ? "testnet" : "mainnet";
            setError(`Destination is on ${chainInfo.isTestnet ? "testnet" : "mainnet"}, but app is in ${expected} mode`);
          } else {
            setError(`Destination chain ${chainInfo.name} is not supported`);
          }
        } else {
          setError(`Unknown destination domain (${attestationData.destinationDomain})`);
        }
        setIsLoading(false);
        return;
      }

      // Validate mintRecipient is present
      if (!attestationData.mintRecipient) {
        setError("Transaction data incomplete - recipient address not available");
        setIsLoading(false);
        return;
      }

      // Validate and format amount using BigInt for precision
      let formattedAmount: string | undefined;
      if (attestationData.amount) {
        try {
          const amountBigInt = BigInt(attestationData.amount);
          if (amountBigInt <= BigInt(0)) {
            setError("Invalid transaction amount");
            setIsLoading(false);
            return;
          }
          formattedAmount = (Number(amountBigInt) / 1_000_000).toFixed(2);
        } catch {
          setError("Invalid transaction amount format");
          setIsLoading(false);
          return;
        }
      }

      // Check if the transaction has already been claimed by querying usedNonces
      // Note: This only works for EVM destinations - skip for Solana
      let isAlreadyClaimed = false;
      if (attestationData.status === "complete" && !isSolanaChain(targetChainId)) {
        const nonceUsed = await isNonceUsed(
          targetChainId as number,
          attestationData.sourceDomain,
          attestationData.nonce,
          BRIDGEKIT_ENV
        );
        if (nonceUsed === null) {
          // Could not verify claim status - log warning but continue
          console.warn("Could not verify claim status for nonce - assuming pending");
        }
        isAlreadyClaimed = nonceUsed === true;
      }

      // Get chain definitions for bridgeResult
      const sourceChain = getBridgeChainByIdUniversal(selectedChainId, BRIDGEKIT_ENV);
      const destChain = getBridgeChainByIdUniversal(targetChainId, BRIDGEKIT_ENV);

      // Determine step states based on attestation and claim status
      // Valid states: "error" | "success" | "pending" | "noop"
      const attestationReady = attestationData.status === "complete";
      const steps: BridgeResult["steps"] = [
        {
          name: "Burn",
          state: "success",
          txHash: normalizedHash as `0x${string}`,
        },
        {
          name: "Fetch Attestation",
          state: attestationReady ? "success" : "pending"
        },
        {
          name: "Mint",
          state: isAlreadyClaimed ? "success" : "pending"
        },
      ];

      // Determine overall status
      const txStatus = isAlreadyClaimed ? "claimed" : "pending";
      const bridgeState = isAlreadyClaimed ? "success" : "pending";

      // Construct a minimal bridgeResult for resume capability
      // Note: mintRecipient is validated above so it's guaranteed to exist here
      const recipientAddress = attestationData.mintRecipient as `0x${string}`;
      const bridgeResult: BridgeResult = {
        state: bridgeState,
        provider: "CCTPV2BridgingProvider",
        amount: formattedAmount || "0",
        token: "USDC",
        source: {
          address: recipientAddress,
          chain: sourceChain as unknown as ChainDefinition,
        },
        destination: {
          address: recipientAddress,
          chain: destChain as unknown as ChainDefinition,
        },
        steps,
      };

      // Create the transaction entry with chain types
      const transaction: Omit<LocalTransaction, "date"> = {
        hash: normalizedHash as UniversalTxHash,
        originChain: selectedChainId,
        originChainType: getChainType(selectedChainId),
        targetChain: targetChainId,
        targetChainType: getChainType(targetChainId),
        targetAddress: attestationData.mintRecipient as UniversalTxHash | undefined,
        amount: formattedAmount,
        status: txStatus,
        version: "v2",
        transferType: "standard",
        steps,
        bridgeState,
        provider: "CCTPV2BridgingProvider",
        bridgeResult,
      };

      addTransaction(transaction);
      onSuccess();
    } catch (err) {
      console.error("Failed to fetch transaction:", err);
      setError("Failed to fetch transaction details. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <DialogHeader className="flex flex-row items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 hover:bg-slate-700"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <DialogTitle>Add Pending Transaction</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-300">Source Chain</label>
          <Select
            value={selectedChainId !== null ? (typeof selectedChainId === "string" ? selectedChainId : String(selectedChainId)) : ""}
            onValueChange={(value) => setSelectedChainId(parseChainSelectId(value))}
          >
            <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white">
              <SelectValue placeholder="Select Chain...">
                {selectedChainId !== null && (() => {
                  const selected = supportedChains.find(c => {
                    if (c.type === "evm") return (c as { chainId: number }).chainId === selectedChainId;
                    if (c.type === "solana") return (c as { chain: ChainId }).chain === selectedChainId;
                    return false;
                  });
                  if (!selected) return null;
                  const chainIdForIcon: ChainId = selected.type === "evm"
                    ? (selected as { chainId: number }).chainId
                    : (selected as { chain: ChainId }).chain;
                  return (
                    <div className="flex items-center gap-2">
                      <ChainIcon chainId={chainIdForIcon} size={24} />
                      <span>{selected.name}</span>
                    </div>
                  );
                })()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700">
              {supportedChains.map((chain) => {
                const chainSelectId = getChainSelectId(chain);
                const chainIdForIcon: ChainId = chain.type === "evm"
                  ? (chain as { chainId: number }).chainId
                  : (chain as { chain: ChainId }).chain;
                return (
                  <SelectItem
                    key={chainSelectId}
                    value={chainSelectId}
                    className="text-white hover:bg-slate-700"
                  >
                    <div className="flex items-center gap-2">
                      <ChainIcon chainId={chainIdForIcon} size={24} />
                      <span>{chain.name}</span>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-300">Transaction Hash</label>
          <input
            type="text"
            placeholder={isSolanaSelected ? "Enter Solana signature (e.g., 2bX4P87La...)" : "0x..."}
            value={txHash}
            onChange={(e) => setTxHash(e.target.value)}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          <p className="text-xs text-slate-400">
            {isSolanaSelected
              ? "Enter the Solana transaction signature (Base58 format)"
              : "Enter the burn transaction hash from the source chain (0x...)"}
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        <Button
          onClick={handleSubmit}
          disabled={!selectedChainId || !txHash || isLoading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Looking up transaction...
            </>
          ) : (
            "Add Transaction"
          )}
        </Button>
      </div>
    </>
  );
}
