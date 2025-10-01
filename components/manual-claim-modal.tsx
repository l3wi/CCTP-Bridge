"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccount, useChains } from "wagmi";
import { Chain } from "viem";
import { toast } from "@/components/ui/use-toast";
import { LocalTransaction } from "@/lib/types";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { getChainsFromId } from "@/constants/contracts";
import { LoadingButton } from "@/components/loading/LoadingStates";
import Image from "next/image";
import { DialogDescription } from "@radix-ui/react-dialog";
import { validateTransactionHash } from "@/lib/validation";

interface ManualClaimModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ManualClaimModal({
  open,
  onOpenChange,
}: ManualClaimModalProps) {
  const [originChain, setOriginChain] = useState<Chain | null>(null);
  const [txHash, setTxHash] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Hooks
  const { transactions, addTransaction } = useTransactionStore();
  const { chain } = useAccount();
  const chains = useChains();

  const usableChains =
    chain && chains ? getChainsFromId(chain.id, chains) : null;

  const handleCheck = async () => {
    if (!txHash || !originChain) {
      toast({
        title: "Missing Information",
        description: "Please select a chain and enter a transaction hash.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const hashValidation = validateTransactionHash(txHash);
      if (!hashValidation.isValid || !hashValidation.normalizedHash) {
        toast({
          title: "Invalid Transaction Hash",
          description:
            hashValidation.error ||
            "Please enter a valid 66 character transaction hash.",
          variant: "destructive",
        });
        return;
      }

      const normalizedHash = hashValidation.normalizedHash;

      // Check if the transaction already exists
      if (
        transactions.find(
          (t: LocalTransaction) => t.hash.toLowerCase() === normalizedHash
        )
      ) {
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
        hash: normalizedHash,
        status: "pending",
      });

      toast({
        title: "Transaction Added",
        description:
          "The transaction has been added to the list and will be checked for attestation.",
      });

      // Clear form and close modal
      setOriginChain(null);
      setTxHash("");
      onOpenChange(false);
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-800 border-slate-700 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manually Claim Bridge Transaction</DialogTitle>
          <DialogDescription className="text-xs text-slate-500">
            Enter burn transaction hash & origin chain to finalize your
            transaction.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <Label htmlFor="origin-chain" className="text-slate-200">
              Origin Chain
            </Label>
            {chain && usableChains ? (
              <Select
                value={originChain?.id.toString() || ""}
                onValueChange={(chainId) => {
                  const selectedChain = chains.find(
                    (c) => c?.id.toString() === chainId
                  );
                  setOriginChain(selectedChain || null);
                }}
              >
                <SelectTrigger
                  id="origin-chain"
                  className="bg-slate-700/50 border-slate-600 text-white"
                >
                  <SelectValue placeholder="Select Chain..." />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {chains.map(
                    (c) =>
                      c && (
                        <SelectItem
                          key={c.id}
                          value={c.id.toString()}
                          className="text-white hover:bg-slate-700"
                        >
                          <div className="flex items-center">
                            <Image
                              src={`/${c.id}.svg`}
                              width={20}
                              height={20}
                              className="w-5 h-5 mr-2"
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
                <SelectTrigger
                  id="origin-chain"
                  className="bg-slate-700/50 border-slate-600 text-white"
                >
                  <SelectValue placeholder="Connect wallet to select chain..." />
                </SelectTrigger>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tx-hash" className="text-slate-200">
              Transaction Hash
            </Label>
            <Input
              id="tx-hash"
              placeholder="0x4e80Fd..."
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
              className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-400"
            />
          </div>

          <LoadingButton
            className="w-full"
            onClick={handleCheck}
            isLoading={isSubmitting}
            disabled={!originChain || !txHash}
          >
            Check for Attestation
          </LoadingButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
