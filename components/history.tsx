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
import { explorers, rpcs } from "@/constants/endpoints";
import { Label } from "@radix-ui/react-label";
import { useEffect } from "react";

const Row = ({ tx, i }: { tx: LocalTransaction; i: number }) => {
  const chains = useChains();
  return (
    <TableRow key={tx.hash}>
      <TableCell>{new Date(tx.date).toDateString()}</TableCell>

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
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
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
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </g>
            </svg>
          </a>
        ) : (
          <div>
            {chains.find((c) => c.id === tx.targetChain)?.name.split(" ")[0]}
          </div>
        )}
      </TableCell>
      <TableCell className="capitalize">{tx.status}</TableCell>
    </TableRow>
  );
};

export default function History() {
  const { address, chain } = useAccount();

  const [transactions, setTransactions] = useLocalStorage<
    Array<LocalTransaction>
  >("txs", []);

  useEffect(() => {
    const fetchTxs = async () => {
      // const client = createPublicClient({
      //   chain,
      //   transport: http(rpcs[chain.id]),
      // });
      // console.log(client);
      // const block = await client.getBlockNumber();
      // const logs = await client.getContractEvents({
      //   address: contracts[chain.id].TokenMessenger,
      //   abi: TokenMessenger,
      //   eventName: "DepositForBurn",
      //   args: { depositor: account.address },
      //   toBlock: "latest",
      //   fromBlock: block - BigInt(3000),
      // });
      // console.log(contracts[chain.id].TokenMessenger);
      // console.log(logs);
      // const txs = await Anker.getTransactionsByAddress({
      //   address: account.address,
      //   blockchain: "optimism",
      // });
      // console.log(txs);
    };
    if (address && chain) fetchTxs();
  }, []);

  return (
    <>
      <Label htmlFor="name" className="text-lg text-gray-600">
        Past Transactions
      </Label>
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
