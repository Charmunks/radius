const DC_CENTER = [38.8977, -77.0365]; // White House
const map = L.map("map").setView(DC_CENTER, 13);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
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

let start = null;
let seen = [];

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Your browser doesn't support location."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.latitude, p.coords.longitude]),
      (err) => reject(new Error(
        err.code === err.PERMISSION_DENIED ? "Location access was denied. Allow it in your browser settings and try again."
          : err.code === err.TIMEOUT ? "Finding your location took too long. Try again."
          : "Couldn't get your location. Try again.",
      )),
      // A fix from the last few minutes is fine, and comes back instantly if the browser has one.
      { timeout: 20000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

function render(a) {
  const d = a.destination;
  layer.clearLayers();
  L.marker(start, { icon: pin("you", "★") }).bindPopup("You are here").addTo(layer);
  const dest = L.marker([d.lat, d.lng], { icon: pin(d.category, "★") }).bindPopup(`<strong>${esc(d.name)}</strong>`).addTo(layer);

  const points = [start, [d.lat, d.lng]];
  const metro = a.mode === "transit" && !a.walkOnly && !a.noMetro;
  if (metro) {
    // walk to the station, ride, then walk to the destination
    const ridePath = a.ridePath;
    L.polyline([start, a.origin.coords], { className: "route-walk", weight: 3, dashArray: "4 6" }).addTo(layer);
    L.polyline(ridePath, a.rides[0]?.color ? { color: a.rides[0].color, weight: 5 } : { className: "route-ride", weight: 5 }).addTo(layer);
    L.polyline([a.destStation.coords, [d.lat, d.lng]], { className: "route-walk", weight: 3, dashArray: "4 6" }).addTo(layer);
    L.marker(a.origin.coords, { icon: pin("metro", "M") }).bindPopup(`Board: ${esc(a.origin.station)}`).addTo(layer);
    L.marker(a.destStation.coords, { icon: pin("metro", "M") }).bindPopup(`Get off: ${esc(a.destStation.name)}`).addTo(layer);
    points.push(a.origin.coords, a.destStation.coords);
  } else {
    const className = a.mode === "driving" ? "route-drive" : a.noMetro ? "route-ride" : "route-walk";
    L.polyline([start, [d.lat, d.lng]], { className, weight: 3, dashArray: "4 6" }).addTo(layer);
  }
  map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
  dest.openPopup();

  $("dest-name").textContent = d.name;
  $("dest-meta").textContent = `${d.category} · ${d.neighborhood} · plan about ${d.minutes} min there`;
  $("dest-blurb").textContent = d.blurb;

  const img = $("dest-img");
  const imageUrl = httpsUrl(d.imageUrl);
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
  fsq.hidden = false;
  fsq.innerHTML = `${address}${links}<br>${credit}Place data powered by Foursquare`;

  const lines = a.mode === "walking" || a.walkOnly
    ? [`<strong class="walk">Walk</strong> · about ${a.walkMinutes} min`]
    : a.mode === "driving"
      ? [`<strong class="drive">Drive</strong> · ${a.directKm} km away`]
      : a.noMetro
        ? [`<strong>Transit</strong> · ${a.directKm} km away · check Google Maps for routes`]
        : a.rides.map((r) => `<strong style="color:${esc(r.color)}">${esc(r.line)} Line</strong> · ${r.stops} ${r.stops === 1 ? "stop" : "stops"} · about ${r.minutes} min`);
  $("rides").innerHTML = `<div class="ride-info">${lines.map((l) => `<p>${l}</p>`).join("")}</div>`;
  $("steps").innerHTML = a.steps.map((s) => `<li><strong>${esc(s.title)}</strong><span>${esc(s.detail)}</span></li>`).join("");
  $("steps").hidden = !a.steps.length;
  // Everything except Metro routes hands off to Google Maps.
  const directions = metro ? null : httpsUrl(a.directionsUrl);
  $("directions").hidden = !directions;
  if (directions) $("directions-link").href = directions;
  $("result").hidden = false;
}

async function fetchAdventure(reroll) {
  const btn = $("go");
  const status = $("status");
  const interests = [$("interest").value];

  btn.disabled = true;
  if (!reroll || !start) {
    seen = [];
    status.textContent = "Finding you…";
    try {
      start = await getLocation();
    } catch (err) {
      start = null;
      status.textContent = err.message;
      btn.disabled = false;
      return;
    }
    status.textContent = "Planning…";
  } else {
    status.textContent = "Picking another…";
  }

  try {
    const qs = new URLSearchParams({
      lat: start[0],
      lng: start[1],
      interests: interests.join(","),
      exclude: seen.join(","),
      price: $("price").value,
      open_now: $("open-now").checked,
      mode: $("mode").value,
    });
    const res = await fetch(`/api/adventure?${qs}`);
    if (!res.ok) {
      if (res.status === 404 && seen.length) { seen = []; status.textContent = "That's all of them. Starting over."; return; }
      throw new Error((await res.json()).error ?? res.statusText);
    }
    const a = await res.json();
    seen.push(a.destination.id);
    status.textContent = "";
    render(a);
  } catch (err) {
    status.textContent = `Something went wrong: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

$("go").addEventListener("click", () => fetchAdventure(false));
for (const id of ["interest", "mode", "price", "open-now"]) {
  $(id).addEventListener("change", () => { start = null; });
}
$("reroll").addEventListener("click", () => fetchAdventure(true));

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
