import type { Category, Place } from "./places";
import { redis, withTimeout } from "./redis";

const SEARCH_URL = "https://places-api.foursquare.com/places/search";
const API_VERSION = "2025-06-17";
const RADIUS_M = 5000;
const LIMIT = 50;
const CACHE_TTL_S = 60 * 60 * 24;

// Free-tier (Pro) fields only. rating, stats, price and photos are Premium and need paid credits.
const FIELDS = "fsq_place_id,name,latitude,longitude,categories,location,website,date_closed";

// Foursquare category IDs for each of our interest buckets.
const CATEGORY_IDS: Record<Category, string> = {
  // Restaurant, Café, Coffee Shop, Bakery, Food Truck
  food: "4d4b7105d754a06374d81259,4bf58dd8d48988d16d941735,4bf58dd8d48988d1e0931735,4bf58dd8d48988d16a941735,4bf58dd8d48988d1cb941735",
  // Monument, Historic and Protected Site, Memorial Site, Museum, Tour Provider
  tourism: "4bf58dd8d48988d12d941735,4deefb944765f83613cdba6e,5642206c498e4bfca532186c,4bf58dd8d48988d181941735,56aa371be4b08b9a8d573520",
  // Public Art, Park, Garden, Botanical Garden, Scenic Lookout
  photo: "507c8c4091d498d9fc8c67a9,4bf58dd8d48988d163941735,4bf58dd8d48988d15a941735,52e81612bcbc57f1066b7a22,4bf58dd8d48988d165941735",
};

// Foursquare has no visit length, so use a rough default per bucket.
const MINUTES: Record<Category, number> = { food: 60, tourism: 90, photo: 40 };

export interface SearchOptions {
  openNow?: boolean;
  price?: string; // comma-separated "1".."4"
  radius?: number; // metres; Foursquare caps this at 100000
}

interface FsqPlace {
  fsq_place_id: string;
  name: string;
  latitude: number;
  longitude: number;
  categories?: { fsq_category_id: string; name: string }[];
  location?: { locality?: string; formatted_address?: string };
  website?: string;
  date_closed?: string;
}

// Round to about 100 m so nearby requests share one cache entry.
const grid = (n: number) => Math.round(n * 1000) / 1000;

function toPlace(p: FsqPlace, category: Category): Place {
  return {
    id: p.fsq_place_id,
    name: p.name,
    category,
    lat: p.latitude,
    lng: p.longitude,
    neighborhood: p.location?.locality ?? "",
    blurb: (p.categories ?? []).map((c) => c.name).join(", "),
    minutes: MINUTES[category],
    source: "foursquare",
    website: p.website,
    foursquareUrl: `https://foursquare.com/v/${p.fsq_place_id}`,
    address: p.location?.formatted_address ?? "",
  };
}

// Results come back in Foursquare's relevance order. Returns null when Foursquare is
// unavailable, so callers can tell that apart from "no results".
export async function searchPlaces(lat: number, lng: number, category: Category, opts: SearchOptions = {}): Promise<Place[] | null> {
  const [gLat, gLng] = [grid(lat), grid(lng)];
  const radius = opts.radius ?? RADIUS_M;
  const cacheKey = `fsq:search:v2:${category}:${gLat}:${gLng}:${opts.openNow ? 1 : 0}:${opts.price ?? ""}:${radius}`;

  try {
    const hit = await withTimeout(redis.get(cacheKey));
    if (hit) return JSON.parse(hit) as Place[];
  } catch (err) {
    console.warn("Redis read failed, calling Foursquare directly:", err);
  }

  const apiKey = process.env.FOURSQUARE_API_KEY;
  if (!apiKey) {
    console.warn("FOURSQUARE_API_KEY is not set");
    return null;
  }

  const qs = new URLSearchParams({
    ll: `${gLat},${gLng}`,
    fsq_category_ids: CATEGORY_IDS[category],
    radius: String(radius),
    limit: String(LIMIT),
    sort: "RELEVANCE",
    fields: FIELDS,
  });
  if (opts.openNow) qs.set("open_now", "true");
  // Foursquare takes a price range rather than a list, so span the chosen levels.
  const prices = (opts.price ?? "").split(",").filter(Boolean).map(Number);
  if (prices.length) {
    qs.set("min_price", String(Math.min(...prices)));
    qs.set("max_price", String(Math.max(...prices)));
  }

  let res: Response;
  try {
    res = await fetch(`${SEARCH_URL}?${qs}`, {
      headers: { Authorization: `Bearer ${apiKey}`, "X-Places-Api-Version": API_VERSION, Accept: "application/json" },
    });
  } catch (err) {
    console.warn("Foursquare request failed:", err);
    return null;
  }
  if (!res.ok) {
    console.warn(`Foursquare search returned ${res.status}`);
    return null;
  }

  const { results } = (await res.json()) as { results: FsqPlace[] };
  const places = results.filter((p) => !p.date_closed).map((p) => toPlace(p, category));

  try {
    await withTimeout(redis.set(cacheKey, JSON.stringify(places), "EX", CACHE_TTL_S));
  } catch (err) {
    console.warn("Redis write failed:", err);
  }
  return places;
}
