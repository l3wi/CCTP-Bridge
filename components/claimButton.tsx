import { Button } from "./ui/button";
import { Dispatch, SetStateAction, useEffect, useState } from "react";
import abis from "@/constants/abi";
import contracts, { domains } from "@/constants/contracts";
import { useToast } from "./ui/use-toast";
import { LocalTransaction } from "@/lib/types";
import { ToastAction } from "@radix-ui/react-toast";
import { explorers } from "@/constants/endpoints";
import { Chain, fromHex, slice } from "viem";
import {
  useAccount,
  useSimulateContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { useTransactionStore } from "@/lib/store/transactionStore";

export const SwitchGuard = ({
  bytes,
  hash,
  children,
}: {
  bytes: `0x${string}`;
  hash?: string;
  children: React.ReactNode;
}) => {
  const { chain } = useAccount();
  const { switchChain } = useSwitchChain();
  const { transactions } = useTransactionStore();

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

  // Check if transaction is already claimed
  const transaction = hash ? transactions.find((t) => t.hash === hash) : null;
  const isAlreadyClaimed =
    transaction && transaction.status === "claimed" && transaction.claimHash;

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

  // If already claimed, show View TX button
  if (isAlreadyClaimed && transaction?.claimHash && transaction?.targetChain) {
    return (
      <Button
        className=""
        onClick={() => {
          window.open(
            explorers[transaction.targetChain!] +
              `/tx/${transaction.claimHash}`,
            "_blank"
          );
        }}
      >
        View TX
      </Button>
    );
  }

  if (chain && chain.id !== destination) {
    return (
      <Button className="" onClick={() => initiateSwitch()}>
        Switch Chain
      </Button>
    );
  } else if (chain && chain.id === destination) {
    return children;
  } else {
    return <Button disabled>Switch Chain</Button>;
  }
};

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
  const { transactions, updateTransaction } = useTransactionStore();
  const [alreadyClaimed, setAlreadyClaimed] = useState(false);
  const [errorProcessed, setErrorProcessed] = useState(false);
  const { toast } = useToast();
  const { chain } = useAccount();

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

  // Check if transaction is already claimed from store
  useEffect(() => {
    const transaction = transactions.find((t) => t.hash === hash);
    if (transaction && transaction.status === "claimed") {
      setAlreadyClaimed(true);
    }
  }, [transactions, hash]);

  const { writeContract } = useWriteContract();
  const { isSuccess, error } = useSimulateContract({
    address: contracts[chain ? chain.id : 1].MessageTransmitter,
    abi: abis["MessageTransmitter"],
    functionName: "receiveMessage",
    args: [bytes, attestation],
    query: {
      enabled: !alreadyClaimed, // Don't simulate if already claimed
    },
  });

  // Handle nonce already used error
  useEffect(() => {
    if (
      error &&
      !errorProcessed &&
      error.message.includes("Nonce already used")
    ) {
      console.log("Nonce already used error detected");

      toast({
        title: "You have already claimed your USDC!",
        description:
          "Please check your wallet to ensure the tokens have arrived.",
      });

      // Update transaction in store
      updateTransaction(hash as `0x${string}`, {
        targetChain: destination,
        status: "claimed",
      });

      setAlreadyClaimed(true);
      setErrorProcessed(true);
      onBurn(false);
    }
  }, [
    error,
    errorProcessed,
    toast,
    updateTransaction,
    hash,
    destination,
    onBurn,
  ]);

  const claim = async () => {
    if (alreadyClaimed) return;

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

              // Update transaction in store
              updateTransaction(hash as `0x${string}`, {
                claimHash: data,
                targetChain: destination,
                status: "claimed",
              });

              setAlreadyClaimed(true);
              console.log("TX Finalized");
              onBurn(false);
            },
          }
        );
    } catch (error) {
      console.log(error);
    }
  };

  if (alreadyClaimed) {
    return (
      <Button className="" disabled>
        Already Claimed
      </Button>
    );
  }

  return (
    <Button className="" onClick={() => claim()}>
      Claim USDC
    </Button>
  );
}
