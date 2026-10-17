import { lines, stations, type Line } from "./metro";
import { CATEGORIES, type Category, type Place } from "./places";
import { searchPlaces, type SearchOptions } from "./foursquare";
import { websiteImage } from "./website-image";

const WALK_KMH = 4.8;
const MINUTES_PER_STOP = 2; // typical Metro time between stations, dwell included
const MIN_RESULTS = 5; // below this, widen the search
const MAX_STATION_KM = 2; // routing only covers places this close to a Metro station
const DISTANCE_PENALTY = 2; // relevance places lost per km from the user
const TOP_N = 5;
const PHOTO_CHECK_N = 10; // how many top candidates to look up website photos for

// Near search first; the wide pass only runs when the near one finds too little.
const PASSES = [{ radius: 5000 }, { radius: 15000 }] as const;

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export type TravelMode = "transit" | "walking" | "driving";
const MODES: TravelMode[] = ["transit", "walking", "driving"];

export const parseMode = (raw: string | undefined): TravelMode =>
  MODES.includes(raw as TravelMode) ? (raw as TravelMode) : "transit";

// Google Maps directions from the user to the destination, for walking or driving.
export function directionsUrl(lat: number, lng: number, dest: Place, mode: Exclude<TravelMode, "transit">) {
  const qs = new URLSearchParams({
    api: "1",
    origin: `${lat},${lng}`,
    destination: dest.address ? `${dest.name}, ${dest.address}` : `${dest.lat},${dest.lng}`,
    travelmode: mode,
  });
  return `https://www.google.com/maps/dir/?${qs}`;
}

export function parseInterests(raw: string | undefined): Category[] {
  const wanted = (raw ?? "").split(",").filter((c): c is Category => CATEGORIES.includes(c as Category));
  return wanted.length ? wanted : CATEGORIES;
}

const walkMinutes = (km: number) => Math.max(1, Math.round((km / WALK_KMH) * 60));

export function nearestStation(lat: number, lng: number) {
  let best = "";
  let bestKm = Infinity;
  for (const [name, [sLat, sLng]] of Object.entries(stations)) {
    const km = haversineKm(lat, lng, sLat, sLng);
    if (km < bestKm) [best, bestKm] = [name, km];
  }
  return { name: best, km: bestKm };
}

interface Leg {
  line: Line;
  from: string;
  to: string;
  towards: string;
  stops: number;
  stopNames: string[];
}

function leg(line: Line, from: string, to: string): Leg | null {
  const a = line.stations.indexOf(from);
  const b = line.stations.indexOf(to);
  if (a < 0 || b < 0 || a === b) return null;
  const path = a < b ? line.stations.slice(a + 1, b + 1) : line.stations.slice(b, a).reverse();
  return { line, from, to, towards: a < b ? line.ends[1] : line.ends[0], stops: path.length, stopNames: path };
}

// Best route with at most one transfer, preferring fewer stops.
function route(from: string, to: string): Leg[] {
  let best: Leg[] = [];
  let bestCost = Infinity;
  for (const l1 of lines) {
    const direct = leg(l1, from, to);
    if (direct && direct.stops < bestCost) [best, bestCost] = [[direct], direct.stops];
    for (const l2 of lines) {
      if (l1 === l2) continue;
      for (const mid of l1.stations.filter((s) => l2.stations.includes(s))) {
        const first = leg(l1, from, mid);
        const second = leg(l2, mid, to);
        if (!first || !second) continue;
        const cost = first.stops + second.stops + 5;
        if (cost < bestCost) [best, bestCost] = [[first, second], cost];
      }
    }
  }
  return best;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function steps(startKm: number, boardAt: string, legs: Leg[], dest: Place, finalWalkKm: number) {
  const out: { title: string; detail: string }[] = [];
  out.push({
    title: `Walk to ${boardAt}`,
    detail: `It's about ${walkMinutes(startKm)} minutes away (the Metro station). Look for a tall brown pillar with a big "M" on it. That marks a Metro entrance.`,
  });
  out.push({
    title: "Get a fare card (or use your phone)",
    detail: "You need a SmarTrip card, or add one to Apple Wallet or Google Wallet. Fare machines inside the entrance sell cards and add money. Fares depend on distance and time of day.",
  });
  out.push({
    title: "Tap in at the faregates",
    detail: "Touch your card to the round target on the gate and wait for the green light. Keep your card handy because you tap again to leave.",
  });

  legs.forEach((l, i) => {
    const first = i === 0;
    out.push({
      title: first ? `Go down to the ${l.line.name} Line platform` : `Follow signs to the ${l.line.name} Line platform`,
      detail: `Look for the ${l.line.name} Line (${l.line.colorName}) sign and the direction "${l.towards}". That is the last stop of the train you want. Trains going the other way will say the opposite end.`,
    });
    out.push({
      title: `Board a train toward ${l.towards}`,
      detail: `Check the sign above the platform. The train's front screen should say "${l.towards}". Let people get off first, then step on.`,
    });
    out.push({
      title: `Ride ${plural(l.stops, "stop")} to ${l.to}`,
      detail: `You'll pass: ${l.stopNames.join(", ")}. Station names appear on the walls and in announcements. Get off when you hear "${l.to}".`,
    });
    if (i < legs.length - 1) {
      out.push({
        title: `Transfer at ${l.to}`,
        detail: `Stay inside the station and follow the signs for the ${legs[i + 1]!.line.name} Line. You don't need to tap out or pay again when switching trains.`,
      });
    }
  });

  out.push({
    title: "Tap out and exit",
    detail: `Follow "Exit" signs toward the gates and touch your card on the target again. Then take an escalator up to the street.`,
  });
  const mins = walkMinutes(finalWalkKm);
  out.push({
    title: `Walk to ${dest.name}`,
    detail: finalWalkKm > 1.5
      ? `It's about ${mins} minutes on foot from the station, so a bus or rideshare may be easier. Open your phone's map and search for "${dest.name}".`
      : `It's about ${mins} minutes on foot. Open your phone's map, search for "${dest.name}" and follow the walking directions.`,
  });
  return out;
}

interface Candidate extends Place {
  km: number;
  rank: number; // position in Foursquare's relevance order for its search
}

// Foursquare results filtered for the UI's exclusions and, for transit, Metro coverage. Runs a wider
// search when the near one leaves too few. Returns "unavailable" when Foursquare
// couldn't be reached at all.
async function getCandidates(
  lat: number, lng: number, interests: Category[], exclude: string[], opts: SearchOptions, mode: TravelMode,
): Promise<Candidate[] | "unavailable"> {
  const covered = (p: Place) => mode !== "transit" || nearestStation(p.lat, p.lng).km <= MAX_STATION_KM;
  const found = new Map<string, Candidate>();

  for (const [i, pass] of PASSES.entries()) {
    const results = await Promise.all(
      interests.map((c) => searchPlaces(lat, lng, c, { ...opts, radius: pass.radius })),
    );
    if (i === 0 && results.every((r) => r === null)) return "unavailable";
    for (const places of results) {
      places?.forEach((p, rank) => {
        if (found.has(p.id) || exclude.includes(p.id) || !covered(p)) return;
        // Wide-pass results rank below everything from the near pass.
        found.set(p.id, { ...p, km: haversineKm(lat, lng, p.lat, p.lng), rank: rank + i * 100 });
      });
    }
    if (found.size >= MIN_RESULTS) break;
  }

  return [...found.values()];
}

// Foursquare's relevance order, nudged towards places closer to the user.
const score = (p: Candidate) => -(p.rank + DISTANCE_PENALTY * p.km);

// Choose one destination near the user, randomly among the top few by score so repeat
// requests give variety. Places whose website has a photo are preferred; the rest are
// only used when none of the top candidates have one. `exclude` lets the UI re-roll.
// Transit gets step-by-step Metro directions (or a walking link if the place is close);
// walking and driving get a Google Maps link.
export async function pickAdventure(
  lat: number, lng: number, interests: Category[], exclude: string[] = [], opts: SearchOptions = {}, mode: TravelMode = "transit",
) {
  const found = await getCandidates(lat, lng, interests, exclude, opts, mode);
  if (found === "unavailable") return found;
  const candidates = found.sort((a, b) => score(b) - score(a)).slice(0, PHOTO_CHECK_N);
  if (!candidates.length) return null;
  const images = await Promise.all(candidates.map((c) => (c.website ? websiteImage(c.website) : null)));
  const withPhotos = candidates.flatMap((c, i) => (images[i] ? [{ ...c, imageUrl: images[i] }] : []));
  const pool = (withPhotos.length ? withPhotos : candidates).slice(0, TOP_N);
  const { km: directKm, rank: _rank, ...dest } = pool[Math.floor(Math.random() * pool.length)]!;

  if (mode !== "transit") {
    return {
      mode,
      destination: dest,
      directKm: +directKm.toFixed(2),
      walkMinutes: walkMinutes(directKm),
      directionsUrl: directionsUrl(lat, lng, dest, mode),
      steps: [],
    };
  }

  const origin = nearestStation(lat, lng);
  const destSt = nearestStation(dest.lat, dest.lng);
  const destCoords = stations[destSt.name]!;
  const legs = origin.name === destSt.name ? [] : route(origin.name, destSt.name);

  // Close enough that a train would be silly.
  const walkOnly = directKm < 0.8 || (origin.name === destSt.name && directKm < 1.2);

  const ridePath: [number, number][] = [stations[origin.name]!];
  for (const l of legs) ridePath.push(stations[l.to] ?? destCoords);

  return {
    mode,
    destination: dest,
    directKm: +directKm.toFixed(2),
    walkOnly,
    walkMinutes: walkMinutes(directKm),
    // When it's not worth taking the train, hand off to Google Maps walking directions.
    directionsUrl: walkOnly ? directionsUrl(lat, lng, dest, "walking") : undefined,
    origin: { station: origin.name, km: +origin.km.toFixed(2), coords: stations[origin.name]! },
    destStation: { name: destSt.name, coords: destCoords },
    ridePath,
    rides: legs.map((l) => ({
      line: l.line.name,
      color: l.line.color,
      from: l.from,
      to: l.to,
      towards: l.towards,
      stops: l.stops,
      minutes: l.stops * MINUTES_PER_STOP,
    })),
    steps: walkOnly
      ? [{ title: `Walk to ${dest.name}`, detail: `It's only about ${walkMinutes(directKm)} minutes on foot, so skip the train. Use the Google Maps link below for walking directions.` }]
      : steps(origin.km, origin.name, legs, dest, destSt.km),
  };
}
