/**
 * Unified hook for executing CCTP mint transactions.
 * Supports both EVM and Solana destinations.
 */

import { useCallback, useState } from "react";
import { useWalletClient, useBalance } from "wagmi";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useTransactionStore } from "@/lib/store/transactionStore";
import { useToast } from "@/components/ui/use-toast";
import {
  isSolanaChain,
  type MintParams,
  type MintResult,
} from "../types";
import { executeEvmMint } from "./mint/executeEvmMint";
import { executeSolanaMint } from "./mint/executeSolanaMint";

export function useMint() {
  const { data: walletClient } = useWalletClient();
  const { data: evmNativeBalance } = useBalance({
    address: walletClient?.account?.address,
    query: {
      enabled: !!walletClient?.account?.address,
    },
  });

  const solanaWallet = useWallet();
  const { connection } = useConnection();
  const { updateTransaction } = useTransactionStore();
  const { toast } = useToast();
  const [isMinting, setIsMinting] = useState(false);

  const executeMint = useCallback(
    async (params: MintParams): Promise<MintResult> => {
      const { burnTxHash, sourceChainId, destinationChainId, targetAddress, existingSteps } =
        params;

      setIsMinting(true);

      try {
        if (isSolanaChain(destinationChainId)) {
          return await executeSolanaMint({
            burnTxHash,
            sourceChainId,
            destinationChainId,
            targetAddress,
            existingSteps,
            solanaWallet,
            connection,
            updateTransaction,
            toast,
          });
        }

        return await executeEvmMint({
          burnTxHash,
          sourceChainId,
          destinationChainId,
          existingSteps,
          userNativeBalance: evmNativeBalance?.value,
          walletClient,
          updateTransaction,
          toast,
        });
      } finally {
        setIsMinting(false);
      }
    },
    [walletClient, solanaWallet, connection, updateTransaction, toast, evmNativeBalance?.value]
  );

  return {
    executeMint,
    isMinting,
  };
}
