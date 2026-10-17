import type { Category, Place } from "./places";
import { redis } from "./redis";

const SEARCH_URL = "https://api.yelp.com/v3/businesses/search";
const RADIUS_M = 5000;
const LIMIT = 50;
const CACHE_TTL_S = 60 * 60 * 24;

// Yelp category aliases for each of our interest buckets.
const ALIASES: Record<Category, string> = {
  food: "restaurants,cafes,bakeries,foodtrucks",
  tourism: "landmarks,museums,tours",
  photo: "publicart,parks,observationdecks,gardens",
};

// Yelp has no visit length, so use a rough default per bucket.
const MINUTES: Record<Category, number> = { food: 60, tourism: 90, photo: 40 };

export interface YelpOptions {
  openNow?: boolean;
  price?: string; // comma-separated "1".."4"
  radius?: number; // metres; Yelp caps this at 40000
  sortBy?: "best_match" | "rating";
}

interface YelpBusiness {
  id: string;
  name: string;
  coordinates: { latitude: number; longitude: number };
  rating: number;
  review_count: number;
  price?: string;
  categories: { alias: string; title: string }[];
  location: { city: string; display_address: string[] };
  image_url?: string;
  url: string;
  is_closed: boolean;
}

// Redis calls can hang when the server is down, so cap them. A slow cache should
// never block the page.
const CACHE_TIMEOUT_MS = 300;
const withTimeout = <T>(p: Promise<T>) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Redis timed out")), CACHE_TIMEOUT_MS))]);

// Round to about 100 m so nearby requests share one cache entry.
const grid = (n: number) => Math.round(n * 1000) / 1000;

function toPlace(b: YelpBusiness, category: Category): Place {
  return {
    id: b.id,
    name: b.name,
    category,
    lat: b.coordinates.latitude,
    lng: b.coordinates.longitude,
    neighborhood: b.location.city,
    blurb: b.categories.map((c) => c.title).join(", "),
    minutes: MINUTES[category],
    source: "yelp",
    rating: b.rating,
    reviewCount: b.review_count,
    price: b.price,
    imageUrl: b.image_url,
    yelpUrl: b.url,
    address: b.location.display_address.join(", "),
  };
}

// Returns null when Yelp is unavailable, so callers can tell that apart from "no results".
export async function searchYelp(lat: number, lng: number, category: Category, opts: YelpOptions = {}): Promise<Place[] | null> {
  const [gLat, gLng] = [grid(lat), grid(lng)];
  const radius = opts.radius ?? RADIUS_M;
  const sortBy = opts.sortBy ?? "best_match";
  const cacheKey = `yelp:search:${category}:${gLat}:${gLng}:${opts.openNow ? 1 : 0}:${opts.price ?? ""}:${radius}:${sortBy}`;

  try {
    const hit = await withTimeout(redis.get(cacheKey));
    if (hit) return JSON.parse(hit) as Place[];
  } catch (err) {
    console.warn("Redis read failed, calling Yelp directly:", err);
  }

  const apiKey = process.env.YELP_API_KEY;
  if (!apiKey) {
    console.warn("YELP_API_KEY is not set");
    return null;
  }

  const qs = new URLSearchParams({
    latitude: String(gLat),
    longitude: String(gLng),
    categories: ALIASES[category],
    radius: String(radius),
    limit: String(LIMIT),
    sort_by: sortBy,
  });
  if (opts.openNow) qs.set("open_now", "true");
  if (opts.price) qs.set("price", opts.price);

  let res: Response;
  try {
    res = await fetch(`${SEARCH_URL}?${qs}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch (err) {
    console.warn("Yelp request failed:", err);
    return null;
  }
  if (!res.ok) {
    console.warn(`Yelp search returned ${res.status}`);
    return null;
  }

  const { businesses } = (await res.json()) as { businesses: YelpBusiness[] };
  const places = businesses.filter((b) => !b.is_closed).map((b) => toPlace(b, category));

  try {
    await withTimeout(redis.set(cacheKey, JSON.stringify(places), "EX", CACHE_TTL_S));
  } catch (err) {
    console.warn("Redis write failed:", err);
  }
  return places;
}
