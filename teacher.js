import { cities, getGatherCheckpoint } from "./cities.js";
import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  update,
  set
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let activeCityKey = null;
let groupsCache = [];
let markers = {};

const firstCityKey = Object.keys(cities)[0];
const defaultCenter = cities[firstCityKey].center;

let map = L.map("map").setView(defaultCenter, 15);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "OpenStreetMap"
}).addTo(map);

function populateCitySelector(){
  const select = document.getElementById("citySelector");
  select.innerHTML = "";

  Object.entries(cities).forEach(([key, city]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = city.name;
    select.appendChild(option);
  });
}

function setMapCity(cityKey){
  if(!cities[cityKey]) return;
  map.setView(cities[cityKey].center, 15);
  document.getElementById("currentCityInfo").innerText =
    "Actieve stad: " + cities[cityKey].name;
}

function clearMarkersNotInView(validIds){
  Object.keys(markers).forEach(id => {
    if(!validIds.has(id)){
      map.removeLayer(markers[id]);
      delete markers[id];
    }
  });
}

function updateMarker(id, g){
  if(typeof g.lat !== "number" || typeof g.lng !== "number") return;

  if(!markers[id]){
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
    "<br>" + (g.checkpoint || "-") +
    "<br>" + modeText
  );
}

function renderRanking(groups){
  const container = document.getElementById("rankingContainer");
  container.innerHTML = "";

  if(groups.length === 0){
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

function renderGroups(groups){
  const container = document.getElementById("groupsContainer");
  container.innerHTML = "";

  if(groups.length === 0){
    container.innerHTML = "<p>Geen actieve groepen voor deze stad.</p>";
    return;
  }

  groups
    .slice()
    .sort((a, b) => (a.groupNumber || 999) - (b.groupNumber || 999))
    .forEach(group => {
      const div = document.createElement("div");
      div.className = "group-card";

      const modeText = group.gatherMode ? "Verzamelmodus" : "Normale route";

      div.innerHTML = `
        <h3>Groep ${group.groupNumber}: ${group.groupName}</h3>
        <p><strong>Leden:</strong> ${group.groupMembers || "-"}</p>
        <p><strong>Checkpoint:</strong> ${group.checkpoint || "-"}</p>
        <p><strong>Score:</strong> ${group.score || 0}</p>
        <p><strong>Modus:</strong> ${modeText}</p>
        <p class="small-note"><strong>Laatst gezien:</strong> ${group.lastUpdated || "-"}</p>

        <div class="group-actions">
          <button data-action="next" data-id="${group.id}">Volgend checkpoint</button>
          <button data-action="plus" data-id="${group.id}">+10 punten</button>
          <button data-action="minus" data-id="${group.id}">-10 punten</button>
          <button data-action="reset" data-id="${group.id}">Reset groep</button>
        </div>
      `;

      container.appendChild(div);
    });

  container.querySelectorAll("button[data-action]").forEach(button => {
    button.addEventListener("click", async () => {
      const id = button.dataset.id;
      const action = button.dataset.action;

      if(action === "next"){
        await update(ref(db, "groups/" + id), {
          commandNextAt: Date.now()
        });
      }

      if(action === "plus"){
        await update(ref(db, "groups/" + id), {
          commandPointsValue: 10,
          commandPointsAt: Date.now()
        });
      }

      if(action === "minus"){
        await update(ref(db, "groups/" + id), {
          commandPointsValue: -10,
          commandPointsAt: Date.now()
        });
      }

      if(action === "reset"){
        await update(ref(db, "groups/" + id), {
          commandResetAt: Date.now()
        });
      }
    });
  });
}

function applySearch(query){
  const q = query.toLowerCase().trim();

  if(!q){
    document.getElementById("searchResult").innerText = "";
    return;
  }

  const hit = groupsCache.find(g =>
    (g.groupMembers || "").toLowerCase().includes(q)
  );

  if(hit){
    document.getElementById("searchResult").innerText =
      "Leerling zit in groep " + hit.groupNumber + " (" + hit.groupName + ")";
    if(markers[hit.id]){
      markers[hit.id].openPopup();
      map.setView(markers[hit.id].getLatLng(), 17);
    }
  } else {
    document.getElementById("searchResult").innerText =
      "Geen leerling gevonden in de actieve stad.";
  }
}

populateCitySelector();

document.getElementById("setCityButton").addEventListener("click", async () => {
  const cityKey = document.getElementById("citySelector").value;
  await set(ref(db, "control/currentCity"), cityKey);
});

document.getElementById("sendGatherButton").addEventListener("click", async () => {
  if(!activeCityKey) return;

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
  if(!activeCityKey) return;

  await set(ref(db, "control/globalCommands/" + activeCityKey), {
    type: "resume",
    at: Date.now()
  });

  document.getElementById("globalActionFeedback").innerText =
    "Het normale spel is opnieuw hervat.";
});

document.getElementById("searchInput").addEventListener("input", (e) => {
  applySearch(e.target.value);
});

onValue(ref(db, "control/currentCity"), (snapshot) => {
  const cityKey = snapshot.val();
  activeCityKey = cityKey;

  if(cityKey && cities[cityKey]){
    document.getElementById("citySelector").value = cityKey;
    setMapCity(cityKey);
  } else {
    document.getElementById("currentCityInfo").innerText = "Nog geen stad geactiveerd.";
  }
});

onValue(ref(db, "groups"), (snapshot) => {
  const data = snapshot.val();
  const validIds = new Set();

  if(!data || !activeCityKey){
    groupsCache = [];
    renderRanking([]);
    renderGroups([]);
    clearMarkersNotInView(validIds);
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

document.getElementById("resetDatabaseButton").addEventListener("click", async () => {

const confirmReset = confirm("Ben je zeker dat je alles wil resetten?");

if(!confirmReset) return;

await set(ref(db,"groups"), null);
await set(ref(db,"meta/groupCounters"), null);

alert("Database volledig gereset.");

});
