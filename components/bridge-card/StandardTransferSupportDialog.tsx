"use client";

import { formatUnits } from "viem";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface StandardTransferSupportDialogProps {
  open: boolean;
  amount: bigint;
  contribution: bigint;
  onOpenChange: (open: boolean) => void;
  onAccept: () => void;
  onDecline: () => void;
}

const formatUsdc = (amount: bigint): string =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(formatUnits(amount, 6)));

export function StandardTransferSupportDialog({
  open,
  amount,
  contribution,
  onOpenChange,
  onAccept,
  onDecline,
}: StandardTransferSupportDialogProps) {
  const receivedAmount = amount - contribution;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-700 bg-slate-900 p-5 text-white sm:max-w-md">
        <DialogHeader className="pr-7 text-left">
          <DialogTitle>Consider Supporting CCTP.io</DialogTitle>
          <DialogDescription className="text-slate-400">
            The standard transfer is fee-less, and will remain so. However, please
            consider supporting the maintenance, RPC costs, and continued development
            of CCTP.io if you&apos;re able to.
          </DialogDescription>
        </DialogHeader>

        <dl className="divide-y divide-slate-800 rounded-md border border-slate-800 bg-slate-950/40 px-4">
          <div className="flex items-center justify-between gap-4 py-3 text-sm">
            <dt className="text-slate-400">Bridge amount</dt>
            <dd className="font-medium text-white">{formatUsdc(amount)} USDC</dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-3 text-sm">
            <dt className="text-slate-400">Optional contribution</dt>
            <dd className="font-medium text-white">{formatUsdc(contribution)} USDC</dd>
          </div>
          <div className="flex items-center justify-between gap-4 py-3 text-sm">
            <dt className="text-slate-400">Recipient receives</dt>
            <dd className="font-medium text-white">{formatUsdc(receivedAmount)} USDC</dd>
          </div>
        </dl>

        <p className="text-xs leading-5 text-slate-500">
          This contribution is optional. Continuing without it works exactly the same.
        </p>

        <DialogFooter className="sm:flex-col sm:items-stretch">
          <Button className="w-full bg-blue-600 text-white hover:bg-blue-700" onClick={onAccept}>
            Bridge with contribution
          </Button>
          <Button
            className="w-full border-slate-300 bg-slate-300 text-slate-800 hover:bg-slate-400 hover:text-slate-900"
            variant="outline"
            onClick={onDecline}
          >
            Bridge without contributing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
