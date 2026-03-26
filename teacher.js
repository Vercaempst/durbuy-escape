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
let map;
let markers = {};
let initialized = false;

function byId(id) {
  return document.getElementById(id);
}

function login() {
  const email = byId("email")?.value || "";
  const password = byId("password")?.value || "";

  signInWithEmailAndPassword(auth, email, password)
    .catch((error) => {
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
  if (user) {
    byId("loginScreen").style.display = "none";
    byId("appContent").style.display = "block";
    byId("loginStatus").innerText = "Ingelogd als: " + user.email;

    if (!initialized) {
      initialized = true;
      init();
    }
  } else {
    byId("loginScreen").style.display = "block";
    byId("appContent").style.display = "none";
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
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = citiesCache[key]?.name || key;
      select.appendChild(opt);
    });

  if (currentCity && citiesCache[currentCity]) {
    select.value = currentCity;
  }
}

function clearMarkers() {
  Object.values(markers).forEach((marker) => {
    if (map && marker) {
      map.removeLayer(marker);
    }
  });
  markers = {};
}

function updateMarkers() {
  if (!map) return;

  const activeIds = new Set();

  Object.entries(groupsCache).forEach(([id, g]) => {
    if (!g.lat || !g.lng || g.cityKey !== currentCity) return;
    activeIds.add(id);

    if (!markers[id]) {
      markers[id] = L.marker([g.lat, g.lng])
        .addTo(map)
        .on("click", () => showGroupDetail(id, g));
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
    .filter(g => g.cityKey === currentCity)
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  container.innerHTML = "";

  if (!groups.length) {
    container.innerHTML = "<p>Nog geen groepen actief.</p>";
    return;
  }

  groups.forEach((g, i) => {
    const div = document.createElement("div");
    div.className = "rank-item";

    let rightText = `${g.score || 0} punten`;
    if (g.evidenceCount !== undefined) {
      rightText += ` | 🧾 ${g.evidenceCount || 0}`;
    }

    div.innerHTML = `
      <span>${i + 1}. Groep ${g.groupNumber}: ${g.groupName}</span>
      <span>${rightText}</span>
    `;

    container.appendChild(div);
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
    const div = document.createElement("div");
    div.className = "group-card";

    let status = "Bezig";
    if (g.finished) status = "Afgerond";
    else if (g.gatherMode) status = "Verzamelpunt";

    div.innerHTML = `
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

    container.appendChild(div);
  });

  container.querySelectorAll("[data-view]").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute("data-view");
      showGroupDetail(id, groupsCache[id]);
    };
  });

  container.querySelectorAll("[data-next]").forEach((btn) => {
    btn.onclick = () => nextGroup(btn.getAttribute("data-next"));
  });

  container.querySelectorAll("[data-points]").forEach((btn) => {
    btn.onclick = () => addPoints(btn.getAttribute("data-points"));
  });

  container.querySelectorAll("[data-message]").forEach((btn) => {
    btn.onclick = () => sendMessageToGroup(btn.getAttribute("data-message"));
  });

  container.querySelectorAll("[data-reset]").forEach((btn) => {
    btn.onclick = () => resetGroup(btn.getAttribute("data-reset"));
  });
}

function showGroupDetail(id, g) {
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
  const confirmReset = confirm("Reset deze groep?");
  if (!confirmReset) return;

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
  const confirmReset = confirm("Zeker dat je alle groepen wilt resetten?");
  if (!confirmReset) return;

  await set(ref(db, "control/globalReset"), {
    at: Date.now()
  });

  await remove(ref(db, "groups"));
  byId("globalActionFeedback").innerText = "Reset uitgevoerd.";
}

function init() {
  initMap();

  onValue(ref(db, "cities"), (snapshot) => {
    citiesCache = snapshot.val() || {};
    populateCitySelector();
  });

  onValue(ref(db, "control/currentCity"), (snap) => {
    currentCity = snap.val();
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
    updateMarkers();
    renderRanking();
    renderGroups();
  });

  byId("setCityButton").onclick = async () => {
    const val = byId("citySelector").value;
    if (!val) return;
    await set(ref(db, "control/currentCity"), val);
  };

  byId("sendGatherButton").onclick = sendAllToGather;
  byId("resumeGameButton").onclick = resumeGame;
  byId("sendBroadcastButton").onclick = broadcastMessage;
  byId("resetDatabaseButton").onclick = resetDatabase;

  byId("showAllGroupsButton").onclick = () => {
    const entries = Object.entries(groupsCache).filter(([_, g]) => g.cityKey === currentCity);
    if (!entries.length) return;

    const bounds = [];
    entries.forEach(([_, g]) => {
      if (g.lat && g.lng) bounds.push([g.lat, g.lng]);
    });

    if (bounds.length && map) {
      map.fitBounds(bounds, { padding: [30, 30] });
    }
  };

  const searchInput = byId("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const query = searchInput.value.trim().toLowerCase();
      const result = byId("searchResult");
      if (!result) return;

      if (!query) {
        result.innerHTML = "";
        return;
      }

      const matches = Object.entries(groupsCache).filter(([_, g]) => {
        const haystack = `${g.groupName || ""} ${g.groupMembers || ""}`.toLowerCase();
        return g.cityKey === currentCity && haystack.includes(query);
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
  }

  window.__openGroupFromSearch = (id) => {
    if (groupsCache[id]) {
      showGroupDetail(id, groupsCache[id]);
    }
  };
}
