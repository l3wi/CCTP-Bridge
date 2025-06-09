import { useSimulateContract, useWriteContract } from "wagmi";
import { Button } from "./ui/button";
import abis from "@/constants/abi";
import contracts, { domains } from "@/constants/contracts";
import { useToast } from "./ui/use-toast";
import { LocalTransaction, DepositForBurnArgs } from "@/lib/types";
import { useLocalStorage } from "usehooks-ts";
import { formatUnits, pad } from "viem";
import { writeContract } from "viem/actions";
import { Dispatch, SetStateAction, useCallback } from "react";
import { track } from "@vercel/analytics/react";
import { getErrorMessage, TransactionError, withRetry } from "@/lib/errors";

export interface BurnButtonProps {
  chain: number;
  amount: bigint;
  targetChainId: number;
  targetAddress: `0x${string}`;
}

export default function BurnButton({
  chain,
  amount,
  targetChainId,
  targetAddress,
}: BurnButtonProps) {
  const { writeContract } = useWriteContract();
  const [transactions, setTransactions] = useLocalStorage<LocalTransaction[]>(
    "txs",
    []
  );
  const { toast } = useToast();

  // Prepare the deposit for burn arguments with proper typing
  const depositArgs: DepositForBurnArgs = {
    amount,
    destinationDomain: domains[targetChainId],
    mintRecipient: pad(targetAddress),
    burnToken: contracts[chain].Usdc,
  };

  const { isSuccess, error } = useSimulateContract({
    address: contracts[chain].TokenMessenger,
    abi: abis["TokenMessenger"],
    functionName: "depositForBurn",
    args: [
      depositArgs.amount,
      depositArgs.destinationDomain,
      depositArgs.mintRecipient,
      depositArgs.burnToken,
    ],
  });

  const burn = useCallback(async () => {
    try {
      toast({
        title: "Burning USDC",
        description: "Please sign to initiate the bridging process.",
      });

      await withRetry(
        () =>
          new Promise<`0x${string}`>((resolve, reject) => {
            writeContract(
              {
                address: contracts[chain].TokenMessenger,
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
                      amount: formatUnits(amount, 6),
                      from: chain,
                      to: targetChainId,
                    });

                    toast({
                      title: "Burning USDC",
                      description: "Bridging process successfully initiated.",
                    });

                    console.log("Successful Write: ", data);

                    const newTransaction: LocalTransaction = {
                      date: new Date(),
                      amount: formatUnits(amount, 6),
                      originChain: chain,
                      targetChain: targetChainId,
                      hash: data,
                      status: "pending",
                    };

                    setTransactions([...transactions, newTransaction]);
                    resolve(data);
                  } catch (error) {
                    console.error("Transaction success handler error:", error);
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
            // Don't retry user rejections
            return !getErrorMessage(error).includes("cancelled by user");
          },
        }
      );
    } catch (error) {
      console.error("Burn transaction failed:", error);
      toast({
        title: "Transaction Failed",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  }, [
    chain,
    amount,
    targetChainId,
    targetAddress,
    depositArgs,
    writeContract,
    toast,
    transactions,
    setTransactions,
  ]);

  return (
    <div>
      {isSuccess ? (
        <Button className="w-full" onClick={() => burn()}>
          Begin bridging USDC
        </Button>
      ) : (
        <Button disabled className="bg-gray-500 w-full">
          Error estimating transaction
        </Button>
      )}
    </div>
  );
}
