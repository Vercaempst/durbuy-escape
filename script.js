import { cities as fallbackCities, getGatherCheckpoint as getFallbackGatherCheckpoint } from "./cities.js";
import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  get,
  update,
  runTransaction,
  onValue
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let citiesCache = {};

let map;
let playerMarker;
let checkpointMarker;
let checkpointCircle;
let routeLine;
let questionOpen = false;

let route = [];
let routeIndex = 0;
let currentCheckpoints = [];
let currentCityKey = null;
let cityLoaded = false;

let groupListenerStarted = false;
let globalListenerStarted = false;
let rankingListenerStarted = false;
let resetListenerStarted = false;
let compassListenerStarted = false;
let broadcastListenerStarted = false;

let lastKnownLat = null;
let lastKnownLng = null;
let deviceHeading = null;

let currentPuzzleOrder = [];
let currentPuzzleSelectedIndex = null;

let selectedPhotoFile = null;
let uploadedPhotoPending = false;

let gpsWatchId = null;
let filteredLat = null;
let filteredLng = null;
let smoothedHeading = null;
let currentArrowRotation = 0;
let lastLocationUpdateTime = 0;
let lastProcessedLat = null;
let lastProcessedLng = null;

let currentTheme = null;
let themeAudio = null;

const GPS_MIN_DISTANCE_METERS = 4;
const GPS_MIN_UPDATE_MS = 1200;
const LOCATION_SMOOTHING = 0.25;
const HEADING_SMOOTHING = 0.18;

let gameState = {
  groupId: null,
  groupNumber: null,
  groupName: "",
  groupMembers: "",
  cityKey: null,
  score: 0,
  currentTries: 0,
  gatherMode: false,
  finished: false,
  lastProcessedNextAt: 0,
  lastProcessedResetAt: 0,
  lastProcessedPointsAt: 0,
  lastProcessedGlobalAt: 0,
  lastProcessedHardResetAt: 0,
  lastProcessedMessageAt: 0,
  lastProcessedBroadcastAt: 0,
  sessionStartedAt: 0
};

let playerIcon = L.divIcon({
  className: "custom-emoji-icon",
  html: `<div style="font-size:32px; line-height:32px;">🚶</div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -28]
});

let checkpointIcon = L.divIcon({
  className: "custom-emoji-icon",
  html: `<div style="font-size:30px; line-height:30px;">🚩</div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 30],
  popupAnchor: [0, -26]
});

let gatherIcon = L.divIcon({
  className: "custom-emoji-icon",
  html: `<div style="font-size:30px; line-height:30px;">⭐</div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 30],
  popupAnchor: [0, -26]
});

function byId(id) {
  return document.getElementById(id);
}

function showElement(el) {
  if (!el) return;
  el.classList.remove("hidden");
  el.classList.remove("hidden-task");
  el.style.display = "";
}

function hideElement(el, clearSrc = false) {
  if (!el) return;
  el.classList.add("hidden");
  el.classList.add("hidden-task");
  el.style.display = "none";

  if (clearSrc && "src" in el) {
    el.src = "";
  }

  if (el.tagName === "AUDIO") {
    try {
      el.pause();
      el.currentTime = 0;
    } catch (error) {}
  }
}

function normalizeVideoUrl(url) {
  if (!url) return "";

  const raw = String(url).trim();
  if (!raw) return "";

  if (raw.includes("youtube.com/embed/") || raw.includes("player.vimeo.com/video/")) {
    return raw;
  }

  try {
    const parsed = new URL(raw);

    if (parsed.hostname.includes("youtu.be")) {
      const id = parsed.pathname.replace("/", "").trim();
      return id ? `https://www.youtube.com/embed/${id}` : raw;
    }

    if (parsed.hostname.includes("youtube.com")) {
      const id = parsed.searchParams.get("v");
      return id ? `https://www.youtube.com/embed/${id}` : raw;
    }

    if (parsed.hostname.includes("vimeo.com") && !parsed.hostname.includes("player.vimeo.com")) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      const id = parts.pop();
      return id ? `https://player.vimeo.com/video/${id}` : raw;
    }

    return raw;
  } catch (error) {
    return raw;
  }
}

function resetCheckpointMedia() {
  const storyEl = byId("modalStory");
  const videoEl = byId("modalVideo");
  const audioEl = byId("modalAudio");
  const imageEl = byId("modalImage");

  if (storyEl) {
    storyEl.innerText = "";
    hideElement(storyEl);
  }

  if (videoEl) hideElement(videoEl, true);
  if (audioEl) hideElement(audioEl, true);

  if (imageEl) {
    hideElement(imageEl, true);
    imageEl.alt = "";
  }
}

function renderCheckpointMedia(cp) {
  const storyEl = byId("modalStory");
  const videoEl = byId("modalVideo");
  const audioEl = byId("modalAudio");
  const imageEl = byId("modalImage");

  resetCheckpointMedia();

  if (storyEl && cp.story && String(cp.story).trim()) {
    storyEl.innerText = String(cp.story).trim();
    showElement(storyEl);
  }

  if (videoEl && cp.video && String(cp.video).trim()) {
    videoEl.src = normalizeVideoUrl(cp.video);
    showElement(videoEl);
  }

  if (audioEl && cp.audio && String(cp.audio).trim()) {
    audioEl.src = String(cp.audio).trim();
    audioEl.load();
    showElement(audioEl);
  }

  if (imageEl && cp.image && String(cp.image).trim()) {
    imageEl.src = String(cp.image).trim();
    imageEl.alt = cp.name ? `Afbeelding bij ${cp.name}` : "Afbeelding bij checkpoint";
    showElement(imageEl);
  }
}

function getCityRecord(cityKey) {
  const firebaseCity = citiesCache[cityKey];
  const fallbackCity = fallbackCities[cityKey];

  if (firebaseCity) {
    const center = Array.isArray(firebaseCity.center)
      ? firebaseCity.center
      : fallbackCity?.center || [50.85, 4.35];

    let gather;
    if (Array.isArray(firebaseCity.gather)) {
      gather = {
        name: "Verzamelpunt",
        coords: firebaseCity.gather,
        radius: 40
      };
    } else if (firebaseCity.gather?.coords) {
      gather = {
        name: firebaseCity.gather.name || "Verzamelpunt",
        coords: firebaseCity.gather.coords,
        radius: Number(firebaseCity.gather.radius || 40)
      };
    } else if (fallbackCity) {
      gather = {
        name: "Verzamelpunt",
        coords: Array.isArray(fallbackCity.gather) ? fallbackCity.gather : fallbackCity.center,
        radius: 40
      };
    } else {
      gather = {
        name: "Verzamelpunt",
        coords: center,
        radius: 40
      };
    }

    return {
      name: firebaseCity.name || fallbackCity?.name || cityKey,
      center,
      gather,
      themeId: firebaseCity.themeId || "",
      defaultCheckpoints: fallbackCity?.defaultCheckpoints || []
    };
  }

  if (fallbackCity) {
    return {
      name: fallbackCity.name || cityKey,
      center: fallbackCity.center || [50.85, 4.35],
      gather: {
        name: "Verzamelpunt",
        coords: Array.isArray(fallbackCity.gather) ? fallbackCity.gather : fallbackCity.center,
        radius: 40
      },
      themeId: fallbackCity.themeId || "",
      defaultCheckpoints: fallbackCity.defaultCheckpoints || []
    };
  }

  return {
    name: cityKey || "City Escape",
    center: [50.85, 4.35],
    gather: {
      name: "Verzamelpunt",
      coords: [50.85, 4.35],
      radius: 40
    },
    themeId: "",
    defaultCheckpoints: []
  };
}

function getGatherCheckpoint(cityKey) {
  if (citiesCache[cityKey]?.gather?.coords) {
    const city = getCityRecord(cityKey);
    return {
      name: city.gather.name || "Verzamelpunt",
      coords: city.gather.coords,
      radius: city.gather.radius || 40,
      question: "",
      answers: [],
      pointsCorrect: 0,
      pointsAfterMaxTries: 0
    };
  }

  return getFallbackGatherCheckpoint(cityKey);
}

function saveLocalState() {
  localStorage.setItem(
    "cityEscapeState",
    JSON.stringify({
      gameState,
      route,
      routeIndex,
      currentCityKey
    })
  );
}

function loadLocalState() {
  const saved = localStorage.getItem("cityEscapeState");
  if (!saved) return false;

  const parsed = JSON.parse(saved);
  gameState = parsed.gameState;
  route = parsed.route;
  routeIndex = parsed.routeIndex;
  currentCityKey = parsed.currentCityKey || currentCityKey;
  return true;
}

function clearLocalState() {
  localStorage.removeItem("cityEscapeState");
}

function setActiveCityUI(cityKey) {
  const titleEl = byId("appTitle");
  const city = cityKey ? getCityRecord(cityKey) : null;

  if (!cityKey || !city) {
    if (titleEl) titleEl.innerText = "City Escape";
    return;
  }

  if (titleEl) {
    titleEl.innerText = city.name + " Escape";
  }
}

async function loadCheckpointsForCity(cityKey) {
  const snapshot = await get(ref(db, "cityData/" + cityKey + "/checkpoints"));

  if (snapshot.exists()) {
    const data = snapshot.val();
    if (Array.isArray(data) && data.length > 0) {
      return data;
    }
  }

  return getCityRecord(cityKey).defaultCheckpoints || [];
}

async function loadThemeForCity(cityKey) {
  const citySnapshot = await get(ref(db, "cities/" + cityKey));
  if (!citySnapshot.exists()) return null;

  const cityData = citySnapshot.val();
  const themeId = cityData?.themeId;

  if (!themeId) return null;

  const themeSnapshot = await get(ref(db, "themes/" + themeId));
  if (!themeSnapshot.exists()) return null;

  return themeSnapshot.val();
}

function ensureThemeAudio() {
  if (!themeAudio) {
    themeAudio = new Audio();
    themeAudio.loop = true;
  }
}

function applyIcons(theme) {
  const checkpointEmoji = theme?.iconCheckpoint || "🚩";
  const gatherEmoji = theme?.iconGather || "⭐";
  const playerEmoji = theme?.iconPlayer || "🚶";

  playerIcon = L.divIcon({
    className: "custom-emoji-icon",
    html: `<div style="font-size:32px; line-height:32px;">${playerEmoji}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -28]
  });

  checkpointIcon = L.divIcon({
    className: "custom-emoji-icon",
    html: `<div style="font-size:30px; line-height:30px;">${checkpointEmoji}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -26]
  });

  gatherIcon = L.divIcon({
    className: "custom-emoji-icon",
    html: `<div style="font-size:30px; line-height:30px;">${gatherEmoji}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -26]
  });

  if (playerMarker) playerMarker.setIcon(playerIcon);
  if (checkpointMarker) checkpointMarker.setIcon(getCurrentMarkerIcon());
}

function applyBackgroundMusic(theme) {
  ensureThemeAudio();

  if (!theme || !theme.backgroundMusic) {
    themeAudio.pause();
    themeAudio.src = "";
    return;
  }

  const nextSrc = String(theme.backgroundMusic).trim();
  if (!nextSrc) {
    themeAudio.pause();
    themeAudio.src = "";
    return;
  }

  if (themeAudio.src !== nextSrc) {
    themeAudio.src = nextSrc;
  }

  themeAudio.volume =
    typeof theme.backgroundMusicVolume === "number"
      ? theme.backgroundMusicVolume
      : 0.25;
}

function applyTheme(theme) {
  currentTheme = theme;

  const root = document.documentElement;
  const body = document.body;

  if (!theme) {
    root.style.setProperty("--theme-text-color", "#ffffff");
    root.style.setProperty("--theme-card-color", "rgba(30,30,30,0.90)");
    root.style.setProperty("--theme-primary-color", "#5a5a5a");
    root.style.setProperty("--theme-secondary-color", "#333333");
    root.style.setProperty("--theme-button-color", "#444444");
    root.style.setProperty("--theme-button-text-color", "#ffffff");
    root.style.setProperty("--theme-border-radius", "12px");
    root.style.setProperty("--theme-box-shadow", "0 4px 12px rgba(0,0,0,0.2)");

    body.style.backgroundImage = "none";
    body.style.backgroundColor = "#111111";
    body.style.fontFamily = "Arial, sans-serif";
    body.classList.remove("theme-glow", "theme-fog");
    applyIcons(null);
    applyBackgroundMusic(null);
    return;
  }

  root.style.setProperty("--theme-text-color", theme.textColor || "#ffffff");
  root.style.setProperty("--theme-card-color", theme.cardColor || "rgba(30,30,30,0.90)");
  root.style.setProperty("--theme-primary-color", theme.primaryColor || "#5a5a5a");
  root.style.setProperty("--theme-secondary-color", theme.secondaryColor || "#333333");
  root.style.setProperty("--theme-button-color", theme.buttonColor || "#444444");
  root.style.setProperty("--theme-button-text-color", theme.buttonTextColor || "#ffffff");
  root.style.setProperty("--theme-border-radius", theme.borderRadius || "12px");
  root.style.setProperty("--theme-box-shadow", theme.boxShadow || "0 4px 12px rgba(0,0,0,0.2)");

  body.style.color = theme.textColor || "#ffffff";
  body.style.fontFamily = theme.fontFamily || "Arial, sans-serif";

  if (theme.backgroundType === "image" && theme.backgroundImage) {
    body.style.backgroundImage = `url('${theme.backgroundImage}')`;
    body.style.backgroundSize = "cover";
    body.style.backgroundPosition = "center";
    body.style.backgroundAttachment = "fixed";
    body.style.backgroundColor = theme.backgroundColor || "#111111";
  } else {
    body.style.backgroundImage = "none";
    body.style.backgroundColor = theme.backgroundColor || "#111111";
  }

  body.classList.toggle("theme-glow", !!theme.useGlowEffect);
  body.classList.toggle("theme-fog", !!theme.useFogEffect);

  applyIcons(theme);
  applyBackgroundMusic(theme);
}

async function tryPlayThemeAudio() {
  if (!themeAudio || !themeAudio.src) return;

  try {
    await themeAudio.play();
  } catch (error) {
    console.log("Autoplay geblokkeerd:", error);
  }
}

function generateGroupId() {
  return "group_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
}

async function getNextGroupNumber(cityKey) {
  const counterRef = ref(db, "meta/groupCounters/" + cityKey);

  const result = await runTransaction(counterRef, (current) => {
    return (current || 0) + 1;
  });

  return result.snapshot.val();
}

function generateRoute(groupNumber, checkpointCount) {
  const start = (groupNumber - 1) % checkpointCount;
  const r = [];

  for (let i = 0; i < checkpointCount; i++) {
    r.push((start + i) % checkpointCount);
  }

  return r;
}

function getCurrentCheckpoint() {
  if (gameState.gatherMode || gameState.finished) {
    return getGatherCheckpoint(currentCityKey);
  }

  return currentCheckpoints[route[routeIndex]];
}

function getCurrentMarkerIcon() {
  if (gameState.gatherMode || gameState.finished) {
    return gatherIcon;
  }
  return checkpointIcon;
}

function getNextCheckpointName() {
  if (gameState.finished) return "Afgerond";
  const cp = getCurrentCheckpoint();
  return cp ? cp.name : "-";
}

function normalizeTaskType(cp) {
  return cp.taskType || cp.type || "text";
}

function initMap() {
  if (!currentCityKey) return;

  const center = getCityRecord(currentCityKey).center;

  if (map) {
    map.remove();
    map = null;
  }

  map = L.map("map").setView(center, 16);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "OpenStreetMap"
  }).addTo(map);

  loadCheckpoint();
}

function resetMapToCity() {
  if (!map || !currentCityKey) return;
  const center = getCityRecord(currentCityKey).center;
  map.setView(center, 16);
}

function hideAllTaskWrappers() {
  byId("taskTextWrapper")?.classList.add("hidden-task");
  byId("taskMultipleChoiceWrapper")?.classList.add("hidden-task");
  byId("taskMatchingWrapper")?.classList.add("hidden-task");
  byId("taskImagePuzzleWrapper")?.classList.add("hidden-task");
  byId("taskPhotoWrapper")?.classList.add("hidden-task");
}

function resetPhotoTaskUI() {
  selectedPhotoFile = null;
  uploadedPhotoPending = false;

  const photoInput = byId("photoInput");
  const photoPreview = byId("photoPreview");
  const photoStatus = byId("photoUploadStatus");

  if (photoInput) photoInput.value = "";
  if (photoStatus) photoStatus.innerText = "";
  if (photoPreview) {
    photoPreview.src = "";
    photoPreview.classList.add("hidden-task");
  }
}

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function renderImagePuzzle(cp) {
  const gridSize = cp.gridSize || 3;
  const tileCount = gridSize * gridSize;
  const grid = byId("puzzleGrid");

  if (!grid) return;

  grid.innerHTML = "";
  grid.style.gridTemplateColumns = `repeat(${gridSize}, 90px)`;

  if (!Array.isArray(currentPuzzleOrder) || currentPuzzleOrder.length !== tileCount) {
    currentPuzzleOrder = shuffleArray([...Array(tileCount).keys()]);

    if (currentPuzzleOrder.every((value, index) => value === index)) {
      currentPuzzleOrder = shuffleArray([...Array(tileCount).keys()]);
    }
  }

  currentPuzzleOrder.forEach((tileNumber, index) => {
    const row = Math.floor(tileNumber / gridSize);
    const col = tileNumber % gridSize;

    const tile = document.createElement("div");
    tile.className = "puzzle-tile";
    if (currentPuzzleSelectedIndex === index) {
      tile.classList.add("selected");
    }

    tile.style.width = "90px";
    tile.style.height = "90px";
    tile.style.backgroundImage = `url('${cp.imageUrl}')`;
    tile.style.backgroundSize = `${gridSize * 90}px ${gridSize * 90}px`;
    tile.style.backgroundPosition = `${-col * 90}px ${-row * 90}px`;

    tile.addEventListener("click", () => {
      if (currentPuzzleSelectedIndex === null) {
        currentPuzzleSelectedIndex = index;
      } else if (currentPuzzleSelectedIndex === index) {
        currentPuzzleSelectedIndex = null;
      } else {
        const a = currentPuzzleSelectedIndex;
        const b = index;
        [currentPuzzleOrder[a], currentPuzzleOrder[b]] = [currentPuzzleOrder[b], currentPuzzleOrder[a]];
        currentPuzzleSelectedIndex = null;
      }

      renderImagePuzzle(cp);
    });

    grid.appendChild(tile);
  });
}

function attachPhotoListeners() {
  const photoInput = byId("photoInput");
  const photoPreview = byId("photoPreview");
  const photoStatus = byId("photoUploadStatus");

  if (!photoInput) return;

  photoInput.onchange = () => {
    const file = photoInput.files && photoInput.files[0] ? photoInput.files[0] : null;
    selectedPhotoFile = file || null;
    uploadedPhotoPending = false;

    if (!file) {
      if (photoPreview) {
        photoPreview.src = "";
        photoPreview.classList.add("hidden-task");
      }
      if (photoStatus) photoStatus.innerText = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      if (photoPreview) {
        photoPreview.src = e.target.result;
        photoPreview.classList.remove("hidden-task");
      }
    };
    reader.readAsDataURL(file);

    if (photoStatus) {
      photoStatus.innerText = "Foto gekozen. Klik op 'Controleer opdracht' om te verzenden.";
    }
  };
}

function renderTaskUI(cp) {
  hideAllTaskWrappers();
  resetPhotoTaskUI();

  const taskType = normalizeTaskType(cp);

  if (taskType === "text" || taskType === "riddle") {
    byId("taskTextWrapper")?.classList.remove("hidden-task");
    if (byId("modalAnswerInput")) {
      byId("modalAnswerInput").value = "";
      byId("modalAnswerInput").placeholder =
        taskType === "riddle" ? "Typ hier jullie oplossing" : "Typ hier jullie antwoord";
    }
  }

  if (taskType === "multipleChoice") {
    byId("taskMultipleChoiceWrapper")?.classList.remove("hidden-task");
    const container = byId("multipleChoiceOptions");
    if (container) {
      container.innerHTML = "";

      (cp.options || []).forEach((option, index) => {
        const label = document.createElement("label");
        label.className = "mc-option";
        label.innerHTML = `
          <input type="radio" name="mcOption" value="${index}">
          ${option}
        `;
        container.appendChild(label);
      });
    }
  }

  if (taskType === "matching") {
    byId("taskMatchingWrapper")?.classList.remove("hidden-task");
    const container = byId("matchingContainer");
    if (container) {
      container.innerHTML = "";

      (cp.leftItems || []).forEach((leftItem, index) => {
        const row = document.createElement("div");
        row.className = "matching-row";

        row.innerHTML = `
          <div class="matching-left">${leftItem}</div>
          <select id="matching-${index}">
            <option value="">Kies...</option>
            ${(cp.rightItems || []).map(item => `<option value="${item}">${item}</option>`).join("")}
          </select>
        `;

        container.appendChild(row);
      });
    }
  }

  if (taskType === "imagePuzzle") {
    byId("taskImagePuzzleWrapper")?.classList.remove("hidden-task");
    renderImagePuzzle(cp);
  }

  if (taskType === "photo") {
    byId("taskPhotoWrapper")?.classList.remove("hidden-task");
    attachPhotoListeners();
  }
}

function loadCheckpoint() {
  const cp = getCurrentCheckpoint();
  const markerIcon = getCurrentMarkerIcon();

  if (!cp || !map) return;

  if (checkpointMarker) map.removeLayer(checkpointMarker);
  if (checkpointCircle) map.removeLayer(checkpointCircle);

  checkpointMarker = L.marker(cp.coords, { icon: markerIcon })
    .addTo(map)
    .bindPopup(cp.name);

  checkpointCircle = L.circle(cp.coords, { radius: cp.radius }).addTo(map);

  if (gameState.gatherMode) {
    byId("modeText").innerText = "Spelmodus: verzamelpunt";
    byId("progressText").innerText = "Iedereen naar het verzamelpunt";
  } else if (gameState.finished) {
    byId("modeText").innerText = "Spelmodus: afgerond";
    byId("progressText").innerText = "Alle checkpoints afgerond";
  } else {
    byId("modeText").innerText = "Spelmodus: normaal";
    byId("progressText").innerText =
      "Checkpoint " + (routeIndex + 1) + " / " + route.length;
  }

  byId("scoreText").innerText =
    (gameState.finished ? "Eindscore: " : "Score: ") + gameState.score;

  byId("answerFeedback").innerText = "";
  byId("triesFeedback").innerText = "";
  if (byId("modalAnswerInput")) byId("modalAnswerInput").value = "";
  currentPuzzleOrder = [];
  currentPuzzleSelectedIndex = null;
  resetPhotoTaskUI();
  resetCheckpointMedia();

  if (!gameState.gatherMode && !gameState.finished) {
    renderTaskUI(cp);
  }

  closeQuestion();
  questionOpen = false;
  saveLocalState();

  if (lastKnownLat !== null && lastKnownLng !== null) {
    updateNavigation(lastKnownLat, lastKnownLng);
    updateRouteLine(lastKnownLat, lastKnownLng);
  }
}

function updateRouteLine(lat, lng) {
  const cp = getCurrentCheckpoint();
  if (!cp || !map) return;

  if (routeLine) {
    map.removeLayer(routeLine);
  }

  routeLine = L.polyline(
    [
      [lat, lng],
      cp.coords
    ],
    {
      weight: 4,
      opacity: 0.8
    }
  ).addTo(map);
}

function updateLocation(lat, lng) {
  lastKnownLat = lat;
  lastKnownLng = lng;

  if (!playerMarker) {
    playerMarker = L.marker([lat, lng], { icon: playerIcon })
      .addTo(map)
      .bindPopup("Jullie locatie");
  } else {
    playerMarker.setLatLng([lat, lng]);
  }

  updateRouteLine(lat, lng);
  updateNavigation(lat, lng);
  checkDistance(lat, lng);
  syncGroup(lat, lng);
}

function checkDistance(lat, lng) {
  const cp = getCurrentCheckpoint();
  if (!cp || !map) return;

  const dist = map.distance([lat, lng], cp.coords);
  byId("distanceText").innerText = "Afstand: " + Math.round(dist) + " m";

  if (gameState.gatherMode) {
    if (dist < cp.radius) {
      byId("status").innerText =
        "Jullie zijn aangekomen op het verzamelpunt. Wacht op verdere instructies.";
    } else {
      byId("status").innerText =
        "Ga naar het verzamelpunt. Nog " + Math.round(dist) + " meter.";
    }
    return;
  }

  if (gameState.finished) {
    if (dist < cp.radius) {
      byId("status").innerText =
        "Jullie zijn aangekomen op het verzamelpunt. Proficiat met jullie score.";
    } else {
      byId("status").innerText =
        "Proficiat. Ga nu naar het verzamelpunt. Nog " + Math.round(dist) + " meter.";
    }
    return;
  }

  if (dist < cp.radius) {
    byId("status").innerText = "Jullie zijn aangekomen bij " + cp.name + ".";
    if (!questionOpen) {
      openQuestion();
    }
  } else {
    byId("status").innerText =
      "Nog " + Math.round(dist) + " meter tot " + cp.name + ".";
  }
}

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad) {
  return (rad * 180) / Math.PI;
}

function getBearing(lat1, lng1, lat2, lng2) {
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const λ1 = toRadians(lng1);
  const λ2 = toRadians(lng2);

  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);

  let bearing = toDegrees(Math.atan2(y, x));
  bearing = (bearing + 360) % 360;
  return bearing;
}

function shortestAngleDiff(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function smoothAngle(current, target, factor) {
  const diff = shortestAngleDiff(current, target);
  return (current + diff * factor + 360) % 360;
}

function updateNavigation(lat, lng) {
  const cp = getCurrentCheckpoint();
  if (!cp) return;

  const arrowEl = byId("arrow");
  if (!arrowEl) return;

  const targetBearing = getBearing(lat, lng, cp.coords[0], cp.coords[1]);

  if (deviceHeading === null) {
    arrowEl.style.display = "none";
    return;
  }

  arrowEl.style.display = "block";

  let rotation = targetBearing - deviceHeading;
  rotation = (rotation + 360) % 360;

  if (smoothedHeading === null) {
    smoothedHeading = rotation;
  } else {
    smoothedHeading = smoothAngle(smoothedHeading, rotation, HEADING_SMOOTHING);
  }

  currentArrowRotation = smoothedHeading;
  arrowEl.style.transform = "rotate(" + currentArrowRotation + "deg)";
}

function handleOrientation(event) {
  let heading = null;

  if (typeof event.webkitCompassHeading === "number") {
    heading = event.webkitCompassHeading;
  } else if (event.alpha !== null) {
    heading = 360 - event.alpha;
  }

  if (heading === null) return;
  deviceHeading = (heading + 360) % 360;

  if (lastKnownLat !== null && lastKnownLng !== null) {
    updateNavigation(lastKnownLat, lastKnownLng);
  }
}

async function enableCompass() {
  if (compassListenerStarted) return;
  compassListenerStarted = true;

  if (
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof DeviceOrientationEvent.requestPermission === "function"
  ) {
    try {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission === "granted") {
        window.addEventListener("deviceorientation", handleOrientation, true);
      }
    } catch (error) {
      console.error("Kompas-permissie mislukt:", error);
    }
  } else {
    window.addEventListener("deviceorientation", handleOrientation, true);
  }
}

function openQuestion() {
  if (gameState.gatherMode || gameState.finished) return;

  const cp = getCurrentCheckpoint();
  if (!cp) return;

  questionOpen = true;
  byId("modalTitle").innerText = cp.name;
  renderCheckpointMedia(cp);
  byId("modalQuestion").innerText = cp.question;
  renderTaskUI(cp);
  byId("questionModal").classList.remove("hidden");
}

function closeQuestion() {
  byId("questionModal").classList.add("hidden");
  resetCheckpointMedia();
  questionOpen = false;
}

function showTeacherMessage(text) {
  byId("teacherMessageText").innerText = text;
  byId("messageModal").classList.remove("hidden");
}

function closeTeacherMessage() {
  byId("messageModal").classList.add("hidden");
}

function finishGame() {
  gameState.finished = true;
  gameState.gatherMode = false;
  closeQuestion();

  const gather = getGatherCheckpoint(currentCityKey);

  byId("modeText").innerText = "Spelmodus: afgerond";
  byId("progressText").innerText = "Alle checkpoints afgerond";
  byId("scoreText").innerText = "Eindscore: " + gameState.score;

  alert(
    "Proficiat! 🎉\n\n" +
    "Jullie hebben alle checkpoints voltooid.\n\n" +
    "Jullie behaalden een score van: " +
    gameState.score +
    " punten.\n\n" +
    "Ga nu naar het verzamelpunt."
  );

  if (checkpointMarker) map.removeLayer(checkpointMarker);
  if (checkpointCircle) map.removeLayer(checkpointCircle);

  checkpointMarker = L.marker(gather.coords, { icon: gatherIcon })
    .addTo(map)
    .bindPopup(gather.name)
    .openPopup();

  checkpointCircle = L.circle(gather.coords, {
    radius: gather.radius
  }).addTo(map);

  map.setView(gather.coords, 18);

  byId("status").innerText = "Proficiat. Ga nu naar het verzamelpunt.";

  if (lastKnownLat !== null && lastKnownLng !== null) {
    updateNavigation(lastKnownLat, lastKnownLng);
    updateRouteLine(lastKnownLat, lastKnownLng);
  }

  saveLocalState();
  syncGroup();
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function checkCurrentTask() {
  const cp = getCurrentCheckpoint();
  if (!cp || gameState.finished) return false;

  const taskType = normalizeTaskType(cp);

  if (taskType === "text" || taskType === "riddle") {
    const input = byId("modalAnswerInput").value.toLowerCase().trim();
    return (cp.answers || []).map(a => a.toLowerCase().trim()).includes(input);
  }

  if (taskType === "multipleChoice") {
    const selected = document.querySelector('input[name="mcOption"]:checked');
    if (!selected) return false;
    return Number(selected.value) === Number(cp.correctOption);
  }

  if (taskType === "matching") {
    const leftItems = cp.leftItems || [];
    const correctPairs = cp.correctPairs || {};

    return leftItems.every((leftItem, index) => {
      const select = byId("matching-" + index);
      if (!select) return false;
      return select.value === correctPairs[leftItem];
    });
  }

  if (taskType === "imagePuzzle") {
    const gridSize = cp.gridSize || 3;
    const tileCount = gridSize * gridSize;
    const solved = [...Array(tileCount).keys()];
    return arraysEqual(currentPuzzleOrder, solved);
  }

  if (taskType === "photo") {
    return uploadedPhotoPending;
  }

  return false;
}

async function uploadPhotoForCheckpoint(cp) {
  const photoStatus = byId("photoUploadStatus");

  if (!selectedPhotoFile) {
    if (photoStatus) photoStatus.innerText = "Kies eerst een foto.";
    return false;
  }

  try {
    if (photoStatus) photoStatus.innerText = "Foto wordt doorgestuurd...";

    const reader = new FileReader();

    const base64 = await new Promise((resolve, reject) => {
      reader.onload = () => {
        try {
          resolve(reader.result.split(",")[1]);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error("Bestand kon niet gelezen worden."));
      reader.readAsDataURL(selectedPhotoFile);
    });

    const safeCheckpointName = (cp.name || "checkpoint")
      .replace(/[^a-z0-9-_]+/gi, "_")
      .toLowerCase();

    const queueData = {
      cityKey: currentCityKey,
      groupId: gameState.groupId,
      groupNumber: gameState.groupNumber,
      groupName: gameState.groupName,
      groupMembers: gameState.groupMembers,
      checkpointName: cp.name,
      checkpointIndex: routeIndex,
      safeCheckpointName,
      filename: safeCheckpointName + ".jpg",
      groupFolderName: `Groep_${gameState.groupNumber}_${gameState.groupName}`,
      imageBase64: base64,
      createdAt: new Date().toISOString(),
      processed: false
    };

    await update(
      ref(db, `uploadQueue/${currentCityKey}/${gameState.groupId}/${safeCheckpointName}`),
      queueData
    );

    uploadedPhotoPending = true;
    if (photoStatus) {
      photoStatus.innerText = "Foto doorgestuurd. De verwerking kan even duren.";
    }

    return true;
  } catch (error) {
    console.error("Foto-upload mislukt:", error);
    if (photoStatus) {
      photoStatus.innerText = "Upload mislukt: " + error.message;
    }
    return false;
  }
}

function handleWrongAttempt(cp) {
  gameState.currentTries++;

  if (gameState.currentTries >= 3) {
    gameState.score += Number(cp.pointsAfterMaxTries || 0);
    nextCheckpoint();
  } else {
    byId("answerFeedback").innerText = "Niet juist, probeer opnieuw.";
    byId("triesFeedback").innerText = "Pogingen over: " + (3 - gameState.currentTries);
  }

  saveLocalState();
}

async function checkAnswer() {
  const cp = getCurrentCheckpoint();
  if (!cp || gameState.finished) return;

  const taskType = normalizeTaskType(cp);

  if (taskType === "photo" && !uploadedPhotoPending) {
    const uploaded = await uploadPhotoForCheckpoint(cp);
    if (!uploaded) return;
  }

  const correct = checkCurrentTask();

  if (correct) {
    gameState.score += Number(cp.pointsCorrect || 0);
    nextCheckpoint();
    return;
  }

  handleWrongAttempt(cp);
}

function nextCheckpoint() {
  closeQuestion();
  gameState.currentTries = 0;
  routeIndex++;
  currentPuzzleOrder = [];
  currentPuzzleSelectedIndex = null;
  resetPhotoTaskUI();

  if (routeIndex >= route.length) {
    finishGame();
    return;
  }

  loadCheckpoint();
  saveLocalState();
}

function updateGpsStatus(isGood, text) {
  const dot = byId("gpsStatusDot");
  const txt = byId("gpsStatusText");
  if (!dot || !txt) return;

  dot.style.backgroundColor = isGood ? "#21c55d" : "#ef4444";
  txt.innerText = text;
}

function distanceBetween(lat1, lng1, lat2, lng2) {
  if (!map) return 0;
  return map.distance([lat1, lng1], [lat2, lng2]);
}

function startGPS() {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
  }

  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const now = Date.now();
      const rawLat = pos.coords.latitude;
      const rawLng = pos.coords.longitude;
      const accuracy = pos.coords.accuracy || 9999;

      updateGpsStatus(
        accuracy <= 25,
        "GPS-status: " + Math.round(accuracy) + " m nauwkeurigheid"
      );

      if (filteredLat === null || filteredLng === null) {
        filteredLat = rawLat;
        filteredLng = rawLng;
      } else {
        filteredLat = filteredLat + (rawLat - filteredLat) * LOCATION_SMOOTHING;
        filteredLng = filteredLng + (rawLng - filteredLng) * LOCATION_SMOOTHING;
      }

      if (lastProcessedLat !== null && lastProcessedLng !== null) {
        const moved = distanceBetween(filteredLat, filteredLng, lastProcessedLat, lastProcessedLng);
        const tooSoon = now - lastLocationUpdateTime < GPS_MIN_UPDATE_MS;

        if (moved < GPS_MIN_DISTANCE_METERS && tooSoon) {
          return;
        }
      }

      lastProcessedLat = filteredLat;
      lastProcessedLng = filteredLng;
      lastLocationUpdateTime = now;

      updateLocation(filteredLat, filteredLng);
    },
    (err) => {
      updateGpsStatus(false, "GPS-status: fout");
      byId("status").innerText = "GPS kon niet worden opgehaald.";
      console.error(err);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000
    }
  );
}

function getCheckpointNameForSync() {
  if (gameState.finished) return "Verzamelpunt";
  const cp = getCurrentCheckpoint();
  return cp ? cp.name : "-";
}

function syncGroup(lat = null, lng = null) {
  if (!gameState.groupId || !currentCityKey) return;

  const payload = {
    cityKey: currentCityKey,
    groupNumber: gameState.groupNumber,
    groupName: gameState.groupName,
    groupMembers: gameState.groupMembers,
    score: gameState.score,
    checkpoint: getCheckpointNameForSync(),
    nextCheckpoint: getNextCheckpointName(),
    gatherMode: gameState.gatherMode || gameState.finished,
    finished: gameState.finished,
    routeIndex: routeIndex,
    lastUpdated: new Date().toISOString()
  };

  if (lat !== null && lng !== null) {
    payload.lat = lat;
    payload.lng = lng;
  }

  update(ref(db, "groups/" + gameState.groupId), payload);
}

function listenTeacherCommands() {
  if (groupListenerStarted || !gameState.groupId) return;
  groupListenerStarted = true;

  onValue(ref(db, "groups/" + gameState.groupId), (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    if (data.commandNextAt && data.commandNextAt > gameState.lastProcessedNextAt) {
      gameState.lastProcessedNextAt = data.commandNextAt;
      if (!gameState.gatherMode && !gameState.finished) {
        nextCheckpoint();
      }
      saveLocalState();
    }

    if (data.commandPointsAt && data.commandPointsAt > gameState.lastProcessedPointsAt) {
      gameState.lastProcessedPointsAt = data.commandPointsAt;
      gameState.score += Number(data.commandPointsValue || 0);
      byId("scoreText").innerText =
        (gameState.finished ? "Eindscore: " : "Score: ") + gameState.score;
      saveLocalState();
      syncGroup();
    }

    if (data.commandMessageAt && data.commandMessageAt > gameState.lastProcessedMessageAt) {
      gameState.lastProcessedMessageAt = data.commandMessageAt;
      showTeacherMessage(data.commandMessageText || "Bericht van de leerkracht");
      saveLocalState();
    }

    if (data.commandResetAt && data.commandResetAt > gameState.lastProcessedResetAt) {
      gameState.lastProcessedResetAt = data.commandResetAt;
      clearLocalState();
      location.reload();
    }
  });
}

function listenGlobalCommands() {
  if (globalListenerStarted || !currentCityKey) return;
  globalListenerStarted = true;

  onValue(ref(db, "control/globalCommands/" + currentCityKey), (snapshot) => {
    const data = snapshot.val();
    if (!data || !data.at) return;
    if (data.at <= gameState.lastProcessedGlobalAt) return;

    gameState.lastProcessedGlobalAt = data.at;

    if (data.type === "gather") {
      gameState.gatherMode = true;
      closeQuestion();
      loadCheckpoint();
      byId("status").innerText =
        "De begeleider heeft iedereen naar het verzamelpunt gestuurd.";
    }

    if (data.type === "resume") {
      if (!gameState.finished) {
        gameState.gatherMode = false;
        closeQuestion();
        loadCheckpoint();
        byId("status").innerText = "Het normale spel is hervat.";
      }
    }

    saveLocalState();
    syncGroup();
  });
}

function listenBroadcastMessages() {
  if (broadcastListenerStarted || !currentCityKey) return;
  broadcastListenerStarted = true;

  onValue(ref(db, "control/broadcasts/" + currentCityKey), (snapshot) => {
    const data = snapshot.val();
    if (!data || !data.at) return;

    if (!gameState.sessionStartedAt) return;
    if (data.at <= gameState.sessionStartedAt) return;
    if (data.at <= gameState.lastProcessedBroadcastAt) return;

    gameState.lastProcessedBroadcastAt = data.at;
    showTeacherMessage(data.text || "Algemeen bericht");
    saveLocalState();
  });
}

function listenHardReset() {
  if (resetListenerStarted) return;
  resetListenerStarted = true;

  let firstLoad = true;

  onValue(ref(db, "control/globalReset"), (snapshot) => {
    const data = snapshot.val();
    if (!data || !data.at) return;

    if (firstLoad) {
      firstLoad = false;
      gameState.lastProcessedHardResetAt = data.at;
      return;
    }

    if (data.at <= gameState.lastProcessedHardResetAt) return;

    gameState.lastProcessedHardResetAt = data.at;
    clearLocalState();
    location.reload();
  });
}

function listenStudentRanking() {
  if (rankingListenerStarted) return;
  rankingListenerStarted = true;

  onValue(ref(db, "groups"), (snapshot) => {
    const data = snapshot.val();
    const container = byId("studentRankingContainer");
    if (!container) return;

    container.innerHTML = "";

    if (!data || !currentCityKey) {
      container.innerHTML = "<p>Nog geen scoregegevens beschikbaar.</p>";
      return;
    }

    const groups = Object.values(data)
      .filter((g) => g.cityKey === currentCityKey)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 10);

    if (!groups.length) {
      container.innerHTML = "<p>Nog geen scoregegevens beschikbaar.</p>";
      return;
    }

    groups.forEach((g, index) => {
      const row = document.createElement("div");
      row.className = "rank-item";
      row.innerHTML = `
        <span>${index + 1}. Groep ${g.groupNumber}: ${g.groupName}</span>
        <span>${g.score || 0} punten</span>
      `;
      container.appendChild(row);
    });
  });
}

async function startGame() {
  const name = byId("groupName").value.trim();
  const members = byId("groupMembers").value.trim();

  if (!name || !members) {
    byId("loginFeedback").innerText = "Vul alles in.";
    return;
  }

  byId("loginFeedback").innerText = "Spel wordt geladen...";

  try {
    const citySnapshot = await get(ref(db, "control/currentCity"));

    if (!citySnapshot.exists()) {
      byId("loginFeedback").innerText = "De leerkracht heeft nog geen stad geactiveerd.";
      return;
    }

    const cityKey = citySnapshot.val();
    currentCityKey = cityKey;
    setActiveCityUI(cityKey);

    const theme = await loadThemeForCity(cityKey);
    applyTheme(theme);

    currentCheckpoints = await loadCheckpointsForCity(cityKey);

    if (!currentCheckpoints || !currentCheckpoints.length) {
      byId("loginFeedback").innerText = "Er zijn nog geen checkpoints ingesteld voor deze stad.";
      return;
    }

    cityLoaded = true;

    await enableCompass();

    gameState.groupId = generateGroupId();
    gameState.groupNumber = await getNextGroupNumber(currentCityKey);
    gameState.groupName = name;
    gameState.groupMembers = members;
    gameState.cityKey = currentCityKey;
    gameState.score = 0;
    gameState.currentTries = 0;
    gameState.gatherMode = false;
    gameState.finished = false;
    gameState.lastProcessedNextAt = 0;
    gameState.lastProcessedResetAt = 0;
    gameState.lastProcessedPointsAt = 0;
    gameState.lastProcessedGlobalAt = 0;
    gameState.lastProcessedHardResetAt = 0;
    gameState.lastProcessedMessageAt = 0;
    gameState.lastProcessedBroadcastAt = 0;
    gameState.sessionStartedAt = Date.now();

    route = generateRoute(gameState.groupNumber, currentCheckpoints.length);
    routeIndex = 0;

    byId("loginCard").classList.add("hidden");
    byId("gameArea").classList.remove("hidden");
    byId("teamDisplay").innerText = "Groep " + gameState.groupNumber + ": " + name;

    initMap();

    setTimeout(() => {
      if (map) map.invalidateSize();
    }, 150);

    await tryPlayThemeAudio();

    syncGroup();
    startGPS();
    listenTeacherCommands();
    listenGlobalCommands();
    listenBroadcastMessages();
    listenHardReset();
    listenStudentRanking();
    saveLocalState();

    byId("loginFeedback").innerText = "";
  } catch (error) {
    console.error("Fout bij starten van spel:", error);
    byId("loginFeedback").innerText = "Fout bij laden van het spel: " + (error?.message || error);
  }
}

async function restoreSessionIfPossible() {
  const hasSession = loadLocalState();
  if (!hasSession) return;

  if (!gameState.cityKey || !currentCityKey) return;

  if (gameState.cityKey !== currentCityKey) {
    clearLocalState();
    return;
  }

  await enableCompass();

  const theme = await loadThemeForCity(currentCityKey);
  applyTheme(theme);

  currentCheckpoints = await loadCheckpointsForCity(currentCityKey);
  cityLoaded = true;

  byId("loginCard").classList.add("hidden");
  byId("gameArea").classList.remove("hidden");
  byId("teamDisplay").innerText = "Groep " + gameState.groupNumber + ": " + gameState.groupName;

  initMap();

  setTimeout(() => {
    if (map) map.invalidateSize();
  }, 150);

  await tryPlayThemeAudio();

  syncGroup();
  startGPS();
  listenTeacherCommands();
  listenGlobalCommands();
  listenBroadcastMessages();
  listenHardReset();
  listenStudentRanking();
}

async function handleCityChange(cityKey) {
  currentCityKey = cityKey;
  setActiveCityUI(cityKey);

  if (!cityKey) {
    cityLoaded = false;
    applyTheme(null);
    return;
  }

  const theme = await loadThemeForCity(cityKey);
  applyTheme(theme);

  currentCheckpoints = await loadCheckpointsForCity(cityKey);
  cityLoaded = true;

  if (map) {
    resetMapToCity();
  }

  if (!gameState.groupId) {
    await restoreSessionIfPossible();
  }
}

async function bootstrapCurrentCity() {
  try {
    const snapshot = await get(ref(db, "control/currentCity"));
    if (snapshot.exists()) {
      const cityKey = snapshot.val();
      await handleCityChange(cityKey);
    }
  } catch (error) {
    console.error("Fout bij laden van actieve stad:", error);
  }
}

onValue(ref(db, "cities"), (snapshot) => {
  citiesCache = snapshot.val() || {};
  if (currentCityKey) {
    setActiveCityUI(currentCityKey);
    if (map) resetMapToCity();
  }
});

onValue(ref(db, "control/currentCity"), async (snapshot) => {
  const cityKey = snapshot.val();
  await handleCityChange(cityKey);
});

byId("startButton").onclick = startGame;
byId("submitAnswerButton").onclick = checkAnswer;

const closeMessageButton = byId("closeMessageButton");
if (closeMessageButton) {
  closeMessageButton.onclick = closeTeacherMessage;
}

bootstrapCurrentCity();
