import { Elysia, type Cookie } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import nunjucks from "nunjucks";
import { parseInterests, parseMaxMinutes, parseMode, pickAdventure, planTripTo } from "./adventure";
import { getPlace } from "./foursquare";
import { geocode } from "./geocode";
import * as me from "./me";
import { CATEGORIES, CATEGORY_LABELS, isCategory } from "./places";

const production = process.env.NODE_ENV === "production";
const SURPRISE_CATEGORIES = 3; // how many random interests "Surprise me" searches

const env = nunjucks.configure("views", {
  autoescape: true,
  noCache: !production,
});

const render = (template: string, context: object = {}) =>
  new Response(env.render(template, context), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Anonymous per-browser ID for saved places and visits, so nobody has to sign up.
function deviceId(cookie: Record<string, Cookie<unknown>>) {
  const current = cookie.device!.value;
  if (typeof current === "string" && me.DEVICE_RE.test(current)) return current;
  const id = crypto.randomUUID();
  cookie.device!.set({ value: id, httpOnly: true, sameSite: "lax", secure: production, path: "/", maxAge: 60 * 60 * 24 * 365 * 2 });
  return id;
}

const parseStart = (query: Record<string, string | undefined>) => {
  const lat = Number(query.lat);
  const lng = Number(query.lng);
  return query.lat && query.lng && Number.isFinite(lat) && Number.isFinite(lng) ? ([lat, lng] as const) : null;
};

const app = new Elysia()
  .use(staticPlugin({ assets: "public", prefix: "/public", ...(production ? {} : { maxAge: 0, directive: "no-cache" }) }))
  .get("/", ({ cookie }) => {
    deviceId(cookie);
    return render("index.njk", {
      categories: CATEGORIES.map((id) => ({ id, label: CATEGORY_LABELS[id] })),
    });
  })
  // The service worker has to be served from the root to control the whole app.
  .get("/sw.js", () => new Response(Bun.file("public/sw.js"), {
    headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" },
  }))
  .get("/api/adventure", async ({ query, cookie }) => {
    const start = parseStart(query);
    if (!start) return json({ error: "lat and lng are required" }, 400);
    const visited = await me.visitedIds(deviceId(cookie));
    const exclude = [...(query.exclude ?? "").split(",").filter(Boolean), ...visited];
    const price = (query.price ?? "").split(",").filter((p) => /^[1-4]$/.test(p)).join(",") || undefined;
    const interests = query.surprise === "true"
      ? [...CATEGORIES].sort(() => Math.random() - 0.5).slice(0, SURPRISE_CATEGORIES)
      : parseInterests(query.interests);
    const adventure = await pickAdventure(start[0], start[1], interests, exclude, {
      openNow: query.open_now === "true",
      price,
    }, parseMode(query.mode), parseMaxMinutes(query.max_minutes));
    if (adventure === "unavailable") return json({ error: "Foursquare is unavailable right now. Try again in a minute." }, 503);
    if (!adventure) return json({ error: "No matching places" }, 404);
    return adventure;
  })
  // Directions to one place, for shared links.
  .get("/api/place/:id", async ({ params, query }) => {
    const start = parseStart(query);
    if (!start) return json({ error: "lat and lng are required" }, 400);
    if (!me.PLACE_ID_RE.test(params.id)) return json({ error: "That place link doesn't look right." }, 404);
    const place = await getPlace(params.id, isCategory(query.cat) ? query.cat : undefined);
    if (place === "unavailable") return json({ error: "Foursquare is unavailable right now. Try again in a minute." }, 503);
    if (!place) return json({ error: "That place couldn't be found. It may have closed." }, 404);
    return planTripTo(start[0], start[1], place, parseMode(query.mode));
  })
  .get("/api/geocode", async ({ query }) => {
    const q = (query.q ?? "").trim().slice(0, 200);
    if (!q) return json({ error: "Type an address or place to search for." }, 400);
    const results = await geocode(q);
    if (!results) return json({ error: "Address search is unavailable right now. Try dropping a pin on the map instead." }, 503);
    return { results };
  })
  .get("/api/me", ({ cookie }) => me.mine(deviceId(cookie)))
  .post("/api/saved/:id", async ({ params, body, cookie }) => {
    const place = me.parseSnapshot((body as { place?: unknown })?.place);
    if (!me.PLACE_ID_RE.test(params.id) || !place) return json({ error: "Invalid place" }, 400);
    await me.save(deviceId(cookie), params.id, place);
    return { ok: true };
  })
  .delete("/api/saved/:id", async ({ params, cookie }) => {
    await me.unsave(deviceId(cookie), params.id);
    return { ok: true };
  })
  .post("/api/visits/:id", async ({ params, body, cookie }) => {
    const b = (body ?? {}) as { place?: unknown; mode?: unknown; lines?: unknown };
    const place = me.parseSnapshot(b.place);
    if (!me.PLACE_ID_RE.test(params.id) || !place) return json({ error: "Invalid place" }, 400);
    const lines = Array.isArray(b.lines) ? b.lines.filter((l): l is string => typeof l === "string").slice(0, 6) : [];
    await me.visit(deviceId(cookie), params.id, place, parseMode(String(b.mode)), lines);
    return { ok: true };
  })
  .delete("/api/visits/:id", async ({ params, cookie }) => {
    await me.unvisit(deviceId(cookie), params.id);
    return { ok: true };
  })
  .put("/api/visits/:id/rating", async ({ params, body, cookie }) => {
    const rating = (body as { rating?: unknown })?.rating;
    if (rating !== 1 && rating !== -1) return json({ error: "rating must be 1 or -1" }, 400);
    await me.rate(deviceId(cookie), params.id, rating);
    return { ok: true };
  })
  .listen(process.env.PORT ?? 3000);

console.log(`Listening on http://${app.server?.hostname}:${app.server?.port}`);
