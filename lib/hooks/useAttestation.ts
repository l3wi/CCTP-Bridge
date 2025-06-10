import { useEffect, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { endpoints } from "@/constants/endpoints";
import { domains, testnetDomains, isTestnet } from "@/constants/contracts";
import { Chain } from "viem";
import { CircleAttestationResponse, V2MessageResponse } from "@/lib/types";

interface AttestationData {
  attestation: `0x${string}`;
  message: `0x${string}`;
  cctpVersion?: number;
}

interface UseAttestationOptions {
  enabled?: boolean;
  refetchInterval?: number;
  version?: "v1" | "v2";
}

export const useAttestation = (
  hash: `0x${string}`,
  originChain: number,
  destinationChain?: Chain,
  options: UseAttestationOptions = {}
) => {
  const { enabled = true, refetchInterval = 10000, version = "v1" } = options;
  const isTestnetEnv = destinationChain && isTestnet(destinationChain);

  const fetchAttestation =
    useCallback(async (): Promise<AttestationData | null> => {
      if (!hash || !originChain) {
        return null;
      }

      const endpoint = endpoints[isTestnetEnv ? "testnet" : "mainnet"];
      const domainMap = isTestnetEnv ? testnetDomains : domains;
      const domain = domainMap[originChain];

      if (domain === undefined) {
        throw new Error(`Unsupported chain: ${originChain}`);
      }

      // Use V2 endpoint exclusively as it handles both V1 and V2 messages
      const response = await fetch(
        `${endpoint}/v2/messages/${domain}?transactionHash=${hash}`
      );

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Failed to fetch attestation: ${response.statusText}`);
      }

      const data: V2MessageResponse = await response.json();

      if (!data.messages || data.messages.length === 0) {
        return null;
      }

      const message = data.messages[0];

      if (message.status !== "complete") {
        return null;
      }

      return {
        attestation: message.attestation as `0x${string}`,
        message: message.message as `0x${string}`,
        cctpVersion: message.cctpVersion,
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
      return data ? false : refetchInterval;
    },
    staleTime: 15000,
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes("404")) {
        return false;
      }
      return failureCount < 5;
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
