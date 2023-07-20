import { useContractWrite, usePrepareContractWrite } from "wagmi";
import { Button } from "./ui/button";
import abis from "@/constants/abi";
import contracts, { domains } from "@/constants/contracts";
import { useToast } from "./ui/use-toast";
import { LocalTransaction } from "./inputCard";
import { useLocalStorage } from "usehooks-ts";
import { formatUnits, pad } from "viem";

// Big Int????
export default function BurnButton({
  chain,
  amount,
  targetChainId,
  targetAddress,
}: {
  chain: number;
  amount: BigInt;
  targetChainId: number;
  targetAddress: `0x${string}`;
}) {
  const [transactions, setTransactions] = useLocalStorage<
    Array<LocalTransaction>
  >("txs", []);
  const { toast } = useToast();

  const { config } = usePrepareContractWrite({
    address: contracts[chain].TokenMessenger,
    abi: abis["TokenMessenger"],
    functionName: "depositForBurn",
    args: [
      // @ts-ignore
      amount,
      domains[targetChainId],
      pad(targetAddress),
      contracts[chain].Usdc,
    ],
  });

  const { write } = useContractWrite({
    ...config,
    onSuccess(data) {
      console.log("Successful Write: ", data);

      setTransactions([
        ...transactions,
        {
          date: new Date(),
          // @ts-ignore
          amount: formatUnits(amount, 6),
          chain: chain,
          targetChain: targetChainId,
          targetAddress: targetAddress,
          hash: data.hash,
          status: "pending",
        },
      ]);
    },
  });

  return (
    <div>
      {write ? (
        <Button className="w-full" onClick={() => write()}>
          Begin bridging USDC
        </Button>
      ) : (
        <Button disabled className="bg-gray-500 w-full">
          Error estimating transaction
        </Button>
      )}
    </div>
  );
}
