import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  LegacyLocalTransaction,
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
  addTransaction: (transaction: Omit<LocalTransaction, "date" | "originChainType">) => void;
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

const normalizeTransaction = (
  tx: Partial<LocalTransaction> | Partial<LegacyLocalTransaction>
): LocalTransaction => {
  const txLocal = tx as Partial<LocalTransaction>;
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

  return {
    date: tx.date ? new Date(tx.date) : new Date(),
    originChain,
    originChainType: txLocal.originChainType ?? getChainType(originChain),
    hash: tx.hash as UniversalTxHash,
    status: tx.status ?? "pending",
    provider: txLocal.provider ?? bridgeResult?.provider,
    bridgeState: txLocal.bridgeState ?? bridgeResult?.state,
    steps: txLocal.steps ?? bridgeResult?.steps,
    amount: txLocal.amount ?? bridgeResult?.amount,
    chain: txLocal.chain,
    targetChain,
    targetChainType: txLocal.targetChainType ?? (targetChain ? getChainType(targetChain) : undefined),
    targetAddress:
      txLocal.targetAddress ??
      (bridgeResult?.destination?.address as string | undefined),
    claimHash: txLocal.claimHash,
    version: "v2",
    transferType: txLocal.transferType ?? "standard",
    fee: txLocal.fee,
    estimatedTime: txLocal.estimatedTime ?? DEFAULT_ESTIMATED_TIME_LABEL,
    bridgeResult,
    transferId: txLocal.transferId,
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

const migrateLegacyTransaction = (
  legacyTx: LegacyLocalTransaction
): LocalTransaction => {
  // Legacy transactions are always EVM
  return {
    ...legacyTx,
    date: legacyTx.date ? new Date(legacyTx.date) : new Date(),
    originChainType: "evm" as const, // Legacy transactions were EVM-only
    targetChainType: legacyTx.targetChain ? "evm" as const : undefined,
    version: "v2" as const,
    transferType: "standard" as const,
    estimatedTime: DEFAULT_ESTIMATED_TIME_LABEL,
  };
};

// Check for legacy data and migrate
const migrateLegacyData = (): LocalTransaction[] => {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const legacyData = localStorage.getItem("cctp-transactions");
    if (legacyData) {
      const parsed = JSON.parse(legacyData);
      if (parsed?.state?.transactions) {
        const legacyTransactions =
          parsed.state.transactions as LegacyLocalTransaction[];
        const migratedTransactions =
          legacyTransactions.map(migrateLegacyTransaction);

        // Remove legacy data after migration
        localStorage.removeItem("cctp-transactions");

        return migratedTransactions;
      }
    }
  } catch (error) {
    console.warn("Failed to migrate legacy transaction data:", error);
  }
  return [];
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
              ? sanitizeForStorage({ ...tx, ...updates })
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
        set((state) => {
          const deduped = new Map<string, LocalTransaction>();

          state.transactions
            .map(normalizeTransaction)
            .forEach((tx) => deduped.set(tx.hash, tx));

          migratedTransactions
            .map(normalizeTransaction)
            .forEach((tx) => deduped.set(tx.hash, tx));

          return {
            transactions: Array.from(deduped.values()).sort(
              (a, b) => b.date.getTime() - a.date.getTime()
            ),
          };
        });
      },
    }),
    {
      name: "cctp-transactions-v2",
      partialize: (state) => ({ transactions: state.transactions }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.migrateFromLegacy();
        }
      },
    }
  )
);
