"use client";

import { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { History, CheckCircle, ExternalLink, Plus, Clock } from "lucide-react";
import { ManualClaimModal } from "@/components/manual-claim-modal";
import { useAccount, useChains } from "wagmi";
import { LocalTransaction } from "@/lib/types";
import { explorers, blockConfirmations } from "@/constants/endpoints";
import { domains, testnetDomains, isTestnet } from "@/constants/contracts";
import { fromHex, slice } from "viem";
import ClaimButton, { SwitchGuard } from "@/components/claimButton";
import ConnectGuard from "@/components/guards/ConnectGuard";
import Countdown from "react-countdown";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useAttestation } from "@/lib/hooks/useAttestation";
import {
  AttestationLoader,
  TransactionStatus,
} from "@/components/loading/LoadingStates";
import Image from "next/image";

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
  const [manualClaimOpen, setManualClaimOpen] = useState(false);
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
            <Button
              variant="outline"
              size="sm"
              className="border-slate-600 text-white hover:bg-slate-700 hover:text-white bg-slate-800"
              onClick={() => {
                setManualClaimOpen(true);
                handleOpenChange(false);
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              Manual Claim
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

      <ManualClaimModal
        open={manualClaimOpen}
        onOpenChange={(open) => {
          setManualClaimOpen(open);
          if (!open) {
            // Reopen history modal when manual claim modal is closed
            setTimeout(() => handleOpenChange(true), 100);
          }
        }}
      />
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

  const isTestnetTx = useMemo(
    () => (destination ? isTestnet(destination) : false),
    [destination]
  );

  // Fetch attestation data
  const {
    data: attestationData,
    isLoading: isAttestationLoading,
    isPending: isAttestationPending,
    error: attestationError,
    refetch,
  } = useAttestation(tx.hash, tx.originChain, destination, {
    enabled: tx.status === "pending",
    refetchInterval: 10000,
    version: tx.version || "v1",
  });

  // Update transaction when attestation is found
  useEffect(() => {
    if (attestationData && tx.status === "pending") {
      updateTransaction(tx.hash, {
        status: "pending", // Keep as pending until claimed
      });
    }
  }, [attestationData, tx.hash, tx.status, updateTransaction]);

  // Derive destination chain from attestation message
  const destinationDomain = useMemo(
    () =>
      attestationData &&
      fromHex(slice(attestationData.message, 8, 12) as `0x${string}`, "number"),
    [attestationData]
  );

  const destinationChain = useMemo(() => {
    if (!destinationDomain) return null;

    // Use appropriate domain map based on testnet status
    const domainMap = isTestnetTx ? testnetDomains : domains;

    // Find chain ID by domain
    const chainIdEntry = Object.entries(domainMap).find(
      ([chainId, domain]) => domain === destinationDomain
    );

    if (!chainIdEntry) return null;

    const chainId = parseInt(chainIdEntry[0]);
    return chains.find((c) => c.id === chainId) || null;
  }, [chains, destinationDomain, isTestnetTx]);

  // Get chain colors based on chain names
  const getChainColor = (chainName: string) => {
    const name = chainName?.toLowerCase() || "";
    if (name.includes("base")) return "bg-blue-600";
    if (name.includes("arbitrum")) return "bg-blue-500";
    if (name.includes("polygon")) return "bg-purple-500";
    if (name.includes("ethereum")) return "bg-slate-600";
    if (name.includes("avalanche")) return "bg-red-500";
    if (name.includes("optimism")) return "bg-red-600";
    return "bg-slate-500"; // Default color
  };

  // Countdown renderer
  const countdownRenderer = ({ minutes, seconds, completed }: any) => {
    if (completed) {
      return <span className="text-yellow-400 text-xs">Still waiting...</span>;
    }
    return (
      <div className="flex items-center space-x-1 text-blue-400 text-xs">
        <span>ETA:</span>
        <span className="font-mono">
          {`${minutes.toString().padStart(2, "0")}:${seconds
            .toString()
            .padStart(2, "0")}`}
        </span>
      </div>
    );
  };

  const getCountdownTime = () => {
    if (!tx.date) return null;

    const version = tx.version || "v1";
    const transferType = tx.transferType || "standard";

    let estimatedMinutes = 25; // Default fallback

    if (version === "v2" && transferType === "fast") {
      const fastTime =
        blockConfirmations.fast[
          tx.originChain as keyof typeof blockConfirmations.fast
        ];
      if (fastTime) {
        const timeStr = fastTime.time;
        if (timeStr.includes("seconds")) {
          const seconds = parseInt(timeStr.match(/\d+/)?.[0] || "20");
          estimatedMinutes = Math.max(1, seconds / 60);
        } else if (timeStr.includes("minutes")) {
          estimatedMinutes = parseInt(timeStr.match(/\d+/)?.[0] || "1");
        }
      } else {
        estimatedMinutes = 1;
      }
    } else {
      const standardTime =
        blockConfirmations.standard[
          tx.originChain as keyof typeof blockConfirmations.standard
        ];
      if (standardTime) {
        const timeStr = standardTime.time;
        if (timeStr.includes("minutes")) {
          estimatedMinutes = parseInt(timeStr.match(/\d+/)?.[0] || "15");
        } else if (timeStr.includes("hours")) {
          const hours = parseInt(timeStr.match(/\d+/)?.[0] || "1");
          estimatedMinutes = hours * 60;
        }
      }
    }

    return new Date(tx.date).getTime() + 1000 * 60 * estimatedMinutes;
  };

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
      if (attestationError) {
        return (
          <div className="flex items-center gap-1">
            <Clock className="h-4 w-4 text-red-500" />
            <span className="text-sm text-red-400">Error</span>
          </div>
        );
      }

      if (attestationData) {
        return (
          <div className="space-y-1">
            <ConnectGuard>
              <SwitchGuard bytes={attestationData.message} hash={tx.hash}>
                <ClaimButton
                  hash={tx.hash}
                  bytes={attestationData.message}
                  attestation={attestationData.attestation}
                  cctpVersion={attestationData.cctpVersion}
                  eventNonce={attestationData.eventNonce}
                  onBurn={() => {}}
                  onAttestationUpdate={() => {
                    // Trigger refetch of attestation data
                    refetch();
                  }}
                />
              </SwitchGuard>
            </ConnectGuard>
          </div>
        );
      }

      if (isAttestationLoading || isAttestationPending) {
        const countdownTime = getCountdownTime();
        return (
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4 text-yellow-500 animate-pulse" />
              <span className="text-sm text-yellow-400">Pending</span>
            </div>
            {countdownTime && (
              <Countdown date={countdownTime} renderer={countdownRenderer} />
            )}
          </div>
        );
      }

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
    destinationChain?.name.split(" ")[0] ||
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
              <a
                href={`${explorers[tx.originChain]}tx/${tx.hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 text-sm font-medium hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {originName}
              </a>
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
                  <a
                    href={`${explorers[tx.targetChain]}tx/${tx.claimHash}`}
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
              window.open(
                `${explorers[tx.originChain]}tx/${tx.hash}`,
                "_blank"
              );
            }}
          >
            <ExternalLink className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
