import { cities as fallbackCities } from "./cities.js";
import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  push,
  onValue,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

/* =========================================================
   STATE
========================================================= */
let cityKey = null;
let cityData = null;
let checkpoints = [];
let currentGameType = null;
let currentTeacherCity = null;

let map = null;
let groupMarker = null;
let checkpointMarker = null;
let checkpointRadiusCircle = null;
let gatherMarker = null;
let collectibleMarker = null;
let collectibleSearchCircle = null;

let watchId = null;
let currentLat = null;
let currentLng = null;
let currentHeading = null;
let lastPositionSyncAt = 0;

let groupId = localStorage.getItem("groupId") || null;
let groupData = null;
let groupsCache = {};

let answeredCheckpointIds = [];
let collectedCollectibleCheckpointIds = [];
let pendingCollectibleCheckpointId = null;

let currentQuestionCheckpoint = null;
let currentTries = 0;
let currentSelectedMultipleChoice = null;

let appReady = false;
let questionOpen = false;
let introShown = false;
let routeCompleted = false;
let gameStartTimestamp = null;

let unsubscribeGroupListener = null;
let unsubscribeAllGroupsListener = null;
let unsubscribeBroadcastListener = null;
let unsubscribeTeacherCityListener = null;

let globalBroadcastDismissedAt = 0;
let pendingBroadcast = null;
let collectiblePickupInProgress = false;

let lastProcessedCommandTimestamps = {
  commandMessageAt: 0,
  commandPointsAt: 0,
  commandResetAt: 0,
  commandNextAt: 0
};

/* =========================================================
   HELPERS
========================================================= */
function byId(id) {
  return document.getElementById(id);
}

function qs(selector) {
  return document.querySelector(selector);
}

function nowMs() {
  return Date.now();
}

function setBodyModalState() {
  const hasOpenModal =
    !byId("introModal")?.classList.contains("hidden") ||
    !byId("questionModal")?.classList.contains("hidden") ||
    !byId("messageModal")?.classList.contains("hidden") ||
    !byId("evidenceModal")?.classList.contains("hidden") ||
    !byId("evidenceFoundModal")?.classList.contains("hidden");

  document.body.classList.toggle("modal-open", hasOpenModal);
}

function showModal(id) {
  const el = byId(id);
  if (!el) return;
  el.classList.remove("hidden");
  setBodyModalState();
}

function hideModal(id) {
  const el = byId(id);
  if (!el) return;
  el.classList.add("hidden");
  setBodyModalState();
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

function getModules() {
  return {
    ...defaultModules(),
    ...(currentGameType?.modules || {})
  };
}

function hasModule(name) {
  return !!getModules()[name];
}

function shouldUseInventoryUI() {
  return (
    hasModule("inventory") ||
    hasModule("evidenceBook") ||
    hasModule("collectibles") ||
    hasModule("usableItems")
  );
}

function getInventoryLabel() {
  if (!currentGameType) return "Grimoire";
  if (currentGameType.inventory?.name) return currentGameType.inventory.name;
  if (currentGameType.engine === "murder") return "Dossier";
  return "Grimoire";
}

function getGameTypeRules() {
  return currentGameType?.rules || {};
}

function getTimerSettings() {
  return currentGameType?.timer || {};
}

function getStorySettings() {
  return currentGameType?.story || {};
}

function getMapIcons() {
  return {
    checkpoint: currentGameType?.mapIcons?.checkpoint || "🎯",
    done: currentGameType?.mapIcons?.done || "✅",
    collectible: currentGameType?.mapIcons?.collectible || "✨",
    player: currentGameType?.mapIcons?.player || "🚶",
    gather: currentGameType?.mapIcons?.gather || "⭐"
  };
}

function emojiIcon(emoji, size = 28) {
  return L.divIcon({
    className: "custom-emoji-icon",
    html: `<div style="font-size:${size}px; line-height:${size}px;">${emoji}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size]
  });
}

function parseUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const urlCity = params.get("city");
  const storedCity = localStorage.getItem("activeCityKey");
  cityKey = urlCity || storedCity || null;
}

function getLocalGroupStorageKey() {
  return `groupId_${cityKey}`;
}

function restoreGroupIdForCity() {
  if (!cityKey) return;

  const perCity = localStorage.getItem(getLocalGroupStorageKey());
  if (perCity) {
    groupId = perCity;
    localStorage.setItem("groupId", groupId);
    return;
  }

  const generic = localStorage.getItem("groupId");
  if (generic) {
    groupId = generic;
  }
}

function storeGroupIdForCity(id) {
  localStorage.setItem("groupId", id);
  localStorage.setItem(getLocalGroupStorageKey(), id);
}

function formatMeters(value) {
  if (!Number.isFinite(value)) return "?";
  if (value < 1000) return `${Math.round(value)} meter`;
  return `${(value / 1000).toFixed(2)} km`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function distanceMeters(a, b) {
  const R = 6371000;
  const lat1 = a[0] * Math.PI / 180;
  const lat2 = b[0] * Math.PI / 180;
  const dLat = (b[0] - a[0]) * Math.PI / 180;
  const dLng = (b[1] - a[1]) * Math.PI / 180;

  const x = dLng * Math.cos((lat1 + lat2) / 2);
  const y = dLat;

  return Math.sqrt(x * x + y * y) * R;
}

function getHeadingBetweenPoints(from, to) {
  const lat1 = from[0] * Math.PI / 180;
  const lon1 = from[1] * Math.PI / 180;
  const lat2 = to[0] * Math.PI / 180;
  const lon2 = to[1] * Math.PI / 180;

  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);

  const bearing = Math.atan2(y, x) * 180 / Math.PI;
  return (bearing + 360) % 360;
}

function normalizeGather(rawGather, fallbackCenter = [50.85, 4.35]) {
  if (Array.isArray(rawGather)) {
    return {
      name: "Verzamelpunt",
      coords: rawGather,
      radius: 40
    };
  }

  if (rawGather && Array.isArray(rawGather.coords)) {
    return {
      name: rawGather.name || "Verzamelpunt",
      coords: rawGather.coords,
      radius: Number(rawGather.radius || 40)
    };
  }

  return {
    name: "Verzamelpunt",
    coords: fallbackCenter,
    radius: 40
  };
}

function normalizeCity(cityKeyToUse, rawFirebaseCity = null) {
  const fallback = fallbackCities?.[cityKeyToUse] || null;
  const source = rawFirebaseCity || fallback || {};

  const center = Array.isArray(source.center)
    ? source.center
    : Array.isArray(fallback?.center)
      ? fallback.center
      : [50.85, 4.35];

  return {
    key: cityKeyToUse,
    name: source.name || fallback?.name || cityKeyToUse || "Onbekende stad",
    center,
    gather: normalizeGather(source.gather ?? fallback?.gather, center),
    themeId: source.themeId || fallback?.themeId || "",
    gameTypeId: source.gameTypeId || fallback?.gameTypeId || ""
  };
}

function buildNormalizedItem(item) {
  if (!item) return null;

  return {
    id: item.id || `item_${Date.now()}`,
    name: item.name || "Item",
    icon: item.icon || "✨",
    description: item.description || "",
    lockedName: item.lockedName || "Onbekend item",
    lockedIcon: item.lockedIcon || "❓",
    actionType: item.actionType || null,
    actionRange: Number(item.actionRange || 25),
    actionDuration: Number(item.actionDuration || 40),
    actionValue: Number(item.actionValue || 15),
    targetMode: item.targetMode || "enemy",
    mapVisibility: item.mapVisibility || "blurZone",
    searchRadius: Number(item.searchRadius || 30),
    revealDistance: Number(item.revealDistance || 15),
    used: !!item.used
  };
}

function normalizeCheckpoint(cp, index) {
  return {
    ...cp,
    id: cp?.id || `cp_${index}`,
    name: cp?.name || `Checkpoint ${index + 1}`,
    coords: Array.isArray(cp?.coords) ? cp.coords : null,
    radius: Number(cp?.radius || 20),
    taskType: cp?.taskType || "text",
    question: cp?.question || "",
    answers: Array.isArray(cp?.answers) ? cp.answers : [],
    pointsCorrect: Number(cp?.pointsCorrect || 10),
    pointsAfterMaxTries: Number(cp?.pointsAfterMaxTries || 0),
    maxTries: Number(cp?.maxTries || 3),
    options: Array.isArray(cp?.options) ? cp.options : [],
    correctOption: Number.isFinite(Number(cp?.correctOption)) ? Number(cp.correctOption) : 0,
    leftItems: Array.isArray(cp?.leftItems) ? cp.leftItems : [],
    rightItems: Array.isArray(cp?.rightItems) ? cp.rightItems : [],
    correctPairs: cp?.correctPairs || {},
    story: cp?.story || "",
    video: cp?.video || "",
    audio: cp?.audio || "",
    image: cp?.image || cp?.imageUrl || "",
    imageUrl: cp?.imageUrl || cp?.image || "",
    gridSize: Number(cp?.gridSize || 3),
    collectible: cp?.collectible ? buildNormalizedItem(cp.collectible) : null,
    collectibleCoords: Array.isArray(cp?.collectibleCoords) ? cp.collectibleCoords : null,
    collectibleSearchRadius: Number(cp?.collectibleSearchRadius || 0),
    collectibleRevealDistance: Number(cp?.collectibleRevealDistance || 0),
    collectibleUnlockMode: cp?.collectibleUnlockMode || ""
  };
}

function getCurrentCheckpointIndex() {
  if (!groupData) return 0;
  return Number(groupData.routeIndex || 0);
}

function getCurrentCheckpoint() {
  return checkpoints[getCurrentCheckpointIndex()] || null;
}

function getCurrentCheckpointId() {
  const cp = getCurrentCheckpoint();
  return cp?.id || `cp_${getCurrentCheckpointIndex()}`;
}

function isCurrentCheckpointAnswered() {
  return answeredCheckpointIds.includes(getCurrentCheckpointId());
}

function hasCollectedCollectibleForCheckpoint(cpId) {
  return collectedCollectibleCheckpointIds.includes(cpId);
}

function getRemainingTimeMs() {
  const timer = getTimerSettings();
  if (!hasModule("timer")) return null;
  if (!gameStartTimestamp) return null;

  const mode = timer.mode || "global";
  if (mode !== "global" && mode !== "hybrid") return null;

  const totalMinutes = Number(timer.totalMinutes || 0);
  if (!totalMinutes) return null;

  const elapsed = nowMs() - gameStartTimestamp;
  return Math.max(0, totalMinutes * 60 * 1000 - elapsed);
}

function calculateTimeBonusPoints() {
  const timer = getTimerSettings();
  const remaining = getRemainingTimeMs();

  if (remaining == null) return 0;
  if (!timer.convertRemainingTimeToPoints) return 0;

  const pointsPerMinute = Number(timer.pointsPerMinuteRemaining || 1);
  return Math.floor((remaining / 60000) * pointsPerMinute);
}

function shouldUseSearchChoice(cp) {
  if (!cp?.collectible) return false;
  const setting =
    cp.collectibleUnlockMode ||
    currentGameType?.collectibles?.unlockCondition ||
    "afterCorrect";

  return (
    setting === "searchZoneAfterCorrect" ||
    setting === "searchZoneAfterCorrectOrMaxTries"
  );
}

function shouldGrantCollectible(cp, answeredCorrectly, reachedMaxTries) {
  if (!cp?.collectible) return false;

  const setting =
    cp.collectibleUnlockMode ||
    currentGameType?.collectibles?.unlockCondition ||
    "afterCorrect";

  if (setting === "none") return false;
  if (setting === "afterCorrect") return answeredCorrectly;
  if (setting === "afterMaxTries") return reachedMaxTries;
  if (setting === "afterCorrectOrMaxTries") return answeredCorrectly || reachedMaxTries;
  if (setting === "searchZoneAfterCorrect") return answeredCorrectly;
  if (setting === "searchZoneAfterCorrectOrMaxTries") return answeredCorrectly || reachedMaxTries;

  return answeredCorrectly;
}

function getCollectibleCoords(cp) {
  if (Array.isArray(cp.collectibleCoords)) return cp.collectibleCoords;
  return cp.coords;
}

function getSearchRadius(cp) {
  return Number(
    cp?.collectibleSearchRadius ||
    cp?.collectible?.searchRadius ||
    currentGameType?.collectibles?.searchRadius ||
    30
  );
}

function getRevealDistance(cp) {
  return Number(
    cp?.collectibleRevealDistance ||
    cp?.collectible?.revealDistance ||
    currentGameType?.collectibles?.revealDistance ||
    15
  );
}

function normalizeMatchingText(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/\s+/g, ""))
    .sort()
    .join("|")
    .toLowerCase();
}

function buildCorrectMatchingAnswer(cp) {
  return Object.entries(cp.correctPairs || {})
    .map(([left, right]) => `${left}=${right}`)
    .join("\n");
}

/* =========================================================
   LOAD CITY / GAMETYPE / THEME
========================================================= */
async function loadCityAndGameType() {
  let firebaseCity = null;

  if (cityKey) {
    const citySnap = await get(ref(db, `cities/${cityKey}`));
    if (citySnap.exists()) {
      firebaseCity = citySnap.val();
    }
  }

  cityData = normalizeCity(cityKey, firebaseCity);

  let loadedCheckpoints = [];
  const checkpointsSnap = await get(ref(db, `cityData/${cityKey}/checkpoints`));

  if (checkpointsSnap.exists() && Array.isArray(checkpointsSnap.val())) {
    loadedCheckpoints = checkpointsSnap.val();
  } else if (Array.isArray(fallbackCities?.[cityKey]?.defaultCheckpoints)) {
    loadedCheckpoints = fallbackCities[cityKey].defaultCheckpoints;
  }

  checkpoints = loadedCheckpoints
    .map((cp, index) => normalizeCheckpoint(cp, index))
    .filter((cp) => Array.isArray(cp.coords));

  if (cityData?.gameTypeId) {
    const gameTypeSnap = await get(ref(db, `speltypes/${cityData.gameTypeId}`));
    currentGameType = gameTypeSnap.exists() ? gameTypeSnap.val() : null;
  } else {
    currentGameType = null;
  }
}

function resetThemeToDefaults() {
  document.title = "City Escape";
  if (byId("appTitle")) {
    byId("appTitle").innerText = "City Escape";
  }

  document.documentElement.style.setProperty("--theme-text-color", "#ffffff");
  document.documentElement.style.setProperty("--theme-card-color", "rgba(22, 18, 34, 0.88)");
  document.documentElement.style.setProperty("--theme-primary-color", "#8b5cf6");
  document.documentElement.style.setProperty("--theme-secondary-color", "#d946ef");
  document.documentElement.style.setProperty("--theme-button-color", "#7c3aed");
  document.documentElement.style.setProperty("--theme-button-text-color", "#ffffff");
  document.documentElement.style.setProperty("--theme-border-radius", "18px");
  document.documentElement.style.setProperty("--theme-box-shadow", "0 10px 30px rgba(0, 0, 0, 0.35)");

  document.body.style.color = "#ffffff";
  document.body.style.fontFamily = '"Segoe UI", Arial, sans-serif';
  document.body.style.background = "radial-gradient(circle at top, #1b1328, #0d0a14)";
}

async function applyTheme() {
  document.title = cityData?.name ? `${cityData.name} - City Escape` : "City Escape";
  if (byId("appTitle")) {
    byId("appTitle").innerText = document.title;
  }

  if (!cityData?.themeId) {
    resetThemeToDefaults();
    return;
  }

  const themeSnap = await get(ref(db, `themes/${cityData.themeId}`));
  if (!themeSnap.exists()) {
    resetThemeToDefaults();
    return;
  }

  const t = themeSnap.val() || {};

  document.documentElement.style.setProperty("--theme-text-color", t.textColor || "#ffffff");
  document.documentElement.style.setProperty("--theme-card-color", t.cardColor || "rgba(22, 18, 34, 0.88)");
  document.documentElement.style.setProperty("--theme-primary-color", t.primaryColor || "#8b5cf6");
  document.documentElement.style.setProperty("--theme-secondary-color", t.secondaryColor || "#d946ef");
  document.documentElement.style.setProperty("--theme-button-color", t.buttonColor || "#7c3aed");
  document.documentElement.style.setProperty("--theme-button-text-color", t.buttonTextColor || "#ffffff");
  document.documentElement.style.setProperty("--theme-border-radius", t.borderRadius || "18px");
  document.documentElement.style.setProperty("--theme-box-shadow", t.boxShadow || "0 10px 30px rgba(0, 0, 0, 0.35)");

  document.body.style.color = t.textColor || "#ffffff";
  document.body.style.fontFamily = t.fontFamily || '"Segoe UI", Arial, sans-serif';

  if (t.backgroundType === "image" && t.backgroundImage) {
    document.body.style.background = `center / cover no-repeat url("${t.backgroundImage}") fixed`;
  } else {
    document.body.style.background = `radial-gradient(circle at top, ${t.backgroundColor || "#1b1328"}, #0d0a14)`;
  }
}

/* =========================================================
   MAP
========================================================= */
function initMap() {
  const center = cityData?.center || [50.85, 4.35];

  map = L.map("map").setView(center, 16);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "OpenStreetMap"
  }).addTo(map);
}

function refreshGatherMarker() {
  if (!map) return;

  if (gatherMarker) {
    map.removeLayer(gatherMarker);
    gatherMarker = null;
  }

  if (routeCompleted && cityData?.gather?.coords) {
    gatherMarker = L.marker(cityData.gather.coords, {
      icon: emojiIcon(getMapIcons().gather, 30)
    }).addTo(map).bindPopup(cityData.gather.name || "Verzamelpunt");
  }
}

function clearCheckpointVisuals() {
  if (!map) return;

  if (checkpointMarker) map.removeLayer(checkpointMarker);
  if (checkpointRadiusCircle) map.removeLayer(checkpointRadiusCircle);
  if (collectibleMarker) map.removeLayer(collectibleMarker);
  if (collectibleSearchCircle) map.removeLayer(collectibleSearchCircle);

  checkpointMarker = null;
  checkpointRadiusCircle = null;
  collectibleMarker = null;
  collectibleSearchCircle = null;
}

function updateCheckpointVisuals() {
  if (!map) return;

  clearCheckpointVisuals();
  refreshGatherMarker();

  if (routeCompleted) {
    if (cityData?.gather?.coords) {
      checkpointRadiusCircle = L.circle(cityData.gather.coords, {
        radius: Number(cityData.gather.radius || 40),
        color: "#22c55e",
        fillColor: "#22c55e",
        fillOpacity: 0.08
      }).addTo(map);
    }
    return;
  }

  const cp = getCurrentCheckpoint();
  if (!cp || !Array.isArray(cp.coords)) return;

  checkpointMarker = L.marker(cp.coords, {
    icon: emojiIcon(getMapIcons().checkpoint, 30)
  }).addTo(map).bindPopup(cp.name || "Checkpoint");

  checkpointRadiusCircle = L.circle(cp.coords, {
    radius: Number(cp.radius || 20),
    color: "#3b82f6",
    fillColor: "#3b82f6",
    fillOpacity: 0.08
  }).addTo(map);

  const isPendingSearch =
    pendingCollectibleCheckpointId === cp.id &&
    cp.collectible &&
    !hasCollectedCollectibleForCheckpoint(cp.id);

  if (!isPendingSearch) return;

  const searchCoords = getCollectibleCoords(cp);
  if (!Array.isArray(searchCoords)) return;

  collectibleSearchCircle = L.circle(searchCoords, {
    radius: getSearchRadius(cp),
    className: "collectible-search-zone"
  }).addTo(map);

  if (currentLat != null && currentLng != null) {
    const dist = distanceMeters([currentLat, currentLng], searchCoords);
    if (dist <= getRevealDistance(cp)) {
      collectibleMarker = L.marker(searchCoords, {
        icon: emojiIcon(cp.collectible.icon || getMapIcons().collectible, 28)
      }).addTo(map).bindPopup(cp.collectible.name || "Collectible");
    }
  }
}

function updateGroupMarker() {
  if (!map || currentLat == null || currentLng == null) return;

  if (!groupMarker) {
    groupMarker = L.marker([currentLat, currentLng], {
      icon: emojiIcon(getMapIcons().player, 28)
    }).addTo(map);
  } else {
    groupMarker.setLatLng([currentLat, currentLng]);
  }
}

/* =========================================================
   EFFECTS
========================================================= */
function getActiveEffects() {
  const effectsObj = groupData?.effects || {};
  const all = Object.values(effectsObj || {});
  const now = nowMs();
  return all.filter((e) => !e?.endsAt || e.endsAt > now);
}

function hasActiveEffect(type) {
  return getActiveEffects().some((e) => e?.type === type);
}

function updateMapVisibilityFromEffects() {
  const mapEl = byId("map");
  if (!mapEl) return;

  mapEl.style.filter = "";
  mapEl.style.opacity = "";

  if (hasActiveEffect("map_blur")) {
    mapEl.style.filter = "blur(7px)";
  }

  if (hasActiveEffect("no_map")) {
    mapEl.style.opacity = "0.15";
  }
}

async function cleanupExpiredEffects() {
  if (!groupId || !groupData?.effects) return;

  const updates = {};
  const now = nowMs();

  Object.entries(groupData.effects).forEach(([effectId, effect]) => {
    if (effect?.endsAt && effect.endsAt <= now) {
      updates[`effects/${effectId}`] = null;
    }
  });

  if (Object.keys(updates).length) {
    await update(ref(db, `groups/${groupId}`), updates);
  }
}

/* =========================================================
   UI
========================================================= */
function updateInventoryTexts() {
  const label = getInventoryLabel();

  const btn = byId("openEvidenceButton");
  if (btn) {
    btn.innerText = `📖 Open ${label.toLowerCase()}`;
    btn.style.display = shouldUseInventoryUI() ? "" : "none";
  }

  const evidenceModal = byId("evidenceModal");
  if (evidenceModal) {
    const h2 = evidenceModal.querySelector("h2");
    if (h2) h2.innerText = label;
  }

  const introText = byId("evidenceIntroText");
  if (introText) {
    introText.innerText =
      label === "Dossier"
        ? "Hier zie je alle verzamelde bewijsstukken en bruikbare items."
        : `Hier zie je alle verzamelde items uit je ${label.toLowerCase()}.`;
  }
}

function updateGPSStatus() {
  const dot = byId("gpsStatusDot");
  const text = byId("gpsStatusText");
  if (!dot || !text) return;

  if (currentLat == null || currentLng == null) {
    dot.style.background = "red";
    text.innerText = "GPS-status: geen locatie";
    return;
  }

  dot.style.background = "#22c55e";
  text.innerText = "GPS-status: actief";
}

function updateStudentTopUI() {
  if (!groupData) return;

  byId("teamDisplay").innerText =
    `Groep ${groupData.groupNumber || "?"}: ${groupData.groupName || ""}`;

  const cp = routeCompleted ? null : getCurrentCheckpoint();
  byId("missionTargetTitle").innerText = routeCompleted
    ? (cityData?.gather?.name || "Verzamelpunt")
    : (cp?.name || "Checkpoint");

  const target = routeCompleted ? cityData?.gather?.coords : cp?.coords;
  const dist =
    target && currentLat != null && currentLng != null
      ? distanceMeters([currentLat, currentLng], target)
      : null;

  byId("status").innerText = `Nog ${formatMeters(dist)} tot doel.`;
  byId("scoreText").innerText = String(groupData.score || 0);

  byId("progressText").innerText = checkpoints.length
    ? `Checkpoint ${Math.min(getCurrentCheckpointIndex() + 1, checkpoints.length)} / ${checkpoints.length}`
    : "Checkpoint 0 / 0";

  const progressPercent = checkpoints.length
    ? Math.round((answeredCheckpointIds.length / checkpoints.length) * 100)
    : 0;

  if (byId("progressBarFill")) {
    byId("progressBarFill").style.width = `${progressPercent}%`;
  }

  updateGPSStatus();
  updateInventoryTexts();
}

function updateArrowToTarget() {
  const arrow = byId("arrow");
  if (!arrow) return;

  if (hasActiveEffect("compass_off")) {
    arrow.style.display = "none";
    return;
  }

  let target = null;
  if (routeCompleted) {
    target = cityData?.gather?.coords || null;
  } else {
    target = getCurrentCheckpoint()?.coords || null;
  }

  if (currentLat == null || currentLng == null || !target) {
    arrow.style.display = "none";
    return;
  }

  arrow.style.display = "block";
  const bearing = getHeadingBetweenPoints([currentLat, currentLng], target);
  const heading = Number.isFinite(currentHeading) ? currentHeading : 0;
  const relative = bearing - heading;
  arrow.style.transform = `rotate(${relative}deg)`;
}

function updateRankingUI() {
  const container = byId("studentRankingContainer");
  if (!container) return;

  if (!hasModule("ranking")) {
    container.innerHTML = "<p>Ranking staat uit voor dit speltype.</p>";
    return;
  }

  const activeGroups = Object.entries(groupsCache || {})
    .map(([id, g]) => ({ id, ...g }))
    .filter((g) => g.cityKey === cityKey)
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  if (!activeGroups.length) {
    container.innerHTML = "<p>Nog geen scoregegevens beschikbaar.</p>";
    return;
  }

  container.innerHTML = activeGroups
    .slice(0, 8)
    .map((g, index) => `
      <div class="rank-item">
        <span>${index + 1}. Groep ${g.groupNumber || "?"}: ${g.groupName || "-"}</span>
        <span>${g.score || 0}</span>
      </div>
    `)
    .join("");
}

function closeQuestionModal() {
  questionOpen = false;
  currentQuestionCheckpoint = null;
  currentTries = 0;
  currentSelectedMultipleChoice = null;
  hideModal("questionModal");
}

function showTeacherMessage(text) {
  const el = byId("teacherMessageText");
  if (el) el.innerText = text || "";
  showModal("messageModal");
}

function showPendingBroadcastIfAny() {
  if (!pendingBroadcast) return;
  if (!byId("introModal")?.classList.contains("hidden")) return;

  const text = pendingBroadcast.text || "";
  pendingBroadcast = null;
  if (text) {
    showTeacherMessage(text);
  }
}

function showIntroIfNeeded() {
  if (introShown) return;
  if (!groupData) return;

  const storySettings = getStorySettings();
  const introMode = storySettings?.introMode || "popup";

  if (introMode === "none") {
    introShown = true;
    showPendingBroadcastIfAny();
    return;
  }

  const title = cityData?.name
    ? `Welkom in ${cityData.name}`
    : "Jullie missie begint";

  const text =
    currentGameType?.description ||
    "Jullie gaan op pad langs checkpoints. Los vragen op, verzamel items en bereik het verzamelpunt.";

  if (byId("introTitle")) byId("introTitle").innerText = title;
  if (byId("introText")) byId("introText").innerText = text;

  hideModal("messageModal");
  showModal("introModal");
  introShown = true;
}

function flashSuccess() {
  document.body.classList.add("success-flash");
  setTimeout(() => document.body.classList.remove("success-flash"), 700);
}

function showErrorShake() {
  const modalContent = byId("questionModal")?.querySelector(".modal-content");
  if (!modalContent) return;
  modalContent.classList.add("error-shake");
  setTimeout(() => modalContent.classList.remove("error-shake"), 500);
}

/* =========================================================
   QUESTION RENDERING
========================================================= */
function renderMultipleChoiceOptions(cp) {
  const wrap = byId("taskMultipleChoiceWrapper");
  const container = byId("multipleChoiceOptions");
  if (!wrap || !container) return;

  container.innerHTML = "";
  wrap.classList.remove("hidden-task");

  (cp.options || []).forEach((optionText, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerText = optionText;
    btn.style.marginBottom = "10px";
    btn.style.opacity = currentSelectedMultipleChoice === index ? "1" : "0.85";

    btn.addEventListener("click", () => {
      currentSelectedMultipleChoice = index;
      renderMultipleChoiceOptions(cp);
    });

    container.appendChild(btn);
  });
}

function renderMatchingTask(cp) {
  const wrap = byId("taskMatchingWrapper");
  const container = byId("matchingContainer");
  if (!wrap || !container) return;

  wrap.classList.remove("hidden-task");

  const left = cp.leftItems || [];
  const right = cp.rightItems || [];

  container.innerHTML = "";

  left.forEach((leftItem, index) => {
    const row = document.createElement("div");
    row.style.marginBottom = "10px";

    const label = document.createElement("span");
    label.innerText = leftItem + " → ";

    const select = document.createElement("select");
    select.dataset.left = leftItem;

    const empty = document.createElement("option");
    empty.value = "";
    empty.innerText = "-- kies --";
    select.appendChild(empty);

    right.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r;
      opt.innerText = r;
      select.appendChild(opt);
    });

    row.appendChild(label);
    row.appendChild(select);
    container.appendChild(row);
  });
}

function renderImagePuzzleTask(cp) {
  const wrap = byId("taskImagePuzzleWrapper");
  const grid = byId("puzzleGrid");
  if (!wrap || !grid) return;

  wrap.classList.remove("hidden-task");

  const size = Number(cp.gridSize || 3);
  const total = size * size;

  const order = [...Array(total).keys()];
  const shuffled = [...order].sort(() => Math.random() - 0.5);

  let userSequence = [];

  grid.innerHTML = "";
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  grid.style.gap = "5px";

  shuffled.forEach((num) => {
    const tile = document.createElement("div");
    tile.style.background = "#333";
    tile.style.color = "white";
    tile.style.padding = "20px";
    tile.style.textAlign = "center";
    tile.style.cursor = "pointer";
    tile.innerText = num + 1;

    tile.addEventListener("click", () => {
      if (userSequence.includes(num)) return;

      userSequence.push(num);
      tile.style.background = "#22c55e";

      if (userSequence.length === total) {
        const correct = order.every((v, i) => v === userSequence[i]);
        byId("modalAnswerInput").value = correct ? "correct" : "wrong";
      }
    });

    grid.appendChild(tile);
  });
}

function renderPhotoTask() {
  const wrap = byId("taskPhotoWrapper");
  if (wrap) wrap.classList.remove("hidden-task");
}

function resetQuestionTaskWrappers() {
  byId("taskTextWrapper")?.classList.remove("hidden-task");
  byId("taskMultipleChoiceWrapper")?.classList.add("hidden-task");
  byId("taskMatchingWrapper")?.classList.add("hidden-task");
  byId("taskImagePuzzleWrapper")?.classList.add("hidden-task");
  byId("taskPhotoWrapper")?.classList.add("hidden-task");
}

function openQuestionForCheckpoint(cp) {
  if (!cp || questionOpen || routeCompleted) return;

  questionOpen = true;
  currentQuestionCheckpoint = cp;
  currentTries = 0;
  currentSelectedMultipleChoice = null;

  if (byId("modalTitle")) byId("modalTitle").innerText = cp.name || "Checkpoint";
  if (byId("modalQuestion")) byId("modalQuestion").innerText = cp.question || "Vraag";
  if (byId("answerFeedback")) byId("answerFeedback").innerText = "";
  if (byId("triesFeedback")) byId("triesFeedback").innerText = "";

  resetQuestionTaskWrappers();

  const storyMode = getStorySettings()?.checkpointMode || "inline";
  const storyEl = byId("modalStory");
  if (storyEl) {
    if (cp.story && storyMode !== "none") {
      storyEl.innerText = cp.story;
      storyEl.classList.remove("hidden");
    } else {
      storyEl.classList.add("hidden");
      storyEl.innerText = "";
    }
  }

  const input = byId("modalAnswerInput");
  if (input) {
    input.value = "";
    input.style.display = (
      cp.taskType === "text" ||
      cp.taskType === "riddle" ||
    ) ? "" : "none";
  }

  const video = byId("modalVideo");
  if (video) {
    if (cp.video) {
      video.src = cp.video;
      video.classList.remove("hidden");
    } else {
      video.src = "";
      video.classList.add("hidden");
    }
  }

  const audio = byId("modalAudio");
  if (audio) {
    if (cp.audio) {
      audio.src = cp.audio;
      audio.classList.remove("hidden");
    } else {
      audio.src = "";
      audio.classList.add("hidden");
    }
  }

  const image = byId("modalImage");
  if (image) {
    if ((cp.image || cp.imageUrl) && cp.taskType !== "imagePuzzle") {
      image.src = cp.image || cp.imageUrl;
      image.classList.remove("hidden");
    } else {
      image.src = "";
      image.classList.add("hidden");
    }
  }

  if (cp.taskType === "multipleChoice") {
    byId("taskTextWrapper")?.classList.add("hidden-task");
    renderMultipleChoiceOptions(cp);
  }

  if (cp.taskType === "matching") {
    renderMatchingTask(cp);
  }

  if (cp.taskType === "imagePuzzle") {
    renderImagePuzzleTask(cp);
  }

  if (cp.taskType === "photo") {
    byId("taskTextWrapper")?.classList.add("hidden-task");
    renderPhotoTask();
  }

  showModal("questionModal");
}

function getUserAnswerForCheckpoint(cp) {
  if (!cp) return null;

  if (cp.taskType === "multipleChoice") {
    return currentSelectedMultipleChoice;
  }

  if (cp.taskType === "photo") {
    const file = byId("photoInput")?.files?.[0] || null;
    return file ? "photo_uploaded" : "";
  }

  return (byId("modalAnswerInput")?.value || "").trim();
}

function validateCheckpointAnswer(cp, userAnswer) {
  if (!cp) return false;

  if (cp.taskType === "multipleChoice") {
    return Number(userAnswer) === Number(cp.correctOption);
  }

  if (cp.taskType === "matching") {
  const selects = document.querySelectorAll("#matchingContainer select");
  let correct = true;

  selects.forEach((sel) => {
    const left = sel.dataset.left;
    const chosen = sel.value;
    const expected = cp.correctPairs[left];

    if (chosen !== expected) {
      correct = false;
    }
  });

  return correct;
  }
  if (cp.taskType === "imagePuzzle") {
  return userAnswer === "correct";
  }
  if (cp.taskType === "photo") {
    return String(userAnswer || "").trim() === "photo_uploaded";
  }

  const answers = Array.isArray(cp.answers) ? cp.answers : [];
  const normalized = String(userAnswer || "").trim().toLowerCase();

  if (!answers.length) {
    return normalized.length > 0;
  }

  return answers.some((ans) => String(ans).trim().toLowerCase() === normalized);
}

/* =========================================================
   GROUP CREATION / LISTENERS
========================================================= */
async function getNextGroupNumber() {
  const counterRef = ref(db, `meta/groupCounters/${cityKey}`);
  const result = await runTransaction(counterRef, (current) => (current || 0) + 1);
  return result.snapshot.val();
}

function getInitialRouteIndex(groupNumber) {
  const flow = getGameTypeRules().checkpointFlow || "rotatingRoute";

  if (!checkpoints.length) return 0;
  if (flow !== "rotatingRoute") return 0;

  const base = Math.max(0, Number(groupNumber || 1) - 1);
  return base % checkpoints.length;
}

async function createGroup() {
  const groupName = (byId("groupName")?.value || "").trim();
  const groupMembers = (byId("groupMembers")?.value || "").trim();

  if (!groupName) {
    if (byId("loginFeedback")) {
      byId("loginFeedback").innerText = "Vul eerst een groepsnaam in.";
    }
    return;
  }

  if (currentTeacherCity && !groupId) {
    await reloadCityContext(currentTeacherCity);
  }

  if (!cityKey) {
    if (byId("loginFeedback")) {
      byId("loginFeedback").innerText = "Er is nog geen actieve stad gekozen.";
    }
    return;
  }

  const createdAt = nowMs();
  const number = await getNextGroupNumber();
  const newRef = push(ref(db, "groups"));
  const initialRouteIndex = getInitialRouteIndex(number);

  const initialGroup = {
    cityKey,
    groupName,
    groupMembers,
    groupNumber: number,
    score: 0,
    routeIndex: initialRouteIndex,
    checkpoint: checkpoints[initialRouteIndex]?.name || "",
    nextCheckpoint:
      checkpoints[initialRouteIndex + 1]?.name ||
      cityData?.gather?.name ||
      "Verzamelpunt",
    evidence: [],
    evidenceCount: 0,
    answeredCheckpointIds: [],
    collectedCollectibleCheckpointIds: [],
    pendingCollectibleCheckpointId: null,
    gatherMode: false,
    finished: false,
    createdAt,
    startedAt: createdAt,
    ignoreBroadcastsBefore: createdAt,
    lat: null,
    lng: null,
    effects: {},
    gameTypeName: currentGameType?.name || "klassiek"
  };

  await set(newRef, initialGroup);

  groupId = newRef.key;
  storeGroupIdForCity(groupId);

  localStorage.setItem("groupName", groupName);
  localStorage.setItem("groupMembers", groupMembers);

  globalBroadcastDismissedAt = createdAt;
  pendingBroadcast = null;
}

function listenToGroup() {
  if (!groupId) return;

  if (unsubscribeGroupListener) {
    unsubscribeGroupListener();
    unsubscribeGroupListener = null;
  }

  unsubscribeGroupListener = onValue(ref(db, `groups/${groupId}`), async (snapshot) => {
    if (!snapshot.exists()) return;

    groupData = snapshot.val() || {};

    if (groupData.cityKey && groupData.cityKey !== cityKey) {
      await reloadCityContext(groupData.cityKey);
    }

    answeredCheckpointIds = Array.isArray(groupData.answeredCheckpointIds)
      ? groupData.answeredCheckpointIds
      : [];

    collectedCollectibleCheckpointIds = Array.isArray(groupData.collectedCollectibleCheckpointIds)
      ? groupData.collectedCollectibleCheckpointIds
      : [];

    pendingCollectibleCheckpointId = groupData.pendingCollectibleCheckpointId || null;
    routeCompleted = !!groupData.gatherMode || !!groupData.finished;
    gameStartTimestamp = groupData.startedAt || groupData.createdAt || null;

    byId("loginCard")?.classList.add("hidden");
    byId("gameArea")?.classList.remove("hidden");

    updateStudentTopUI();
    updateRankingUI();
    updateCheckpointVisuals();
    updateGroupMarker();
    updateArrowToTarget();
    updateEvidenceUI();
    updateMapVisibilityFromEffects();
    await processIncomingCommands();
    showIntroIfNeeded();
    await maybeOpenQuestionFromLocation();
    await maybeCheckCollectiblePickup();
    await maybeCheckGatherCompletion();
  });
}

function listenToAllGroups() {
  if (unsubscribeAllGroupsListener) {
    unsubscribeAllGroupsListener();
    unsubscribeAllGroupsListener = null;
  }

  unsubscribeAllGroupsListener = onValue(ref(db, "groups"), (snapshot) => {
    groupsCache = snapshot.val() || {};
    updateRankingUI();
    updateEvidenceUI();
  });
}

function listenToBroadcasts() {
  if (!cityKey) return;

  if (unsubscribeBroadcastListener) {
    unsubscribeBroadcastListener();
    unsubscribeBroadcastListener = null;
  }

  unsubscribeBroadcastListener = onValue(ref(db, `control/broadcasts/${cityKey}`), (snapshot) => {
    if (!snapshot.exists()) return;

    const broadcast = snapshot.val() || {};
    const at = Number(broadcast.at || 0);
    const ignoreBefore = Number(groupData?.ignoreBroadcastsBefore || 0);

    if (!broadcast.text) return;
    if (at <= globalBroadcastDismissedAt) return;
    if (ignoreBefore && at <= ignoreBefore) return;

    globalBroadcastDismissedAt = at;

    if (!byId("introModal")?.classList.contains("hidden")) {
      pendingBroadcast = broadcast;
      return;
    }

    showTeacherMessage(broadcast.text);
  });
}

function listenToTeacherCurrentCity() {
  if (unsubscribeTeacherCityListener) {
    unsubscribeTeacherCityListener();
    unsubscribeTeacherCityListener = null;
  }

  unsubscribeTeacherCityListener = onValue(ref(db, "control/currentCity"), async (snapshot) => {
    currentTeacherCity = snapshot.val() || null;

    if (groupData?.cityKey) {
      if (cityKey !== groupData.cityKey) {
        await reloadCityContext(groupData.cityKey);
      }
      return;
    }

    if (groupId && !groupData) return;

    if (!groupId && currentTeacherCity) {
      await reloadCityContext(currentTeacherCity);
    }
  });
}

async function reloadCityContext(newCityKey) {
  if (!newCityKey) return;

  cityKey = newCityKey;
  localStorage.setItem("activeCityKey", cityKey);

  await loadCityAndGameType();
  listenToBroadcasts();

  if (!map) {
    initMap();
  } else {
    const center = cityData?.center || [50.85, 4.35];
    map.setView(center, 16);
  }

  await applyTheme();
  updateCheckpointVisuals();
  updateStudentTopUI();
  updateInventoryTexts();
  updateRankingUI();
  updateArrowToTarget();
  updateMapVisibilityFromEffects();
}

/* =========================================================
   COMMANDS
========================================================= */
async function processIncomingCommands() {
  if (!groupData || !groupId) return;

  if (
    groupData.commandMessageAt &&
    groupData.commandMessageAt > lastProcessedCommandTimestamps.commandMessageAt
  ) {
    lastProcessedCommandTimestamps.commandMessageAt = groupData.commandMessageAt;
    if (groupData.commandMessageText) {
      if (!byId("introModal")?.classList.contains("hidden")) {
        pendingBroadcast = {
          text: groupData.commandMessageText,
          at: groupData.commandMessageAt
        };
      } else {
        showTeacherMessage(groupData.commandMessageText);
      }
    }
  }

  if (
    groupData.commandPointsAt &&
    groupData.commandPointsAt > lastProcessedCommandTimestamps.commandPointsAt
  ) {
    lastProcessedCommandTimestamps.commandPointsAt = groupData.commandPointsAt;
    const value = Number(groupData.commandPointsValue || 0);
    if (value !== 0) {
      const newScore = Number(groupData.score || 0) + value;
      await update(ref(db, `groups/${groupId}`), { score: newScore });
    }
  }

  if (
    groupData.commandResetAt &&
    groupData.commandResetAt > lastProcessedCommandTimestamps.commandResetAt
  ) {
    lastProcessedCommandTimestamps.commandResetAt = groupData.commandResetAt;
    await hardResetCurrentGroup();
    return;
  }

  if (
    groupData.commandNextAt &&
    groupData.commandNextAt > lastProcessedCommandTimestamps.commandNextAt
  ) {
    lastProcessedCommandTimestamps.commandNextAt = groupData.commandNextAt;
    await advanceToNextCheckpoint();
  }

  await cleanupExpiredEffects();
}

async function hardResetCurrentGroup() {
  if (!groupId) return;

  const now = nowMs();

  await update(ref(db, `groups/${groupId}`), {
    score: 0,
    routeIndex: 0,
    checkpoint: checkpoints[0]?.name || "",
    nextCheckpoint: checkpoints[1]?.name || "",
    evidence: [],
    evidenceCount: 0,
    answeredCheckpointIds: [],
    collectedCollectibleCheckpointIds: [],
    pendingCollectibleCheckpointId: null,
    gatherMode: false,
    finished: false,
    finishedAt: null,
    finishTimeMs: null,
    effects: {},
    startedAt: now,
    ignoreBroadcastsBefore: now
  });

  routeCompleted = false;
  answeredCheckpointIds = [];
  collectedCollectibleCheckpointIds = [];
  pendingCollectibleCheckpointId = null;
  gameStartTimestamp = now;
  collectiblePickupInProgress = false;
  pendingBroadcast = null;
  globalBroadcastDismissedAt = now;
  closeQuestionModal();
  hideModal("introModal");
  hideModal("messageModal");
  hideModal("evidenceModal");
  hideModal("evidenceFoundModal");
  introShown = false;
}

/* =========================================================
   CHECKPOINT FLOW
========================================================= */
async function maybeOpenQuestionFromLocation() {
  if (!groupData || routeCompleted) return;
  if (questionOpen) return;
  if (pendingCollectibleCheckpointId) return;
  if (hasActiveEffect("freeze")) return;

  const cp = getCurrentCheckpoint();
  if (!cp || !Array.isArray(cp.coords)) return;
  if (currentLat == null || currentLng == null) return;
  if (isCurrentCheckpointAnswered()) return;

  const dist = distanceMeters([currentLat, currentLng], cp.coords);
  const within = dist <= Number(cp.radius || 20);

  if (within) {
    openQuestionForCheckpoint(cp);
  }
}

async function submitCheckpointAnswer() {
  const cp = currentQuestionCheckpoint;
  if (!cp) return;
  if (cp.taskType === "multipleChoice" && currentSelectedMultipleChoice === null) {
  alert("Kies eerst een antwoord.");
  return;
  }

  const answer = getUserAnswerForCheckpoint(cp);
  const correct = validateCheckpointAnswer(cp, answer);
  const maxTries = Number(cp.maxTries || currentGameType?.rules?.maxTries || 3);

  if (correct) {
    if (byId("answerFeedback")) {
      byId("answerFeedback").innerText = "Juist antwoord!";
    }
    flashSuccess();
    await handleCheckpointSolved(cp, true, false);
    return;
  }

  currentTries += 1;

  if (byId("answerFeedback")) {
    byId("answerFeedback").innerText = "Nog niet juist.";
  }

  if (byId("triesFeedback")) {
    byId("triesFeedback").innerText = `Poging ${currentTries} / ${maxTries}`;
  }

  showErrorShake();

  if (currentTries >= maxTries) {
    await handleCheckpointSolved(cp, false, true);
  }
}

async function handleCheckpointSolved(cp, answeredCorrectly, reachedMaxTries) {
  const cpId = cp.id;

  if (!answeredCheckpointIds.includes(cpId)) {
    answeredCheckpointIds = [...answeredCheckpointIds, cpId];
  }

  const addedScore = answeredCorrectly
    ? Number(cp.pointsCorrect || 10)
    : Number(cp.pointsAfterMaxTries || 0);

  const newScore = Number(groupData.score || 0) + addedScore;

  await update(ref(db, `groups/${groupId}`), {
    score: newScore,
    answeredCheckpointIds,
    evidenceCount: (groupData.evidence || []).length
  });

  closeQuestionModal();

  if (!answeredCorrectly) {
    await advanceToNextCheckpoint();
    return;
  }

  const canGrantCollectible = shouldGrantCollectible(cp, answeredCorrectly, reachedMaxTries);
  if (!canGrantCollectible || !cp.collectible) {
    await advanceToNextCheckpoint();
    return;
  }

  if (hasCollectedCollectibleForCheckpoint(cp.id)) {
    await advanceToNextCheckpoint();
    return;
  }

  if (shouldUseSearchChoice(cp)) {
    pendingCollectibleCheckpointId = cp.id;
    await update(ref(db, `groups/${groupId}`), {
      pendingCollectibleCheckpointId: cp.id
    });
    updateCheckpointVisuals();
    return;
  }

  await giveCollectibleFromCheckpoint(cp);
  await advanceToNextCheckpoint();
}

async function giveCollectibleFromCheckpoint(cp) {
  if (!cp?.collectible) return;
  if (hasCollectedCollectibleForCheckpoint(cp.id)) return;

  const currentItems = Array.isArray(groupData?.evidence) ? groupData.evidence : [];
  const newItem = buildNormalizedItem({
    ...cp.collectible,
    id: `item_${Date.now()}_${Math.floor(Math.random() * 10000)}`
  });

  const newCollected = [...new Set([...collectedCollectibleCheckpointIds, cp.id])];
  const newItems = [...currentItems, newItem];

  collectedCollectibleCheckpointIds = newCollected;

  await update(ref(db, `groups/${groupId}`), {
    evidence: newItems,
    evidenceCount: newItems.length,
    collectedCollectibleCheckpointIds: newCollected,
    pendingCollectibleCheckpointId: null
  });

  pendingCollectibleCheckpointId = null;
  showFoundEvidenceModal(newItem);
}

async function maybeCheckCollectiblePickup() {
  if (!groupData || !pendingCollectibleCheckpointId) return;
  if (currentLat == null || currentLng == null) return;
  if (collectiblePickupInProgress) return;

  const cp = checkpoints.find((c) => c.id === pendingCollectibleCheckpointId);
  if (!cp || !cp.collectible) return;
  if (hasCollectedCollectibleForCheckpoint(cp.id)) return;

  const collectibleCoords = getCollectibleCoords(cp);
  if (!Array.isArray(collectibleCoords)) return;

  const dist = distanceMeters([currentLat, currentLng], collectibleCoords);
  const revealDistance = getRevealDistance(cp);

  updateCheckpointVisuals();

  if (dist > revealDistance) return;

  collectiblePickupInProgress = true;
  try {
    await giveCollectibleFromCheckpoint(cp);
    await advanceToNextCheckpoint();
  } finally {
    collectiblePickupInProgress = false;
  }
}

async function advanceToNextCheckpoint() {
  const currentIndex = getCurrentCheckpointIndex();
  const nextIndex = currentIndex + 1;

  if (nextIndex >= checkpoints.length) {
    routeCompleted = true;

    await update(ref(db, `groups/${groupId}`), {
      gatherMode: true,
      checkpoint: cityData?.gather?.name || "Verzamelpunt",
      nextCheckpoint: "-",
      pendingCollectibleCheckpointId: null
    });

    pendingCollectibleCheckpointId = null;
    updateCheckpointVisuals();
    updateStudentTopUI();
    return;
  }

  await update(ref(db, `groups/${groupId}`), {
    routeIndex: nextIndex,
    checkpoint: checkpoints[nextIndex]?.name || "",
    nextCheckpoint:
      checkpoints[nextIndex + 1]?.name ||
      cityData?.gather?.name ||
      "Verzamelpunt",
    pendingCollectibleCheckpointId: null
  });

  pendingCollectibleCheckpointId = null;
  updateCheckpointVisuals();
  updateStudentTopUI();
}

async function maybeCheckGatherCompletion() {
  if (!routeCompleted || !groupData || groupData.finished) return;
  if (currentLat == null || currentLng == null) return;
  if (!cityData?.gather?.coords) return;

  const dist = distanceMeters([currentLat, currentLng], cityData.gather.coords);
  const within = dist <= Number(cityData.gather.radius || 40);

  if (!within) return;

  const finishTimeMs = gameStartTimestamp ? nowMs() - gameStartTimestamp : 0;
  const timeBonus = calculateTimeBonusPoints();
  const finalScore = Number(groupData.score || 0) + timeBonus;

  await update(ref(db, `groups/${groupId}`), {
    finished: true,
    gatherMode: true,
    finishedAt: nowMs(),
    finishTimeMs,
    score: finalScore,
    timeBonusPoints: timeBonus,
    checkpoint: cityData?.gather?.name || "Verzamelpunt",
    nextCheckpoint: "-"
  });

  alert(
    `Proficiat! Jullie zijn klaar.\nTijd: ${formatDuration(finishTimeMs)}\nPunten: ${finalScore}` +
    (timeBonus ? `\nTijdsbonus: ${timeBonus}` : "")
  );
}

/* =========================================================
   INVENTORY / COLLECTIBLES / SABOTAGE
========================================================= */
function isUsableEvidenceItem(item) {
  return !!item && !!item.actionType && !item.used;
}

function showFoundEvidenceModal(item) {
  if (byId("foundEvidenceIcon")) byId("foundEvidenceIcon").innerText = item.icon || "✨";
  if (byId("foundEvidenceName")) byId("foundEvidenceName").innerText = item.name || "Nieuw item";
  if (byId("foundEvidenceDescription")) {
    byId("foundEvidenceDescription").innerText = item.description || "Item toegevoegd.";
  }
  showModal("evidenceFoundModal");
}

function updateEvidenceUI() {
  const quickBar = byId("evidenceQuickBar");
  const quickSlots = byId("evidenceQuickSlots");
  const evidenceGrid = byId("evidenceGrid");

  if (!shouldUseInventoryUI()) {
    quickBar?.classList.add("hidden");
    return;
  }

  const items = Array.isArray(groupData?.evidence) ? groupData.evidence : [];

  if (quickBar) {
    quickBar.classList.toggle("hidden", !items.length);
  }

  if (quickSlots) {
    quickSlots.innerHTML = items
      .slice(0, 4)
      .map((item, index) => `
        <button type="button" data-quick-item="${index}">
          ${item.icon || "❓"} ${item.name || "Item"}
        </button>
      `)
      .join("");

    quickSlots.querySelectorAll("[data-quick-item]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openEvidenceModal();
        renderEvidenceDetail(Number(btn.getAttribute("data-quick-item")));
      });
    });
  }

  if (evidenceGrid) {
    evidenceGrid.innerHTML = items.length
      ? items
          .map((item, index) => `
            <button type="button" class="evidence-slot" data-evidence-item="${index}">
              <div class="evidence-slot-icon">${item.icon || "❓"}</div>
              <div class="evidence-slot-name">${item.name || "Item"}</div>
            </button>
          `)
          .join("")
      : `<p>Jullie hebben nog geen items verzameld.</p>`;

    evidenceGrid.querySelectorAll("[data-evidence-item]").forEach((btn) => {
      btn.addEventListener("click", () => {
        renderEvidenceDetail(Number(btn.getAttribute("data-evidence-item")));
      });
    });
  }
}

function renderEvidenceDetail(index) {
  const items = Array.isArray(groupData?.evidence) ? groupData.evidence : [];
  const item = items[index];

  if (!item) {
    if (byId("evidenceDetailIcon")) byId("evidenceDetailIcon").innerText = "❓";
    if (byId("evidenceDetailName")) byId("evidenceDetailName").innerText = "Nog geen item geselecteerd";
    if (byId("evidenceDetailDescription")) {
      byId("evidenceDetailDescription").innerText = "Klik op een item om meer informatie te bekijken.";
    }
    if (byId("evidenceDetailStatus")) byId("evidenceDetailStatus").innerText = "Status: onbekend";
    return;
  }

  if (byId("evidenceDetailIcon")) byId("evidenceDetailIcon").innerText = item.icon || "❓";
  if (byId("evidenceDetailName")) byId("evidenceDetailName").innerText = item.name || "Item";
  if (byId("evidenceDetailDescription")) {
    byId("evidenceDetailDescription").innerText = item.description || "Geen beschrijving.";
  }
  if (byId("evidenceDetailStatus")) {
    byId("evidenceDetailStatus").innerText = item.used
      ? "Status: reeds gebruikt"
      : isUsableEvidenceItem(item)
        ? `Status: bruikbaar item, bereik ${item.actionRange || 25} meter`
        : "Status: verzameld";
  }

  const detailCard = qs(".evidence-detail-card");
  if (!detailCard) return;

  let actionBlock = detailCard.querySelector(".evidence-action-block");
  if (actionBlock) actionBlock.remove();

  if (isUsableEvidenceItem(item)) {
    actionBlock = document.createElement("div");
    actionBlock.className = "evidence-action-block";
    actionBlock.style.marginTop = "12px";

    const nearby = findNearbyTargetGroup(item.actionRange || 25);

    const info = document.createElement("p");
    info.className = "small-note";
    info.innerText = nearby
      ? `Groep ${nearby.data.groupNumber || "?"} is binnen bereik op ${formatMeters(nearby.distance)}.`
      : "Geen andere groep binnen bereik.";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerText = "Gebruik item";
    btn.addEventListener("click", async () => {
      await useEvidenceItem(index);
    });

    actionBlock.appendChild(info);
    actionBlock.appendChild(btn);
    detailCard.appendChild(actionBlock);
  }
}

function openEvidenceModal() {
  updateEvidenceUI();
  renderEvidenceDetail(0);
  showModal("evidenceModal");
}

function findNearbyTargetGroup(range = 25) {
  if (currentLat == null || currentLng == null) return null;

  let closest = null;
  let closestDist = Infinity;

  Object.entries(groupsCache || {}).forEach(([id, g]) => {
    if (!g || id === groupId) return;
    if (g.cityKey !== cityKey) return;
    if (typeof g.lat !== "number" || typeof g.lng !== "number") return;
    if (g.finished) return;

    const dist = distanceMeters([currentLat, currentLng], [g.lat, g.lng]);
    if (dist <= range && dist < closestDist) {
      closest = { id, data: g, distance: dist };
      closestDist = dist;
    }
  });

  return closest;
}

async function markEvidenceItemUsed(index) {
  const currentItems = Array.isArray(groupData?.evidence)
    ? [...groupData.evidence]
    : [];

  if (!currentItems[index]) return;

  currentItems.splice(index, 1);

  await update(ref(db, `groups/${groupId}`), {
    evidence: currentItems,
    evidenceCount: currentItems.length
  });
}

function targetHasShield(target) {
  const effects = Object.values(target?.effects || {});
  const now = nowMs();
  return effects.some((effect) => effect?.type === "shield" && (!effect.endsAt || effect.endsAt > now));
}

async function applyEffectToTargetGroup(targetId, item) {
  if (!targetId || !item) return false;

  const effectId = `effect_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const targetSnap = await get(ref(db, `groups/${targetId}`));
  const sourceSnap = await get(ref(db, `groups/${groupId}`));

  const target = targetSnap.exists() ? targetSnap.val() : null;
  const source = sourceSnap.exists() ? sourceSnap.val() : null;

  if (!target || !source) return false;

  if (targetHasShield(target) && item.actionType !== "cleanse") {
    alert("Doelgroep is beschermd door een schild.");
    return false;
  }

  if (item.actionType === "map_blur") {
    await set(ref(db, `groups/${targetId}/effects/${effectId}`), {
      type: "map_blur",
      startedAt: nowMs(),
      endsAt: nowMs() + Number(item.actionDuration || 40) * 1000,
      sourceGroupId: groupId
    });
    return true;
  }

  if (item.actionType === "compass_off") {
    await set(ref(db, `groups/${targetId}/effects/${effectId}`), {
      type: "compass_off",
      startedAt: nowMs(),
      endsAt: nowMs() + Number(item.actionDuration || 40) * 1000,
      sourceGroupId: groupId
    });
    return true;
  }

  if (item.actionType === "freeze") {
    await set(ref(db, `groups/${targetId}/effects/${effectId}`), {
      type: "freeze",
      startedAt: nowMs(),
      endsAt: nowMs() + Number(item.actionDuration || 20) * 1000,
      sourceGroupId: groupId
    });
    return true;
  }

  if (item.actionType === "shield") {
    await set(ref(db, `groups/${groupId}/effects/${effectId}`), {
      type: "shield",
      startedAt: nowMs(),
      endsAt: nowMs() + Number(item.actionDuration || 40) * 1000,
      sourceGroupId: groupId
    });
    return true;
  }

  if (item.actionType === "score_steal") {
    const amount = Number(item.actionValue || 15);
    const targetScore = Math.max(0, Number(target.score || 0) - amount);
    const sourceScore = Number(source.score || 0) + amount;

    await update(ref(db, `groups/${targetId}`), { score: targetScore });
    await update(ref(db, `groups/${groupId}`), { score: sourceScore });
    return true;
  }

  return false;
}

async function useEvidenceItem(itemIndex) {
  const items = Array.isArray(groupData?.evidence) ? groupData.evidence : [];
  const item = items[itemIndex];

  if (!item || !isUsableEvidenceItem(item)) return;

  if (item.actionType === "shield") {
    const success = await applyEffectToTargetGroup(groupId, item);
    if (success) {
      await markEvidenceItemUsed(itemIndex);
      updateEvidenceUI();
      renderEvidenceDetail(0);
      alert("Schild geactiveerd.");
    }
    return;
  }

  const nearby = findNearbyTargetGroup(item.actionRange || 25);
  if (!nearby) {
    alert("Geen groep binnen bereik.");
    return;
  }

  const success = await applyEffectToTargetGroup(nearby.id, item);
  if (!success) return;

  await markEvidenceItemUsed(itemIndex);
  updateEvidenceUI();
  renderEvidenceDetail(0);

  alert(`Item gebruikt op groep ${nearby.data.groupNumber || "?"}.`);
}

/* =========================================================
   LOCATION / GPS
========================================================= */
async function syncGroupPosition(force = false) {
  if (!groupId || currentLat == null || currentLng == null) return;

  const now = nowMs();
  if (!force && now - lastPositionSyncAt < 1500) return;
  lastPositionSyncAt = now;

  await update(ref(db, `groups/${groupId}`), {
    lat: currentLat,
    lng: currentLng,
    lastUpdated: new Date().toLocaleTimeString("nl-BE", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })
  });
}

function startLocationWatch() {
  if (watchId != null) return;

  if (!navigator.geolocation) {
    alert("Geolocatie wordt niet ondersteund op dit toestel.");
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    async (position) => {
      currentLat = position.coords.latitude;
      currentLng = position.coords.longitude;

      if (Number.isFinite(position.coords.heading)) {
        currentHeading = position.coords.heading;
      }

      updateGroupMarker();
      updateStudentTopUI();
      updateArrowToTarget();
      updateCheckpointVisuals();
      updateMapVisibilityFromEffects();

      await syncGroupPosition();
      await maybeOpenQuestionFromLocation();
      await maybeCheckCollectiblePickup();
      await maybeCheckGatherCompletion();
    },
    (error) => {
      console.error("GPS fout:", error);
      updateGPSStatus();
    },
    {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 10000
    }
  );
}

/* =========================================================
   STARTUP
========================================================= */
async function bootstrap() {
  if (appReady) return;
  appReady = true;

  parseUrlParams();

  if (cityKey) {
    restoreGroupIdForCity();
  }

  listenToTeacherCurrentCity();

  if (cityKey) {
    await reloadCityContext(cityKey);
  } else if (currentTeacherCity) {
    await reloadCityContext(currentTeacherCity);
  } else {
    await reloadCityContext("durbuy");
  }

  listenToAllGroups();

  if (groupId) {
    listenToGroup();
  }

  byId("startButton")?.addEventListener("click", async () => {
    await createGroup();
    listenToGroup();
    startLocationWatch();
  });

  byId("submitAnswerButton")?.addEventListener("click", submitCheckpointAnswer);

  byId("closeIntroButton")?.addEventListener("click", () => {
    hideModal("introModal");
    showPendingBroadcastIfAny();
  });

  byId("closeMessageButton")?.addEventListener("click", () => {
    hideModal("messageModal");
  });

  byId("openEvidenceButton")?.addEventListener("click", openEvidenceModal);
  byId("closeEvidenceButton")?.addEventListener("click", () => hideModal("evidenceModal"));
  byId("closeFoundEvidenceButton")?.addEventListener("click", () => hideModal("evidenceFoundModal"));

  const photoInput = byId("photoInput");
  if (photoInput) {
    photoInput.addEventListener("change", () => {
      const file = photoInput.files?.[0] || null;
      const preview = byId("photoPreview");
      const status = byId("photoUploadStatus");

      if (!file) {
        if (preview) {
          preview.src = "";
          preview.classList.add("hidden-task");
        }
        if (status) status.innerText = "";
        return;
      }

      if (preview) {
        preview.src = URL.createObjectURL(file);
        preview.classList.remove("hidden-task");
      }

      if (status) {
        status.innerText = "Foto toegevoegd.";
      }
    });
  }

  const toggleAudioButton = byId("toggleAudioButton");
  if (toggleAudioButton) {
    let muted = true;

    toggleAudioButton.addEventListener("click", () => {
      muted = !muted;

      document.querySelectorAll("audio, video").forEach((el) => {
        el.muted = muted;
        if (muted) {
          try {
            el.pause();
          } catch {}
        }
      });

      toggleAudioButton.innerText = muted ? "🔊 Geluid aan" : "🔇 Geluid uit";
    });
  }

  if (groupId) {
    byId("loginCard")?.classList.add("hidden");
    byId("gameArea")?.classList.remove("hidden");
    startLocationWatch();
  } else {
    byId("loginCard")?.classList.remove("hidden");
    byId("gameArea")?.classList.add("hidden");
  }

  updateInventoryTexts();
}

bootstrap().catch((error) => {
  console.error(error);
  alert("Er is een fout opgetreden bij het laden van het spel.");
});
