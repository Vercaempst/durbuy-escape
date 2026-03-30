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
let cityControlReady = false;

let map = null;
let groupMarker = null;
let checkpointMarker = null;
let gatherMarker = null;
let collectibleMarker = null;
let collectibleSearchCircle = null;
let checkpointRadiusCircle = null;

let watchId = null;
let currentLat = null;
let currentLng = null;
let currentHeading = null;

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
let lastProcessedCommandTimestamps = {
  commandMessageAt: 0,
  commandPointsAt: 0,
  commandResetAt: 0,
  commandNextAt: 0
};
let gameStartTimestamp = null;

/* =========================================================
   DOM HELPERS
========================================================= */
function byId(id) {
  return document.getElementById(id);
}

function qs(selector) {
  return document.querySelector(selector);
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

/* =========================================================
   DEFAULTS / HELPERS
========================================================= */
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
  return hasModule("inventory") || hasModule("evidenceBook") || hasModule("collectibles") || hasModule("usableItems");
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

function nowMs() {
  return Date.now();
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

function getCheckpointEffectiveId(cp, index) {
  return cp?.id || `cp_${index}`;
}

function isCurrentCheckpointAnswered() {
  return answeredCheckpointIds.includes(getCurrentCheckpointId());
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

function checkpointUnlockChoiceEnabled(cp) {
  return !!cp?.collectible;
}

function shouldUseSearchChoice(cp) {
  if (!cp?.collectible) return false;
  const setting = cp.collectibleUnlockMode || currentGameType?.collectibles?.unlockCondition || "afterCorrect";
  return (
    setting === "searchZoneAfterCorrect" ||
    setting === "searchZoneAfterCorrectOrMaxTries"
  );
}

/* =========================================================
   CITY / GAMETYPE LOAD
========================================================= */
async function loadCityAndGameType() {
  const citySnap = await get(ref(db, `cities/${cityKey}`));
  const cityFallback = null;

  if (citySnap.exists()) {
    cityData = citySnap.val();
  } else {
    cityData = cityFallback || {
      name: cityKey,
      center: [50.85, 4.35],
      gather: {
        name: "Verzamelpunt",
        coords: [50.85, 4.35],
        radius: 40
      },
      gameTypeId: ""
    };
  }

  const checkpointsSnap = await get(ref(db, `cityData/${cityKey}/checkpoints`));
  checkpoints = checkpointsSnap.exists() ? (checkpointsSnap.val() || []) : [];

  if (!Array.isArray(checkpoints)) checkpoints = [];

  checkpoints = checkpoints.map((cp, index) => ({
    ...cp,
    id: getCheckpointEffectiveId(cp, index)
  }));

  if (cityData?.gameTypeId) {
    const gameTypeSnap = await get(ref(db, `speltypes/${cityData.gameTypeId}`));
    currentGameType = gameTypeSnap.exists() ? gameTypeSnap.val() : null;
  } else {
    currentGameType = null;
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

  if (cityData?.gather?.coords) {
    gatherMarker = L.marker(cityData.gather.coords).addTo(map).bindPopup(cityData.gather.name || "Verzamelpunt");
  }
}

function getCollectibleCoords(cp) {
  if (Array.isArray(cp.collectibleCoords)) return cp.collectibleCoords;
  return cp.coords;
}

function updateCheckpointVisuals() {
  if (!map) return;

  if (checkpointMarker) map.removeLayer(checkpointMarker);
  if (checkpointRadiusCircle) map.removeLayer(checkpointRadiusCircle);
  if (collectibleMarker) map.removeLayer(collectibleMarker);
  if (collectibleSearchCircle) map.removeLayer(collectibleSearchCircle);

  checkpointMarker = null;
  checkpointRadiusCircle = null;
  collectibleMarker = null;
  collectibleSearchCircle = null;

  if (routeCompleted) {
    if (cityData?.gather?.coords) {
      checkpointMarker = L.marker(cityData.gather.coords).addTo(map).bindPopup(cityData.gather.name || "Verzamelpunt");
      checkpointRadiusCircle = L.circle(cityData.gather.coords, {
        radius: Number(cityData?.gather?.radius || 40),
        color: "#22c55e",
        fillColor: "#22c55e",
        fillOpacity: 0.08
      }).addTo(map);
    }
    return;
  }

  const cp = getCurrentCheckpoint();
  if (!cp || !Array.isArray(cp.coords)) return;

  checkpointMarker = L.marker(cp.coords).addTo(map).bindPopup(cp.name || "Checkpoint");
  checkpointRadiusCircle = L.circle(cp.coords, {
    radius: Number(cp.radius || 20),
    color: "#3b82f6",
    fillColor: "#3b82f6",
    fillOpacity: 0.08
  }).addTo(map);

  const isPendingSearch = pendingCollectibleCheckpointId === cp.id;
  if (isPendingSearch && cp.collectible) {
    const searchCoords = getCollectibleCoords(cp);
    const searchRadius =
      Number(cp.collectibleSearchRadius || cp.collectible?.searchRadius || currentGameType?.collectibles?.searchRadius || 30);
    const revealDistance =
      Number(cp.collectibleRevealDistance || cp.collectible?.revealDistance || currentGameType?.collectibles?.revealDistance || 15);

    collectibleSearchCircle = L.circle(searchCoords, {
      radius: searchRadius,
      className: "collectible-search-zone"
    }).addTo(map);

    if (currentLat != null && currentLng != null) {
      const dist = distanceMeters([currentLat, currentLng], searchCoords);
      if (dist <= revealDistance) {
        collectibleMarker = L.marker(searchCoords).addTo(map).bindPopup(cp.collectible.name || "Collectible");
      }
    }
  }
}

function updateGroupMarker() {
  if (!map || currentLat == null || currentLng == null) return;

  if (!groupMarker) {
    groupMarker = L.circleMarker([currentLat, currentLng], {
      radius: 9,
      color: "#2563eb",
      fillColor: "#60a5fa",
      fillOpacity: 0.9
    }).addTo(map);
  } else {
    groupMarker.setLatLng([currentLat, currentLng]);
  }
}

function updateMapVisibilityFromEffects() {
  const mapEl = byId("map");
  if (!mapEl) return;

  const activeEffects = getActiveEffects();
  mapEl.style.filter = "";
  mapEl.style.opacity = "";

  if (activeEffects.some(e => e.type === "map_blur")) {
    mapEl.style.filter = "blur(7px)";
  }

  if (activeEffects.some(e => e.type === "no_map")) {
    mapEl.style.opacity = "0.15";
  }
}

/* =========================================================
   UI
========================================================= */
function applyTheme() {
  document.title = cityData?.name ? `${cityData.name} - City Escape` : "City Escape";
  byId("appTitle") && (byId("appTitle").innerText = document.title);
}

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

function updateStudentTopUI() {
  if (!groupData) return;

  byId("teamDisplay").innerText = `Groep ${groupData.groupNumber || "?"}: ${groupData.groupName || ""}`;

  const cp = routeCompleted ? null : getCurrentCheckpoint();
  byId("missionTargetTitle").innerText = routeCompleted
    ? (cityData?.gather?.name || "Verzamelpunt")
    : (cp?.name || "Checkpoint");

  if (routeCompleted) {
    const gatherCoords = cityData?.gather?.coords;
    const dist = gatherCoords && currentLat != null && currentLng != null
      ? distanceMeters([currentLat, currentLng], gatherCoords)
      : null;
    byId("status").innerText = `Nog ${formatMeters(dist)} tot verzamelpunt.`;
  } else {
    const target = cp?.coords;
    const dist = target && currentLat != null && currentLng != null
      ? distanceMeters([currentLat, currentLng], target)
      : null;
    byId("status").innerText = `Nog ${formatMeters(dist)} tot doel.`;
  }

  byId("scoreText").innerText = String(groupData.score || 0);

  const progressCurrent = Math.min(getCurrentCheckpointIndex() + (routeCompleted ? 1 : 0), checkpoints.length);
  byId("progressText").innerText = checkpoints.length
    ? `Checkpoint ${Math.min(getCurrentCheckpointIndex() + 1, checkpoints.length)} / ${checkpoints.length}`
    : "Checkpoint 0 / 0";

  const progressPercent = checkpoints.length
    ? Math.round((answeredCheckpointIds.length / checkpoints.length) * 100)
    : 0;
  byId("progressBarFill").style.width = `${progressPercent}%`;

  updateGPSStatus();
  updateInventoryTexts();
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

function updateArrowToTarget() {
  const arrow = byId("arrow");
  if (!arrow) return;

  const activeEffects = getActiveEffects();
  if (activeEffects.some(e => e.type === "compass_off")) {
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

  const activeGroups = Object.entries(groupsCache)
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

function closeMessageModal() {
  hideModal("messageModal");
}

function showIntroIfNeeded() {
  if (introShown) return;
  if (!groupData) return;

  const modules = getModules();
  if (!modules.story) return;

  const title = byId("introTitle");
  const text = byId("introText");

  if (title) title.innerText = cityData?.name ? `Welkom in ${cityData.name}` : "Welkom";
  if (text) {
    text.innerText =
      currentGameType?.description ||
      "Jullie gaan op pad langs checkpoints. Los vragen op, verzamel items en bereik het verzamelpunt.";
  }

  showModal("introModal");
  introShown = true;
}

function showTeacherMessage(text) {
  const el = byId("teacherMessageText");
  if (el) el.innerText = text || "";
  showModal("messageModal");
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
  container.innerHTML = `
    <p class="small-note">Voor matching gebruiken we hier eenvoudige controle via tekstinvoer. Vul de koppels in zoals in de admin ingevoerd.</p>
  `;
}

function renderImagePuzzleTask(cp) {
  const wrap = byId("taskImagePuzzleWrapper");
  const grid = byId("puzzleGrid");
  if (!wrap || !grid) return;

  wrap.classList.remove("hidden-task");
  grid.innerHTML = `<p>Afbeeldingspuzzel is actief. Gebruik hiervoor best een eenvoudige inhoudelijke controle of laat dit checkpoint voorlopig als visuele opdracht dienen.</p>`;
}

function renderPhotoTask() {
  const wrap = byId("taskPhotoWrapper");
  if (wrap) wrap.classList.remove("hidden-task");
}

function resetQuestionTaskWrappers() {
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

  byId("modalTitle").innerText = cp.name || "Checkpoint";
  byId("modalQuestion").innerText = cp.question || "Vraag";
  byId("answerFeedback").innerText = "";
  byId("triesFeedback").innerText = "";

  resetQuestionTaskWrappers();

  const storyEl = byId("modalStory");
  if (storyEl) {
    if (cp.story) {
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
    input.style.display = (cp.taskType === "text" || cp.taskType === "riddle" || cp.taskType === "matching" || cp.taskType === "photo")
      ? ""
      : "none";
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
    if (cp.image) {
      image.src = cp.image;
      image.classList.remove("hidden");
    } else {
      image.src = "";
      image.classList.add("hidden");
    }
  }

  if (cp.taskType === "multipleChoice") renderMultipleChoiceOptions(cp);
  if (cp.taskType === "matching") renderMatchingTask(cp);
  if (cp.taskType === "imagePuzzle") renderImagePuzzleTask(cp);
  if (cp.taskType === "photo") renderPhotoTask();

  showModal("questionModal");
}

function getUserAnswerForCheckpoint(cp) {
  if (!cp) return null;

  if (cp.taskType === "multipleChoice") {
    return currentSelectedMultipleChoice;
  }

  return (byId("modalAnswerInput")?.value || "").trim();
}

function validateCheckpointAnswer(cp, userAnswer) {
  if (!cp) return false;

  if (cp.taskType === "multipleChoice") {
    return Number(userAnswer) === Number(cp.correctOption);
  }

  if (cp.taskType === "matching") {
    const correctText = Object.entries(cp.correctPairs || {})
      .map(([k, v]) => `${k}=${v}`)
      .join("\n")
      .trim()
      .toLowerCase();

    return String(userAnswer || "").trim().toLowerCase() === correctText;
  }

  if (cp.taskType === "photo") {
    return true;
  }

  const normalized = String(userAnswer || "").trim().toLowerCase();
  return (cp.answers || []).some((ans) => String(ans).trim().toLowerCase() === normalized);
}

/* =========================================================
   GROUP CREATION / SYNC
========================================================= */
async function getNextGroupNumber() {
  const counterRef = ref(db, `meta/groupCounters/${cityKey}`);
  const result = await runTransaction(counterRef, (current) => (current || 0) + 1);
  return result.snapshot.val();
}

async function createGroup() {
  const groupName = (byId("groupName")?.value || "").trim();
  const groupMembers = (byId("groupMembers")?.value || "").trim();

  if (!groupName) {
    byId("loginFeedback").innerText = "Vul eerst een groepsnaam in.";
    return;
  }

  // Als teacher een stad actief gezet heeft, gebruik die.
  if (currentTeacherCity && !groupId) {
    await reloadCityContext(currentTeacherCity);
  }

  if (!cityKey) {
    byId("loginFeedback").innerText = "Er is nog geen actieve stad gekozen.";
    return;
  }

  const number = await getNextGroupNumber();
  const newRef = push(ref(db, "groups"));

  const initialGroup = {
    cityKey: cityKey,
    groupName,
    groupMembers,
    groupNumber: number,
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
    createdAt: nowMs(),
    startedAt: nowMs(),
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
}

function listenToGroup() {
  if (!groupId) return;

  onValue(ref(db, `groups/${groupId}`), async (snapshot) => {
    if (!snapshot.exists()) return;

    groupData = snapshot.val() || {};

    if (groupData.cityKey && groupData.cityKey !== cityKey) {
      await reloadCityContext(groupData.cityKey);
    }



    
    answeredCheckpointIds = Array.isArray(groupData.answeredCheckpointIds) ? groupData.answeredCheckpointIds : [];
    pendingCollectibleCheckpointId = groupData.pendingCollectibleCheckpointId || null;
    routeCompleted = !!groupData.gatherMode || !!groupData.finished;
    gameStartTimestamp = groupData.startedAt || groupData.createdAt || null;

    byId("loginCard").classList.add("hidden");
    byId("gameArea").classList.remove("hidden");

    updateStudentTopUI();
    updateRankingUI();
    updateCheckpointVisuals();
    updateGroupMarker();
    updateArrowToTarget();
    updateEvidenceUI();
    updateMapVisibilityFromEffects();
    showIntroIfNeeded();
    processIncomingCommands();
    maybeShowBroadcast();
    maybeOpenQuestionFromLocation();
    maybeCheckCollectiblePickup();
    maybeCheckGatherCompletion();
  });
}

function listenToAllGroups() {
  onValue(ref(db, "groups"), (snapshot) => {
    groupsCache = snapshot.val() || {};
    updateRankingUI();
  });
}

function listenToBroadcasts() {
  onValue(ref(db, `control/broadcasts/${cityKey}`), (snapshot) => {
    if (!snapshot.exists()) return;
    maybeShowBroadcast(snapshot.val());
  });
}

function maybeShowBroadcast(broadcast = null) {
  if (!broadcast) return;
  const at = Number(broadcast.at || 0);
  if (at <= globalBroadcastDismissedAt) return;
  if (!broadcast.text) return;

  globalBroadcastDismissedAt = at;
  showTeacherMessage(broadcast.text);
}

async function reloadCityContext(newCityKey, options = {}) {
  const { preserveMapView = false } = options;

  if (!newCityKey) return;
  if (cityKey === newCityKey && cityData && checkpoints.length) return;

  cityKey = newCityKey;
  localStorage.setItem("activeCityKey", cityKey);

  await loadCityAndGameType();

  if (!map) {
    initMap();
  } else if (!preserveMapView) {
    const center = cityData?.center || [50.85, 4.35];
    map.setView(center, 16);

    if (gatherMarker) {
      map.removeLayer(gatherMarker);
      gatherMarker = null;
    }

    if (cityData?.gather?.coords) {
      gatherMarker = L.marker(cityData.gather.coords)
        .addTo(map)
        .bindPopup(cityData.gather.name || "Verzamelpunt");
    }
  }

  updateCheckpointVisuals();
  updateStudentTopUI();
  updateInventoryTexts();
  updateRankingUI();
  updateArrowToTarget();
  applyTheme();
}

function listenToTeacherCurrentCity() {
  onValue(ref(db, "control/currentCity"), async (snapshot) => {
    currentTeacherCity = snapshot.val() || null;
    cityControlReady = true;

    // Als groep al bestaat en een cityKey heeft, dan is die leidend.
    if (groupData?.cityKey) {
      if (cityKey !== groupData.cityKey) {
        await reloadCityContext(groupData.cityKey);
      }
      return;
    }

    // Als er al een groupId bestaat maar groupData nog niet geladen is,
    // wacht dan tot de groep geladen is.
    if (groupId && !groupData) return;

    // Nog geen groep gestart? Volg dan de teacher-stad.
    if (!groupId && currentTeacherCity) {
      await reloadCityContext(currentTeacherCity);
    }
  });
}

/* =========================================================
   EFFECTS / COMMANDS
========================================================= */
function getActiveEffects() {
  const effectsObj = groupData?.effects || {};
  const all = Object.values(effectsObj);
  const now = nowMs();
  return all.filter((e) => !e.endsAt || e.endsAt > now);
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

async function processIncomingCommands() {
  if (!groupData || !groupId) return;

  if (groupData.commandMessageAt && groupData.commandMessageAt > lastProcessedCommandTimestamps.commandMessageAt) {
    lastProcessedCommandTimestamps.commandMessageAt = groupData.commandMessageAt;
    if (groupData.commandMessageText) showTeacherMessage(groupData.commandMessageText);
  }

  if (groupData.commandPointsAt && groupData.commandPointsAt > lastProcessedCommandTimestamps.commandPointsAt) {
    lastProcessedCommandTimestamps.commandPointsAt = groupData.commandPointsAt;
    const value = Number(groupData.commandPointsValue || 0);
    if (value !== 0) {
      const newScore = Number(groupData.score || 0) + value;
      await update(ref(db, `groups/${groupId}`), {
        score: newScore
      });
    }
  }

  if (groupData.commandResetAt && groupData.commandResetAt > lastProcessedCommandTimestamps.commandResetAt) {
    lastProcessedCommandTimestamps.commandResetAt = groupData.commandResetAt;
    await hardResetCurrentGroup();
    return;
  }

  if (groupData.commandNextAt && groupData.commandNextAt > lastProcessedCommandTimestamps.commandNextAt) {
    lastProcessedCommandTimestamps.commandNextAt = groupData.commandNextAt;
    await advanceToNextCheckpoint(false);
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
    finishedAt: null,
    finishTimeMs: null,
    effects: {},
    startedAt: nowMs()
  });

  routeCompleted = false;
  answeredCheckpointIds = [];
  pendingCollectibleCheckpointId = null;
  gameStartTimestamp = nowMs();
  closeQuestionModal();
  hideModal("introModal");
  hideModal("evidenceModal");
  hideModal("evidenceFoundModal");
  introShown = false;
}

/* =========================================================
   QUESTION / CHECKPOINT FLOW
========================================================= */
async function maybeOpenQuestionFromLocation() {
  if (!groupData || routeCompleted) return;
  if (questionOpen) return;
  if (pendingCollectibleCheckpointId) return;

  const activeEffects = getActiveEffects();
  if (activeEffects.some(e => e.type === "freeze")) return;

  const cp = getCurrentCheckpoint();
  if (!cp || !Array.isArray(cp.coords)) return;

  if (currentLat == null || currentLng == null) return;

  const dist = distanceMeters([currentLat, currentLng], cp.coords);
  const within = dist <= Number(cp.radius || 20);

  if (within && !isCurrentCheckpointAnswered()) {
    openQuestionForCheckpoint(cp);
  }
}

async function submitCheckpointAnswer() {
  const cp = currentQuestionCheckpoint;
  if (!cp) return;

  const answer = getUserAnswerForCheckpoint(cp);
  const correct = validateCheckpointAnswer(cp, answer);

  if (correct) {
    byId("answerFeedback").innerText = "Juist antwoord!";
    flashSuccess();
    await handleCheckpointSolved(cp, true);
    return;
  }

  currentTries += 1;
  byId("answerFeedback").innerText = "Nog niet juist.";
  byId("triesFeedback").innerText = `Poging ${currentTries} / ${Number(currentGameType?.rules?.maxTries || 3)}`;
  showErrorShake();

  const maxTries = Number(currentGameType?.rules?.maxTries || cp.maxTries || 3);
  if (currentTries >= maxTries) {
    await handleCheckpointSolved(cp, false);
  }
}

async function handleCheckpointSolved(cp, answeredCorrectly) {
  const cpId = cp.id;

  if (!answeredCheckpointIds.includes(cpId)) {
    answeredCheckpointIds = [...answeredCheckpointIds, cpId];
  }

  let addedScore = 0;
  if (answeredCorrectly) {
    addedScore = Number(cp.pointsCorrect || 10);
  } else {
    addedScore = Number(cp.pointsAfterMaxTries || 0);
  }

  const newScore = Number(groupData.score || 0) + addedScore;

  const baseUpdate = {
    score: newScore,
    answeredCheckpointIds,
    evidenceCount: (groupData.evidence || []).length
  };

  await update(ref(db, `groups/${groupId}`), baseUpdate);

  closeQuestionModal();

  if (checkpointUnlockChoiceEnabled(cp)) {
    await showCheckpointRewardChoice(cp, answeredCorrectly);
  } else {
    await advanceToNextCheckpoint(false);
  }
}

async function showCheckpointRewardChoice(cp, answeredCorrectly) {
  const wantsSearchZone = shouldUseSearchChoice(cp);
  const canCollectible = !!cp.collectible;

  if (!canCollectible) {
    await advanceToNextCheckpoint(false);
    return;
  }

  const choice = window.confirm(
    wantsSearchZone
      ? "Wil je nu het collectible zoeken? Kies OK om te zoeken, Annuleren om meteen naar het volgende checkpoint te gaan."
      : "Wil je het collectible ontvangen? Kies OK voor het collectible, Annuleren om meteen naar het volgende checkpoint te gaan."
  );

  if (choice) {
    if (wantsSearchZone) {
      pendingCollectibleCheckpointId = cp.id;
      await update(ref(db, `groups/${groupId}`), {
        pendingCollectibleCheckpointId: cp.id
      });
      updateCheckpointVisuals();
    } else {
      await giveCollectibleToGroup(cp.collectible);
      await advanceToNextCheckpoint(false);
    }
  } else {
    await advanceToNextCheckpoint(false);
  }
}

async function maybeCheckCollectiblePickup() {
  if (!groupData || !pendingCollectibleCheckpointId) return;
  if (currentLat == null || currentLng == null) return;

  const cp = checkpoints.find(c => c.id === pendingCollectibleCheckpointId);
  if (!cp || !cp.collectible) return;

  const collectibleCoords = getCollectibleCoords(cp);
  const revealDistance =
    Number(cp.collectibleRevealDistance || cp.collectible?.revealDistance || currentGameType?.collectibles?.revealDistance || 15);

  const dist = distanceMeters([currentLat, currentLng], collectibleCoords);

  updateCheckpointVisuals();

  if (dist <= revealDistance) {
    const shouldPickup = window.confirm(`Collectible gevonden: ${cp.collectible.name}. Wil je dit item opnemen?`);
    if (!shouldPickup) return;

    await giveCollectibleToGroup(cp.collectible);

    pendingCollectibleCheckpointId = null;
    await update(ref(db, `groups/${groupId}`), {
      pendingCollectibleCheckpointId: null
    });

    await advanceToNextCheckpoint(false);
  }
}

async function advanceToNextCheckpoint(force = false) {
  const currentIndex = getCurrentCheckpointIndex();
  const nextIndex = currentIndex + 1;

  if (nextIndex >= checkpoints.length) {
    routeCompleted = true;
    await update(ref(db, `groups/${groupId}`), {
      gatherMode: true,
      checkpoint: cityData?.gather?.name || "Verzamelpunt",
      nextCheckpoint: "-"
    });
    updateCheckpointVisuals();
    updateStudentTopUI();
    return;
  }

  await update(ref(db, `groups/${groupId}`), {
    routeIndex: nextIndex,
    checkpoint: checkpoints[nextIndex]?.name || "",
    nextCheckpoint: checkpoints[nextIndex + 1]?.name || (cityData?.gather?.name || "Verzamelpunt"),
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
  const within = dist <= Number(cityData?.gather?.radius || 40);

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
function buildNormalizedItem(item) {
  if (!item) return null;
  return {
    id: item.id || `item_${Date.now()}`,
    name: item.name || "Item",
    icon: item.icon || "❓",
    description: item.description || "",
    lockedName: item.lockedName || "Onbekend item",
    lockedIcon: item.lockedIcon || "❓",
    actionType: item.actionType || null,
    actionRange: Number(item.actionRange || 25),
    actionDuration: Number(item.actionDuration || 30),
    actionValue: Number(item.actionValue || 15),
    targetMode: item.targetMode || "enemy",
    used: !!item.used
  };
}

function isUsableEvidenceItem(item) {
  return !!item && !!item.actionType && !item.used;
}

async function giveCollectibleToGroup(rawCollectible) {
  if (!groupId || !rawCollectible) return;

  const currentItems = Array.isArray(groupData.evidence) ? groupData.evidence : [];
  const newItem = buildNormalizedItem({
    ...rawCollectible,
    id: `item_${Date.now()}_${Math.floor(Math.random() * 10000)}`
  });

  const newItems = [...currentItems, newItem];

  await update(ref(db, `groups/${groupId}`), {
    evidence: newItems,
    evidenceCount: newItems.length
  });

  showFoundEvidenceModal(newItem);
}

function showFoundEvidenceModal(item) {
  byId("foundEvidenceIcon").innerText = item.icon || "✨";
  byId("foundEvidenceName").innerText = item.name || "Nieuw item";
  byId("foundEvidenceDescription").innerText = item.description || "Item toegevoegd.";
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
    quickSlots.innerHTML = items.slice(0, 4).map((item, index) => `
      <button type="button" data-quick-item="${index}">
        ${item.icon || "❓"} ${item.name || "Item"}
      </button>
    `).join("");

    quickSlots.querySelectorAll("[data-quick-item]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openEvidenceModal();
        renderEvidenceDetail(Number(btn.getAttribute("data-quick-item")));
      });
    });
  }

  if (evidenceGrid) {
    evidenceGrid.innerHTML = items.length
      ? items.map((item, index) => `
          <button type="button" class="evidence-slot" data-evidence-item="${index}">
            <div class="evidence-slot-icon">${item.icon || "❓"}</div>
            <div class="evidence-slot-name">${item.name || "Item"}</div>
          </button>
        `).join("")
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
    byId("evidenceDetailIcon").innerText = "❓";
    byId("evidenceDetailName").innerText = "Nog geen item geselecteerd";
    byId("evidenceDetailDescription").innerText = "Klik op een item om meer informatie te bekijken.";
    byId("evidenceDetailStatus").innerText = "Status: onbekend";
    return;
  }

  byId("evidenceDetailIcon").innerText = item.icon || "❓";
  byId("evidenceDetailName").innerText = item.name || "Item";
  byId("evidenceDetailDescription").innerText = item.description || "Geen beschrijving.";
  byId("evidenceDetailStatus").innerText = item.used
    ? "Status: reeds gebruikt"
    : isUsableEvidenceItem(item)
      ? `Status: bruikbaar item, bereik ${item.actionRange || 25} meter`
      : "Status: verzameld";

  const detailCard = qs(".evidence-detail-card");
  if (!detailCard) return;

  let actionBlock = detailCard.querySelector(".evidence-action-block");
  if (actionBlock) actionBlock.remove();

  if (isUsableEvidenceItem(item)) {
    actionBlock = document.createElement("div");
    actionBlock.className = "evidence-action-block";
    actionBlock.style.marginTop = "12px";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerText = "Gebruik item";
    btn.addEventListener("click", async () => {
      await useEvidenceItem(index);
    });

    const nearby = findNearbyTargetGroup(item.actionRange || 25);
    const info = document.createElement("p");
    info.className = "small-note";
    info.innerText = nearby
      ? `Groep ${nearby.data.groupNumber || "?"} is binnen bereik.`
      : "Geen andere groep binnen bereik.";

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
  const currentItems = Array.isArray(groupData?.evidence) ? [...groupData.evidence] : [];
  if (!currentItems[index]) return;

  currentItems.splice(index, 1);

  await update(ref(db, `groups/${groupId}`), {
    evidence: currentItems,
    evidenceCount: currentItems.length
  });
}

async function applyEffectToTargetGroup(targetId, item) {
  if (!targetId || !item) return;

  const effectId = `effect_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  if (item.actionType === "map_blur") {
    await set(ref(db, `groups/${targetId}/effects/${effectId}`), {
      type: "map_blur",
      startedAt: nowMs(),
      endsAt: nowMs() + Number(item.actionDuration || 30) * 1000,
      sourceGroupId: groupId
    });
    return;
  }

  if (item.actionType === "score_steal") {
    const amount = Number(item.actionValue || 15);

    const targetSnap = await get(ref(db, `groups/${targetId}`));
    const sourceSnap = await get(ref(db, `groups/${groupId}`));

    const target = targetSnap.exists() ? targetSnap.val() : null;
    const source = sourceSnap.exists() ? sourceSnap.val() : null;
    if (!target || !source) return;

    const targetScore = Math.max(0, Number(target.score || 0) - amount);
    const sourceScore = Number(source.score || 0) + amount;

    await update(ref(db, `groups/${targetId}`), {
      score: targetScore
    });

    await update(ref(db, `groups/${groupId}`), {
      score: sourceScore
    });
    return;
  }

  if (item.actionType === "compass_off") {
    await set(ref(db, `groups/${targetId}/effects/${effectId}`), {
      type: "compass_off",
      startedAt: nowMs(),
      endsAt: nowMs() + Number(item.actionDuration || 30) * 1000,
      sourceGroupId: groupId
    });
    return;
  }

  if (item.actionType === "freeze") {
    await set(ref(db, `groups/${targetId}/effects/${effectId}`), {
      type: "freeze",
      startedAt: nowMs(),
      endsAt: nowMs() + Number(item.actionDuration || 20) * 1000,
      sourceGroupId: groupId
    });
  }
}

async function useEvidenceItem(itemIndex) {
  const items = Array.isArray(groupData?.evidence) ? groupData.evidence : [];
  const item = items[itemIndex];

  if (!item || !isUsableEvidenceItem(item)) return;

  const nearby = findNearbyTargetGroup(item.actionRange || 25);
  if (!nearby) {
    alert("Geen groep binnen bereik.");
    return;
  }

  const ok = window.confirm(
    `Gebruik "${item.name}" op groep ${nearby.data.groupNumber || "?"}: ${nearby.data.groupName || "andere groep"}?`
  );
  if (!ok) return;

  await applyEffectToTargetGroup(nearby.id, item);
  await markEvidenceItemUsed(itemIndex);
  updateEvidenceUI();
  renderEvidenceDetail(0);

  alert(`Item gebruikt op groep ${nearby.data.groupNumber || "?"}.`);
}

/* =========================================================
   LOCATION / WATCH
========================================================= */
async function syncGroupPosition() {
  if (!groupId || currentLat == null || currentLng == null) return;

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
  restoreGroupIdForCity();

  // Eerst luisteren naar teacher city control
  listenToTeacherCurrentCity();

  // Als er al een URL of localStorage stad is, laad die voorlopig.
  if (cityKey) {
    await reloadCityContext(cityKey);
  }

  // Als er nog geen stad is, wacht even op control/currentCity
  if (!cityKey && currentTeacherCity) {
    await reloadCityContext(currentTeacherCity);
  }

  if (!cityKey) {
    // fallback als er nog niets actief staat
    await reloadCityContext("durbuy");
  }

  listenToAllGroups();
  listenToBroadcasts();

  if (groupId) {
    listenToGroup();
  }

  byId("startButton")?.addEventListener("click", async () => {
    await createGroup();
    listenToGroup();
    startLocationWatch();
  });

  byId("submitAnswerButton")?.addEventListener("click", submitCheckpointAnswer);
  byId("closeIntroButton")?.addEventListener("click", () => hideModal("introModal"));
  byId("closeMessageButton")?.addEventListener("click", closeMessageModal);
  byId("openEvidenceButton")?.addEventListener("click", openEvidenceModal);
  byId("closeEvidenceButton")?.addEventListener("click", () => hideModal("evidenceModal"));
  byId("closeFoundEvidenceButton")?.addEventListener("click", () => hideModal("evidenceFoundModal"));

  const toggleAudioButton = byId("toggleAudioButton");
  if (toggleAudioButton) {
    let muted = false;
    toggleAudioButton.addEventListener("click", () => {
      muted = !muted;
      document.querySelectorAll("audio, video").forEach((el) => {
        el.muted = muted;
        if (muted) {
          try { el.pause(); } catch {}
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
