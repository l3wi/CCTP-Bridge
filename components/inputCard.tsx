"use client";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import contracts, { getChainsFromId } from "@/constants/contracts";
import { useAccount, useChains } from "wagmi";
import { Checkbox } from "./ui/checkbox";
import {
  Dispatch,
  SetStateAction,
  useState,
  useCallback,
  useMemo,
} from "react";
import { Chain } from "viem";
import { validateBridgeParams } from "@/lib/validation";
import { getErrorMessage } from "@/lib/errors";
import { AmountState } from "@/lib/types";
import { useBridge } from "@/lib/hooks/useBridge";
import { useBalance } from "@/lib/hooks/useBalance";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useToast } from "./ui/use-toast";
import {
  LoadingButton,
  BalanceLoader,
  ChainSelectorSkeleton,
  FormFieldSkeleton,
} from "./loading/LoadingStates";

// LocalTransaction type moved to @/lib/types

interface InputCardProps {
  onBurn: Dispatch<SetStateAction<boolean>>;
}

export function InputCard({ onBurn }: InputCardProps) {
  // Hooks
  const { address, chain } = useAccount();
  const { toast } = useToast();
  const chains = useChains();
  const { burn, isLoading: isBridgeLoading } = useBridge();
  const {
    usdcBalance,
    usdcFormatted,
    isUsdcLoading,
    hasSufficientBalance,
    needsApproval,
  } = useBalance();

  // State
  const [targetChain, setTargetChain] = useState<Chain | null>(null);
  const [amount, setAmount] = useState<AmountState | null>(null);
  const [diffWallet, setDiffWallet] = useState<boolean>(false);
  const [targetAddress, setTargetAddress] = useState<string | undefined>(
    undefined
  );

  // Memoized values
  const usableChains = useMemo(
    () => (chain && chains ? getChainsFromId(chain.id, chains) : null),
    [chain, chains]
  );

  const availableChains = useMemo(
    () => usableChains?.filter((c) => c && c.id !== chain?.id) || [],
    [usableChains, chain?.id]
  );

  // Handle amount change with validation
  const handleAmountChange = useCallback(
    (inputStr: string) => {
      try {
        // Clean the input string
        const cleanStr = inputStr.replace(/[^0-9.]/g, "");

        if (cleanStr === "") {
          setAmount(null);
          return;
        }

        // Basic format validation
        const decimalCount = (cleanStr.match(/\./g) || []).length;
        if (decimalCount > 1) {
          toast({
            title: "Invalid Format",
            description: "Please enter a valid number",
            variant: "destructive",
          });
          return;
        }

        // Check decimal places
        if (cleanStr.includes(".")) {
          const decimalPart = cleanStr.split(".")[1];
          if (decimalPart && decimalPart.length > 6) {
            toast({
              title: "Too Many Decimals",
              description: "Maximum 6 decimal places allowed",
              variant: "destructive",
            });
            return;
          }
        }

        try {
          // Convert to BigInt for validation
          let divisor = BigInt(1);
          for (let i = 0; i < 6; i++) {
            divisor = divisor * BigInt(10);
          }
          const [integerPart, decimalPart = ""] = cleanStr.split(".");
          const paddedDecimal = decimalPart.padEnd(6, "0");
          const bigIntValue = BigInt(integerPart + paddedDecimal);

          setAmount({
            str: cleanStr,
            bigInt: bigIntValue,
          });
        } catch (error) {
          console.error("Amount parsing error:", error);
          toast({
            title: "Invalid Amount",
            description: "Please enter a valid number",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error("Amount validation error:", error);
        toast({
          title: "Error",
          description: getErrorMessage(error),
          variant: "destructive",
        });
      }
    },
    [toast]
  );

  // Validation
  const validation = useMemo(
    () =>
      validateBridgeParams({
        amount,
        targetChain: targetChain?.id || null,
        targetAddress,
        sourceChain: chain?.id,
        balance: usdcBalance,
        isCustomAddress: diffWallet,
        userAddress: address,
      }),
    [
      amount,
      targetChain?.id,
      targetAddress,
      chain?.id,
      usdcBalance,
      diffWallet,
      address,
    ]
  );

  // Handle bridge transaction
  const handleBridge = useCallback(async () => {
    if (!validation.isValid || !validation.data || !chain) {
      return;
    }

    try {
      await burn({
        amount: validation.data.amount,
        sourceChainId: chain.id,
        targetChainId: validation.data.targetChain,
        targetAddress: validation.data.targetAddress,
        sourceTokenAddress: contracts[chain.id].Usdc,
      });

      // Switch to claim mode after successful burn
      onBurn(true);
    } catch (error) {
      console.error("Bridge transaction failed:", error);
    }
  }, [validation, chain, burn, onBurn]);

  // Loading states
  const isLoading = isUsdcLoading || isBridgeLoading;
  const showChainLoader = !chain || !chains.length;
  const showBalanceLoader = isUsdcLoading && !!address && !!chain;

  return (
    <div className="w-full">
      {/* Destination Chain Selection */}
      <div className="grid gap-2 pt-4">
        <Label htmlFor="destination-chain" className="text-lg text-gray-600">
          Destination Chain
        </Label>

        {showChainLoader ? (
          <ChainSelectorSkeleton />
        ) : chain && usableChains ? (
          <Select
            onValueChange={(c) => {
              const selectedChain = chains.find(
                (chain) => chain?.id.toString() === c
              );
              setTargetChain(selectedChain || null);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select Chain..." />
            </SelectTrigger>
            <SelectContent>
              {availableChains.map(
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
          <Select disabled>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Connect wallet to see chains..." />
            </SelectTrigger>
          </Select>
        )}
      </div>

      {/* Amount Input */}
      <div className="grid gap-2 mt-4">
        <div className="flex items-center justify-between max-w-[384px]">
          <Label htmlFor="amount" className="text-lg text-gray-600">
            Amount
          </Label>
          {showBalanceLoader ? (
            <BalanceLoader />
          ) : (
            <span className="text-sm">
              {usdcFormatted ? `Balance: ${usdcFormatted}` : ""}
            </span>
          )}
        </div>

        <div className="flex w-full max-w-sm justify-center items-center space-x-2">
          <Input
            id="amount"
            type="text"
            placeholder="150.34"
            value={amount?.str || ""}
            onChange={(e) => handleAmountChange(e.target.value)}
            disabled={isLoading}
          />
          <LoadingButton
            variant="outline"
            onClick={() => usdcFormatted && handleAmountChange(usdcFormatted)}
            disabled={!usdcFormatted || isLoading}
          >
            Max
          </LoadingButton>
        </div>
      </div>

      {/* Custom Address Option */}
      <div className="grid gap-2 mt-4">
        <div className="flex items-center justify-left">
          <Checkbox
            id="custom-address"
            checked={diffWallet}
            onCheckedChange={(checked) => {
              if (checked) {
                setDiffWallet(true);
                setTargetAddress(address);
              } else {
                setDiffWallet(false);
                setTargetAddress(undefined);
              }
            }}
            disabled={isLoading}
          />
          <label
            htmlFor="custom-address"
            className="pl-2 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            Send USDC to a different wallet
            {targetChain && ` on ${targetChain.name}`}?
          </label>
        </div>

        {diffWallet && (
          <>
            <Label htmlFor="target-address">Destination Wallet</Label>
            <Input
              id="target-address"
              type="text"
              placeholder="0x..."
              value={targetAddress || ""}
              onChange={(e) => setTargetAddress(e.target.value)}
              disabled={isLoading}
            />
          </>
        )}
      </div>

      {/* Bridge Button */}
      <div className="mt-4">
        <LoadingButton
          className="w-full"
          onClick={handleBridge}
          isLoading={isBridgeLoading}
          disabled={!validation.isValid || isLoading}
        >
          {validation.isValid
            ? "Begin Bridging USDC"
            : validation.errors[0] || "Please complete the form"}
        </LoadingButton>
      </div>
    </div>
  );
}
