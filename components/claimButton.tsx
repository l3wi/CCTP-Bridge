import { useContractWrite, useNetwork, useSwitchNetwork } from "wagmi";
import { Button } from "./ui/button";
import { useEffect } from "react";
import abis from "@/constants/abi";
import contracts from "@/constants/contracts";
import { useToast } from "./ui/use-toast";
import { LocalTransaction } from "./inputCard";
import { useLocalStorage } from "usehooks-ts";
import { ToastAction } from "@radix-ui/react-toast";
import { explorers } from "@/constants/endpoints";

export default function ClaimButton({
  hash,
  destination,
  bytes,
  attestation,
}: {
  hash: string;
  destination: number;
  bytes: `0x${string}`;
  attestation: `0x${string}`;
}) {
  const [transactions, setTransactions] = useLocalStorage<
    Array<LocalTransaction>
  >("txs", []);
  const { toast } = useToast();
  const { chain } = useNetwork();
  const { switchNetwork } = useSwitchNetwork({
    onSettled(data, error) {
      console.log("Switched", { data, error });
      claim();
    },
  });

  const {
    data,
    isLoading: isClaimLoading,
    isSuccess,
    write,
  } = useContractWrite({
    address: contracts[chain ? chain.id : 1].MessageTransmitter,
    abi: abis["MessageTransmitter"],
    functionName: "receiveMessage",
    args: [bytes, attestation],
    onSuccess(data) {
      toast({
        title: "You have successfully claimed your USDC!",
        description:
          "Please check your wallet to ensure the tokens have arrived.",
        action: (
          <ToastAction
            onClick={() => {
              chain && data
                ? window.open(explorers[chain.id] + `/tx/${data.hash}`)
                : null;
            }}
            altText="View TX"
          >
            View TX
          </ToastAction>
        ),
      });

      const index = transactions.findIndex((t) => t.hash === hash);
      const newTransactions = [...transactions];
      newTransactions[index] = {
        ...newTransactions[index],
        claimHash: data.hash,
        status: "claimed",
      };
      setTransactions(newTransactions);
      console.log("TX Finalized");
    },
  });

  const claim = async () => {
    try {
      if (chain && chain.id !== destination) {
        return switchNetwork && switchNetwork(destination);
      }
      write && write();
    } catch (error) {}
  };

  return (
    <div>
      <Button className="w-full" onClick={() => claim()}>
        Claim USDC
      </Button>
    </div>
  );
}
