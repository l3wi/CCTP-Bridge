import { Button } from "./ui/button";
import { Dispatch, SetStateAction, useEffect, useState } from "react";
import { domains, testnetDomains, getContracts } from "@/constants/contracts";
import { useToast } from "./ui/use-toast";
import { LocalTransaction } from "@/lib/types";
import { ToastAction } from "@radix-ui/react-toast";
import { explorers } from "@/constants/endpoints";
import { Chain, fromHex, slice } from "viem";
import { useAccount, useSimulateContract, useSwitchChain } from "wagmi";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useBridge } from "@/lib/hooks/useBridge";
import { getABI } from "@/constants/abi";

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

  // Find chain ID from domain in both mainnet and testnet domains
  const getChainIdFromDomain = (domain: number): number => {
    // Check mainnet domains first
    const mainnetEntry = Object.entries(domains).find(
      ([chainId, domainId]) => domainId === domain
    );
    if (mainnetEntry) {
      return parseInt(mainnetEntry[0]);
    }

    // Check testnet domains
    const testnetEntry = Object.entries(testnetDomains).find(
      ([chainId, domainId]) => domainId === domain
    );
    if (testnetEntry) {
      return parseInt(testnetEntry[0]);
    }

    return 1; // Default fallback
  };

  const destination = getChainIdFromDomain(destinationDomain);

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
        variant="outline"
        className="w-full border-blue-700 text-white hover:bg-blue-700/50 hover:text-white bg-blue-800"
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
      <Button
        variant="outline"
        className="w-full border-blue-700 text-white hover:bg-blue-700/50 hover:text-white bg-blue-800"
        onClick={() => initiateSwitch()}
        disabled={false}
      >
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
  version = "v1",
  cctpVersion,
  onBurn,
}: {
  hash: string;
  bytes: `0x${string}`;
  attestation: `0x${string}`;
  version?: "v1" | "v2";
  cctpVersion?: number;
  onBurn: Dispatch<SetStateAction<boolean>>;
}) {
  const { transactions, updateTransaction } = useTransactionStore();
  const [alreadyClaimed, setAlreadyClaimed] = useState(false);
  const [errorProcessed, setErrorProcessed] = useState(false);
  const { toast } = useToast();
  const { chain } = useAccount();
  const { claim, isLoading } = useBridge();

  // Determine the correct version to use
  // Priority: cctpVersion from API response > version prop
  const actualVersion: "v1" | "v2" = cctpVersion
    ? cctpVersion === 1
      ? "v1"
      : "v2"
    : version;

  /// Derive Destination ChainID from Bytes
  const destinationDomain = fromHex(
    slice(bytes, 8, 12) as `0x${string}`,
    "number"
  );

  // Find chain ID from domain in both mainnet and testnet domains
  const getChainIdFromDomain = (domain: number): number => {
    // Check mainnet domains first
    const mainnetEntry = Object.entries(domains).find(
      ([chainId, domainId]) => domainId === domain
    );
    if (mainnetEntry) {
      return parseInt(mainnetEntry[0]);
    }

    // Check testnet domains
    const testnetEntry = Object.entries(testnetDomains).find(
      ([chainId, domainId]) => domainId === domain
    );
    if (testnetEntry) {
      return parseInt(testnetEntry[0]);
    }

    return 1; // Default fallback
  };

  const destination = getChainIdFromDomain(destinationDomain);

  // Check if transaction is already claimed from store
  useEffect(() => {
    const transaction = transactions.find((t) => t.hash === hash);
    if (transaction && transaction.status === "claimed") {
      setAlreadyClaimed(true);
    }
  }, [transactions, hash]);

  // Get the appropriate contracts for simulation using detected version
  const contracts = chain ? getContracts(chain.id, actualVersion) : null;

  const { isSuccess, error } = useSimulateContract({
    address: contracts?.MessageTransmitter,
    abi: getABI("MessageTransmitter", actualVersion),
    functionName: "receiveMessage",
    args: [bytes, attestation],
    query: {
      enabled: !alreadyClaimed && !!contracts, // Don't simulate if already claimed or no contracts
    },
  });

  // Handle nonce already used error
  useEffect(() => {
    if (
      error &&
      !errorProcessed &&
      error.message.includes("Nonce already used")
    ) {
      toast({
        title: "You have already claimed your USDC!",
        description:
          "Please check your wallet to ensure the tokens have arrived.",
      });

      // Update transaction in store with the correct version
      updateTransaction(hash as `0x${string}`, {
        targetChain: destination,
        status: "claimed",
        version: actualVersion,
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

  const handleClaim = async () => {
    if (alreadyClaimed || !isSuccess) return;

    try {
      const txHash = await claim(bytes, attestation, actualVersion);

      if (txHash) {
        toast({
          title: "You have successfully claimed your USDC!",
          description:
            "Please check your wallet to ensure the tokens have arrived.",
          action: (
            <ToastAction
              onClick={() => {
                chain && txHash
                  ? window.open(explorers[chain.id] + `/tx/${txHash}`)
                  : null;
              }}
              altText="View"
            >
              View
            </ToastAction>
          ),
        });

        // Update transaction in store with the correct version
        updateTransaction(hash as `0x${string}`, {
          claimHash: txHash,
          targetChain: destination,
          status: "claimed",
          version: actualVersion,
        });

        setAlreadyClaimed(true);
        onBurn(false);
      }
    } catch (error) {
      console.error("Claim failed:", error);
      toast({
        title: "Claim Failed",
        description: "Please try again or check your connection.",
        variant: "destructive",
      });
    }
  };

  if (alreadyClaimed) {
    return (
      <Button
        variant="outline"
        className="w-full border-blue-700 text-white hover:bg-blue-700/50 hover:text-white bg-blue-800"
        disabled
      >
        Already Claimed
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      className="w-full border-blue-700 text-white hover:bg-blue-700/50 hover:text-white bg-blue-800"
      onClick={handleClaim}
      disabled={isLoading || !isSuccess}
    >
      {isLoading
        ? "Processing..."
        : `Claim USDC (${actualVersion.toUpperCase()})`}
    </Button>
  );
}
