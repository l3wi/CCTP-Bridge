/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChangelogModal } from "@/components/changelog-modal";

describe("ChangelogModal", () => {
  it("opens and renders public changelog entries", async () => {
    const user = userEvent.setup();

    render(<ChangelogModal />);

    await user.click(screen.getByRole("button", { name: /what's new/i }));

    expect(
      screen.getByRole("heading", { name: /what's new/i })
    ).toBeTruthy();
    expect(
      screen.getByText("New look, history page, and recovery page")
    ).toBeTruthy();
    expect(screen.getByText("Expanded network coverage metadata")).toBeTruthy();
    expect(screen.getByText("Solana")).toBeTruthy();
    expect(screen.getByText("Arbitrum")).toBeTruthy();
  });

  it("does not render audit commit hashes in the public modal", async () => {
    const user = userEvent.setup();

    render(<ChangelogModal />);

    await user.click(screen.getByRole("button", { name: /what's new/i }));

    expect(screen.queryByText("fb5e779")).toBeNull();
    expect(screen.queryByText("4024cf9")).toBeNull();
  });
});
