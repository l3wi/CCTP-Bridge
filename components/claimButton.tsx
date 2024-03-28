import { Button } from "./ui/button";
import { Dispatch, SetStateAction, useEffect } from "react";
import abis from "@/constants/abi";
import contracts, { domains } from "@/constants/contracts";
import { useToast } from "./ui/use-toast";
import { LocalTransaction } from "./inputCard";
import { useLocalStorage } from "usehooks-ts";
import { ToastAction } from "@radix-ui/react-toast";
import { explorers } from "@/constants/endpoints";
import { fromHex, slice } from "viem";
import {
  useAccount,
  useSimulateContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";

export default function ClaimButton({
  hash,
  bytes,
  attestation,
  onBurn,
}: {
  hash: string;
  bytes: `0x${string}`;
  attestation: `0x${string}`;
  onBurn: Dispatch<SetStateAction<boolean>>;
}) {
  const [transactions, setTransactions] = useLocalStorage<
    Array<LocalTransaction>
  >("txs", []);
  const { toast } = useToast();
  const { chain } = useAccount();
  const { switchChain } = useSwitchChain();

  /// Derive Destination ChainID from Bytes
  const destinationDomain = fromHex(
    slice(bytes, 8, 12) as `0x${string}`,
    "number"
  );
  const destination = parseInt(
    (Object.entries(domains).find(
      ([chain, domain]) => domain === destinationDomain
    ) || ["1", 0])[0]
  );

  const { writeContract } = useWriteContract();
  const { isSuccess, error } = useSimulateContract({
    address: contracts[chain ? chain.id : 1].MessageTransmitter,
    abi: abis["MessageTransmitter"],
    functionName: "receiveMessage",
    args: [bytes, attestation],
  });
  if (error) console.log(error);
  if (error?.message.includes("Nonce already used")) {
    toast({
      title: "You have successfully claimed your USDC!",
      description:
        "Please check your wallet to ensure the tokens have arrived.",
    });
    const index = transactions.findIndex((t) => t.status === "pending");
    const newTransactions = [...transactions];
    newTransactions[index] = {
      ...newTransactions[index],
      targetChain: destination,
      status: "claimed",
    };
    setTransactions(newTransactions);
    onBurn(false);
  }

  const initiateSwitch = () =>
    switchChain(
      {
        chainId: destination,
      },
      {
        onSettled(data, error) {
          console.log("Switched", { data, error });
        },
      }
    );

  const claim = async () => {
    try {
      isSuccess &&
        writeContract(
          {
            address: contracts[chain ? chain.id : 1].MessageTransmitter,
            abi: abis["MessageTransmitter"],
            functionName: "receiveMessage",
            args: [bytes, attestation],
          },
          {
            onSuccess(data) {
              toast({
                title: "You have successfully claimed your USDC!",
                description:
                  "Please check your wallet to ensure the tokens have arrived.",
                action: (
                  <ToastAction
                    onClick={() => {
                      chain && data
                        ? window.open(explorers[chain.id] + `/tx/${data}`)
                        : null;
                    }}
                    altText="View"
                  >
                    View
                  </ToastAction>
                ),
              });

              const index = transactions.findIndex((t) => t.hash === hash);
              const newTransactions = [...transactions];
              newTransactions[index] = {
                ...newTransactions[index],
                claimHash: data,
                targetChain: destination,
                status: "claimed",
              };
              setTransactions(newTransactions);
              console.log("TX Finalized");
              onBurn(false);
            },
          }
        );
    } catch (error) {}
  };

  return (
    <div>
      {chain && chain.id !== destination ? (
        <Button className="w-full" onClick={() => initiateSwitch()}>
          Switch Chain
        </Button>
      ) : (
        <Button className="w-full" onClick={() => claim()}>
          Claim USDC
        </Button>
      )}
    </div>
  );
}
