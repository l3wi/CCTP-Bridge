import { redirect } from "next/navigation";

interface PendingPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const toSingleValueMap = (
  params: Record<string, string | string[] | undefined>
): URLSearchParams => {
  const next = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry != null) {
          next.append(key, entry);
        }
      });
      return;
    }

    if (value != null) {
      next.set(key, value);
    }
  });

  return next;
};

export default async function PendingPage({ searchParams }: PendingPageProps) {
  const resolved = await searchParams;
  const params = toSingleValueMap(resolved);

  params.set("mode", "execute");

  const query = params.toString();
  redirect(query ? `/?${query}` : "/");
}
