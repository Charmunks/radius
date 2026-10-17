import { CATEGORIES, type Category, type Place } from "./places";
import { redis, withTimeout } from "./redis";

const BASE_URL = "https://places-api.foursquare.com/places";
const API_VERSION = "2025-06-17";
const RADIUS_M = 5000;
const LIMIT = 50;
const CACHE_TTL_S = 60 * 60 * 24;

// Free-tier (Pro) fields only. rating, stats, price and photos are Premium and need paid credits.
const FIELDS = "fsq_place_id,name,latitude,longitude,categories,location,website,date_closed";

// Foursquare category IDs for each of our interest buckets.
const CATEGORY_IDS: Record<Category, string> = {
  // Restaurant, Bakery, Food Truck
  food: "4d4b7105d754a06374d81259,4bf58dd8d48988d16a941735,4bf58dd8d48988d1cb941735",
  // Coffee Shop, Café, Tea Room
  coffee: "4bf58dd8d48988d1e0931735,4bf58dd8d48988d16d941735,4bf58dd8d48988d1dc931735",
  // Bar, Cocktail Bar, Brewery (the top-level Nightlife ID returns nothing)
  nightlife: "4bf58dd8d48988d116941735,4bf58dd8d48988d11e941735,50327c8591d4c4b30a586d5d",
  // Park, Garden, Botanical Garden
  parks: "4bf58dd8d48988d163941735,4bf58dd8d48988d15a941735,52e81612bcbc57f1066b7a22",
  // Museum, Art Museum, History Museum, Science Museum, Art Gallery
  museums: "4bf58dd8d48988d181941735,4bf58dd8d48988d18f941735,4bf58dd8d48988d190941735,4bf58dd8d48988d191941735,4bf58dd8d48988d1e2931735",
  // Monument, Historic and Protected Site, Memorial Site, Tour Provider
  tourism: "4bf58dd8d48988d12d941735,4deefb944765f83613cdba6e,5642206c498e4bfca532186c,56aa371be4b08b9a8d573520",
  // Public Art, Outdoor Sculpture, Scenic Lookout, Bridge
  photo: "507c8c4091d498d9fc8c67a9,52e81612bcbc57f1066b79ed,4bf58dd8d48988d165941735,4bf58dd8d48988d1df941735",
  // Shopping Mall, Bookstore, Flea Market, Thrift / Vintage Store, Clothing Store
  shopping: "4bf58dd8d48988d1fd941735,4bf58dd8d48988d114951735,4bf58dd8d48988d1f7941735,4bf58dd8d48988d101951735,4bf58dd8d48988d103951735",
  // Music Venue, Jazz Club, Rock Club, Concert Hall
  music: "4bf58dd8d48988d1e5931735,4bf58dd8d48988d1e7931735,4bf58dd8d48988d1e9931735,5032792091d4c4b30a586d5c",
};

// Foursquare has no visit length, so use a rough default per bucket.
const MINUTES: Record<Category, number> = {
  food: 60, coffee: 30, nightlife: 90, parks: 45, museums: 90, tourism: 45, photo: 30, shopping: 60, music: 120,
};

// Our bucket for a place looked up by ID, from its Foursquare categories.
function guessCategory(p: FsqPlace): Category {
  const ids = (p.categories ?? []).map((c) => c.fsq_category_id);
  return CATEGORIES.find((c) => ids.some((id) => CATEGORY_IDS[c].includes(id))) ?? "tourism";
}

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

const headers = (apiKey: string) => ({ Authorization: `Bearer ${apiKey}`, "X-Places-Api-Version": API_VERSION, Accept: "application/json" });

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
  const cacheKey = `fsq:search:v3:${category}:${gLat}:${gLng}:${opts.openNow ? 1 : 0}:${opts.price ?? ""}:${radius}`;

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
    res = await fetch(`${BASE_URL}/search?${qs}`, { headers: headers(apiKey) });
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

// One place by its Foursquare ID, for shared links. Returns null when it doesn't exist and
// "unavailable" when Foursquare can't be reached. `category` is our bucket from the link,
// when it has one; otherwise it's guessed from the place's own categories.
export async function getPlace(id: string, category?: Category): Promise<Place | null | "unavailable"> {
  const cacheKey = `fsq:place:v1:${id}`;
  let raw: FsqPlace | null = null;

  try {
    const hit = await withTimeout(redis.get(cacheKey));
    if (hit) raw = JSON.parse(hit) as FsqPlace;
  } catch (err) {
    console.warn("Redis read failed, calling Foursquare directly:", err);
  }

  if (!raw) {
    const apiKey = process.env.FOURSQUARE_API_KEY;
    if (!apiKey) {
      console.warn("FOURSQUARE_API_KEY is not set");
      return "unavailable";
    }
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/${encodeURIComponent(id)}?fields=${FIELDS}`, { headers: headers(apiKey) });
    } catch (err) {
      console.warn("Foursquare request failed:", err);
      return "unavailable";
    }
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) {
      console.warn(`Foursquare place lookup returned ${res.status}`);
      return "unavailable";
    }
    raw = (await res.json()) as FsqPlace;
    try {
      await withTimeout(redis.set(cacheKey, JSON.stringify(raw), "EX", CACHE_TTL_S));
    } catch (err) {
      console.warn("Redis write failed:", err);
    }
  }

  if (raw.date_closed) return null;
  return toPlace(raw, category ?? guessCategory(raw));
}
