"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { History, CheckCircle, ExternalLink, Clock, Plus, X } from "lucide-react";
import { type LocalTransaction, type UniversalTxHash } from "@/lib/types";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { buildBridgeRoute, getTransactionShareId } from "@/lib/bridgeRoute";
import { ChainIcon } from "@/components/chain-icon";
import {
  getExplorerTxUrlUniversal,
  getBridgeChainByIdUniversal,
} from "@/lib/bridgeConfig";

interface HistoryModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onLoadBridging?: (transaction: LocalTransaction) => void;
}

export function HistoryModal({ open, onOpenChange, onLoadBridging }: HistoryModalProps) {
  const [isOpen, setIsOpen] = useState(open || false);
  const { transactions, removeTransaction } = useTransactionStore();
  const router = useRouter();

  const handleOpenChange = (nextOpen: boolean) => {
    setIsOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const handleDeleteTransaction = (hash: UniversalTxHash) => {
    removeTransaction(hash);
  };

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
      return;
    }

    router.push(
      buildBridgeRoute(transaction.originChain, getTransactionShareId(transaction))
    );
    handleOpenChange(false);
  };

  const pendingCount = useMemo(
    () =>
      transactions.filter((transaction) => {
        if (transaction.status === "claimed" || transaction.status === "failed") {
          return false;
        }

        return (
          transaction.status === "pending" ||
          transaction.bridgeState === "pending" ||
          transaction.bridgeResult?.state === "pending"
        );
      }).length,
    [transactions]
  );

  const claimableCount = useMemo(
    () =>
      transactions.filter((transaction) => {
        if (transaction.status === "claimed" || transaction.status === "failed") {
          return false;
        }

        const steps = transaction.steps || transaction.bridgeResult?.steps || [];
        return steps.some((step) => {
          const state = step.state as string;
          return /claim/i.test(step.name) && (state === "pending" || state === "ready");
        });
      }).length,
    [transactions]
  );

  const badgeLabel =
    claimableCount > 0
      ? `${claimableCount} Claimable`
      : pendingCount > 0
        ? `${pendingCount} Pending`
        : null;

  return (
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
        <DialogHeader className="flex flex-row items-center justify-between pr-8">
          <DialogTitle>Transaction History</DialogTitle>
          <Button
            variant="outline"
            size="sm"
            className="bg-slate-700 border-slate-600 text-white hover:bg-slate-600"
            onClick={() => {
              handleOpenChange(false);
              router.push("/bridge");
            }}
          >
            <Plus className="h-4 w-4 mr-1" />
            <span className="sm:hidden">Add</span>
            <span className="hidden sm:inline">Add Transaction</span>
          </Button>
        </DialogHeader>

        <div
          className="space-y-4 max-h-96 has-[>*:nth-child(4)]:max-h-[36rem] overflow-y-auto"
          data-scrollable="true"
        >
          {sortedTransactions.length > 0 ? (
            sortedTransactions.map((transaction) => (
              <TransactionRow
                key={transaction.hash}
                tx={transaction}
                onTransactionClick={handleTransactionClick}
                onDelete={handleDeleteTransaction}
              />
            ))
          ) : (
            <div className="text-center py-8 text-slate-400">
              <p>No transactions yet</p>
              <p className="text-sm mt-1">Your bridge transactions will appear here</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface TransactionRowProps {
  tx: LocalTransaction;
  onTransactionClick: (transaction: LocalTransaction) => void;
  onDelete: (hash: UniversalTxHash) => void;
}

function TransactionRow({ tx, onTransactionClick, onDelete }: TransactionRowProps) {
  const originChainDef = useMemo(
    () => getBridgeChainByIdUniversal(tx.originChain),
    [tx.originChain]
  );

  const destinationChainDef = useMemo(
    () => (tx.targetChain ? getBridgeChainByIdUniversal(tx.targetChain) : null),
    [tx.targetChain]
  );

  const originName = originChainDef?.name?.split(" ")[0] || String(tx.originChain);
  const destinationName =
    destinationChainDef?.name?.split(" ")[0] ||
    (tx.targetChain ? String(tx.targetChain) : "Unknown");

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

  return (
    <div
      className={`bg-slate-900/50 rounded-lg p-4 space-y-2 ${
        tx.status === "pending" ? "cursor-pointer hover:bg-slate-900/70 transition-colors" : ""
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
                    onClick={(event) => event.stopPropagation()}
                  >
                    {originName}
                  </a>
                ) : (
                  <span className="text-slate-300 text-sm font-medium">{originName}</span>
                );
              })()}
            </div>
            <span className="text-slate-400">→</span>
            {tx.targetChain && (
              <div className="flex items-center">
                <ChainIcon chainId={tx.targetChain} size={24} className="mr-2" />
                {tx.claimHash && tx.targetChain ? (
                  (() => {
                    const claimUrl = getExplorerTxUrlUniversal(tx.targetChain, tx.claimHash);
                    return claimUrl ? (
                      <a
                        href={claimUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 text-sm font-medium hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {destinationName}
                      </a>
                    ) : (
                      <span className="text-slate-400 text-sm font-medium">{destinationName}</span>
                    );
                  })()
                ) : (
                  <span className="text-slate-400 text-sm font-medium">{destinationName}</span>
                )}
              </div>
            )}
          </div>
          <div className="text-lg font-semibold">{tx.amount} USDC</div>
          <div className="text-sm text-slate-400">{new Date(tx.date).toLocaleDateString()}</div>
        </div>

        <div className="flex items-center gap-2">
          {renderStatus()}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 hover:bg-slate-700"
            onClick={(event) => {
              event.stopPropagation();
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
            onClick={(event) => {
              event.stopPropagation();
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
