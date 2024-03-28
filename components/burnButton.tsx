import { useSimulateContract, useWriteContract } from "wagmi";
import { Button } from "./ui/button";
import abis from "@/constants/abi";
import contracts, { domains } from "@/constants/contracts";
import { useToast } from "./ui/use-toast";
import { LocalTransaction } from "./inputCard";
import { useLocalStorage } from "usehooks-ts";
import { formatUnits, pad } from "viem";
import { writeContract } from "viem/actions";
import { Dispatch, SetStateAction } from "react";

// Big Int????
export default function BurnButton({
  chain,
  amount,
  targetChainId,
  targetAddress,
  onBurn,
}: {
  chain: number;
  amount: BigInt;
  targetChainId: number;
  targetAddress: `0x${string}`;
  onBurn: Dispatch<SetStateAction<boolean>>;
}) {
  const { writeContract } = useWriteContract();
  const [transactions, setTransactions] = useLocalStorage<
    Array<LocalTransaction>
  >("txs", []);
  const { toast } = useToast();

  const { isSuccess, error } = useSimulateContract({
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

  return (
    <div>
      {isSuccess ? (
        <Button
          className="w-full"
          onClick={() =>
            isSuccess &&
            writeContract(
              {
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
              },
              {
                onSuccess(data: any) {
                  console.log(data);
                  console.log("Successful Write: ", data);
                  setTransactions([
                    ...transactions,
                    {
                      date: new Date(),
                      // @ts-ignore
                      amount: formatUnits(amount, 6),
                      originChain: chain,
                      targetChain: targetChainId,
                      hash: data,
                      status: "pending",
                    },
                  ]);
                  onBurn(true);
                },
              }
            )
          }
        >
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
