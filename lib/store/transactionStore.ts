import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  LegacyLocalTransaction,
  LegacyV2Transaction,
  LocalTransaction,
  type ChainId,
  type UniversalTxHash,
  getChainType,
} from "@/lib/types";

const DEFAULT_ESTIMATED_TIME_LABEL = "13-19 minutes";

interface TransactionState {
  transactions: LocalTransaction[];
  isLoading: boolean;
  error: string | null;
  addTransaction: (transaction: Omit<LocalTransaction, "date">) => void;
  updateTransaction: (
    hash: UniversalTxHash,
    updates: Partial<LocalTransaction>
  ) => void;
  removeTransaction: (hash: UniversalTxHash) => void;
  clearPendingTransactions: () => void;
  clearAllTransactions: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  migrateFromLegacy: () => void;
}

/**
 * Normalize a transaction to v3 format.
 * Handles both new transactions and migrations from v2.
 */
const normalizeTransaction = (
  tx: Partial<LocalTransaction> | Partial<LegacyV2Transaction> | Partial<LegacyLocalTransaction>
): LocalTransaction => {
  const bridgeResult = (tx as Partial<LocalTransaction>).bridgeResult;

  // Extract chain ID from Bridge Kit chain definition (supports both EVM and Solana)
  const extractChainId = (chain: unknown): ChainId | undefined => {
    if (!chain || typeof chain !== "object") return undefined;

    // EVM chains have numeric chainId
    if ("chainId" in chain) {
      const value = (chain as { chainId?: unknown }).chainId;
      if (typeof value === "number") return value;
    }

    // Solana chains have string 'chain' identifier (e.g., "Solana_Devnet")
    if ("chain" in chain && "type" in chain) {
      const chainObj = chain as { chain?: unknown; type?: unknown };
      if (chainObj.type === "solana" && typeof chainObj.chain === "string") {
        return chainObj.chain as ChainId;
      }
    }

    return undefined;
  };

  const originChain = tx.originChain ?? extractChainId(bridgeResult?.source?.chain) ?? 1;
  const targetChain = tx.targetChain ?? extractChainId(bridgeResult?.destination?.chain);

  // Normalize hash based on chain type
  const normalizeHash = (hash: string, chainId: ChainId): UniversalTxHash => {
    if (getChainType(chainId) === "solana") {
      return hash.trim();
    }
    // EVM: ensure lowercase with 0x prefix
    const cleaned = hash.toLowerCase().trim();
    return cleaned.startsWith("0x") ? cleaned : `0x${cleaned}`;
  };

  const hash = tx.hash
    ? normalizeHash(tx.hash as string, originChain)
    : ("" as UniversalTxHash);

  const claimHash = tx.claimHash && targetChain
    ? normalizeHash(tx.claimHash as string, targetChain)
    : undefined;

  return {
    date: tx.date ? new Date(tx.date) : new Date(),
    originChain,
    hash,
    status: tx.status ?? "pending",
    bridgeState: (tx as Partial<LocalTransaction>).bridgeState ?? bridgeResult?.state,
    steps: (tx as Partial<LocalTransaction>).steps ?? bridgeResult?.steps,
    amount: (tx as Partial<LocalTransaction>).amount ?? bridgeResult?.amount,
    targetChain,
    targetAddress:
      (tx as Partial<LocalTransaction>).targetAddress ??
      (bridgeResult?.destination?.address as string | undefined),
    claimHash,
    version: "v3",
    transferType: (tx as Partial<LocalTransaction>).transferType ?? "standard",
    fee: (tx as Partial<LocalTransaction>).fee,
    estimatedTime: (tx as Partial<LocalTransaction>).estimatedTime ?? DEFAULT_ESTIMATED_TIME_LABEL,
    completedAt: (tx as Partial<LocalTransaction>).completedAt
      ? new Date((tx as Partial<LocalTransaction>).completedAt!)
      : undefined,
    bridgeResult,
    transferId: (tx as Partial<LocalTransaction>).transferId,
  };
};

// Type for values that can be serialized to JSON storage
type SerializableValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | bigint
  | SerializableValue[]
  | { [key: string]: SerializableValue };

const sanitizeForStorage = <T>(value: T): T => {
  const convert = (input: unknown): unknown => {
    if (input instanceof Date) {
      return input.toISOString();
    }
    if (typeof input === "bigint") {
      return input.toString();
    }
    if (Array.isArray(input)) {
      return input.map(convert);
    }
    if (input !== null && typeof input === "object") {
      return Object.entries(input).reduce<Record<string, unknown>>(
        (acc, [key, val]) => {
          acc[key] = convert(val);
          return acc;
        },
        {}
      );
    }
    return input;
  };

  return convert(value) as T;
};

/**
 * Migrate a legacy v1 transaction (EVM-only) to v3 format.
 */
const migrateLegacyV1Transaction = (
  legacyTx: LegacyLocalTransaction
): LocalTransaction => {
  return {
    date: legacyTx.date ? new Date(legacyTx.date) : new Date(),
    originChain: legacyTx.originChain,
    hash: legacyTx.hash,
    status: legacyTx.status ?? "pending",
    amount: legacyTx.amount,
    targetChain: legacyTx.targetChain,
    targetAddress: legacyTx.targetAddress,
    claimHash: legacyTx.claimHash,
    version: "v3",
    transferType: "standard",
    estimatedTime: DEFAULT_ESTIMATED_TIME_LABEL,
  };
};

/**
 * Migrate a v2 transaction to v3 format.
 * Drops redundant fields: originChainType, targetChainType, provider, chain
 */
const migrateV2Transaction = (
  v2Tx: LegacyV2Transaction
): LocalTransaction => {
  // Destructure to drop the redundant fields
  const {
    originChainType: _originChainType, // Drop - derivable from originChain
    targetChainType: _targetChainType, // Drop - derivable from targetChain
    provider: _provider,               // Drop - always CCTPV2BridgingProvider
    chain: _chain,                     // Drop - unused legacy field
    ...rest
  } = v2Tx;

  return {
    ...rest,
    date: v2Tx.date ? new Date(v2Tx.date) : new Date(),
    completedAt: v2Tx.completedAt ? new Date(v2Tx.completedAt) : undefined,
    version: "v3",
  };
};

/**
 * Check for legacy data (v1 and v2) and migrate to v3.
 */
const migrateLegacyData = (): LocalTransaction[] => {
  if (typeof window === "undefined") {
    return [];
  }

  const migrated: LocalTransaction[] = [];

  try {
    // Migrate from v1 storage key ("cctp-transactions")
    const v1Data = localStorage.getItem("cctp-transactions");
    if (v1Data) {
      const parsed = JSON.parse(v1Data);
      if (parsed?.state?.transactions) {
        const v1Transactions = parsed.state.transactions as LegacyLocalTransaction[];
        v1Transactions.forEach((tx) => {
          migrated.push(migrateLegacyV1Transaction(tx));
        });
        // Remove v1 data after migration
        localStorage.removeItem("cctp-transactions");
        console.log(`Migrated ${v1Transactions.length} v1 transactions to v3`);
      }
    }
  } catch (error) {
    console.warn("Failed to migrate v1 transaction data:", error);
  }

  try {
    // Migrate from v2 storage key ("cctp-transactions-v2")
    const v2Data = localStorage.getItem("cctp-transactions-v2");
    if (v2Data) {
      const parsed = JSON.parse(v2Data);
      if (parsed?.state?.transactions) {
        const v2Transactions = parsed.state.transactions as LegacyV2Transaction[];
        v2Transactions.forEach((tx) => {
          migrated.push(migrateV2Transaction(tx));
        });
        // Remove v2 data after migration
        localStorage.removeItem("cctp-transactions-v2");
        console.log(`Migrated ${v2Transactions.length} v2 transactions to v3`);
      }
    }
  } catch (error) {
    console.warn("Failed to migrate v2 transaction data:", error);
  }

  return migrated;
};

export const useTransactionStore = create<TransactionState>()(
  persist(
    (set, get) => ({
      transactions: [],
      isLoading: false,
      error: null,

      addTransaction: (transaction) => {
        const incoming = {
          ...transaction,
          date: new Date(),
        } as LocalTransaction;
        const newTransaction = sanitizeForStorage(normalizeTransaction(incoming));

        set((state) => ({
          transactions: state.transactions.some(
            (tx) => tx.hash === newTransaction.hash
          )
            ? state.transactions
            : [newTransaction, ...state.transactions],
          error: null,
        }));
      },

      updateTransaction: (hash, updates) => {
        set((state) => ({
          transactions: state.transactions.map((tx) =>
            tx.hash === hash
              ? sanitizeForStorage({ ...tx, ...updates, version: "v3" })
              : tx
          ),
        }));
      },

      removeTransaction: (hash) => {
        set((state) => ({
          transactions: state.transactions.filter((tx) => tx.hash !== hash),
        }));
      },

      clearPendingTransactions: () => {
        set((state) => ({
          transactions: state.transactions.filter(
            (tx) => tx.status !== "pending"
          ),
        }));
      },

      clearAllTransactions: () => {
        set({ transactions: [] });
      },

      setLoading: (loading) => {
        set({ isLoading: loading });
      },

      setError: (error) => {
        set({ error });
      },

      migrateFromLegacy: () => {
        const migratedTransactions = migrateLegacyData();
        if (migratedTransactions.length === 0) return;

        set((state) => {
          const deduped = new Map<string, LocalTransaction>();

          // Add existing v3 transactions first
          state.transactions
            .map(normalizeTransaction)
            .forEach((tx) => deduped.set(tx.hash, tx));

          // Add migrated transactions (won't overwrite existing)
          migratedTransactions
            .map(normalizeTransaction)
            .forEach((tx) => {
              if (!deduped.has(tx.hash)) {
                deduped.set(tx.hash, tx);
              }
            });

          return {
            transactions: Array.from(deduped.values()).sort(
              (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
            ),
          };
        });
      },
    }),
    {
      name: "cctp-transactions-v3",
      partialize: (state) => ({ transactions: state.transactions }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.migrateFromLegacy();
        }
      },
    }
  )
);
