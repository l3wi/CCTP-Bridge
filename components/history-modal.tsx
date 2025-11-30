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
import { History, CheckCircle, ExternalLink, Clock } from "lucide-react";
import { useChains } from "wagmi";
import { LocalTransaction } from "@/lib/types";
import { useTransactionStore } from "@/lib/store/transactionStore";
import Image from "next/image";
import { getExplorerTxUrl } from "@/lib/bridgeKit";

interface HistoryModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onLoadBridging?: (transaction: LocalTransaction) => void;
}

export function HistoryModal({
  open,
  onOpenChange,
  onLoadBridging,
}: HistoryModalProps) {
  const [isOpen, setIsOpen] = useState(open || false);
  const { transactions, updateTransaction } = useTransactionStore();
  const chains = useChains();

  const handleOpenChange = (newOpen: boolean) => {
    setIsOpen(newOpen);
    onOpenChange?.(newOpen);
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
    if (transaction.status === "pending" && onLoadBridging) {
      onLoadBridging(transaction);
      handleOpenChange(false);
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700/50 hover:text-white"
          >
            <History className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-2xl">
          <DialogHeader className="flex flex-row items-center justify-between">
            <DialogTitle>Transaction History</DialogTitle>
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
}

function TransactionRow({
  tx,
  chains,
  updateTransaction,
  onTransactionClick,
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
    if (isBridgeKit) {
      const bridgeState = tx.bridgeState || tx.bridgeResult?.state || "pending";
      const steps = tx.steps || tx.bridgeResult?.steps || [];
      const primaryStep =
        steps.find((step) => step.state === "success" && step.txHash) ||
        steps.find((step) => step.txHash);

      return (
        <div className="flex flex-col gap-2 w-full">
          <div className="flex items-center gap-1">
            <span
              className={`h-2 w-2 rounded-full ${
                bridgeState === "success"
                  ? "bg-green-500"
                  : bridgeState === "error"
                  ? "bg-red-500"
                  : "bg-yellow-500"
              }`}
            />
            <span className="text-sm capitalize">{bridgeState}</span>
          </div>
          {steps.length > 0 && (
            <div className="space-y-1">
              {steps.map((step) => (
                <div
                  key={step.name}
                  className="flex items-center justify-between rounded-md bg-slate-800/60 px-3 py-1 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        step.state === "success"
                          ? "bg-green-500"
                          : step.state === "error"
                          ? "bg-red-500"
                          : "bg-yellow-500"
                      }`}
                    />
                    <span>{step.name}</span>
                  </div>
                  {step.txHash && (
                    <span className="text-slate-400">
                      {`${step.txHash.slice(0, 6)}...${step.txHash.slice(-4)}`}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {primaryStep?.explorerUrl && (
            <Button
              variant="ghost"
              size="sm"
              className="text-blue-400 hover:text-blue-300 justify-start px-0"
              onClick={() => window.open(primaryStep.explorerUrl, "_blank")}
            >
              View transaction
            </Button>
          )}
        </div>
      );
    }

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
        </div>
      </div>
    </div>
  );
}
