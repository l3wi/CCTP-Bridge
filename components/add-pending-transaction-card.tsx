"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import { useAccount } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import type { BridgeResult } from "@circle-fin/bridge-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChainIcon } from "@/components/chain-icon";
import {
  BRIDGEKIT_ENV,
  getAllSupportedChains,
  getBridgeChainByIdUniversal,
  type UniversalChainDefinition,
} from "@/lib/bridgeKit";
import { toChainDefinition } from "@/lib/chainDefinition";
import {
  getCctpDomainIdUniversal,
  getChainIdFromDomainUniversal,
  getChainInfoFromDomainAllChains,
  isNonceUsed,
} from "@/lib/contracts";
import {
  fetchAttestationByNonceUniversal,
  fetchAttestationUniversal,
  type AttestationData,
} from "@/lib/iris";
import { verifyRecoveredSolanaRecipient } from "@/lib/cctp/solana/recipient";
import { useTransactionStore } from "@/lib/store/transactionStore";
import {
  type ChainId,
  type LocalTransaction,
  type UniversalTxHash,
  isSolanaChain,
  isValidTxHash,
} from "@/lib/types";
import type { SolanaChainId } from "@/lib/cctp/types";

interface AddPendingTransactionCardProps {
  initialSourceChainId?: ChainId | null;
  initialTxHash?: string;
  initialError?: string | null;
  onBack?: () => void;
  onTransactionAdded?: (payload: {
    sourceChainId: ChainId;
    routeId: string;
    hash: UniversalTxHash;
  }) => void;
}

const getChainSelectId = (chain: UniversalChainDefinition): string => {
  if (chain.type === "evm") {
    return String((chain as { chainId: number }).chainId);
  }

  if (chain.type === "solana") {
    return (chain as { chain: string }).chain;
  }

  return "";
};

const parseChainSelectId = (value: string): ChainId => {
  if (value.startsWith("Solana")) {
    return value as ChainId;
  }

  return Number(value);
};

const getExistingHashKey = (transaction: LocalTransaction): string => {
  if (isSolanaChain(transaction.originChain)) {
    return transaction.hash;
  }

  return transaction.hash.toLowerCase();
};

const getChainDisplayName = (
  chainId: ChainId,
  supportedChains: UniversalChainDefinition[]
): string => {
  const chain = supportedChains.find((candidate) => {
    if (candidate.type === "evm") {
      return (candidate as { chainId: number }).chainId === chainId;
    }

    if (candidate.type === "solana") {
      return (candidate as { chain: string }).chain === chainId;
    }

    return false;
  });

  return chain?.name || String(chainId);
};

const getAttestationNotFoundMessage = (
  sourceChainId: ChainId,
  supportedChains: UniversalChainDefinition[]
): string => {
  const chainName = getChainDisplayName(sourceChainId, supportedChains);
  const sourceDomain = getCctpDomainIdUniversal(sourceChainId, BRIDGEKIT_ENV);
  const networkName = BRIDGEKIT_ENV === "mainnet" ? "mainnet" : "testnet";
  const domainLabel = sourceDomain === null ? "" : `, CCTP domain ${sourceDomain}`;

  return (
    `No Circle CCTP v2 message was found for ${chainName} ${networkName}${domainLabel}. ` +
    "Choose the source chain where the burn happened and paste the source burn transaction hash, not the destination wallet or claim transaction."
  );
};

const getNonceSubmittedAsHashMessage = (
  sourceChainId: ChainId,
  supportedChains: UniversalChainDefinition[]
): string => {
  const chainName = getChainDisplayName(sourceChainId, supportedChains);

  return (
    `Circle found this value as a CCTP nonce, not as a ${chainName} source burn transaction hash. ` +
    "Paste the source burn transaction hash from the source-chain explorer."
  );
};

export function AddPendingTransactionCard({
  initialSourceChainId = null,
  initialTxHash = "",
  initialError = null,
  onBack,
  onTransactionAdded,
}: AddPendingTransactionCardProps) {
  const [selectedChainId, setSelectedChainId] = useState<ChainId | null>(
    initialSourceChainId
  );
  const [txHash, setTxHash] = useState(initialTxHash);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [walletMismatchWarning, setWalletMismatchWarning] = useState<string | null>(
    null
  );
  const [showSolanaRecipientInput, setShowSolanaRecipientInput] = useState(false);
  const [solanaRecipientAddress, setSolanaRecipientAddress] = useState("");
  const [cachedAttestation, setCachedAttestation] = useState<{
    sourceChainId: ChainId;
    burnTxHash: string;
    attestation: AttestationData;
  } | null>(null);

  const { transactions, addTransaction } = useTransactionStore();
  const { address: evmAddress } = useAccount();
  const { publicKey: solanaPublicKey } = useWallet();

  useEffect(() => {
    setSelectedChainId(initialSourceChainId);
    setCachedAttestation(null);
    setWalletMismatchWarning(null);
    setShowSolanaRecipientInput(false);
    setSolanaRecipientAddress("");
  }, [initialSourceChainId]);

  useEffect(() => {
    setTxHash(initialTxHash);
    setCachedAttestation(null);
    setWalletMismatchWarning(null);
    setShowSolanaRecipientInput(false);
    setSolanaRecipientAddress("");
  }, [initialTxHash]);

  useEffect(() => {
    setError(initialError);
  }, [initialError]);

  const existingHashes = useMemo(
    () => new Set(transactions.map(getExistingHashKey)),
    [transactions]
  );

  const supportedChains = useMemo(() => getAllSupportedChains(BRIDGEKIT_ENV), []);
  const isSolanaSelected =
    selectedChainId !== null && isSolanaChain(selectedChainId);

  const handleSubmit = async () => {
    if (isLoading) {
      return;
    }

    if (!selectedChainId || !txHash) {
      setError("Please select a chain and enter a transaction hash");
      return;
    }

    const trimmedHash = txHash.trim();
    const isSolana = isSolanaChain(selectedChainId);

    const normalizedHash = isSolana ? trimmedHash : trimmedHash.toLowerCase();

    if (!isValidTxHash(normalizedHash)) {
      if (isSolana) {
        setError(
          "Invalid Solana transaction signature. Expected Base58 format (80-90 characters)."
        );
      } else {
        setError(
          "Invalid transaction hash format. Expected 0x followed by 64 hex characters."
        );
      }
      return;
    }

    const hashToCheck = isSolana ? normalizedHash : normalizedHash.toLowerCase();
    if (existingHashes.has(hashToCheck)) {
      setError("This transaction has already been added");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const cachedMatches =
        cachedAttestation?.sourceChainId === selectedChainId &&
        cachedAttestation?.burnTxHash === normalizedHash;

      const attestationData = cachedMatches && cachedAttestation
        ? cachedAttestation.attestation
        : await fetchAttestationUniversal(selectedChainId, normalizedHash);

      if (!attestationData) {
        const nonceLookup = isSolana
          ? null
          : await fetchAttestationByNonceUniversal(selectedChainId, normalizedHash);
        if (nonceLookup?.attestation) {
          setCachedAttestation(null);
          setError(getNonceSubmittedAsHashMessage(selectedChainId, supportedChains));
          setIsLoading(false);
          return;
        }

        setCachedAttestation(null);
        setError(getAttestationNotFoundMessage(selectedChainId, supportedChains));
        setIsLoading(false);
        return;
      }

      setCachedAttestation({
        sourceChainId: selectedChainId,
        burnTxHash: normalizedHash,
        attestation: attestationData,
      });

      if (attestationData.destinationDomain === undefined) {
        setError("Attestation is still pending. Please wait and try again.");
        setIsLoading(false);
        return;
      }

      if (attestationData.sourceDomain === undefined) {
        setError("Attestation payload is incomplete. Please try again shortly.");
        setIsLoading(false);
        return;
      }

      const targetChainId = getChainIdFromDomainUniversal(
        attestationData.destinationDomain,
        BRIDGEKIT_ENV
      );

      if (!targetChainId) {
        const chainInfo = getChainInfoFromDomainAllChains(
          attestationData.destinationDomain
        );
        if (chainInfo) {
          if (chainInfo.isTestnet !== (BRIDGEKIT_ENV === "testnet")) {
            const expected = BRIDGEKIT_ENV === "testnet" ? "testnet" : "mainnet";
            setError(
              `Destination is on ${chainInfo.isTestnet ? "testnet" : "mainnet"}, but app is in ${expected} mode`
            );
          } else {
            setError(`Destination chain ${chainInfo.name} is not supported`);
          }
        } else {
          setError(`Unknown destination domain (${attestationData.destinationDomain})`);
        }
        setIsLoading(false);
        return;
      }

      if (!attestationData.mintRecipient) {
        setError("Transaction data incomplete - recipient address not available");
        setIsLoading(false);
        return;
      }

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

      let isAlreadyClaimed = false;
      if (attestationData.status === "complete" && !isSolanaChain(targetChainId)) {
        const nonceUsed = await isNonceUsed(
          targetChainId as number,
          attestationData.sourceDomain,
          attestationData.nonce,
          BRIDGEKIT_ENV
        );
        if (nonceUsed === null) {
          console.warn("Could not verify claim status for nonce - assuming pending");
        }
        isAlreadyClaimed = nonceUsed === true;
      }

      const sourceChain = getBridgeChainByIdUniversal(selectedChainId, BRIDGEKIT_ENV);
      const destinationChain = getBridgeChainByIdUniversal(targetChainId, BRIDGEKIT_ENV);
      if (!sourceChain || !destinationChain) {
        setError("Unsupported source or destination chain.");
        setIsLoading(false);
        return;
      }

      const attestationReady = attestationData.status === "complete";
      const steps: BridgeResult["steps"] = [
        {
          name: "Burn",
          state: "success",
          txHash: normalizedHash as `0x${string}`,
        },
        {
          name: "Fetch Attestation",
          state: attestationReady ? "success" : "pending",
        },
        {
          name: "Mint",
          state: isAlreadyClaimed ? "success" : "pending",
        },
      ];

      const transactionStatus = isAlreadyClaimed ? "claimed" : "pending";
      const bridgeState = isAlreadyClaimed ? "success" : "pending";

      let resolvedTargetAddress: string | undefined;
      setWalletMismatchWarning(null);

      if (isSolanaChain(targetChainId)) {
        const mintRecipientAta = attestationData.mintRecipient;
        const candidateRecipientAddress =
          solanaRecipientAddress.trim() || solanaPublicKey?.toBase58() || "";
        const recipientVerification = verifyRecoveredSolanaRecipient({
          candidateRecipientAddress,
          mintRecipientAta,
          destinationChainId: targetChainId as SolanaChainId,
        });

        if (!recipientVerification.ok) {
          setShowSolanaRecipientInput(true);
          setWalletMismatchWarning(recipientVerification.warning);
          setIsLoading(false);
          return;
        }

        resolvedTargetAddress = recipientVerification.recipientAddress;
      } else {
        const rawRecipient = attestationData.mintRecipient;
        if (rawRecipient && rawRecipient.startsWith("0x")) {
          resolvedTargetAddress = `0x${rawRecipient.slice(-40)}`.toLowerCase();
        } else {
          resolvedTargetAddress = rawRecipient;
        }
      }

      const destinationAddress = resolvedTargetAddress || attestationData.mintRecipient || "";
      const bridgeResult: BridgeResult = {
        state: bridgeState,
        provider: "CCTPV2BridgingProvider",
        amount: formattedAmount || "0",
        token: "USDC",
        source: {
          // Iris payloads do not include the original sender wallet for recovered transfers.
          address: "",
          chain: toChainDefinition(sourceChain),
        },
        destination: {
          address: destinationAddress as `0x${string}`,
          chain: toChainDefinition(destinationChain),
        },
        steps,
      };

      const transaction: Omit<LocalTransaction, "date"> = {
        hash: normalizedHash as UniversalTxHash,
        originChain: selectedChainId,
        targetChain: targetChainId,
        targetAddress: resolvedTargetAddress,
        amount: formattedAmount,
        status: transactionStatus,
        version: "v3",
        transferType: "standard",
        steps,
        bridgeState,
        bridgeResult,
        nonce: attestationData.nonce,
      };

      addTransaction(transaction);
      setCachedAttestation(null);
      setWalletMismatchWarning(null);
      setShowSolanaRecipientInput(false);
      setSolanaRecipientAddress("");

      onTransactionAdded?.({
        sourceChainId: selectedChainId,
        routeId: normalizedHash,
        hash: transaction.hash,
      });
    } catch (fetchError) {
      console.error("Failed to fetch transaction:", fetchError);
      setError("Failed to fetch transaction details. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="min-h-[360px] bg-gradient-to-br from-slate-800/95 via-slate-800/98 to-slate-900/100 backdrop-blur-sm border-slate-700/50 text-white">
      <CardContent className="p-6 space-y-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {onBack && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:bg-slate-700"
                onClick={onBack}
                aria-label="Back to Bridge Form"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <h2 className="text-lg font-semibold">Add Pending Transaction</h2>
          </div>
          <p className="text-sm text-slate-400">
            Paste a source chain and burn transaction hash to recover an in-progress bridge.
          </p>
        </div>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            setWalletMismatchWarning(null);
            void handleSubmit();
          }}
        >
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-300">Source Chain</label>
            <Select
              value={
                selectedChainId !== null
                  ? typeof selectedChainId === "string"
                    ? selectedChainId
                    : String(selectedChainId)
                  : ""
              }
              onValueChange={(value) => {
                setSelectedChainId(parseChainSelectId(value));
                setWalletMismatchWarning(null);
                setShowSolanaRecipientInput(false);
                setSolanaRecipientAddress("");
                setCachedAttestation(null);
                setError(null);
              }}
            >
              <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white">
                <SelectValue placeholder="Select Chain...">
                  {selectedChainId !== null &&
                    (() => {
                      const selected = supportedChains.find((chain) => {
                        if (chain.type === "evm") {
                          return (
                            (chain as { chainId: number }).chainId === selectedChainId
                          );
                        }
                        if (chain.type === "solana") {
                          return (
                            (chain as { chain: ChainId }).chain === selectedChainId
                          );
                        }
                        return false;
                      });

                      if (!selected) {
                        return null;
                      }

                      const chainIdForIcon: ChainId =
                        selected.type === "evm"
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
                  const chainIdForIcon: ChainId =
                    chain.type === "evm"
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
              placeholder={
                isSolanaSelected
                  ? "Enter Solana signature (e.g., 2bX4P87La...)"
                  : "0x..."
              }
              value={txHash}
              onChange={(event) => {
                setTxHash(event.target.value);
                setWalletMismatchWarning(null);
                setShowSolanaRecipientInput(false);
                setSolanaRecipientAddress("");
                setCachedAttestation(null);
                setError(null);
              }}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            <p className="text-xs text-slate-400">
              {isSolanaSelected
                ? "Enter the Solana transaction signature (Base58 format)"
                : "Enter the burn transaction hash from the source chain (0x...)"}
            </p>
          </div>

          {showSolanaRecipientInput && (
            <div className="space-y-2">
              <label
                htmlFor="pending-solana-recipient"
                className="text-sm font-medium text-slate-300"
              >
                Recipient Solana Wallet
              </label>
              <input
                id="pending-solana-recipient"
                type="text"
                placeholder="Recipient wallet owner, not USDC token account"
                value={solanaRecipientAddress}
                onChange={(event) => {
                  setSolanaRecipientAddress(event.target.value);
                  setError(null);
                }}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
              <p className="text-xs text-slate-400">
                Helpers may pay Solana fees and ATA rent, but USDC is minted only to
                the recipient account encoded by Circle.
              </p>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {walletMismatchWarning && (
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-yellow-400">{walletMismatchWarning}</p>
              </div>
            </div>
          )}

          <Button
            type="submit"
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
        </form>

        {!evmAddress && !solanaPublicKey && (
          <p className="text-xs text-slate-500">
            Connect your destination wallet to verify recipient ownership before claiming.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
