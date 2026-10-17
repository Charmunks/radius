import { redis, withTimeout } from "./redis";

// OpenStreetMap's Nominatim. Its usage policy asks for a real User-Agent, at most one
// request a second and caching, so the UI only searches on submit and results are kept.
const SEARCH_URL = "https://nominatim.openstreetmap.org/search";
// Prefer results around the DC area without ruling out anywhere else.
const VIEWBOX = "-77.6,39.2,-76.6,38.6";
const CACHE_TTL_S = 60 * 60 * 24 * 7;
const TIMEOUT_MS = 4000;
const LIMIT = 5;

export interface GeocodeResult {
  name: string;
  lat: number;
  lng: number;
}

// Matches for a free-text address or place name, or null when Nominatim can't be reached.
export async function geocode(q: string): Promise<GeocodeResult[] | null> {
  const cacheKey = `geocode:v2:${q.toLowerCase()}`;

  try {
    const hit = await withTimeout(redis.get(cacheKey));
    if (hit) return JSON.parse(hit) as GeocodeResult[];
  } catch (err) {
    console.warn("Redis read failed, calling Nominatim directly:", err);
  }

  let results: GeocodeResult[];
  try {
    const qs = new URLSearchParams({ q, format: "jsonv2", limit: String(LIMIT), viewbox: VIEWBOX, countrycodes: "us" });
    const res = await fetch(`${SEARCH_URL}?${qs}`, {
      headers: { "User-Agent": "Radius (https://github.com/Charmunks/yelps)" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`Nominatim returned ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { display_name: string; lat: string; lon: string }[];
    // The same station or building often comes back several times under one name.
    const seen = new Set<string>();
    results = body
      .filter((r) => !seen.has(r.display_name) && seen.add(r.display_name))
      .map((r) => ({ name: r.display_name, lat: +r.lat, lng: +r.lon }));
  } catch (err) {
    console.warn("Nominatim request failed:", err);
    return null;
  }

  try {
    await withTimeout(redis.set(cacheKey, JSON.stringify(results), "EX", CACHE_TTL_S));
  } catch (err) {
    console.warn("Redis write failed:", err);
  }
  return results;
}
