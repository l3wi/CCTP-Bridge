"use client";

import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  publicChangelog,
  type ChangelogCategory,
  type ChangelogEntry,
  type ChangelogImportance,
} from "@/lib/changelog";
import { cn } from "@/lib/utils";

const categoryLabels: Record<ChangelogCategory, string> = {
  chains: "Networks",
  bridge: "Bridge flow",
  recovery: "Recovery",
  ui: "Interface",
  reliability: "Reliability",
};

const categoryClassNames: Record<ChangelogCategory, string> = {
  chains: "border-blue-500/30 bg-blue-500/10 text-blue-200",
  bridge: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200",
  recovery: "border-violet-500/30 bg-violet-500/10 text-violet-200",
  ui: "border-slate-500/40 bg-slate-700/60 text-slate-100",
  reliability: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
};

const importanceLabels: Record<ChangelogImportance, string> = {
  major: "Major",
  minor: "Update",
  patch: "Fix",
};

const formatEntryDate = (date: string) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`));

export function ChangelogModal() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="bg-slate-800 border-slate-700 text-white hover:bg-slate-700/50 hover:text-white flex items-center gap-2 px-3"
          aria-label="What's new"
        >
          <Megaphone
            className="size-4"
            data-icon="inline-start"
            aria-hidden="true"
          />
          <span className="hidden sm:inline">What&apos;s new</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-2xl p-3 sm:p-6">
        <DialogHeader className="pr-8">
          <DialogTitle>What&apos;s new</DialogTitle>
          <DialogDescription className="text-slate-400">
            Product updates from {publicChangelog.generatedFrom.from} to{" "}
            {publicChangelog.generatedFrom.to}.
          </DialogDescription>
        </DialogHeader>

        <div
          className="max-h-[70vh] overflow-y-auto pr-1 flex flex-col gap-3"
          data-scrollable="true"
        >
          {publicChangelog.entries.map((entry) => (
            <ChangelogEntryCard key={entry.id} entry={entry} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChangelogEntryCard({ entry }: { entry: ChangelogEntry }) {
  return (
    <article className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs font-medium",
            categoryClassNames[entry.category]
          )}
        >
          {categoryLabels[entry.category]}
        </span>
        <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300">
          {importanceLabels[entry.importance]}
        </span>
        <time className="text-xs text-slate-400" dateTime={entry.date}>
          {formatEntryDate(entry.date)}
        </time>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <h3 className="text-base font-semibold leading-tight text-white">
          {entry.title}
        </h3>
        <p className="text-sm leading-6 text-slate-300">{entry.summary}</p>
      </div>

      <ul className="mt-3 flex flex-col gap-2 text-sm leading-6 text-slate-300">
        {entry.highlights.map((highlight) => (
          <li key={highlight} className="flex gap-2">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-slate-500" />
            <span>{highlight}</span>
          </li>
        ))}
      </ul>

      {entry.networks && (
        <div className="mt-4 flex flex-wrap gap-2">
          {entry.networks.map((network) => (
            <span
              key={network}
              className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300"
            >
              {network}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
