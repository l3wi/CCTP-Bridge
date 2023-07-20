"use client";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import contracts, { getChainsFromId } from "@/constants/contracts";
import { Chain, useAccount, useBalance, useNetwork } from "wagmi";
import { Checkbox } from "./ui/checkbox";
import { useState } from "react";
import { isAddress, pad, parseUnits } from "viem";
import ApproveGuard from "./guards/ApproveGuard";

import { useToast } from "./ui/use-toast";

import ConnectGuard from "./guards/ConnectGuard";
import BurnButton from "./burnButton";

export type LocalTransaction = {
  date: Date;
  amount: string;
  chain: number;
  targetChain: number;
  targetAddress: `0x${string}`;
  hash: `0x${string}`;
  status: string;
  claimHash?: `0x${string}`;
  attestation?: `0x${string}`;
  msgHash?: `0x${string}`;
  msgBytes?: `0x${string}`;
};

export function InputCard() {
  const { toast } = useToast();

  // Get data from WAGMI
  const { address } = useAccount();
  const { chain, chains } = useNetwork();
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
      <div className="grid gap-2 ">
        <Label htmlFor="number" className="text-lg text-gray-600">
          Destination Chain
        </Label>
        {chain && usableChains ? (
          <RadioGroup defaultValue="card" className="grid grid-cols-2 gap-4">
            {usableChains
              .filter((c) => c && c.id !== chain.id)
              .map(
                (c) =>
                  c && (
                    <Label
                      key={c.id}
                      htmlFor={c.network}
                      className="flex text-center  flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground [&:has([data-state=checked])]:border-primary"
                    >
                      <RadioGroupItem
                        onClick={() => setTargetChain(c)}
                        value={c.network}
                        id={c.network}
                        className="sr-only"
                      />
                      <Image
                        className="pb-2"
                        src={`/${c.id}.svg`}
                        alt="Ethereum"
                        height={80}
                        width={80}
                      />
                      {c.name}
                    </Label>
                  )
              )}
          </RadioGroup>
        ) : (
          <RadioGroup defaultValue="card" className="grid grid-cols-3 gap-4">
            <Label className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-2 lg:p-4 hover:bg-accent hover:text-accent-foreground [&:has([data-state=checked])]:border-primary">
              <RadioGroupItem
                id={"ethereum"}
                value={"ethereum"}
                className="sr-only"
              />
              <Image
                className="pb-2"
                src="/1.svg"
                alt="Ethereum"
                height={80}
                width={80}
              />
              Ethereum
            </Label>
            <Label className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground [&:has([data-state=checked])]:border-primary">
              <RadioGroupItem
                id={"arbitrum"}
                value={"arbitrum"}
                className="sr-only"
              />
              <Image
                className="pb-2"
                src="/42161.svg"
                alt="Ethereum"
                height={80}
                width={80}
              />
              Arbitrum
            </Label>
            <Label className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground [&:has([data-state=checked])]:border-primary">
              <RadioGroupItem
                id={"avalanche"}
                value={"avalanche"}
                className="sr-only"
              />
              <Image
                className="pb-2"
                src="/43114.svg"
                alt="Ethereum"
                height={80}
                width={80}
              />
              Avalanche
            </Label>
          </RadioGroup>
        )}
      </div>
      <div className="grid gap-2 mt-4">
        <div className="flex items-center justify-between max-w-[384px]">
          <Label htmlFor="name" className="text-lg text-gray-600">
            Amount
          </Label>
          <span>
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
