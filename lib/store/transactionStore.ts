import { create } from "zustand";
import { persist } from "zustand/middleware";
import { LocalTransaction, LegacyLocalTransaction } from "@/lib/types";

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
const migrateLegacyTransaction = (legacyTx: LegacyLocalTransaction): LocalTransaction => {
  return {
    ...legacyTx,
    version: 'v1' as const,
    transferType: 'standard' as const,
    estimatedTime: '13-19 minutes',
  };
};

// Check for legacy data and migrate
const migrateLegacyData = (): LocalTransaction[] => {
  try {
    const legacyData = localStorage.getItem('cctp-transactions');
    if (legacyData) {
      const parsed = JSON.parse(legacyData);
      if (parsed?.state?.transactions) {
        const legacyTransactions = parsed.state.transactions as LegacyLocalTransaction[];
        const migratedTransactions = legacyTransactions.map(migrateLegacyTransaction);
        
        // Remove legacy data after migration
        localStorage.removeItem('cctp-transactions');
        
        return migratedTransactions;
      }
    }
  } catch (error) {
    console.warn('Failed to migrate legacy transaction data:', error);
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
        const newTransaction: LocalTransaction = {
          ...transaction,
          date: new Date(),
          version: transaction.version || 'v1',
          transferType: transaction.transferType || 'standard',
          estimatedTime: transaction.estimatedTime || '13-19 minutes',
        };

        set((state) => ({
          transactions: [newTransaction, ...state.transactions],
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
        if (migratedTransactions.length > 0) {
          set((state) => ({
            transactions: [...migratedTransactions, ...state.transactions],
          }));
        }
      },
    }),
    {
      name: "cctp-transactions-v2",
      partialize: (state) => ({ transactions: state.transactions }),
      onRehydrateStorage: () => (state) => {
        // Migrate legacy data on store initialization
        if (state) {
          state.migrateFromLegacy();
        }
      },
    }
  )
);
