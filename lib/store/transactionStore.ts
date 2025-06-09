import { create } from "zustand";
import { persist } from "zustand/middleware";
import { LocalTransaction } from "@/lib/types";

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
}

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
    }),
    {
      name: "cctp-transactions",
      partialize: (state) => ({ transactions: state.transactions }),
    }
  )
);
