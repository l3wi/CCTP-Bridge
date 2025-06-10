"use client";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAccount, useChains } from "wagmi";
import { LocalTransaction } from "@/lib/types";
import { explorers, blockConfirmations } from "@/constants/endpoints";
import { Label } from "@radix-ui/react-label";
import { useEffect, useState, useMemo } from "react";
import {
  domains,
  testnetDomains,
  getChainsFromId,
  isTestnet,
} from "@/constants/contracts";
import { fromHex, slice } from "viem";
import { Button } from "./ui/button";
import ClaimButton, { SwitchGuard } from "./claimButton";
import ConnectGuard from "./guards/ConnectGuard";
import Countdown from "react-countdown";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useAttestation } from "@/lib/hooks/useAttestation";
import {
  HistoryTableSkeleton,
  AttestationLoader,
  TransactionStatus,
} from "./loading/LoadingStates";

interface RowProps {
  tx: LocalTransaction;
  index: number;
}

const Row = ({ tx, index }: RowProps) => {
  const { chain } = useAccount();
  const chains = useChains();
  const { updateTransaction } = useTransactionStore();

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
  } = useAttestation(tx.hash, tx.originChain, destination, {
    enabled: tx.status === "pending",
    refetchInterval: 10000,
    version: tx.version || "v1", // Use the version from the transaction record
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

  // Countdown renderer
  const countdownRenderer = ({ minutes, seconds, completed }: any) => {
    if (completed) {
      return <span className="text-yellow-600">Still waiting...</span>;
    }
    return (
      <div className="flex items-center space-x-1 text-blue-600">
        <span className="text-xs">ETA:</span>
        <span className="font-mono">
          {`${minutes.toString().padStart(2, "0")}:${seconds
            .toString()
            .padStart(2, "0")}`}
        </span>
      </div>
    );
  };

  const renderStatus = () => {
    if (tx.status === "claimed") {
      return (
        <div className="flex items-center space-x-2">
          <TransactionStatus status="success" message="Completed" />
          {tx.claimHash && tx.targetChain && (
            <a
              href={`${explorers[tx.targetChain]}tx/${tx.claimHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 transition-colors"
              title="View transaction in explorer"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              >
                <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
        </div>
      );
    }

    if (tx.status === "failed") {
      return <TransactionStatus status="error" message="Failed" />;
    }

    if (tx.status === "pending") {
      if (attestationError) {
        return (
          <TransactionStatus
            status="error"
            message="Error fetching attestation"
          />
        );
      }

      if (attestationData) {
        return (
          <ConnectGuard>
            <SwitchGuard bytes={attestationData.message} hash={tx.hash}>
              <ClaimButton
                hash={tx.hash}
                bytes={attestationData.message}
                attestation={attestationData.attestation}
                version={tx.version || "v1"}
                onBurn={() => {}} // This will be handled by the store
              />
            </SwitchGuard>
          </ConnectGuard>
        );
      }

      if (isAttestationLoading || isAttestationPending) {
        // Calculate appropriate countdown time based on version and transfer type
        const getCountdownTime = () => {
          if (!tx.date) return null;

          const version = tx.version || "v1";
          const transferType = tx.transferType || "standard";

          let estimatedMinutes = 25; // Default fallback

          if (version === "v2" && transferType === "fast") {
            // Fast transfers: use fast confirmation timing
            const fastTime =
              blockConfirmations.fast[
                tx.originChain as keyof typeof blockConfirmations.fast
              ];
            if (fastTime) {
              // Convert time string to minutes (e.g., "~20 seconds" -> 0.33 minutes)
              const timeStr = fastTime.time;
              if (timeStr.includes("seconds")) {
                const seconds = parseInt(timeStr.match(/\d+/)?.[0] || "20");
                estimatedMinutes = Math.max(1, seconds / 60); // At least 1 minute for display
              } else if (timeStr.includes("minutes")) {
                estimatedMinutes = parseInt(timeStr.match(/\d+/)?.[0] || "1");
              }
            } else {
              estimatedMinutes = 1; // Default for fast transfers
            }
          } else {
            // Standard transfers: use standard confirmation timing
            const standardTime =
              blockConfirmations.standard[
                tx.originChain as keyof typeof blockConfirmations.standard
              ];
            if (standardTime) {
              const timeStr = standardTime.time;
              if (timeStr.includes("minutes")) {
                // Extract first number for "13-19 minutes"
                estimatedMinutes = parseInt(timeStr.match(/\d+/)?.[0] || "15");
              } else if (timeStr.includes("hours")) {
                // For cases like "6-32 hours"
                const hours = parseInt(timeStr.match(/\d+/)?.[0] || "1");
                estimatedMinutes = hours * 60;
              }
            }
          }

          return new Date(tx.date).getTime() + 1000 * 60 * estimatedMinutes;
        };

        const countdownTime = getCountdownTime();

        return (
          <div className="space-y-2 w-full">
            <AttestationLoader />
            {countdownTime && (
              <Countdown date={countdownTime} renderer={countdownRenderer} />
            )}
          </div>
        );
      }

      return <TransactionStatus status="pending" message="Pending" />;
    }

    return null;
  };

  return (
    <TableRow key={tx.hash}>
      <TableCell>
        <span className="block w-32 md:inline text-sm">
          {new Date(tx.date).toLocaleDateString()}
        </span>
      </TableCell>

      <TableCell>
        <a
          className="hover:underline cursor-pointer flex items-center text-blue-600"
          href={`${explorers[tx.originChain]}tx/${tx.hash}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="text-sm">
            {origin?.name.split(" ")[0] || `Chain ${tx.originChain}`}
          </span>
        </a>
      </TableCell>

      <TableCell>
        {tx.claimHash && tx.targetChain ? (
          <a
            className="hover:underline cursor-pointer flex items-center text-blue-600"
            href={`${explorers[tx.targetChain]}tx/${tx.claimHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="text-sm">
              {destination?.name.split(" ")[0] || `Chain ${tx.targetChain}`}
            </span>
          </a>
        ) : (
          <span className="text-sm text-gray-500">
            {/* Prefer destination from transaction record, fallback to derived from attestation */}
            {destination?.name.split(" ")[0] ||
              destinationChain?.name.split(" ")[0] ||
              (tx.targetChain ? `Chain ${tx.targetChain}` : "—")}
          </span>
        )}
      </TableCell>

      <TableCell>
        <div className="min-w-[120px]">{renderStatus()}</div>
      </TableCell>
    </TableRow>
  );
};

export default function History() {
  const { transactions, clearPendingTransactions, isLoading } =
    useTransactionStore();
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  useEffect(() => {
    // Simulate initial load delay
    const timer = setTimeout(() => setIsInitialLoad(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  const hasPendingTransactions = useMemo(
    () => transactions.some((tx) => tx.status === "pending"),
    [transactions]
  );

  const sortedTransactions = useMemo(
    () =>
      [...transactions].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      ),
    [transactions]
  );

  if (isInitialLoad || isLoading) {
    return <HistoryTableSkeleton />;
  }

  return (
    <div className="space-y-4 w-full">
      <div className="flex w-full justify-between items-center">
        <Label className="text-lg text-gray-600">Transaction History</Label>
        {hasPendingTransactions && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearPendingTransactions}
            className="text-xs"
          >
            Clear Pending
          </Button>
        )}
      </div>

      {sortedTransactions.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Origin</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedTransactions.map((tx, index) => (
              <Row key={tx.hash} tx={tx} index={index} />
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="text-center py-8 text-gray-500">
          <p>No transactions yet</p>
          <p className="text-sm mt-1">
            Your bridge transactions will appear here
          </p>
        </div>
      )}
    </div>
  );
}
