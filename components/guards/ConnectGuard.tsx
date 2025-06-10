import { useConnectModal } from "@rainbow-me/rainbowkit";
import React from "react";
import { useAccount } from "wagmi";
import { Button } from "../ui/button";

type Props = {
  children?: React.ReactNode;
};

export default function ConnectGuard(props: Props) {
  const { address, isConnected } = useAccount();
  return <div>{isConnected ? props.children : <ConnectButton />}</div>;
}

const ConnectButton: React.FC<{ smol?: boolean }> = ({ smol }) => {
  const { openConnectModal } = useConnectModal();
  return (
    <>
      <Button
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3"
        onClick={() => openConnectModal && openConnectModal()}
      >
        Connect Wallet
      </Button>
    </>
  );
};
