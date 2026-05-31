import type { UseWalletClientReturnType } from "wagmi";
import { createEvmPublicClient } from "@/lib/rpc/clients";
import { fetchAttestationUniversal, isCompleteAttestationData } from "@/lib/iris";
import { simulateMint, extractDestinationDomainFromMessage } from "@/lib/simulation";
import {
  getMessageTransmitterAddress,
  MESSAGE_TRANSMITTER_ABI,
} from "@/lib/contracts";
import { getExplorerTxUrl } from "@/lib/bridgeConfig";
import { getCctpDomainSafe } from "../../shared";
import { updateStepsWithMint } from "../../steps";
import type { ChainId, MintParams, MintResult, UniversalTxHash } from "../../types";
import { estimateEvmMintGas, formatNative } from "../../gasEstimation";
import {
  ALREADY_CLAIMED_TOAST_DESCRIPTION,
  ALREADY_CLAIMED_TOAST_TITLE,
  handleEvmMintError,
  type ToastFn,
  type UpdateTransactionFn,
} from "./errors";

type EvmWalletClient = NonNullable<UseWalletClientReturnType["data"]>;

async function isSmartContractAccount(params: {
  publicClient: ReturnType<typeof createEvmPublicClient>;
  address: `0x${string}`;
}): Promise<boolean> {
  const getCode = (params.publicClient as {
    getCode?: (args: { address: `0x${string}` }) => Promise<`0x${string}` | undefined>;
  }).getCode;

  if (!getCode) return false;

  try {
    const code = await getCode({ address: params.address });
    return typeof code === "string" && code !== "0x";
  } catch (error) {
    console.warn("Unable to determine wallet account type, keeping gas balance preflight:", error);
    return false;
  }
}

export async function executeEvmMint(params: {
  burnTxHash: UniversalTxHash;
  sourceChainId: ChainId;
  destinationChainId: number;
  existingSteps?: MintParams["existingSteps"];
  userNativeBalance?: bigint;
  walletClient: EvmWalletClient | undefined;
  updateTransaction: UpdateTransactionFn;
  toast: ToastFn;
}): Promise<MintResult> {
  const {
    burnTxHash,
    sourceChainId,
    destinationChainId,
    existingSteps,
    userNativeBalance,
    walletClient,
    updateTransaction,
    toast,
  } = params;

  if (!walletClient) {
    return { success: false, error: "EVM wallet not connected" };
  }

  const publicClient = createEvmPublicClient(destinationChainId, { walletClient });
  const messageTransmitter = getMessageTransmitterAddress(destinationChainId);
  if (!messageTransmitter) {
    return {
      success: false,
      error: `No MessageTransmitter for chain ${destinationChainId}`,
    };
  }

  let evmAttestationNonce: string | undefined;

  try {
    const attestationData = await fetchAttestationUniversal(
      sourceChainId,
      burnTxHash
    );

    if (!attestationData) {
      return {
        success: false,
        error: "Attestation not found. Please wait for Circle to process the burn.",
      };
    }

    if (!isCompleteAttestationData(attestationData)) {
      if (attestationData.status !== "complete") {
        return {
          success: false,
          error: "Attestation not ready yet. Please wait a few more minutes.",
        };
      }

      return {
        success: false,
        error: "Attestation payload is incomplete. Please try again.",
      };
    }

    evmAttestationNonce = attestationData.nonce;

    try {
      const messageDomain = extractDestinationDomainFromMessage(attestationData.message);
      const expectedDomain = getCctpDomainSafe(destinationChainId);

      if (expectedDomain !== null && messageDomain !== expectedDomain) {
        console.error(
          `[useMint] Domain mismatch detected!\n` +
          `  Message destination domain: ${messageDomain}\n` +
          `  Target chain ${destinationChainId} domain: ${expectedDomain}\n` +
          `  The CCTP message can only be received on the chain with domain ${messageDomain}.\n` +
          `  This indicates the UI is targeting the wrong destination chain.`
        );
        return {
          success: false,
          error: `Wrong destination chain: this transfer was burned for CCTP domain ${messageDomain}, ` +
            `but you are trying to claim on chain ${destinationChainId} (domain ${expectedDomain}). ` +
            `Please switch to the correct chain.`,
        };
      }
    } catch (domainError) {
      console.warn("[useMint] Could not validate destination domain:", domainError);
    }

    const simResult = await simulateMint(
      destinationChainId,
      attestationData.message,
      attestationData.attestation
    );

    if (simResult.alreadyMinted) {
      const updatedSteps = updateStepsWithMint(existingSteps, undefined, true);
      updateTransaction(burnTxHash, {
        status: "claimed",
        bridgeState: "success",
        completedAt: new Date(),
        steps: updatedSteps,
      });

      toast({
        title: ALREADY_CLAIMED_TOAST_TITLE,
        description: ALREADY_CLAIMED_TOAST_DESCRIPTION,
      });

      return { success: true, alreadyMinted: true };
    }

    if (!simResult.canMint) {
      if (simResult.messageExpired) {
        return {
          success: false,
          messageExpired: true,
          nonce: attestationData.nonce,
          error: "Message expired - please request re-attestation",
        };
      }

      return {
        success: false,
        error: simResult.error || "Simulation failed - mint may not be ready",
      };
    }

    if (publicClient && walletClient?.account?.address && userNativeBalance !== undefined) {
      try {
        const isContractAccount = await isSmartContractAccount({
          publicClient,
          address: walletClient.account.address,
        });

        if (!isContractAccount) {
          const gasEstimate = await estimateEvmMintGas({
            publicClient,
            userAddress: walletClient.account.address,
            messageTransmitter,
            message: attestationData.message,
            attestation: attestationData.attestation,
            userBalance: userNativeBalance,
          });

          if (!gasEstimate.sufficient) {
            const nativeSymbol = walletClient.chain?.nativeCurrency?.symbol || "ETH";
            return {
              success: false,
              error: `Insufficient ${nativeSymbol} for gas. You need ~${formatNative(gasEstimate.required)} ${nativeSymbol} but have ${formatNative(gasEstimate.current)} ${nativeSymbol}.`,
            };
          }
        }
      } catch (gasError) {
        console.warn("Gas estimation failed, proceeding anyway:", gasError);
      }
    }

    toast({
      title: "Claiming USDC",
      description: "Please confirm the transaction in your wallet.",
    });

    const hash = await walletClient.writeContract({
      address: messageTransmitter,
      abi: MESSAGE_TRANSMITTER_ABI,
      functionName: "receiveMessage",
      args: [attestationData.message, attestationData.attestation],
      chain: walletClient.chain,
    });

    toast({
      title: "Transaction Submitted",
      description: "Waiting for confirmation...",
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: 1,
    });

    if (receipt.status === "reverted") {
      return {
        success: false,
        error: "Transaction reverted. The mint may have already been claimed.",
      };
    }

    const updatedSteps = updateStepsWithMint(existingSteps, hash, false);
    const explorerUrl = getExplorerTxUrl(destinationChainId, hash);

    updateTransaction(burnTxHash, {
      claimHash: hash,
      status: "claimed",
      bridgeState: "success",
      completedAt: new Date(),
      steps: updatedSteps,
    });

    toast({
      title: "USDC Claimed!",
      description: explorerUrl
        ? "Your USDC has been minted successfully."
        : `Mint tx: ${hash.slice(0, 10)}...`,
    });

    return { success: true, mintTxHash: hash };
  } catch (error: unknown) {
    return handleEvmMintError(
      error,
      burnTxHash,
      existingSteps,
      updateTransaction,
      toast,
      evmAttestationNonce
    );
  }
}
