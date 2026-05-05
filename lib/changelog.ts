import rawChangelog from "@/public/changelog.json";

export const CHANGELOG_CATEGORIES = [
  "chains",
  "bridge",
  "recovery",
  "ui",
  "reliability",
] as const;

export const CHANGELOG_IMPORTANCE = ["major", "minor", "patch"] as const;

export const CHANGELOG_AUDIENCES = [
  "all-users",
  "evm-users",
  "solana-users",
  "returning-users",
] as const;

export type ChangelogCategory = (typeof CHANGELOG_CATEGORIES)[number];
export type ChangelogImportance = (typeof CHANGELOG_IMPORTANCE)[number];
export type ChangelogAudience = (typeof CHANGELOG_AUDIENCES)[number];

export interface ChangelogEntry {
  id: string;
  date: string;
  category: ChangelogCategory;
  title: string;
  summary: string;
  highlights: string[];
  networks?: string[];
  audience: ChangelogAudience[];
  importance: ChangelogImportance;
  references: {
    commits: string[];
  };
}

export interface PublicChangelog {
  schemaVersion: 1;
  generatedFrom: {
    from: string;
    to: string;
    source: "git-history";
  };
  entries: ChangelogEntry[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const includesString = <T extends readonly string[]>(
  values: T,
  value: unknown
): value is T[number] => typeof value === "string" && values.includes(value);

const isChangelogEntry = (value: unknown): value is ChangelogEntry => {
  if (!isRecord(value)) return false;

  const references = value.references;
  const networks = value.networks;

  return (
    typeof value.id === "string" &&
    typeof value.date === "string" &&
    includesString(CHANGELOG_CATEGORIES, value.category) &&
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    isStringArray(value.highlights) &&
    (networks === undefined || isStringArray(networks)) &&
    Array.isArray(value.audience) &&
    value.audience.every((audience) =>
      includesString(CHANGELOG_AUDIENCES, audience)
    ) &&
    includesString(CHANGELOG_IMPORTANCE, value.importance) &&
    isRecord(references) &&
    isStringArray(references.commits)
  );
};

export const isPublicChangelog = (value: unknown): value is PublicChangelog => {
  if (!isRecord(value)) return false;

  const generatedFrom = value.generatedFrom;

  return (
    value.schemaVersion === 1 &&
    isRecord(generatedFrom) &&
    typeof generatedFrom.from === "string" &&
    typeof generatedFrom.to === "string" &&
    generatedFrom.source === "git-history" &&
    Array.isArray(value.entries) &&
    value.entries.every(isChangelogEntry)
  );
};

const parseChangelog = (value: unknown): PublicChangelog => {
  if (!isPublicChangelog(value)) {
    throw new Error("Invalid public changelog data");
  }

  return value;
};

export const publicChangelog = parseChangelog(rawChangelog);
