import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import nunjucks from "nunjucks";
import { parseInterests, pickAdventure } from "./adventure";
import { places } from "./places";

const env = nunjucks.configure("views", {
  autoescape: true,
  noCache: process.env.NODE_ENV !== "production",
});

const render = (template: string, context: object = {}) =>
  new Response(env.render(template, context), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

const app = new Elysia()
  .use(staticPlugin({ assets: "public", prefix: "/public", ...(process.env.NODE_ENV === "production" ? {} : { maxAge: 0, directive: "no-cache" }) }))
  .get("/", () => render("index.njk"))
  .get("/api/places", () => places)
  .get("/api/adventure", async ({ query }) => {
    const lat = Number(query.lat);
    const lng = Number(query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return new Response(JSON.stringify({ error: "lat and lng are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const exclude = (query.exclude ?? "").split(",").filter(Boolean);
    const price = (query.price ?? "").split(",").filter((p) => /^[1-4]$/.test(p)).join(",") || undefined;
    const adventure = await pickAdventure(lat, lng, parseInterests(query.interests), exclude, {
      openNow: query.open_now === "true",
      price,
    });
    if (!adventure) return new Response(JSON.stringify({ error: "No matching places" }), { status: 404, headers: { "Content-Type": "application/json" } });
    return adventure;
  })
  .listen(process.env.PORT ?? 3000);

console.log(`Listening on http://${app.server?.hostname}:${app.server?.port}`);
