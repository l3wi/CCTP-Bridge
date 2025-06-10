import { useCallback, useState } from "react";
import { useSimulateContract, useWriteContract, useAccount } from "wagmi";
import { formatUnits, pad } from "viem";
import { track } from "@vercel/analytics/react";
import abis, { getABI } from "@/constants/abi";
import contracts, { domains, getContracts } from "@/constants/contracts";
import { useToast } from "@/components/ui/use-toast";
import {
  BridgeParams,
  DepositForBurnArgs,
  LocalTransaction,
  FastTransferParams,
  V2FastBurnFeesResponse,
  V2FastBurnAllowanceResponse,
} from "@/lib/types";
import { getErrorMessage, TransactionError } from "@/lib/errors";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { endpoints } from "@/constants/endpoints";

export interface UseBridgeReturn {
  burn: (params: BridgeParams) => Promise<`0x${string}` | void>;
  approve: (
    token: `0x${string}`,
    spender: `0x${string}`
  ) => Promise<`0x${string}` | void>;
  claim: (
    message: `0x${string}`,
    attestation: `0x${string}`,
    version?: "v1" | "v2"
  ) => Promise<`0x${string}` | void>;
  fastBurn: (params: FastTransferParams) => Promise<`0x${string}` | void>;
  getFastTransferFee: (
    sourceDomain: number,
    destDomain: number
  ) => Promise<V2FastBurnFeesResponse>;
  getFastTransferAllowance: () => Promise<V2FastBurnAllowanceResponse>;
  isLoading: boolean;
  error: string | null;
}

export const useBridge = (): UseBridgeReturn => {
  const { writeContract } = useWriteContract();
  const { chain } = useAccount();
  const { toast } = useToast();
  const { addTransaction, updateTransaction } = useTransactionStore();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const burn = useCallback(
    async (params: BridgeParams): Promise<`0x${string}` | void> => {
      if (!chain) {
        throw new Error("No chain connected");
      }

      setIsLoading(true);
      setError(null);

      try {
        const version = params.version || "v1";
        const transferType = params.transferType || "standard";
        const selectedContracts = getContracts(params.sourceChainId, version);

        if (!selectedContracts) {
          throw new Error(
            `Contracts not found for chain ${params.sourceChainId} version ${version}`
          );
        }

        const depositArgs: DepositForBurnArgs = {
          amount: params.amount,
          destinationDomain: domains[params.targetChainId],
          mintRecipient: pad(params.targetAddress),
          burnToken: selectedContracts.Usdc,
        };

        const isV2FastTransfer = version === "v2" && transferType === "fast";

        toast({
          title: `${isV2FastTransfer ? "Fast " : ""}Burning USDC`,
          description: `Please sign to initiate the ${
            isV2FastTransfer ? "fast " : ""
          }bridging process.`,
        });

        const txHash = await new Promise<`0x${string}`>((resolve, reject) => {
          // Use appropriate function and args based on version and transfer type
          const functionName = "depositForBurn" as const;
          const contractABI = getABI("TokenMessenger", version);

          if (version === "v2") {
            // V2 always uses the extended depositForBurn function
            // For fast transfers, calculate maxFee from BPS; for standard transfers, use 0
            let maxFee = BigInt(0);
            if (isV2FastTransfer && (params as FastTransferParams).fee) {
              // The fee in params is expected to be the BPS value
              const feeBPS = (params as FastTransferParams).fee;
              // Calculate maxFee: (amount * feeBPS) / 10000
              // Since amount is already in wei (6 decimals for USDC), we calculate accordingly
              maxFee = (params.amount * feeBPS) / BigInt(10000);
            }
            const minFinalityThreshold = isV2FastTransfer ? 0 : 65; // Fast: 0, Standard: 65

            const args = [
              depositArgs.amount,
              depositArgs.destinationDomain,
              depositArgs.mintRecipient,
              depositArgs.burnToken,
              pad("0x0000000000000000000000000000000000000000"), // destinationCaller
              maxFee,
              minFinalityThreshold,
            ] as const;

            writeContract(
              {
                address: selectedContracts.TokenMessenger,
                abi: contractABI,
                functionName: functionName,
                args: args,
              },
              {
                onSuccess(data: `0x${string}`) {
                  try {
                    track("bridge", {
                      amount: formatUnits(params.amount, 6),
                      from: params.sourceChainId,
                      to: params.targetChainId,
                      version,
                      transferType,
                    });

                    toast({
                      title: `${isV2FastTransfer ? "Fast " : ""}Burning USDC`,
                      description: "Bridging process successfully initiated.",
                    });

                    console.log("Successful Write: ", data);

                    const newTransaction: LocalTransaction = {
                      date: new Date(),
                      amount: formatUnits(params.amount, 6),
                      originChain: params.sourceChainId,
                      targetChain: params.targetChainId,
                      hash: data,
                      status: "pending",
                      version,
                      transferType,
                    };

                    addTransaction(newTransaction);
                    resolve(data);
                  } catch (error) {
                    console.error("Transaction success handler error:", error);
                    reject(new TransactionError(getErrorMessage(error)));
                  }
                },
                onError(error: Error) {
                  reject(new TransactionError(getErrorMessage(error)));
                },
              }
            );
          } else {
            // V1 uses the standard depositForBurn function
            const args = [
              depositArgs.amount,
              depositArgs.destinationDomain,
              depositArgs.mintRecipient,
              depositArgs.burnToken,
            ] as const;

            writeContract(
              {
                address: selectedContracts.TokenMessenger,
                abi: contractABI,
                functionName: functionName,
                args: args,
              },
              {
                onSuccess(data: `0x${string}`) {
                  try {
                    track("bridge", {
                      amount: formatUnits(params.amount, 6),
                      from: params.sourceChainId,
                      to: params.targetChainId,
                      version,
                      transferType,
                    });

                    toast({
                      title: "Burning USDC",
                      description: "Bridging process successfully initiated.",
                    });

                    console.log("Successful Write: ", data);

                    const newTransaction: LocalTransaction = {
                      date: new Date(),
                      amount: formatUnits(params.amount, 6),
                      originChain: params.sourceChainId,
                      targetChain: params.targetChainId,
                      hash: data,
                      status: "pending",
                      version,
                      transferType,
                    };

                    addTransaction(newTransaction);
                    resolve(data);
                  } catch (error) {
                    console.error("Transaction success handler error:", error);
                    reject(new TransactionError(getErrorMessage(error)));
                  }
                },
                onError(error: Error) {
                  reject(new TransactionError(getErrorMessage(error)));
                },
              }
            );
          }
        });

        return txHash;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        setError(errorMessage);
        toast({
          title: "Transaction Failed",
          description: errorMessage,
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    },
    [chain, writeContract, toast, addTransaction]
  );

  const approve = useCallback(
    async (
      token: `0x${string}`,
      spender: `0x${string}`
    ): Promise<`0x${string}` | void> => {
      setIsLoading(true);
      setError(null);

      try {
        toast({
          title: "Approving Token",
          description: "Please wait while we approve the token.",
        });

        const txHash = await new Promise<`0x${string}`>((resolve, reject) => {
          writeContract(
            {
              address: token,
              abi: getABI("Usdc", "v1"), // USDC ABI is the same for both versions
              functionName: "approve",
              args: [
                spender,
                BigInt(
                  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
                ),
              ],
            },
            {
              onSuccess(data: `0x${string}`) {
                toast({
                  title: "Token Approved",
                  description: "You've successfully approved the token.",
                });
                resolve(data);
              },
              onError(error: Error) {
                reject(new TransactionError(getErrorMessage(error)));
              },
            }
          );
        });

        return txHash;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        setError(errorMessage);
        toast({
          title: "Approval Failed",
          description: errorMessage,
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    },
    [writeContract, toast]
  );

  const claim = useCallback(
    async (
      message: `0x${string}`,
      attestation: `0x${string}`,
      version: "v1" | "v2" = "v1"
    ): Promise<`0x${string}` | void> => {
      if (!chain) {
        throw new Error("No chain connected");
      }

      setIsLoading(true);
      setError(null);

      try {
        const selectedContracts = getContracts(chain.id, version);

        if (!selectedContracts) {
          throw new Error(
            `Contracts not found for chain ${chain.id} version ${version}`
          );
        }

        toast({
          title: `${version === "v2" ? "Minting" : "Claiming"} USDC`,
          description: `Please sign to ${
            version === "v2" ? "mint" : "claim"
          } your USDC.`,
        });

        const txHash = await new Promise<`0x${string}`>((resolve, reject) => {
          writeContract(
            {
              address: selectedContracts.MessageTransmitter,
              abi: getABI("MessageTransmitter", version),
              functionName: "receiveMessage",
              args: [message, attestation],
            },
            {
              onSuccess(data: `0x${string}`) {
                toast({
                  title: `Successfully ${
                    version === "v2" ? "Minted" : "Claimed"
                  } USDC`,
                  description:
                    "Please check your wallet to ensure the tokens have arrived.",
                });
                resolve(data);
              },
              onError(error: Error) {
                reject(new TransactionError(getErrorMessage(error)));
              },
            }
          );
        });

        return txHash;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        setError(errorMessage);
        toast({
          title: `${version === "v2" ? "Mint" : "Claim"} Failed`,
          description: errorMessage,
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    },
    [chain, writeContract, toast]
  );

  const fastBurn = useCallback(
    async (params: FastTransferParams): Promise<`0x${string}` | void> => {
      return burn(params);
    },
    [burn]
  );

  const getFastTransferFee = useCallback(
    async (
      sourceDomain: number,
      destDomain: number
    ): Promise<V2FastBurnFeesResponse> => {
      try {
        const response = await fetch(
          `${endpoints.mainnet}/v2/fastBurn/USDC/fees/${sourceDomain}/${destDomain}`
        );
        if (!response.ok) {
          throw new Error("Failed to fetch fast transfer fees");
        }
        return await response.json();
      } catch (error) {
        console.error("Error fetching fast transfer fees:", error);
        throw error;
      }
    },
    []
  );

  const getFastTransferAllowance =
    useCallback(async (): Promise<V2FastBurnAllowanceResponse> => {
      try {
        const response = await fetch(
          `${endpoints.mainnet}/v2/fastBurn/USDC/allowance`
        );
        if (!response.ok) {
          throw new Error("Failed to fetch fast transfer allowance");
        }
        return await response.json();
      } catch (error) {
        console.error("Error fetching fast transfer allowance:", error);
        throw error;
      }
    }, []);

  return {
    burn,
    approve,
    claim,
    fastBurn,
    getFastTransferFee,
    getFastTransferAllowance,
    isLoading,
    error,
  };
};
