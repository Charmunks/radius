const DC_CENTER = [38.8977, -77.0365]; // White House
const map = L.map("map").setView(DC_CENTER, 13);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  // CORS requests let the service worker cache tiles at their real size; opaque ones count as megabytes each.
  crossOrigin: "",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const layer = L.layerGroup().addTo(map);
const $ = (id) => document.getElementById(id);
const pin = (cls, text) => L.divIcon({ className: "", html: `<div class="pin ${cls}">${text}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// Only allow https links from the API, so nothing unexpected ends up in src or href.
const httpsUrl = (u) => {
  try { return new URL(u).protocol === "https:" ? u : null; } catch { return null; }
};
const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
};
const LAST_KEY = "last-result";
const LAST_MAX_AGE_MS = 6 * 60 * 60 * 1000; // show the last pick on open (and offline) for this long
const ARRIVED_KM = 0.3; // mystery trips reveal themselves this close to the destination station

let start = null; // where the current result's directions start
let customStart = null; // { coords, label } when the user picked somewhere other than their location
let seen = [];
let surprise = false; // whether re-rolls should keep surprising
let pendingShare = null; // a shared link we couldn't open yet, usually because location failed
let current = null; // { a, mystery } for the result on screen
let mine = { saved: [], visits: [] };
let pickingPin = false;
let watchId = null;

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Your browser doesn't support location. Search for a starting point above instead."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.latitude, p.coords.longitude]),
      (err) => reject(new Error(
        err.code === err.PERMISSION_DENIED ? "Location access was denied. Allow it in your browser settings, or search for a starting point above."
          : err.code === err.TIMEOUT ? "Finding your location took too long. Try again."
          : "Couldn't get your location. Try again.",
      )),
      // A fix from the last few minutes is fine, and comes back instantly if the browser has one.
      { timeout: 20000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

const haversineKm = ([aLat, aLng], [bLat, bLng]) => {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

// On mobile the map stays hidden until there's something to show, so Leaflet needs to re-measure it.
function showMap() {
  document.querySelector(".app").classList.add("located");
  map.invalidateSize();
}

const isMetro = (a) => a.mode === "transit" && !a.walkOnly && !a.noMetro;
const shareUrl = (d, mode) => `${location.origin}/?${new URLSearchParams({ place: d.id, mode, cat: d.category })}`;

function render(a, mystery = false) {
  const d = a.destination;
  const metro = isMetro(a);
  // Mystery only works when there's a station to send people to first.
  const hide = mystery && metro;
  current = { a, mystery: hide };
  layer.clearLayers();
  L.marker(start, { icon: pin("you", "★") }).bindPopup(customStart ? "Starting point" : "You are here").addTo(layer);
  const dest = hide ? null : L.marker([d.lat, d.lng], { icon: pin(d.category, "★") }).bindPopup(`<strong>${esc(d.name)}</strong>`).addTo(layer);

  const points = [start];
  if (!hide) points.push([d.lat, d.lng]);
  // Paths come back null when the router was unreachable, so fall back to a straight line.
  const walk = (path, from, to) => {
    const line = path ?? [from, to];
    L.polyline(line, { className: "route-walk", weight: 4, dashArray: "2 8", lineCap: "round" }).addTo(layer);
    points.push(...line);
  };
  if (metro) {
    // walk to the station, ride, then walk to the destination
    walk(a.walkPaths?.toStation, start, a.origin.coords);
    for (const r of a.rides) {
      // A light casing underneath keeps pale lines like Silver and Yellow readable on the map.
      L.polyline(r.path, { className: "route-casing", weight: 12, lineCap: "round", lineJoin: "round" }).addTo(layer);
      L.polyline(r.path, { color: r.color, weight: 8, opacity: 1, lineCap: "round", lineJoin: "round" }).bindTooltip(`${esc(r.line)} Line`).addTo(layer);
      points.push(...r.path);
    }
    if (!hide) walk(a.walkPaths?.fromStation, a.destStation.coords, [d.lat, d.lng]);
    L.marker(a.origin.coords, { icon: pin("metro", "M") }).bindPopup(`Board: ${esc(a.origin.station)}`).addTo(layer);
    L.marker(a.destStation.coords, { icon: pin("metro", "M") }).bindPopup(`Get off: ${esc(a.destStation.name)}`).addTo(layer);
    points.push(a.destStation.coords);
  } else if (a.mode === "driving") {
    const line = a.path ?? [start, [d.lat, d.lng]];
    L.polyline(line, { className: "route-drive", weight: 5, lineCap: "round", lineJoin: "round", ...(a.path ? {} : { dashArray: "4 6" }) }).addTo(layer);
    points.push(...line);
  } else if (a.noMetro) {
    L.polyline([start, [d.lat, d.lng]], { className: "route-ride", weight: 3, dashArray: "4 6" }).addTo(layer);
  } else {
    walk(a.path, start, [d.lat, d.lng]);
  }
  map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
  dest?.openPopup();

  $("dest-name").textContent = hide ? "Mystery destination" : d.name;
  $("dest-meta").textContent = hide
    ? `Somewhere near ${a.destStation.name} station · plan about ${d.minutes} min there`
    : `${d.category} · ${d.neighborhood} · plan about ${d.minutes} min there`;
  $("dest-blurb").textContent = hide ? "Ride to the station below. We'll tell you where you're going when you get there." : d.blurb;

  const img = $("dest-img");
  const imageUrl = hide ? null : httpsUrl(d.imageUrl);
  img.hidden = !imageUrl;
  // Images come from the place's own site, which may block or drop them.
  img.onerror = () => { img.hidden = true; };
  if (imageUrl) img.src = imageUrl;

  const fsq = $("dest-fsq");
  const fsqUrl = httpsUrl(d.foursquareUrl);
  const siteUrl = httpsUrl(d.website) ?? (d.website?.startsWith("http://") ? d.website : null);
  const links = [
    siteUrl && `<a href="${esc(siteUrl)}" target="_blank" rel="noopener">Website</a>`,
    fsqUrl && `<a href="${esc(fsqUrl)}" target="_blank" rel="noopener">View on Foursquare</a>`,
  ].filter(Boolean).join(" · ");
  const address = d.address ? `${esc(d.address)}<br>` : "";
  // Credit the site the photo was found on; the image itself is often on a CDN.
  const credit = imageUrl && siteUrl ? `Photo from ${esc(new URL(siteUrl).hostname.replace(/^www\./, ""))} · ` : "";
  fsq.hidden = hide;
  fsq.innerHTML = `${address}${links}<br>${credit}Place data powered by Foursquare`;

  const lines = a.mode === "walking" || a.walkOnly
    ? [`<strong class="walk">Walk</strong> · about ${a.walkMinutes} min`]
    : a.mode === "driving"
      ? [`<strong class="drive">Drive</strong> · ${a.directKm} km away`]
      : a.noMetro
        ? [`<strong>Transit</strong> · ${a.directKm} km away · check Google Maps for routes`]
        : a.rides.map((r) => `<strong style="color:${esc(r.color)}">${esc(r.line)} Line</strong> · ${r.stops} ${r.stops === 1 ? "stop" : "stops"} · about ${r.minutes} min`);
  $("rides").innerHTML = `<div class="ride-info">${lines.map((l) => `<p>${l}</p>`).join("")}</div>`;
  // The last Metro step names the destination, so a mystery trip swaps it for the reveal.
  const steps = hide
    ? [...a.steps.slice(0, -1), { title: "Reveal your destination", detail: "Once you're out of the station, tap the button below. If your phone can see where you are, it'll reveal itself when you arrive." }]
    : a.steps;
  $("steps").innerHTML = steps.map((s) => `<li><strong>${esc(s.title)}</strong><span>${esc(s.detail)}</span></li>`).join("");
  $("steps").hidden = !steps.length;
  // Everything except Metro routes hands off to Google Maps.
  const directions = metro ? null : httpsUrl(a.directionsUrl);
  $("directions").hidden = !directions;
  if (directions) $("directions-link").href = directions;
  $("reveal").hidden = !hide;
  $("actions").hidden = hide;
  syncPlaceButtons();
  $("result").hidden = false;
  showMap();

  if (hide) watchArrival(a.destStation.coords);
  else stopWatching();
  // Keep the address bar pointing at this place, so reloading or copying the link brings it
  // back. Mystery trips leave it out so it doesn't give the game away.
  history.replaceState(null, "", hide ? "/" : shareUrl(d, a.mode));
  store.set(LAST_KEY, { a, mystery: hide, start, customStart, savedAt: Date.now() });
}

function watchArrival(coords) {
  stopWatching();
  if (!navigator.geolocation) return;
  watchId = navigator.geolocation.watchPosition((p) => {
    if (haversineKm([p.coords.latitude, p.coords.longitude], coords) <= ARRIVED_KM) reveal();
  }, () => {}, { enableHighAccuracy: true, maximumAge: 30000 });
}

function stopWatching() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

function reveal() {
  if (!current?.mystery) return;
  render(current.a, false);
  $("status").textContent = "You made it! Here's where you're headed.";
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

// Sets `start` for a new search: the chosen starting point, or the user's location.
async function locate() {
  if (customStart) {
    start = customStart.coords;
    return true;
  }
  $("status").textContent = "Finding you…";
  try {
    start = await getLocation();
    return true;
  } catch (err) {
    start = null;
    $("status").textContent = err.message;
    return false;
  }
}

const selectedInterests = () => [...$("interests").selectedOptions].map((o) => o.value);

async function fetchAdventure(reroll) {
  const buttons = [$("go"), $("surprise"), $("reroll")];
  const status = $("status");
  const interests = selectedInterests();
  if (!surprise && !interests.length) {
    status.textContent = "Pick at least one thing you're in the mood for, or tap Surprise me.";
    return;
  }

  buttons.forEach((b) => { b.disabled = true; });
  try {
    if (!reroll || !start) {
      seen = [];
      if (!(await locate())) return;
      status.textContent = "Planning…";
    } else {
      status.textContent = "Picking another…";
    }

    const qs = () => new URLSearchParams({
      lat: start[0],
      lng: start[1],
      ...(surprise ? { surprise: "true" } : { interests: interests.join(",") }),
      exclude: seen.join(","),
      price: $("price").value,
      open_now: $("open-now").checked,
      mode: $("mode").value,
      max_minutes: $("max-minutes").value,
    });
    let res = await fetch(`/api/adventure?${qs()}`);
    let note = "";
    // Out of places we haven't shown yet, so go round again from the top.
    if (res.status === 404 && seen.length) {
      note = seen.length === 1 ? "That's the only match. Try more interests or a longer travel time." : "That's all of them. Starting over.";
      seen = [];
      res = await fetch(`/api/adventure?${qs()}`);
    }
    if (res.status === 404) {
      status.textContent = "Nothing nearby matches. Try more interests, a longer travel time or fewer filters.";
      return;
    }
    if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
    const a = await res.json();
    seen.push(a.destination.id);
    status.textContent = note;
    render(a, $("mystery").checked);
    // On mobile the panel is short, so bring the place details into view.
    if (matchMedia("(max-width: 720px)").matches) $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    status.textContent = navigator.onLine ? `Something went wrong: ${err.message}` : "You're offline. Try again when you have signal.";
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}

// Directions to a place someone shared.
async function openShared({ id, mode, cat }) {
  const status = $("status");
  $("mode").value = mode;
  pendingShare = { id, mode, cat };
  syncGoLabel();
  if (!(await locate())) return;
  status.textContent = "Loading the shared place…";
  try {
    const qs = new URLSearchParams({ lat: start[0], lng: start[1], mode, ...(cat ? { cat } : {}) });
    const res = await fetch(`/api/place/${encodeURIComponent(id)}?${qs}`);
    if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
    const a = await res.json();
    pendingShare = null;
    syncGoLabel();
    seen = [a.destination.id];
    status.textContent = "";
    render(a);
  } catch (err) {
    status.textContent = `Couldn't open that link: ${err.message}`;
  }
}

function syncGoLabel() {
  $("go").textContent = pendingShare ? "Show me the way" : customStart ? "Go from here" : "Use my location & go";
}

$("go").addEventListener("click", () => {
  if (pendingShare) return openShared(pendingShare);
  surprise = false;
  fetchAdventure(false);
});
$("surprise").addEventListener("click", () => {
  pendingShare = null;
  syncGoLabel();
  surprise = true;
  fetchAdventure(false);
});
$("reroll").addEventListener("click", () => fetchAdventure(true));
$("reveal").addEventListener("click", reveal);
for (const id of ["mode", "price", "open-now", "max-minutes"]) {
  $(id).addEventListener("change", () => { start = null; });
}
$("interests").addEventListener("change", () => { start = null; });

// Starting somewhere other than here: an address search or a pin on the map.
function setStart(coords, label) {
  customStart = { coords, label };
  start = null;
  pickingPin = false;
  document.querySelector(".app").classList.remove("picking");
  $("start-label").textContent = label;
  $("start-reset").hidden = false;
  $("start-results").hidden = true;
  $("drop-pin").textContent = "Or drop a pin on the map";
  syncGoLabel();
  layer.clearLayers();
  L.marker(coords, { icon: pin("you", "★") }).bindPopup("Starting point").addTo(layer);
  map.setView(coords, Math.max(map.getZoom(), 14));
}

$("start-reset").addEventListener("click", () => {
  customStart = null;
  start = null;
  $("start-label").textContent = "Your current location";
  $("start-reset").hidden = true;
  syncGoLabel();
});

$("start-search").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("start-q").value.trim();
  const list = $("start-results");
  if (!q) return;
  list.hidden = false;
  list.innerHTML = "<li class=\"muted\">Searching…</li>";
  try {
    const res = await fetch(`/api/geocode?${new URLSearchParams({ q })}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? res.statusText);
    if (!body.results.length) {
      list.innerHTML = "<li class=\"muted\">Nothing found. Try adding a street or neighborhood, or drop a pin instead.</li>";
      return;
    }
    list.innerHTML = body.results.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.name)}</button></li>`).join("");
    list.onclick = (ev) => {
      const r = body.results[ev.target.closest("button")?.dataset.i];
      if (r) setStart([r.lat, r.lng], r.name.split(",").slice(0, 2).join(","));
    };
  } catch (err) {
    list.innerHTML = `<li class="muted">${esc(err.message)}</li>`;
  }
});

$("drop-pin").addEventListener("click", () => {
  pickingPin = !pickingPin;
  document.querySelector(".app").classList.toggle("picking", pickingPin);
  $("drop-pin").textContent = pickingPin ? "Tap the map where you'll start (tap here to cancel)" : "Or drop a pin on the map";
  if (pickingPin) {
    showMap();
    if (matchMedia("(max-width: 720px)").matches) $("map").scrollIntoView({ behavior: "smooth" });
  }
});
map.on("click", (e) => {
  if (!pickingPin) return;
  setStart([+e.latlng.lat.toFixed(5), +e.latlng.lng.toFixed(5)], "Dropped pin");
});

// Saved places, visits and ratings, kept per browser by the server.
const snapshot = (d) => ({ name: d.name, category: d.category, lat: d.lat, lng: d.lng, neighborhood: d.neighborhood, address: d.address });
const send = async (method, url, body) => {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
};

async function loadMine() {
  try {
    const res = await fetch("/api/me");
    if (res.ok) mine = await res.json();
  } catch {}
  renderMine();
  syncPlaceButtons();
}

function syncPlaceButtons() {
  if (!current) return;
  const id = current.a.destination.id;
  const saved = mine.saved.some((s) => s.placeId === id);
  const visit = mine.visits.find((v) => v.placeId === id);
  $("save").setAttribute("aria-pressed", String(saved));
  $("save").textContent = saved ? "♥ Saved" : "♡ Save";
  $("visited").setAttribute("aria-pressed", String(!!visit));
  $("visited").textContent = visit ? "✓ Been there" : "Been there";
  $("rate").hidden = !visit || current.mystery;
  for (const b of $("rate").querySelectorAll("button")) b.setAttribute("aria-pressed", String(visit?.rating === Number(b.dataset.rating)));
}

async function act(fn) {
  try {
    await fn();
    await loadMine();
  } catch (err) {
    $("status").textContent = navigator.onLine ? `Couldn't save that: ${err.message}` : "You're offline. Try again when you have signal.";
  }
}

$("save").addEventListener("click", () => act(() => {
  const d = current.a.destination;
  return $("save").getAttribute("aria-pressed") === "true"
    ? send("DELETE", `/api/saved/${d.id}`)
    : send("POST", `/api/saved/${d.id}`, { place: snapshot(d) });
}));
$("visited").addEventListener("click", () => act(() => {
  const { a } = current;
  const d = a.destination;
  if ($("visited").getAttribute("aria-pressed") === "true") return send("DELETE", `/api/visits/${d.id}`);
  const lines = isMetro(a) ? [...new Set(a.rides.map((r) => r.line))] : [];
  return send("POST", `/api/visits/${d.id}`, { place: snapshot(d), mode: a.walkOnly ? "walking" : a.mode, lines });
}));
$("rate").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) act(() => send("PUT", `/api/visits/${current.a.destination.id}/rating`, { rating: Number(b.dataset.rating) }));
});

$("share").addEventListener("click", async () => {
  const { a } = current;
  const url = shareUrl(a.destination, a.mode);
  const data = { title: a.destination.name, text: `Let's go to ${a.destination.name}`, url };
  if (navigator.share) {
    try { await navigator.share(data); return; } catch (err) { if (err.name === "AbortError") return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    $("status").textContent = "Link copied.";
  } catch {
    prompt("Copy this link:", url);
  }
});

function renderMine() {
  const mode = $("mode").value;
  const item = (r, extra = "") => {
    const href = `/?${new URLSearchParams({ place: r.placeId, mode, cat: r.place.category })}`;
    return `<li><a href="${esc(href)}"><span class="dot pin ${esc(r.place.category)}"></span>${esc(r.place.name)}</a><span class="meta">${extra}</span></li>`;
  };
  const date = (s) => new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  $("saved-list").innerHTML = mine.saved.map((s) => item(s, esc(s.place.neighborhood))).join("") || "<li class=\"muted\">Nothing saved yet.</li>";
  $("visit-list").innerHTML = mine.visits.map((v) => item(v, [
    date(v.createdAt),
    v.lines.length ? `${v.lines.map(esc).join(" + ")} Line` : esc(v.mode),
    v.rating === 1 ? "👍" : v.rating === -1 ? "👎" : "",
  ].filter(Boolean).join(" · "))).join("") || "<li class=\"muted\">No trips yet. Places you've been are skipped in future picks.</li>";
}

// What to show on open: a shared link, else the last pick if it's recent (that also covers being offline).
(() => {
  const params = new URLSearchParams(location.search);
  const last = store.get(LAST_KEY);
  const fresh = last && Date.now() - last.savedAt < LAST_MAX_AGE_MS;
  const shared = params.get("place") && {
    id: params.get("place"),
    mode: ["transit", "walking", "driving"].includes(params.get("mode")) ? params.get("mode") : "transit",
    cat: params.get("cat"),
  };
  const matchesLast = shared && last?.a.destination.id === shared.id && last.a.mode === shared.mode;
  if (last && (matchesLast || (!shared && fresh))) {
    start = last.start;
    customStart = last.customStart;
    if (customStart) {
      $("start-label").textContent = customStart.label;
      $("start-reset").hidden = false;
    }
    $("mode").value = last.a.mode;
    seen = [last.a.destination.id];
    render(last.a, last.mystery);
    $("status").textContent = navigator.onLine ? "Here's your last pick." : "You're offline, so here's your last pick.";
  } else if (shared) {
    openShared(shared);
  }
  syncGoLabel();
})();
loadMine();

// The initial theme is set in the page head; this just flips and remembers it.
const root = document.documentElement;
const syncToggle = () => {
  const dark = root.dataset.theme === "dark";
  $("theme-toggle").textContent = dark ? "☀" : "☾";
  $("theme-toggle").setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
};
$("theme-toggle").addEventListener("click", () => {
  root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  try { localStorage.setItem("theme", root.dataset.theme); } catch {}
  syncToggle();
});
syncToggle();

// Caches the app, the last result's map tiles and Leaflet, so directions still work underground.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

// Suggest adding to the home screen on phones, unless it's already installed or was dismissed.
// Android Chrome gives us a real install prompt; iOS Safari only allows the Share menu route.
(() => {
  const installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  let dismissed = false;
  try { dismissed = localStorage.getItem("install-dismissed") === "1"; } catch {}
  if (installed || dismissed || !matchMedia("(max-width: 720px)").matches) return;

  const box = $("install");
  const hide = () => { box.hidden = true; };
  $("install-dismiss").addEventListener("click", () => {
    hide();
    try { localStorage.setItem("install-dismissed", "1"); } catch {}
  });

  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    $("install-text").textContent = "Add Radius to your home screen for one-tap access.";
    $("install-go").hidden = false;
    box.hidden = false;
  });
  $("install-go").addEventListener("click", async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    hide();
  });
  window.addEventListener("appinstalled", hide);

  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) {
    $("install-text").textContent = "Add Radius to your home screen: tap the Share button, then “Add to Home Screen”.";
    box.hidden = false;
  }
})();
