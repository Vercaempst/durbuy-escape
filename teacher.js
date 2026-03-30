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
let gameTypesCache = {};
let activeCityKey = null;
let activeGameType = null;
let groupsCache = [];
let markers = {};
let selectedGroupId = null;

let map = null;
let detailMarkers = [];
let detailLines = [];
let cityCheckpointsCache = [];
let listenersInitialized = false;

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

function setTeacherStatus(text, isError = false) {
  const el = byId("globalActionFeedback");
  if (!el) return;
  el.innerText = text || "";
  el.style.color = isError ? "#ffb4b4" : "";
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
      defaultCheckpoints: fallbackCity?.defaultCheckpoints || [],
      gameTypeId: firebaseCity.gameTypeId || ""
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
      defaultCheckpoints: fallbackCity.defaultCheckpoints || [],
      gameTypeId: fallbackCity.gameTypeId || ""
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
    defaultCheckpoints: [],
    gameTypeId: ""
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

function getDefaultModules() {
  return {
    navigation: true,
    questions: true,
    score: true,
    ranking: true,
    timer: false,
    story: false,
    dialogs: false,
    media: false,
    inventory: false,
    collectibles: false,
    searchZones: false,
    hiddenReveal: false,
    clickableItems: false,
    usableItems: false,
    evidenceBook: false,
    fingerprints: false,
    fakeClues: false,
    deduction: false,
    secretRoles: false,
    publicRoles: false,
    roleSwitch: false,
    abilities: false,
    proximity: false,
    sabotage: false,
    effects: false,
    chase: false,
    zoneControl: false,
    trading: false,
    resources: false,
    puzzles: false,
    discovery: false,
    teacherControls: true
  };
}

function getActiveModules() {
  return {
    ...getDefaultModules(),
    ...(activeGameType?.modules || {})
  };
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

async function loadActiveGameTypeForCity(cityKey) {
  const city = getCityRecord(cityKey);
  const gameTypeId = city?.gameTypeId || "";

  if (!gameTypeId) {
    activeGameType = null;
    updateGameTypeInfoUI();
    updateSmartActionPanels();
    return;
  }

  activeGameType = gameTypesCache[gameTypeId] || null;
  updateGameTypeInfoUI();
  updateSmartActionPanels();
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

function updateGameTypeInfoUI() {
  const el = byId("currentGameTypeInfo");
  if (!el) return;

  if (!activeGameType) {
    el.innerText = "Speltype: standaard / niet ingesteld";
    return;
  }

  el.innerText = `Speltype: ${activeGameType.name || "Onbekend"} (${activeGameType.engine || "custom"})`;
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
    const gatherMarkerLayer = L.marker(gather.coords, { icon: gatherIcon() })
      .addTo(map)
      .bindPopup(gather.name || "Verzamelpunt");
    detailMarkers.push(gatherMarkerLayer);
  }

  const bounds = [];

  checkpoints.forEach((cp) => {
    if (Array.isArray(cp.coords)) bounds.push(cp.coords);
  });

  if (typeof group.lat === "number" && typeof group.lng === "number") {
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
    .filter((g) => g.cityKey === activeCityKey && typeof g.lat === "number" && typeof g.lng === "number")
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

  const modules = getActiveModules();

  if (!modules.ranking) {
    container.innerHTML = "<p>Ranking staat uit voor dit speltype.</p>";
    return;
  }

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

    const evidenceText = (group.evidenceCount || 0) > 0 ? ` | 🧾 ${group.evidenceCount || 0}` : "";
    row.innerHTML = `
      <span>${index + 1}. Groep ${group.groupNumber}: ${group.groupName}</span>
      <span>${group.score || 0} punten${evidenceText}</span>
    `;
    container.appendChild(row);
  });
}

function getGroupStateText(group) {
  if (group.finished) return "Afgerond";
  if (group.gatherMode) return "Verzamelpunt";
  return "Bezig";
}

function getRoleText(group) {
  if (!group.role && !group.roles) return "-";

  if (typeof group.role === "string") return group.role;
  if (Array.isArray(group.roles)) return group.roles.join(", ");
  return "-";
}

function getEffectsText(group) {
  if (!group.effects) return "-";
  if (Array.isArray(group.effects)) return group.effects.join(", ");

  const values = Object.values(group.effects || {});
  if (!values.length) return "-";

  return values.map((effect) => effect.type || "effect").join(", ");
}

function renderGroupDetail(group) {
  const container = byId("groupDetailContainer");
  if (!container || !group) return;

  const modules = getActiveModules();

  let extraHtml = "";

  if (modules.secretRoles || modules.publicRoles || modules.roleSwitch) {
    extraHtml += `<p><strong>Rol:</strong> ${getRoleText(group)}</p>`;
  }

  if (modules.effects) {
    extraHtml += `<p><strong>Actieve effecten:</strong> ${getEffectsText(group)}</p>`;
  }

  if (modules.sabotage) {
    extraHtml += `<p><strong>Sabotages gebruikt:</strong> ${group.sabotageUses || 0}</p>`;
  }

  if (modules.chase) {
    extraHtml += `<p><strong>Jachtstatus:</strong> ${group.chaseState || "-"}</p>`;
  }

  if (modules.trading) {
    extraHtml += `<p><strong>Ruilstatus:</strong> ${group.tradeState || "-"}</p>`;
  }

  if (modules.resources) {
    extraHtml += `<p><strong>Resources:</strong> ${group.resourceValue ?? "-"}</p>`;
  }

  container.innerHTML = `
    <h3>Groep ${group.groupNumber}: ${group.groupName}</h3>
    <p><strong>Leden:</strong> ${group.groupMembers || "-"}</p>
    <p><strong>Status:</strong> ${getGroupStateText(group)}</p>
    <p><strong>Speltype:</strong> ${group.gameTypeName || activeGameType?.name || "klassiek"}</p>
    <p><strong>Checkpoint:</strong> ${group.checkpoint || "-"}</p>
    <p><strong>Volgende:</strong> ${group.nextCheckpoint || "-"}</p>
    <p><strong>Score:</strong> ${group.score || 0}</p>
    <p><strong>Items:</strong> ${group.evidenceCount || 0}</p>
    ${extraHtml}
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

  const modules = getActiveModules();

  activeGroups.forEach((group) => {
    let extraHtml = "";

    if (modules.secretRoles || modules.publicRoles || modules.roleSwitch) {
      extraHtml += `<p><strong>Rol:</strong> ${getRoleText(group)}</p>`;
    }

    if (modules.effects) {
      extraHtml += `<p><strong>Effecten:</strong> ${getEffectsText(group)}</p>`;
    }

    const card = document.createElement("div");
    card.className = "group-card";
    card.innerHTML = `
      <h3>Groep ${group.groupNumber}: ${group.groupName}</h3>
      <p><strong>Leden:</strong> ${group.groupMembers || "-"}</p>
      <p><strong>Status:</strong> ${getGroupStateText(group)}</p>
      <p><strong>Speltype:</strong> ${group.gameTypeName || activeGameType?.name || "klassiek"}</p>
      <p><strong>Checkpoint:</strong> ${group.checkpoint || "-"}</p>
      <p><strong>Volgende:</strong> ${group.nextCheckpoint || "-"}</p>
      <p><strong>Score:</strong> ${group.score || 0}</p>
      <p><strong>Items:</strong> ${group.evidenceCount || 0}</p>
      ${extraHtml}

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

async function writeGroupCommand(groupId, payload) {
  await update(ref(db, "groups/" + groupId), payload);
}

async function nextGroup(groupId) {
  await writeGroupCommand(groupId, {
    commandNextAt: Date.now()
  });
  setTeacherStatus("Groep doorgestuurd naar volgend checkpoint.");
}

async function addPoints(groupId) {
  const value = prompt("Hoeveel punten toevoegen?");
  if (value === null || value === "") return;

  await writeGroupCommand(groupId, {
    commandPointsAt: Date.now(),
    commandPointsValue: Number(value)
  });

  setTeacherStatus("Punten aangepast.");
}

async function sendMessageToGroup(groupId) {
  const text = prompt("Bericht naar groep:");
  if (!text) return;

  await writeGroupCommand(groupId, {
    commandMessageAt: Date.now(),
    commandMessageText: text
  });

  setTeacherStatus("Bericht verzonden.");
}

async function resetGroup(groupId) {
  const ok = confirm("Reset deze groep?");
  if (!ok) return;

  await writeGroupCommand(groupId, {
    commandResetAt: Date.now()
  });

  setTeacherStatus("Groepreset verstuurd.");
}

async function sendAllToGather() {
  if (!activeCityKey) return;

  await set(ref(db, "control/globalCommands/" + activeCityKey), {
    type: "gather",
    at: Date.now()
  });

  setTeacherStatus("Iedereen werd naar het verzamelpunt gestuurd.");
}

async function resumeGame() {
  if (!activeCityKey) return;

  await set(ref(db, "control/globalCommands/" + activeCityKey), {
    type: "resume",
    at: Date.now()
  });

  setTeacherStatus("Normaal spel hervat.");
}

async function broadcastMessage() {
  if (!activeCityKey) return;

  const text = byId("broadcastMessageInput")?.value?.trim() || "";
  if (!text) return;

  await set(ref(db, "control/broadcasts/" + activeCityKey), {
    text,
    at: Date.now()
  });

  if (byId("broadcastMessageInput")) byId("broadcastMessageInput").value = "";
  setTeacherStatus("Bericht verzonden.");
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

  setTeacherStatus("Alles gereset, inclusief groepsnummers.");
  selectedGroupId = null;
  removeAllDetailLayers();
}

function fitToAllGroupsAndCheckpoints() {
  if (!map) return;

  const coords = groupsCache
    .filter((g) => g.cityKey === activeCityKey && typeof g.lat === "number" && typeof g.lng === "number")
    .map((g) => [g.lat, g.lng]);

  const city = activeCityKey ? getCityRecord(activeCityKey) : null;
  const gatherCoords = city?.gather?.coords ? [city.gather.coords] : [];
  const checkpointCoords = (cityCheckpointsCache || [])
    .filter((cp) => Array.isArray(cp.coords))
    .map((cp) => cp.coords);

  const allCoords = [...coords, ...checkpointCoords, ...gatherCoords];

  if (!allCoords.length) {
    fitMapToActiveCity();
    return;
  }

  map.fitBounds(allCoords, { padding: [30, 30] });
}

function ensureActionPanel(id, title) {
  let panel = byId(id);
  const parent = byId("smartActionsContainer");
  if (!parent) return null;

  if (!panel) {
    panel = document.createElement("div");
    panel.id = id;
    panel.className = "card";
    panel.innerHTML = `<h2>${title}</h2>`;
    parent.appendChild(panel);
  }

  return panel;
}

function updateSmartActionPanels() {
  const modules = getActiveModules();

  const wrapper = byId("smartActionsContainer");
  if (!wrapper) return;

  wrapper.innerHTML = "";

  if (modules.sabotage || modules.secretRoles || modules.effects) {
    const panel = ensureActionPanel("teacherMolPanel", "Acties voor De mol / sabotage");
    if (panel) {
      panel.innerHTML = `
        <h2>Acties voor De mol / sabotage</h2>
        <p class="small-note">Gebruik deze acties alleen wanneer een groep geselecteerd is.</p>
        <div class="button-grid">
          <button type="button" id="teacherMapBlurButton">Kaart wazig</button>
          <button type="button" id="teacherCompassOffButton">Kompas uit</button>
          <button type="button" id="teacherFreezeButton">Blokkade</button>
          <button type="button" id="teacherStealPointsButton">Punten stelen</button>
          <button type="button" id="teacherShieldButton">Schild geven</button>
          <button type="button" id="teacherFakeTargetButton">Verkeerd doel tonen</button>
        </div>
      `;
    }
  }

  if (modules.chase || modules.roleSwitch || modules.publicRoles) {
    const panel = ensureActionPanel("teacherHuntersPanel", "Acties voor jagers / rollen");
    if (panel) {
      panel.innerHTML = `
        <h2>Acties voor jagers / rollen</h2>
        <p class="small-note">Gebruik deze acties wanneer je rollen of jachtfases wilt sturen.</p>
        <div class="button-grid">
          <button type="button" id="teacherSwitchRoleButton">Rol wisselen</button>
          <button type="button" id="teacherStartChaseButton">Start jachtfase</button>
          <button type="button" id="teacherStopChaseButton">Stop jachtfase</button>
          <button type="button" id="teacherRevealGroupButton">Toon groep op kaart</button>
        </div>
      `;
    }
  }

  if (modules.evidenceBook || modules.fingerprints || modules.fakeClues || modules.deduction) {
    const panel = ensureActionPanel("teacherMurderPanel", "Acties voor onderzoek");
    if (panel) {
      panel.innerHTML = `
        <h2>Acties voor onderzoek</h2>
        <p class="small-note">Extra tools voor moordonderzoek of mysterie.</p>
        <div class="button-grid">
          <button type="button" id="teacherRevealClueButton">Hint / spoor geven</button>
          <button type="button" id="teacherMarkCriticalButton">Markeer cruciaal spoor</button>
          <button type="button" id="teacherSendWitnessButton">Stuur getuigenis</button>
        </div>
      `;
    }
  }

  bindSmartActionButtons();
}

async function applyTimedEffectToGroup(groupId, effectType, durationSeconds = 30, extra = {}) {
  const effectId = `effect_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const now = Date.now();

  await set(ref(db, `groups/${groupId}/effects/${effectId}`), {
    type: effectType,
    startedAt: now,
    endsAt: now + durationSeconds * 1000,
    ...extra
  });
}

function getSelectedGroup() {
  if (!selectedGroupId) return null;
  return groupsCache.find((g) => g.__groupId === selectedGroupId) || null;
}

function requireSelectedGroup() {
  const group = getSelectedGroup();
  if (!group) {
    alert("Selecteer eerst een groep via 'Bekijk'.");
    return null;
  }
  return group;
}

async function teacherMapBlur() {
  const group = requireSelectedGroup();
  if (!group) return;
  await applyTimedEffectToGroup(group.__groupId, "map_blur", 30);
  setTeacherStatus("Kaart wazig effect verstuurd.");
}

async function teacherCompassOff() {
  const group = requireSelectedGroup();
  if (!group) return;
  await applyTimedEffectToGroup(group.__groupId, "compass_off", 30);
  setTeacherStatus("Kompas uit effect verstuurd.");
}

async function teacherFreeze() {
  const group = requireSelectedGroup();
  if (!group) return;
  await applyTimedEffectToGroup(group.__groupId, "freeze", 20);
  setTeacherStatus("Blokkade verstuurd.");
}

async function teacherShield() {
  const group = requireSelectedGroup();
  if (!group) return;
  await applyTimedEffectToGroup(group.__groupId, "shield", 45);
  setTeacherStatus("Schild effect verstuurd.");
}

async function teacherFakeTarget() {
  const group = requireSelectedGroup();
  if (!group) return;
  await applyTimedEffectToGroup(group.__groupId, "fake_target", 30);
  setTeacherStatus("Verkeerd doel effect verstuurd.");
}

async function teacherStealPoints() {
  const source = requireSelectedGroup();
  if (!source) return;

  const targetNumber = prompt("Van welke groep wil je punten afnemen? Geef groepsnummer.");
  if (!targetNumber) return;

  const amount = Number(prompt("Hoeveel punten afnemen?", "10"));
  if (!Number.isFinite(amount)) return;

  const target = groupsCache.find(
    (g) => g.cityKey === activeCityKey && Number(g.groupNumber) === Number(targetNumber)
  );

  if (!target) {
    alert("Doelgroep niet gevonden.");
    return;
  }

  await update(ref(db, `groups/${target.__groupId}`), {
    commandPointsAt: Date.now(),
    commandPointsValue: -Math.abs(amount)
  });

  setTeacherStatus(`Puntenaftrek verstuurd naar groep ${target.groupNumber}.`);
}

async function teacherSwitchRole() {
  const group = requireSelectedGroup();
  if (!group) return;

  const newRole = prompt("Nieuwe rol voor deze groep?", group.role || "");
  if (!newRole) return;

  await update(ref(db, `groups/${group.__groupId}`), {
    role: newRole,
    roleChangedAt: Date.now()
  });

  setTeacherStatus("Rol aangepast.");
}

async function teacherStartChase() {
  const group = requireSelectedGroup();
  if (!group) return;

  await update(ref(db, `groups/${group.__groupId}`), {
    chaseState: "active",
    chaseStartedAt: Date.now()
  });

  setTeacherStatus("Jachtfase gestart voor geselecteerde groep.");
}

async function teacherStopChase() {
  const group = requireSelectedGroup();
  if (!group) return;

  await update(ref(db, `groups/${group.__groupId}`), {
    chaseState: "stopped",
    chaseStoppedAt: Date.now()
  });

  setTeacherStatus("Jachtfase gestopt.");
}

function teacherRevealGroup() {
  const group = requireSelectedGroup();
  if (!group) return;

  if (typeof group.lat === "number" && typeof group.lng === "number" && map) {
    map.setView([group.lat, group.lng], 18);
    setTeacherStatus("Groep in kaart gecentreerd.");
  }
}

async function teacherRevealClue() {
  const group = requireSelectedGroup();
  if (!group) return;

  const clue = prompt("Welke hint of welk spoor wil je sturen?");
  if (!clue) return;

  await update(ref(db, `groups/${group.__groupId}`), {
    commandMessageAt: Date.now(),
    commandMessageText: `Hint: ${clue}`
  });

  setTeacherStatus("Hint verzonden.");
}

async function teacherMarkCritical() {
  const group = requireSelectedGroup();
  if (!group) return;

  await update(ref(db, `groups/${group.__groupId}`), {
    criticalEvidenceHintAt: Date.now()
  });

  setTeacherStatus("Cruciaal spoor gemarkeerd.");
}

async function teacherSendWitness() {
  const group = requireSelectedGroup();
  if (!group) return;

  const text = prompt("Welke getuigenis wil je sturen?");
  if (!text) return;

  await update(ref(db, `groups/${group.__groupId}`), {
    commandMessageAt: Date.now(),
    commandMessageText: `Getuigenis: ${text}`
  });

  setTeacherStatus("Getuigenis verzonden.");
}

function bindSmartActionButtons() {
  byId("teacherMapBlurButton")?.addEventListener("click", teacherMapBlur);
  byId("teacherCompassOffButton")?.addEventListener("click", teacherCompassOff);
  byId("teacherFreezeButton")?.addEventListener("click", teacherFreeze);
  byId("teacherStealPointsButton")?.addEventListener("click", teacherStealPoints);
  byId("teacherShieldButton")?.addEventListener("click", teacherShield);
  byId("teacherFakeTargetButton")?.addEventListener("click", teacherFakeTarget);

  byId("teacherSwitchRoleButton")?.addEventListener("click", teacherSwitchRole);
  byId("teacherStartChaseButton")?.addEventListener("click", teacherStartChase);
  byId("teacherStopChaseButton")?.addEventListener("click", teacherStopChase);
  byId("teacherRevealGroupButton")?.addEventListener("click", teacherRevealGroup);

  byId("teacherRevealClueButton")?.addEventListener("click", teacherRevealClue);
  byId("teacherMarkCriticalButton")?.addEventListener("click", teacherMarkCritical);
  byId("teacherSendWitnessButton")?.addEventListener("click", teacherSendWitness);
}

function bindTeacherUI() {
  const setCityButton = byId("setCityButton");
  if (setCityButton) {
    setCityButton.addEventListener("click", async () => {
      const selected = byId("citySelector")?.value || "";
      if (!selected) return;
      await set(ref(db, "control/currentCity"), selected);
      setTeacherStatus("Actieve stad aangepast.");
    });
  }

  byId("sendGatherButton")?.addEventListener("click", sendAllToGather);
  byId("resumeGameButton")?.addEventListener("click", resumeGame);
  byId("sendBroadcastButton")?.addEventListener("click", broadcastMessage);
  byId("resetDatabaseButton")?.addEventListener("click", resetDatabase);

  byId("showAllGroupsButton")?.addEventListener("click", fitToAllGroupsAndCheckpoints);

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

  onValue(ref(db, "speltypes"), (snapshot) => {
    gameTypesCache = snapshot.val() || {};
    loadActiveGameTypeForCity(activeCityKey);
  });

  onValue(ref(db, "control/currentCity"), async (snapshot) => {
    activeCityKey = snapshot.val() || null;
    populateCitySelector();
    updateCityInfo();
    fitMapToActiveCity();
    cityCheckpointsCache = [];
    await ensureCityCheckpointsLoaded();
    await loadActiveGameTypeForCity(activeCityKey);

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

function startTeacherApp() {
  if (listenersInitialized) return;
  listenersInitialized = true;

  initMap();
  bindTeacherUI();
  initTeacherData();
}

onAuthStateChanged(auth, (user) => {
  setProtectedUIVisible(!!user);
  if (user) startTeacherApp();
});
