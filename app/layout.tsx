import CryptoProivders from "@/components/crypto";
import ErrorBoundary from "@/components/ErrorBoundary";
import "./globals.css";
import { Analytics } from "@vercel/analytics/react";
import { Geist, Geist_Mono } from "next/font/google";
import type { Metadata } from "next";

export const metadata: Metadata = {
  applicationName: "CCTP Bridge",
  title: "Bridge USDC via CCTP",
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
    "A native USDC bridge directly powered by Circle's CCTP. Now with CCTP v2!",
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

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <Analytics />
        <ErrorBoundary>
          <CryptoProivders>{children}</CryptoProivders>
        </ErrorBoundary>
      </body>
    </html>
  );
}
