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
import { useNetwork, usePublicClient } from "wagmi";
import { LocalTransaction } from "./inputCard";
import { explorers } from "@/constants/endpoints";
import { Label } from "@radix-ui/react-label";

const Row = ({ tx, i }: { tx: LocalTransaction; i: number }) => {
  const { chains } = useNetwork();
  return (
    <TableRow key={tx.hash}>
      <TableCell>{new Date(tx.date).toDateString()}</TableCell>
      <TableCell>${tx.amount}</TableCell>
      <TableCell>
        <a
          className="hover:underline cursor-pointer"
          href={explorers[tx.chain] + "tx/" + tx.hash}
          target="_blank"
          rel="noopener noreferrer"
        >
          {chains.find((c) => c.id === tx.chain)?.name.split(" ")[0]}
        </a>
      </TableCell>
      <TableCell>
        <a
          className="hover:underline cursor-pointer"
          href={explorers[tx.targetChain] + "tx/" + tx.claimHash}
          target="_blank"
          rel="noopener noreferrer"
        >
          {chains.find((c) => c.id === tx.targetChain)?.name.split(" ")[0]}
        </a>
      </TableCell>
    </TableRow>
  );
};

export default function History() {
  const [transactions, setTransactions] = useLocalStorage<
    Array<LocalTransaction>
  >("txs", []);
  return (
    <div>
      <Label htmlFor="name" className="text-lg text-gray-600">
        Past Transactions
      </Label>
      <Table>
        <TableCaption>A list of your transactions</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Origin</TableHead>
            <TableHead>Destination</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions
            .sort((a, b) => (a.date < b.date ? 1 : -1))
            .map((tx, i) => (
              <Row key={tx.hash} tx={tx} i={transactions.length - i} />
            ))}
        </TableBody>
      </Table>
    </div>
  );
}
