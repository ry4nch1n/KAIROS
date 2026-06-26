import type { Overview, Platform, BriefEditionMeta, BriefEdition, LibraryItem } from "shared";

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json() as Promise<T>;
}

export const api = {
  overview: (p: Platform) => getJSON<Overview>(`/api/overview?platform=${p}`),
  briefEditions: () => getJSON<BriefEditionMeta[]>(`/api/brief/editions`),
  briefEdition: (date: string) => getJSON<BriefEdition>(`/api/brief/edition/${date}`),
  library: () => getJSON<LibraryItem[]>(`/api/library`),
};
