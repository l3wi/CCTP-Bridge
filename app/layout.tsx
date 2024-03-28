import CryptoProivders from "@/components/crypto";
import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  applicationName: "CCTP Bridge",
  title: "USDC Bridge - CCTP",
  openGraph: {
    images: [
      {
        url: "https://cctp.io/og.png",
        width: 1200,
        height: 630,
        alt: "CCTP Bridge",
      },
    ],
  },
  description:
    "The simple CCTP bridge interface for USDC that Circle should have built.",
  keywords: [
    "USDC",
    "CCTP",
    "Bridge",
    "Circle",
    "Stablecoin",
    "Ethereum",
    "Polygon",
    "Avalanche",
    "Optimism",
    "Arbitrum",
  ],
  metadataBase: new URL("https://cctp.io"),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <CryptoProivders>{children}</CryptoProivders>
      </body>
    </html>
  );
}
