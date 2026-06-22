"use client";

import type { ReactNode } from "react";
import ErrorBoundary from "@/components/ErrorBoundary";
import { BridgeErrorFallback } from "@/components/bridge/BridgeErrorFallback";

interface BridgeContentBoundaryProps {
  children: ReactNode;
}

export function BridgeContentBoundary({ children }: BridgeContentBoundaryProps) {
  return (
    <ErrorBoundary
      fallback={({ error, retry }) => (
        <BridgeErrorFallback error={error} resetErrorBoundary={retry} />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
