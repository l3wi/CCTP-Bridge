"use client";

import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface BridgeErrorFallbackProps {
  error?: Error;
  resetErrorBoundary?: () => void;
}

export function BridgeErrorFallback({
  error,
  resetErrorBoundary,
}: BridgeErrorFallbackProps) {
  return (
    <Card className="bg-gradient-to-br from-slate-800/95 via-slate-800/98 to-slate-900/100 backdrop-blur-sm border-slate-700/50 text-white">
      <CardContent className="p-6 text-center">
        <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-amber-500" />
        <h3 className="text-lg font-semibold mb-2">Bridge Unavailable</h3>
        <p className="text-slate-400 mb-4">
          {error?.message || "Unable to load bridge interface. Please try again."}
        </p>
        {resetErrorBoundary && (
          <Button
            onClick={resetErrorBoundary}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            Try Again
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
