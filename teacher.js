import { cities, getGatherCheckpoint } from "./cities.js";
import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  update,
  set,
  get
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let activeCityKey = null;
let groupsCache = [];
let markers = {};
let groupMessageDrafts = {};
let activeMessageInputGroupId = null;
let lastGroupsRenderSignature = "";
let selectedGroupId = null;

let detailMarkers = [];
let detailLines = [];
let cityCheckpointsCache = [];
let photoSubmissionsCache = {};

const firstCityKey = Object.keys(cities)[0];
const defaultCenter = cities[firstCityKey].center;

let map = L.map("map").setView(defaultCenter, 15);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "OpenStreetMap"
}).addTo(map);

const doneIcon = L.divIcon({
  className: "custom-emoji-icon",
  html: `<div style="font-size:26px; line-height:26px;">✅</div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 26],
  popupAnchor: [0, -22]
});

const currentIcon = L.divIcon({
  className: "custom-emoji-icon",
  html: `<div style="font-size:28px; line-height:28px;">🎯</div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  popupAnchor: [0, -24]
});

const todoIcon = L.divIcon({
  className: "custom-emoji-icon",
  html: `<div style="font-size:26px; line-height:26px;">⏳</div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 26],
  popupAnchor: [0, -22]
});

const gatherIcon = L.divIcon({
  className: "custom-emoji-icon",
  html: `<div style="font-size:28px; line-height:28px;">⭐</div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  popupAnchor: [0, -24]
});

function populateCitySelector() {
  const select = document.getElementById("citySelector");
  select.innerHTML = "";

  Object.entries(cities).forEach(([key, city]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = city.name;
    select.appendChild(option);
  });
}

async function loadCheckpointsForCity(cityKey) {
  const snapshot = await get(ref(db, "cityData/" + cityKey + "/checkpoints"));

  if (snapshot.exists()) {
    const data = snapshot.val();
    if (Array.isArray(data) && data.length > 0) {
      return data;
    }
  }

  return cities[cityKey]?.defaultCheckpoints || [];
}

async function ensureCityCheckpointsLoaded() {
  if (!activeCityKey) return;
  if (cityCheckpointsCache.length > 0) return;

  cityCheckpointsCache = await loadCheckpointsForCity(activeCityKey);
}

function generateRoute(groupNumber, checkpointCount) {
  const start = (groupNumber - 1) % checkpointCount;
  const route = [];

  for (let i = 0; i < checkpointCount; i++) {
    route.push((start + i) % checkpointCount);
  }

  return route;
}

function setMapCity(cityKey) {
  if (!cities[cityKey]) return;

  map.setView(cities[cityKey].center, 15);
  document.getElementById("currentCityInfo").innerText =
    "Actieve stad: " + cities[cityKey].name;
}

function clearMarkersNotInView(validIds) {
  Object.keys(markers).forEach(id => {
    if (!validIds.has(id)) {
      map.removeLayer(markers[id]);
      delete markers[id];
    }
  });
}

function clearDetailLayers() {
  detailMarkers.forEach(marker => map.removeLayer(marker));
  detailLines.forEach(line => map.removeLayer(line));
  detailMarkers = [];
  detailLines = [];
}

function resetToAllGroupsView() {
  selectedGroupId = null;
  clearDetailLayers();
  renderGroupDetail(null);

  if (activeCityKey && cities[activeCityKey]) {
    map.setView(cities[activeCityKey].center, 15);
  }

  lastGroupsRenderSignature = "";
  renderGroups(groupsCache, true);
}

function updateMarker(id, g) {
  if (typeof g.lat !== "number" || typeof g.lng !== "number") return;

  if (!markers[id]) {
    markers[id] = L.marker([g.lat, g.lng]).addTo(map);
  } else {
    markers[id].setLatLng([g.lat, g.lng]);
  }

  const modeText = g.gatherMode ? "Verzamelmodus" : "Normale route";

  markers[id].bindPopup(
    "Groep " + g.groupNumber +
    "<br>" + g.groupName +
    "<br>Leden: " + (g.groupMembers || "-") +
    "<br>Score: " + (g.score || 0) +
    "<br>Volgend checkpoint: " + (g.nextCheckpoint || "-") +
    "<br>" + modeText
  );
}

function renderRanking(groups) {
  const container = document.getElementById("rankingContainer");
  container.innerHTML = "";

  if (groups.length === 0) {
    container.innerHTML = "<p>Geen actieve groepen voor deze stad.</p>";
    return;
  }

  groups
    .slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .forEach((g, index) => {
      const row = document.createElement("div");
      row.className = "rank-item";
      row.innerHTML = `
        <span>${index + 1}. Groep ${g.groupNumber}: ${g.groupName}</span>
        <span>${g.score || 0} punten</span>
      `;
      container.appendChild(row);
    });
}

function buildGroupsSignature(groups) {
  return JSON.stringify(
    groups
      .slice()
      .sort((a, b) => (a.groupNumber || 999) - (b.groupNumber || 999))
      .map(g => ({
        id: g.id,
        groupNumber: g.groupNumber || 0,
        groupName: g.groupName || "",
        groupMembers: g.groupMembers || "",
        checkpoint: g.checkpoint || "",
        nextCheckpoint: g.nextCheckpoint || "",
        lat: typeof g.lat === "number" ? g.lat.toFixed(5) : "",
        lng: typeof g.lng === "number" ? g.lng.toFixed(5) : "",
        score: g.score || 0,
        gatherMode: !!g.gatherMode,
        finished: !!g.finished,
        routeIndex: g.routeIndex || 0,
        lastUpdated: g.lastUpdated || ""
      }))
  );
}

function restoreFocusAfterRender() {
  if (!activeMessageInputGroupId) return;

  const input = document.getElementById("message-" + activeMessageInputGroupId);
  if (!input) return;

  input.focus();

  const len = input.value.length;
  try {
    input.setSelectionRange(len, len);
  } catch (e) {}
}

function getGroupRouteSteps(group) {
  if (!cityCheckpointsCache.length || !group.groupNumber) return [];

  const route = generateRoute(group.groupNumber, cityCheckpointsCache.length);

  return route.map((checkpointIndex, orderIndex) => {
    const cp = cityCheckpointsCache[checkpointIndex];
    const isDone =
      !group.gatherMode &&
      !group.finished &&
      orderIndex < (group.routeIndex || 0);

    const isCurrent =
      !group.gatherMode &&
      !group.finished &&
      orderIndex === (group.routeIndex || 0);

    const isTodo =
      !group.gatherMode &&
      !group.finished &&
      orderIndex > (group.routeIndex || 0);

    return {
      order: orderIndex + 1,
      checkpointIndex,
      cp,
      isDone,
      isCurrent,
      isTodo
    };
  });
}

function getGroupPhotoSubmissions(group) {
  if (!group) return [];

  const byCity = photoSubmissionsCache[activeCityKey] || {};
  const byGroup = byCity[group.id] || byCity[group.groupId] || {};

  return Object.values(byGroup).sort((a, b) =>
    (a.submittedAt || "").localeCompare(b.submittedAt || "")
  );
}

async function renderGroupDetail(group) {
  const container = document.getElementById("groupDetailContainer");

  if (!group) {
    clearDetailLayers();
    container.innerHTML = "<p>Klik op een groep om de volledige route en detailinfo te zien.</p>";
    return;
  }

  await ensureCityCheckpointsLoaded();

  const steps = getGroupRouteSteps(group);
  const photos = getGroupPhotoSubmissions(group);

  let modeText = "Normale route";
  if (group.gatherMode) modeText = "Verzamelmodus";
  if (group.finished) modeText = "Afgerond";

  let routeHtml = "";

  if (group.gatherMode || group.finished) {
    routeHtml += `<div class="group-card"><p>⭐ Doel: verzamelpunt</p></div>`;
  }

  if (!steps.length) {
    routeHtml += `<p>Nog geen checkpointinformatie beschikbaar.</p>`;
  } else {
    routeHtml += `<div class="group-card">`;
    routeHtml += `<p><strong>Volledige route</strong></p>`;

    steps.forEach(step => {
      let prefix = "⏳";
      if (step.isDone) prefix = "✅";
      if (step.isCurrent) prefix = "🎯";

      routeHtml += `<p>${prefix} ${step.order}. ${step.cp.name}</p>`;
    });

    routeHtml += `</div>`;
  }

  let photosHtml = `<div class="group-card"><p><strong>Foto-opdrachten</strong></p>`;

  if (!photos.length) {
    photosHtml += `<p>Nog geen foto's ingediend.</p>`;
  } else {
    photos.forEach(photo => {
      photosHtml += `
        <div style="margin-bottom:14px;">
          <p>${photo.checkpointName || "-"}</p>
          <img src="${photo.photoUrl}" alt="Ingediende foto" style="max-width:100%; border-radius:10px;">
          <p style="font-size:0.9rem;">${photo.submittedAt || "-"}</p>
        </div>
      `;
    });
  }

  photosHtml += `</div>`;

  container.innerHTML = `
    <div class="group-card">
      <h3>Groep ${group.groupNumber}: ${group.groupName}</h3>
      <p><strong>Leden:</strong> ${group.groupMembers || "-"}</p>
      <p><strong>Score:</strong> ${group.score || 0}</p>
      <p><strong>Status:</strong> ${modeText}</p>
      <p><strong>Huidige checkpoint:</strong> ${group.checkpoint || "-"}</p>
      <p><strong>Volgende checkpoint:</strong> ${group.nextCheckpoint || "-"}</p>
      <p><strong>Locatie:</strong> ${
        typeof group.lat === "number" && typeof group.lng === "number"
          ? group.lat.toFixed(5) + ", " + group.lng.toFixed(5)
          : "-"
      }</p>
      <p><strong>Laatst gezien:</strong> ${group.lastUpdated || "-"}</p>
    </div>
    ${routeHtml}
    ${photosHtml}
  `;

  drawGroupDetailOnMap(group, steps);
}

function drawGroupDetailOnMap(group, steps) {
  clearDetailLayers();

  if (!group) return;

  const bounds = [];

  if (typeof group.lat === "number" && typeof group.lng === "number") {
    bounds.push([group.lat, group.lng]);
  }

  if (group.gatherMode || group.finished) {
    const gatherCoords = cities[activeCityKey]?.gather;
    if (gatherCoords) {
      const marker = L.marker(gatherCoords, { icon: gatherIcon })
        .addTo(map)
        .bindPopup("Verzamelpunt");
      detailMarkers.push(marker);
      bounds.push(gatherCoords);

      if (typeof group.lat === "number" && typeof group.lng === "number") {
        const line = L.polyline([[group.lat, group.lng], gatherCoords], {
          weight: 4,
          opacity: 0.8
        }).addTo(map);
        detailLines.push(line);
      }
    }
  } else {
    const routeCoords = [];

    steps.forEach(step => {
      let icon = todoIcon;
      if (step.isDone) icon = doneIcon;
      if (step.isCurrent) icon = currentIcon;

      const marker = L.marker(step.cp.coords, { icon })
        .addTo(map)
        .bindPopup(`${step.order}. ${step.cp.name}`);

      detailMarkers.push(marker);
      bounds.push(step.cp.coords);
      routeCoords.push(step.cp.coords);
    });

    if (routeCoords.length > 1) {
      const routeLine = L.polyline(routeCoords, {
        weight: 3,
        opacity: 0.45,
        dashArray: "6,6"
      }).addTo(map);
      detailLines.push(routeLine);
    }

    const currentStep = steps.find(step => step.isCurrent);
    if (
      currentStep &&
      typeof group.lat === "number" &&
      typeof group.lng === "number"
    ) {
      const currentLine = L.polyline(
        [[group.lat, group.lng], currentStep.cp.coords],
        {
          weight: 5,
          opacity: 0.9
        }
      ).addTo(map);
      detailLines.push(currentLine);
    }
  }

  if (bounds.length === 1) {
    map.setView(bounds[0], 17);
  } else if (bounds.length > 1) {
    map.fitBounds(bounds, { padding: [40, 40] });
  }
}

function renderGroups(groups, force = false) {
  const signature = buildGroupsSignature(groups);

  if (!force && signature === lastGroupsRenderSignature) {
    if (selectedGroupId) {
      const selectedGroup = groups.find(g => g.id === selectedGroupId);
      renderGroupDetail(selectedGroup || null);
    }
    return;
  }

  lastGroupsRenderSignature = signature;

  const container = document.getElementById("groupsContainer");
  container.innerHTML = "";

  if (groups.length === 0) {
    container.innerHTML = "<p>Geen actieve groepen voor deze stad.</p>";
    renderGroupDetail(null);
    return;
  }

  groups
    .slice()
    .sort((a, b) => (a.groupNumber || 999) - (b.groupNumber || 999))
    .forEach(group => {
      const draftValue = groupMessageDrafts[group.id] || "";
      const div = document.createElement("div");
      div.className = "group-card" + (selectedGroupId === group.id ? " selected-card" : "");

      const modeText = group.gatherMode ? "Verzamelmodus" : "Normale route";

      div.innerHTML = `
        <h3>Groep ${group.groupNumber}: ${group.groupName}</h3>

        <p><strong>Leden:</strong> ${group.groupMembers || "-"}</p>
        <p><strong>Checkpoint:</strong> ${group.checkpoint || "-"}</p>
        <p><strong>Volgend checkpoint:</strong> ${group.nextCheckpoint || "-"}</p>
        <p><strong>Locatie:</strong> ${
          typeof group.lat === "number" && typeof group.lng === "number"
            ? group.lat.toFixed(5) + ", " + group.lng.toFixed(5)
            : "-"
        }</p>
        <p><strong>Score:</strong> ${group.score || 0}</p>
        <p><strong>Modus:</strong> ${modeText}</p>

        <p class="small-note">
          <strong>Laatst gezien:</strong> ${group.lastUpdated || "-"}
        </p>

        <button data-action="select" data-id="${group.id}">Bekijk detail en route</button>

        <input
          type="text"
          id="message-${group.id}"
          data-group-id="${group.id}"
          placeholder="Typ bericht voor deze groep"
          value="${draftValue.replace(/"/g, "&quot;")}"
        >

        <div class="group-actions">
          <button data-action="next" data-id="${group.id}">Volgend checkpoint</button>
          <button data-action="plus" data-id="${group.id}">+10 punten</button>
          <button data-action="minus" data-id="${group.id}">-10 punten</button>
          <button data-action="message" data-id="${group.id}">Stuur bericht</button>
          <button data-action="focus" data-id="${group.id}">Toon op kaart</button>
          <button data-action="reset" data-id="${group.id}">Reset groep</button>
        </div>
      `;

      container.appendChild(div);
    });

  container.querySelectorAll("input[data-group-id]").forEach(input => {
    input.addEventListener("focus", (e) => {
      activeMessageInputGroupId = e.target.dataset.groupId;
    });

    input.addEventListener("blur", () => {
      setTimeout(() => {
        const active = document.activeElement;
        if (!active || !active.dataset || !active.dataset.groupId) {
          activeMessageInputGroupId = null;
        }
      }, 50);
    });

    input.addEventListener("input", (e) => {
      const groupId = e.target.dataset.groupId;
      activeMessageInputGroupId = groupId;
      groupMessageDrafts[groupId] = e.target.value;
    });
  });

  container.querySelectorAll("button[data-action]").forEach(button => {
    button.addEventListener("click", async () => {
      const id = button.dataset.id;
      const action = button.dataset.action;

      if (action === "select") {
        selectedGroupId = id;
        lastGroupsRenderSignature = "";
        renderGroups(groupsCache, true);
        const group = groupsCache.find(g => g.id === id);
        await renderGroupDetail(group || null);
      }

      if (action === "next") {
        await update(ref(db, "groups/" + id), {
          commandNextAt: Date.now()
        });
      }

      if (action === "plus") {
        await update(ref(db, "groups/" + id), {
          commandPointsValue: 10,
          commandPointsAt: Date.now()
        });
      }

      if (action === "minus") {
        await update(ref(db, "groups/" + id), {
          commandPointsValue: -10,
          commandPointsAt: Date.now()
        });
      }

      if (action === "message") {
        const text = (groupMessageDrafts[id] || "").trim();
        if (!text) return;

        await update(ref(db, "groups/" + id), {
          commandMessageText: text,
          commandMessageAt: Date.now()
        });

        groupMessageDrafts[id] = "";
        activeMessageInputGroupId = null;
        lastGroupsRenderSignature = "";
        renderGroups(groupsCache, true);
      }

      if (action === "focus") {
        const hit = groupsCache.find(g => g.id === id);
        if (hit && markers[id]) {
          selectedGroupId = id;
          lastGroupsRenderSignature = "";
          renderGroups(groupsCache, true);
          await renderGroupDetail(hit);
          markers[id].openPopup();
          map.setView(markers[id].getLatLng(), 18);
        }
      }

      if (action === "reset") {
        await update(ref(db, "groups/" + id), {
          commandResetAt: Date.now()
        });
      }
    });
  });

  restoreFocusAfterRender();

  if (selectedGroupId) {
    const selectedGroup = groups.find(g => g.id === selectedGroupId);
    renderGroupDetail(selectedGroup || null);
  }
}

function renderSearchResult(hit) {
  const container = document.getElementById("searchResult");

  if (!hit) {
    container.innerHTML = "<p>Geen leerling of groep gevonden.</p>";
    return;
  }

  container.innerHTML = `
    <div class="group-card">
      <h3>Zoekresultaat: Groep ${hit.groupNumber}: ${hit.groupName}</h3>
      <p><strong>Leden:</strong> ${hit.groupMembers || "-"}</p>
      <p><strong>Checkpoint:</strong> ${hit.checkpoint || "-"}</p>
      <p><strong>Volgend checkpoint:</strong> ${hit.nextCheckpoint || "-"}</p>
      <p><strong>Locatie:</strong> ${
        typeof hit.lat === "number" && typeof hit.lng === "number"
          ? hit.lat.toFixed(5) + ", " + hit.lng.toFixed(5)
          : "-"
      }</p>
      <p><strong>Score:</strong> ${hit.score || 0}</p>
      <button id="focusSearchResultButton">Toon op kaart en route</button>
    </div>
  `;

  document.getElementById("focusSearchResultButton").addEventListener("click", async () => {
    selectedGroupId = hit.id;
    lastGroupsRenderSignature = "";
    renderGroups(groupsCache, true);
    await renderGroupDetail(hit);
    if (markers[hit.id]) {
      markers[hit.id].openPopup();
      map.setView(markers[hit.id].getLatLng(), 18);
    }
  });
}

function applySearch(query) {
  const q = query.toLowerCase().trim();

  if (!q) {
    document.getElementById("searchResult").innerHTML = "";
    return;
  }

  const hit = groupsCache.find(g =>
    (g.groupMembers || "").toLowerCase().includes(q) ||
    (g.groupName || "").toLowerCase().includes(q)
  );

  renderSearchResult(hit);
}

populateCitySelector();

document.getElementById("setCityButton").addEventListener("click", async () => {
  const cityKey = document.getElementById("citySelector").value;
  await set(ref(db, "control/currentCity"), cityKey);
});

document.getElementById("sendGatherButton").addEventListener("click", async () => {
  if (!activeCityKey) return;

  const gather = getGatherCheckpoint(activeCityKey);

  await set(ref(db, "control/globalCommands/" + activeCityKey), {
    type: "gather",
    at: Date.now(),
    checkpointName: gather.name,
    coords: gather.coords,
    radius: gather.radius
  });

  document.getElementById("globalActionFeedback").innerText =
    "Iedereen is naar het verzamelpunt gestuurd.";
});

document.getElementById("resumeGameButton").addEventListener("click", async () => {
  if (!activeCityKey) return;

  await set(ref(db, "control/globalCommands/" + activeCityKey), {
    type: "resume",
    at: Date.now()
  });

  document.getElementById("globalActionFeedback").innerText =
    "Het normale spel is hervat.";
});

document.getElementById("sendBroadcastButton").addEventListener("click", async () => {
  if (!activeCityKey) return;

  const input = document.getElementById("broadcastMessageInput");
  const text = input.value.trim();

  if (!text) return;

  await set(ref(db, "control/broadcasts/" + activeCityKey), {
    text: text,
    at: Date.now()
  });

  document.getElementById("globalActionFeedback").innerText =
    "Bericht naar alle groepen verstuurd.";

  input.value = "";
});

document.getElementById("resetDatabaseButton").addEventListener("click", async () => {
  const confirmReset = confirm(
    "Ben je zeker?\n\nAlle groepen worden verwijderd, groepnummers worden gereset en alle open leerlingtoestellen worden terug naar het startscherm gestuurd."
  );

  if (!confirmReset) return;

  const resetTime = Date.now();

  await set(ref(db, "control/globalReset"), {
    at: resetTime
  });

  await set(ref(db, "groups"), null);
  await set(ref(db, "meta/groupCounters"), null);

  selectedGroupId = null;
  clearDetailLayers();

  alert("Database volledig gereset.");
});

document.getElementById("showAllGroupsButton").addEventListener("click", () => {
  resetToAllGroupsView();
});

document.getElementById("searchInput").addEventListener("input", (e) => {
  applySearch(e.target.value);
});

onValue(ref(db, "control/currentCity"), async (snapshot) => {
  const cityKey = snapshot.val();

  activeCityKey = cityKey;

  if (cityKey && cities[cityKey]) {
    document.getElementById("citySelector").value = cityKey;
    setMapCity(cityKey);
    cityCheckpointsCache = await loadCheckpointsForCity(cityKey);
  } else {
    cityCheckpointsCache = [];
    document.getElementById("currentCityInfo").innerText =
      "Nog geen stad geactiveerd.";
  }

  if (selectedGroupId) {
    const selectedGroup = groupsCache.find(g => g.id === selectedGroupId);
    renderGroupDetail(selectedGroup || null);
  }
});

onValue(ref(db, "photoSubmissions"), (snapshot) => {
  photoSubmissionsCache = snapshot.val() || {};

  if (selectedGroupId) {
    const selectedGroup = groupsCache.find(g => g.id === selectedGroupId);
    renderGroupDetail(selectedGroup || null);
  }
});

onValue(ref(db, "groups"), (snapshot) => {
  const data = snapshot.val();
  const validIds = new Set();

  if (!data || !activeCityKey) {
    groupsCache = [];
    renderRanking([]);
    renderGroups([], true);
    clearMarkersNotInView(validIds);
    document.getElementById("searchResult").innerHTML = "";
    return;
  }

  const groups = Object.entries(data)
    .map(([id, g]) => ({ id, ...g }))
    .filter(g => g.cityKey === activeCityKey);

  groups.forEach(g => {
    validIds.add(g.id);
    updateMarker(g.id, g);
  });

  clearMarkersNotInView(validIds);

  groupsCache = groups;
  renderRanking(groups);
  renderGroups(groups);
});
