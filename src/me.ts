import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { savedPlaces, visits, type PlaceSnapshot } from "./db/schema";
import { isCategory } from "./places";

// Picking a place shouldn't wait on, or fail because of, the database.
const DB_TIMEOUT_MS = 500;
const soft = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Database timed out")), DB_TIMEOUT_MS))]);
  } catch (err) {
    console.warn("Database read failed:", err);
    return fallback;
  }
};

export const DEVICE_RE = /^[0-9a-f-]{36}$/;
export const PLACE_ID_RE = /^[A-Za-z0-9]{8,40}$/;

// Checks a place sent by the browser and keeps only the fields we store.
export function parseSnapshot(raw: unknown): PlaceSnapshot | null {
  const p = raw as Record<string, unknown> | null;
  if (!p || typeof p !== "object") return null;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!str(p.name, 200) || !isCategory(p.category) || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { name: str(p.name, 200), category: p.category, lat, lng, neighborhood: str(p.neighborhood, 100), address: str(p.address, 300) };
}

export async function mine(deviceId: string) {
  const [saved, visited] = await Promise.all([
    db.select({ placeId: savedPlaces.placeId, place: savedPlaces.place, createdAt: savedPlaces.createdAt })
      .from(savedPlaces).where(eq(savedPlaces.deviceId, deviceId)).orderBy(desc(savedPlaces.createdAt)),
    db.select({ placeId: visits.placeId, place: visits.place, mode: visits.mode, lines: visits.lines, rating: visits.rating, createdAt: visits.createdAt })
      .from(visits).where(eq(visits.deviceId, deviceId)).orderBy(desc(visits.createdAt)),
  ]);
  return { saved, visits: visited };
}

export const save = (deviceId: string, placeId: string, place: PlaceSnapshot) =>
  db.insert(savedPlaces).values({ deviceId, placeId, place }).onConflictDoNothing();

export const unsave = (deviceId: string, placeId: string) =>
  db.delete(savedPlaces).where(and(eq(savedPlaces.deviceId, deviceId), eq(savedPlaces.placeId, placeId)));

export const visit = (deviceId: string, placeId: string, place: PlaceSnapshot, mode: string, lines: string[]) =>
  db.insert(visits).values({ deviceId, placeId, place, mode, lines }).onConflictDoNothing();

export const unvisit = (deviceId: string, placeId: string) =>
  db.delete(visits).where(and(eq(visits.deviceId, deviceId), eq(visits.placeId, placeId)));

export const rate = (deviceId: string, placeId: string, rating: 1 | -1) =>
  db.update(visits).set({ rating }).where(and(eq(visits.deviceId, deviceId), eq(visits.placeId, placeId)));

// Places this device has been to, so picks skip them.
export const visitedIds = async (deviceId: string) =>
  (await soft(db.select({ placeId: visits.placeId }).from(visits).where(eq(visits.deviceId, deviceId)), [])).map((r) => r.placeId);

// Net thumbs (ups minus downs) from everyone, for the places that have any.
export async function netRatings(placeIds: string[]) {
  if (!placeIds.length) return new Map<string, number>();
  const rows = await soft(
    db.select({ placeId: visits.placeId, net: sql<number>`sum(${visits.rating})::int` })
      .from(visits).where(and(inArray(visits.placeId, placeIds), sql`${visits.rating} is not null`)).groupBy(visits.placeId),
    [],
  );
  return new Map(rows.map((r) => [r.placeId, r.net]));
}
