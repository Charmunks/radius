import { RedisClient } from "bun";

export const redis = new RedisClient(process.env.REDIS_URL ?? "redis://localhost:6379");

// Redis calls can hang when the server is down, so cap them. A slow cache should
// never block the page.
const CACHE_TIMEOUT_MS = 300;
export const withTimeout = <T>(p: Promise<T>) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Redis timed out")), CACHE_TIMEOUT_MS))]);
