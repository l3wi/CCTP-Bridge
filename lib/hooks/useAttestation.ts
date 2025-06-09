import { useEffect, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { endpoints } from "@/constants/endpoints";
import { domains, isTestnet } from "@/constants/contracts";
import { Chain } from "viem";
import { withRetry } from "@/lib/errors";
import { CircleAttestationResponse } from "@/lib/types";

interface AttestationData {
  attestation: `0x${string}`;
  message: `0x${string}`;
}

interface UseAttestationOptions {
  enabled?: boolean;
  refetchInterval?: number;
}

export const useAttestation = (
  hash: `0x${string}`,
  originChain: number,
  destinationChain?: Chain,
  options: UseAttestationOptions = {}
) => {
  const { enabled = true, refetchInterval = 10000 } = options;
  const isTestnetEnv = destinationChain && isTestnet(destinationChain);

  const fetchAttestation =
    useCallback(async (): Promise<AttestationData | null> => {
      if (!hash || !originChain) {
        return null;
      }

      const endpoint = endpoints[isTestnetEnv ? "testnet" : "mainnet"];
      const domain = domains[originChain];

      if (domain === undefined) {
        throw new Error(`Unsupported chain: ${originChain}`);
      }

      const response = await withRetry(
        () => fetch(`${endpoint}/messages/${domain}/${hash}`),
        {
          maxRetries: 3,
          baseDelay: 2000,
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch attestation: ${response.statusText}`);
      }

      const data: CircleAttestationResponse = await response.json();

      if (!data.messages || data.messages.length === 0) {
        return null;
      }

      const message = data.messages[0];

      // Check if attestation is ready
      if (message.attestation === "PENDING") {
        return null;
      }

      return {
        attestation: message.attestation as `0x${string}`,
        message: message.message as `0x${string}`,
      };
    }, [hash, originChain, isTestnetEnv]);

  const {
    data: attestationData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["attestation", hash, originChain, isTestnetEnv],
    queryFn: fetchAttestation,
    enabled: enabled && !!hash && !!originChain,
    refetchInterval: (data) => {
      // Stop polling once we have the attestation
      return data ? false : refetchInterval;
    },
    staleTime: 30000, // 30 seconds
    retry: (failureCount, error) => {
      // Don't retry on 404s or other client errors
      if (error instanceof Error && error.message.includes("404")) {
        return false;
      }
      return failureCount < 3;
    },
  });

  return {
    data: attestationData,
    isLoading,
    error: error as Error | null,
    refetch,
    isPending: !attestationData && !error,
  };
};

// Hook for managing multiple attestations
export const useAttestationManager = () => {
  const [attestations, setAttestations] = useState<
    Map<string, AttestationData>
  >(new Map());

  const addAttestation = useCallback((hash: string, data: AttestationData) => {
    setAttestations((prev) => new Map(prev).set(hash, data));
  }, []);

  const getAttestation = useCallback(
    (hash: string) => {
      return attestations.get(hash);
    },
    [attestations]
  );

  const hasAttestation = useCallback(
    (hash: string) => {
      return attestations.has(hash);
    },
    [attestations]
  );

  const clearAttestations = useCallback(() => {
    setAttestations(new Map());
  }, []);

  return {
    addAttestation,
    getAttestation,
    hasAttestation,
    clearAttestations,
    attestationCount: attestations.size,
  };
};
