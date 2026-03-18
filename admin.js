import { cities as fallbackCities } from "./cities.js";
import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  get,
  set,
  remove,
  onValue
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
let checkpoints = [];
let selectedIndex = null;
let map;
let markers = [];
let tempClickMarker = null;

function login() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

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

function setProtectedUIVisible(isVisible) {
  const loginScreen = document.getElementById("loginScreen");
  const appContent = document.getElementById("appContent");
  const loginStatus = document.getElementById("loginStatus");

  if (loginScreen) loginScreen.style.display = isVisible ? "none" : "block";
  if (appContent) appContent.style.display = isVisible ? "block" : "none";
  if (loginStatus) {
    loginStatus.innerText = isVisible && auth.currentUser
      ? "Ingelogd als: " + auth.currentUser.email
      : "";
  }
}

function buildFallbackCityRecord(key, city) {
  const gatherCoords = Array.isArray(city.gather)
    ? city.gather
    : city.gather?.coords || city.center || [50.85, 4.35];

  const gatherRadius = city.gather?.radius || 40;
  const gatherName = city.gather?.name || "Verzamelpunt";

  return {
    key,
    name: city.name || key,
    center: city.center || gatherCoords,
    gather: {
      name: gatherName,
      coords: gatherCoords,
      radius: gatherRadius
    }
  };
}

function normalizeCityRecord(key, city) {
  if (!city) {
    return buildFallbackCityRecord(key, fallbackCities[key] || { name: key, center: [50.85, 4.35], gather: [50.85, 4.35] });
  }

  const fallback = fallbackCities[key] ? buildFallbackCityRecord(key, fallbackCities[key]) : null;

  const center = Array.isArray(city.center)
    ? city.center
    : fallback?.center || [50.85, 4.35];

  let gather;
  if (Array.isArray(city.gather)) {
    gather = {
      name: "Verzamelpunt",
      coords: city.gather,
      radius: 40
    };
  } else if (city.gather && Array.isArray(city.gather.coords)) {
    gather = {
      name: city.gather.name || "Verzamelpunt",
      coords: city.gather.coords,
      radius: Number(city.gather.radius || 40)
    };
  } else {
    gather = fallback?.gather || {
      name: "Verzamelpunt",
      coords: center,
      radius: 40
    };
  }

  return {
    key,
    name: city.name || fallback?.name || key,
    center,
    gather
  };
}

function getCityRecord(cityKey) {
  if (citiesCache[cityKey]) return normalizeCityRecord(cityKey, citiesCache[cityKey]);
  if (fallbackCities[cityKey]) return buildFallbackCityRecord(cityKey, fallbackCities[cityKey]);

  return {
    key: cityKey,
    name: cityKey,
    center: [50.85, 4.35],
    gather: {
      name: "Verzamelpunt",
      coords: [50.85, 4.35],
      radius: 40
    }
  };
}

function populateCitySelector() {
  const select = document.getElementById("adminCitySelector");
  if (!select) return;

  select.innerHTML = "";

  const mergedKeys = Array.from(
    new Set([
      ...Object.keys(fallbackCities || {}),
      ...Object.keys(citiesCache || {})
    ])
  ).sort((a, b) => a.localeCompare(b));

  if (!mergedKeys.length) {
    activeCityKey = null;
    return;
  }

  if (!activeCityKey || !mergedKeys.includes(activeCityKey)) {
    activeCityKey = mergedKeys[0];
  }

  mergedKeys.forEach((key) => {
    const city = getCityRecord(key);
    const option = document.createElement("option");
    option.value = key;
    option.textContent = city.name;
    select.appendChild(option);
  });

  select.value = activeCityKey;
}

function fillCityForm(cityKey) {
  const city = getCityRecord(cityKey);

  document.getElementById("cityKeyInput").value = city.key || cityKey || "";
  document.getElementById("cityNameInput").value = city.name || "";
  document.getElementById("cityCenterLat").value = city.center?.[0] ?? "";
  document.getElementById("cityCenterLng").value = city.center?.[1] ?? "";
  document.getElementById("gatherNameInput").value = city.gather?.name || "Verzamelpunt";
  document.getElementById("gatherLatInput").value = city.gather?.coords?.[0] ?? "";
  document.getElementById("gatherLngInput").value = city.gather?.coords?.[1] ?? "";
  document.getElementById("gatherRadiusInput").value = city.gather?.radius ?? 40;

  const adminCityInfo = document.getElementById("adminCityInfo");
  if (adminCityInfo) {
    adminCityInfo.innerText = "Huidige stad: " + (city.name || cityKey);
  }
}

function initMap() {
  const city = getCityRecord(activeCityKey || Object.keys(fallbackCities)[0]);
  map = L.map("map").setView(city.center, 15);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "OpenStreetMap"
  }).addTo(map);

  map.on("click", (e) => {
    document.getElementById("cpLat").value = e.latlng.lat.toFixed(6);
    document.getElementById("cpLng").value = e.latlng.lng.toFixed(6);

    if (tempClickMarker) {
      map.removeLayer(tempClickMarker);
    }

    tempClickMarker = L.marker(e.latlng).addTo(map);
  });
}

function resetMapCity() {
  const city = getCityRecord(activeCityKey);
  map.setView(city.center, 15);
}

function clearMarkers() {
  markers.forEach(marker => map.removeLayer(marker));
  markers = [];
}

function renderMarkers() {
  clearMarkers();

  checkpoints.forEach((cp, index) => {
    if (!Array.isArray(cp.coords) || cp.coords.length !== 2) return;

    const marker = L.marker(cp.coords).addTo(map).bindPopup(cp.name || ("Checkpoint " + (index + 1)));
    marker.on("click", () => {
      loadCheckpointIntoForm(index);
    });
    markers.push(marker);
  });
}

function taskTypeLabel(type) {
  const labels = {
    text: "Tekstvraag",
    riddle: "Raadsel",
    multipleChoice: "Meerkeuze",
    matching: "Matching",
    imagePuzzle: "Afbeeldingspuzzel",
    photo: "Foto-opdracht"
  };
  return labels[type] || type || "Tekstvraag";
}

function renderCheckpointList() {
  const container = document.getElementById("checkpointList");
  if (!container) return;

  container.innerHTML = "";

  if (checkpoints.length === 0) {
    container.innerHTML = "<p>Nog geen checkpoints voor deze stad.</p>";
    return;
  }

  checkpoints.forEach((cp, index) => {
    const div = document.createElement("div");
    div.className = "checkpoint-card" + (selectedIndex === index ? " selected-card" : "");

    let extra = "";
    if ((cp.taskType || "text") === "multipleChoice") {
      extra = `<p><strong>Opties:</strong> ${(cp.options || []).join(" | ")}</p>`;
    } else if ((cp.taskType || "text") === "matching") {
      extra = `<p><strong>Matching:</strong> ${(cp.leftItems || []).length} koppels</p>`;
    } else if ((cp.taskType || "text") === "imagePuzzle") {
      extra = `<p><strong>Afbeelding:</strong> ${cp.imageUrl || "-"}</p>`;
    } else if ((cp.taskType || "text") === "photo") {
      extra = `<p><strong>Type:</strong> Foto-opdracht</p>`;
    } else {
      extra = `<p><strong>Antwoorden:</strong> ${(cp.answers || []).join(", ")}</p>`;
    }

    div.innerHTML = `
      <h3>${index + 1}. ${cp.name || "Checkpoint"}</h3>
      <p><strong>Type:</strong> ${taskTypeLabel(cp.taskType || "text")}</p>
      <p><strong>Locatie:</strong> ${cp.coords?.[0] ?? "-"}, ${cp.coords?.[1] ?? "-"}</p>
      <p><strong>Radius:</strong> ${cp.radius ?? "-"} m</p>
      <p><strong>Vraag:</strong> ${cp.question || "-"}</p>
      ${extra}
      <p><strong>Punten:</strong> juist ${cp.pointsCorrect ?? 0}, na 3 pogingen ${cp.pointsAfterMaxTries ?? 0}</p>
      <div class="checkpoint-actions">
        <button data-edit="${index}">Bewerk</button>
        <button data-delete="${index}">Verwijder</button>
      </div>
    `;
    container.appendChild(div);
  });

  container.querySelectorAll("button[data-edit]").forEach(button => {
    button.addEventListener("click", () => {
      loadCheckpointIntoForm(Number(button.dataset.edit));
    });
  });

  container.querySelectorAll("button[data-delete]").forEach(button => {
    button.addEventListener("click", () => {
      deleteCheckpoint(Number(button.dataset.delete));
    });
  });
}

function toggleTaskFields() {
  const type = document.getElementById("cpTaskType").value;

  document.getElementById("textTaskFields").style.display =
    type === "text" || type === "riddle" ? "block" : "none";
  document.getElementById("multipleChoiceFields").style.display =
    type === "multipleChoice" ? "block" : "none";
  document.getElementById("matchingFields").style.display =
    type === "matching" ? "block" : "none";
  document.getElementById("imagePuzzleFields").style.display =
    type === "imagePuzzle" ? "block" : "none";
  document.getElementById("photoFields").style.display =
    type === "photo" ? "block" : "none";
}

function clearForm() {
  selectedIndex = null;
  document.getElementById("cpName").value = "";
  document.getElementById("cpLat").value = "";
  document.getElementById("cpLng").value = "";
  document.getElementById("cpRadius").value = "50";
  document.getElementById("cpTaskType").value = "text";
  document.getElementById("cpQuestion").value = "";
  document.getElementById("cpAnswers").value = "";
  document.getElementById("cpOptions").value = "";
  document.getElementById("cpCorrectOption").value = "0";
  document.getElementById("cpLeftItems").value = "";
  document.getElementById("cpRightItems").value = "";
  document.getElementById("cpCorrectPairs").value = "";
  document.getElementById("cpImageUrl").value = "";
  document.getElementById("cpGridSize").value = "3";
  document.getElementById("cpPointsCorrect").value = "10";
  document.getElementById("cpPointsAfterMaxTries").value = "4";
  document.getElementById("adminFeedback").innerText = "Nieuw checkpoint.";

  toggleTaskFields();
}

function loadCheckpointIntoForm(index) {
  const cp = checkpoints[index];
  if (!cp) return;

  selectedIndex = index;

  document.getElementById("cpName").value = cp.name || "";
  document.getElementById("cpLat").value = cp.coords?.[0] ?? "";
  document.getElementById("cpLng").value = cp.coords?.[1] ?? "";
  document.getElementById("cpRadius").value = cp.radius ?? 50;
  document.getElementById("cpTaskType").value = cp.taskType || "text";
  document.getElementById("cpQuestion").value = cp.question || "";
  document.getElementById("cpAnswers").value = (cp.answers || []).join(", ");
  document.getElementById("cpOptions").value = (cp.options || []).join("\n");
  document.getElementById("cpCorrectOption").value = cp.correctOption ?? 0;
  document.getElementById("cpLeftItems").value = (cp.leftItems || []).join("\n");
  document.getElementById("cpRightItems").value = (cp.rightItems || []).join("\n");

  const correctPairsText = cp.correctPairs
    ? Object.entries(cp.correctPairs).map(([left, right]) => `${left}=${right}`).join("\n")
    : "";
  document.getElementById("cpCorrectPairs").value = correctPairsText;

  document.getElementById("cpImageUrl").value = cp.imageUrl || "";
  document.getElementById("cpGridSize").value = cp.gridSize ?? 3;
  document.getElementById("cpPointsCorrect").value = cp.pointsCorrect ?? 10;
  document.getElementById("cpPointsAfterMaxTries").value = cp.pointsAfterMaxTries ?? 4;

  toggleTaskFields();

  document.getElementById("adminFeedback").innerText =
    "Checkpoint geladen in formulier.";
  renderCheckpointList();
}

function buildCheckpointFromForm() {
  const name = document.getElementById("cpName").value.trim();
  const lat = Number(document.getElementById("cpLat").value);
  const lng = Number(document.getElementById("cpLng").value);
  const radius = Number(document.getElementById("cpRadius").value);
  const taskType = document.getElementById("cpTaskType").value;
  const question = document.getElementById("cpQuestion").value.trim();
  const pointsCorrect = Number(document.getElementById("cpPointsCorrect").value);
  const pointsAfterMaxTries = Number(document.getElementById("cpPointsAfterMaxTries").value);

  if (!name || Number.isNaN(lat) || Number.isNaN(lng) || Number.isNaN(radius) || !question) {
    return null;
  }

  const cp = {
    name,
    coords: [lat, lng],
    radius,
    taskType,
    question,
    pointsCorrect: Number.isNaN(pointsCorrect) ? 10 : pointsCorrect,
    pointsAfterMaxTries: Number.isNaN(pointsAfterMaxTries) ? 4 : pointsAfterMaxTries
  };

  if (taskType === "text" || taskType === "riddle") {
    cp.answers = document.getElementById("cpAnswers").value
      .split(",")
      .map(item => item.trim().toLowerCase())
      .filter(Boolean);
  }

  if (taskType === "multipleChoice") {
    cp.options = document.getElementById("cpOptions").value
      .split("\n")
      .map(item => item.trim())
      .filter(Boolean);
    cp.correctOption = Number(document.getElementById("cpCorrectOption").value || 0);
  }

  if (taskType === "matching") {
    cp.leftItems = document.getElementById("cpLeftItems").value
      .split("\n")
      .map(item => item.trim())
      .filter(Boolean);

    cp.rightItems = document.getElementById("cpRightItems").value
      .split("\n")
      .map(item => item.trim())
      .filter(Boolean);

    cp.correctPairs = {};
    document.getElementById("cpCorrectPairs").value
      .split("\n")
      .map(item => item.trim())
      .filter(Boolean)
      .forEach(line => {
        const [left, ...rest] = line.split("=");
        const right = rest.join("=").trim();
        if (left && right) {
          cp.correctPairs[left.trim()] = right;
        }
      });
  }

  if (taskType === "imagePuzzle") {
    cp.imageUrl = document.getElementById("cpImageUrl").value.trim();
    cp.gridSize = Number(document.getElementById("cpGridSize").value || 3);
  }

  return cp;
}

function saveCheckpointToList() {
  const cp = buildCheckpointFromForm();

  if (!cp) {
    document.getElementById("adminFeedback").innerText =
      "Vul minstens naam, latitude, longitude, radius en vraag correct in.";
    return;
  }

  if (selectedIndex === null) {
    checkpoints.push(cp);
    selectedIndex = checkpoints.length - 1;
    document.getElementById("adminFeedback").innerText =
      "Checkpoint toegevoegd aan de lijst.";
  } else {
    checkpoints[selectedIndex] = cp;
    document.getElementById("adminFeedback").innerText =
      "Checkpoint bijgewerkt in de lijst.";
  }

  renderCheckpointList();
  renderMarkers();
}

function deleteCheckpoint(index) {
  checkpoints.splice(index, 1);

  if (selectedIndex === index) {
    selectedIndex = null;
  } else if (selectedIndex !== null && selectedIndex > index) {
    selectedIndex--;
  }

  document.getElementById("adminFeedback").innerText = "Checkpoint verwijderd.";
  renderCheckpointList();
  renderMarkers();
}

async function loadCityFromFirebase() {
  if (!activeCityKey) return;

  const citySnapshot = await get(ref(db, "cities/" + activeCityKey));
  if (citySnapshot.exists()) {
    citiesCache[activeCityKey] = citySnapshot.val();
  }

  const snapshot = await get(ref(db, "cityData/" + activeCityKey + "/checkpoints"));

  if (snapshot.exists()) {
    const data = snapshot.val();
    checkpoints = Array.isArray(data) ? data : [];
    document.getElementById("adminFeedback").innerText =
      "Stad en checkpoints geladen uit Firebase.";
  } else {
    checkpoints = [];
    document.getElementById("adminFeedback").innerText =
      "Nog geen checkpoints gevonden in Firebase voor deze stad.";
  }

  fillCityForm(activeCityKey);
  selectedIndex = null;
  renderCheckpointList();
  renderMarkers();
  resetMapCity();
}

function loadTemplateData() {
  if (!activeCityKey || !fallbackCities[activeCityKey]) {
    document.getElementById("adminFeedback").innerText =
      "Geen template gevonden in cities.js voor deze stad.";
    return;
  }

  const city = buildFallbackCityRecord(activeCityKey, fallbackCities[activeCityKey]);
  fillCityForm(activeCityKey);

  document.getElementById("cityNameInput").value = city.name;
  document.getElementById("cityCenterLat").value = city.center[0];
  document.getElementById("cityCenterLng").value = city.center[1];
  document.getElementById("gatherNameInput").value = city.gather.name;
  document.getElementById("gatherLatInput").value = city.gather.coords[0];
  document.getElementById("gatherLngInput").value = city.gather.coords[1];
  document.getElementById("gatherRadiusInput").value = city.gather.radius;

  checkpoints = JSON.parse(JSON.stringify(fallbackCities[activeCityKey].defaultCheckpoints || []));
  selectedIndex = null;
  renderCheckpointList();
  renderMarkers();
  resetMapCity();

  document.getElementById("adminFeedback").innerText =
    "Template geladen voor " + city.name + ".";
}

async function saveCityToFirebase() {
  const cityKey = document.getElementById("cityKeyInput").value.trim().toLowerCase();
  const cityName = document.getElementById("cityNameInput").value.trim();
  const centerLat = Number(document.getElementById("cityCenterLat").value);
  const centerLng = Number(document.getElementById("cityCenterLng").value);
  const gatherName = document.getElementById("gatherNameInput").value.trim() || "Verzamelpunt";
  const gatherLat = Number(document.getElementById("gatherLatInput").value);
  const gatherLng = Number(document.getElementById("gatherLngInput").value);
  const gatherRadius = Number(document.getElementById("gatherRadiusInput").value);

  if (
    !cityKey ||
    !cityName ||
    Number.isNaN(centerLat) ||
    Number.isNaN(centerLng) ||
    Number.isNaN(gatherLat) ||
    Number.isNaN(gatherLng) ||
    Number.isNaN(gatherRadius)
  ) {
    document.getElementById("adminFeedback").innerText =
      "Vul alle stadsvelden correct in.";
    return;
  }

  const cityPayload = {
    name: cityName,
    center: [centerLat, centerLng],
    gather: {
      name: gatherName,
      coords: [gatherLat, gatherLng],
      radius: gatherRadius
    }
  };

  await set(ref(db, "cities/" + cityKey), cityPayload);
  citiesCache[cityKey] = cityPayload;
  activeCityKey = cityKey;
  populateCitySelector();
  fillCityForm(cityKey);
  resetMapCity();

  document.getElementById("adminFeedback").innerText =
    "Stad opgeslagen in Firebase.";
}

async function deleteCityFromFirebase() {
  if (!activeCityKey) return;

  const confirmed = confirm(
    "Ben je zeker dat je deze stad en alle checkpoints wilt verwijderen?"
  );

  if (!confirmed) return;

  await remove(ref(db, "cities/" + activeCityKey));
  await remove(ref(db, "cityData/" + activeCityKey));

  delete citiesCache[activeCityKey];

  const remainingKeys = Array.from(
    new Set([
      ...Object.keys(fallbackCities || {}),
      ...Object.keys(citiesCache || {})
    ])
  ).sort((a, b) => a.localeCompare(b));

  activeCityKey = remainingKeys[0] || null;
  checkpoints = [];
  selectedIndex = null;

  populateCitySelector();

  if (activeCityKey) {
    fillCityForm(activeCityKey);
    resetMapCity();
  } else {
    document.getElementById("adminCityInfo").innerText = "Geen stad geselecteerd.";
  }

  renderCheckpointList();
  renderMarkers();

  document.getElementById("adminFeedback").innerText =
    "Stad verwijderd uit Firebase.";
}

async function saveAllToFirebase() {
  if (!activeCityKey) {
    document.getElementById("adminFeedback").innerText =
      "Geen actieve stad geselecteerd.";
    return;
  }

  await set(ref(db, "cityData/" + activeCityKey + "/checkpoints"), checkpoints);

  document.getElementById("adminFeedback").innerText =
    "Alle checkpoints opgeslagen in Firebase voor " + getCityRecord(activeCityKey).name + ".";
}

function startNewCityForm() {
  activeCityKey = null;
  const selector = document.getElementById("adminCitySelector");
  if (selector) selector.value = "";

  document.getElementById("cityKeyInput").value = "";
  document.getElementById("cityNameInput").value = "";
  document.getElementById("cityCenterLat").value = "";
  document.getElementById("cityCenterLng").value = "";
  document.getElementById("gatherNameInput").value = "Verzamelpunt";
  document.getElementById("gatherLatInput").value = "";
  document.getElementById("gatherLngInput").value = "";
  document.getElementById("gatherRadiusInput").value = "40";
  checkpoints = [];
  selectedIndex = null;
  renderCheckpointList();
  renderMarkers();
  clearForm();

  const info = document.getElementById("adminCityInfo");
  if (info) info.innerText = "Nieuwe stad aanmaken";

  document.getElementById("adminFeedback").innerText = "Vul de nieuwe stadsgegevens in.";
}

onValue(ref(db, "cities"), (snapshot) => {
  citiesCache = snapshot.val() || {};
  const previousKey = activeCityKey;

  populateCitySelector();

  if (previousKey && (citiesCache[previousKey] || fallbackCities[previousKey])) {
    activeCityKey = previousKey;
  } else if (!activeCityKey) {
    const keys = Array.from(
      new Set([
        ...Object.keys(fallbackCities || {}),
        ...Object.keys(citiesCache || {})
      ])
    ).sort((a, b) => a.localeCompare(b));
    activeCityKey = keys[0] || null;
  }

  if (activeCityKey) {
    document.getElementById("adminCitySelector").value = activeCityKey;
    fillCityForm(activeCityKey);
  }
});

initMap();
populateCitySelector();

if (activeCityKey) {
  fillCityForm(activeCityKey);
  loadTemplateData();
} else {
  clearForm();
}

document.getElementById("adminCitySelector")?.addEventListener("change", () => {
  activeCityKey = document.getElementById("adminCitySelector").value;
  fillCityForm(activeCityKey);
  resetMapCity();
  clearForm();
  checkpoints = [];
  renderCheckpointList();
  renderMarkers();
});

document.getElementById("cpTaskType")?.addEventListener("change", toggleTaskFields);
document.getElementById("loadCityButton")?.addEventListener("click", loadCityFromFirebase);
document.getElementById("loadTemplateButton")?.addEventListener("click", loadTemplateData);
document.getElementById("newCityButton")?.addEventListener("click", startNewCityForm);
document.getElementById("saveCityButton")?.addEventListener("click", saveCityToFirebase);
document.getElementById("deleteCityButton")?.addEventListener("click", deleteCityFromFirebase);
document.getElementById("newCheckpointButton")?.addEventListener("click", clearForm);
document.getElementById("saveCheckpointButton")?.addEventListener("click", saveCheckpointToList);
document.getElementById("deleteCheckpointButton")?.addEventListener("click", () => {
  if (selectedIndex === null) {
    document.getElementById("adminFeedback").innerText = "Selecteer eerst een checkpoint.";
    return;
  }
  deleteCheckpoint(selectedIndex);
});
document.getElementById("saveAllButton")?.addEventListener("click", saveAllToFirebase);

toggleTaskFields();

onAuthStateChanged(auth, (user) => {
  setProtectedUIVisible(!!user);
});
