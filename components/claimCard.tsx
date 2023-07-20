"use client";
import { Label } from "@/components/ui/label";
import { isTestnet } from "@/constants/contracts";
import { useNetwork, usePublicClient } from "wagmi";
import { useEffect, useState } from "react";
import { decodeAbiParameters, keccak256, toHex } from "viem";
import { useToast } from "./ui/use-toast";
import { useLocalStorage } from "usehooks-ts";
import { endpoints } from "@/constants/endpoints";

import { LocalTransaction } from "./inputCard";
import ClaimButton from "./claimButton";
import { Button } from "./ui/button";
import Countdown from "react-countdown";
import { isStringLiteralLike } from "typescript";

export function ClaimCard({ tx }: { tx: LocalTransaction }) {
  const { toast } = useToast();
  const { chains } = useNetwork();

  const publicClient = usePublicClient({ chainId: tx.chain });
  const destinationChain = chains.find((c) => c.id === tx.targetChain);
  const testnet = destinationChain && isTestnet(destinationChain);
  const [transactions, setTransactions] = useLocalStorage<
    Array<LocalTransaction>
  >("txs", []);

  const [msgHash, setMsgHash] = useState<`0x${string}` | null>(null);
  const [msgBytes, setMsgBytes] = useState<`0x${string}` | null>(null);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    const func = async () => {
      const response = await fetch(
        endpoints[testnet ? "testnet" : "mainnet"] + `/attestations/${msgHash}`
      );
      const data = await response.json();
      console.log(data);
      if (data.status === "complete" && msgBytes && msgHash) {
        const index = transactions.findIndex((t) => t.hash === tx.hash);
        const newTransactions = [...transactions];
        newTransactions[index] = {
          ...newTransactions[index],
          status: "complete",
          msgBytes: msgBytes,
          msgHash: msgHash,
          attestation: data.attestation,
        };
        setTransactions(newTransactions);
        clearInterval(timer);
        console.log("Waiting Complete: ", data);
      }
    };

    if (msgHash && tx.status === "pending") {
      timer = setInterval(func, 10000);
    }
  });

  useEffect(() => {
    const func = async () => {
      try {
        const transaction = await publicClient.getTransactionReceipt({
          hash: tx.hash,
        });

        const topic = keccak256(toHex("MessageSent(bytes)"));
        const bytes = transaction.logs.find((l) => l.topics[0] === topic)?.data;
        const data =
          bytes &&
          decodeAbiParameters(
            [{ name: "MessageSent", type: "bytes" }],
            bytes
          )[0];
        //@ts-ignore
        const msgHash = data && keccak256(data);
        //@ts-ignore
        msgHash && setMsgHash(msgHash);
        //@ts-ignore
        data && setMsgBytes(data);
      } catch (error) {
        setTimeout(() => {
          func();
        }, 5000);
      }
    };
    if (!msgHash && publicClient) func();
  }, [tx, publicClient, msgHash]);

  return (
    <div className="w-full flex flex-col">
      <Label className="text-2xl">
        {tx.attestation
          ? "Ready to Claim USDC"
          : "Waiting for Burn Finalization"}
      </Label>
      {tx.msgBytes && tx.attestation ? (
        <div className="w-full flex flex-grow justify-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="inline w-24 h-24 my-8"
            viewBox="0 0 20 20"
          >
            <path
              fill="none"
              stroke="green"
              stroke-width="2"
              d="m2.13,10.7 4.87,4.87 11.3-11.3"
            />
          </svg>
        </div>
      ) : (
        <div className="w-full flex justify-center">
          <div className="flex flex-col justify-center w-fit">
            <svg
              aria-hidden="true"
              className="inline w-24 h-24 my-8 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600"
              viewBox="0 0 100 101"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                fill="currentColor"
              />
              <path
                d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                fill="currentFill"
              />
            </svg>
            <Countdown
              zeroPadTime={2}
              date={new Date(tx.date).getTime() + 1000 * 15 * 60}
            />
          </div>
        </div>
      )}

      <div className="mt-3">
        {tx.msgBytes && tx.attestation ? (
          <ClaimButton
            hash={tx.hash}
            destination={tx.targetChain}
            bytes={tx.msgBytes}
            attestation={tx.attestation}
          />
        ) : (
          <Button disabled className="w-full">
            Waiting for finalization
          </Button>
        )}
      </div>
    </div>
  );
}
