/** @vitest-environment jsdom */

import { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HistoryModal } from "@/components/history-modal";
import type { LocalTransaction } from "@/lib/types";

const pushMock = vi.hoisted(() => vi.fn());
const removeTransactionMock = vi.hoisted(() => vi.fn());
const transactionsState = vi.hoisted(() => ({
  transactions: [] as LocalTransaction[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/store/transactionStore", () => ({
  useTransactionStore: () => ({
    transactions: transactionsState.transactions,
    removeTransaction: removeTransactionMock,
  }),
}));

describe("HistoryModal", () => {
  beforeEach(() => {
    pushMock.mockReset();
    removeTransactionMock.mockReset();
    transactionsState.transactions = [];
  });

  it("routes to /bridge when clicking Add Transaction in modal", async () => {
    const user = userEvent.setup();
    render(<HistoryModal open />);

    await user.click(screen.getByRole("button", { name: /add transaction/i }));

    expect(pushMock).toHaveBeenCalledWith("/bridge");
  });

  it("shows pending count badge", () => {
    transactionsState.transactions = [
      {
        hash: `0x${"a".repeat(64)}`,
        originChain: 1,
        status: "pending",
        version: "v3",
        date: new Date("2026-02-20T00:00:00.000Z"),
      },
    ];

    render(<HistoryModal />);

    expect(screen.getByText("1 Pending")).toBeTruthy();
  });

  it("prioritizes claimable badge over pending badge", () => {
    transactionsState.transactions = [
      {
        hash: `0x${"b".repeat(64)}`,
        originChain: 1,
        status: "pending",
        version: "v3",
        date: new Date("2026-02-20T00:00:00.000Z"),
        steps: [
          {
            name: "Claim",
            state: "pending",
          },
        ],
      },
      {
        hash: `0x${"c".repeat(64)}`,
        originChain: 1,
        status: "pending",
        version: "v3",
        date: new Date("2026-02-20T00:00:00.000Z"),
      },
    ];

    render(<HistoryModal />);

    expect(screen.getByText("1 Claimable")).toBeTruthy();
  });
});
