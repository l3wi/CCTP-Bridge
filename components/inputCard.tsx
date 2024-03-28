"use client";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import contracts, { getChainsFromId } from "@/constants/contracts";
import { useAccount, useBalance, useChains } from "wagmi";
import { Checkbox } from "./ui/checkbox";
import { Dispatch, SetStateAction, useState } from "react";
import { Chain, isAddress, pad, parseUnits } from "viem";
import ApproveGuard from "./guards/ApproveGuard";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useToast } from "./ui/use-toast";

import ConnectGuard from "./guards/ConnectGuard";
import BurnButton from "./burnButton";

export type LocalTransaction = {
  date: Date;
  originChain: number;
  hash: `0x${string}`;
  status: string;
  amount?: string;
  chain?: number;
  targetChain?: number;
  targetAddress?: `0x${string}`;
  claimHash?: `0x${string}`;
};

export function InputCard({
  onBurn,
}: {
  onBurn: Dispatch<SetStateAction<boolean>>;
}) {
  const { toast } = useToast();

  // Get data from WAGMI
  const { address, chain } = useAccount();

  const chains = useChains();
  // Get the chains that are supported by the current chain
  const usableChains =
    chain && chains ? getChainsFromId(chain.id, chains) : null;

  // Get current chain USDC Balance
  const { data: usdcData, isLoading: isBalanceLoading } = useBalance({
    address,
    token: contracts[chain ? chain.id : 1].Usdc,
  });

  // Get Vars for the Buuurn
  const [targetChain, setTargetChain] = useState<null | Chain>(null);
  const [amount, setAmount] = useState<null | { str: string; bigInt: BigInt }>(
    null
  );
  const [diffWallet, setDiffWallet] = useState<boolean>(false);
  const [targetAddress, setTargetAddress] = useState<undefined | string>(
    undefined
  );

  const handleBigInt = (string: string, decimals: number) => {
    const str: string = string.replace(/[a-zA-Z]/g, "");
    if (str === "") return setAmount({ str: "", bigInt: BigInt(0) });
    try {
      let bigInt: BigInt = parseUnits(str, decimals);
      setAmount({ str, bigInt });
    } catch (error) {}
  };

  return (
    <div className="w-full">
      <div className="grid gap-2 pt-4">
        <Label htmlFor="number" className="text-lg text-gray-600">
          Destination Chain
        </Label>

        {chain && usableChains ? (
          <Select
            onValueChange={(c) =>
              setTargetChain(
                (chain &&
                  usableChains.find((chain) => chain?.id.toString() === c)) ||
                  null
              )
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select Chain..." />
            </SelectTrigger>
            <SelectContent>
              {usableChains
                .filter((c) => c && c.id !== chain.id)
                .map(
                  (c) =>
                    c && (
                      <SelectItem key={c.id} value={c.id.toString()}>
                        <div className="flex justify-between items-center">
                          <Image
                            src={`/${c.id}.svg`}
                            width={24}
                            height={24}
                            className="w-6 h-6 mr-2"
                            alt={c.name}
                          />
                          <span>{c.name}</span>
                        </div>
                      </SelectItem>
                    )
                )}
            </SelectContent>
          </Select>
        ) : (
          <Select>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select Chain..." />
            </SelectTrigger>
          </Select>
        )}
      </div>
      <div className="grid gap-2 mt-4">
        <div className="flex items-center justify-between max-w-[384px]">
          <Label htmlFor="name" className="text-lg text-gray-600">
            Amount
          </Label>
          <span className="text-sm">
            {!usdcData?.formatted ? null : `Balance: ${usdcData?.formatted}`}{" "}
          </span>
        </div>

        <div className="flex w-full max-w-sm justify-center items-center space-x-2">
          <Input
            type="string"
            placeholder="150.34"
            value={amount ? amount.str : undefined}
            onChange={(e) => handleBigInt(e.target.value, 6)}
          />
          <Button
            type="submit"
            onClick={() =>
              usdcData?.formatted && handleBigInt(usdcData?.formatted, 6)
            }
          >
            Max
          </Button>
        </div>
      </div>
      <div className="grid gap-2 mt-4">
        <div className="flex items-center justify-left">
          <Checkbox
            id="terms"
            checked={diffWallet}
            onCheckedChange={() => {
              if (!diffWallet) {
                setDiffWallet(true);
                setTargetAddress(address);
              } else {
                setDiffWallet(false);
                setTargetAddress(undefined);
              }
            }}
          />
          <label
            htmlFor="terms"
            className="pl-2 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            Send USDC to a different wallet
            {targetChain && ` on ${targetChain.name}`}?
          </label>
        </div>
        {diffWallet && (
          <>
            <Label htmlFor="number">Destination Wallet</Label>
            <Input
              id="string"
              type="string"
              placeholder=""
              value={targetAddress}
              onChange={(e) => setTargetAddress(e.target.value)}
            />
          </>
        )}
      </div>
      <div className="mt-4">
        <ConnectGuard>
          <ApproveGuard
            token={contracts[chain ? chain.id : 1].Usdc}
            spender={contracts[chain ? chain.id : 1].TokenMessenger}
            amount={amount?.bigInt || BigInt(0)}
          >
            {!amount || amount.bigInt === BigInt(0) ? (
              <Button disabled className="bg-gray-400 w-full">
                Enter an Amount
              </Button>
            ) : amount &&
              usdcData &&
              usdcData.value &&
              // @ts-ignore
              amount.bigInt > usdcData?.value ? ( /// Whhyyyyyy
              <Button disabled className="bg-gray-400 w-full">
                Balance is too low
              </Button>
            ) : !targetChain ? (
              <Button disabled className="bg-gray-400 w-full">
                Select a Destination Chain
              </Button>
            ) : diffWallet && targetAddress && !isAddress(targetAddress) ? (
              <Button disabled className="bg-gray-400 w-full">
                Address is incorrect
              </Button>
            ) : chain && amount && targetChain && address ? (
              <BurnButton
                onBurn={onBurn}
                chain={chain.id}
                amount={amount.bigInt}
                targetChainId={targetChain.id}
                targetAddress={
                  !diffWallet
                    ? address
                    : targetAddress && isAddress(targetAddress)
                    ? targetAddress
                    : "0x00"
                }
              />
            ) : null}
          </ApproveGuard>
        </ConnectGuard>
      </div>
    </div>
  );
}
