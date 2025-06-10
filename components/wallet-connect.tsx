"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useDisconnect } from "wagmi";
import { Button } from "@/components/ui/button";
import { Wallet } from "lucide-react";

export function WalletConnect() {
  const { disconnect } = useDisconnect();

  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openConnectModal,
        authenticationStatus,
        mounted,
      }) => {
        const ready = mounted && authenticationStatus !== "loading";
        const connected =
          ready &&
          account &&
          chain &&
          (!authenticationStatus || authenticationStatus === "authenticated");

        return (
          <div
            {...(!ready && {
              "aria-hidden": true,
              style: {
                opacity: 0,
                pointerEvents: "none",
                userSelect: "none",
              },
            })}
          >
            {(() => {
              if (!connected) {
                return (
                  <Button
                    onClick={openConnectModal}
                    variant="outline"
                    className="bg-slate-800/50 border-slate-700 text-white hover:bg-slate-700/50"
                  >
                    <Wallet className="h-4 w-4 mr-2" />
                    Connect
                  </Button>
                );
              }

              // Show ENS name or shortened address when connected
              const displayName =
                account.ensName ||
                `${account.address.slice(0, 6)}...${account.address.slice(-4)}`;

              return (
                <Button
                  onClick={() => disconnect()}
                  variant="outline"
                  className="bg-slate-800/50 border-slate-700 text-white hover:bg-slate-700/50"
                >
                  <Wallet className="h-4 w-4 mr-2" />
                  {displayName}
                </Button>
              );
            })()}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
