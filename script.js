import { cities as fallbackCities } from "./cities.js";
import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  get,
  update,
  push,
  onValue,
  runTransaction,
  set
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

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
let pendingCollectibleCheckpointId = null;
let currentQuestionCheckpoint = null;
let currentTries = 0;
let currentSelectedMultipleChoice = null;

let appReady = false;
let questionOpen = false;
let introShown = false;
let routeCompleted = false;
let globalBroadcastDismissedAt = 0;
let gameStartTimestamp = null;

let unsubscribeGroupListener = null;
let unsubscribeAllGroupsListener = null;
let unsubscribeBroadcastListener = null;
let unsubscribeTeacherCityListener = null;

let lastProcessedCommandTimestamps = {
  commandMessageAt: 0,
  commandPointsAt: 0,
  commandResetAt: 0,
  commandNextAt: 0
};

function byId(id) {
  return document.getElementById(id);
}

function qs(selector) {
  return document.querySelector(selector);
}

function nowMs() {
  return Date.now();
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

function setBodyModalState() {
  const ids = ["introModal", "questionModal", "messageModal", "evidenceModal", "evidenceFoundModal"];
  const hasOpen = ids.some((id) => !byId(id)?.classList.contains("hidden"));
  document.body.classList.toggle("modal-open", hasOpen);
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

function getInventoryLabel() {
  if (currentGameType?.inventory?.name) return currentGameType.inventory.name;
  if (currentGameType?.engine === "murder") return "Dossier";
  return "Grimoire";
}

function shouldUseInventoryUI() {
  return hasModule("inventory") || hasModule("collectibles") || hasModule("evidenceBook") || hasModule("usableItems");
}

function getGameTypeRules() {
  return currentGameType?.rules || {};
}

function getTimerSettings() {
  return currentGameType?.timer || {};
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
  cityKey = params.get("city") || localStorage.getItem("activeCityKey") || null;
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
  if (generic) groupId = generic;
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
  const totalSeconds = Math.max(0, Math.floor((ms || 0) / 1000));
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
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  const bearing = Math.atan2(y, x) * 180 / Math.PI;
  return (bearing + 360) % 360;
}

function normalizeGather(rawGather, center) {
  if (Array.isArray(rawGather)) {
    return { name: "Verzamelpunt", coords: rawGather, radius: 40 };
  }
  if (rawGather?.coords) {
    return {
      name: rawGather.name || "Verzamelpunt",
      coords: rawGather.coords,
      radius: Number(rawGather.radius || 40)
    };
  }
  return { name: "Verzamelpunt", coords: center, radius: 40 };
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
    mapVisibility: item.mapVisibility || currentGameType?.collectibles?.mapVisibility || "blurZone",
    searchRadius: Number(item.searchRadius || currentGameType?.collectibles?.searchRadius || 30),
    revealDistance: Number(item.revealDistance || currentGameType?.collectibles?.revealDistance || 15),
    used: !!item.used
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
    options: Array.isArray(cp?.options) ? cp.options : [],
    correctOption: Number.isFinite(Number(cp?.correctOption)) ? Number(cp.correctOption) : 0,
    leftItems: Array.isArray(cp?.leftItems) ? cp.leftItems : [],
    rightItems: Array.isArray(cp?.rightItems) ? cp.rightItems : [],
    correctPairs: cp?.correctPairs || {},
    imageUrl: cp?.imageUrl || cp?.image || "",
    image: cp?.image || cp?.imageUrl || "",
    gridSize: Number(cp?.gridSize || 3),
    pointsCorrect: Number(cp?.pointsCorrect || 10),
    pointsAfterMaxTries: Number(cp?.pointsAfterMaxTries || 0),
    maxTries: Number(cp?.maxTries || 3),
    story: cp?.story || "",
    video: cp?.video || "",
    audio: cp?.audio || "",
    collectible: cp?.collectible ? buildNormalizedItem(cp.collectible) : null,
    collectibleCoords: Array.isArray(cp?.collectibleCoords) ? cp.collectibleCoords : null,
    collectibleSearchRadius: Number(cp?.collectibleSearchRadius || 0),
    collectibleRevealDistance: Number(cp?.collectibleRevealDistance || 0),
    collectibleUnlockMode: cp?.collectibleUnlockMode || ""
  };
}

function getCurrentCheckpointIndex() {
  return Number(groupData?.routeIndex || 0);
}

function getCurrentCheckpoint() {
  return checkpoints[getCurrentCheckpointIndex()] || null;
}

function getCurrentCheckpointId() {
  return getCurrentCheckpoint()?.id || `cp_${getCurrentCheckpointIndex()}`;
}

function isCurrentCheckpointAnswered() {
  return answeredCheckpointIds.includes(getCurrentCheckpointId());
}

function shouldUseSearchChoice(cp) {
  if (!cp?.collectible) return false;
  const setting = cp.collectibleUnlockMode || currentGameType?.collectibles?.unlockCondition || "afterCorrect";
  return setting === "searchZoneAfterCorrect" || setting === "searchZoneAfterCorrectOrMaxTries";
}

function shouldGrantCollectible(cp, answeredCorrectly, reachedMaxTries) {
  if (!cp?.collectible) return false;
  const setting = cp.collectibleUnlockMode || currentGameType?.collectibles?.unlockCondition || "afterCorrect";
  if (setting === "none") return false;
  if (setting === "afterCorrect") return answeredCorrectly;
  if (setting === "afterMaxTries") return reachedMaxTries;
  if (setting === "afterCorrectOrMaxTries") return answeredCorrectly || reachedMaxTries;
  if (setting === "searchZoneAfterCorrect") return answeredCorrectly;
  if (setting === "searchZoneAfterCorrectOrMaxTries") return answeredCorrectly || reachedMaxTries;
  return answeredCorrectly;
}

function getCollectibleCoords(cp) {
  return Array.isArray(cp?.collectibleCoords) ? cp.collectibleCoords : cp?.coords || null;
}

function getSearchRadius(cp) {
  return Number(cp?.collectibleSearchRadius || cp?.collectible?.searchRadius || currentGameType?.collectibles?.searchRadius || 30);
}

function getRevealDistance(cp) {
  return Number(cp?.collectibleRevealDistance || cp?.collectible?.revealDistance || currentGameType?.collectibles?.revealDistance || 15);
}

async function loadCityAndGameType() {
  const citySnap = await get(ref(db, `cities/${cityKey}`));
  cityData = normalizeCity(cityKey, citySnap.exists() ? citySnap.val() : null);

  const checkpointsSnap = await get(ref(db, `cityData/${cityKey}/checkpoints`));
  let loaded = [];
  if (checkpointsSnap.exists() && Array.isArray(checkpointsSnap.val())) {
    loaded = checkpointsSnap.val();
  } else if (Array.isArray(fallbackCities?.[cityKey]?.defaultCheckpoints)) {
    loaded = fallbackCities[cityKey].defaultCheckpoints;
  }

  checkpoints = loaded.map(normalizeCheckpoint).filter((cp) => Array.isArray(cp.coords));

  if (cityData?.gameTypeId) {
    const gtSnap = await get(ref(db, `speltypes/${cityData.gameTypeId}`));
    currentGameType = gtSnap.exists() ? gtSnap.val() : null;
  } else {
    currentGameType = null;
  }
}

function resetThemeToDefaults() {
  document.documentElement.style.setProperty("--theme-text-color", "#ffffff");
  document.documentElement.style.setProperty("--theme-card-color", "rgba(22, 18, 34, 0.88)");
  document.documentElement.style.setProperty("--theme-primary-color", "#8b5cf6");
  document.documentElement.style.setProperty("--theme-secondary-color", "#d946ef");
  document.documentElement.style.setProperty("--theme-button-color", "#7c3aed");
  document.documentElement.style.setProperty("--theme-button-text-color", "#ffffff");
  document.body.style.background = "radial-gradient(circle at top, #1b1328, #0d0a14)";
}

async function applyTheme() {
  document.title = cityData?.name ? `${cityData.name} - City Escape` : "City Escape";
  byId("appTitle") && (byId("appTitle").innerText = document.title);

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
  if (t.backgroundType === "image" && t.backgroundImage) {
    document.body.style.background = `center / cover no-repeat url("${t.backgroundImage}") fixed`;
  } else {
    document.body.style.background = `radial-gradient(circle at top, ${t.backgroundColor || "#1b1328"}, #0d0a14)`;
  }
}

function initMap() {
  map = L.map("map").setView(cityData?.center || [50.85, 4.35], 16);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "OpenStreetMap" }).addTo(map);
  refreshGatherMarker();
}

function refreshGatherMarker() {
  if (!map) return;
  if (gatherMarker) {
    map.removeLayer(gatherMarker);
    gatherMarker = null;
  }
  if (routeCompleted && cityData?.gather?.coords) {
    gatherMarker = L.marker(cityData.gather.coords, { icon: emojiIcon(getMapIcons().gather, 30) })
      .addTo(map)
      .bindPopup(cityData.gather.name || "Verzamelpunt");
  }
}

function clearMapVisuals() {
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
  clearMapVisuals();
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

  checkpointMarker = L.marker(cp.coords, { icon: emojiIcon(getMapIcons().checkpoint, 30) })
    .addTo(map)
    .bindPopup(cp.name || "Checkpoint");

  checkpointRadiusCircle = L.circle(cp.coords, {
    radius: Number(cp.radius || 20),
    color: "#3b82f6",
    fillColor: "#3b82f6",
    fillOpacity: 0.08
  }).addTo(map);

  if (pendingCollectibleCheckpointId === cp.id && cp.collectible) {
    const searchCoords = getCollectibleCoords(cp);
    if (!searchCoords) return;

    collectibleSearchCircle = L.circle(searchCoords, {
      radius: getSearchRadius(cp),
      className: "collectible-search-zone"
    }).addTo(map);

    if (currentLat != null && currentLng != null) {
      const dist = distanceMeters([currentLat, currentLng], searchCoords);
      if (dist <= getRevealDistance(cp)) {
        collectibleMarker = L.marker(searchCoords, { icon: emojiIcon(cp.collectible.icon || getMapIcons().collectible, 28) })
          .addTo(map)
          .bindPopup(cp.collectible.name || "Collectible");
      }
    }
  }
}

function updateGroupMarker() {
  if (!map || currentLat == null || currentLng == null) return;
  if (!groupMarker) {
    groupMarker = L.marker([currentLat, currentLng], { icon: emojiIcon(getMapIcons().player, 28) }).addTo(map);
  } else {
    groupMarker.setLatLng([currentLat, currentLng]);
  }
}

function getActiveEffects() {
  const now = nowMs();
  return Object.values(groupData?.effects || {}).filter((effect) => !effect?.endsAt || effect.endsAt > now);
}

function hasActiveEffect(type) {
  return getActiveEffects().some((effect) => effect?.type === type);
}

function updateMapVisibilityFromEffects() {
  const mapEl = byId("map");
  if (!mapEl) return;
  mapEl.style.filter = hasActiveEffect("map_blur") ? "blur(7px)" : "";
  mapEl.style.opacity = hasActiveEffect("no_map") ? "0.15" : "";
}

async function cleanupExpiredEffects() {
  if (!groupId || !groupData?.effects) return;
  const updates = {};
  const now = nowMs();
  Object.entries(groupData.effects).forEach(([effectId, effect]) => {
    if (effect?.endsAt && effect.endsAt <= now) updates[`effects/${effectId}`] = null;
  });
  if (Object.keys(updates).length) {
    await update(ref(db, `groups/${groupId}`), updates);
  }
}

function updateInventoryTexts() {
  const label = getInventoryLabel();
  const btn = byId("openEvidenceButton");
  if (btn) {
    btn.style.display = shouldUseInventoryUI() ? "" : "none";
    btn.innerText = `📖 Open ${label.toLowerCase()}`;
  }
  const modal = byId("evidenceModal");
  const modalTitle = modal?.querySelector("h2");
  if (modalTitle) modalTitle.innerText = label;
  if (byId("evidenceIntroText")) {
    byId("evidenceIntroText").innerText = `Hier zie je alle verzamelde items uit je ${label.toLowerCase()}.`;
  }
}

function updateGPSStatus() {
  const dot = byId("gpsStatusDot");
  const text = byId("gpsStatusText");
  if (!dot || !text) return;
  const ok = currentLat != null && currentLng != null;
  dot.style.background = ok ? "#22c55e" : "red";
  text.innerText = ok ? "GPS-status: actief" : "GPS-status: geen locatie";
}

function updateStudentTopUI() {
  if (!groupData) return;
  byId("teamDisplay") && (byId("teamDisplay").innerText = `Groep ${groupData.groupNumber || "?"}: ${groupData.groupName || ""}`);
  byId("scoreText") && (byId("scoreText").innerText = String(groupData.score || 0));
  byId("progressText") && (byId("progressText").innerText = checkpoints.length ? `Checkpoint ${Math.min(getCurrentCheckpointIndex() + 1, checkpoints.length)} / ${checkpoints.length}` : "Checkpoint 0 / 0");
  byId("progressBarFill") && (byId("progressBarFill").style.width = `${checkpoints.length ? Math.round((answeredCheckpointIds.length / checkpoints.length) * 100) : 0}%`);

  let targetCoords = null;
  let targetTitle = "Checkpoint";
  if (routeCompleted) {
    targetCoords = cityData?.gather?.coords || null;
    targetTitle = cityData?.gather?.name || "Verzamelpunt";
  } else {
    const cp = getCurrentCheckpoint();
    targetCoords = cp?.coords || null;
    targetTitle = cp?.name || "Checkpoint";
  }

  byId("missionTargetTitle") && (byId("missionTargetTitle").innerText = targetTitle);
  const dist = targetCoords && currentLat != null && currentLng != null ? distanceMeters([currentLat, currentLng], targetCoords) : null;
  byId("status") && (byId("status").innerText = `Nog ${formatMeters(dist)} tot doel.`);
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

  const target = routeCompleted ? cityData?.gather?.coords : getCurrentCheckpoint()?.coords;
  if (!target || currentLat == null || currentLng == null) {
    arrow.style.display = "none";
    return;
  }

  arrow.style.display = "block";
  const bearing = getHeadingBetweenPoints([currentLat, currentLng], target);
  const heading = Number.isFinite(currentHeading) ? currentHeading : 0;
  arrow.style.transform = `rotate(${bearing - heading}deg)`;
}

function updateRankingUI() {
  const container = byId("studentRankingContainer");
  if (!container) return;
  if (!hasModule("ranking")) {
    container.innerHTML = "<p>Ranking staat uit voor dit speltype.</p>";
    return;
  }
  const groups = Object.entries(groupsCache || {})
    .map(([id, g]) => ({ id, ...g }))
    .filter((g) => g.cityKey === cityKey)
    .sort((a, b) => (b.score || 0) - (a.score || 0));
  container.innerHTML = groups.length
    ? groups.slice(0, 8).map((g, i) => `<div class="rank-item"><span>${i + 1}. Groep ${g.groupNumber || "?"}: ${g.groupName || "-"}</span><span>${g.score || 0}</span></div>`).join("")
    : "<p>Nog geen scoregegevens beschikbaar.</p>";
}

function resetQuestionTaskWrappers() {
  byId("taskTextWrapper")?.classList.remove("hidden-task");
  byId("taskMultipleChoiceWrapper")?.classList.add("hidden-task");
  byId("taskMatchingWrapper")?.classList.add("hidden-task");
  byId("taskImagePuzzleWrapper")?.classList.add("hidden-task");
  byId("taskPhotoWrapper")?.classList.add("hidden-task");
}

function renderMultipleChoiceOptions(cp) {
  const wrap = byId("taskMultipleChoiceWrapper");
  const container = byId("multipleChoiceOptions");
  if (!wrap || !container) return;
  wrap.classList.remove("hidden-task");
  byId("taskTextWrapper")?.classList.add("hidden-task");
  container.innerHTML = "";
  (cp.options || []).forEach((optionText, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.innerText = optionText;
    if (currentSelectedMultipleChoice === index) button.style.outline = "2px solid rgba(255,255,255,0.7)";
    button.addEventListener("click", () => {
      currentSelectedMultipleChoice = index;
      renderMultipleChoiceOptions(cp);
    });
    container.appendChild(button);
  });
}

function renderMatchingTask(cp) {
  const wrap = byId("taskMatchingWrapper");
  const container = byId("matchingContainer");
  if (!wrap || !container) return;
  wrap.classList.remove("hidden-task");
  container.innerHTML = `
    <p class="small-note">Typ de koppels als links=rechts, één per lijn.</p>
    <div class="info-list">
      ${(cp.leftItems || []).map((item, index) => `<p>${item} ↔ ${(cp.rightItems || [])[index] || "?"}</p>`).join("")}
    </div>
  `;
}

function renderImagePuzzleTask(cp) {
  const wrap = byId("taskImagePuzzleWrapper");
  const grid = byId("puzzleGrid");
  if (!wrap || !grid) return;
  wrap.classList.remove("hidden-task");
  grid.innerHTML = cp.imageUrl
    ? `<p class="small-note">Herken deze plaats in het echt en beantwoord daarna de vraag.</p><img src="${cp.imageUrl}" alt="Puzzel" style="max-width:100%;border-radius:14px;">`
    : `<p>Geen afbeelding ingesteld.</p>`;
}

function renderPhotoTask() {
  byId("taskPhotoWrapper")?.classList.remove("hidden-task");
  byId("taskTextWrapper")?.classList.add("hidden-task");
}

function openQuestionForCheckpoint(cp) {
  if (!cp || questionOpen || routeCompleted) return;
  questionOpen = true;
  currentQuestionCheckpoint = cp;
  currentTries = 0;
  currentSelectedMultipleChoice = null;

  byId("modalTitle") && (byId("modalTitle").innerText = cp.name || "Checkpoint");
  byId("modalQuestion") && (byId("modalQuestion").innerText = cp.question || "Vraag");
  byId("answerFeedback") && (byId("answerFeedback").innerText = "");
  byId("triesFeedback") && (byId("triesFeedback").innerText = "");

  resetQuestionTaskWrappers();

  const input = byId("modalAnswerInput");
  if (input) {
    input.value = "";
    input.style.display = ["text", "riddle", "matching", "imagePuzzle"].includes(cp.taskType) ? "" : "none";
  }

  const storyEl = byId("modalStory");
  if (storyEl) {
    storyEl.innerText = cp.story || "";
    storyEl.classList.toggle("hidden", !cp.story);
  }

  const video = byId("modalVideo");
  if (video) {
    video.src = cp.video || "";
    video.classList.toggle("hidden", !cp.video);
  }

  const audio = byId("modalAudio");
  if (audio) {
    audio.src = cp.audio || "";
    audio.classList.toggle("hidden", !cp.audio);
  }

  const image = byId("modalImage");
  if (image) {
    const showNormalImage = cp.image && cp.taskType !== "imagePuzzle";
    image.src = showNormalImage ? cp.image : "";
    image.classList.toggle("hidden", !showNormalImage);
  }

  if (cp.taskType === "multipleChoice") renderMultipleChoiceOptions(cp);
  if (cp.taskType === "matching") renderMatchingTask(cp);
  if (cp.taskType === "imagePuzzle") renderImagePuzzleTask(cp);
  if (cp.taskType === "photo") renderPhotoTask();

  showModal("questionModal");
}

function closeQuestionModal() {
  questionOpen = false;
  currentQuestionCheckpoint = null;
  currentTries = 0;
  currentSelectedMultipleChoice = null;
  hideModal("questionModal");
}

function getUserAnswerForCheckpoint(cp) {
  if (cp.taskType === "multipleChoice") return currentSelectedMultipleChoice;
  if (cp.taskType === "photo") return byId("photoInput")?.files?.[0] ? "photo_uploaded" : "";
  return (byId("modalAnswerInput")?.value || "").trim();
}

function validateCheckpointAnswer(cp, userAnswer) {
  if (!cp) return false;
  if (cp.taskType === "multipleChoice") return Number(userAnswer) === Number(cp.correctOption);
  if (cp.taskType === "matching") {
    const correctText = Object.entries(cp.correctPairs || {}).map(([left, right]) => `${left}=${right}`).join("\n").trim().toLowerCase();
    return String(userAnswer || "").trim().toLowerCase() === correctText;
  }
  if (cp.taskType === "photo") return String(userAnswer || "") === "photo_uploaded";
  const normalized = String(userAnswer || "").trim().toLowerCase();
  if (!(cp.answers || []).length) return normalized.length > 0;
  return (cp.answers || []).some((ans) => String(ans).trim().toLowerCase() === normalized);
}

async function getNextGroupNumber() {
  const counterRef = ref(db, `meta/groupCounters/${cityKey}`);
  const result = await runTransaction(counterRef, (current) => (current || 0) + 1);
  return result.snapshot.val();
}

function getInitialRouteIndex(groupNumber) {
  const flow = getGameTypeRules().checkpointFlow || "rotatingRoute";
  if (!checkpoints.length || flow !== "rotatingRoute") return 0;
  return Math.max(0, Number(groupNumber || 1) - 1) % checkpoints.length;
}

async function createGroup() {
  const groupName = (byId("groupName")?.value || "").trim();
  const groupMembers = (byId("groupMembers")?.value || "").trim();
  if (!groupName) {
    byId("loginFeedback") && (byId("loginFeedback").innerText = "Vul eerst een groepsnaam in.");
    return;
  }
  if (currentTeacherCity && !groupId) await reloadCityContext(currentTeacherCity);
  if (!cityKey) {
    byId("loginFeedback") && (byId("loginFeedback").innerText = "Er is nog geen actieve stad gekozen.");
    return;
  }

  const number = await getNextGroupNumber();
  const newRef = push(ref(db, "groups"));
  const routeIndex = getInitialRouteIndex(number);
  await set(newRef, {
    cityKey,
    groupName,
    groupMembers,
    groupNumber: number,
    score: 0,
    routeIndex,
    checkpoint: checkpoints[routeIndex]?.name || "",
    nextCheckpoint: checkpoints[routeIndex + 1]?.name || cityData?.gather?.name || "Verzamelpunt",
    evidence: [],
    evidenceCount: 0,
    answeredCheckpointIds: [],
    pendingCollectibleCheckpointId: null,
    gatherMode: false,
    finished: false,
    createdAt: nowMs(),
    startedAt: nowMs(),
    lat: null,
    lng: null,
    effects: {},
    gameTypeName: currentGameType?.name || "klassiek"
  });

  groupId = newRef.key;
  storeGroupIdForCity(groupId);
}

function listenToGroup() {
  if (!groupId) return;
  if (unsubscribeGroupListener) unsubscribeGroupListener();

  unsubscribeGroupListener = onValue(ref(db, `groups/${groupId}`), async (snapshot) => {
    if (!snapshot.exists()) return;
    groupData = snapshot.val() || {};

    if (groupData.cityKey && groupData.cityKey !== cityKey) {
      await reloadCityContext(groupData.cityKey);
    }

    answeredCheckpointIds = Array.isArray(groupData.answeredCheckpointIds) ? groupData.answeredCheckpointIds : [];
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
    await maybeOpenQuestionFromLocation();
    await maybeCheckCollectiblePickup();
    await maybeCheckGatherCompletion();
  });
}

function listenToAllGroups() {
  if (unsubscribeAllGroupsListener) unsubscribeAllGroupsListener();
  unsubscribeAllGroupsListener = onValue(ref(db, "groups"), (snapshot) => {
    groupsCache = snapshot.val() || {};
    updateRankingUI();
    updateEvidenceUI();
  });
}

function maybeShowBroadcast(broadcast) {
  if (!broadcast?.text) return;
  const at = Number(broadcast.at || 0);
  if (at <= globalBroadcastDismissedAt) return;
  globalBroadcastDismissedAt = at;
  byId("teacherMessageText") && (byId("teacherMessageText").innerText = broadcast.text);
  showModal("messageModal");
}

function listenToBroadcasts() {
  if (!cityKey) return;
  if (unsubscribeBroadcastListener) unsubscribeBroadcastListener();
  unsubscribeBroadcastListener = onValue(ref(db, `control/broadcasts/${cityKey}`), (snapshot) => {
    if (!snapshot.exists()) return;
    maybeShowBroadcast(snapshot.val());
  });
}

function listenToTeacherCurrentCity() {
  if (unsubscribeTeacherCityListener) unsubscribeTeacherCityListener();
  unsubscribeTeacherCityListener = onValue(ref(db, "control/currentCity"), async (snapshot) => {
    currentTeacherCity = snapshot.val() || null;
    if (groupData?.cityKey) return;
    if (!groupId && currentTeacherCity) await reloadCityContext(currentTeacherCity);
  });
}

async function reloadCityContext(newCityKey) {
  if (!newCityKey) return;
  cityKey = newCityKey;
  localStorage.setItem("activeCityKey", cityKey);
  await loadCityAndGameType();
  await applyTheme();
  listenToBroadcasts();

  if (!map) {
    initMap();
  } else {
    map.setView(cityData?.center || [50.85, 4.35], 16);
  }

  updateStudentTopUI();
  updateCheckpointVisuals();
  updateArrowToTarget();
  updateInventoryTexts();
}

async function processIncomingCommands() {
  if (!groupData || !groupId) return;
  if (groupData.commandMessageAt && groupData.commandMessageAt > lastProcessedCommandTimestamps.commandMessageAt) {
    lastProcessedCommandTimestamps.commandMessageAt = groupData.commandMessageAt;
    if (groupData.commandMessageText) {
      byId("teacherMessageText") && (byId("teacherMessageText").innerText = groupData.commandMessageText);
      showModal("messageModal");
    }
  }
  if (groupData.commandPointsAt && groupData.commandPointsAt > lastProcessedCommandTimestamps.commandPointsAt) {
    lastProcessedCommandTimestamps.commandPointsAt = groupData.commandPointsAt;
    await update(ref(db, `groups/${groupId}`), { score: Number(groupData.score || 0) + Number(groupData.commandPointsValue || 0) });
  }
  if (groupData.commandResetAt && groupData.commandResetAt > lastProcessedCommandTimestamps.commandResetAt) {
    lastProcessedCommandTimestamps.commandResetAt = groupData.commandResetAt;
    await hardResetCurrentGroup();
    return;
  }
  if (groupData.commandNextAt && groupData.commandNextAt > lastProcessedCommandTimestamps.commandNextAt) {
    lastProcessedCommandTimestamps.commandNextAt = groupData.commandNextAt;
    await advanceToNextCheckpoint();
  }
  await cleanupExpiredEffects();
}

async function hardResetCurrentGroup() {
  if (!groupId) return;
  await update(ref(db, `groups/${groupId}`), {
    score: 0,
    routeIndex: 0,
    checkpoint: checkpoints[0]?.name || "",
    nextCheckpoint: checkpoints[1]?.name || "",
    evidence: [],
    evidenceCount: 0,
    answeredCheckpointIds: [],
    pendingCollectibleCheckpointId: null,
    gatherMode: false,
    finished: false,
    effects: {},
    startedAt: nowMs()
  });
}

async function maybeOpenQuestionFromLocation() {
  if (!groupData || routeCompleted || questionOpen || pendingCollectibleCheckpointId || hasActiveEffect("freeze")) return;
  const cp = getCurrentCheckpoint();
  if (!cp || currentLat == null || currentLng == null || isCurrentCheckpointAnswered()) return;
  if (distanceMeters([currentLat, currentLng], cp.coords) <= Number(cp.radius || 20)) {
    openQuestionForCheckpoint(cp);
  }
}

async function submitCheckpointAnswer() {
  const cp = currentQuestionCheckpoint;
  if (!cp) return;

  const answer = getUserAnswerForCheckpoint(cp);
  const correct = validateCheckpointAnswer(cp, answer);
  const maxTries = Number(cp.maxTries || currentGameType?.rules?.maxTries || 3);

  if (correct) {
    byId("answerFeedback") && (byId("answerFeedback").innerText = "Juist antwoord!");
    await handleCheckpointSolved(cp, true, false);
    return;
  }

  currentTries += 1;
  byId("answerFeedback") && (byId("answerFeedback").innerText = "Nog niet juist.");
  byId("triesFeedback") && (byId("triesFeedback").innerText = `Poging ${currentTries} / ${maxTries}`);

  if (currentTries >= maxTries) {
    await handleCheckpointSolved(cp, false, true);
  }
}

async function handleCheckpointSolved(cp, answeredCorrectly, reachedMaxTries) {
  const cpId = cp.id;
  if (!answeredCheckpointIds.includes(cpId)) answeredCheckpointIds = [...answeredCheckpointIds, cpId];
  const addedScore = answeredCorrectly ? Number(cp.pointsCorrect || 10) : Number(cp.pointsAfterMaxTries || 0);
  await update(ref(db, `groups/${groupId}`), {
    score: Number(groupData.score || 0) + addedScore,
    answeredCheckpointIds,
    evidenceCount: Array.isArray(groupData.evidence) ? groupData.evidence.length : 0
  });

  closeQuestionModal();

  if (!answeredCorrectly) {
    await advanceToNextCheckpoint();
    return;
  }

  if (!shouldGrantCollectible(cp, answeredCorrectly, reachedMaxTries)) {
    await advanceToNextCheckpoint();
    return;
  }

  if (shouldUseSearchChoice(cp)) {
    pendingCollectibleCheckpointId = cp.id;
    await update(ref(db, `groups/${groupId}`), { pendingCollectibleCheckpointId: cp.id });
    updateCheckpointVisuals();
    return;
  }

  if (cp.collectible) {
    await giveCollectibleToGroup(cp.collectible);
  }
  await advanceToNextCheckpoint();
}

async function maybeCheckCollectiblePickup() {
  if (!pendingCollectibleCheckpointId || currentLat == null || currentLng == null) return;
  const cp = checkpoints.find((item) => item.id === pendingCollectibleCheckpointId);
  if (!cp?.collectible) return;
  const coords = getCollectibleCoords(cp);
  if (!coords) return;

  updateCheckpointVisuals();

  if (distanceMeters([currentLat, currentLng], coords) > getRevealDistance(cp)) return;

  const shouldPickup = window.confirm(`Collectible gevonden: ${cp.collectible.name}. Wil je dit item opnemen?`);
  if (!shouldPickup) return;

  await giveCollectibleToGroup(cp.collectible);
  pendingCollectibleCheckpointId = null;
  await update(ref(db, `groups/${groupId}`), { pendingCollectibleCheckpointId: null });
  await advanceToNextCheckpoint();
}

async function advanceToNextCheckpoint() {
  const nextIndex = getCurrentCheckpointIndex() + 1;
  if (nextIndex >= checkpoints.length) {
    routeCompleted = true;
    await update(ref(db, `groups/${groupId}`), {
      gatherMode: true,
      checkpoint: cityData?.gather?.name || "Verzamelpunt",
      nextCheckpoint: "-",
      pendingCollectibleCheckpointId: null
    });
    updateCheckpointVisuals();
    return;
  }

  pendingCollectibleCheckpointId = null;
  await update(ref(db, `groups/${groupId}`), {
    routeIndex: nextIndex,
    checkpoint: checkpoints[nextIndex]?.name || "",
    nextCheckpoint: checkpoints[nextIndex + 1]?.name || cityData?.gather?.name || "Verzamelpunt",
    pendingCollectibleCheckpointId: null
  });
}

function getRemainingTimeMs() {
  const timer = getTimerSettings();
  if (!hasModule("timer") || !gameStartTimestamp) return null;
  if (!["global", "hybrid"].includes(timer.mode || "global")) return null;
  const totalMinutes = Number(timer.totalMinutes || 0);
  if (!totalMinutes) return null;
  return Math.max(0, totalMinutes * 60000 - (nowMs() - gameStartTimestamp));
}

function calculateTimeBonusPoints() {
  const remaining = getRemainingTimeMs();
  if (remaining == null) return 0;
  const pointsPerMinute = Number(getTimerSettings().pointsPerMinuteRemaining || 1);
  return Math.floor((remaining / 60000) * pointsPerMinute);
}

async function maybeCheckGatherCompletion() {
  if (!routeCompleted || !groupData || groupData.finished || currentLat == null || currentLng == null) return;
  if (!cityData?.gather?.coords) return;
  if (distanceMeters([currentLat, currentLng], cityData.gather.coords) > Number(cityData.gather.radius || 40)) return;
  const finishTimeMs = gameStartTimestamp ? nowMs() - gameStartTimestamp : 0;
  const timeBonus = calculateTimeBonusPoints();
  await update(ref(db, `groups/${groupId}`), {
    finished: true,
    finishedAt: nowMs(),
    finishTimeMs,
    score: Number(groupData.score || 0) + timeBonus
  });
  alert(`Proficiat! Jullie zijn klaar.\nTijd: ${formatDuration(finishTimeMs)}`);
}

function isUsableEvidenceItem(item) {
  return !!item?.actionType && !item.used;
}

async function giveCollectibleToGroup(rawCollectible) {
  if (!groupId || !rawCollectible) return;
  const evidence = Array.isArray(groupData?.evidence) ? [...groupData.evidence] : [];
  const item = buildNormalizedItem({ ...rawCollectible, id: `item_${Date.now()}_${Math.floor(Math.random() * 10000)}` });
  evidence.push(item);
  await update(ref(db, `groups/${groupId}`), { evidence, evidenceCount: evidence.length });
  if (byId("foundEvidenceIcon")) byId("foundEvidenceIcon").innerText = item.icon || "✨";
  if (byId("foundEvidenceName")) byId("foundEvidenceName").innerText = item.name || "Item";
  if (byId("foundEvidenceDescription")) byId("foundEvidenceDescription").innerText = item.description || "Item toegevoegd.";
  showModal("evidenceFoundModal");
}

function findNearbyTargetGroup(range = 25) {
  if (currentLat == null || currentLng == null) return null;
  let winner = null;
  let best = Infinity;
  Object.entries(groupsCache || {}).forEach(([id, group]) => {
    if (!group || id === groupId || group.cityKey !== cityKey || group.finished) return;
    if (typeof group.lat !== "number" || typeof group.lng !== "number") return;
    const dist = distanceMeters([currentLat, currentLng], [group.lat, group.lng]);
    if (dist <= range && dist < best) {
      winner = { id, data: group, distance: dist };
      best = dist;
    }
  });
  return winner;
}

async function markEvidenceItemUsed(index) {
  const evidence = Array.isArray(groupData?.evidence) ? [...groupData.evidence] : [];
  evidence.splice(index, 1);
  await update(ref(db, `groups/${groupId}`), { evidence, evidenceCount: evidence.length });
}

function targetHasShield(target) {
  return Object.values(target?.effects || {}).some((effect) => effect?.type === "shield" && (!effect.endsAt || effect.endsAt > nowMs()));
}

async function applyEffectToTargetGroup(targetId, item) {
  const targetSnap = await get(ref(db, `groups/${targetId}`));
  const sourceSnap = await get(ref(db, `groups/${groupId}`));
  if (!targetSnap.exists() || !sourceSnap.exists()) return;
  const target = targetSnap.val();
  const source = sourceSnap.val();
  const effectId = `effect_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const endsAt = nowMs() + Number(item.actionDuration || 40) * 1000;

  if (targetHasShield(target) && item.actionType !== "cleanse") {
    alert("Doelgroep is beschermd door een schild.");
    return false;
  }

  if (item.actionType === "score_steal") {
    const amount = Number(item.actionValue || 15);
    await update(ref(db, `groups/${targetId}`), { score: Math.max(0, Number(target.score || 0) - amount) });
    await update(ref(db, `groups/${groupId}`), { score: Number(source.score || 0) + amount });
    return true;
  }

  const effectMap = {
    map_blur: "map_blur",
    compass_off: "compass_off",
    freeze: "freeze",
    shield: "shield",
    no_map: "no_map"
  };

  const type = effectMap[item.actionType];
  if (!type) return false;

  const realTarget = item.actionType === "shield" ? groupId : targetId;
  await set(ref(db, `groups/${realTarget}/effects/${effectId}`), {
    type,
    startedAt: nowMs(),
    endsAt,
    sourceGroupId: groupId
  });
  return true;
}

async function useEvidenceItem(index) {
  const evidence = Array.isArray(groupData?.evidence) ? groupData.evidence : [];
  const item = evidence[index];
  if (!item || !isUsableEvidenceItem(item)) return;

  if (item.actionType === "shield") {
    const ok = confirm(`Gebruik "${item.name}" op je eigen groep?`);
    if (!ok) return;
    const success = await applyEffectToTargetGroup(groupId, item);
    if (success) await markEvidenceItemUsed(index);
    return;
  }

  const target = findNearbyTargetGroup(item.actionRange || 25);
  if (!target) {
    alert("Geen andere groep binnen bereik.");
    return;
  }

  const ok = confirm(`Gebruik "${item.name}" op groep ${target.data.groupNumber || "?"}: ${target.data.groupName || "-"}?`);
  if (!ok) return;
  const success = await applyEffectToTargetGroup(target.id, item);
  if (success) await markEvidenceItemUsed(index);
}

function renderEvidenceDetail(index) {
  const items = Array.isArray(groupData?.evidence) ? groupData.evidence : [];
  const item = items[index];
  if (!item) {
    byId("evidenceDetailIcon") && (byId("evidenceDetailIcon").innerText = "❓");
    byId("evidenceDetailName") && (byId("evidenceDetailName").innerText = "Nog geen item geselecteerd");
    byId("evidenceDetailDescription") && (byId("evidenceDetailDescription").innerText = "Klik op een item om meer informatie te bekijken.");
    byId("evidenceDetailStatus") && (byId("evidenceDetailStatus").innerText = "Status: onbekend");
    return;
  }

  byId("evidenceDetailIcon") && (byId("evidenceDetailIcon").innerText = item.icon || "✨");
  byId("evidenceDetailName") && (byId("evidenceDetailName").innerText = item.name || "Item");
  byId("evidenceDetailDescription") && (byId("evidenceDetailDescription").innerText = item.description || "Geen beschrijving.");
  byId("evidenceDetailStatus") && (byId("evidenceDetailStatus").innerText = isUsableEvidenceItem(item) ? `Status: bruikbaar item, bereik ${item.actionRange || 25} meter` : "Status: verzameld");

  const detailCard = qs(".evidence-detail-card");
  if (!detailCard) return;
  detailCard.querySelector(".evidence-action-block")?.remove();

  if (isUsableEvidenceItem(item)) {
    const block = document.createElement("div");
    block.className = "evidence-action-block";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerText = "Gebruik item";
    btn.addEventListener("click", () => useEvidenceItem(index));
    block.appendChild(btn);
    detailCard.appendChild(block);
  }
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
  quickBar?.classList.toggle("hidden", !items.length);

  if (quickSlots) {
    quickSlots.innerHTML = items.slice(0, 4).map((item, i) => `<button type="button" data-quick-item="${i}">${item.icon || "✨"} ${item.name || "Item"}</button>`).join("");
    quickSlots.querySelectorAll("[data-quick-item]").forEach((btn) => btn.addEventListener("click", () => {
      showModal("evidenceModal");
      renderEvidenceDetail(Number(btn.getAttribute("data-quick-item")));
    }));
  }

  if (evidenceGrid) {
    evidenceGrid.innerHTML = items.length
      ? items.map((item, i) => `<button type="button" class="evidence-slot" data-evidence-item="${i}"><div class="evidence-slot-icon">${item.icon || "✨"}</div><div class="evidence-slot-name">${item.name || "Item"}</div></button>`).join("")
      : "<p>Jullie hebben nog geen items verzameld.</p>";

    evidenceGrid.querySelectorAll("[data-evidence-item]").forEach((btn) => {
      btn.addEventListener("click", () => {
        renderEvidenceDetail(Number(btn.getAttribute("data-evidence-item")));
      });
    });
  }
}

async function syncGroupPosition(force = false) {
  if (!groupId || currentLat == null || currentLng == null) return;
  const now = nowMs();
  if (!force && now - lastPositionSyncAt < 1500) return;
  lastPositionSyncAt = now;
  await update(ref(db, `groups/${groupId}`), {
    lat: currentLat,
    lng: currentLng,
    lastUpdated: new Date().toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  });
}

function startLocationWatch() {
  if (watchId != null || !navigator.geolocation) return;
  watchId = navigator.geolocation.watchPosition(async (position) => {
    currentLat = position.coords.latitude;
    currentLng = position.coords.longitude;
    if (Number.isFinite(position.coords.heading)) currentHeading = position.coords.heading;

    updateGroupMarker();
    updateStudentTopUI();
    updateArrowToTarget();
    updateCheckpointVisuals();
    updateMapVisibilityFromEffects();

    await syncGroupPosition();
    await maybeOpenQuestionFromLocation();
    await maybeCheckCollectiblePickup();
    await maybeCheckGatherCompletion();
  }, console.error, { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 });
}

async function bootstrap() {
  if (appReady) return;
  appReady = true;

  parseUrlParams();
  if (cityKey) restoreGroupIdForCity();

  listenToTeacherCurrentCity();
  await reloadCityContext(cityKey || currentTeacherCity || "durbuy");
  listenToAllGroups();

  if (groupId) {
    listenToGroup();
    startLocationWatch();
    byId("loginCard")?.classList.add("hidden");
    byId("gameArea")?.classList.remove("hidden");
  }

  byId("startButton")?.addEventListener("click", async () => {
    await createGroup();
    listenToGroup();
    startLocationWatch();
  });
  byId("submitAnswerButton")?.addEventListener("click", submitCheckpointAnswer);
  byId("closeIntroButton")?.addEventListener("click", () => hideModal("introModal"));
  byId("closeMessageButton")?.addEventListener("click", () => hideModal("messageModal"));
  byId("openEvidenceButton")?.addEventListener("click", () => {
    updateEvidenceUI();
    renderEvidenceDetail(0);
    showModal("evidenceModal");
  });
  byId("closeEvidenceButton")?.addEventListener("click", () => hideModal("evidenceModal"));
  byId("closeFoundEvidenceButton")?.addEventListener("click", () => hideModal("evidenceFoundModal"));

  byId("toggleAudioButton")?.addEventListener("click", () => {
    const muted = byId("toggleAudioButton").innerText.includes("uit");
    document.querySelectorAll("audio, video").forEach((el) => { el.muted = muted; if (muted) el.pause(); });
    byId("toggleAudioButton").innerText = muted ? "🔊 Geluid aan" : "🔇 Geluid uit";
  });

  updateInventoryTexts();
}

bootstrap().catch((error) => {
  console.error(error);
  alert("Er is een fout opgetreden bij het laden van het spel.");
});
