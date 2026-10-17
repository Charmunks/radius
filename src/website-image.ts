import { redis, withTimeout } from "./redis";

const HIT_TTL_S = 60 * 60 * 24 * 7;
const MISS_TTL_S = 60 * 60 * 24;
const FETCH_TIMEOUT_MS = 4000;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

// Checked in order; the first one a page sets wins.
const IMAGE_KEYS = ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"];

// Website URLs come from Foursquare, so only fetch ones that look like public sites:
// no IP literals, no localhost, and no bare names like "redis" on the Docker network.
function publicUrl(raw: string, base?: URL): URL | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.startsWith("[") || /^[\d.]+$/.test(host)) return null;
  if (/\.(local|localhost|internal|home|lan)$/.test(host)) return null;
  return url;
}

// Follows redirects by hand so every hop gets the same public-URL check.
async function fetchPage(start: URL): Promise<{ url: URL; res: Response } | null> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; yelps/0.1)", Accept: "text/html" },
    });
    const next = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && next) {
      const hopUrl = publicUrl(next, url);
      if (!hopUrl) return null;
      url = hopUrl;
      continue;
    }
    if (!res.ok || !(res.headers.get("content-type") ?? "text/html").includes("html")) return null;
    return { url, res };
  }
  return null;
}

// Reads until </head> or the size cap, since the meta tags live in the head.
async function readHead(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let html = "";
  while (html.length < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
    if (/<\/head>/i.test(html)) break;
  }
  reader.cancel().catch(() => {});
  return html;
}

const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(String.raw`\b${name}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`, "i"));
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
};

const NAMED_ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };

// Some CMSes encode every character of the URL, e.g. "https&#x3a;&#x2f;&#x2f;".
const decodeEntities = (s: string) =>
  s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] !== "#") return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
    const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
  });

export function findImage(html: string, pageUrl: URL): string | null {
  const found = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, "property") ?? attr(tag, "name"))?.toLowerCase();
    const content = attr(tag, "content");
    if (key && content && IMAGE_KEYS.includes(key) && !found.has(key)) found.set(key, decodeEntities(content.trim()));
  }
  for (const key of IMAGE_KEYS) {
    const raw = found.get(key);
    if (!raw) continue;
    try {
      const url = new URL(raw, pageUrl);
      // The page only shows https images.
      if (url.protocol === "https:") return url.href;
    } catch {}
  }
  return null;
}

// The preview image (og:image / twitter:image) a place's website advertises, or null.
export async function websiteImage(website: string): Promise<string | null> {
  const start = publicUrl(website);
  if (!start) return null;
  const cacheKey = `siteimg:v2:${start.href}`;

  try {
    const hit = await withTimeout(redis.get(cacheKey));
    if (hit !== null) return hit || null;
  } catch (err) {
    console.warn("Redis read failed, fetching website directly:", err);
  }

  let image: string | null = null;
  try {
    const page = await fetchPage(start);
    if (page) image = findImage(await readHead(page.res), page.url);
  } catch {
    // Unreachable or slow sites just mean no photo.
  }

  try {
    await withTimeout(redis.set(cacheKey, image ?? "", "EX", image ? HIT_TTL_S : MISS_TTL_S));
  } catch (err) {
    console.warn("Redis write failed:", err);
  }
  return image;
}
