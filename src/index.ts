import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import nunjucks from "nunjucks";

const env = nunjucks.configure("views", {
  autoescape: true,
  noCache: process.env.NODE_ENV !== "production",
});

const render = (template: string, context: object = {}) =>
  new Response(env.render(template, context), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

const app = new Elysia()
  .use(staticPlugin({ assets: "public", prefix: "/public" }))
  .get("/", () => render("index.njk", { message: "Hello, world!" }))
  .listen(process.env.PORT ?? 3000);

console.log(`Listening on http://${app.server?.hostname}:${app.server?.port}`);
