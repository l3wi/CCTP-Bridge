// @vitest-environment jsdom
import type { ImgHTMLAttributes, ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChainIcon } from "@/components/chain-icon";

vi.mock("@web3icons/react/dynamic", () => ({
  NetworkIcon: ({
    fallback,
  }: {
    fallback?: ReactNode;
  }) => <>{fallback ?? <span data-testid="network-icon" />}</>,
  TokenIcon: () => <span data-testid="token-icon" />,
}));

vi.mock("next/image", () => ({
  default: (props: ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}));

describe("ChainIcon", () => {
  it("renders a local chain asset fallback before image failure", () => {
    render(<ChainIcon chainId={3343} size={24} />);

    const image = screen.getByRole("img", { name: "Chain 3343" });
    expect(image.getAttribute("src")).toBe("/3343.svg");
  });

  it("renders a generic placeholder when the local asset is missing", () => {
    render(<ChainIcon chainId={3343} size={24} />);

    const image = screen.getByRole("img", { name: "Chain 3343" });
    fireEvent.error(image);

    expect(screen.getByLabelText("Unknown chain 3343")).toBeTruthy();
    expect(screen.getByText("?")).toBeTruthy();
  });

  it("continues to use the Solana token icon path for Solana chains", () => {
    render(<ChainIcon chainId={"Solana"} size={24} />);

    expect(screen.getByTestId("token-icon")).toBeTruthy();
  });
});
