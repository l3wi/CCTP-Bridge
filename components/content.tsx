"use client";
import { InputCard, LocalTransaction } from "./inputCard";
import { useLocalStorage } from "usehooks-ts";
import History from "./history";
import { useState } from "react";
import { Label } from "@radix-ui/react-label";
import { Button } from "./ui/button";
import { ClaimCard } from "./claimCard";

export default function ContentWrapper() {
  const [isHistory, setIsHistory] = useState(false);
  const [transactions, setTransactions] = useLocalStorage<
    Array<LocalTransaction>
  >("txs", []);

  const pendingTx =
    transactions &&
    transactions.length > 0 &&
    transactions.find(
      (tx) => tx.status === "complete" || tx.status === "pending"
    );

  return (
    <div className="w-full relative ">
      {pendingTx && <ClaimCard tx={pendingTx} />}
      {!pendingTx && (
        <>
          <Label
            onClick={() => setIsHistory(!isHistory)}
            className="text-sm absolute top-1 right-2 hover:underline cursor-pointer"
          >
            {isHistory ? "New Transaction" : "History"}
          </Label>
          {isHistory ? <History /> : <InputCard />}
        </>
      )}
    </div>
  );
}
