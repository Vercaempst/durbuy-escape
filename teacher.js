import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  update,
  set,
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

let groupsCache = {};
let citiesCache = {};
let currentCity = null;
let map = null;
let markers = {};
let initialized = false;

function byId(id) {
  return document.getElementById(id);
}

function login() {
  const email = byId("email")?.value || "";
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

onAuthStateChanged(auth, (user) => {
  const loginScreen = byId("loginScreen");
  const appContent = byId("appContent");
  const loginStatus = byId("loginStatus");

  if (user) {
    if (loginScreen) loginScreen.style.display = "none";
    if (appContent) appContent.style.display = "block";
    if (loginStatus) loginStatus.innerText = "Ingelogd als: " + user.email;

    if (!initialized) {
      initialized = true;
      init();
    }

    setTimeout(() => {
      if (map) map.invalidateSize();
    }, 250);
  } else {
    if (loginScreen) loginScreen.style.display = "block";
    if (appContent) appContent.style.display = "none";
  }
});

function initMap() {
  map = L.map("map").setView([50.85, 4.35], 14);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "OpenStreetMap"
  }).addTo(map);

  setTimeout(() => {
    map.invalidateSize();
  }, 250);
}

function populateCitySelector() {
  const select = byId("citySelector");
  if (!select) return;

  select.innerHTML = "";

  Object.keys(citiesCache)
    .sort((a, b) => a.localeCompare(b))
    .forEach((key) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = citiesCache[key]?.name || key;
      select.appendChild(option);
    });

  if (currentCity && citiesCache[currentCity]) {
    select.value = currentCity;
  }
}

function updateMarkers() {
  if (!map) return;

  const activeIds = new Set();

  Object.entries(groupsCache).forEach(([id, g]) => {
    if (!g || g.cityKey !== currentCity || !g.lat || !g.lng) return;

    activeIds.add(id);

    if (!markers[id]) {
      markers[id] = L.marker([g.lat, g.lng]).addTo(map);
      markers[id].on("click", () => showGroupDetail(id));
    } else {
      markers[id].setLatLng([g.lat, g.lng]);
    }
  });

  Object.keys(markers).forEach((id) => {
    if (!activeIds.has(id)) {
      map.removeLayer(markers[id]);
      delete markers[id];
    }
  });
}

function renderRanking() {
  const container = byId("rankingContainer");
  if (!container) return;

  const groups = Object.values(groupsCache)
    .filter((g) => g.cityKey === currentCity)
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  container.innerHTML = "";

  if (!groups.length) {
    container.innerHTML = "<p>Nog geen groepen actief.</p>";
    return;
  }

  groups.forEach((g, i) => {
    const row = document.createElement("div");
    row.className = "rank-item";
    row.innerHTML = `
      <span>${i + 1}. Groep ${g.groupNumber}: ${g.groupName}</span>
      <span>${g.score || 0} punten | 🧾 ${g.evidenceCount || 0}</span>
    `;
    container.appendChild(row);
  });
}

function renderGroups() {
  const container = byId("groupsContainer");
  if (!container) return;

  container.innerHTML = "";

  const groups = Object.entries(groupsCache)
    .filter(([_, g]) => g.cityKey === currentCity)
    .sort((a, b) => (a[1].groupNumber || 0) - (b[1].groupNumber || 0));

  if (!groups.length) {
    container.innerHTML = "<p>Geen groepen actief.</p>";
    return;
  }

  groups.forEach(([id, g]) => {
    let status = "Bezig";
    if (g.finished) status = "Afgerond";
    else if (g.gatherMode) status = "Verzamelpunt";

    const card = document.createElement("div");
    card.className = "group-card";
    card.innerHTML = `
      <h3>Groep ${g.groupNumber}: ${g.groupName}</h3>
      <p><strong>Leden:</strong> ${g.groupMembers || "-"}</p>
      <p><strong>Status:</strong> ${status}</p>
      <p><strong>Speltype:</strong> ${g.gameTypeName || "klassiek"}</p>
      <p><strong>Checkpoint:</strong> ${g.checkpoint || "-"}</p>
      <p><strong>Volgende:</strong> ${g.nextCheckpoint || "-"}</p>
      <p><strong>Score:</strong> ${g.score || 0}</p>
      <p><strong>Items:</strong> ${g.evidenceCount || 0}</p>

      <div class="button-grid">
        <button data-view="${id}">Bekijk</button>
        <button data-next="${id}">Volgende</button>
        <button data-points="${id}">Punten</button>
        <button data-message="${id}">Bericht</button>
        <button data-reset="${id}">Reset</button>
      </div>
    `;

    container.appendChild(card);
  });

  container.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => showGroupDetail(btn.getAttribute("data-view")));
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

function showGroupDetail(groupId) {
  const g = groupsCache[groupId];
  const container = byId("groupDetailContainer");
  if (!container || !g) return;

  let status = "Bezig";
  if (g.finished) status = "Afgerond";
  else if (g.gatherMode) status = "Verzamelpunt";

  container.innerHTML = `
    <h3>Groep ${g.groupNumber}: ${g.groupName}</h3>
    <p><strong>Leden:</strong> ${g.groupMembers || "-"}</p>
    <p><strong>Status:</strong> ${status}</p>
    <p><strong>Speltype:</strong> ${g.gameTypeName || "klassiek"}</p>
    <p><strong>Checkpoint:</strong> ${g.checkpoint || "-"}</p>
    <p><strong>Volgende checkpoint:</strong> ${g.nextCheckpoint || "-"}</p>
    <p><strong>Score:</strong> ${g.score || 0}</p>
    <p><strong>Bewijsstukken / items:</strong> ${g.evidenceCount || 0}</p>
    <p><strong>Laatste update:</strong> ${g.lastUpdated || "-"}</p>
  `;

  if (g.lat && g.lng && map) {
    map.setView([g.lat, g.lng], 18);
  }
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
  if (!currentCity) return;

  await set(ref(db, "control/globalCommands/" + currentCity), {
    type: "gather",
    at: Date.now()
  });
}

async function resumeGame() {
  if (!currentCity) return;

  await set(ref(db, "control/globalCommands/" + currentCity), {
    type: "resume",
    at: Date.now()
  });
}

async function broadcastMessage() {
  if (!currentCity) return;

  const text = byId("broadcastMessageInput")?.value?.trim() || "";
  if (!text) return;

  await set(ref(db, "control/broadcasts/" + currentCity), {
    text,
    at: Date.now()
  });

  byId("broadcastMessageInput").value = "";
  byId("globalActionFeedback").innerText = "Bericht verzonden.";
}

async function resetDatabase() {
  const ok = confirm("Zeker dat je alle groepen wilt resetten?");
  if (!ok) return;

  await set(ref(db, "control/globalReset"), {
    at: Date.now()
  });

  await remove(ref(db, "groups"));
  byId("globalActionFeedback").innerText = "Reset uitgevoerd.";
}

function setupSearch() {
  const input = byId("searchInput");
  const result = byId("searchResult");
  if (!input || !result) return;

  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();

    if (!query) {
      result.innerHTML = "";
      return;
    }

    const matches = Object.entries(groupsCache).filter(([_, g]) => {
      if (g.cityKey !== currentCity) return false;
      const haystack = `${g.groupName || ""} ${g.groupMembers || ""}`.toLowerCase();
      return haystack.includes(query);
    });

    if (!matches.length) {
      result.innerHTML = "<p>Geen resultaten.</p>";
      return;
    }

    result.innerHTML = matches.map(([id, g]) => `
      <div class="search-result-card">
        <strong>Groep ${g.groupNumber}: ${g.groupName}</strong><br>
        ${g.groupMembers || "-"}<br>
        <button onclick="window.__openGroupFromSearch('${id}')">Bekijk</button>
      </div>
    `).join("");
  });

  window.__openGroupFromSearch = (id) => {
    showGroupDetail(id);
  };
}

function init() {
  initMap();
  setupSearch();

  onValue(ref(db, "cities"), (snapshot) => {
    citiesCache = snapshot.val() || {};
    populateCitySelector();
    if (currentCity) {
      byId("currentCityInfo").innerText = "Actieve stad: " + (citiesCache[currentCity]?.name || currentCity);
    }
  });

  onValue(ref(db, "control/currentCity"), (snapshot) => {
    currentCity = snapshot.val();
    byId("currentCityInfo").innerText = "Actieve stad: " + (citiesCache[currentCity]?.name || currentCity || "-");

    const select = byId("citySelector");
    if (select && currentCity) {
      select.value = currentCity;
    }

    renderRanking();
    renderGroups();
    updateMarkers();
  });

  onValue(ref(db, "groups"), (snapshot) => {
    groupsCache = snapshot.val() || {};
    renderRanking();
    renderGroups();
    updateMarkers();
  });

  byId("setCityButton").addEventListener("click", async () => {
    const value = byId("citySelector")?.value || "";
    if (!value) return;
    await set(ref(db, "control/currentCity"), value);
  });

  byId("sendGatherButton").addEventListener("click", sendAllToGather);
  byId("resumeGameButton").addEventListener("click", resumeGame);
  byId("sendBroadcastButton").addEventListener("click", broadcastMessage);
  byId("resetDatabaseButton").addEventListener("click", resetDatabase);

  byId("showAllGroupsButton").addEventListener("click", () => {
    if (!map) return;

    const bounds = [];
    Object.values(groupsCache).forEach((g) => {
      if (g.cityKey === currentCity && g.lat && g.lng) {
        bounds.push([g.lat, g.lng]);
      }
    });

    if (bounds.length) {
      map.fitBounds(bounds, { padding: [30, 30] });
    }
  });
}
