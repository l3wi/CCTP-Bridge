"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Zap, ArrowRight, Loader2 } from "lucide-react";
import { BridgingState } from "@/components/new/bridging-state";
import { Skeleton } from "@/components/ui/skeleton";
import Image from "next/image";
import contracts, {
  getChainsFromId,
  isV2Supported,
  getContracts,
} from "@/constants/contracts";
import { useAccount, useChains, useSwitchChain } from "wagmi";
import { Chain } from "viem";
import { validateBridgeParams } from "@/lib/validation";
import { getErrorMessage } from "@/lib/errors";
import { AmountState, BridgeSummaryState, LocalTransaction } from "@/lib/types";
import { useBridge } from "@/lib/hooks/useBridge";
import { useBalance } from "@/lib/hooks/useBalance";
import { blockConfirmations } from "@/constants/endpoints";
import { useToast } from "@/components/ui/use-toast";
import {
  LoadingButton,
  BalanceLoader,
  ChainSelectorSkeleton,
} from "@/components/loading/LoadingStates";
import ConnectGuard from "@/components/guards/ConnectGuard";
import ApproveGuard from "@/components/guards/ApproveGuard";
import FastTransferAllowanceGuard from "@/components/guards/FastTransferAllowanceGuard";

interface BridgeCardProps {
  onBurn?: (value: boolean) => void;
  loadedTransaction?: LocalTransaction | null;
  onBackToNew?: () => void;
}

export function BridgeCard({
  onBurn,
  loadedTransaction,
  onBackToNew,
}: BridgeCardProps) {
  // Hooks
  const { address, chain } = useAccount();
  const { toast } = useToast();
  const chains = useChains();
  const { switchChain } = useSwitchChain();
  const { burn, isLoading: isBridgeLoading } = useBridge();
  const {
    usdcBalance,
    usdcFormatted,
    isUsdcLoading,
    hasSufficientBalance,
    needsApproval,
  } = useBalance();

  // State
  const [targetChain, setTargetChain] = useState<Chain | null>(null);
  const [amount, setAmount] = useState<AmountState | null>(null);
  const [fastTransfer, setFastTransfer] = useState(false);
  const [diffWallet, setDiffWallet] = useState(false);
  const [targetAddress, setTargetAddress] = useState<string | undefined>(
    undefined
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isBridging, setIsBridging] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isSwitchingChain, setIsSwitchingChain] = useState(false);
  const [loadedTransactionData, setLoadedTransactionData] = useState<{
    fromChain: { value: string; label: string; color: string };
    toChain: { value: string; label: string; color: string };
    amount: string;
    estimatedTime: number;
  } | null>(null);
  const [bridgeTransactionHash, setBridgeTransactionHash] = useState<
    `0x${string}` | null
  >(null);

  // Memoized values
  const usableChains = useMemo(
    () => (chain && chains ? getChainsFromId(chain.id, chains) : null),
    [chain, chains]
  );

  const availableChains = useMemo(
    () => usableChains?.filter((c) => c && c.id !== chain?.id) || [],
    [usableChains, chain?.id]
  );

  // All supported chains for "From" selector
  const supportedChains = useMemo(() => {
    const supportedChainIds = Object.keys(contracts).map(Number);
    return chains.filter((c) => supportedChainIds.includes(c.id));
  }, [chains]);

  const chainOptions = useMemo(() => {
    return availableChains
      .filter((c): c is Chain => c != null)
      .map((c) => ({
        value: c.id.toString(),
        label: c.name,
        color: getChainColor(c.id),
        id: c.id,
        chain: c,
      }));
  }, [availableChains]);

  const sourceChainOptions = useMemo(() => {
    return supportedChains.map((c) => ({
      value: c.id.toString(),
      label: c.name,
      color: getChainColor(c.id),
      id: c.id,
      chain: c,
    }));
  }, [supportedChains]);

  function getChainColor(chainId: number): string {
    const colorMap: Record<number, string> = {
      42161: "bg-blue-500", // Arbitrum
      43114: "bg-red-500", // Avalanche
      8453: "bg-blue-600", // Base
      137: "bg-purple-500", // Polygon
    };
    return colorMap[chainId] || "bg-gray-500";
  }

  // Handle amount change with validation
  const handleAmountChange = useCallback(
    (inputStr: string) => {
      try {
        // Clean the input string
        const cleanStr = inputStr.replace(/[^0-9.]/g, "");

        if (cleanStr === "") {
          setAmount(null);
          return;
        }

        // Basic format validation
        const decimalCount = (cleanStr.match(/\./g) || []).length;
        if (decimalCount > 1) {
          toast({
            title: "Invalid Format",
            description: "Please enter a valid number",
            variant: "destructive",
          });
          return;
        }

        // Check decimal places
        if (cleanStr.includes(".")) {
          const decimalPart = cleanStr.split(".")[1];
          if (decimalPart && decimalPart.length > 6) {
            toast({
              title: "Too Many Decimals",
              description: "Maximum 6 decimal places allowed",
              variant: "destructive",
            });
            return;
          }
        }

        try {
          // Convert to BigInt for validation
          let divisor = BigInt(1);
          for (let i = 0; i < 6; i++) {
            divisor = divisor * BigInt(10);
          }
          const [integerPart, decimalPart = ""] = cleanStr.split(".");
          const paddedDecimal = decimalPart.padEnd(6, "0");
          const bigIntValue = BigInt(integerPart + paddedDecimal);

          setAmount({
            str: cleanStr,
            bigInt: bigIntValue,
          });
        } catch (error) {
          console.error("Amount parsing error:", error);
          toast({
            title: "Invalid Amount",
            description: "Please enter a valid number",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error("Amount validation error:", error);
        toast({
          title: "Error",
          description: getErrorMessage(error),
          variant: "destructive",
        });
      }
    },
    [toast]
  );

  // Validation
  const validation = useMemo(
    () =>
      validateBridgeParams({
        amount,
        targetChain: targetChain?.id || null,
        targetAddress,
        sourceChain: chain?.id,
        balance: usdcBalance,
        isCustomAddress: diffWallet,
        userAddress: address,
      }),
    [
      amount,
      targetChain?.id,
      targetAddress,
      chain?.id,
      usdcBalance,
      diffWallet,
      address,
    ]
  );

  const handleMaxAmount = () => {
    if (usdcFormatted) {
      handleAmountChange(usdcFormatted);
    }
  };

  const handleSwitchChain = async (chainId: string) => {
    try {
      setIsSwitchingChain(true);
      const targetChainId = parseInt(chainId);
      await switchChain({ chainId: targetChainId });
    } catch (error) {
      console.error("Failed to switch chain:", error);
      toast({
        title: "Chain Switch Failed",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    } finally {
      setIsSwitchingChain(false);
    }
  };

  const handleSwapChains = () => {
    // For now, just swap between first two available chains
    if (availableChains.length >= 2) {
      const validChains = availableChains.filter((c): c is Chain => c != null);
      const currentIndex = validChains.findIndex(
        (c) => c.id === targetChain?.id
      );
      const nextIndex =
        currentIndex === -1 ? 0 : (currentIndex + 1) % validChains.length;
      setTargetChain(validChains[nextIndex] || null);
    }
  };

  const handleSend = useCallback(async () => {
    if (
      !validation.isValid ||
      !validation.data ||
      !chain ||
      !targetChain ||
      !amount
    ) {
      return;
    }

    setIsLoading(true);

    try {
      const finalTargetAddress = diffWallet
        ? validation.data.targetAddress
        : (address as `0x${string}`);

      const sourceSupportsV2 = isV2Supported(chain.id);
      const targetSupportsV2 = isV2Supported(targetChain.id);
      const supportsV2 = sourceSupportsV2 && targetSupportsV2;

      const version = supportsV2 ? "v2" : "v1";
      const transferType = fastTransfer && supportsV2 ? "fast" : "standard";

      const bridgeParams: any = {
        amount: validation.data.amount,
        sourceChainId: chain.id,
        targetChainId: validation.data.targetChain,
        targetAddress: validation.data.targetAddress,
        sourceTokenAddress: contracts[chain.id].Usdc,
        version,
        transferType,
      };

      // Add fee for fast transfers if applicable
      if (version === "v2" && transferType === "fast") {
        // Note: This is a placeholder implementation
        // For production, you should fetch the actual fee from the API like in the main bridge-card.tsx
        const placeholderFeeBPS = 10; // 0.1% fee
        const feeAmount =
          (validation.data.amount * BigInt(placeholderFeeBPS)) / BigInt(10000);
        bridgeParams.fee = feeAmount;
      }

      // Capture the transaction hash from the burn operation
      const transactionHash = await burn(bridgeParams);
      if (transactionHash) {
        setBridgeTransactionHash(transactionHash);
      }

      setIsLoading(false);
      setIsBridging(true);

      if (onBurn) {
        onBurn(true);
      }
    } catch (error) {
      console.error("Bridge transaction failed:", error);
      setIsLoading(false);
      setBridgeTransactionHash(null); // Reset on error
      toast({
        title: "Transaction Failed",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  }, [
    validation,
    chain,
    targetChain,
    amount,
    diffWallet,
    address,
    fastTransfer,
    burn,
    onBurn,
    toast,
  ]);

  const handleBackToNew = () => {
    setIsBridging(false);
    setIsLoading(false);
    setLoadedTransactionData(null);
    setBridgeTransactionHash(null); // Reset bridge transaction hash
    // Call parent callback to reset loaded transaction
    if (onBackToNew) {
      onBackToNew();
    }
  };

  // Calculate estimated values
  const estimatedTime = useMemo(() => {
    if (!chain || !targetChain) return "~15m";

    const sourceSupportsV2 = isV2Supported(chain.id);
    const targetSupportsV2 = isV2Supported(targetChain.id);
    const supportsV2 = sourceSupportsV2 && targetSupportsV2;

    if (fastTransfer && supportsV2) {
      return (
        blockConfirmations.fast[
          chain.id as keyof typeof blockConfirmations.fast
        ]?.time || "~8-20s"
      );
    }
    return (
      blockConfirmations.standard[
        chain.id as keyof typeof blockConfirmations.standard
      ]?.time || "~15m"
    );
  }, [chain, targetChain, fastTransfer]);

  const bridgeFee = useMemo(() => {
    if (!amount) return "0.000000";
    const fee = fastTransfer ? 0.0001 : 0.00005; // Example fees
    return (Number.parseFloat(amount.str) * fee).toFixed(6);
  }, [amount, fastTransfer]);

  const youWillReceive = useMemo(() => {
    if (!amount) return "0.000000";
    return (
      Number.parseFloat(amount.str) - Number.parseFloat(bridgeFee)
    ).toFixed(6);
  }, [amount, bridgeFee]);

  // Memoized spender address for ApproveGuard
  const spenderAddress = useMemo(() => {
    if (!chain || !targetChain) return undefined;
    const version =
      isV2Supported(chain.id) && isV2Supported(targetChain.id) ? "v2" : "v1";
    const contractSet = getContracts(chain.id, version);
    return contractSet?.TokenMessenger as `0x${string}`;
  }, [chain?.id, targetChain?.id]);

  // Effect to handle loaded transaction from history
  useEffect(() => {
    if (loadedTransaction && loadedTransaction.status === "pending") {
      // Find the chains for the transaction
      const originChain = chains.find(
        (c) => c.id === loadedTransaction.originChain
      );
      const targetChainData = chains.find(
        (c) => c.id === loadedTransaction.targetChain
      );

      if (originChain && targetChainData && loadedTransaction.amount) {
        const fromChain = {
          value: originChain.id.toString(),
          label: originChain.name,
          color: getChainColor(originChain.id),
        };
        const toChain = {
          value: targetChainData.id.toString(),
          label: targetChainData.name,
          color: getChainColor(targetChainData.id),
        };

        // Calculate estimated time based on transaction details
        const version = loadedTransaction.version || "v1";
        const transferType = loadedTransaction.transferType || "standard";
        let estimatedTime = 900; // 15 minutes default

        if (version === "v2" && transferType === "fast") {
          estimatedTime = 30; // 30 seconds for fast transfers
        } else if (version === "v2") {
          estimatedTime = 60; // 1 minute for v2 standard
        }

        setLoadedTransactionData({
          fromChain,
          toChain,
          amount: loadedTransaction.amount,
          estimatedTime,
        });
        setIsBridging(true);
      }
    }
  }, [loadedTransaction, chains]);

  // Effect to handle target chain updates when source chain changes
  useEffect(() => {
    if (chain && targetChain && chain.id === targetChain.id) {
      // If target chain is same as source, select the first available different chain
      const firstDifferentChain = availableChains.find(
        (c) => c && c.id !== chain.id
      );
      setTargetChain(firstDifferentChain || null);
    }
  }, [chain?.id, targetChain, availableChains]);

  // Loading states
  const showChainLoader = !chain || !chains.length;
  const showBalanceLoader = isUsdcLoading && !!address && !!chain;

  if (isBridging) {
    // Use loaded transaction data if available, otherwise use form data
    if (loadedTransactionData && loadedTransaction) {
      // Find the destination chain object for loaded transaction
      const destinationChain = chains.find(
        (c) => c.id === loadedTransaction.targetChain
      );

      return (
        <BridgingState
          fromChain={loadedTransactionData.fromChain}
          toChain={loadedTransactionData.toChain}
          amount={loadedTransactionData.amount}
          estimatedTime={loadedTransactionData.estimatedTime}
          onViewHistory={() => setHistoryOpen(true)}
          onBack={handleBackToNew}
          // Required props for attestation fetching
          hash={loadedTransaction.hash}
          originChainId={loadedTransaction.originChain}
          destinationChain={destinationChain}
          version={loadedTransaction.version || "v2"}
        />
      );
    } else if (targetChain && amount && bridgeTransactionHash && chain) {
      const fromChain = {
        value: chain.id.toString(),
        label: chain.name,
        color: getChainColor(chain.id),
      };
      const toChain = {
        value: targetChain.id.toString(),
        label: targetChain.name,
        color: getChainColor(targetChain.id),
      };

      // Determine version for current bridge
      const sourceSupportsV2 = isV2Supported(chain.id);
      const targetSupportsV2 = isV2Supported(targetChain.id);
      const supportsV2 = sourceSupportsV2 && targetSupportsV2;
      const version = supportsV2 ? "v2" : "v1";

      return (
        <BridgingState
          fromChain={fromChain}
          toChain={toChain}
          amount={amount.str}
          estimatedTime={fastTransfer ? 8 : 900}
          onViewHistory={() => setHistoryOpen(true)}
          onBack={handleBackToNew}
          // Required props for attestation fetching
          hash={bridgeTransactionHash}
          originChainId={chain.id}
          destinationChain={targetChain}
          version={version}
        />
      );
    }
  }

  return (
    <>
      <Card className="bg-gradient-to-br from-slate-800/95 via-slate-800/98 to-slate-900/100 backdrop-blur-sm border-slate-700/50 text-white">
        <CardContent className="p-6 space-y-6">
          {/* Chain Selectors */}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <Label className="text-sm text-slate-300 mb-2 block">From</Label>
              {showChainLoader ? (
                <ChainSelectorSkeleton />
              ) : (
                <Select
                  value={chain?.id.toString() || ""}
                  onValueChange={handleSwitchChain}
                  disabled={isLoading || isSwitchingChain}
                >
                  <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white">
                    <SelectValue placeholder="Select Chain...">
                      {chain && (
                        <div className="flex items-center gap-2">
                          {isSwitchingChain ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Image
                              src={`/${chain.id}.svg`}
                              width={16}
                              height={16}
                              className="w-4 h-4"
                              alt={chain.name}
                            />
                          )}
                          <span>{chain.name}</span>
                          {isSwitchingChain && (
                            <span className="text-xs text-slate-400 ml-auto">
                              Switching...
                            </span>
                          )}
                        </div>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {sourceChainOptions.map((chainOption) => (
                      <SelectItem
                        key={chainOption.value}
                        value={chainOption.value}
                        className="text-white hover:bg-slate-700"
                      >
                        <div className="flex items-center gap-2">
                          <Image
                            src={`/${chainOption.id}.svg`}
                            width={16}
                            height={16}
                            className="w-4 h-4"
                            alt={chainOption.label}
                          />
                          <span>{chainOption.label}</span>
                          {/* Show current chain indicator */}
                          {chain?.id === chainOption.id && (
                            <span
                              className="ml-auto text-green-500"
                              title="Current chain"
                            >
                              ●
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="flex justify-center pt-6">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleSwapChains}
                className="rounded-full bg-slate-700/50 hover:bg-slate-600/50 border border-slate-600 h-8 w-8"
                disabled={isLoading || availableChains.length < 2}
              >
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1">
              <Label className="text-sm text-slate-300 mb-2 block">To</Label>
              {showChainLoader ? (
                <ChainSelectorSkeleton />
              ) : (
                <Select
                  value={targetChain?.id.toString() || ""}
                  onValueChange={(value) => {
                    const selectedChain = availableChains.find(
                      (c) => c?.id.toString() === value
                    );
                    setTargetChain(selectedChain || null);
                  }}
                  disabled={isLoading}
                >
                  <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white">
                    <SelectValue placeholder="Select Chain..." />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {chainOptions.map((chainOption) => (
                      <SelectItem
                        key={chainOption.value}
                        value={chainOption.value}
                        className="text-white hover:bg-slate-700"
                      >
                        <div className="flex items-center gap-2">
                          <Image
                            src={`/${chainOption.id}.svg`}
                            width={16}
                            height={16}
                            className="w-4 h-4"
                            alt={chainOption.label}
                          />
                          <span>{chainOption.label}</span>
                          {/* Show lightning bolt if both chains support V2 */}
                          {chain &&
                            isV2Supported(chain.id) &&
                            isV2Supported(chainOption.id) && (
                              <span
                                className="ml-auto text-yellow-500"
                                title="Fast transfers available"
                              >
                                ⚡
                              </span>
                            )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {/* Amount Input */}
          <div className="bg-slate-900/50 rounded-lg p-6">
            <div className="flex justify-between items-center mb-4">
              <Label className="text-sm text-slate-300">Amount</Label>
              <div className="flex items-center gap-2">
                {showBalanceLoader ? (
                  <BalanceLoader />
                ) : (
                  <span className="text-sm text-slate-400">
                    {usdcFormatted ? `Balance: ${usdcFormatted}` : ""}
                  </span>
                )}
                <LoadingButton
                  variant="ghost"
                  onClick={handleMaxAmount}
                  className="text-xs text-blue-400 hover:text-blue-300 h-6 px-2"
                  disabled={!usdcFormatted || isLoading}
                  isLoading={false}
                >
                  Max
                </LoadingButton>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Input
                value={amount?.str || ""}
                onChange={(e) => handleAmountChange(e.target.value)}
                className="bg-transparent border-none text-2xl font-semibold p-0 h-auto focus-visible:ring-0 flex-1"
                placeholder="0.0"
                disabled={isLoading}
              />
              <span className="text-lg text-slate-400">USDC</span>
            </div>
          </div>

          {/* Custom Address Option */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="custom-address"
              checked={diffWallet}
              onCheckedChange={(checked) => {
                if (checked) {
                  setDiffWallet(true);
                  setTargetAddress(address);
                } else {
                  setDiffWallet(false);
                  setTargetAddress(undefined);
                }
              }}
              disabled={isLoading}
            />
            <Label htmlFor="custom-address" className="text-sm text-slate-300">
              Send USDC to a different wallet
              {targetChain && ` on ${targetChain.name}`}?
            </Label>
          </div>

          {diffWallet && (
            <div className="space-y-2">
              <Label className="text-sm text-slate-300">
                Destination Wallet
              </Label>
              <Input
                placeholder="0x..."
                value={targetAddress || ""}
                onChange={(e) => setTargetAddress(e.target.value)}
                className="bg-slate-700/50 border-slate-600 text-white"
                disabled={isLoading}
              />
            </div>
          )}

          {/* Send Button */}
          <ConnectGuard>
            {chain && amount && targetChain ? (
              <ApproveGuard
                token={contracts[chain.id]?.Usdc as `0x${string}`}
                spender={spenderAddress!}
                amount={amount.bigInt}
              >
                <FastTransferAllowanceGuard
                  transferAmount={amount.str}
                  isEnabled={
                    fastTransfer &&
                    isV2Supported(chain.id) &&
                    isV2Supported(targetChain.id)
                  }
                >
                  <LoadingButton
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3"
                    onClick={handleSend}
                    isLoading={isLoading || isBridgeLoading}
                    disabled={
                      !validation.isValid || isLoading || isBridgeLoading
                    }
                  >
                    {validation.isValid
                      ? "Bridge USDC"
                      : validation.errors[0] || "Complete the form"}
                  </LoadingButton>
                </FastTransferAllowanceGuard>
              </ApproveGuard>
            ) : (
              <LoadingButton
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3"
                onClick={handleSend}
                isLoading={isLoading || isBridgeLoading}
                disabled={!validation.isValid || isLoading || isBridgeLoading}
              >
                {validation.isValid
                  ? "Bridge USDC"
                  : validation.errors[0] || "Complete the form"}
              </LoadingButton>
            )}
          </ConnectGuard>

          {/* Bridge Summary */}
          <div className="space-y-3 pt-2 border-t border-slate-700/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-yellow-400" />
                <Label htmlFor="fast-transfer" className="text-sm">
                  Fast Transfer
                </Label>
              </div>
              <Switch
                id="fast-transfer"
                checked={fastTransfer}
                onCheckedChange={setFastTransfer}
                disabled={
                  isLoading ||
                  !chain ||
                  !targetChain ||
                  !isV2Supported(chain?.id || 0) ||
                  !isV2Supported(targetChain?.id || 0)
                }
              />
            </div>

            {isLoading ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Recipient address</span>
                  <Skeleton className="h-4 w-24 bg-slate-700" />
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Time spend</span>
                  <Skeleton className="h-4 w-16 bg-slate-700" />
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Transaction fees</span>
                  <Skeleton className="h-4 w-20 bg-slate-700" />
                </div>
                <div className="flex justify-between font-medium">
                  <span className="text-slate-300">You will receive</span>
                  <Skeleton className="h-4 w-24 bg-slate-700" />
                </div>
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Recipient address</span>
                  <span className="text-slate-300">
                    {diffWallet && targetAddress
                      ? `${targetAddress.slice(0, 6)}...${targetAddress.slice(
                          -4
                        )}`
                      : address
                      ? `${address.slice(0, 6)}...${address.slice(-4)}`
                      : "Not connected"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Time spend</span>
                  <span className="text-slate-300">{estimatedTime}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Transaction fees</span>
                  <span className="text-slate-300">{bridgeFee} USDC</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span className="text-slate-300">You will receive</span>
                  <span className="text-white">{youWillReceive} USDC</span>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
