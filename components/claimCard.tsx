"use client";
import { Label } from "@/components/ui/label";
import { domains, getChainsFromId, isTestnet } from "@/constants/contracts";
import { useAccount, useChains } from "wagmi";
import { Dispatch, SetStateAction, useEffect, useState } from "react";
import {
  Chain,
  decodeAbiParameters,
  decodeFunctionData,
  fromHex,
  keccak256,
  slice,
  toHex,
  trim,
} from "viem";
import { useToast } from "./ui/use-toast";
import { useLocalStorage } from "usehooks-ts";
import { endpoints } from "@/constants/endpoints";

import { LocalTransaction } from "./inputCard";
import ClaimButton from "./claimButton";
import { Button } from "./ui/button";
import Countdown from "react-countdown";

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
  const [tx, setTx] = useState<LocalTransaction | undefined>(undefined);
  const [transactions, setTransactions] = useLocalStorage<
    Array<LocalTransaction>
  >("txs", []);

  // Load tx from local storage
  useEffect(() => {
    const checkHistory = () => {
      const pendingTx = transactions.find((t) => t.status === "pending");
      if (pendingTx) setTx(pendingTx);
    };

    if (!tx) checkHistory();
  }, [transactions]);

  // Setup Chain data
  const { chain } = useAccount();
  const chains = useChains();

  const usableChains =
    chain && chains ? getChainsFromId(chain.id, chains) : null;
  const origin = tx && chains.find((c) => c.id === tx?.originChain);
  const destination = tx && chains.find((c) => c.id === tx?.targetChain);
  const testnet = destination && isTestnet(destination);

  // If we don't have a TX then allow user to input one
  const [originChain, setOriginChain] = useState<null | Chain>(null);
  const [hash, setHash] = useState<undefined | string>(undefined);

  // Fetch Circle attestation & message
  const [data, setData] = useState<
    | undefined
    | {
        attestation: `0x${string}`;
        message: `0x${string}`;
      }
  >(undefined);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    const func = async () => {
      if (!tx) return;

      const response = await fetch(
        endpoints[testnet ? "testnet" : "mainnet"] +
          `/messages/${
            tx.chain ? domains[tx.chain] : domains[tx.originChain]
          }/${tx.hash}`
      );
      const data = await response.json();
      if (data.messages[0].attestation !== "PENDING") {
        setData(data.messages[0]);
      }

      // if (data.status === "complete" && msgBytes && msgHash) {
      //   const index = transactions.findIndex((t) => t.hash === tx.hash);
      //   const newTransactions = [...transactions];
      //   newTransactions[index] = {
      //     ...newTransactions[index],
      //     status: "complete",
      //   };
      //   setTransactions(newTransactions);
      //   clearInterval(timer);
      //   console.log("Waiting Complete: ", data);
      // }
    };

    if (tx && tx.status === "pending" && !data) {
      timer = setInterval(func, 15000);
    }
  });

  /// Derive Destination ChainID from Bytes
  const destinationDomain =
    data && fromHex(slice(data?.message, 8, 12) as `0x${string}`, "number");
  const destinationChain = chains.find(
    (c) =>
      c.id ===
      parseInt(
        (Object.entries(domains).find(
          ([chain, domain]) => domain === destinationDomain
        ) || ["1", 0])[0]
      )
  );

  return (
    <>
      {!tx && (
        <>
          <div className="grid gap-2 pt-4 w-full">
            <Label htmlFor="number" className="text-lg text-gray-600">
              Select Origin Chain
            </Label>
            {chain && usableChains ? (
              <Select
                onValueChange={(c) =>
                  setOriginChain(
                    (chain &&
                      chains.find((chain) => chain?.id.toString() === c)) ||
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
          <Button
            className="w-full mt-4"
            onClick={() =>
              setTransactions([
                ...transactions,
                {
                  date: new Date(),
                  originChain: originChain?.id || 0,
                  hash: hash as `0x${string}`,
                  status: "pending",
                },
              ])
            }
          >
            Check for Attestation
          </Button>
        </>
      )}

      {data ? (
        <>
          <div className=" w-full flex flex-grow justify-center items-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="inline w-14 h-14 mx-2"
              viewBox="0 0 20 20"
            >
              <path
                fill="none"
                stroke="green"
                stroke-width="2"
                d="m2.13,10.7 4.87,4.87 11.3-11.3"
              />
            </svg>
            <h2 className="text-green-800 text-3xl font-semibold">
              Ready to Claim
            </h2>
          </div>
          {destinationChain && (
            <div className="flex w-full justify-around">
              {origin && (
                <div className="flex justify-between items-center">
                  <Image
                    src={`/${origin.id}.svg`}
                    width={24}
                    height={24}
                    className="w-6 h-6 mr-2"
                    alt={origin.name}
                  />
                  <span>{origin.name}</span>
                </div>
              )}
              {` -> `}
              {destinationChain && (
                <div className="flex justify-between items-center">
                  <Image
                    src={`/${destinationChain.id}.svg`}
                    width={24}
                    height={24}
                    className="w-6 h-6 mr-2"
                    alt={destinationChain.name}
                  />
                  <span>{destinationChain.name}</span>
                </div>
              )}
            </div>
          )}
        </>
      ) : null}

      {tx && !data ? (
        <div className="w-full flex-grow flex flex-col justify-center items-center">
          <div className="flex justify-center items-center">
            <svg
              className="w-12 h-12 mr-3 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600"
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
            <h2 className="text-grey-800 text-3xl font-semibold">
              Waiting for Attestation
            </h2>
          </div>
          {tx.date && (
            <div className="flex justify-center min-w-full text-sm">
              {`Estimated Remaining: `}
              <Countdown
                className="ml-1"
                zeroPadTime={2}
                date={new Date(tx.date).getTime() + 1000 * 20 * 60 + 1000 * 15}
              />
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-3 w-full text-center">
        {!data ? (
          <Label
            className="text-xs text-gray-400 "
            onClick={() => setTx(undefined)}
          >
            Transaction Stuck? Enter Manually...
          </Label>
        ) : null}
      </div>
      <div className="mt-3 w-full">
        {tx && domains && data ? (
          <ClaimButton
            hash={tx.hash}
            bytes={data.message}
            attestation={data.attestation}
            onBurn={onBurn}
          />
        ) : null}
      </div>
    </>
  );
}
