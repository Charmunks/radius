import { afterEach, beforeEach, expect, test } from "bun:test";
import { pickAdventure } from "./adventure";

const WHITE_HOUSE = [38.8977, -77.0365] as const;

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

beforeEach(() => {
  process.env.YELP_API_KEY = "test-key";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.YELP_API_KEY;
  else process.env.YELP_API_KEY = realKey;
});

function stubYelp(businesses: unknown[], status = 200) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ businesses }), { status })) as unknown as typeof fetch;
}

test("returns a Yelp place with its Yelp fields", async () => {
  stubYelp(Array.from({ length: 6 }, (_, i) => business(`biz-${i}`)));
  const result = await pickAdventure(WHITE_HOUSE[0], WHITE_HOUSE[1], ["food"]);
  expect(result).not.toBeNull();
  expect(result!.destination.source).toBe("yelp");
  expect(result!.destination.rating).toBe(4.5);
  expect(result!.destination.yelpUrl).toBe("https://www.yelp.com/biz/example");
  expect(result!.destination.blurb).toBe("Cafes");
});

test("drops closed, low-rated, and thinly reviewed businesses", async () => {
  stubYelp([
    business("closed", { is_closed: true }),
    business("low-rated", { rating: 2.0 }),
    business("few-reviews", { review_count: 3 }),
    business("good", { rating: 4.8 }),
  ]);
  const result = await pickAdventure(WHITE_HOUSE[0], WHITE_HOUSE[1], ["food"]);
  // Only one usable Yelp result, so curated food spots top up the pool.
  expect(result!.destination.id).not.toBe("closed");
  expect(result!.destination.id).not.toBe("low-rated");
  expect(result!.destination.id).not.toBe("few-reviews");
});

test("falls back to curated places when Yelp errors", async () => {
  stubYelp([], 401);
  const result = await pickAdventure(WHITE_HOUSE[0], WHITE_HOUSE[1], ["tourism"]);
  expect(result).not.toBeNull();
  expect(result!.destination.source).toBe("curated");
  expect(result!.destination.category).toBe("tourism");
});

test("re-roll excludes ids already shown", async () => {
  stubYelp([]);
  const first = await pickAdventure(WHITE_HOUSE[0], WHITE_HOUSE[1], ["photo"]);
  const again = await pickAdventure(WHITE_HOUSE[0], WHITE_HOUSE[1], ["photo"], [first!.destination.id]);
  expect(again!.destination.id).not.toBe(first!.destination.id);
});
