import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function BridgeCardSkeleton() {
  return (
    <Card className="bg-gradient-to-br from-slate-800/95 via-slate-800/98 to-slate-900/100 backdrop-blur-sm border-slate-700/50 text-white">
      <CardContent className="space-y-4 p-4 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="w-full space-y-2 md:flex-1">
            <Skeleton className="h-4 w-14 bg-slate-700/80" />
            <Skeleton className="h-10 w-full bg-slate-700/80" />
          </div>
          <div className="hidden h-8 w-8 shrink-0 rounded-full border border-slate-600 bg-slate-700/50 md:block" />
          <div className="w-full space-y-2 md:flex-1">
            <Skeleton className="h-4 w-10 bg-slate-700/80" />
            <Skeleton className="h-10 w-full bg-slate-700/80" />
          </div>
        </div>

        <div className="rounded-lg bg-slate-900/50 px-4 py-3">
          <div className="mb-3 flex items-center justify-between">
            <Skeleton className="h-4 w-16 bg-slate-700/80" />
            <Skeleton className="h-4 w-28 bg-slate-700/80" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-9 w-32 bg-slate-700/80" />
            <Skeleton className="h-6 w-14 bg-slate-700/80" />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-slate-700/50 bg-slate-900/30 p-4">
          <Skeleton className="h-4 w-36 bg-slate-700/80" />
          <Skeleton className="h-10 w-full bg-slate-700/80" />
          <Skeleton className="h-10 w-full bg-slate-700/80" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-20 w-full bg-slate-700/80" />
          <Skeleton className="h-20 w-full bg-slate-700/80" />
        </div>
      </CardContent>
    </Card>
  );
}
