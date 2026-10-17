import { afterEach, beforeEach, expect, mock, test } from "bun:test";

// A cache that never hits, so tests don't depend on whatever a local Redis holds.
mock.module("./redis", () => ({
  redis: { get: async () => null, set: async () => "OK" },
  withTimeout: <T>(p: Promise<T>) => p,
}));

const { pickAdventure } = await import("./adventure");
const { lines, stations } = await import("./metro");
const { findImage } = await import("./website-image");

// Near the White House.
const start = () => [38.8977, -77.0365] as const;
const site = (id: string) => `https://${id}.example.com/`;

const place = (id: string, overrides: Record<string, unknown> = {}) => ({
  fsq_place_id: id,
  name: `Place ${id}`,
  latitude: 38.9010,
  longitude: -77.0300,
  categories: [{ fsq_category_id: "4bf58dd8d48988d16d941735", name: "Café" }],
  location: { locality: "Washington", formatted_address: "1 Test St, Washington, DC" },
  website: site(id),
  ...overrides,
});

const ogPage = (image: string) => `<html><head><meta property="og:image" content="${image}"></head><body></body></html>`;

const realFetch = globalThis.fetch;
const realKey = process.env.FOURSQUARE_API_KEY;
let requested: URL[] = [];
let siteFetches: URL[] = [];

beforeEach(() => {
  process.env.FOURSQUARE_API_KEY = "test-key";
  requested = [];
  siteFetches = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.FOURSQUARE_API_KEY;
  else process.env.FOURSQUARE_API_KEY = realKey;
});

// `wide` is what the second, wider search returns; defaults to the same as the first.
// `pages` maps a website URL to its HTML; sites not listed have every place's id as
// a photo unless `photos` is false.
function stub(
  places: unknown[],
  { status = 200, wide = places, pages = {} as Record<string, string | Response>, photos = true } = {},
) {
  globalThis.fetch = (async (input: string | URL) => {
    const url = new URL(input);
    if (url.hostname === "places-api.foursquare.com") {
      requested.push(url);
      const body = url.searchParams.get("radius") === "15000" ? wide : places;
      return new Response(JSON.stringify({ results: body }), { status });
    }
    siteFetches.push(url);
    const page = pages[url.href];
    if (page instanceof Response) return page;
    const html = page ?? (photos ? ogPage(`https://cdn.example.com/${url.hostname.split(".")[0]}.jpg`) : "<html><head></head></html>");
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }) as unknown as typeof fetch;
}

const many = (n: number, prefix = "fsq") => Array.from({ length: n }, (_, i) => place(`${prefix}${i}`));

test("returns a Foursquare place with its website photo", async () => {
  stub(many(6));
  const result = await pickAdventure(...start(), ["food"]);
  expect(result).not.toBeNull();
  expect(result).not.toBe("unavailable");
  if (!result || result === "unavailable") return;
  const d = result.destination;
  expect(d.source).toBe("foursquare");
  expect(d.foursquareUrl).toBe(`https://foursquare.com/v/${d.id}`);
  expect(d.website).toBe(site(d.id));
  expect(d.imageUrl).toBe(`https://cdn.example.com/${d.id}.jpg`);
  expect(d.blurb).toBe("Café");
  expect("rank" in d).toBe(false);
  // Enough near results, so no wide search, and only free-tier fields requested.
  expect(requested.every((u) => u.searchParams.get("radius") === "5000")).toBe(true);
  expect(requested[0]!.searchParams.get("sort")).toBe("RELEVANCE");
  expect(requested[0]!.searchParams.get("fields")).not.toMatch(/rating|stats|price|photos/);
});

test("drops closed places", async () => {
  stub([place("closed", { date_closed: "2025-01-01" }), place("open")], { wide: [] });
  const result = await pickAdventure(...start(), ["food"]);
  if (!result || result === "unavailable") throw new Error("expected a result");
  expect(result.destination.id).toBe("open");
});

test("prefers places whose website has a photo", async () => {
  const places = [...many(5, "plain"), place("pic")];
  stub(places, { photos: false, pages: { [site("pic")]: ogPage("https://cdn.example.com/pic.jpg") } });
  for (let i = 0; i < 5; i++) {
    const result = await pickAdventure(...start(), ["food"]);
    if (!result || result === "unavailable") throw new Error("expected a result");
    expect(result.destination.id).toBe("pic");
    expect(result.destination.imageUrl).toBe("https://cdn.example.com/pic.jpg");
  }
});

test("still picks a place when no website has a photo", async () => {
  stub(many(6, "nopic"), { photos: false });
  const result = await pickAdventure(...start(), ["food"]);
  if (!result || result === "unavailable") throw new Error("expected a result");
  expect(result.destination.imageUrl).toBeUndefined();
});

test("never fetches private or internal website addresses", async () => {
  const internal = ["http://redis:6379/", "http://localhost/", "http://127.0.0.1/", "http://10.0.0.5/", "file:///etc/passwd", "http://[::1]/"];
  stub(internal.map((website, i) => place(`int${i}`, { website })), { wide: [] });
  const result = await pickAdventure(...start(), ["food"]);
  if (!result || result === "unavailable") throw new Error("expected a result");
  expect(siteFetches).toEqual([]);
});

test("does not follow redirects to internal addresses", async () => {
  const redirect = new Response(null, { status: 302, headers: { Location: "http://redis:6379/" } });
  stub([place("hop")], { wide: [], pages: { [site("hop")]: redirect } });
  const result = await pickAdventure(...start(), ["food"]);
  if (!result || result === "unavailable") throw new Error("expected a result");
  expect(siteFetches.map((u) => u.href)).toEqual([site("hop")]);
  expect(result.destination.imageUrl).toBeUndefined();
});

test("findImage handles attribute order, relative URLs, entities and http images", () => {
  const page = new URL("https://diner.example.com/menu/");
  expect(findImage(`<meta content="/img/a.jpg?w=1&amp;h=2" property="og:image">`, page)).toBe("https://diner.example.com/img/a.jpg?w=1&h=2");
  expect(findImage(`<meta name='twitter:image' content='https://cdn.example.com/t.png'>`, page)).toBe("https://cdn.example.com/t.png");
  expect(findImage(`<meta property="og:image" content="https&#x3a;&#x2f;&#x2f;cdn.example.com&#47;x.jpg">`, page)).toBe("https://cdn.example.com/x.jpg");
  expect(findImage(`<meta property="og:image" content="http://insecure.example.com/a.jpg">`, page)).toBeNull();
  expect(findImage(`<meta name="description" content="no image here">`, page)).toBeNull();
});

test("too few near results triggers the wide search", async () => {
  stub([place("near")], { wide: [place("near"), place("far")] });
  // Excluding "near" leaves only what the wide pass found.
  const result = await pickAdventure(...start(), ["food"], ["near"]);
  if (!result || result === "unavailable") throw new Error("expected a result");
  expect(result.destination.id).toBe("far");
  expect(requested.filter((u) => u.searchParams.get("radius") === "15000").length).toBe(1);
});

test("maps the price filter to a Foursquare price range", async () => {
  stub(many(6));
  await pickAdventure(...start(), ["food"], [], { price: "2,3" });
  expect(requested[0]!.searchParams.get("min_price")).toBe("2");
  expect(requested[0]!.searchParams.get("max_price")).toBe("3");
});

test("returns null when neither search finds anything", async () => {
  stub([], { wide: [] });
  expect(await pickAdventure(...start(), ["tourism"])).toBeNull();
});

test("reports Foursquare as unavailable when it errors", async () => {
  stub([], { status: 429 });
  expect(await pickAdventure(...start(), ["tourism"])).toBe("unavailable");
});

test("re-roll excludes ids already shown", async () => {
  stub(many(6));
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

test("walking and driving give a Google Maps link instead of Metro steps", async () => {
  stub(many(6));
  for (const mode of ["walking", "driving"] as const) {
    const result = await pickAdventure(...start(), ["food"], [], {}, mode);
    if (!result || result === "unavailable") throw new Error("expected a result");
    expect(result.mode).toBe(mode);
    expect(result.steps).toEqual([]);
    if (!("directionsUrl" in result)) throw new Error("expected a directions link");
    const url = new URL(result.directionsUrl);
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("travelmode")).toBe(mode);
    expect(url.searchParams.get("origin")).toBe(start().join(","));
    expect(url.searchParams.get("destination")).toBe(`${result.destination.name}, 1 Test St, Washington, DC`);
  }
});

test("transit links to Google Maps walking directions when it says to walk", async () => {
  stub(many(6));
  const result = await pickAdventure(...start(), ["food"]);
  if (!result || result === "unavailable" || result.mode !== "transit") throw new Error("expected a transit result");
  expect(result.walkOnly).toBe(true);
  if (!result.directionsUrl) throw new Error("expected a directions link");
  const url = new URL(result.directionsUrl);
  expect(url.searchParams.get("travelmode")).toBe("walking");
  expect(url.searchParams.get("origin")).toBe(start().join(","));
});

test("only transit needs the place to be near a Metro station", async () => {
  // Out past Great Falls, well over 2 km from any station.
  stub([place("remote", { latitude: 38.998, longitude: -77.253 })], { wide: [] });
  expect(await pickAdventure(...start(), ["tourism"])).toBeNull();
  const result = await pickAdventure(...start(), ["tourism"], [], {}, "driving");
  if (!result || result === "unavailable") throw new Error("expected a result");
  expect(result.destination.id).toBe("remote");
});
