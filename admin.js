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
let gameTypesCache = {};

let currentCityKey = "";
let currentCheckpoints = [];
let selectedCheckpointIndex = -1;

let map = null;
let cityMarker = null;
let gatherMarker = null;
let checkpointMarkers = [];

let appInitialized = false;

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

function setStatus(text, isError = false) {
  const el = byId("adminCityInfo");
  if (!el) return;
  el.innerText = text || "";
  el.style.color = isError ? "#ffb4b4" : "";
}

function setCheckpointStatus(text, isError = false) {
  const el = byId("cpEditorStatus");
  if (!el) return;
  el.innerText = text || "";
  el.style.color = isError ? "#ffb4b4" : "";
}

function mergedCityKeys() {
  return Array.from(
    new Set([
      ...Object.keys(fallbackCities || {}),
      ...Object.keys(citiesCache || {})
    ])
  ).sort((a, b) => a.localeCompare(b));
}

function getCityRecord(cityKey) {
  const firebaseCity = citiesCache[cityKey];
  const fallbackCity = fallbackCities[cityKey];

  if (firebaseCity) {
    return {
      name: firebaseCity.name || fallbackCity?.name || cityKey,
      center: Array.isArray(firebaseCity.center)
        ? firebaseCity.center
        : fallbackCity?.center || [50.85, 4.35],
      gather: firebaseCity.gather || fallbackCity?.gather || {
        name: "Verzamelpunt",
        coords: [50.85, 4.35],
        radius: 40
      },
      themeId: firebaseCity.themeId || "",
      gameTypeId: firebaseCity.gameTypeId || ""
    };
  }

  if (fallbackCity) {
    return {
      name: fallbackCity.name || cityKey,
      center: fallbackCity.center || [50.85, 4.35],
      gather: fallbackCity.gather || {
        name: "Verzamelpunt",
        coords: fallbackCity.center || [50.85, 4.35],
        radius: 40
      },
      themeId: fallbackCity.themeId || "",
      gameTypeId: fallbackCity.gameTypeId || ""
    };
  }

  return {
    name: cityKey || "",
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

function getSelectedGameTypeId() {
  return byId("cityGameTypeSelector")?.value || "";
}

function defaultModules() {
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

function getSelectedGameType() {
  const id = getSelectedGameTypeId();
  return id ? gameTypesCache[id] || null : null;
}

function getActiveModules() {
  const gt = getSelectedGameType();
  return {
    ...defaultModules(),
    ...(gt?.modules || {})
  };
}

function showEl(el) {
  if (!el) return;
  el.classList.remove("hidden");
  el.style.display = "";
}

function hideEl(el) {
  if (!el) return;
  el.classList.add("hidden");
  el.style.display = "none";
}

function setFieldVisibility(id, visible) {
  const el = byId(id);
  if (!el) return;
  const wrapper = el.closest(".card, div, label") || el;
  if (visible) {
    wrapper.classList.remove("hidden");
    wrapper.style.display = "";
  } else {
    wrapper.classList.add("hidden");
    wrapper.style.display = "none";
  }
}

function populateCitySelector() {
  const selector = byId("adminCitySelector");
  if (!selector) return;

  const current = selector.value;
  selector.innerHTML = "";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "-- Kies een stad --";
  selector.appendChild(emptyOption);

  mergedCityKeys().forEach((key) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = getCityRecord(key).name;
    selector.appendChild(option);
  });

  if (current && mergedCityKeys().includes(current)) {
    selector.value = current;
  }
}

function populateThemeSelector() {
  const selector = byId("cityThemeSelector");
  if (!selector) return;

  const current = selector.value;
  selector.innerHTML = "";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "-- Geen thema --";
  selector.appendChild(emptyOption);

  Object.keys(themesCache)
    .sort((a, b) => {
      const nameA = themesCache[a]?.name || a;
      const nameB = themesCache[b]?.name || b;
      return nameA.localeCompare(nameB);
    })
    .forEach((id) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = themesCache[id]?.name || id;
      selector.appendChild(option);
    });

  selector.value = current && themesCache[current] ? current : "";
}

function populateGameTypeSelector() {
  const selector = byId("cityGameTypeSelector");
  if (!selector) return;

  const current = selector.value;
  selector.innerHTML = "";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "-- Geen speltype --";
  selector.appendChild(emptyOption);

  Object.keys(gameTypesCache)
    .sort((a, b) => {
      const nameA = gameTypesCache[a]?.name || a;
      const nameB = gameTypesCache[b]?.name || b;
      return nameA.localeCompare(nameB);
    })
    .forEach((id) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = gameTypesCache[id]?.name || id;
      selector.appendChild(option);
    });

  selector.value = current && gameTypesCache[current] ? current : "";
}

function initMap() {
  map = L.map("map").setView([50.85, 4.35], 14);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "OpenStreetMap"
  }).addTo(map);

  setTimeout(() => map.invalidateSize(), 250);
}

function clearCheckpointMarkers() {
  checkpointMarkers.forEach((marker) => map.removeLayer(marker));
  checkpointMarkers = [];
}

function refreshMap() {
  if (!map) return;

  const centerLat = Number(byId("cityCenterLat")?.value || 50.85);
  const centerLng = Number(byId("cityCenterLng")?.value || 4.35);
  const gatherLat = Number(byId("gatherLatInput")?.value || centerLat);
  const gatherLng = Number(byId("gatherLngInput")?.value || centerLng);

  if (cityMarker) map.removeLayer(cityMarker);
  if (gatherMarker) map.removeLayer(gatherMarker);
  clearCheckpointMarkers();

  cityMarker = L.marker([centerLat, centerLng]).addTo(map).bindPopup("Center");
  gatherMarker = L.marker([gatherLat, gatherLng]).addTo(map).bindPopup("Verzamelpunt");

  currentCheckpoints.forEach((cp, index) => {
    if (!Array.isArray(cp.coords)) return;

    const marker = L.marker(cp.coords).addTo(map).bindPopup(cp.name || `Checkpoint ${index + 1}`);
    marker.on("click", () => {
      loadCheckpointIntoEditor(index);
    });
    checkpointMarkers.push(marker);
  });

  const bounds = [
    [centerLat, centerLng],
    [gatherLat, gatherLng],
    ...currentCheckpoints.filter(cp => Array.isArray(cp.coords)).map(cp => cp.coords)
  ];

  if (bounds.length) {
    map.fitBounds(bounds, { padding: [30, 30] });
  }
}

async function loadCheckpointsForCity(cityKey) {
  const snapshot = await get(ref(db, "cityData/" + cityKey + "/checkpoints"));
  if (snapshot.exists()) {
    const data = snapshot.val();
    if (Array.isArray(data)) return data;
  }

  const fallback = fallbackCities[cityKey]?.defaultCheckpoints;
  return Array.isArray(fallback) ? fallback : [];
}

function parseCommaList(value) {
  return String(value || "")
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);
}

function parseCorrectPairs(value) {
  const obj = {};
  String(value || "")
    .split("\n")
    .map(v => v.trim())
    .filter(Boolean)
    .forEach((line) => {
      const parts = line.split("=");
      if (parts.length >= 2) {
        const left = parts[0].trim();
        const right = parts.slice(1).join("=").trim();
        if (left && right) obj[left] = right;
      }
    });
  return obj;
}

function correctPairsToText(obj = {}) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function getInventoryLabelFromModules() {
  const gt = getSelectedGameType();
  const modules = getActiveModules();

  if (modules.evidenceBook || gt?.engine === "murder") return "Bewijsstuk / dossieritem";
  if (modules.collectibles && modules.usableItems) return "Collectible / bruikbaar item";
  if (modules.collectibles) return "Grimoire-item / collectible";
  if (modules.inventory) return "Inventory-item";
  return "Extra item";
}

function updateCheckpointTaskVisibility() {
  const type = byId("cpTaskType")?.value || "text";

  byId("cpTextAnswersWrapper")?.classList.toggle("hidden", !(type === "text" || type === "riddle"));
  byId("cpMultipleChoiceWrapper")?.classList.toggle("hidden", type !== "multipleChoice");
  byId("cpMatchingWrapper")?.classList.toggle("hidden", type !== "matching");
  byId("cpImagePuzzleWrapper")?.classList.toggle("hidden", type !== "imagePuzzle");
  byId("cpPhotoWrapper")?.classList.toggle("hidden", type !== "photo");
}

function updateCheckpointFieldsByModules() {
  const modules = getActiveModules();
  const gt = getSelectedGameType();

  const collectibleSection = byId("cpCollectibleSection");
  const collectibleAdvancedSection = byId("cpCollectibleAdvancedSection");
  const murderSection = byId("cpMurderSection");
  const moleSection = byId("cpMoleSection");
  const huntersSection = byId("cpHuntersSection");
  const storyBlock = byId("cpStoryBlock");
  const collectibleTitle = byId("cpCollectibleSectionTitle");

  if (collectibleTitle) {
    collectibleTitle.innerText = getInventoryLabelFromModules();
  }

  if (modules.story || modules.dialogs) {
    showEl(storyBlock);
  } else {
    hideEl(storyBlock);
  }

  if (modules.collectibles || modules.inventory || modules.evidenceBook || modules.usableItems) {
    showEl(collectibleSection);
  } else {
    hideEl(collectibleSection);
  }

  if (modules.collectibles || modules.searchZones || modules.hiddenReveal || modules.clickableItems) {
    showEl(collectibleAdvancedSection);
  } else {
    hideEl(collectibleAdvancedSection);
  }

  if (modules.evidenceBook || modules.fingerprints || modules.fakeClues || modules.deduction || gt?.engine === "murder") {
    showEl(murderSection);
  } else {
    hideEl(murderSection);
  }

  if (modules.sabotage || modules.secretRoles || modules.effects || gt?.engine === "mol") {
    showEl(moleSection);
  } else {
    hideEl(moleSection);
  }

  if (modules.chase || modules.roleSwitch || modules.publicRoles || gt?.engine === "hunters") {
    showEl(huntersSection);
  } else {
    hideEl(huntersSection);
  }

  const taskTypeSelect = byId("cpTaskType");
  if (taskTypeSelect) {
    const imagePuzzleOption = Array.from(taskTypeSelect.options).find(opt => opt.value === "imagePuzzle");
    const photoOption = Array.from(taskTypeSelect.options).find(opt => opt.value === "photo");

    if (imagePuzzleOption) imagePuzzleOption.hidden = !modules.puzzles;
    if (photoOption) photoOption.hidden = !modules.media;

    if (!modules.puzzles && taskTypeSelect.value === "imagePuzzle") {
      taskTypeSelect.value = "text";
    }

    if (!modules.media && taskTypeSelect.value === "photo") {
      taskTypeSelect.value = "text";
    }
  }

  setFieldVisibility("cpVideo", modules.media);
  setFieldVisibility("cpAudio", modules.media);
  setFieldVisibility("cpImage", modules.media || modules.puzzles);

  updateCheckpointTaskVisibility();
}

function collectCheckpointFromEditor() {
  const modules = getActiveModules();

  const cp = {
    name: byId("cpName")?.value?.trim() || "Checkpoint",
    coords: [
      Number(byId("cpLat")?.value || 0),
      Number(byId("cpLng")?.value || 0)
    ],
    radius: Number(byId("cpRadius")?.value || 20),
    taskType: byId("cpTaskType")?.value || "text",
    question: byId("cpQuestion")?.value?.trim() || "",
    pointsCorrect: Number(byId("cpPointsCorrect")?.value || 0),
    pointsAfterMaxTries: Number(byId("cpPointsAfterMaxTries")?.value || 0)
  };

  if (modules.story || modules.dialogs) {
    cp.story = byId("cpStory")?.value?.trim() || "";
  }

  if (cp.taskType === "text" || cp.taskType === "riddle") {
    cp.answers = parseCommaList(byId("cpAnswers")?.value || "");
  }

  if (cp.taskType === "multipleChoice") {
    cp.options = parseCommaList(byId("cpOptions")?.value || "");
    cp.correctOption = Number(byId("cpCorrectOption")?.value || 0);
  }

  if (cp.taskType === "matching") {
    cp.leftItems = parseCommaList(byId("cpLeftItems")?.value || "");
    cp.rightItems = parseCommaList(byId("cpRightItems")?.value || "");
    cp.correctPairs = parseCorrectPairs(byId("cpCorrectPairs")?.value || "");
  }

  if (cp.taskType === "imagePuzzle" && modules.puzzles) {
    cp.imageUrl = byId("cpImageUrl")?.value?.trim() || "";
    cp.gridSize = Number(byId("cpGridSize")?.value || 3);
  }

  if (modules.media || modules.puzzles) {
    if (byId("cpVideo")?.value?.trim()) cp.video = byId("cpVideo").value.trim();
    if (byId("cpAudio")?.value?.trim()) cp.audio = byId("cpAudio").value.trim();
    if (byId("cpImage")?.value?.trim()) cp.image = byId("cpImage").value.trim();
  }

  if (modules.collectibles || modules.inventory || modules.evidenceBook || modules.usableItems) {
    const collectibleName = byId("cpCollectibleName")?.value?.trim() || "";
    if (collectibleName) {
      cp.collectible = {
        name: collectibleName,
        icon: byId("cpCollectibleIcon")?.value || "❓",
        description: byId("cpCollectibleDescription")?.value?.trim() || "",
        lockedName: byId("cpCollectibleLockedName")?.value?.trim() || "Onbekend spoor",
        lockedIcon: byId("cpCollectibleLockedIcon")?.value || "❓"
      };
    }
  }

  if (modules.collectibles || modules.searchZones || modules.hiddenReveal || modules.clickableItems) {
    const cLat = byId("cpCollectibleLat")?.value;
    const cLng = byId("cpCollectibleLng")?.value;
    if (cLat && cLng) {
      cp.collectibleCoords = [Number(cLat), Number(cLng)];
    }

    if (byId("cpCollectibleSearchRadius")?.value) {
      cp.collectibleSearchRadius = Number(byId("cpCollectibleSearchRadius").value);
    }

    if (byId("cpCollectibleRevealDistance")?.value) {
      cp.collectibleRevealDistance = Number(byId("cpCollectibleRevealDistance").value);
    }
  }

  if (modules.evidenceBook || modules.fingerprints || modules.fakeClues || modules.deduction) {
    const suspectName = byId("cpSuspectName")?.value?.trim() || "";
    const dialogText = byId("cpDialogText")?.value?.trim() || "";

    if (suspectName) cp.suspectName = suspectName;
    if (dialogText) cp.dialogText = dialogText;
    if (byId("cpHasFingerprint")?.checked) cp.hasFingerprint = true;
    if (byId("cpIsFakeClue")?.checked) cp.isFakeClue = true;
    if (byId("cpEvidenceIsCritical")?.checked) cp.evidenceIsCritical = true;
    if (byId("cpFingerprintLabel")?.value?.trim()) cp.fingerprintLabel = byId("cpFingerprintLabel").value.trim();
  }

  if (modules.sabotage || modules.secretRoles || modules.effects) {
    if (byId("cpSabotageHint")?.value?.trim()) cp.sabotageHint = byId("cpSabotageHint").value.trim();
    if (byId("cpCanTriggerSabotage")?.checked) cp.canTriggerSabotage = true;
    if (byId("cpSecretObjective")?.checked) cp.secretObjective = true;
    if (byId("cpSecretObjectiveText")?.value?.trim()) cp.secretObjectiveText = byId("cpSecretObjectiveText").value.trim();
  }

  if (modules.chase || modules.roleSwitch || modules.publicRoles) {
    if (byId("cpCanSwitchRoles")?.checked) cp.canSwitchRoles = true;
    if (byId("cpCanTriggerChase")?.checked) cp.canTriggerChase = true;
    if (byId("cpRoleSwitchValue")?.value) cp.roleSwitchValue = Number(byId("cpRoleSwitchValue").value);
    if (byId("cpChaseRadius")?.value) cp.chaseRadius = Number(byId("cpChaseRadius").value);
  }

  return cp;
}

function clearCheckpointEditor() {
  [
    "cpName","cpLat","cpLng","cpRadius","cpStory","cpQuestion","cpAnswers","cpOptions","cpCorrectOption",
    "cpLeftItems","cpRightItems","cpCorrectPairs","cpImageUrl","cpGridSize","cpVideo","cpAudio","cpImage",
    "cpPointsCorrect","cpPointsAfterMaxTries","cpCollectibleName","cpCollectibleLockedName","cpCollectibleDescription",
    "cpCollectibleLat","cpCollectibleLng","cpCollectibleSearchRadius","cpCollectibleRevealDistance",
    "cpSuspectName","cpDialogText","cpFingerprintLabel","cpSabotageHint","cpSecretObjectiveText",
    "cpRoleSwitchValue","cpChaseRadius"
  ].forEach((id) => {
    if (byId(id)) byId(id).value = "";
  });

  if (byId("cpTaskType")) byId("cpTaskType").value = "text";
  if (byId("cpCollectibleIcon")) byId("cpCollectibleIcon").value = "";
  if (byId("cpCollectibleLockedIcon")) byId("cpCollectibleLockedIcon").value = "❓";

  [
    "cpHasFingerprint","cpIsFakeClue","cpEvidenceIsCritical",
    "cpCanTriggerSabotage","cpSecretObjective",
    "cpCanSwitchRoles","cpCanTriggerChase"
  ].forEach((id) => {
    if (byId(id)) byId(id).checked = false;
  });

  selectedCheckpointIndex = -1;
  updateCheckpointFieldsByModules();
}

function loadCheckpointIntoEditor(index) {
  const cp = currentCheckpoints[index];
  if (!cp) return;

  selectedCheckpointIndex = index;

  byId("cpName").value = cp.name || "";
  byId("cpLat").value = cp.coords?.[0] ?? "";
  byId("cpLng").value = cp.coords?.[1] ?? "";
  byId("cpRadius").value = cp.radius ?? 20;
  byId("cpTaskType").value = cp.taskType || "text";
  byId("cpStory").value = cp.story || "";
  byId("cpQuestion").value = cp.question || "";
  byId("cpAnswers").value = (cp.answers || []).join(", ");
  byId("cpOptions").value = (cp.options || []).join(", ");
  byId("cpCorrectOption").value = cp.correctOption ?? 0;
  byId("cpLeftItems").value = (cp.leftItems || []).join(", ");
  byId("cpRightItems").value = (cp.rightItems || []).join(", ");
  byId("cpCorrectPairs").value = correctPairsToText(cp.correctPairs || {});
  byId("cpImageUrl").value = cp.imageUrl || "";
  byId("cpGridSize").value = cp.gridSize ?? 3;
  byId("cpVideo").value = cp.video || "";
  byId("cpAudio").value = cp.audio || "";
  byId("cpImage").value = cp.image || "";
  byId("cpPointsCorrect").value = cp.pointsCorrect ?? 0;
  byId("cpPointsAfterMaxTries").value = cp.pointsAfterMaxTries ?? 0;

  byId("cpCollectibleName").value = cp.collectible?.name || "";
  byId("cpCollectibleIcon").value = cp.collectible?.icon || "";
  byId("cpCollectibleLockedIcon").value = cp.collectible?.lockedIcon || "❓";
  byId("cpCollectibleLockedName").value = cp.collectible?.lockedName || "";
  byId("cpCollectibleDescription").value = cp.collectible?.description || "";
  byId("cpCollectibleLat").value = cp.collectibleCoords?.[0] ?? "";
  byId("cpCollectibleLng").value = cp.collectibleCoords?.[1] ?? "";
  byId("cpCollectibleSearchRadius").value = cp.collectibleSearchRadius ?? "";
  byId("cpCollectibleRevealDistance").value = cp.collectibleRevealDistance ?? "";

  byId("cpSuspectName").value = cp.suspectName || "";
  byId("cpDialogText").value = cp.dialogText || "";
  byId("cpHasFingerprint").checked = !!cp.hasFingerprint;
  byId("cpIsFakeClue").checked = !!cp.isFakeClue;
  byId("cpEvidenceIsCritical").checked = !!cp.evidenceIsCritical;
  byId("cpFingerprintLabel").value = cp.fingerprintLabel || "";

  byId("cpSabotageHint").value = cp.sabotageHint || "";
  byId("cpCanTriggerSabotage").checked = !!cp.canTriggerSabotage;
  byId("cpSecretObjective").checked = !!cp.secretObjective;
  byId("cpSecretObjectiveText").value = cp.secretObjectiveText || "";

  byId("cpCanSwitchRoles").checked = !!cp.canSwitchRoles;
  byId("cpCanTriggerChase").checked = !!cp.canTriggerChase;
  byId("cpRoleSwitchValue").value = cp.roleSwitchValue ?? "";
  byId("cpChaseRadius").value = cp.chaseRadius ?? "";

  updateCheckpointFieldsByModules();
  setCheckpointStatus(`Checkpoint ${index + 1} geladen.`);
}

function renderCheckpointList() {
  const container = byId("checkpointList");
  if (!container) return;

  if (!currentCheckpoints.length) {
    container.innerHTML = "<p>Nog geen checkpoints toegevoegd.</p>";
    return;
  }

  container.innerHTML = currentCheckpoints.map((cp, index) => `
    <div class="group-card">
      <strong>${index + 1}. ${cp.name || "Checkpoint"}</strong><br>
      ${Array.isArray(cp.coords) ? `${cp.coords[0]}, ${cp.coords[1]}` : "-"}<br><br>
      <button type="button" data-cp-index="${index}">Bewerk checkpoint</button>
    </div>
  `).join("");

  container.querySelectorAll("[data-cp-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      loadCheckpointIntoEditor(Number(btn.getAttribute("data-cp-index")));
    });
  });
}

function loadCityIntoForm(cityKey, cityData, checkpoints = []) {
  currentCityKey = cityKey;
  currentCheckpoints = checkpoints;

  const city = {
    name: cityData?.name || getCityRecord(cityKey).name,
    center: Array.isArray(cityData?.center) ? cityData.center : getCityRecord(cityKey).center,
    gather: cityData?.gather || getCityRecord(cityKey).gather,
    themeId: cityData?.themeId || "",
    gameTypeId: cityData?.gameTypeId || ""
  };

  byId("adminCitySelector").value = cityKey || "";
  byId("cityKeyInput").value = cityKey || "";
  byId("cityNameInput").value = city.name || "";
  byId("cityCenterLat").value = city.center?.[0] ?? "";
  byId("cityCenterLng").value = city.center?.[1] ?? "";

  const gatherCoords = Array.isArray(city.gather)
    ? city.gather
    : city.gather?.coords || city.center;

  byId("gatherNameInput").value = city.gather?.name || "Verzamelpunt";
  byId("gatherLatInput").value = gatherCoords?.[0] ?? "";
  byId("gatherLngInput").value = gatherCoords?.[1] ?? "";
  byId("gatherRadiusInput").value = city.gather?.radius ?? 40;

  byId("cityThemeSelector").value = city.themeId || "";
  byId("cityGameTypeSelector").value = city.gameTypeId || "";

  renderCheckpointList();
  refreshMap();
  clearCheckpointEditor();
  updateCheckpointFieldsByModules();

  setStatus(`Stad "${city.name}" geladen.`);
}

async function loadCityFromFirebase() {
  const cityKey = byId("adminCitySelector")?.value || "";
  if (!cityKey) {
    setStatus("Kies eerst een stad.", true);
    return;
  }

  try {
    const citySnap = await get(ref(db, "cities/" + cityKey));
    const cityData = citySnap.exists() ? citySnap.val() : getCityRecord(cityKey);
    const checkpoints = await loadCheckpointsForCity(cityKey);
    loadCityIntoForm(cityKey, cityData, checkpoints);
  } catch (error) {
    console.error(error);
    setStatus("Laden mislukt: " + error.message, true);
  }
}

async function loadTemplateCity() {
  const cityKey = byId("adminCitySelector")?.value || "";
  if (!cityKey) {
    setStatus("Kies eerst een stad.", true);
    return;
  }

  const city = getCityRecord(cityKey);
  const checkpoints = Array.isArray(fallbackCities[cityKey]?.defaultCheckpoints)
    ? fallbackCities[cityKey].defaultCheckpoints
    : [];

  loadCityIntoForm(cityKey, city, checkpoints);
  setStatus(`Template voor "${city.name}" geladen.`);
}

function startNewCity() {
  currentCityKey = "";
  currentCheckpoints = [];
  selectedCheckpointIndex = -1;

  byId("adminCitySelector").value = "";
  byId("cityKeyInput").value = "";
  byId("cityNameInput").value = "";
  byId("cityCenterLat").value = "";
  byId("cityCenterLng").value = "";
  byId("gatherNameInput").value = "Verzamelpunt";
  byId("gatherLatInput").value = "";
  byId("gatherLngInput").value = "";
  byId("gatherRadiusInput").value = "40";
  byId("cityThemeSelector").value = "";
  byId("cityGameTypeSelector").value = "";

  renderCheckpointList();
  clearCheckpointEditor();
  refreshMap();
  updateCheckpointFieldsByModules();
  setStatus("Nieuwe stad gestart.");
}

async function saveCity() {
  const cityKey = byId("cityKeyInput")?.value?.trim().toLowerCase() || "";

  if (!cityKey) {
    setStatus("Vul eerst een geldige stads-ID in.", true);
    return;
  }

  const cityData = {
    name: byId("cityNameInput")?.value?.trim() || cityKey,
    center: [
      Number(byId("cityCenterLat")?.value || 50.85),
      Number(byId("cityCenterLng")?.value || 4.35)
    ],
    gather: {
      name: byId("gatherNameInput")?.value?.trim() || "Verzamelpunt",
      coords: [
        Number(byId("gatherLatInput")?.value || byId("cityCenterLat")?.value || 50.85),
        Number(byId("gatherLngInput")?.value || byId("cityCenterLng")?.value || 4.35)
      ],
      radius: Number(byId("gatherRadiusInput")?.value || 40)
    },
    themeId: byId("cityThemeSelector")?.value || "",
    gameTypeId: byId("cityGameTypeSelector")?.value || ""
  };

  try {
    await set(ref(db, "cities/" + cityKey), cityData);
    await set(ref(db, "cityData/" + cityKey + "/checkpoints"), currentCheckpoints);

    currentCityKey = cityKey;
    byId("adminCitySelector").value = cityKey;
    setStatus(`Stad "${cityData.name}" opgeslagen.`);
  } catch (error) {
    console.error(error);
    setStatus("Opslaan mislukt: " + error.message, true);
  }
}

async function deleteCity() {
  const cityKey = byId("cityKeyInput")?.value?.trim().toLowerCase() || "";
  if (!cityKey) {
    setStatus("Geen stad geselecteerd om te verwijderen.", true);
    return;
  }

  const ok = confirm(`Verwijder stad "${cityKey}"?`);
  if (!ok) return;

  try {
    await remove(ref(db, "cities/" + cityKey));
    await remove(ref(db, "cityData/" + cityKey));
    startNewCity();
    setStatus(`Stad "${cityKey}" verwijderd.`);
  } catch (error) {
    console.error(error);
    setStatus("Verwijderen mislukt: " + error.message, true);
  }
}

function addCheckpoint() {
  const cp = collectCheckpointFromEditor();
  currentCheckpoints.push(cp);
  renderCheckpointList();
  refreshMap();
  clearCheckpointEditor();
  setCheckpointStatus("Nieuw checkpoint toegevoegd.");
}

function updateCheckpoint() {
  if (selectedCheckpointIndex < 0 || selectedCheckpointIndex >= currentCheckpoints.length) {
    setCheckpointStatus("Kies eerst een checkpoint om bij te werken.", true);
    return;
  }

  currentCheckpoints[selectedCheckpointIndex] = collectCheckpointFromEditor();
  renderCheckpointList();
  refreshMap();
  setCheckpointStatus("Checkpoint bijgewerkt.");
}

function deleteCheckpoint() {
  if (selectedCheckpointIndex < 0 || selectedCheckpointIndex >= currentCheckpoints.length) {
    setCheckpointStatus("Kies eerst een checkpoint om te verwijderen.", true);
    return;
  }

  const ok = confirm("Verwijder dit checkpoint?");
  if (!ok) return;

  currentCheckpoints.splice(selectedCheckpointIndex, 1);
  renderCheckpointList();
  refreshMap();
  clearCheckpointEditor();
  setCheckpointStatus("Checkpoint verwijderd.");
}

function attachEvents() {
  byId("loadCityButton")?.addEventListener("click", loadCityFromFirebase);
  byId("loadTemplateButton")?.addEventListener("click", loadTemplateCity);
  byId("newCityButton")?.addEventListener("click", startNewCity);
  byId("saveCityButton")?.addEventListener("click", saveCity);
  byId("deleteCityButton")?.addEventListener("click", deleteCity);

  byId("addCheckpointButton")?.addEventListener("click", addCheckpoint);
  byId("updateCheckpointButton")?.addEventListener("click", updateCheckpoint);
  byId("deleteCheckpointButton")?.addEventListener("click", deleteCheckpoint);

  byId("cpTaskType")?.addEventListener("change", updateCheckpointTaskVisibility);
  byId("cityGameTypeSelector")?.addEventListener("change", () => {
    updateCheckpointFieldsByModules();
    clearCheckpointEditor();
  });

  ["cityCenterLat", "cityCenterLng", "gatherLatInput", "gatherLngInput"].forEach((id) => {
    byId(id)?.addEventListener("input", refreshMap);
  });
}

function initDataListeners() {
  onValue(ref(db, "cities"), (snapshot) => {
    citiesCache = snapshot.val() || {};
    populateCitySelector();
  });

  onValue(ref(db, "themes"), (snapshot) => {
    themesCache = snapshot.val() || {};
    populateThemeSelector();
  });

  onValue(ref(db, "speltypes"), (snapshot) => {
    gameTypesCache = snapshot.val() || {};
    populateGameTypeSelector();
    updateCheckpointFieldsByModules();
  });
}

function initApp() {
  if (appInitialized) return;
  appInitialized = true;

  initMap();
  attachEvents();
  updateCheckpointFieldsByModules();
  updateCheckpointTaskVisibility();
  initDataListeners();
  startNewCity();
}

onAuthStateChanged(auth, (user) => {
  const loginScreen = byId("loginScreen");
  const appContent = byId("appContent");
  const loginStatus = byId("loginStatus");

  if (user) {
    if (loginScreen) loginScreen.style.display = "none";
    if (appContent) appContent.style.display = "block";
    if (loginStatus) loginStatus.innerText = "Ingelogd als: " + user.email;
    initApp();
  } else {
    if (loginScreen) loginScreen.style.display = "block";
    if (appContent) appContent.style.display = "none";
  }
});
