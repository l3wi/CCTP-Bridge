import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useAccount,
  useBalance as useWagmiBalance,
  useReadContract,
} from "wagmi";
import { formatUnits } from "viem";
import contracts from "@/constants/contracts";
import abis from "@/constants/abi";

interface UseBalanceOptions {
  refetchInterval?: number;
  enabled?: boolean;
}

export const useBalance = (options: UseBalanceOptions = {}) => {
  const { address, chain } = useAccount();
  const queryClient = useQueryClient();
  const { refetchInterval = 30000, enabled = true } = options;

  // Get USDC balance
  const {
    data: usdcBalance,
    isLoading: isUsdcLoading,
    error: usdcError,
    refetch: refetchUsdcBalance,
  } = useWagmiBalance({
    address,
    token: chain ? contracts[chain.id]?.Usdc : undefined,
    query: {
      enabled: enabled && !!address && !!chain,
      refetchInterval,
      staleTime: 15000, // 15 seconds
    },
  });

  // Get native token balance
  const {
    data: nativeBalance,
    isLoading: isNativeLoading,
    error: nativeError,
    refetch: refetchNativeBalance,
  } = useWagmiBalance({
    address,
    query: {
      enabled: enabled && !!address && !!chain,
      refetchInterval,
      staleTime: 15000,
    },
  });

  // Get USDC allowance for TokenMessenger
  const {
    data: allowance,
    isLoading: isAllowanceLoading,
    error: allowanceError,
    refetch: refetchAllowance,
  } = useReadContract({
    address: chain ? contracts[chain.id]?.Usdc : undefined,
    abi: abis["Usdc"],
    functionName: "allowance",
    args: [
      address || "0x0000000000000000000000000000000000000000",
      chain
        ? contracts[chain.id]?.TokenMessenger
        : "0x0000000000000000000000000000000000000000",
    ],
    query: {
      enabled: enabled && !!address && !!chain,
      refetchInterval,
      staleTime: 10000, // 10 seconds
    },
  });

  // Optimistically update balance after transactions
  const updateBalanceOptimistically = useCallback(
    (amount: bigint, operation: "subtract" | "add") => {
      if (!usdcBalance || !chain) return;

      const currentBalance = usdcBalance.value;
      const newBalance =
        operation === "subtract"
          ? currentBalance - amount
          : currentBalance + amount;

      // Update the cache optimistically
      queryClient.setQueryData(
        [
          "balance",
          { address, chainId: chain.id, token: contracts[chain.id]?.Usdc },
        ],
        {
          ...usdcBalance,
          value: newBalance,
          formatted: formatUnits(newBalance, usdcBalance.decimals),
        }
      );
    },
    [usdcBalance, chain, address, queryClient]
  );

  // Optimistically update allowance
  const updateAllowanceOptimistically = useCallback(
    (newAllowance: bigint) => {
      if (!chain || !address) return;

      queryClient.setQueryData(
        [
          "readContract",
          {
            address: contracts[chain.id]?.Usdc,
            functionName: "allowance",
            args: [address, contracts[chain.id]?.TokenMessenger],
          },
        ],
        newAllowance
      );
    },
    [chain, address, queryClient]
  );

  const refetchAll = useCallback(async () => {
    await Promise.all([
      refetchUsdcBalance(),
      refetchNativeBalance(),
      refetchAllowance(),
    ]);
  }, [refetchUsdcBalance, refetchNativeBalance, refetchAllowance]);

  return {
    // USDC Balance
    usdcBalance: usdcBalance?.value,
    usdcFormatted: usdcBalance?.formatted,
    usdcDecimals: usdcBalance?.decimals,
    isUsdcLoading,
    usdcError,

    // Native Balance
    nativeBalance: nativeBalance?.value,
    nativeFormatted: nativeBalance?.formatted,
    nativeSymbol: nativeBalance?.symbol,
    isNativeLoading,
    nativeError,

    // Allowance
    allowance: allowance as bigint | undefined,
    isAllowanceLoading,
    allowanceError,

    // Utils
    isLoading: isUsdcLoading || isNativeLoading || isAllowanceLoading,
    hasError: !!usdcError || !!nativeError || !!allowanceError,
    refetchAll,
    updateBalanceOptimistically,
    updateAllowanceOptimistically,

    // Check if user has sufficient balance
    hasSufficientBalance: (amount: bigint) => {
      return usdcBalance?.value ? usdcBalance.value >= amount : false;
    },

    // Check if token is approved for amount
    isApproved: (amount: bigint) => {
      return allowance ? allowance >= amount : false;
    },

    // Check if user needs to approve
    needsApproval: (amount: bigint) => {
      return !allowance || allowance < amount;
    },
  };
};
