import abis from "@/constants/abi";
import React, { useState, useEffect, useCallback } from "react";

import { Button } from "../ui/button";
import { erc20Abi, formatUnits, maxUint256, zeroAddress } from "viem";
import {
  useAccount,
  useReadContract,
  useSimulateContract,
  useWriteContract,
  useConfig,
} from "wagmi";
import { watchContractEvent } from "@wagmi/core";
import { useToast } from "../ui/use-toast";
import { getErrorMessage, TransactionError } from "@/lib/errors";

interface ApproveGuardProps {
  token: `0x${string}`;
  spender: `0x${string}`;
  amount: bigint;
  children?: React.ReactNode;
}

export default function ApproveGuard(props: ApproveGuardProps) {
  const { token, spender, amount } = props;
  const { address } = useAccount();
  const { toast } = useToast();
  const [eventApproved, setEventApproved] = useState<null | bigint>(null);
  const config = useConfig();

  const result = useReadContract({
    address: token,
    abi: abis["Usdc"],
    functionName: "allowance",
    args: [address || zeroAddress, spender],
    query: {
      refetchInterval: 10_000,
    },
  });
  const { data, isFetched, error } = result;

  const approved = data
    ? BigInt(data.toString()) >= BigInt(amount.toString())
    : eventApproved
    ? BigInt(eventApproved.toString()) >= BigInt(amount.toString())
    : false;

  return (
    <div>
      {eventApproved || approved || !token || !address ? (
        props.children
      ) : (
        <ApproveButton token={token} spender={spender} amount={amount} />
      )}
    </div>
  );
}

const ApproveButton = ({
  token,
  spender,
  amount,
}: {
  token: `0x${string}`;
  spender: `0x${string}`;
  amount: bigint;
}) => {
  const { toast } = useToast();
  const { writeContract } = useWriteContract();

  const { isSuccess } = useSimulateContract({
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, amount],
  });

  const approve = useCallback(async () => {
    try {
      toast({
        title: "Approving Token",
        description: "Please wait while we approve the token.",
      });

      await new Promise<`0x${string}`>((resolve, reject) => {
        writeContract(
          {
            address: token,
            abi: erc20Abi,
            functionName: "approve",
            args: [spender, amount],
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
    } catch (error) {
      console.error("Approval failed:", error);
      toast({
        title: "Approval Failed",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  }, [token, spender, amount, writeContract, toast]);

  return (
    <Button
      onClick={() => isSuccess && approve()}
      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3"
    >
      Approve Token
    </Button>
  );
};
