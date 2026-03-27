import { cities as fallbackCities } from "./cities.js";
import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  update,
  set,
  get,
  remove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

let citiesCache = {};
let activeCityKey = null;
let groupsCache = [];
let markers = {};
let selectedGroupId = null;

let map = null;
let detailMarkers = [];
let detailLines = [];
let cityCheckpointsCache = [];

function byId(id) {
  return document.getElementById(id);
}

function login() {
  const email = byId("email")?.value?.trim() || "";
  const password = byId("password")?.value || "";

  signInWithEmailAndPassword(auth, email, password).catch((error) => {
    alert("Login mislukt: " + error.message);
  });
}

function logout() {
  signOut(auth).catch((error) => {
    alert("Uitloggen mislukt: " + error.message);
  });
}

window.login = login;
window.logout = logout;

function refreshMapSize(delay = 250) {
  setTimeout(() => {
    if (map) map.invalidateSize();
  }, delay);
}

function setProtectedUIVisible(isVisible) {
  const loginScreen = byId("loginScreen");
  const appContent = byId("appContent");
  const loginStatus = byId("loginStatus");

  if (loginScreen) loginScreen.style.display = isVisible ? "none" : "block";
  if (appContent) appContent.style.display = isVisible ? "block" : "none";

  if (loginStatus) {
    loginStatus.innerText =
      isVisible && auth.currentUser
        ? "Ingelogd als: " + auth.currentUser.email
        : "";
  }

  if (isVisible) refreshMapSize(300);
}

function getCityRecord(cityKey) {
  const firebaseCity = citiesCache[cityKey];
  const fallbackCity = fallbackCities[cityKey];

  if (firebaseCity) {
    const center = Array.isArray(firebaseCity.center)
      ? firebaseCity.center
      : fallbackCity?.center || [50.85, 4.35];

    let gather;
    if (Array.isArray(firebaseCity.gather)) {
      gather = {
        name: "Verzamelpunt",
        coords: firebaseCity.gather,
        radius: 40
      };
    } else if (firebaseCity.gather?.coords) {
      gather = {
        name: firebaseCity.gather.name || "Verzamelpunt",
        coords: firebaseCity.gather.coords,
        radius: Number(firebaseCity.gather.radius || 40)
      };
    } else if (fallbackCity) {
      gather = {
        name: fallbackCity.gather?.name || "Verzamelpunt",
        coords: Array.isArray(fallbackCity.gather) ? fallbackCity.gather : (fallbackCity.gather?.coords || fallbackCity.center),
        radius: fallbackCity.gather?.radius || 40
      };
    } else {
      gather = {
        name: "Verzamelpunt",
        coords: center,
        radius: 40
      };
    }

    return {
      name: firebaseCity.name || fallbackCity?.name || cityKey,
      center,
      gather,
      defaultCheckpoints: fallbackCity?.defaultCheckpoints || []
    };
  }

  if (fallbackCity) {
    return {
      name: fallbackCity.name || cityKey,
      center: fallbackCity.center || [50.85, 4.35],
      gather: {
        name: fallbackCity.gather?.name || "Verzamelpunt",
        coords: Array.isArray(fallbackCity.gather) ? fallbackCity.gather : (fallbackCity.gather?.coords || fallbackCity.center),
        radius: fallbackCity.gather?.radius || 40
      },
      defaultCheckpoints: fallbackCity.defaultCheckpoints || []
    };
  }

  return {
    name: cityKey || "Onbekende stad",
    center: [50.85, 4.35],
    gather: {
      name: "Verzamelpunt",
      coords: [50.85, 4.35],
      radius: 40
    },
    defaultCheckpoints: []
  };
}

function mergedCityKeys() {
  return Array.from(
    new Set([
      ...Object.keys(fallbackCities || {}),
      ...Object.keys(citiesCache || {})
    ])
  ).sort((a, b) => a.localeCompare(b));
}

function doneIcon() {
  return L.divIcon({
    className: "custom-emoji-icon",
    html: `<div style="font-size:26px; line-height:26px;">✅</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26]
  });
}

function currentIcon() {
  return L.divIcon({
    className: "custom-emoji-icon",
    html: `<div style="font-size:28px; line-height:28px;">🎯</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28]
  });
}

function todoIcon() {
  return L.divIcon({
    className: "custom-emoji-icon",
    html: `<div style="font-size:26px; line-height:26px;">⏳</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26]
  });
}

function gatherIcon() {
  return L.divIcon({
    className: "custom-emoji-icon",
    html: `<div style="font-size:28px; line-height:28px;">⭐</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28]
  });
}

function initMap() {
  const firstCityKey = Object.keys(fallbackCities)[0] || "durbuy";
  const defaultCenter = getCityRecord(firstCityKey).center;

  map = L.map("map").setView(defaultCenter, 15);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "OpenStreetMap"
  }).addTo(map);

  refreshMapSize(300);
}

function populateCitySelector() {
  const select = byId("citySelector");
  if (!select) return;

  select.innerHTML = "";

  mergedCityKeys().forEach((key) => {
    const city = getCityRecord(key);
    const option = document.createElement("option");
    option.value = key;
    option.textContent = city.name;
    select.appendChild(option);
  });

  if (activeCityKey && mergedCityKeys().includes(activeCityKey)) {
    select.value = activeCityKey;
  }
}

async function loadCheckpointsForCity(cityKey) {
  const snapshot = await get(ref(db, "cityData/" + cityKey + "/checkpoints"));

  if (snapshot.exists()) {
    const data = snapshot.val();
    if (Array.isArray(data) && data.length > 0) {
      return data;
    }
  }

  return getCityRecord(cityKey).defaultCheckpoints || [];
}

async function ensureCityCheckpointsLoaded() {
  if (!activeCityKey) return;
  cityCheckpointsCache = await loadCheckpointsForCity(activeCityKey);
}

function updateCityInfo() {
  const info = byId("currentCityInfo");
  if (!info) return;

  const city = activeCityKey ? getCityRecord(activeCityKey) : null;
  info.innerText = city ? `Actieve stad: ${city.name}` : "Geen actieve stad";
}

function fitMapToActiveCity() {
  if (!map || !activeCityKey) return;
  const city = getCityRecord(activeCityKey);
  map.setView(city.center, 15);
}

function removeAllDetailLayers() {
  detailMarkers.forEach((m) => map && map.removeLayer(m));
  detailLines.forEach((l) => map && map.removeLayer(l));
  detailMarkers = [];
  detailLines = [];
}

async function renderSelectedGroupRoute(group) {
  removeAllDetailLayers();

  if (!group || !map || !activeCityKey) return;
  await ensureCityCheckpointsLoaded();

  const checkpoints = cityCheckpointsCache || [];
  if (!checkpoints.length) return;

  checkpoints.forEach((cp, index) => {
    const marker = L.marker(cp.coords, {
      icon:
        group.finished
          ? doneIcon()
          : index < (group.routeIndex || 0)
            ? doneIcon()
            : index === (group.routeIndex || 0)
              ? currentIcon()
              : todoIcon()
    }).addTo(map).bindPopup(cp.name || `Checkpoint ${index + 1}`);

    detailMarkers.push(marker);
  });

  const gather = getCityRecord(activeCityKey).gather;
  if (gather?.coords) {
    const gatherMarker = L.marker(gather.coords, { icon: gatherIcon() })
      .addTo(map)
      .bindPopup(gather.name || "Verzamelpunt");
    detailMarkers.push(gatherMarker);
  }

  const bounds = [];

  checkpoints.forEach((cp) => {
    if (Array.isArray(cp.coords)) bounds.push(cp.coords);
  });

  if (group.lat && group.lng) {
    const groupMarker = L.circleMarker([group.lat, group.lng], {
      radius: 10,
      color: "#2563eb",
      fillColor: "#60a5fa",
      fillOpacity: 0.8
    }).addTo(map).bindPopup(`Groep ${group.groupNumber}: ${group.groupName}`);
    detailMarkers.push(groupMarker);
    bounds.push([group.lat, group.lng]);
  }

  if (bounds.length) {
    map.fitBounds(bounds, { padding: [30, 30] });
  }
}

function updateMarkers() {
  if (!map) return;

  const activeIds = new Set();

  groupsCache
    .filter((g) => g.cityKey === activeCityKey && g.lat && g.lng)
    .forEach((group) => {
      const groupId = group.__groupId;
      activeIds.add(groupId);

      if (!markers[groupId]) {
        markers[groupId] = L.marker([group.lat, group.lng]).addTo(map);
        markers[groupId].on("click", () => {
          selectedGroupId = groupId;
          renderGroupDetail(group);
        });
      } else {
        markers[groupId].setLatLng([group.lat, group.lng]);
      }
    });

  Object.keys(markers).forEach((groupId) => {
    if (!activeIds.has(groupId)) {
      map.removeLayer(markers[groupId]);
      delete markers[groupId];
    }
  });
}

function renderRanking() {
  const container = byId("rankingContainer");
  if (!container) return;

  container.innerHTML = "";

  const activeGroups = groupsCache
    .filter((g) => g.cityKey === activeCityKey)
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  if (!activeGroups.length) {
    container.innerHTML = "<p>Nog geen groepen actief.</p>";
    return;
  }

  activeGroups.forEach((group, index) => {
    const row = document.createElement("div");
    row.className = "rank-item";
    row.innerHTML = `
      <span>${index + 1}. Groep ${group.groupNumber}: ${group.groupName}</span>
      <span>${group.score || 0} punten | 🧾 ${group.evidenceCount || 0}</span>
    `;
    container.appendChild(row);
  });
}

function renderGroupDetail(group) {
  const container = byId("groupDetailContainer");
  if (!container || !group) return;

  const stateText = group.finished
    ? "Afgerond"
    : group.gatherMode
      ? "Verzamelpunt"
      : "Bezig";

  container.innerHTML = `
    <h3>Groep ${group.groupNumber}: ${group.groupName}</h3>
    <p><strong>Leden:</strong> ${group.groupMembers || "-"}</p>
    <p><strong>Status:</strong> ${stateText}</p>
    <p><strong>Speltype:</strong> ${group.gameTypeName || "klassiek"}</p>
    <p><strong>Checkpoint:</strong> ${group.checkpoint || "-"}</p>
    <p><strong>Volgende:</strong> ${group.nextCheckpoint || "-"}</p>
    <p><strong>Score:</strong> ${group.score || 0}</p>
    <p><strong>Items:</strong> ${group.evidenceCount || 0}</p>
    <p><strong>Laatste update:</strong> ${group.lastUpdated || "-"}</p>
  `;

  renderSelectedGroupRoute(group).catch((error) => {
    console.error("Fout bij tonen van route:", error);
  });
}

function renderGroups() {
  const container = byId("groupsContainer");
  if (!container) return;

  container.innerHTML = "";

  const activeGroups = groupsCache
    .filter((g) => g.cityKey === activeCityKey)
    .sort((a, b) => (a.groupNumber || 0) - (b.groupNumber || 0));

  if (!activeGroups.length) {
    container.innerHTML = "<p>Geen groepen actief.</p>";
    return;
  }

  activeGroups.forEach((group) => {
    const stateText = group.finished
      ? "Afgerond"
      : group.gatherMode
        ? "Verzamelpunt"
        : "Bezig";

    const card = document.createElement("div");
    card.className = "group-card";
    card.innerHTML = `
      <h3>Groep ${group.groupNumber}: ${group.groupName}</h3>
      <p><strong>Leden:</strong> ${group.groupMembers || "-"}</p>
      <p><strong>Status:</strong> ${stateText}</p>
      <p><strong>Speltype:</strong> ${group.gameTypeName || "klassiek"}</p>
      <p><strong>Checkpoint:</strong> ${group.checkpoint || "-"}</p>
      <p><strong>Volgende:</strong> ${group.nextCheckpoint || "-"}</p>
      <p><strong>Score:</strong> ${group.score || 0}</p>
      <p><strong>Items:</strong> ${group.evidenceCount || 0}</p>

      <div class="button-grid">
        <button data-view="${group.__groupId}">Bekijk</button>
        <button data-next="${group.__groupId}">Volgende</button>
        <button data-points="${group.__groupId}">Punten</button>
        <button data-message="${group.__groupId}">Bericht</button>
        <button data-reset="${group.__groupId}">Reset</button>
      </div>
    `;

    container.appendChild(card);
  });

  container.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-view");
      const group = groupsCache.find((g) => g.__groupId === id);
      if (!group) return;
      selectedGroupId = id;
      renderGroupDetail(group);
    });
  });

  container.querySelectorAll("[data-next]").forEach((btn) => {
    btn.addEventListener("click", () => nextGroup(btn.getAttribute("data-next")));
  });

  container.querySelectorAll("[data-points]").forEach((btn) => {
    btn.addEventListener("click", () => addPoints(btn.getAttribute("data-points")));
  });

  container.querySelectorAll("[data-message]").forEach((btn) => {
    btn.addEventListener("click", () => sendMessageToGroup(btn.getAttribute("data-message")));
  });

  container.querySelectorAll("[data-reset]").forEach((btn) => {
    btn.addEventListener("click", () => resetGroup(btn.getAttribute("data-reset")));
  });
}

async function nextGroup(groupId) {
  await update(ref(db, "groups/" + groupId), {
    commandNextAt: Date.now()
  });
}

async function addPoints(groupId) {
  const value = prompt("Hoeveel punten toevoegen?");
  if (value === null || value === "") return;

  await update(ref(db, "groups/" + groupId), {
    commandPointsAt: Date.now(),
    commandPointsValue: Number(value)
  });
}

async function sendMessageToGroup(groupId) {
  const text = prompt("Bericht naar groep:");
  if (!text) return;

  await update(ref(db, "groups/" + groupId), {
    commandMessageAt: Date.now(),
    commandMessageText: text
  });
}

async function resetGroup(groupId) {
  const ok = confirm("Reset deze groep?");
  if (!ok) return;

  await update(ref(db, "groups/" + groupId), {
    commandResetAt: Date.now()
  });
}

async function sendAllToGather() {
  if (!activeCityKey) return;

  await set(ref(db, "control/globalCommands/" + activeCityKey), {
    type: "gather",
    at: Date.now()
  });

  byId("globalActionFeedback").innerText = "Iedereen werd naar het verzamelpunt gestuurd.";
}

async function resumeGame() {
  if (!activeCityKey) return;

  await set(ref(db, "control/globalCommands/" + activeCityKey), {
    type: "resume",
    at: Date.now()
  });

  byId("globalActionFeedback").innerText = "Normaal spel hervat.";
}

async function broadcastMessage() {
  if (!activeCityKey) return;

  const text = byId("broadcastMessageInput")?.value?.trim() || "";
  if (!text) return;

  await set(ref(db, "control/broadcasts/" + activeCityKey), {
    text,
    at: Date.now()
  });

  byId("broadcastMessageInput").value = "";
  byId("globalActionFeedback").innerText = "Bericht verzonden.";
}

async function resetDatabase() {
  const ok = confirm("Zeker dat je alle groepen, tellers, uploads en resetstatussen wilt leegmaken?");
  if (!ok) return;

  const now = Date.now();

  await set(ref(db, "control/globalReset"), { at: now });
  await remove(ref(db, "groups"));
  await remove(ref(db, "meta/groupCounters"));
  await remove(ref(db, "uploadQueue"));
  await remove(ref(db, "photoSubmissions"));

  byId("globalActionFeedback").innerText = "Alles gereset, inclusief groepsnummers.";
  selectedGroupId = null;
  removeAllDetailLayers();
}

function bindTeacherUI() {
  const setCityButton = byId("setCityButton");
  if (setCityButton) {
    setCityButton.addEventListener("click", async () => {
      const selected = byId("citySelector")?.value || "";
      if (!selected) return;
      await set(ref(db, "control/currentCity"), selected);
    });
  }

  byId("sendGatherButton")?.addEventListener("click", sendAllToGather);
  byId("resumeGameButton")?.addEventListener("click", resumeGame);
  byId("sendBroadcastButton")?.addEventListener("click", broadcastMessage);
  byId("resetDatabaseButton")?.addEventListener("click", resetDatabase);

  byId("showAllGroupsButton")?.addEventListener("click", () => {
    if (!map) return;
    const coords = groupsCache
      .filter((g) => g.cityKey === activeCityKey && g.lat && g.lng)
      .map((g) => [g.lat, g.lng]);

    if (!coords.length) {
      fitMapToActiveCity();
      return;
    }

    map.fitBounds(coords, { padding: [30, 30] });
  });

  const searchInput = byId("searchInput");
  const searchResult = byId("searchResult");

  if (searchInput && searchResult) {
    searchInput.addEventListener("input", () => {
      const value = searchInput.value.trim().toLowerCase();

      if (!value) {
        searchResult.innerHTML = "";
        return;
      }

      const matches = groupsCache.filter((group) => {
        if (group.cityKey !== activeCityKey) return false;
        const haystack = `${group.groupName || ""} ${group.groupMembers || ""}`.toLowerCase();
        return haystack.includes(value);
      });

      if (!matches.length) {
        searchResult.innerHTML = "<p>Geen resultaten.</p>";
        return;
      }

      searchResult.innerHTML = matches.map((group) => `
        <div class="group-card">
          <strong>Groep ${group.groupNumber}: ${group.groupName}</strong><br>
          ${group.groupMembers || "-"}<br><br>
          <button type="button" data-search-view="${group.__groupId}">Bekijk</button>
        </div>
      `).join("");

      searchResult.querySelectorAll("[data-search-view]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-search-view");
          const group = groupsCache.find((g) => g.__groupId === id);
          if (!group) return;
          selectedGroupId = id;
          renderGroupDetail(group);
        });
      });
    });
  }
}

function initTeacherData() {
  onValue(ref(db, "cities"), (snapshot) => {
    citiesCache = snapshot.val() || {};
    populateCitySelector();
    updateCityInfo();
  });

  onValue(ref(db, "control/currentCity"), async (snapshot) => {
    activeCityKey = snapshot.val() || null;
    populateCitySelector();
    updateCityInfo();
    fitMapToActiveCity();
    cityCheckpointsCache = [];
    await ensureCityCheckpointsLoaded();

    if (selectedGroupId) {
      const selected = groupsCache.find((g) => g.__groupId === selectedGroupId);
      if (selected) renderGroupDetail(selected);
    }

    renderRanking();
    renderGroups();
    updateMarkers();
  });

  onValue(ref(db, "groups"), (snapshot) => {
    const raw = snapshot.val() || {};
    groupsCache = Object.entries(raw).map(([groupId, value]) => ({
      __groupId: groupId,
      ...value
    }));

    renderRanking();
    renderGroups();
    updateMarkers();

    if (selectedGroupId) {
      const selected = groupsCache.find((g) => g.__groupId === selectedGroupId);
      if (selected) {
        renderGroupDetail(selected);
      } else {
        selectedGroupId = null;
        removeAllDetailLayers();
        const detail = byId("groupDetailContainer");
        if (detail) {
          detail.innerHTML = "<p>Klik op een groep om de volledige route en detailinfo te zien.</p>";
        }
      }
    }
  });
}

let started = false;

function startTeacherApp() {
  if (started) return;
  started = true;

  initMap();
  bindTeacherUI();
  initTeacherData();
}

onAuthStateChanged(auth, (user) => {
  setProtectedUIVisible(!!user);
  if (user) startTeacherApp();
});
