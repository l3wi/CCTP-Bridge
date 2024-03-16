import abis from "@/constants/abi";
import React, { useState } from "react";
import {
  erc20ABI,
  useAccount,
  useContractRead,
  useContractWrite,
  usePrepareContractWrite,
} from "wagmi";
import { Button } from "../ui/button";
import { formatUnits } from "viem";

type Props = {
  token: `0x${string}`;
  spender: `0x${string}`;
  amount: BigInt;
  children?: React.ReactNode;
};

export default function ApproveGuard(props: Props) {
  const { token, spender, amount } = props;
  const { address } = useAccount();

  const { data } = useContractRead({
    address: token,
    abi: abis["Usdc"],
    functionName: "allowance",
    args: [address || "0x0000000000000000000000000000000000000000", spender],
    watch: true,
  });

  const approved = data
    ? // BUG: bigint & BigInt are not comparable ???
      BigInt(data.toString()) >= BigInt(amount.toString())
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
  const { config } = usePrepareContractWrite({
    address: token,
    abi: erc20ABI,
    functionName: "approve",
    args: [spender, BigInt(2 ** 255 - 1)],
  });

  const { write } = useContractWrite({
    ...config,
    onSettled(data, error) {
      if (error) console.log("Failed", error);
      if (data) console.log("Success", data);
    },
  });

  return (
    <Button onClick={() => write && write()} className="w-full">
      Approve Token
    </Button>
  );
};
