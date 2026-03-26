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
let themesCache = {};
let activeCityKey = null;
let checkpoints = [];
let selectedIndex = null;

let map;
let markers = [];
let tempClickMarker = null;

function byId(id) {
  return document.getElementById(id);
}

function setValue(id, value) {
  const el = byId(id);
  if (el) el.value = value;
}

function getValue(id) {
  const el = byId(id);
  return el ? el.value : "";
}

function setText(id, value) {
  const el = byId(id);
  if (el) el.innerText = value;
}

function refreshMapSize(delay = 250) {
  setTimeout(() => {
    if (map) map.invalidateSize();
  }, delay);
}

function login() {
  const email = getValue("email").trim();
  const password = getValue("password");

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

  if (isVisible) {
    refreshMapSize(300);
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
    },
    themeId: city.themeId || ""
  };
}

function normalizeCityRecord(key, city) {
  if (!city) {
    return buildFallbackCityRecord(
      key,
      fallbackCities[key] || { name: key, center: [50.85, 4.35], gather: [50.85, 4.35] }
    );
  }

  const fallback = fallbackCities[key]
    ? buildFallbackCityRecord(key, fallbackCities[key])
    : null;

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
    gather,
    themeId: city.themeId || fallback?.themeId || ""
  };
}

function getCityRecord(cityKey) {
  if (!cityKey) {
    return {
      key: "",
      name: "",
      center: [50.85, 4.35],
      gather: {
        name: "Verzamelpunt",
        coords: [50.85, 4.35],
        radius: 40
      },
      themeId: ""
    };
  }

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
    },
    themeId: ""
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

function populateCitySelector() {
  const select = byId("adminCitySelector");
  if (!select) return;

  const keys = mergedCityKeys();
  select.innerHTML = "";

  if (!keys.length) {
    activeCityKey = null;
    return;
  }

  if (!activeCityKey || !keys.includes(activeCityKey)) {
    activeCityKey = keys[0];
  }

  keys.forEach((key) => {
    const city = getCityRecord(key);
    const option = document.createElement("option");
    option.value = key;
    option.textContent = city.name;
    select.appendChild(option);
  });

  select.value = activeCityKey;
}

function populateThemeSelector(selectedThemeId = "") {
  const select = byId("cityThemeSelector");
  if (!select) return;

  select.innerHTML = "";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "Geen thema gekoppeld";
  select.appendChild(emptyOption);

  Object.keys(themesCache)
    .sort((a, b) => a.localeCompare(b))
    .forEach((themeKey) => {
      const option = document.createElement("option");
      option.value = themeKey;
      option.textContent = themesCache[themeKey]?.name || themeKey;
      select.appendChild(option);
    });

  select.value = selectedThemeId || "";
}

function fillCityForm(cityKey) {
  const city = getCityRecord(cityKey);

  setValue("cityKeyInput", city.key || "");
  setValue("cityNameInput", city.name || "");
  setValue("cityCenterLat", city.center?.[0] ?? "");
  setValue("cityCenterLng", city.center?.[1] ?? "");
  setValue("gatherNameInput", city.gather?.name || "Verzamelpunt");
  setValue("gatherLatInput", city.gather?.coords?.[0] ?? "");
  setValue("gatherLngInput", city.gather?.coords?.[1] ?? "");
  setValue("gatherRadiusInput", city.gather?.radius ?? 40);

  populateThemeSelector(city.themeId || "");

  setText("adminCityInfo", city.name ? "Huidige stad: " + city.name : "Nieuwe stad");
}

function initMap() {
  const firstKey = activeCityKey || Object.keys(fallbackCities)[0] || "durbuy";
  const city = getCityRecord(firstKey);

  if (map) {
    map.remove();
    map = null;
  }

  map = L.map("map").setView(city.center, 15);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "OpenStreetMap"
  }).addTo(map);

  map.on("click", (e) => {
    setValue("cpLat", e.latlng.lat.toFixed(6));
    setValue("cpLng", e.latlng.lng.toFixed(6));

    if (tempClickMarker) {
      map.removeLayer(tempClickMarker);
    }

    tempClickMarker = L.marker(e.latlng).addTo(map);
  });

  refreshMapSize(250);
}

function resetMapCity() {
  if (!map || !activeCityKey) return;
  const city = getCityRecord(activeCityKey);
  map.setView(city.center, 15);
  refreshMapSize(150);
}

function clearMarkers() {
  markers.forEach(marker => {
    if (map) map.removeLayer(marker);
  });
  markers = [];
}

function renderMarkers() {
  clearMarkers();

  checkpoints.forEach((cp, index) => {
    if (!Array.isArray(cp.coords) || cp.coords.length !== 2) return;

    const marker = L.marker(cp.coords)
      .addTo(map)
      .bindPopup(cp.name || ("Checkpoint " + (index + 1)));

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
  const container = byId("checkpointList");
  if (!container) return;

  container.innerHTML = "";

  if (!checkpoints.length) {
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
      ${cp.story ? `<p><strong>Story:</strong> ${cp.story}</p>` : ""}
      ${cp.video ? `<p><strong>Video:</strong> ${cp.video}</p>` : ""}
      ${cp.audio ? `<p><strong>Audio:</strong> ${cp.audio}</p>` : ""}
      ${cp.image ? `<p><strong>Afbeelding:</strong> ${cp.image}</p>` : ""}
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
  const type = getValue("cpTaskType");

  byId("textTaskFields").style.display =
    type === "text" || type === "riddle" ? "block" : "none";
  byId("multipleChoiceFields").style.display =
    type === "multipleChoice" ? "block" : "none";
  byId("matchingFields").style.display =
    type === "matching" ? "block" : "none";
  byId("imagePuzzleFields").style.display =
    type === "imagePuzzle" ? "block" : "none";
  byId("photoFields").style.display =
    type === "photo" ? "block" : "none";
}

function clearForm() {
  selectedIndex = null;

  setValue("cpName", "");
  setValue("cpLat", "");
  setValue("cpLng", "");
  setValue("cpRadius", "50");
  setValue("cpTaskType", "text");
  setValue("cpStory", "");
  setValue("cpVideo", "");
  setValue("cpAudio", "");
  setValue("cpCheckpointImage", "");
  setValue("cpQuestion", "");
  setValue("cpAnswers", "");
  setValue("cpOptions", "");
  setValue("cpCorrectOption", "0");
  setValue("cpLeftItems", "");
  setValue("cpRightItems", "");
  setValue("cpCorrectPairs", "");
  setValue("cpImageUrl", "");
  setValue("cpGridSize", "3");
  setValue("cpPointsCorrect", "10");
  setValue("cpPointsAfterMaxTries", "4");

  setText("adminFeedback", "Nieuw checkpoint.");
  toggleTaskFields();
}

function loadCheckpointIntoForm(index) {
  const cp = checkpoints[index];
  if (!cp) return;

  selectedIndex = index;

  setValue("cpName", cp.name || "");
  setValue("cpLat", cp.coords?.[0] ?? "");
  setValue("cpLng", cp.coords?.[1] ?? "");
  setValue("cpRadius", cp.radius ?? 50);
  setValue("cpTaskType", cp.taskType || "text");
  setValue("cpStory", cp.story || "");
  setValue("cpVideo", cp.video || "");
  setValue("cpAudio", cp.audio || "");
  setValue("cpCheckpointImage", cp.image || "");
  setValue("cpQuestion", cp.question || "");
  setValue("cpAnswers", (cp.answers || []).join(", "));
  setValue("cpOptions", (cp.options || []).join("\n"));
  setValue("cpCorrectOption", cp.correctOption ?? 0);
  setValue("cpLeftItems", (cp.leftItems || []).join("\n"));
  setValue("cpRightItems", (cp.rightItems || []).join("\n"));

  const correctPairsText = cp.correctPairs
    ? Object.entries(cp.correctPairs).map(([left, right]) => `${left}=${right}`).join("\n")
    : "";
  setValue("cpCorrectPairs", correctPairsText);

  setValue("cpImageUrl", cp.imageUrl || "");
  setValue("cpGridSize", cp.gridSize ?? 3);
  setValue("cpPointsCorrect", cp.pointsCorrect ?? 10);
  setValue("cpPointsAfterMaxTries", cp.pointsAfterMaxTries ?? 4);

  toggleTaskFields();
  setText("adminFeedback", "Checkpoint geladen in formulier.");
  renderCheckpointList();
}

function buildCheckpointFromForm() {
  const name = getValue("cpName").trim();
  const lat = Number(getValue("cpLat"));
  const lng = Number(getValue("cpLng"));
  const radius = Number(getValue("cpRadius"));
  const taskType = getValue("cpTaskType");
  const question = getValue("cpQuestion").trim();
  const story = getValue("cpStory").trim();
  const video = getValue("cpVideo").trim();
  const audio = getValue("cpAudio").trim();
  const image = getValue("cpCheckpointImage").trim();
  const pointsCorrect = Number(getValue("cpPointsCorrect"));
  const pointsAfterMaxTries = Number(getValue("cpPointsAfterMaxTries"));

  if (!name || Number.isNaN(lat) || Number.isNaN(lng) || Number.isNaN(radius) || !question) {
    return null;
  }

  const cp = {
    name,
    coords: [lat, lng],
    radius,
    taskType,
    question,
    story,
    video,
    audio,
    image,
    pointsCorrect: Number.isNaN(pointsCorrect) ? 10 : pointsCorrect,
    pointsAfterMaxTries: Number.isNaN(pointsAfterMaxTries) ? 4 : pointsAfterMaxTries
  };

  if (taskType === "text" || taskType === "riddle") {
    cp.answers = getValue("cpAnswers")
      .split(",")
      .map(item => item.trim().toLowerCase())
      .filter(Boolean);
  }

  if (taskType === "multipleChoice") {
    cp.options = getValue("cpOptions")
      .split("\n")
      .map(item => item.trim())
      .filter(Boolean);
    cp.correctOption = Number(getValue("cpCorrectOption") || 0);
  }

  if (taskType === "matching") {
    cp.leftItems = getValue("cpLeftItems")
      .split("\n")
      .map(item => item.trim())
      .filter(Boolean);

    cp.rightItems = getValue("cpRightItems")
      .split("\n")
      .map(item => item.trim())
      .filter(Boolean);

    cp.correctPairs = {};
    getValue("cpCorrectPairs")
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
    cp.imageUrl = getValue("cpImageUrl").trim();
    cp.gridSize = Number(getValue("cpGridSize") || 3);
  }

  return cp;
}

function saveCheckpointToList() {
  const cp = buildCheckpointFromForm();

  if (!cp) {
    setText("adminFeedback", "Vul minstens naam, latitude, longitude, radius en vraag correct in.");
    return;
  }

  if (selectedIndex === null) {
    checkpoints.push(cp);
    selectedIndex = checkpoints.length - 1;
    setText("adminFeedback", "Checkpoint toegevoegd aan de lijst.");
  } else {
    checkpoints[selectedIndex] = cp;
    setText("adminFeedback", "Checkpoint bijgewerkt in de lijst.");
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

  setText("adminFeedback", "Checkpoint verwijderd.");
  renderCheckpointList();
  renderMarkers();
}

async function loadCityFromFirebase() {
  if (!activeCityKey) return;

  const citySnapshot = await get(ref(db, "cities/" + activeCityKey));
  if (citySnapshot.exists()) {
    citiesCache[activeCityKey] = citySnapshot.val();
  }

  const checkpointSnapshot = await get(ref(db, "cityData/" + activeCityKey + "/checkpoints"));

  if (checkpointSnapshot.exists()) {
    const data = checkpointSnapshot.val();
    checkpoints = Array.isArray(data) ? data : [];
    setText("adminFeedback", "Stad en checkpoints geladen uit Firebase.");
  } else {
    checkpoints = [];
    setText("adminFeedback", "Nog geen checkpoints gevonden in Firebase voor deze stad.");
  }

  fillCityForm(activeCityKey);
  selectedIndex = null;
  renderCheckpointList();
  renderMarkers();
  resetMapCity();
}

function loadTemplateData() {
  if (!activeCityKey || !fallbackCities[activeCityKey]) {
    setText("adminFeedback", "Geen template gevonden in cities.js voor deze stad.");
    return;
  }

  const city = buildFallbackCityRecord(activeCityKey, fallbackCities[activeCityKey]);

  fillCityForm(activeCityKey);
  setValue("cityNameInput", city.name);
  setValue("cityCenterLat", city.center[0]);
  setValue("cityCenterLng", city.center[1]);
  setValue("gatherNameInput", city.gather.name);
  setValue("gatherLatInput", city.gather.coords[0]);
  setValue("gatherLngInput", city.gather.coords[1]);
  setValue("gatherRadiusInput", city.gather.radius);
  populateThemeSelector(city.themeId || "");

  checkpoints = JSON.parse(JSON.stringify(fallbackCities[activeCityKey].defaultCheckpoints || []));
  selectedIndex = null;
  renderCheckpointList();
  renderMarkers();
  resetMapCity();

  setText("adminFeedback", "Template geladen voor " + city.name + ".");
}

async function saveCityToFirebase() {
  const cityKey = getValue("cityKeyInput").trim().toLowerCase();
  const cityName = getValue("cityNameInput").trim();
  const centerLat = Number(getValue("cityCenterLat"));
  const centerLng = Number(getValue("cityCenterLng"));
  const gatherName = getValue("gatherNameInput").trim() || "Verzamelpunt";
  const gatherLat = Number(getValue("gatherLatInput"));
  const gatherLng = Number(getValue("gatherLngInput"));
  const gatherRadius = Number(getValue("gatherRadiusInput"));
  const themeId = getValue("cityThemeSelector").trim();

  if (
    !cityKey ||
    !cityName ||
    Number.isNaN(centerLat) ||
    Number.isNaN(centerLng) ||
    Number.isNaN(gatherLat) ||
    Number.isNaN(gatherLng) ||
    Number.isNaN(gatherRadius)
  ) {
    setText("adminFeedback", "Vul alle stadsvelden correct in.");
    return;
  }

  const cityPayload = {
    name: cityName,
    center: [centerLat, centerLng],
    gather: {
      name: gatherName,
      coords: [gatherLat, gatherLng],
      radius: gatherRadius
    },
    themeId: themeId || ""
  };

  await set(ref(db, "cities/" + cityKey), cityPayload);

  citiesCache[cityKey] = cityPayload;
  activeCityKey = cityKey;

  populateCitySelector();
  fillCityForm(cityKey);
  resetMapCity();

  setText("adminFeedback", "Stad opgeslagen in Firebase.");
}

async function deleteCityFromFirebase() {
  if (!activeCityKey) return;

  const confirmed = confirm("Ben je zeker dat je deze stad en alle checkpoints wilt verwijderen?");
  if (!confirmed) return;

  await remove(ref(db, "cities/" + activeCityKey));
  await remove(ref(db, "cityData/" + activeCityKey));

  delete citiesCache[activeCityKey];

  const remainingKeys = mergedCityKeys();
  activeCityKey = remainingKeys[0] || null;
  checkpoints = [];
  selectedIndex = null;

  populateCitySelector();

  if (activeCityKey) {
    fillCityForm(activeCityKey);
    resetMapCity();
  } else {
    setText("adminCityInfo", "Geen stad geselecteerd.");
  }

  renderCheckpointList();
  renderMarkers();

  setText("adminFeedback", "Stad verwijderd uit Firebase.");
}

async function saveAllToFirebase() {
  if (!activeCityKey) {
    setText("adminFeedback", "Geen actieve stad geselecteerd.");
    return;
  }

  await set(ref(db, "cityData/" + activeCityKey + "/checkpoints"), checkpoints);

  setText(
    "adminFeedback",
    "Alle checkpoints opgeslagen in Firebase voor " + getCityRecord(activeCityKey).name + "."
  );
}

function startNewCityForm() {
  activeCityKey = null;

  const selector = byId("adminCitySelector");
  if (selector) selector.value = "";

  setValue("cityKeyInput", "");
  setValue("cityNameInput", "");
  setValue("cityCenterLat", "");
  setValue("cityCenterLng", "");
  setValue("gatherNameInput", "Verzamelpunt");
  setValue("gatherLatInput", "");
  setValue("gatherLngInput", "");
  setValue("gatherRadiusInput", "40");
  populateThemeSelector("");

  checkpoints = [];
  selectedIndex = null;
  renderCheckpointList();
  renderMarkers();
  clearForm();

  setText("adminCityInfo", "Nieuwe stad aanmaken");
  setText("adminFeedback", "Vul de nieuwe stadsgegevens in.");
}

byId("adminCitySelector")?.addEventListener("change", async (e) => {
  activeCityKey = e.target.value;
  fillCityForm(activeCityKey);
  checkpoints = [];
  selectedIndex = null;
  clearForm();
  renderCheckpointList();
  renderMarkers();
  resetMapCity();
});

byId("cpTaskType")?.addEventListener("change", toggleTaskFields);
byId("loadCityButton")?.addEventListener("click", loadCityFromFirebase);
byId("loadTemplateButton")?.addEventListener("click", loadTemplateData);
byId("newCityButton")?.addEventListener("click", startNewCityForm);
byId("saveCityButton")?.addEventListener("click", saveCityToFirebase);
byId("deleteCityButton")?.addEventListener("click", deleteCityFromFirebase);
byId("newCheckpointButton")?.addEventListener("click", clearForm);
byId("saveCheckpointButton")?.addEventListener("click", saveCheckpointToList);
byId("deleteCheckpointButton")?.addEventListener("click", () => {
  if (selectedIndex === null) {
    setText("adminFeedback", "Selecteer eerst een checkpoint.");
    return;
  }
  deleteCheckpoint(selectedIndex);
});
byId("saveAllButton")?.addEventListener("click", saveAllToFirebase);

toggleTaskFields();
initMap();

onValue(ref(db, "themes"), (snapshot) => {
  themesCache = snapshot.val() || {};
  populateThemeSelector(getCityRecord(activeCityKey || "")?.themeId || "");
});

onValue(ref(db, "cities"), (snapshot) => {
  citiesCache = snapshot.val() || {};

  const previousKey = activeCityKey;
  populateCitySelector();

  if (previousKey && mergedCityKeys().includes(previousKey)) {
    activeCityKey = previousKey;
  } else if (!activeCityKey) {
    activeCityKey = mergedCityKeys()[0] || null;
  }

  if (activeCityKey) {
    const selector = byId("adminCitySelector");
    if (selector) selector.value = activeCityKey;
    fillCityForm(activeCityKey);
    resetMapCity();
  }
});

onAuthStateChanged(auth, (user) => {
  setProtectedUIVisible(!!user);
});
