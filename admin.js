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
let speltypesCache = {};

let activeCityKey = null;
let checkpoints = [];
let selectedIndex = null;

let map;
let markers = [];
let tempClickMarker = null;
let activeGameType = null;

function byId(id) {
  return document.getElementById(id);
}

function setValue(id, value) {
  const el = byId(id);
  if (el) el.value = value ?? "";
}

function getValue(id) {
  const el = byId(id);
  return el ? el.value : "";
}

function setChecked(id, value) {
  const el = byId(id);
  if (el) el.checked = !!value;
}

function getChecked(id) {
  const el = byId(id);
  return !!el?.checked;
}

function setText(id, value) {
  const el = byId(id);
  if (el) el.innerText = value ?? "";
}

function parseCommaList(value) {
  return String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
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

function normalizeGameType(raw) {
  return {
    name: raw?.name || "Klassiek",
    engine: raw?.engine || "classic",
    modules: {
      questions: raw?.modules?.questions ?? true,
      story: raw?.modules?.story ?? false,
      inventory: raw?.modules?.inventory ?? false,
      collectibles: raw?.modules?.collectibles ?? false,
      dialogs: raw?.modules?.dialogs ?? false,
      evidenceBook: raw?.modules?.evidenceBook ?? false,
      fingerprints: raw?.modules?.fingerprints ?? false,
      fakeClues: raw?.modules?.fakeClues ?? false,
      secretRoles: raw?.modules?.secretRoles ?? false,
      sabotage: raw?.modules?.sabotage ?? false,
      chase: raw?.modules?.chase ?? false
    }
  };
}

function getSelectedGameType() {
  const gameTypeId = getValue("cityGameTypeSelector").trim();
  if (!gameTypeId || !speltypesCache[gameTypeId]) {
    return normalizeGameType({ engine: "classic", name: "Klassiek" });
  }
  return normalizeGameType(speltypesCache[gameTypeId]);
}

function showSection(id, visible) {
  const el = byId(id);
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}

function applyCheckpointEditorToGameType() {
  activeGameType = getSelectedGameType();

  const storyVisible =
    activeGameType.modules.story ||
    activeGameType.engine === "collectibles" ||
    activeGameType.engine === "murder";

  showSection("cpStoryBlock", storyVisible);

  const collectibleVisible =
    activeGameType.modules.collectibles ||
    activeGameType.modules.inventory ||
    activeGameType.modules.evidenceBook ||
    activeGameType.engine === "collectibles" ||
    activeGameType.engine === "murder";

  showSection("cpCollectibleSection", collectibleVisible);

  const collectibleAdvancedVisible =
    activeGameType.engine === "collectibles" ||
    activeGameType.modules.collectibles;

  showSection("cpCollectibleAdvancedSection", collectibleAdvancedVisible);

  const murderVisible =
    activeGameType.engine === "murder" ||
    activeGameType.modules.dialogs ||
    activeGameType.modules.evidenceBook ||
    activeGameType.modules.fingerprints ||
    activeGameType.modules.fakeClues;

  showSection("cpMurderSection", murderVisible);

  const moleVisible =
    activeGameType.engine === "mole" ||
    activeGameType.modules.secretRoles ||
    activeGameType.modules.sabotage;

  showSection("cpMoleSection", moleVisible);

  const huntersVisible =
    activeGameType.engine === "hunters" ||
    activeGameType.modules.chase;

  showSection("cpHuntersSection", huntersVisible);

  const sectionTitle = byId("cpCollectibleSectionTitle");
  if (sectionTitle) {
    if (activeGameType.engine === "murder") {
      sectionTitle.innerText = "Bewijsmateriaal / bewijsboek";
    } else if (activeGameType.engine === "collectibles") {
      sectionTitle.innerText = "Collectible / dossieritem";
    } else {
      sectionTitle.innerText = "Collectible / dossieritem";
    }
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
    themeId: city.themeId || "",
    gameTypeId: city.gameTypeId || ""
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
    themeId: city.themeId || fallback?.themeId || "",
    gameTypeId: city.gameTypeId || fallback?.gameTypeId || ""
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
      themeId: "",
      gameTypeId: ""
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
    themeId: "",
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

function populateCitySelector() {
  const select = byId("adminCitySelector");
  if (!select) return;

  const keys = mergedCityKeys();
  select.innerHTML = "";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "Kies een stad";
  select.appendChild(emptyOption);

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

  select.value = activeCityKey || "";
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

function populateGameTypeSelector(selectedGameTypeId = "") {
  const select = byId("cityGameTypeSelector");
  if (!select) return;

  select.innerHTML = "";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "Geen speltype gekoppeld";
  select.appendChild(emptyOption);

  Object.keys(speltypesCache)
    .sort((a, b) => a.localeCompare(b))
    .forEach((gameTypeKey) => {
      const option = document.createElement("option");
      option.value = gameTypeKey;
      option.textContent = speltypesCache[gameTypeKey]?.name || gameTypeKey;
      select.appendChild(option);
    });

  select.value = selectedGameTypeId || "";
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
  populateGameTypeSelector(city.gameTypeId || "");
  applyCheckpointEditorToGameType();

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
  if (!map) return;

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

    if (cp.collectibleCoords && Array.isArray(cp.collectibleCoords) && cp.collectibleCoords.length === 2) {
      const collectibleMarker = L.circleMarker(cp.collectibleCoords, {
        radius: 6
      }).addTo(map);
      collectibleMarker.bindPopup(`Collectible bij ${cp.name || "checkpoint"}`);
      markers.push(collectibleMarker);
    }
  });
}

function taskTypeLabel(type) {
  const labels = {
    text: "Tekstvraag",
    riddle: "Raadsel",
    multipleChoice: "Meerkeuze",
    matching: "Koppelen",
    imagePuzzle: "Afbeeldingspuzzel",
    photo: "Foto-opdracht"
  };
  return labels[type] || type || "Tekstvraag";
}

function toggleTaskFields() {
  const type = getValue("cpTaskType") || "text";

  showSection("cpTextAnswersWrapper", false);
  showSection("cpMultipleChoiceWrapper", false);
  showSection("cpMatchingWrapper", false);
  showSection("cpImagePuzzleWrapper", false);
  showSection("cpPhotoWrapper", false);

  if (type === "text" || type === "riddle") {
    showSection("cpTextAnswersWrapper", true);
  }

  if (type === "multipleChoice") {
    showSection("cpMultipleChoiceWrapper", true);
  }

  if (type === "matching") {
    showSection("cpMatchingWrapper", true);
  }

  if (type === "imagePuzzle") {
    showSection("cpImagePuzzleWrapper", true);
  }

  if (type === "photo") {
    showSection("cpPhotoWrapper", true);
  }
}

function clearForm() {
  setValue("cpName", "");
  setValue("cpLat", "");
  setValue("cpLng", "");
  setValue("cpRadius", "");
  setValue("cpTaskType", "text");
  setValue("cpStory", "");
  setValue("cpQuestion", "");
  setValue("cpAnswers", "");
  setValue("cpOptions", "");
  setValue("cpCorrectOption", "");
  setValue("cpLeftItems", "");
  setValue("cpRightItems", "");
  setValue("cpCorrectPairs", "");
  setValue("cpImageUrl", "");
  setValue("cpGridSize", "3");
  setValue("cpVideo", "");
  setValue("cpAudio", "");
  setValue("cpImage", "");
  setValue("cpPointsCorrect", "10");
  setValue("cpPointsAfterMaxTries", "4");

  setValue("cpCollectibleName", "");
  setValue("cpCollectibleIcon", "");
  setValue("cpCollectibleLockedIcon", "❓");
  setValue("cpCollectibleLockedName", "Onbekend spoor");
  setValue("cpCollectibleDescription", "");
  setValue("cpCollectibleLat", "");
  setValue("cpCollectibleLng", "");
  setValue("cpCollectibleSearchRadius", "");
  setValue("cpCollectibleRevealDistance", "");

  setValue("cpSuspectName", "");
  setValue("cpDialogText", "");
  setChecked("cpHasFingerprint", false);
  setChecked("cpIsFakeClue", false);
  setChecked("cpEvidenceIsCritical", false);
  setValue("cpFingerprintLabel", "");

  setValue("cpSabotageHint", "");
  setChecked("cpCanTriggerSabotage", false);
  setChecked("cpSecretObjective", false);
  setValue("cpSecretObjectiveText", "");

  setChecked("cpCanSwitchRoles", false);
  setChecked("cpCanTriggerChase", false);
  setValue("cpRoleSwitchValue", "");
  setValue("cpChaseRadius", "");

  selectedIndex = null;
  toggleTaskFields();
  applyCheckpointEditorToGameType();
  setText("cpEditorStatus", "Nieuw checkpoint");
}

function loadCheckpointIntoForm(index) {
  const cp = checkpoints[index];
  if (!cp) return;

  selectedIndex = index;

  setValue("cpName", cp.name || "");
  setValue("cpLat", cp.coords?.[0] ?? "");
  setValue("cpLng", cp.coords?.[1] ?? "");
  setValue("cpRadius", cp.radius ?? "");
  setValue("cpTaskType", cp.taskType || "text");
  setValue("cpStory", cp.story || "");
  setValue("cpQuestion", cp.question || "");

  setValue("cpVideo", cp.video || "");
  setValue("cpAudio", cp.audio || "");
  setValue("cpImage", cp.image || "");

  setValue("cpPointsCorrect", cp.pointsCorrect ?? 10);
  setValue("cpPointsAfterMaxTries", cp.pointsAfterMaxTries ?? 4);

  setValue("cpAnswers", Array.isArray(cp.answers) ? cp.answers.join(", ") : "");
  setValue("cpOptions", Array.isArray(cp.options) ? cp.options.join(", ") : "");
  setValue("cpCorrectOption", cp.correctOption ?? "");

  setValue("cpLeftItems", Array.isArray(cp.leftItems) ? cp.leftItems.join(", ") : "");
  setValue("cpRightItems", Array.isArray(cp.rightItems) ? cp.rightItems.join(", ") : "");
  setValue(
    "cpCorrectPairs",
    cp.correctPairs
      ? Object.entries(cp.correctPairs).map(([left, right]) => `${left}=${right}`).join(", ")
      : ""
  );

  setValue("cpImageUrl", cp.imageUrl || "");
  setValue("cpGridSize", cp.gridSize || 3);

  const collectible = cp.collectible || {};
  setValue("cpCollectibleName", collectible.name || "");
  setValue("cpCollectibleIcon", collectible.icon || "");
  setValue("cpCollectibleLockedIcon", collectible.lockedIcon || "❓");
  setValue("cpCollectibleLockedName", collectible.lockedName || "Onbekend spoor");
  setValue("cpCollectibleDescription", collectible.description || "");
  setValue("cpCollectibleLat", cp.collectibleCoords?.[0] ?? "");
  setValue("cpCollectibleLng", cp.collectibleCoords?.[1] ?? "");
  setValue("cpCollectibleSearchRadius", cp.collectibleSearchRadius ?? "");
  setValue("cpCollectibleRevealDistance", cp.collectibleRevealDistance ?? "");

  setValue("cpSuspectName", cp.suspectName || "");
  setValue("cpDialogText", cp.dialogText || "");
  setChecked("cpHasFingerprint", !!cp.hasFingerprint);
  setChecked("cpIsFakeClue", !!cp.isFakeClue);
  setChecked("cpEvidenceIsCritical", !!cp.evidenceIsCritical);
  setValue("cpFingerprintLabel", cp.fingerprintLabel || "");

  setValue("cpSabotageHint", cp.sabotageHint || "");
  setChecked("cpCanTriggerSabotage", !!cp.canTriggerSabotage);
  setChecked("cpSecretObjective", !!cp.secretObjective);
  setValue("cpSecretObjectiveText", cp.secretObjectiveText || "");

  setChecked("cpCanSwitchRoles", !!cp.canSwitchRoles);
  setChecked("cpCanTriggerChase", !!cp.canTriggerChase);
  setValue("cpRoleSwitchValue", cp.roleSwitchValue ?? "");
  setValue("cpChaseRadius", cp.chaseRadius ?? "");

  toggleTaskFields();
  applyCheckpointEditorToGameType();
  renderCheckpointList();
  setText("cpEditorStatus", "Checkpoint " + (index + 1) + " geselecteerd");
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
    const type = cp.taskType || "text";

    if (type === "multipleChoice") {
      extra = `<p><strong>Opties:</strong> ${(cp.options || []).join(" | ")}</p>`;
    } else if (type === "matching") {
      extra = `<p><strong>Matching:</strong> ${(cp.leftItems || []).length} koppels</p>`;
    } else if (type === "imagePuzzle") {
      extra = `<p><strong>Afbeelding:</strong> ${cp.imageUrl || "-"}</p>`;
    } else if (type === "photo") {
      extra = `<p><strong>Type:</strong> Foto-opdracht</p>`;
    } else {
      extra = `<p><strong>Antwoorden:</strong> ${(cp.answers || []).join(", ")}</p>`;
    }

    const itemInfo = cp.collectible?.name
      ? `<p><strong>Item:</strong> ${cp.collectible.icon || "❓"} ${cp.collectible.name}</p>`
      : "";

    const murderInfo =
      cp.suspectName || cp.dialogText || cp.hasFingerprint || cp.isFakeClue
        ? `
          ${cp.suspectName ? `<p><strong>Verdachte:</strong> ${cp.suspectName}</p>` : ""}
          ${cp.hasFingerprint ? `<p><strong>Afdruk:</strong> ja</p>` : ""}
          ${cp.isFakeClue ? `<p><strong>Vals spoor:</strong> ja</p>` : ""}
        `
        : "";

    const moleInfo =
      cp.canTriggerSabotage || cp.secretObjective
        ? `
          ${cp.canTriggerSabotage ? `<p><strong>Sabotage:</strong> mogelijk</p>` : ""}
          ${cp.secretObjective ? `<p><strong>Geheime opdracht:</strong> ja</p>` : ""}
        `
        : "";

    const huntersInfo =
      cp.canSwitchRoles || cp.canTriggerChase
        ? `
          ${cp.canSwitchRoles ? `<p><strong>Rolwissel:</strong> mogelijk</p>` : ""}
          ${cp.canTriggerChase ? `<p><strong>Jachtfase:</strong> mogelijk</p>` : ""}
        `
        : "";

    div.innerHTML = `
      <h3>${index + 1}. ${cp.name || "Checkpoint"}</h3>
      <p><strong>Type:</strong> ${taskTypeLabel(type)}</p>
      <p><strong>Locatie:</strong> ${cp.coords?.[0] ?? "-"}, ${cp.coords?.[1] ?? "-"}</p>
      <p><strong>Radius:</strong> ${cp.radius ?? "-"} m</p>
      <p><strong>Vraag:</strong> ${cp.question || "-"}</p>
      ${cp.story ? `<p><strong>Story:</strong> ${cp.story}</p>` : ""}
      ${cp.video ? `<p><strong>Video:</strong> ${cp.video}</p>` : ""}
      ${cp.audio ? `<p><strong>Audio:</strong> ${cp.audio}</p>` : ""}
      ${cp.image ? `<p><strong>Afbeelding:</strong> ${cp.image}</p>` : ""}
      ${itemInfo}
      ${murderInfo}
      ${moleInfo}
      ${huntersInfo}
      ${extra}
      <div class="button-grid">
        <button type="button" data-edit-index="${index}">Bewerk</button>
        <button type="button" data-delete-index="${index}">Verwijder</button>
      </div>
    `;

    container.appendChild(div);
  });

  container.querySelectorAll("[data-edit-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.getAttribute("data-edit-index"));
      loadCheckpointIntoForm(index);
    });
  });

  container.querySelectorAll("[data-delete-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.getAttribute("data-delete-index"));
      deleteCheckpoint(index);
    });
  });
}

function buildCheckpointFromForm() {
  const name = getValue("cpName").trim();
  const lat = Number(getValue("cpLat"));
  const lng = Number(getValue("cpLng"));
  const radius = Number(getValue("cpRadius"));
  const taskType = getValue("cpTaskType") || "text";
  const question = getValue("cpQuestion").trim();

  if (!name || Number.isNaN(lat) || Number.isNaN(lng) || Number.isNaN(radius) || !question) {
    return null;
  }

  const pointsCorrect = Number(getValue("cpPointsCorrect") || 10);
  const pointsAfterMaxTries = Number(getValue("cpPointsAfterMaxTries") || 4);

  const cp = {
    name,
    coords: [lat, lng],
    radius,
    taskType,
    story: getValue("cpStory").trim(),
    question,
    video: getValue("cpVideo").trim(),
    audio: getValue("cpAudio").trim(),
    image: getValue("cpImage").trim(),
    pointsCorrect,
    pointsAfterMaxTries
  };

  if (taskType === "text" || taskType === "riddle") {
    cp.answers = parseCommaList(getValue("cpAnswers")).map(item => item.toLowerCase());
  }

  if (taskType === "multipleChoice") {
    cp.options = parseCommaList(getValue("cpOptions"));
    cp.correctOption = Number(getValue("cpCorrectOption") || 0);
  }

  if (taskType === "matching") {
    cp.leftItems = parseCommaList(getValue("cpLeftItems"));
    cp.rightItems = parseCommaList(getValue("cpRightItems"));

    cp.correctPairs = {};
    parseCommaList(getValue("cpCorrectPairs")).forEach((line) => {
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

  const collectibleEnabled =
    activeGameType?.modules?.collectibles ||
    activeGameType?.modules?.inventory ||
    activeGameType?.modules?.evidenceBook ||
    activeGameType?.engine === "collectibles" ||
    activeGameType?.engine === "murder";

  if (collectibleEnabled) {
    const collectibleName = getValue("cpCollectibleName").trim();
    const collectibleIcon = getValue("cpCollectibleIcon").trim();
    const collectibleDescription = getValue("cpCollectibleDescription").trim();
    const collectibleLockedName = getValue("cpCollectibleLockedName").trim() || "Onbekend spoor";
    const collectibleLockedIcon = getValue("cpCollectibleLockedIcon").trim() || "❓";

    if (collectibleName || collectibleIcon || collectibleDescription) {
      cp.collectible = {
        name: collectibleName || "Onbenoemd item",
        icon: collectibleIcon || "❓",
        description: collectibleDescription || "Nieuw item.",
        lockedName: collectibleLockedName,
        lockedIcon: collectibleLockedIcon
      };
    }

    const collectibleLat = getValue("cpCollectibleLat").trim();
    const collectibleLng = getValue("cpCollectibleLng").trim();
    const collectibleSearchRadius = getValue("cpCollectibleSearchRadius").trim();
    const collectibleRevealDistance = getValue("cpCollectibleRevealDistance").trim();

    if (collectibleLat !== "" && collectibleLng !== "") {
      const parsedLat = Number(collectibleLat);
      const parsedLng = Number(collectibleLng);
      if (!Number.isNaN(parsedLat) && !Number.isNaN(parsedLng)) {
        cp.collectibleCoords = [parsedLat, parsedLng];
      }
    }

    if (collectibleSearchRadius !== "") {
      const parsedSearchRadius = Number(collectibleSearchRadius);
      if (!Number.isNaN(parsedSearchRadius)) {
        cp.collectibleSearchRadius = parsedSearchRadius;
      }
    }

    if (collectibleRevealDistance !== "") {
      const parsedRevealDistance = Number(collectibleRevealDistance);
      if (!Number.isNaN(parsedRevealDistance)) {
        cp.collectibleRevealDistance = parsedRevealDistance;
      }
    }
  }

  const murderEnabled =
    activeGameType?.engine === "murder" ||
    activeGameType?.modules?.dialogs ||
    activeGameType?.modules?.evidenceBook ||
    activeGameType?.modules?.fingerprints ||
    activeGameType?.modules?.fakeClues;

  if (murderEnabled) {
    cp.suspectName = getValue("cpSuspectName").trim();
    cp.dialogText = getValue("cpDialogText").trim();
    cp.hasFingerprint = getChecked("cpHasFingerprint");
    cp.isFakeClue = getChecked("cpIsFakeClue");
    cp.evidenceIsCritical = getChecked("cpEvidenceIsCritical");
    cp.fingerprintLabel = getValue("cpFingerprintLabel").trim();
  }

  const moleEnabled =
    activeGameType?.engine === "mole" ||
    activeGameType?.modules?.secretRoles ||
    activeGameType?.modules?.sabotage;

  if (moleEnabled) {
    cp.sabotageHint = getValue("cpSabotageHint").trim();
    cp.canTriggerSabotage = getChecked("cpCanTriggerSabotage");
    cp.secretObjective = getChecked("cpSecretObjective");
    cp.secretObjectiveText = getValue("cpSecretObjectiveText").trim();
  }

  const huntersEnabled =
    activeGameType?.engine === "hunters" ||
    activeGameType?.modules?.chase;

  if (huntersEnabled) {
    cp.canSwitchRoles = getChecked("cpCanSwitchRoles");
    cp.canTriggerChase = getChecked("cpCanTriggerChase");

    const roleSwitchValue = getValue("cpRoleSwitchValue").trim();
    const chaseRadius = getValue("cpChaseRadius").trim();

    if (roleSwitchValue !== "") {
      const parsedRoleSwitchValue = Number(roleSwitchValue);
      if (!Number.isNaN(parsedRoleSwitchValue)) {
        cp.roleSwitchValue = parsedRoleSwitchValue;
      }
    }

    if (chaseRadius !== "") {
      const parsedChaseRadius = Number(chaseRadius);
      if (!Number.isNaN(parsedChaseRadius)) {
        cp.chaseRadius = parsedChaseRadius;
      }
    }
  }

  return cp;
}

function saveCheckpointToList() {
  const cp = buildCheckpointFromForm();

  if (!cp) {
    setText("cpEditorStatus", "Vul minstens naam, latitude, longitude, radius en vraag correct in.");
    return;
  }

  if (selectedIndex === null) {
    checkpoints.push(cp);
    selectedIndex = checkpoints.length - 1;
    setText("cpEditorStatus", "Checkpoint toegevoegd aan de lijst.");
  } else {
    checkpoints[selectedIndex] = cp;
    setText("cpEditorStatus", "Checkpoint bijgewerkt in de lijst.");
  }

  renderCheckpointList();
  renderMarkers();
}

function deleteCheckpoint(index) {
  checkpoints.splice(index, 1);

  if (selectedIndex === index) {
    selectedIndex = null;
    clearForm();
  } else if (selectedIndex !== null && selectedIndex > index) {
    selectedIndex--;
  }

  setText("cpEditorStatus", "Checkpoint verwijderd.");
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
    setText("cpEditorStatus", "Stad en checkpoints geladen uit Firebase.");
  } else {
    checkpoints = [];
    setText("cpEditorStatus", "Nog geen checkpoints gevonden in Firebase voor deze stad.");
  }

  fillCityForm(activeCityKey);
  selectedIndex = null;
  renderCheckpointList();
  renderMarkers();
  resetMapCity();
}

function loadTemplateData() {
  if (!activeCityKey || !fallbackCities[activeCityKey]) {
    setText("cpEditorStatus", "Geen template gevonden in cities.js voor deze stad.");
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
  populateGameTypeSelector(city.gameTypeId || "");
  applyCheckpointEditorToGameType();

  checkpoints = JSON.parse(JSON.stringify(fallbackCities[activeCityKey].defaultCheckpoints || []));
  selectedIndex = null;
  renderCheckpointList();
  renderMarkers();
  resetMapCity();

  setText("cpEditorStatus", "Template geladen voor " + city.name + ".");
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
  const gameTypeId = getValue("cityGameTypeSelector").trim();

  if (
    !cityKey ||
    !cityName ||
    Number.isNaN(centerLat) ||
    Number.isNaN(centerLng) ||
    Number.isNaN(gatherLat) ||
    Number.isNaN(gatherLng) ||
    Number.isNaN(gatherRadius)
  ) {
    setText("cpEditorStatus", "Vul alle stadsvelden correct in.");
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
    themeId: themeId || "",
    gameTypeId: gameTypeId || ""
  };

  await set(ref(db, "cities/" + cityKey), cityPayload);
  await set(ref(db, "cityData/" + cityKey + "/checkpoints"), checkpoints);

  citiesCache[cityKey] = cityPayload;
  activeCityKey = cityKey;

  populateCitySelector();
  fillCityForm(cityKey);
  resetMapCity();

  setText("cpEditorStatus", "Stad en checkpoints opgeslagen in Firebase.");
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
  clearForm();

  setText("cpEditorStatus", "Stad verwijderd uit Firebase.");
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
  populateGameTypeSelector("");

  checkpoints = [];
  selectedIndex = null;
  renderCheckpointList();
  renderMarkers();
  clearForm();

  setText("adminCityInfo", "Nieuwe stad aanmaken");
  setText("cpEditorStatus", "Vul de nieuwe stadsgegevens in.");
}

byId("adminCitySelector")?.addEventListener("change", async (e) => {
  activeCityKey = e.target.value || null;

  if (activeCityKey) {
    fillCityForm(activeCityKey);
  } else {
    setText("adminCityInfo", "Geen stad geselecteerd.");
  }

  checkpoints = [];
  selectedIndex = null;
  clearForm();
  renderCheckpointList();
  renderMarkers();
  resetMapCity();
});

byId("cpTaskType")?.addEventListener("change", toggleTaskFields);
byId("cityGameTypeSelector")?.addEventListener("change", applyCheckpointEditorToGameType);
byId("loadCityButton")?.addEventListener("click", loadCityFromFirebase);
byId("loadTemplateButton")?.addEventListener("click", loadTemplateData);
byId("newCityButton")?.addEventListener("click", startNewCityForm);
byId("saveCityButton")?.addEventListener("click", saveCityToFirebase);
byId("deleteCityButton")?.addEventListener("click", deleteCityFromFirebase);
byId("addCheckpointButton")?.addEventListener("click", clearForm);
byId("updateCheckpointButton")?.addEventListener("click", saveCheckpointToList);
byId("deleteCheckpointButton")?.addEventListener("click", () => {
  if (selectedIndex === null) {
    setText("cpEditorStatus", "Selecteer eerst een checkpoint.");
    return;
  }
  deleteCheckpoint(selectedIndex);
});

toggleTaskFields();
clearForm();
initMap();

onValue(ref(db, "themes"), (snapshot) => {
  themesCache = snapshot.val() || {};
  populateThemeSelector(getCityRecord(activeCityKey || "")?.themeId || "");
});

onValue(ref(db, "speltypes"), (snapshot) => {
  speltypesCache = snapshot.val() || {};
  populateGameTypeSelector(getCityRecord(activeCityKey || "")?.gameTypeId || "");
  applyCheckpointEditorToGameType();
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
