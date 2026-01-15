import { useEffect, useMemo, useState, useCallback } from "react";
import { useLocation } from "wouter";

const LS_KEY = "sleeper_selected_season";

function getSearchParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function setSearchParam(key: string, value: string) {
  const params = getSearchParams();
  params.set(key, value);
  const newUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState({}, "", newUrl);
}

export function useSeason(availableSeasons?: number[], preferredDefault?: number | null) {
  const [location] = useLocation();
  
  const seasons = useMemo(() => {
    const list = (availableSeasons ?? []).filter(Number.isFinite);
    list.sort((a, b) => b - a);
    return list;
  }, [availableSeasons]);

  const urlSeasonRaw = getSearchParams().get("season");
  const urlSeason = urlSeasonRaw ? Number(urlSeasonRaw) : undefined;

  const storageSeasonRaw = localStorage.getItem(LS_KEY);
  const storageSeason = storageSeasonRaw ? Number(storageSeasonRaw) : undefined;

  const [season, setSeasonState] = useState<number | undefined>(() => {
    if (Number.isFinite(urlSeason)) return urlSeason;
    if (Number.isFinite(storageSeason)) return storageSeason;
    return undefined;
  });

  // Validate season against available seasons - reset to preferred default or most recent if invalid
  useEffect(() => {
    if (seasons.length === 0) return;
    
    if (season === undefined || !seasons.includes(season)) {
      // Use preferredDefault if valid and available, otherwise use most recent
      const defaultSeason = (preferredDefault && seasons.includes(preferredDefault)) 
        ? preferredDefault 
        : seasons[0];
      setSeasonState(defaultSeason);
      localStorage.setItem(LS_KEY, String(defaultSeason));
      setSearchParam("season", String(defaultSeason));
    }
  }, [season, seasons, preferredDefault]);

  useEffect(() => {
    const currentUrlSeason = getSearchParams().get("season");
    const parsed = currentUrlSeason ? Number(currentUrlSeason) : undefined;
    if (Number.isFinite(parsed) && parsed !== season && seasons.includes(parsed!)) {
      setSeasonState(parsed);
    }
  }, [location, seasons]);

  const setSeason = useCallback((newSeason: number) => {
    setSeasonState(newSeason);
    localStorage.setItem(LS_KEY, String(newSeason));
    setSearchParam("season", String(newSeason));
  }, []);

  return { season, setSeason, seasons };
}

export function pickDefaultSeason(leagues: { season?: string | number; status?: string }[]): number | undefined {
  const seasons = Array.from(
    new Set(leagues.map((l) => Number(l.season)).filter(Number.isFinite))
  ).sort((a, b) => b - a);
  
  if (!seasons.length) return undefined;

  for (const s of seasons) {
    const inSeason = leagues.filter((l) => Number(l.season) === s);
    const hasComplete = inSeason.some((l) => l.status === "complete");
    if (hasComplete) return s;
  }

  return seasons[0];
}
