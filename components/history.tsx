"use client";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLocalStorage } from "usehooks-ts";
import { useAccount, useChains, usePublicClient } from "wagmi";
import { LocalTransaction } from "./inputCard";
import { endpoints, explorers, rpcs } from "@/constants/endpoints";
import { Label } from "@radix-ui/react-label";
import { useEffect, useState } from "react";
import { domains, getChainsFromId, isTestnet } from "@/constants/contracts";
import { fromHex, slice } from "viem";
import { Button } from "./ui/button";
import ClaimButton from "./claimButton";
import ConnectGuard from "./guards/ConnectGuard";
import Countdown from "react-countdown";

const Row = ({ tx, i }: { tx: LocalTransaction; i: number }) => {
  /// Chains
  const { chain } = useAccount();
  const chains = useChains();
  const usableChains =
    chain && chains ? getChainsFromId(chain.id, chains) : null;

  // Decode the transaction
  const origin = tx && chains.find((c) => c.id === tx?.originChain);
  const destination = tx && chains.find((c) => c.id === tx?.targetChain);
  const testnet = destination && isTestnet(destination);

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
        console.log("Attestation Found: ", data.messages[0]);
        setData(data.messages[0]);
        clearInterval(timer);
      }
    };

    if (tx && tx.status === "pending" && !data) {
      timer = setInterval(func, 10000);
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

  // Renderer callback with condition
  const renderer = ({ minutes, seconds, completed }: any) => {
    if (completed) {
      // Render a completed state
      return <span>Still waiting....</span>;
    } else {
      // Render a countdown
      return (
        <div className="w-12 inline-block">
          <span>{`~${
            minutes.toString().length === 1 ? "0" + minutes : minutes
          }:${
            seconds.toString().length === 1 ? "0" + seconds : seconds
          }`}</span>
        </div>
      );
    }
  };

  return (
    <TableRow key={tx.hash}>
      <TableCell className="">
        <span className="block w-32 md:inline">
          {new Date(tx.date).toDateString()}
        </span>
      </TableCell>
      <TableCell>
        <a
          className="hover:underline cursor-pointer flex items-center"
          href={explorers[tx.originChain] + "tx/" + tx.hash}
          target="_blank"
          rel="noopener noreferrer"
        >
          {chains.find((c) => c.id === tx.originChain)?.name.split(" ")[0]}
          <svg
            className="w-4 h-4 ml-2"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <g id="Interface / External_Link">
              <path
                id="Vector"
                d="M10.0002 5H8.2002C7.08009 5 6.51962 5 6.0918 5.21799C5.71547 5.40973 5.40973 5.71547 5.21799 6.0918C5 6.51962 5 7.08009 5 8.2002V15.8002C5 16.9203 5 17.4801 5.21799 17.9079C5.40973 18.2842 5.71547 18.5905 6.0918 18.7822C6.5192 19 7.07899 19 8.19691 19H15.8031C16.921 19 17.48 19 17.9074 18.7822C18.2837 18.5905 18.5905 18.2839 18.7822 17.9076C19 17.4802 19 16.921 19 15.8031V14M20 9V4M20 4H15M20 4L13 11"
                stroke="#000000"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          </svg>
        </a>
      </TableCell>
      <TableCell>
        {tx.claimHash && tx.targetChain ? (
          <a
            className="hover:underline cursor-pointer flex items-center"
            href={explorers[tx.targetChain] + "tx/" + tx.claimHash}
            target="_blank"
            rel="noopener noreferrer"
          >
            {chains.find((c) => c.id === tx.targetChain)?.name.split(" ")[0]}
            <svg
              className="w-4 h-4 ml-2"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g id="Interface / External_Link">
                <path
                  id="Vector"
                  d="M10.0002 5H8.2002C7.08009 5 6.51962 5 6.0918 5.21799C5.71547 5.40973 5.40973 5.71547 5.21799 6.0918C5 6.51962 5 7.08009 5 8.2002V15.8002C5 16.9203 5 17.4801 5.21799 17.9079C5.40973 18.2842 5.71547 18.5905 6.0918 18.7822C6.5192 19 7.07899 19 8.19691 19H15.8031C16.921 19 17.48 19 17.9074 18.7822C18.2837 18.5905 18.5905 18.2839 18.7822 17.9076C19 17.4802 19 16.921 19 15.8031V14M20 9V4M20 4H15M20 4L13 11"
                  stroke="#000000"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            </svg>
          </a>
        ) : (
          <div>
            {destinationDomain
              ? chains
                  .find((c) => c.id === tx.targetChain)
                  ?.name.split(" ")[0] || destinationChain?.name.split(" ")[0]
              : ""}
          </div>
        )}
      </TableCell>
      <TableCell className="capitalize">
        <span className="block w-32 md:inline">
          {tx.status === "claimed" ? (
            "Completed"
          ) : tx && domains && data ? (
            <ConnectGuard>
              <ClaimButton
                hash={tx.hash}
                bytes={data.message}
                attestation={data.attestation}
                onBurn={() => console.log("burn")}
              />
            </ConnectGuard>
          ) : tx.status === "pending" && tx.date ? (
            <div className="text-sm">
              {`ETA: `}
              <Countdown
                className="ml-1"
                date={new Date(tx.date).getTime() + 1000 * 25 * 60}
                renderer={renderer}
              />
            </div>
          ) : tx.status === "pending" ? (
            <Button disabled>Pending</Button>
          ) : null}
        </span>
      </TableCell>
    </TableRow>
  );
};

export default function History() {
  const [transactions, setTransactions] = useLocalStorage<
    Array<LocalTransaction>
  >("txs", []);

  const isPending = transactions.find((tx) => tx.status === "pending");

  const clearPending = () => {
    const hist = transactions.filter((tx) => tx.status !== "pending");
    setTransactions(hist);
  };

  return (
    <>
      <div className="flex w-full justify-between">
        <Label htmlFor="name" className="text-lg text-gray-600">
          History
        </Label>
        {isPending && (
          <Button
            className="text-xs"
            variant={"ghost"}
            onClick={() => clearPending()}
          >
            Clear Pending
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Origin</TableHead>
            <TableHead>Destination</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions[0] &&
            transactions
              .sort((a, b) => (a.date < b.date ? 1 : -1))
              .map((tx, i) => (
                <Row key={tx.hash} tx={tx} i={transactions.length - i} />
              ))}
        </TableBody>
      </Table>
      {!transactions[0] && (
        <div className="w-full text-center pt-5">{`No prior transactions`}</div>
      )}
    </>
  );
}
