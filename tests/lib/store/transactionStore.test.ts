import { beforeEach, describe, expect, it } from "vitest";
import { useTransactionStore } from "@/lib/store/transactionStore";

describe("transactionStore upsertTransaction", () => {
  beforeEach(() => {
    useTransactionStore.setState({
      transactions: [],
      isLoading: false,
      error: null,
    });
  });

  it("inserts a new transaction when hash does not exist", () => {
    useTransactionStore.getState().upsertTransaction({
      originChain: 1,
      hash: `0x${"a".repeat(64)}`,
      status: "pending",
      version: "v3",
      amount: "1.00",
    });

    const { transactions } = useTransactionStore.getState();
    expect(transactions).toHaveLength(1);
    expect(transactions[0].hash).toBe(`0x${"a".repeat(64)}`);
    expect(transactions[0].status).toBe("pending");
  });

  it("updates existing transaction atomically without duplicating hash entries", () => {
    const hash = `0x${"b".repeat(64)}`;

    useTransactionStore.getState().upsertTransaction({
      originChain: 1,
      hash: hash.toUpperCase(),
      status: "pending",
      version: "v3",
      amount: "1.00",
    });

    const firstDate = useTransactionStore.getState().transactions[0].date;

    useTransactionStore.getState().upsertTransaction({
      originChain: 1,
      hash,
      status: "claimed",
      version: "v3",
      nonce: "12345",
      amount: "1.00",
    });

    const { transactions } = useTransactionStore.getState();
    expect(transactions).toHaveLength(1);
    expect(transactions[0].hash).toBe(hash);
    expect(transactions[0].status).toBe("claimed");
    expect(transactions[0].nonce).toBe("12345");
    expect(transactions[0].date).toEqual(firstDate);
  });

  it("preserves existing chain fields when upserting sparse recovered updates", () => {
    useTransactionStore.getState().upsertTransaction({
      originChain: "Solana_Devnet",
      hash: "3xqVn3r8s3qfB1zGULmoxjMgsfpn3iFz5dMZXQkQ2q9B9dffA5Y1k8m2r4s6t8u9",
      status: "pending",
      version: "v3",
      targetChain: 8453,
      amount: "1.00",
    });

    useTransactionStore.getState().upsertTransaction({
      hash: "3xqVn3r8s3qfB1zGULmoxjMgsfpn3iFz5dMZXQkQ2q9B9dffA5Y1k8m2r4s6t8u9",
      status: "claimed",
      version: "v3",
      nonce: "777",
      amount: "1.00",
    } as any);

    const { transactions } = useTransactionStore.getState();
    expect(transactions).toHaveLength(1);
    expect(transactions[0].originChain).toBe("Solana_Devnet");
    expect(transactions[0].targetChain).toBe(8453);
    expect(transactions[0].status).toBe("claimed");
  });

  it("does not default missing originChain to Ethereum mainnet", () => {
    useTransactionStore.getState().upsertTransaction({
      hash: `0x${"c".repeat(64)}`,
      status: "pending",
      version: "v3",
      amount: "1.00",
    } as any);

    const { transactions, error } = useTransactionStore.getState();
    expect(transactions).toHaveLength(0);
    expect(error).toContain("originChain");
  });
});
