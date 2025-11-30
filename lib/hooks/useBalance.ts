import { useCallback, useMemo } from "react";
import { useAccount, useBalance as useWagmiBalance } from "wagmi";
import { getUsdcAddressForChain } from "@/lib/bridgeKit";

interface UseBalanceOptions {
  refetchInterval?: number;
  enabled?: boolean;
}

export const useBalance = (options: UseBalanceOptions = {}) => {
  const { address, chain } = useAccount();
  const { refetchInterval = 30000, enabled = true } = options;

  const usdcAddress = useMemo(
    () => (chain ? getUsdcAddressForChain(chain.id) : undefined),
    [chain]
  );

  const {
    data: usdcBalance,
    isLoading: isUsdcLoading,
    error: usdcError,
    refetch: refetchUsdcBalance,
  } = useWagmiBalance({
    address,
    token: usdcAddress,
    query: {
      enabled: enabled && !!address && !!usdcAddress,
      refetchInterval,
      staleTime: 15000, // 15 seconds
    },
  });

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

  const refetchAll = useCallback(async () => {
    await Promise.all([
      refetchUsdcBalance(),
      refetchNativeBalance(),
    ]);
  }, [refetchUsdcBalance, refetchNativeBalance]);

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

    // Utils
    isLoading: isUsdcLoading || isNativeLoading,
    hasError: !!usdcError || !!nativeError,
    refetchAll,

    hasSufficientBalance: (amount: bigint) => {
      return usdcBalance?.value ? usdcBalance.value >= amount : false;
    },
  };
};
