import { afterEach, beforeEach, expect, test } from "bun:test";
import { pickAdventure } from "./adventure";
import { lines, stations } from "./metro";

// Each test starts from its own spot near the White House so they don't share
// Redis cache entries (searchYelp caches by rounded location).
let origin = 0;
const start = () => [38.8977 + 0.002 * ++origin, -77.0365] as const;

const business = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Business ${id}`,
  coordinates: { latitude: 38.9010, longitude: -77.0300 },
  rating: 4.5,
  review_count: 200,
  price: "$$",
  categories: [{ alias: "cafes", title: "Cafes" }],
  location: { city: "Washington", display_address: ["1 Test St", "Washington, DC"] },
  image_url: "https://example.com/photo.jpg",
  url: "https://www.yelp.com/biz/example",
  is_closed: false,
  ...overrides,
});

const realFetch = globalThis.fetch;
const realKey = process.env.YELP_API_KEY;
let requested: URL[] = [];

beforeEach(() => {
  process.env.YELP_API_KEY = "test-key";
  requested = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.YELP_API_KEY;
  else process.env.YELP_API_KEY = realKey;
});

// `wide` is what the second, wider search returns; defaults to the same as the first.
function stubYelp(businesses: unknown[], { status = 200, wide = businesses } = {}) {
  globalThis.fetch = (async (input: string) => {
    const url = new URL(input);
    requested.push(url);
    const body = url.searchParams.get("radius") === "15000" ? wide : businesses;
    return new Response(JSON.stringify({ businesses: body }), { status });
  }) as unknown as typeof fetch;
}

const many = (n: number, prefix = "biz") => Array.from({ length: n }, (_, i) => business(`${prefix}-${i}`));

test("returns a Yelp place with its Yelp fields", async () => {
  stubYelp(many(6));
  const result = await pickAdventure(...start(), ["food"]);
  expect(result).not.toBeNull();
  expect(result).not.toBe("unavailable");
  if (!result || result === "unavailable") return;
  expect(result.destination.source).toBe("yelp");
  expect(result.destination.rating).toBe(4.5);
  expect(result.destination.yelpUrl).toBe("https://www.yelp.com/biz/example");
  expect(result.destination.blurb).toBe("Cafes");
  // Enough strict results, so no wide search.
  expect(requested.every((u) => u.searchParams.get("radius") === "5000")).toBe(true);
});

test("drops closed, low-rated, and thinly reviewed businesses", async () => {
  stubYelp([
    business("closed", { is_closed: true }),
    business("low-rated", { rating: 2.0 }),
    business("few-reviews", { review_count: 3 }),
    business("good", { rating: 4.8 }),
  ], { wide: [] });
  const result = await pickAdventure(...start(), ["food"]);
  if (!result || result === "unavailable") throw new Error("expected a result");
  expect(result.destination.id).toBe("good");
});

test("too few strict results triggers the wide search", async () => {
  stubYelp([business("near")], { wide: [business("near"), business("loose", { rating: 3.2, review_count: 4 })] });
  // Excluding "near" leaves only what the looser wide-pass filters let in.
  const result = await pickAdventure(...start(), ["food"], ["near"]);
  if (!result || result === "unavailable") throw new Error("expected a result");
  expect(result.destination.id).toBe("loose");
  const wide = requested.filter((u) => u.searchParams.get("radius") === "15000");
  expect(wide.length).toBe(1);
  expect(wide[0]!.searchParams.get("sort_by")).toBe("rating");
});

test("returns null when neither search finds anything usable", async () => {
  stubYelp([], { wide: [business("bad", { rating: 2.0 })] });
  expect(await pickAdventure(...start(), ["tourism"])).toBeNull();
});

test("reports Yelp as unavailable when it errors", async () => {
  stubYelp([], { status: 401 });
  expect(await pickAdventure(...start(), ["tourism"])).toBe("unavailable");
});

test("re-roll excludes ids already shown", async () => {
  stubYelp(many(6));
  const [lat, lng] = start();
  const first = await pickAdventure(lat, lng, ["photo"]);
  if (!first || first === "unavailable") throw new Error("expected a result");
  const again = await pickAdventure(lat, lng, ["photo"], [first.destination.id]);
  if (!again || again === "unavailable") throw new Error("expected a result");
  expect(again.destination.id).not.toBe(first.destination.id);
});

test("every station on every line has coordinates", () => {
  const missing = lines.flatMap((l) => l.stations.filter((s) => !stations[s]));
  expect(missing).toEqual([]);
  for (const l of lines) for (const end of l.ends) expect(l.stations).toContain(end);
});
