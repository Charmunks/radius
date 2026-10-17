import { index, jsonb, pgTable, serial, smallint, text, timestamp, unique } from "drizzle-orm/pg-core";
import type { Category } from "../places";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Enough of a place to list it and link back to it without asking Foursquare again.
export interface PlaceSnapshot {
  name: string;
  category: Category;
  lat: number;
  lng: number;
  neighborhood: string;
  address: string;
}

// Places a device has bookmarked. Devices are anonymous: a random ID kept in a cookie.
export const savedPlaces = pgTable("saved_places", {
  id: serial("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  placeId: text("place_id").notNull(),
  place: jsonb("place").$type<PlaceSnapshot>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [unique().on(t.deviceId, t.placeId)]);

// Places a device has been to ("Been there"). These are left out of future picks, make up
// the trip history and passport, and carry the thumbs up/down that nudges ranking for everyone.
export const visits = pgTable("visits", {
  id: serial("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  placeId: text("place_id").notNull(),
  place: jsonb("place").$type<PlaceSnapshot>().notNull(),
  mode: text("mode").notNull(),
  lines: text("lines").array().notNull().default([]), // Metro lines ridden to get there
  rating: smallint("rating"), // 1 or -1, null until asked
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [unique().on(t.deviceId, t.placeId), index().on(t.placeId)]);
