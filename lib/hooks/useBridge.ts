import { useCallback, useState } from "react";
import { useSimulateContract, useWriteContract, useAccount } from "wagmi";
import { formatUnits, pad } from "viem";
import { track } from "@vercel/analytics/react";
import abis from "@/constants/abi";
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
import { getErrorMessage, TransactionError, withRetry } from "@/lib/errors";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { endpoints, v2Endpoints } from "@/constants/endpoints";

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
  fastBurn: (params: FastTransferParams) => Promise<`0x${string}` | void>;
  getFastTransferFee: (sourceDomain: number, destDomain: number) => Promise<V2FastBurnFeesResponse>;
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
        const version = params.version || 'v1';
        const transferType = params.transferType || 'standard';
        const selectedContracts = getContracts(params.sourceChainId, version);
        
        if (!selectedContracts) {
          throw new Error(`Contracts not found for chain ${params.sourceChainId} version ${version}`);
        }

        const depositArgs: DepositForBurnArgs = {
          amount: params.amount,
          destinationDomain: domains[params.targetChainId],
          mintRecipient: pad(params.targetAddress),
          burnToken: selectedContracts.Usdc,
        };

        const isV2FastTransfer = version === 'v2' && transferType === 'fast';

        toast({
          title: `${isV2FastTransfer ? 'Fast ' : ''}Burning USDC`,
          description: `Please sign to initiate the ${isV2FastTransfer ? 'fast ' : ''}bridging process.`,
        });

        const txHash = await withRetry(
          () =>
            new Promise<`0x${string}`>((resolve, reject) => {
              // Use appropriate function based on transfer type
              const functionName = isV2FastTransfer ? "depositForBurnWithCaller" : "depositForBurn";
              const args = isV2FastTransfer 
                ? [
                    depositArgs.amount,
                    depositArgs.destinationDomain,
                    depositArgs.mintRecipient,
                    depositArgs.burnToken,
                    pad("0x0000000000000000000000000000000000000000") // caller for fast transfer
                  ]
                : [
                    depositArgs.amount,
                    depositArgs.destinationDomain,
                    depositArgs.mintRecipient,
                    depositArgs.burnToken,
                  ];

              writeContract(
                {
                  address: selectedContracts.TokenMessenger,
                  abi: abis["TokenMessenger"],
                  functionName,
                  args,
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
                        title: `${isV2FastTransfer ? 'Fast ' : ''}Burning USDC`,
                        description: `${isV2FastTransfer ? 'Fast b' : 'B'}ridging process successfully initiated.`,
                      });

                      // Optimistic update - immediately add to pending transactions
                      const newTransaction: Omit<LocalTransaction, "date"> = {
                        amount: formatUnits(params.amount, 6),
                        originChain: params.sourceChainId,
                        targetChain: params.targetChainId,
                        targetAddress: params.targetAddress,
                        hash: data,
                        status: "pending",
                        version,
                        transferType,
                        estimatedTime: isV2FastTransfer ? '8-20 seconds' : '13-19 minutes',
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

  const fastBurn = useCallback(
    async (params: FastTransferParams): Promise<`0x${string}` | void> => {
      return burn(params);
    },
    [burn]
  );

  const getFastTransferFee = useCallback(
    async (sourceDomain: number, destDomain: number): Promise<V2FastBurnFeesResponse> => {
      try {
        const response = await fetch(`${endpoints.v2.mainnet}${v2Endpoints.fastBurnFees(sourceDomain, destDomain)}`);
        if (!response.ok) {
          throw new Error('Failed to fetch fast transfer fees');
        }
        return await response.json();
      } catch (error) {
        console.error('Error fetching fast transfer fees:', error);
        throw error;
      }
    },
    []
  );

  const getFastTransferAllowance = useCallback(
    async (): Promise<V2FastBurnAllowanceResponse> => {
      try {
        const response = await fetch(`${endpoints.v2.mainnet}${v2Endpoints.fastBurnAllowance}`);
        if (!response.ok) {
          throw new Error('Failed to fetch fast transfer allowance');
        }
        return await response.json();
      } catch (error) {
        console.error('Error fetching fast transfer allowance:', error);
        throw error;
      }
    },
    []
  );

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
