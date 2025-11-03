import { create } from "zustand";
import { persist } from "zustand/middleware";
import { LocalTransaction, LegacyLocalTransaction } from "@/lib/types";

const DEFAULT_ESTIMATED_TIME_LABEL = "13-19 minutes";

interface TransactionState {
  transactions: LocalTransaction[];
  isLoading: boolean;
  error: string | null;
  addTransaction: (transaction: Omit<LocalTransaction, "date">) => void;
  updateTransaction: (
    hash: `0x${string}`,
    updates: Partial<LocalTransaction>
  ) => void;
  removeTransaction: (hash: `0x${string}`) => void;
  clearPendingTransactions: () => void;
  clearAllTransactions: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  migrateFromLegacy: () => void;
}

// Migration function to convert legacy transactions
const normalizeTransaction = (
  tx: Partial<LocalTransaction>
): LocalTransaction => {
  return {
    date: tx.date ? new Date(tx.date) : new Date(),
    originChain: tx.originChain ?? 1,
    hash: tx.hash as `0x${string}`,
    status: tx.status ?? "pending",
    amount: tx.amount,
    chain: tx.chain,
    targetChain: tx.targetChain,
    targetAddress: tx.targetAddress,
    claimHash: tx.claimHash,
    version: tx.version ?? "v1",
    transferType: tx.transferType ?? "standard",
    fee: tx.fee,
    estimatedTime: tx.estimatedTime ?? DEFAULT_ESTIMATED_TIME_LABEL,
  };
};

const migrateLegacyTransaction = (
  legacyTx: LegacyLocalTransaction
): LocalTransaction => {
  return {
    ...legacyTx,
    date: legacyTx.date ? new Date(legacyTx.date) : new Date(),
    version: "v1" as const,
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
        const newTransaction = normalizeTransaction(incoming);

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
            tx.hash === hash ? { ...tx, ...updates } : tx
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
        // Migrate legacy data on store initialization
        if (state) {
          state.migrateFromLegacy();
          set((prev) => ({
            transactions: prev.transactions.map(normalizeTransaction),
          }));
        }
      },
    }
  )
);
