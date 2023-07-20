import CryptoProivders from "@/components/crypto";
import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "USDC CCTP Bridge",
  description: "An app to cross Circle's CCTP bridge.",
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
