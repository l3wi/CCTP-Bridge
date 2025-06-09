import { useCallback, useState } from "react";
import { useSimulateContract, useWriteContract, useAccount } from "wagmi";
import { formatUnits, pad } from "viem";
import { track } from "@vercel/analytics/react";
import abis from "@/constants/abi";
import contracts, { domains } from "@/constants/contracts";
import { useToast } from "@/components/ui/use-toast";
import {
  BridgeParams,
  DepositForBurnArgs,
  LocalTransaction,
} from "@/lib/types";
import { getErrorMessage, TransactionError, withRetry } from "@/lib/errors";
import { withRpcFallback } from "@/lib/rpc";
import { useTransactionStore } from "@/lib/store/transactionStore";

export interface UseBridgeReturn {
  burn: (params: BridgeParams) => Promise<`0x${string}` | void>;
  approve: (
    token: `0x${string}`,
    spender: `0x${string}`
  ) => Promise<`0x${string}` | void>;
  claim: (
    message: `0x${string}`,
    attestation: `0x${string}`
  ) => Promise<`0x${string}` | void>;
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
        const depositArgs: DepositForBurnArgs = {
          amount: params.amount,
          destinationDomain: domains[params.targetChainId],
          mintRecipient: pad(params.targetAddress),
          burnToken: contracts[params.sourceChainId].Usdc,
        };

        toast({
          title: "Burning USDC",
          description: "Please sign to initiate the bridging process.",
        });

        const txHash = await withRetry(
          () =>
            new Promise<`0x${string}`>((resolve, reject) => {
              writeContract(
                {
                  address: contracts[params.sourceChainId].TokenMessenger,
                  abi: abis["TokenMessenger"],
                  functionName: "depositForBurn",
                  args: [
                    depositArgs.amount,
                    depositArgs.destinationDomain,
                    depositArgs.mintRecipient,
                    depositArgs.burnToken,
                  ],
                },
                {
                  onSuccess(data: `0x${string}`) {
                    try {
                      track("bridge", {
                        amount: formatUnits(params.amount, 6),
                        from: params.sourceChainId,
                        to: params.targetChainId,
                      });

                      toast({
                        title: "Burning USDC",
                        description: "Bridging process successfully initiated.",
                      });

                      // Optimistic update - immediately add to pending transactions
                      const newTransaction: Omit<LocalTransaction, "date"> = {
                        amount: formatUnits(params.amount, 6),
                        originChain: params.sourceChainId,
                        targetChain: params.targetChainId,
                        targetAddress: params.targetAddress,
                        hash: data,
                        status: "pending",
                      };

                      addTransaction(newTransaction);
                      resolve(data);
                    } catch (error) {
                      console.error(
                        "Transaction success handler error:",
                        error
                      );
                      reject(new TransactionError(getErrorMessage(error)));
                    }
                  },
                  onError(error: Error) {
                    console.error("Transaction error:", error);
                    reject(new TransactionError(getErrorMessage(error)));
                  },
                }
              );
            }),
          {
            maxRetries: 2,
            shouldRetry: (error) => {
              return !getErrorMessage(error).includes("cancelled by user");
            },
          }
        );

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

        const txHash = await withRetry(
          () =>
            new Promise<`0x${string}`>((resolve, reject) => {
              writeContract(
                {
                  address: token,
                  abi: abis["Usdc"],
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
            }),
          {
            maxRetries: 2,
            shouldRetry: (error) => {
              return !getErrorMessage(error).includes("cancelled by user");
            },
          }
        );

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
      attestation: `0x${string}`
    ): Promise<`0x${string}` | void> => {
      if (!chain) {
        throw new Error("No chain connected");
      }

      setIsLoading(true);
      setError(null);

      try {
        toast({
          title: "Claiming USDC",
          description: "Please sign to claim your USDC.",
        });

        const txHash = await withRetry(
          () =>
            new Promise<`0x${string}`>((resolve, reject) => {
              writeContract(
                {
                  address: contracts[chain.id].MessageTransmitter,
                  abi: abis["MessageTransmitter"],
                  functionName: "receiveMessage",
                  args: [message, attestation],
                },
                {
                  onSuccess(data: `0x${string}`) {
                    toast({
                      title: "Successfully Claimed USDC",
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
            }),
          {
            maxRetries: 2,
            shouldRetry: (error) => {
              return !getErrorMessage(error).includes("cancelled by user");
            },
          }
        );

        return txHash;
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        setError(errorMessage);
        toast({
          title: "Claim Failed",
          description: errorMessage,
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    },
    [chain, writeContract, toast]
  );

  return {
    burn,
    approve,
    claim,
    isLoading,
    error,
  };
};
