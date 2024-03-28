import abis from "@/constants/abi";
import React, { useState } from "react";

import { Button } from "../ui/button";
import { erc20Abi, formatUnits, maxInt256, zeroAddress } from "viem";
import {
  useAccount,
  useReadContract,
  useSimulateContract,
  useWriteContract,
} from "wagmi";

type Props = {
  token: `0x${string}`;
  spender: `0x${string}`;
  amount: BigInt;
  children?: React.ReactNode;
};

export default function ApproveGuard(props: Props) {
  const { token, spender, amount } = props;
  const { address } = useAccount();

  const result = useReadContract({
    address: token,
    abi: abis["Usdc"],
    functionName: "allowance",
    args: [address || zeroAddress, spender],
  });
  const { data, isFetched, error } = result;

  const approved = data
    ? // BUG: bigint & BigInt are not comparable ???
      BigInt(data.toString()) > BigInt(amount.toString())
    : false;
  return (
    <div>
      {approved || !token || !address ? (
        props.children
      ) : (
        <ApproveButton token={token} spender={spender} />
      )}
    </div>
  );
}

const ApproveButton = ({
  token,
  spender,
}: {
  token: `0x${string}`;
  spender: `0x${string}`;
}) => {
  const { writeContract } = useWriteContract();

  const { isSuccess } = useSimulateContract({
    address: token,
    abi: erc20Abi,
    functionName: "approve",
    args: [spender, maxInt256],
  });

  return (
    <Button
      onClick={() =>
        isSuccess &&
        writeContract({
          address: token,
          abi: erc20Abi,
          functionName: "approve",
          args: [spender, maxInt256],
        })
      }
      className="w-full"
    >
      Approve Token
    </Button>
  );
};
