"use client";
import { Label } from "@/components/ui/label";
import { domains, getChainsFromId, isTestnet } from "@/constants/contracts";
import { useAccount, useChains } from "wagmi";
import { Dispatch, SetStateAction, useEffect, useState } from "react";
import { Chain } from "viem";
import { toast, useToast } from "./ui/use-toast";
import { LocalTransaction } from "@/lib/types";
import { Button } from "./ui/button";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { LoadingButton } from "./loading/LoadingStates";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "./ui/input";
import Image from "next/image";

export function ClaimCard({
  onBurn,
}: {
  onBurn: Dispatch<SetStateAction<boolean>>;
}) {
  // State
  const { transactions, addTransaction } = useTransactionStore();
  const { toast } = useToast();

  // Setup Chain data
  const { chain } = useAccount();
  const chains = useChains();

  const usableChains =
    chain && chains ? getChainsFromId(chain.id, chains) : null;

  // If we don't have a TX then allow user to input one
  const [originChain, setOriginChain] = useState<Chain | null>(null);
  const [hash, setHash] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addPending = async () => {
    if (!hash || !originChain) {
      toast({
        title: "Missing Information",
        description: "Please select a chain and enter a transaction hash.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      // Check if the transaction already exists
      if (transactions.find((t: LocalTransaction) => t.hash === hash)) {
        toast({
          title: "Transaction Already Exists",
          description:
            "This transaction already exists in the list of transactions.",
          variant: "destructive",
        });
        return;
      }

      // Add the transaction to the list
      addTransaction({
        originChain: originChain.id,
        hash: hash as `0x${string}`,
        status: "pending",
      });

      toast({
        title: "Transaction Added",
        description: "The transaction has been added to the list.",
      });

      onBurn(false);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to add transaction. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="grid gap-2 pt-4 w-full">
        <Label htmlFor="number" className="text-lg text-gray-600">
          Origin Chain
        </Label>
        {chain && usableChains ? (
          <Select
            onValueChange={(c) =>
              setOriginChain(
                (chain && chains.find((chain) => chain?.id.toString() === c)) ||
                  null
              )
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select Chain..." />
            </SelectTrigger>
            <SelectContent>
              {chains.map(
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

        <Label htmlFor="name" className="text-lg text-gray-600">
          Transaction Hash
        </Label>
        <Input
          type="string"
          placeholder="0x4e80Fd..."
          value={hash}
          onChange={(e) => setHash(e.target.value)}
        />
      </div>
      <LoadingButton
        className="w-full mt-4"
        onClick={addPending}
        isLoading={isSubmitting}
        disabled={!hash || !originChain}
      >
        Check for Attestation
      </LoadingButton>
    </>
  );
}
