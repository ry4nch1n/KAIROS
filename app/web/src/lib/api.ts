import type {
  Overview, Platform, BriefEditionMeta, BriefEdition, LibraryItem,
  GenreRow, DeveloperRow, NewRelease, HiddenGem, SteamOverview, BriefSteering,
} from "shared";

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json() as Promise<T>;
}

export const api = {
  overview: (p: Platform) => getJSON<Overview>(`/api/overview?platform=${p}`),
  steam: () => getJSON<SteamOverview>(`/api/steam`),
  genres: (p: Platform) => getJSON<GenreRow[]>(`/api/genres?platform=${p}`),
  developers: (p: Platform) => getJSON<DeveloperRow[]>(`/api/developers?platform=${p}`),
  newReleases: (p: Platform) => getJSON<NewRelease[]>(`/api/new-releases?platform=${p}`),
  hiddenGems: (p: Platform) => getJSON<HiddenGem[]>(`/api/hidden-gems?platform=${p}`),
  briefEditions: () => getJSON<BriefEditionMeta[]>(`/api/brief/editions`),
  briefSteering: () => getJSON<BriefSteering>(`/api/brief/steering`),
  briefEdition: (date: string) => getJSON<BriefEdition>(`/api/brief/edition/${date}`),
  library: () => getJSON<LibraryItem[]>(`/api/library`),
};
