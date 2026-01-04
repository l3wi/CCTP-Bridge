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
import { History, CheckCircle, ExternalLink, Clock, Plus, X, ArrowLeft, Loader2 } from "lucide-react";
import { useChains } from "wagmi";
import { LocalTransaction } from "@/lib/types";
import { useTransactionStore } from "@/lib/store/transactionStore";
import Image from "next/image";
import { getExplorerTxUrl, getSupportedEvmChains, BRIDGEKIT_ENV } from "@/lib/bridgeKit";
import { fetchAttestation } from "@/lib/iris";
import { getChainIdFromDomain } from "@/lib/contracts";

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

  const handleDeleteTransaction = (hash: `0x${string}`) => {
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
      transactions.filter(
        (tx) =>
          tx.status === "pending" ||
          tx.bridgeState === "pending" ||
          tx.bridgeResult?.state === "pending"
      ).length,
    [transactions]
  );

  const claimableCount = useMemo(() => {
    return transactions.filter((tx) => {
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
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-2xl">
          {view === "history" ? (
            <>
              <DialogHeader className="flex flex-row items-center justify-between">
                <DialogTitle>Transaction History</DialogTitle>
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-slate-700 border-slate-600 text-white hover:bg-slate-600"
                  onClick={() => setView("add-transaction")}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Transaction
                </Button>
              </DialogHeader>
              <div className="space-y-4 max-h-96 overflow-y-auto">
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
  onDelete: (hash: `0x${string}`) => void;
}

function TransactionRow({
  tx,
  chains,
  updateTransaction,
  onTransactionClick,
  onDelete,
}: TransactionRowProps) {
  // Get chain information
  const origin = useMemo(
    () => chains.find((c) => c.id === tx.originChain),
    [chains, tx.originChain]
  );

  const destination = useMemo(
    () => chains.find((c) => c.id === tx.targetChain),
    [chains, tx.targetChain]
  );

  const isBridgeKit = !!tx.provider;

  const renderStatus = () => {
    if (tx.status === "claimed") {
      return (
        <div className="flex items-center gap-1">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <span className="text-sm text-green-400">Completed</span>
        </div>
      );
    }

    if (tx.status === "failed") {
      return (
        <div className="flex items-center gap-1">
          <Clock className="h-4 w-4 text-red-500" />
          <span className="text-sm text-red-400">Failed</span>
        </div>
      );
    }

    if (tx.status === "pending") {
      return (
        <div className="flex items-center gap-1">
          <Clock className="h-4 w-4 text-yellow-500" />
          <span className="text-sm text-yellow-400">Pending</span>
        </div>
      );
    }

    return null;
  };

  const originName = origin?.name.split(" ")[0] || `Chain ${tx.originChain}`;
  const destinationName =
    destination?.name.split(" ")[0] ||
    (tx.targetChain ? `Chain ${tx.targetChain}` : "Unknown");

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
              <Image
                src={`/${tx.originChain}.svg`}
                width={24}
                height={24}
                className="w-6 h-6 mr-2"
                alt={originName}
              />
              {(() => {
                const url = getExplorerTxUrl(tx.originChain, tx.hash);
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
            {destination && (
              <div className="flex items-center">
                <Image
                  src={`/${destination?.id}.svg`}
                  width={24}
                  height={24}
                  className="w-6 h-6 mr-2"
                  alt={destinationName}
                />
                {tx.claimHash && tx.targetChain ? (
                  (() => {
                    const claimUrl = getExplorerTxUrl(
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
              const originUrl = getExplorerTxUrl(tx.originChain, tx.hash);
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
  const [selectedChainId, setSelectedChainId] = useState<number | null>(null);
  const [txHash, setTxHash] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supportedChains = useMemo(() => getSupportedEvmChains(BRIDGEKIT_ENV), []);

  const handleSubmit = async () => {
    if (!selectedChainId || !txHash) {
      setError("Please select a chain and enter a transaction hash");
      return;
    }

    // Validate tx hash format
    const normalizedHash = txHash.trim().toLowerCase();
    if (!/^0x[a-f0-9]{64}$/.test(normalizedHash)) {
      setError("Invalid transaction hash format");
      return;
    }

    // Check for duplicate transaction
    if (existingHashes.has(normalizedHash)) {
      setError("This transaction has already been added");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const attestationData = await fetchAttestation(selectedChainId, normalizedHash);

      if (!attestationData) {
        setError("Transaction not found. Make sure the chain and hash are correct.");
        setIsLoading(false);
        return;
      }

      // Get target chain from destination domain
      const targetChainId = getChainIdFromDomain(attestationData.destinationDomain, BRIDGEKIT_ENV);

      if (!targetChainId) {
        setError("Unsupported destination chain");
        setIsLoading(false);
        return;
      }

      // Format amount from raw value (6 decimals for USDC)
      let formattedAmount: string | undefined;
      if (attestationData.amount) {
        const amountNum = Number(attestationData.amount) / 1_000_000;
        formattedAmount = amountNum.toFixed(2);
      }

      // Create steps based on attestation status
      // Valid states: "error" | "success" | "pending" | "noop"
      const steps = [
        { name: "Burn", state: "success" as const },
        {
          name: "Fetch Attestation",
          state: attestationData.status === "complete" ? "success" as const : "pending" as const
        },
        {
          name: "Mint",
          state: "pending" as const
        },
      ];

      // Create the transaction entry
      const transaction: Omit<LocalTransaction, "date"> = {
        hash: normalizedHash as `0x${string}`,
        originChain: selectedChainId,
        targetChain: targetChainId,
        targetAddress: attestationData.mintRecipient as `0x${string}` | undefined,
        amount: formattedAmount,
        status: "pending" as const,
        version: "v2",
        transferType: "standard",
        steps,
        bridgeState: "pending",
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
          <div className="grid grid-cols-3 gap-2">
            {supportedChains.map((chain) => (
              <button
                key={chain.chainId}
                onClick={() => setSelectedChainId(chain.chainId)}
                className={`flex items-center gap-2 p-3 rounded-lg border transition-colors ${
                  selectedChainId === chain.chainId
                    ? "border-blue-500 bg-slate-700"
                    : "border-slate-600 bg-slate-800 hover:bg-slate-700"
                }`}
              >
                <Image
                  src={`/${chain.chainId}.svg`}
                  width={24}
                  height={24}
                  className="w-6 h-6"
                  alt={chain.name}
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
                <span className="text-sm truncate">{chain.name.split(" ")[0]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-300">Transaction Hash</label>
          <input
            type="text"
            placeholder="0x..."
            value={txHash}
            onChange={(e) => setTxHash(e.target.value)}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
          <p className="text-xs text-slate-400">
            Enter the burn transaction hash from the source chain
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
