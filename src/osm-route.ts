import { redis, withTimeout } from "./redis";

// FOSSGIS's public OSRM servers. The foot profile follows sidewalks, footways and
// crossings mapped in OpenStreetMap; the car profile follows roads.
const PROFILES = {
  walking: "https://routing.openstreetmap.de/routed-foot/route/v1/foot",
  driving: "https://routing.openstreetmap.de/routed-car/route/v1/driving",
} as const;
const CACHE_TTL_S = 60 * 60 * 24 * 7;
const TIMEOUT_MS = 4000;

type LatLng = [number, number];

// Round to about 10 m so repeat trips share one cache entry.
const round = (n: number) => Math.round(n * 10000) / 10000;

// The street-following path between two points, or null when the router can't be
// reached, so callers can fall back to a straight line.
export async function osmRoute(from: LatLng, to: LatLng, mode: keyof typeof PROFILES): Promise<LatLng[] | null> {
  const [a, b] = [from.map(round), to.map(round)] as [LatLng, LatLng];
  const cacheKey = `osrm:${mode}:${a.join(",")}:${b.join(",")}`;

  // OSRM snaps to the nearest path, so add the exact endpoints back on to meet the pins.
  const withEnds = (path: LatLng[]): LatLng[] => [from, ...path, to];

  try {
    const hit = await withTimeout(redis.get(cacheKey));
    if (hit) return withEnds(JSON.parse(hit) as LatLng[]);
  } catch (err) {
    console.warn("Redis read failed, calling OSRM directly:", err);
  }

  let path: LatLng[];
  try {
    const res = await fetch(`${PROFILES[mode]}/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`, {
      headers: { "User-Agent": "Radius (https://github.com/Charmunks/yelps)" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`OSRM returned ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { code: string; routes?: { geometry: { coordinates: [number, number][] } }[] };
    if (body.code !== "Ok" || !body.routes?.length) return null;
    path = body.routes[0]!.geometry.coordinates.map(([lng, lat]): LatLng => [+lat.toFixed(5), +lng.toFixed(5)]);
  } catch (err) {
    console.warn("OSRM request failed:", err);
    return null;
  }

  try {
    await withTimeout(redis.set(cacheKey, JSON.stringify(path), "EX", CACHE_TTL_S));
  } catch (err) {
    console.warn("Redis write failed:", err);
  }
  return withEnds(path);
}
