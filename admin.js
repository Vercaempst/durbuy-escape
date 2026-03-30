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
let collectibleMarkers = [];
let collectibleCircles = [];
let checkpointCircles = [];

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

  if (isVisible && map) {
    setTimeout(() => map.invalidateSize(), 250);
  }
}

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

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

function mergedCityKeys() {
  return Array.from(
    new Set([
      ...Object.keys(fallbackCities || {}),
      ...Object.keys(citiesCache || {})
    ])
  ).sort((a, b) => a.localeCompare(b));
}

function normalizeGather(rawGather, center) {
  if (Array.isArray(rawGather)) {
    return {
      name: "Verzamelpunt",
      coords: rawGather,
      radius: 40
    };
  }

  if (rawGather?.coords) {
    return {
      name: rawGather.name || "Verzamelpunt",
      coords: rawGather.coords,
      radius: Number(rawGather.radius || 40)
    };
  }

  return {
    name: "Verzamelpunt",
    coords: center,
    radius: 40
  };
}

function getCityRecord(cityKey) {
  const firebaseCity = citiesCache[cityKey];
  const fallbackCity = fallbackCities[cityKey];

  const center = Array.isArray(firebaseCity?.center)
    ? firebaseCity.center
    : Array.isArray(fallbackCity?.center)
      ? fallbackCity.center
      : [50.85, 4.35];

  const gather = normalizeGather(firebaseCity?.gather ?? fallbackCity?.gather, center);

  return {
    name: firebaseCity?.name || fallbackCity?.name || cityKey || "Onbekende stad",
    center,
    gather,
    themeId: firebaseCity?.themeId || fallbackCity?.themeId || "",
    gameTypeId: firebaseCity?.gameTypeId || fallbackCity?.gameTypeId || "",
    defaultCheckpoints: Array.isArray(fallbackCity?.defaultCheckpoints) ? fallbackCity.defaultCheckpoints : []
  };
}

function getSelectedGameTypeId() {
  return byId("cityGameTypeSelector")?.value || "";
}

function getSelectedGameType() {
  const id = getSelectedGameTypeId();
  return id ? gameTypesCache[id] || null : null;
}

function getActiveModules() {
  return {
    ...defaultModules(),
    ...(getSelectedGameType()?.modules || {})
  };
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

function clearMapLayers() {
  if (!map) return;

  if (cityMarker) {
    map.removeLayer(cityMarker);
    cityMarker = null;
  }

  if (gatherMarker) {
    map.removeLayer(gatherMarker);
    gatherMarker = null;
  }

  checkpointMarkers.forEach((marker) => map.removeLayer(marker));
  checkpointMarkers = [];

  collectibleMarkers.forEach((marker) => map.removeLayer(marker));
  collectibleMarkers = [];

  checkpointCircles.forEach((circle) => map.removeLayer(circle));
  checkpointCircles = [];

  collectibleCircles.forEach((circle) => map.removeLayer(circle));
  collectibleCircles = [];
}

function refreshMap() {
  if (!map) return;

  clearMapLayers();

  const centerLat = Number(byId("cityCenterLat")?.value || 50.85);
  const centerLng = Number(byId("cityCenterLng")?.value || 4.35);
  const gatherLat = Number(byId("gatherLatInput")?.value || centerLat);
  const gatherLng = Number(byId("gatherLngInput")?.value || centerLng);
  const gatherRadius = Number(byId("gatherRadiusInput")?.value || 40);
  const gatherName = byId("gatherNameInput")?.value?.trim() || "Verzamelpunt";

  cityMarker = L.marker([centerLat, centerLng])
    .addTo(map)
    .bindPopup("Stadscentrum");

  gatherMarker = L.marker([gatherLat, gatherLng])
    .addTo(map)
    .bindPopup(gatherName);

  const gatherCircle = L.circle([gatherLat, gatherLng], {
    radius: gatherRadius,
    color: "#22c55e",
    fillColor: "#22c55e",
    fillOpacity: 0.08
  }).addTo(map);
  checkpointCircles.push(gatherCircle);

  currentCheckpoints.forEach((cp, index) => {
    if (!Array.isArray(cp.coords)) return;

    const marker = L.marker(cp.coords)
      .addTo(map)
      .bindPopup(`${index + 1}. ${cp.name || "Checkpoint"}`);
    checkpointMarkers.push(marker);

    const radiusCircle = L.circle(cp.coords, {
      radius: Number(cp.radius || 20),
      color: "#3b82f6",
      fillColor: "#3b82f6",
      fillOpacity: 0.08
    }).addTo(map);
    checkpointCircles.push(radiusCircle);

    if (Array.isArray(cp.collectibleCoords)) {
      const collectibleMarker = L.marker(cp.collectibleCoords)
        .addTo(map)
        .bindPopup(cp.collectible?.name || "Collectible");
      collectibleMarkers.push(collectibleMarker);

      if (Number(cp.collectibleSearchRadius || 0) > 0) {
        const searchCircle = L.circle(cp.collectibleCoords, {
          radius: Number(cp.collectibleSearchRadius || 30),
          color: "#d946ef",
          fillColor: "#d946ef",
          fillOpacity: 0.08
        }).addTo(map);
        collectibleCircles.push(searchCircle);
      }
    }
  });

  const bounds = [
    [centerLat, centerLng],
    [gatherLat, gatherLng],
    ...currentCheckpoints
      .filter((cp) => Array.isArray(cp.coords))
      .map((cp) => cp.coords),
    ...currentCheckpoints
      .filter((cp) => Array.isArray(cp.collectibleCoords))
      .map((cp) => cp.collectibleCoords)
  ];

  if (bounds.length >= 2) {
    map.fitBounds(bounds, { padding: [30, 30] });
  } else {
    map.setView([centerLat, centerLng], 15);
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
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseCorrectPairs(value) {
  const obj = {};

  String(value || "")
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean)
    .forEach((line) => {
      const parts = line.split("=");
      if (parts.length >= 2) {
        const left = parts[0].trim();
        const right = parts.slice(1).join("=").trim();
        if (left && right) {
          obj[left] = right;
        }
      }
    });

  return obj;
}

function correctPairsToText(obj = {}) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function updateCheckpointTaskVisibility() {
  const type = byId("cpTaskType")?.value || "text";

  byId("cpTextAnswersWrapper")?.classList.toggle("hidden", !(type === "text" || type === "riddle"));
  byId("cpMultipleChoiceWrapper")?.classList.toggle("hidden", type !== "multipleChoice");
  byId("cpMatchingWrapper")?.classList.toggle("hidden", type !== "matching");
  byId("cpImagePuzzleWrapper")?.classList.toggle("hidden", type !== "imagePuzzle");
  byId("cpPhotoWrapper")?.classList.toggle("hidden", type !== "photo");
}

function setActionFieldsVisible(visible) {
  [
    "cpCollectibleActionType",
    "cpCollectibleActionRange",
    "cpCollectibleActionDuration",
    "cpCollectibleActionValue",
    "cpCollectibleTargetMode"
  ].forEach((id) => {
    const field = byId(id);
    if (!field) return;

    const wrapper = field.closest("div") || field.parentElement;
    if (!wrapper) return;

    wrapper.classList.toggle("hidden", !visible);
    wrapper.style.display = visible ? "" : "none";
  });
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

  if (modules.collectibles || modules.searchZones || modules.hiddenReveal || modules.clickableItems || modules.usableItems) {
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

  const sabotageFieldsVisible =
    modules.usableItems || modules.sabotage || modules.effects || gt?.engine === "mol";

  setActionFieldsVisible(sabotageFieldsVisible);
  updateCheckpointTaskVisibility();
}

function clearCheckpointEditor() {
  selectedCheckpointIndex = -1;

  byId("cpName").value = "";
  byId("cpLat").value = "";
  byId("cpLng").value = "";
  byId("cpRadius").value = "";
  byId("cpTaskType").value = "text";
  byId("cpStory").value = "";
  byId("cpQuestion").value = "";
  byId("cpAnswers").value = "";
  byId("cpOptions").value = "";
  byId("cpCorrectOption").value = "";
  byId("cpLeftItems").value = "";
  byId("cpRightItems").value = "";
  byId("cpCorrectPairs").value = "";
  byId("cpImageUrl").value = "";
  byId("cpGridSize").value = "";
  byId("cpVideo").value = "";
  byId("cpAudio").value = "";
  byId("cpImage").value = "";
  byId("cpPointsCorrect").value = "";
  byId("cpPointsAfterMaxTries").value = "";

  byId("cpCollectibleName").value = "";
  byId("cpCollectibleIcon").value = "";
  byId("cpCollectibleLockedIcon").value = "❓";
  byId("cpCollectibleLockedName").value = "";
  byId("cpCollectibleDescription").value = "";
  byId("cpCollectibleActionType").value = "";
  byId("cpCollectibleActionRange").value = "";
  byId("cpCollectibleActionDuration").value = "";
  byId("cpCollectibleActionValue").value = "";
  byId("cpCollectibleTargetMode").value = "enemy";

  byId("cpCollectibleLat").value = "";
  byId("cpCollectibleLng").value = "";
  byId("cpCollectibleSearchRadius").value = "";
  byId("cpCollectibleRevealDistance").value = "";

  byId("cpSuspectName").value = "";
  byId("cpDialogText").value = "";
  byId("cpHasFingerprint").checked = false;
  byId("cpIsFakeClue").checked = false;
  byId("cpEvidenceIsCritical").checked = false;
  byId("cpFingerprintLabel").value = "";

  byId("cpSabotageHint").value = "";
  byId("cpCanTriggerSabotage").checked = false;
  byId("cpSecretObjective").checked = false;
  byId("cpSecretObjectiveText").value = "";

  byId("cpCanSwitchRoles").checked = false;
  byId("cpCanTriggerChase").checked = false;
  byId("cpRoleSwitchValue").value = "";
  byId("cpChaseRadius").value = "";

  updateCheckpointFieldsByModules();
  setCheckpointStatus("Checkpoint-editor leeggemaakt.");
}

function buildCollectibleObject() {
  const name = byId("cpCollectibleName")?.value?.trim() || "";
  const icon = byId("cpCollectibleIcon")?.value || "";
  const description = byId("cpCollectibleDescription")?.value?.trim() || "";
  const lockedIcon = byId("cpCollectibleLockedIcon")?.value || "❓";
  const lockedName = byId("cpCollectibleLockedName")?.value?.trim() || "";
  const actionType = byId("cpCollectibleActionType")?.value || "";
  const actionRange = Number(byId("cpCollectibleActionRange")?.value || 0);
  const actionDuration = Number(byId("cpCollectibleActionDuration")?.value || 0);
  const actionValue = Number(byId("cpCollectibleActionValue")?.value || 0);
  const targetMode = byId("cpCollectibleTargetMode")?.value || "enemy";

  const hasAnyCollectibleData =
    name ||
    icon ||
    description ||
    lockedName ||
    actionType ||
    actionRange ||
    actionDuration ||
    actionValue;

  if (!hasAnyCollectibleData) return null;

  const result = {
    name: name || "Item",
    icon: icon || "✨",
    lockedIcon,
    lockedName,
    description,
    targetMode
  };

  if (actionType) result.actionType = actionType;
  if (actionRange) result.actionRange = actionRange;
  if (actionDuration) result.actionDuration = actionDuration;
  if (actionValue) result.actionValue = actionValue;

  return result;
}

function collectCheckpointFromEditor() {
  const cp = {
    name: byId("cpName")?.value?.trim() || "Checkpoint",
    coords: [
      Number(byId("cpLat")?.value || 0),
      Number(byId("cpLng")?.value || 0)
    ],
    radius: Number(byId("cpRadius")?.value || 20),
    taskType: byId("cpTaskType")?.value || "text",
    story: byId("cpStory")?.value?.trim() || "",
    question: byId("cpQuestion")?.value?.trim() || "",
    answers: parseCommaList(byId("cpAnswers")?.value || ""),
    options: parseCommaList(byId("cpOptions")?.value || ""),
    correctOption: Number(byId("cpCorrectOption")?.value || 0),
    leftItems: parseCommaList(byId("cpLeftItems")?.value || ""),
    rightItems: parseCommaList(byId("cpRightItems")?.value || ""),
    correctPairs: parseCorrectPairs(byId("cpCorrectPairs")?.value || ""),
    imageUrl: byId("cpImageUrl")?.value?.trim() || "",
    gridSize: Number(byId("cpGridSize")?.value || 3),
    video: byId("cpVideo")?.value?.trim() || "",
    audio: byId("cpAudio")?.value?.trim() || "",
    image: byId("cpImage")?.value?.trim() || "",
    pointsCorrect: Number(byId("cpPointsCorrect")?.value || 10),
    pointsAfterMaxTries: Number(byId("cpPointsAfterMaxTries")?.value || 0),

    suspectName: byId("cpSuspectName")?.value?.trim() || "",
    dialogText: byId("cpDialogText")?.value?.trim() || "",
    hasFingerprint: !!byId("cpHasFingerprint")?.checked,
    isFakeClue: !!byId("cpIsFakeClue")?.checked,
    evidenceIsCritical: !!byId("cpEvidenceIsCritical")?.checked,
    fingerprintLabel: byId("cpFingerprintLabel")?.value?.trim() || "",

    sabotageHint: byId("cpSabotageHint")?.value?.trim() || "",
    canTriggerSabotage: !!byId("cpCanTriggerSabotage")?.checked,
    secretObjective: !!byId("cpSecretObjective")?.checked,
    secretObjectiveText: byId("cpSecretObjectiveText")?.value?.trim() || "",

    canSwitchRoles: !!byId("cpCanSwitchRoles")?.checked,
    canTriggerChase: !!byId("cpCanTriggerChase")?.checked,
    roleSwitchValue: Number(byId("cpRoleSwitchValue")?.value || 0),
    chaseRadius: Number(byId("cpChaseRadius")?.value || 0)
  };

  const collectible = buildCollectibleObject();
  if (collectible) {
    cp.collectible = collectible;
  }

  const collectibleLatRaw = byId("cpCollectibleLat")?.value;
  const collectibleLngRaw = byId("cpCollectibleLng")?.value;
  const collectibleLat = collectibleLatRaw !== "" ? Number(collectibleLatRaw) : null;
  const collectibleLng = collectibleLngRaw !== "" ? Number(collectibleLngRaw) : null;

  if (collectibleLat != null && collectibleLng != null) {
    cp.collectibleCoords = [collectibleLat, collectibleLng];
  }

  const searchRadius = Number(byId("cpCollectibleSearchRadius")?.value || 0);
  const revealDistance = Number(byId("cpCollectibleRevealDistance")?.value || 0);

  if (searchRadius) cp.collectibleSearchRadius = searchRadius;
  if (revealDistance) cp.collectibleRevealDistance = revealDistance;

  if (cp.taskType !== "multipleChoice") {
    delete cp.options;
    delete cp.correctOption;
  }

  if (cp.taskType !== "matching") {
    delete cp.leftItems;
    delete cp.rightItems;
    delete cp.correctPairs;
  }

  if (cp.taskType !== "imagePuzzle") {
    delete cp.imageUrl;
    delete cp.gridSize;
  }

  if (cp.taskType === "photo") {
    delete cp.answers;
  }

  if (cp.taskType !== "text" && cp.taskType !== "riddle") {
    if (cp.taskType !== "matching" && cp.taskType !== "imagePuzzle") {
      delete cp.answers;
    }
  }

  return cp;
}

function loadCheckpointIntoEditor(index) {
  const cp = currentCheckpoints[index];
  if (!cp) return;

  selectedCheckpointIndex = index;

  byId("cpName").value = cp.name || "";
  byId("cpLat").value = cp.coords?.[0] ?? "";
  byId("cpLng").value = cp.coords?.[1] ?? "";
  byId("cpRadius").value = cp.radius ?? "";
  byId("cpTaskType").value = cp.taskType || "text";
  byId("cpStory").value = cp.story || "";
  byId("cpQuestion").value = cp.question || "";
  byId("cpAnswers").value = Array.isArray(cp.answers) ? cp.answers.join(", ") : "";
  byId("cpOptions").value = Array.isArray(cp.options) ? cp.options.join(", ") : "";
  byId("cpCorrectOption").value = cp.correctOption ?? "";
  byId("cpLeftItems").value = Array.isArray(cp.leftItems) ? cp.leftItems.join(", ") : "";
  byId("cpRightItems").value = Array.isArray(cp.rightItems) ? cp.rightItems.join(", ") : "";
  byId("cpCorrectPairs").value = correctPairsToText(cp.correctPairs || {});
  byId("cpImageUrl").value = cp.imageUrl || "";
  byId("cpGridSize").value = cp.gridSize ?? "";
  byId("cpVideo").value = cp.video || "";
  byId("cpAudio").value = cp.audio || "";
  byId("cpImage").value = cp.image || "";
  byId("cpPointsCorrect").value = cp.pointsCorrect ?? "";
  byId("cpPointsAfterMaxTries").value = cp.pointsAfterMaxTries ?? "";

  byId("cpCollectibleName").value = cp.collectible?.name || "";
  byId("cpCollectibleIcon").value = cp.collectible?.icon || "";
  byId("cpCollectibleLockedIcon").value = cp.collectible?.lockedIcon || "❓";
  byId("cpCollectibleLockedName").value = cp.collectible?.lockedName || "";
  byId("cpCollectibleDescription").value = cp.collectible?.description || "";
  byId("cpCollectibleActionType").value = cp.collectible?.actionType || "";
  byId("cpCollectibleActionRange").value = cp.collectible?.actionRange ?? "";
  byId("cpCollectibleActionDuration").value = cp.collectible?.actionDuration ?? "";
  byId("cpCollectibleActionValue").value = cp.collectible?.actionValue ?? "";
  byId("cpCollectibleTargetMode").value = cp.collectible?.targetMode || "enemy";

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

  container.innerHTML = currentCheckpoints.map((cp, index) => {
    const action = cp.collectible?.actionType ? ` | actie: ${cp.collectible.actionType}` : "";
    const hiddenCoords = Array.isArray(cp.collectibleCoords)
      ? ` | object: ${cp.collectibleCoords[0]}, ${cp.collectibleCoords[1]}`
      : "";

    return `
      <div class="group-card">
        <strong>${index + 1}. ${cp.name || "Checkpoint"}</strong><br>
        ${Array.isArray(cp.coords) ? `${cp.coords[0]}, ${cp.coords[1]}` : "-"}<br>
        ${cp.taskType ? `Type: ${cp.taskType}<br>` : ""}
        ${cp.collectible?.name ? `Item: ${cp.collectible.name}${action}${hiddenCoords}<br>` : ""}
        <br>
        <button type="button" data-cp-index="${index}">Bewerk checkpoint</button>
      </div>
    `;
  }).join("");

  container.querySelectorAll("[data-cp-index]").forEach((btn) => {
    btn.addEventListener("click", () => {
      loadCheckpointIntoEditor(Number(btn.getAttribute("data-cp-index")));
    });
  });
}

function loadCityIntoForm(cityKey, cityData, checkpoints = []) {
  currentCityKey = cityKey;
  currentCheckpoints = Array.isArray(checkpoints) ? checkpoints : [];

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

  clearCheckpointEditor();
  renderCheckpointList();
  refreshMap();
  setStatus("Nieuwe stad gestart.");
}

async function loadSelectedCityFromFirebase() {
  const cityKey = byId("adminCitySelector")?.value || "";
  if (!cityKey) {
    setStatus("Kies eerst een stad.", true);
    return;
  }

  const citySnap = await get(ref(db, "cities/" + cityKey));
  const checkpoints = await loadCheckpointsForCity(cityKey);

  if (citySnap.exists()) {
    loadCityIntoForm(cityKey, citySnap.val(), checkpoints);
  } else {
    loadCityIntoForm(cityKey, getCityRecord(cityKey), checkpoints);
  }
}

async function loadSelectedCityTemplate() {
  const cityKey = byId("adminCitySelector")?.value || "";
  if (!cityKey) {
    setStatus("Kies eerst een stad.", true);
    return;
  }

  const cityRecord = getCityRecord(cityKey);
  const checkpoints = Array.isArray(fallbackCities[cityKey]?.defaultCheckpoints)
    ? fallbackCities[cityKey].defaultCheckpoints
    : [];

  loadCityIntoForm(cityKey, cityRecord, checkpoints);
  setStatus(`Template "${cityRecord.name}" geladen uit cities.js.`);
}

async function saveCity() {
  const cityKey = slugify(byId("cityKeyInput")?.value || "");

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
    byId("cityKeyInput").value = cityKey;
    populateCitySelector();
    byId("adminCitySelector").value = cityKey;
    setStatus(`Stad "${cityData.name}" opgeslagen.`);
  } catch (error) {
    console.error(error);
    setStatus("Opslaan mislukt: " + error.message, true);
  }
}

async function deleteCity() {
  const cityKey = slugify(byId("cityKeyInput")?.value || "");
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
    populateCitySelector();
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

function bindEventListeners() {
  byId("loadCityButton")?.addEventListener("click", loadSelectedCityFromFirebase);
  byId("loadTemplateButton")?.addEventListener("click", loadSelectedCityTemplate);
  byId("newCityButton")?.addEventListener("click", startNewCity);
  byId("saveCityButton")?.addEventListener("click", saveCity);
  byId("deleteCityButton")?.addEventListener("click", deleteCity);

  byId("cityGameTypeSelector")?.addEventListener("change", () => {
    updateCheckpointFieldsByModules();
    refreshMap();
  });

  byId("cpTaskType")?.addEventListener("change", updateCheckpointTaskVisibility);

  [
    "cityCenterLat",
    "cityCenterLng",
    "gatherLatInput",
    "gatherLngInput",
    "gatherRadiusInput"
  ].forEach((id) => {
    byId(id)?.addEventListener("input", refreshMap);
  });

  byId("addCheckpointButton")?.addEventListener("click", addCheckpoint);
  byId("updateCheckpointButton")?.addEventListener("click", updateCheckpoint);
  byId("deleteCheckpointButton")?.addEventListener("click", deleteCheckpoint);
}

function initRealtimeData() {
  onValue(ref(db, "cities"), (snapshot) => {
    citiesCache = snapshot.exists() ? snapshot.val() || {} : {};
    populateCitySelector();
  });

  onValue(ref(db, "themes"), (snapshot) => {
    themesCache = snapshot.exists() ? snapshot.val() || {} : {};
    populateThemeSelector();
  });

  onValue(ref(db, "speltypes"), (snapshot) => {
    gameTypesCache = snapshot.exists() ? snapshot.val() || {} : {};
    populateGameTypeSelector();
    updateCheckpointFieldsByModules();
  });
}

function bootstrap() {
  if (appInitialized) return;
  appInitialized = true;

  initMap();
  bindEventListeners();
  clearCheckpointEditor();
  renderCheckpointList();
  refreshMap();

  onAuthStateChanged(auth, (user) => {
    setProtectedUIVisible(!!user);
    if (!user) return;
    initRealtimeData();
  });
}

bootstrap();
