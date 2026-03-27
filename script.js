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
let currentGameType = null;

let map = null;
let playerMarker = null;
let checkpointMarker = null;
let checkpointCircle = null;
let routeLine = null;
let searchZoneCircle = null;
let collectibleMarker = null;
let questionOpen = false;

let route = [];
let routeIndex = 0;
let currentCheckpoints = [];
let currentCityKey = null;

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
let activeCollectibleSearch = null;

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
  sessionStartedAt: 0,
  collectedEvidence: {},
  selectedEvidenceId: ""
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

let collectibleIcon = L.divIcon({
  className: "custom-emoji-icon",
  html: `<div style="font-size:30px; line-height:30px;">✨</div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 30],
  popupAnchor: [0, -26]
});

function byId(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const el = byId(id);
  if (el) el.innerText = value ?? "";
}

function setHtml(id, value) {
  const el = byId(id);
  if (el) el.innerHTML = value ?? "";
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
    } catch (e) {}
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "item";
}

function normalizeVideoUrl(url) {
  if (!url) return "";
  const raw = String(url).trim();
  if (!raw) return "";
  if (raw.includes("youtube.com/embed/") || raw.includes("player.vimeo.com/video/")) return raw;

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
  } catch {
    return raw;
  }
}

function normalizeGameType(raw) {
  return {
    name: raw?.name || "Klassiek",
    description: raw?.description || "",
    engine: raw?.engine || "classic",
    modules: {
      questions: raw?.modules?.questions ?? true,
      story: raw?.modules?.story ?? false,
      inventory: raw?.modules?.inventory ?? false,
      collectibles: raw?.modules?.collectibles ?? false,
      searchZones: raw?.modules?.searchZones ?? false,
      hiddenReveal: raw?.modules?.hiddenReveal ?? false,
      clickableItems: raw?.modules?.clickableItems ?? false,
      dialogs: raw?.modules?.dialogs ?? false,
      evidenceBook: raw?.modules?.evidenceBook ?? false,
      fingerprints: raw?.modules?.fingerprints ?? false,
      fakeClues: raw?.modules?.fakeClues ?? false,
      secretRoles: raw?.modules?.secretRoles ?? false,
      sabotage: raw?.modules?.sabotage ?? false,
      roleSwitch: raw?.modules?.roleSwitch ?? false,
      chase: raw?.modules?.chase ?? false,
      score: raw?.modules?.score ?? true,
      ranking: raw?.modules?.ranking ?? true,
      teacherControls: raw?.modules?.teacherControls ?? true
    },
    settings: {
      checkpointFlow: raw?.settings?.checkpointFlow || "rotatingRoute",
      collectibleUnlock: raw?.settings?.collectibleUnlock || "none",
      mapVisibility: raw?.settings?.mapVisibility || "none",
      finalObjective: raw?.settings?.finalObjective || "gatherPoint",
      searchRadius: Number(raw?.settings?.searchRadius || 30),
      revealDistance: Number(raw?.settings?.revealDistance || 15),
      maxTries: Number(raw?.settings?.maxTries || 3),
      scoreMode: raw?.settings?.scoreMode || "normal"
    },
    engineConfig: raw?.engineConfig || {}
  };
}

function hasModule(name) {
  return !!currentGameType?.modules?.[name];
}

function shouldUseInventoryUI() {
  return hasModule("inventory") || hasModule("evidenceBook") || hasModule("collectibles");
}

function getInventoryLabel() {
  if (!currentGameType) return "Dossier";
  if (currentGameType.engine === "collectibles") {
    return currentGameType.engineConfig?.inventoryName || "Dossier";
  }
  if (currentGameType.engine === "murder") {
    return currentGameType.engineConfig?.bookName || "Bewijsboek";
  }
  return currentGameType.engineConfig?.inventoryName || "Dossier";
}

function updateInventoryTexts() {
  const label = getInventoryLabel();
  const openButton = byId("openEvidenceButton");
  const modalTitle = byId("evidenceModal")?.querySelector("h2");
  const intro = byId("evidenceIntroText");

  if (openButton) openButton.innerText = `📂 Open ${label.toLowerCase()}`;
  if (modalTitle) modalTitle.innerText = label;

  if (intro) {
    if (currentGameType?.engine === "collectibles") {
      intro.innerText = `Verzamel verborgen voorwerpen en vul jullie ${label.toLowerCase()} aan.`;
    } else if (currentGameType?.engine === "murder") {
      intro.innerText = `Alle verzamelde bewijzen verschijnen in jullie ${label.toLowerCase()}.`;
    } else {
      intro.innerText = `Hier zie je de verzamelde items in jullie ${label.toLowerCase()}.`;
    }
  }
}

function applyGameTypeUI() {
  updateInventoryTexts();

  const showInventory = shouldUseInventoryUI();
  const openButton = byId("openEvidenceButton");
  const quickBar = byId("evidenceQuickBar");
  const rankingCard = byId("studentRankingContainer")?.closest(".card");

  if (openButton) openButton.style.display = showInventory ? "" : "none";
  if (quickBar) quickBar.classList.toggle("hidden", !showInventory);
  if (rankingCard) rankingCard.classList.toggle("hidden", !hasModule("ranking"));
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
        name: fallbackCity.gather?.name || "Verzamelpunt",
        coords: Array.isArray(fallbackCity.gather) ? fallbackCity.gather : (fallbackCity.gather?.coords || fallbackCity.center),
        radius: fallbackCity.gather?.radius || 40
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
      gameTypeId: firebaseCity.gameTypeId || "",
      defaultCheckpoints: fallbackCity?.defaultCheckpoints || []
    };
  }

  if (fallbackCity) {
    return {
      name: fallbackCity.name || cityKey,
      center: fallbackCity.center || [50.85, 4.35],
      gather: {
        name: fallbackCity.gather?.name || "Verzamelpunt",
        coords: Array.isArray(fallbackCity.gather) ? fallbackCity.gather : (fallbackCity.gather?.coords || fallbackCity.center),
        radius: fallbackCity.gather?.radius || 40
      },
      themeId: fallbackCity.themeId || "",
      gameTypeId: fallbackCity.gameTypeId || "",
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
    gameTypeId: "",
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

async function loadCheckpointsForCity(cityKey) {
  const snapshot = await get(ref(db, "cityData/" + cityKey + "/checkpoints"));
  if (snapshot.exists()) {
    const data = snapshot.val();
    if (Array.isArray(data) && data.length) return data;
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

async function loadGameTypeForCity(cityKey) {
  const citySnapshot = await get(ref(db, "cities/" + cityKey));
  if (!citySnapshot.exists()) {
    currentGameType = normalizeGameType({ engine: "classic" });
    return currentGameType;
  }

  const cityData = citySnapshot.val();
  const gameTypeId = cityData?.gameTypeId;

  if (!gameTypeId) {
    currentGameType = normalizeGameType({ engine: "classic" });
    return currentGameType;
  }

  const gameTypeSnapshot = await get(ref(db, "speltypes/" + gameTypeId));
  if (!gameTypeSnapshot.exists()) {
    currentGameType = normalizeGameType({ engine: "classic" });
    return currentGameType;
  }

  currentGameType = normalizeGameType(gameTypeSnapshot.val());
  return currentGameType;
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
  } catch (e) {
    console.log("Autoplay geblokkeerd:", e);
  }
}

function saveLocalState() {
  localStorage.setItem("cityEscapeState", JSON.stringify({
    gameState,
    route,
    routeIndex,
    currentCityKey
  }));
}

function loadLocalState() {
  const saved = localStorage.getItem("cityEscapeState");
  if (!saved) return false;

  const parsed = JSON.parse(saved);
  gameState = parsed.gameState || gameState;
  route = Array.isArray(parsed.route) ? parsed.route : [];
  routeIndex = Number.isInteger(parsed.routeIndex) ? parsed.routeIndex : 0;
  currentCityKey = parsed.currentCityKey || currentCityKey;
  gameState.collectedEvidence =
    gameState.collectedEvidence && typeof gameState.collectedEvidence === "object"
      ? gameState.collectedEvidence
      : {};
  gameState.selectedEvidenceId = gameState.selectedEvidenceId || "";
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

  if (titleEl) titleEl.innerText = `${city.name} Escape`;
}

function getCollectedEvidenceMap() {
  if (!gameState.collectedEvidence || typeof gameState.collectedEvidence !== "object") {
    gameState.collectedEvidence = {};
  }
  return gameState.collectedEvidence;
}

function hasCollectedEvidence(evidenceId) {
  return !!getCollectedEvidenceMap()[evidenceId];
}

function getCheckpointCollectible(cp, index = 0) {
  if (!cp || !cp.collectible) return null;

  const raw = cp.collectible;
  const id = slugify(raw.id || raw.name || cp.name || `item_${index + 1}`);

  return {
    id,
    name: raw.name || `Item ${index + 1}`,
    icon: raw.icon || "❓",
    description: raw.description || "Nieuw object toegevoegd.",
    lockedName: raw.lockedName || "Onbekend spoor",
    lockedIcon: raw.lockedIcon || "❓",
    coords: Array.isArray(cp.collectibleCoords) ? cp.collectibleCoords : cp.coords,
    searchRadius: Number(cp.collectibleSearchRadius || currentGameType?.settings?.searchRadius || 30),
    revealDistance: Number(cp.collectibleRevealDistance || currentGameType?.settings?.revealDistance || 15),
    suspectName: cp.suspectName || "",
    dialogText: cp.dialogText || "",
    hasFingerprint: !!cp.hasFingerprint,
    isFakeClue: !!cp.isFakeClue,
    evidenceIsCritical: !!cp.evidenceIsCritical,
    fingerprintLabel: cp.fingerprintLabel || ""
  };
}

function getEvidenceCatalog() {
  const seen = new Set();
  const catalog = [];

  currentCheckpoints.forEach((cp, index) => {
    const collectible = getCheckpointCollectible(cp, index);
    if (!collectible || seen.has(collectible.id)) return;
    seen.add(collectible.id);
    catalog.push(collectible);
  });

  return catalog;
}

function getSelectedEvidenceId() {
  const catalog = getEvidenceCatalog();
  if (!catalog.length) return "";

  if (gameState.selectedEvidenceId && catalog.some(item => item.id === gameState.selectedEvidenceId)) {
    return gameState.selectedEvidenceId;
  }

  const firstFound = catalog.find(item => hasCollectedEvidence(item.id));
  return (firstFound || catalog[0]).id;
}

function renderEvidenceQuickBar() {
  const quickSlots = byId("evidenceQuickSlots");
  const quickBar = byId("evidenceQuickBar");
  if (!quickSlots || !quickBar) return;

  if (!shouldUseInventoryUI()) {
    quickBar.classList.add("hidden");
    quickSlots.innerHTML = "";
    return;
  }

  const catalog = getEvidenceCatalog();
  if (!catalog.length) {
    quickBar.classList.add("hidden");
    quickSlots.innerHTML = "";
    return;
  }

  quickBar.classList.remove("hidden");
  quickSlots.innerHTML = "";

  catalog.forEach((item) => {
    const found = hasCollectedEvidence(item.id);
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = `evidence-slot ${found ? "found" : "locked"}`;
    slot.innerHTML = `
      <div class="evidence-slot-icon">${found ? escapeHtml(item.icon) : escapeHtml(item.lockedIcon)}</div>
      <div class="evidence-slot-name">${found ? escapeHtml(item.name) : escapeHtml(item.lockedName)}</div>
    `;
    slot.addEventListener("click", () => openEvidenceModal(item.id));
    quickSlots.appendChild(slot);
  });
}

function renderEvidenceDetail(evidenceId) {
  const detailIcon = byId("evidenceDetailIcon");
  const detailName = byId("evidenceDetailName");
  const detailDescription = byId("evidenceDetailDescription");
  const detailStatus = byId("evidenceDetailStatus");
  if (!detailIcon || !detailName || !detailDescription || !detailStatus) return;

  const catalog = getEvidenceCatalog();
  const item = catalog.find(entry => entry.id === evidenceId);

  if (!item) {
    detailIcon.innerText = "❓";
    detailName.innerText = "Nog geen item geselecteerd";
    detailDescription.innerText = "Klik op een item om meer informatie te bekijken.";
    detailStatus.innerText = "Status: onbekend";
    return;
  }

  const found = hasCollectedEvidence(item.id);
  detailIcon.innerText = found ? item.icon : item.lockedIcon;
  detailName.innerText = found ? item.name : item.lockedName;

  if (found) {
    let desc = item.description || "Nieuw item.";
    if (currentGameType?.engine === "murder") {
      const extras = [];
      if (item.suspectName) extras.push("Verdachte: " + item.suspectName);
      if (item.hasFingerprint) extras.push("Bevat afdruk" + (item.fingerprintLabel ? ` (${item.fingerprintLabel})` : ""));
      if (item.isFakeClue) extras.push("Mogelijk vals spoor");
      if (item.evidenceIsCritical) extras.push("Cruciaal bewijs");
      if (extras.length) desc += "\n\n" + extras.join("\n");
    }
    detailDescription.innerText = desc;
  } else {
    detailDescription.innerText = "Dit item werd nog niet vrijgespeeld of gevonden.";
  }

  detailStatus.innerText = found ? "Status: gevonden" : "Status: nog niet gevonden";
}

function renderEvidenceGrid() {
  const grid = byId("evidenceGrid");
  if (!grid) return;

  const catalog = getEvidenceCatalog();
  const selectedId = getSelectedEvidenceId();
  grid.innerHTML = "";

  catalog.forEach((item) => {
    const found = hasCollectedEvidence(item.id);
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = `evidence-slot ${found ? "found" : "locked"} ${selectedId === item.id ? "active" : ""}`;
    slot.innerHTML = `
      <div class="evidence-slot-icon">${found ? escapeHtml(item.icon) : escapeHtml(item.lockedIcon)}</div>
      <div class="evidence-slot-name">${found ? escapeHtml(item.name) : escapeHtml(item.lockedName)}</div>
    `;
    slot.addEventListener("click", () => {
      gameState.selectedEvidenceId = item.id;
      renderEvidenceUI();
      saveLocalState();
    });
    grid.appendChild(slot);
  });

  renderEvidenceDetail(selectedId);
}

function renderEvidenceUI() {
  applyGameTypeUI();
  renderEvidenceQuickBar();
  renderEvidenceGrid();
}

function openEvidenceModal(evidenceId = "") {
  if (!shouldUseInventoryUI()) return;
  const modal = byId("evidenceModal");
  if (!modal) return;

  gameState.selectedEvidenceId = evidenceId || getSelectedEvidenceId();
  renderEvidenceUI();
  modal.classList.remove("hidden");
}

function closeEvidenceModal() {
  byId("evidenceModal")?.classList.add("hidden");
}

function showFoundEvidenceModal(item) {
  if (!item || !shouldUseInventoryUI()) return;

  const modal = byId("evidenceFoundModal");
  const icon = byId("foundEvidenceIcon");
  const name = byId("foundEvidenceName");
  const description = byId("foundEvidenceDescription");

  if (icon) icon.innerText = item.icon || "✨";
  if (name) name.innerText = item.name || "Nieuw item";

  let text = item.description || "Dit item werd toegevoegd.";
  if (currentGameType?.engine === "murder") {
    const extras = [];
    if (item.suspectName) extras.push("Verdachte: " + item.suspectName);
    if (item.hasFingerprint) extras.push("Bevat afdruk" + (item.fingerprintLabel ? ` (${item.fingerprintLabel})` : ""));
    if (item.isFakeClue) extras.push("Let op: mogelijk vals spoor");
    if (extras.length) text += "\n\n" + extras.join("\n");
  }

  if (description) description.innerText = text;
  if (modal) modal.classList.remove("hidden");
}

function closeFoundEvidenceModal() {
  byId("evidenceFoundModal")?.classList.add("hidden");
}

function collectEvidenceItem(item, options = {}) {
  if (!item) return;

  const evidenceMap = getCollectedEvidenceMap();
  if (evidenceMap[item.id]) {
    if (activeCollectibleSearch && activeCollectibleSearch.item?.id === item.id) {
      finishCollectibleSearch();
    }
    return;
  }

  evidenceMap[item.id] = {
    id: item.id,
    name: item.name,
    icon: item.icon,
    description: item.description,
    foundAt: Date.now(),
    suspectName: item.suspectName || "",
    dialogText: item.dialogText || "",
    hasFingerprint: !!item.hasFingerprint,
    isFakeClue: !!item.isFakeClue,
    evidenceIsCritical: !!item.evidenceIsCritical,
    fingerprintLabel: item.fingerprintLabel || ""
  };

  gameState.selectedEvidenceId = item.id;
  renderEvidenceUI();
  saveLocalState();
  syncGroup();

  if (options.showModal !== false) {
    showFoundEvidenceModal(item);
  }

  if (activeCollectibleSearch && activeCollectibleSearch.item?.id === item.id) {
    finishCollectibleSearch();
  }
}

function clearSearchCollectibleLayers() {
  if (searchZoneCircle && map) {
    map.removeLayer(searchZoneCircle);
    searchZoneCircle = null;
  }

  if (collectibleMarker && map) {
    map.removeLayer(collectibleMarker);
    collectibleMarker = null;
  }
}

function getCurrentCheckpoint() {
  return currentCheckpoints[route[routeIndex]];
}

function getActiveTarget() {
  if (activeCollectibleSearch?.item?.coords) {
    return {
      name: activeCollectibleSearch.item.name,
      coords: activeCollectibleSearch.item.coords,
      radius: activeCollectibleSearch.item.searchRadius || currentGameType?.settings?.searchRadius || 30,
      type: "collectible"
    };
  }

  if (gameState.gatherMode || gameState.finished) {
    const gather = getGatherCheckpoint(currentCityKey);
    return { ...gather, type: "gather" };
  }

  const cp = currentCheckpoints[route[routeIndex]];
  if (!cp) return null;
  return { ...cp, type: "checkpoint" };
}

function getCurrentMarkerIcon() {
  if (gameState.gatherMode || gameState.finished) return gatherIcon;
  return checkpointIcon;
}

function getCurrentTargetName() {
  const target = getActiveTarget();
  return target ? target.name : "-";
}

function getCollectibleVisibilityMode() {
  return currentGameType?.settings?.mapVisibility || "none";
}

function updateCollectibleMarkerVisibility(lat, lng) {
  if (!activeCollectibleSearch || !map) return;

  const item = activeCollectibleSearch.item;
  const visibility = getCollectibleVisibilityMode();
  const revealDistance = Number(item.revealDistance || currentGameType?.settings?.revealDistance || 15);
  const searchRadius = Number(item.searchRadius || currentGameType?.settings?.searchRadius || 30);
  const dist = map.distance([lat, lng], item.coords);

  if (visibility === "none") {
    if (collectibleMarker) {
      map.removeLayer(collectibleMarker);
      collectibleMarker = null;
    }
    return;
  }

  if (visibility === "blurZone") {
    const shouldShowMarker =
      (hasModule("clickableItems") || currentGameType?.engine === "collectibles" || currentGameType?.engine === "murder") &&
      dist <= searchRadius;

    if (!shouldShowMarker) {
      if (collectibleMarker) {
        map.removeLayer(collectibleMarker);
        collectibleMarker = null;
      }
      return;
    }

    if (!collectibleMarker) {
      const iconHtml = item.icon || "✨";
      collectibleIcon = L.divIcon({
        className: "custom-emoji-icon",
        html: `<div style="font-size:34px; line-height:34px; filter: drop-shadow(0 0 10px rgba(217,74,255,1));">${iconHtml}</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 34],
        popupAnchor: [0, -26]
      });

      collectibleMarker = L.marker(item.coords, { icon: collectibleIcon }).addTo(map);
      collectibleMarker.on("click", () => collectEvidenceItem(item));
      collectibleMarker.bindPopup(item.name || "Verborgen object");
    } else {
      collectibleMarker.setLatLng(item.coords);
    }
    return;
  }

  const shouldShow = visibility === "alwaysVisible" || (visibility === "showWhenNearby" && dist <= revealDistance);

  if (!shouldShow) {
    if (collectibleMarker) {
      map.removeLayer(collectibleMarker);
      collectibleMarker = null;
    }
    return;
  }

  if (!collectibleMarker) {
    const iconHtml = item.icon || "✨";
    collectibleIcon = L.divIcon({
      className: "custom-emoji-icon",
      html: `<div style="font-size:34px; line-height:34px; filter: drop-shadow(0 0 10px rgba(217,74,255,1));">${iconHtml}</div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 34],
      popupAnchor: [0, -26]
    });

    collectibleMarker = L.marker(item.coords, { icon: collectibleIcon }).addTo(map);
    collectibleMarker.on("click", () => collectEvidenceItem(item));
    collectibleMarker.bindPopup(item.name || "Verborgen object");
  } else {
    collectibleMarker.setLatLng(item.coords);
  }
}

function startCollectibleSearch(cp) {
  const item = getCheckpointCollectible(cp, routeIndex);
  if (!item || !item.coords || !hasModule("collectibles")) {
    nextCheckpoint();
    return;
  }

  activeCollectibleSearch = {
    checkpointName: cp.name || "Checkpoint",
    item
  };

  clearSearchCollectibleLayers();

  if (checkpointMarker && map) {
    map.removeLayer(checkpointMarker);
    checkpointMarker = null;
  }

  if (checkpointCircle && map) {
    map.removeLayer(checkpointCircle);
    checkpointCircle = null;
  }

  if (map) {
    searchZoneCircle = L.circle(item.coords, {
      radius: item.searchRadius || currentGameType?.settings?.searchRadius || 30,
      className: "collectible-search-zone",
      color: "#d652ff",
      weight: 5,
      opacity: 0.95,
      fillColor: "#a000ff",
      fillOpacity: 0.18
    }).addTo(map);
  }

  setText("status", `Zoek het verborgen object in de aangeduide zone: ${item.name}.`);

  closeQuestion();
  renderEvidenceUI();
  saveLocalState();

  if (lastKnownLat !== null && lastKnownLng !== null) {
    updateNavigation(lastKnownLat, lastKnownLng);
    updateRouteLine(lastKnownLat, lastKnownLng);
    updateCollectibleMarkerVisibility(lastKnownLat, lastKnownLng);
  }
}

function finishCollectibleSearch() {
  activeCollectibleSearch = null;
  clearSearchCollectibleLayers();
  nextCheckpoint();
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

function buildExtendedStory(cp) {
  const parts = [];

  if (hasModule("story") && cp.story && String(cp.story).trim()) {
    parts.push(String(cp.story).trim());
  }

  if ((currentGameType?.engine === "murder" || hasModule("dialogs")) && cp.dialogText && String(cp.dialogText).trim()) {
    parts.push("Getuigenis: " + String(cp.dialogText).trim());
  }

  return parts.join("\n\n");
}

function renderCheckpointMedia(cp) {
  const storyEl = byId("modalStory");
  const videoEl = byId("modalVideo");
  const audioEl = byId("modalAudio");
  const imageEl = byId("modalImage");

  resetCheckpointMedia();

  const fullStory = buildExtendedStory(cp);
  if (storyEl && fullStory) {
    storyEl.innerText = fullStory;
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

function normalizeTaskType(cp) {
  return cp.taskType || cp.type || "text";
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
    if (currentPuzzleSelectedIndex === index) tile.classList.add("selected");

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

    if (photoStatus) photoStatus.innerText = "Foto gekozen. Klik op 'Controleer opdracht' om te verzenden.";
  };
}

function renderTaskUI(cp) {
  hideAllTaskWrappers();
  resetPhotoTaskUI();

  const taskType = normalizeTaskType(cp);

  if (taskType === "text" || taskType === "riddle") {
    byId("taskTextWrapper")?.classList.remove("hidden-task");
    const input = byId("modalAnswerInput");
    if (input) {
      input.value = "";
      input.placeholder = taskType === "riddle" ? "Typ hier jullie oplossing" : "Typ hier jullie antwoord";
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
        label.innerHTML = `<input type="radio" name="mcOption" value="${index}"> ${option}`;
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

function initMap() {
  if (!currentCityKey) return;

  const center = getCityRecord(currentCityKey).center;
  if (map) {
    map.remove();
    map = null;
  }

  const mapEl = byId("map");
  if (!mapEl) return;

  map = L.map("map").setView(center, 16);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "OpenStreetMap"
  }).addTo(map);

  loadCheckpoint();
}

function updateRouteLine(lat, lng) {
  const target = getActiveTarget();
  if (!target || !map) return;

  if (routeLine) map.removeLayer(routeLine);

  routeLine = L.polyline([[lat, lng], target.coords], {
    weight: 4,
    opacity: 0.8
  }).addTo(map);
}

function getBearing(lat1, lng1, lat2, lng2) {
  const toRadians = deg => (deg * Math.PI) / 180;
  const toDegrees = rad => (rad * 180) / Math.PI;

  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const λ1 = toRadians(lng1);
  const λ2 = toRadians(lng2);

  const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);

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
  const target = getActiveTarget();
  if (!target) return;

  const arrowEl = byId("arrow");
  if (!arrowEl) return;

  const targetBearing = getBearing(lat, lng, target.coords[0], target.coords[1]);

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

  if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
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

function updateLocation(lat, lng) {
  lastKnownLat = lat;
  lastKnownLng = lng;

  if (!playerMarker) {
    playerMarker = L.marker([lat, lng], { icon: playerIcon }).addTo(map).bindPopup("Jullie locatie");
  } else {
    playerMarker.setLatLng([lat, lng]);
  }

  updateRouteLine(lat, lng);
  updateNavigation(lat, lng);
  checkDistance(lat, lng);
  syncGroup(lat, lng);
}

function checkDistance(lat, lng) {
  const target = getActiveTarget();
  if (!target || !map) return;

  const dist = map.distance([lat, lng], target.coords);
  setText("distanceText", "Afstand: " + Math.round(dist) + " m");

  if (activeCollectibleSearch) {
    setText("status", "Zoek het verborgen object. Nog " + Math.round(dist) + " meter tot de zone.");

    updateCollectibleMarkerVisibility(lat, lng);

    const item = activeCollectibleSearch.item;
    const revealDistance = Number(item.revealDistance || currentGameType?.settings?.revealDistance || 15);
    const searchRadius = Number(item.searchRadius || currentGameType?.settings?.searchRadius || 30);

    if ((getCollectibleVisibilityMode() === "showWhenNearby" || getCollectibleVisibilityMode() === "alwaysVisible") && dist <= revealDistance) {
      if (!hasModule("clickableItems")) {
        collectEvidenceItem(item);
        return;
      }
    }

    if (getCollectibleVisibilityMode() === "blurZone" && dist <= searchRadius) {
      if (!hasModule("clickableItems")) {
        collectEvidenceItem(item);
        return;
      }
      setText("status", "Jullie zitten in de zoekzone. Zoek en klik het object aan.");
    }

    return;
  }

  if (gameState.gatherMode) {
    if (dist < target.radius) {
      setText("status", "Jullie zijn aangekomen op het verzamelpunt. Wacht op verdere instructies.");
    } else {
      setText("status", "Ga naar het verzamelpunt. Nog " + Math.round(dist) + " meter.");
    }
    return;
  }

  if (gameState.finished) {
    if (dist < target.radius) {
      setText("status", "Jullie zijn aangekomen op het verzamelpunt. Proficiat.");
    } else {
      setText("status", "Proficiat. Ga nu naar het verzamelpunt. Nog " + Math.round(dist) + " meter.");
    }
    return;
  }

  if (dist < target.radius) {
    setText("status", "Jullie zijn aangekomen bij " + target.name + ".");
    if (!questionOpen) openQuestion();
  } else {
    setText("status", "Nog " + Math.round(dist) + " meter tot " + target.name + ".");
  }
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
  if (!navigator.geolocation) {
    setText("status", "GPS wordt niet ondersteund.");
    return;
  }

  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
  }

  gpsWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const now = Date.now();
      const rawLat = pos.coords.latitude;
      const rawLng = pos.coords.longitude;
      const accuracy = pos.coords.accuracy || 9999;

      updateGpsStatus(accuracy <= 25, "GPS-status: " + Math.round(accuracy) + " m nauwkeurigheid");

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
        if (moved < GPS_MIN_DISTANCE_METERS && tooSoon) return;
      }

      lastProcessedLat = filteredLat;
      lastProcessedLng = filteredLng;
      lastLocationUpdateTime = now;

      updateLocation(filteredLat, filteredLng);
    },
    (err) => {
      updateGpsStatus(false, "GPS-status: fout");
      setText("status", "GPS kon niet worden opgehaald.");
      console.error(err);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000
    }
  );
}

function openQuestion() {
  if (gameState.gatherMode || gameState.finished || activeCollectibleSearch) return;

  const cp = getCurrentCheckpoint();
  if (!cp) return;

  questionOpen = true;
  setText("modalTitle", cp.name);
  renderCheckpointMedia(cp);
  setText("modalQuestion", cp.question);
  renderTaskUI(cp);
  byId("questionModal")?.classList.remove("hidden");
}

function closeQuestion() {
  byId("questionModal")?.classList.add("hidden");
  resetCheckpointMedia();
  questionOpen = false;
}

function showTeacherMessage(text) {
  setText("teacherMessageText", text);
  byId("messageModal")?.classList.remove("hidden");
}

function closeTeacherMessage() {
  byId("messageModal")?.classList.add("hidden");
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
    const input = (byId("modalAnswerInput")?.value || "").toLowerCase().trim();
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

    await update(ref(db, `uploadQueue/${currentCityKey}/${gameState.groupId}/${safeCheckpointName}`), queueData);

    uploadedPhotoPending = true;
    if (photoStatus) photoStatus.innerText = "Foto doorgestuurd. De verwerking kan even duren.";
    return true;
  } catch (error) {
    console.error("Foto-upload mislukt:", error);
    if (photoStatus) photoStatus.innerText = "Upload mislukt: " + error.message;
    return false;
  }
}

function generateRoute(groupNumber, checkpointCount) {
  const flow = currentGameType?.settings?.checkpointFlow || "rotatingRoute";

  if (flow === "route" || flow === "freeRoam") {
    return [...Array(checkpointCount).keys()];
  }

  const start = (groupNumber - 1) % checkpointCount;
  const r = [];

  for (let i = 0; i < checkpointCount; i++) {
    r.push((start + i) % checkpointCount);
  }

  return r;
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

function getCheckpointNameForSync() {
  if (activeCollectibleSearch) return "Zoekobject";
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
    score: hasModule("score") ? gameState.score : 0,
    checkpoint: getCheckpointNameForSync(),
    nextCheckpoint: getCurrentTargetName(),
    gatherMode: gameState.gatherMode || gameState.finished,
    finished: gameState.finished,
    routeIndex,
    collectedEvidenceIds: Object.keys(getCollectedEvidenceMap()),
    evidenceCount: Object.keys(getCollectedEvidenceMap()).length,
    gameTypeName: currentGameType?.name || "Klassiek",
    gameTypeEngine: currentGameType?.engine || "classic",
    lastUpdated: new Date().toISOString()
  };

  if (lat !== null && lng !== null) {
    payload.lat = lat;
    payload.lng = lng;
  }

  update(ref(db, "groups/" + gameState.groupId), payload);
}

function finishGame() {
  gameState.finished = true;
  gameState.gatherMode = false;
  activeCollectibleSearch = null;
  clearSearchCollectibleLayers();
  closeQuestion();

  const gather = getGatherCheckpoint(currentCityKey);

  setText("modeText", "Spelmodus: afgerond");
  setText("progressText", "Alle checkpoints afgerond");

  if (hasModule("score")) {
    setText("scoreText", "Eindscore: " + gameState.score);
  }

  let message = "Proficiat! 🎉\n\nJullie hebben alle checkpoints voltooid.";
  if (hasModule("score")) message += "\n\nJullie score: " + gameState.score + " punten.";
  if (shouldUseInventoryUI()) message += "\nVerzamelde items: " + Object.keys(getCollectedEvidenceMap()).length + ".";
  message += "\n\nGa nu naar het verzamelpunt.";

  alert(message);

  if (checkpointMarker) map.removeLayer(checkpointMarker);
  if (checkpointCircle) map.removeLayer(checkpointCircle);

  checkpointMarker = L.marker(gather.coords, { icon: gatherIcon }).addTo(map).bindPopup(gather.name).openPopup();
  checkpointCircle = L.circle(gather.coords, { radius: gather.radius }).addTo(map);

  map.setView(gather.coords, 18);
  setText("status", "Proficiat. Ga nu naar het verzamelpunt.");

  if (lastKnownLat !== null && lastKnownLng !== null) {
    updateNavigation(lastKnownLat, lastKnownLng);
    updateRouteLine(lastKnownLat, lastKnownLng);
  }

  saveLocalState();
  syncGroup();
}

function nextCheckpoint() {
  closeQuestion();
  gameState.currentTries = 0;
  routeIndex++;
  currentPuzzleOrder = [];
  currentPuzzleSelectedIndex = null;
  resetPhotoTaskUI();
  activeCollectibleSearch = null;
  clearSearchCollectibleLayers();

  if (routeIndex >= route.length) {
    finishGame();
    return;
  }

  loadCheckpoint();
  saveLocalState();
  syncGroup();
}

function handleCheckpointSuccess(cp, reason = "correct") {
  const unlockMode = currentGameType?.settings?.collectibleUnlock || "none";

  const shouldCollectDirectly =
    hasModule("collectibles") &&
    (
      unlockMode === "afterCorrect" ||
      (unlockMode === "afterCorrectOrMaxTries" && reason === "correct")
    );

  const shouldSearchAfter =
    hasModule("collectibles") &&
    (
      unlockMode === "searchZoneAfterCorrect" ||
      (unlockMode === "searchZoneAfterCorrectOrMaxTries" && reason === "correct")
    );

  if (shouldCollectDirectly) {
    const item = getCheckpointCollectible(cp, routeIndex);
    if (item) collectEvidenceItem(item);
    nextCheckpoint();
    return;
  }

  if (shouldSearchAfter) {
    startCollectibleSearch(cp);
    return;
  }

  nextCheckpoint();
}

function handleWrongAttempt(cp) {
  gameState.currentTries++;
  const maxTries = Number(currentGameType?.settings?.maxTries || 3);

  if (gameState.currentTries >= maxTries) {
    if (hasModule("score")) {
      gameState.score += Number(cp.pointsAfterMaxTries || 0);
    }

    const unlockMode = currentGameType?.settings?.collectibleUnlock || "none";

    const shouldCollectOnMax =
      hasModule("collectibles") &&
      (
        unlockMode === "afterMaxTries" ||
        unlockMode === "afterCorrectOrMaxTries"
      );

    const shouldSearchOnMax =
      hasModule("collectibles") &&
      unlockMode === "searchZoneAfterCorrectOrMaxTries";

    if (shouldCollectOnMax) {
      const item = getCheckpointCollectible(cp, routeIndex);
      if (item) collectEvidenceItem(item);
      nextCheckpoint();
      return;
    }

    if (shouldSearchOnMax) {
      startCollectibleSearch(cp);
      return;
    }

    nextCheckpoint();
  } else {
    setText("answerFeedback", "Niet juist, probeer opnieuw.");
    setText("triesFeedback", "Pogingen over: " + (maxTries - gameState.currentTries));
  }

  saveLocalState();
}

async function checkAnswer() {
  const cp = getCurrentCheckpoint();
  if (!cp || gameState.finished || activeCollectibleSearch) return;

  const taskType = normalizeTaskType(cp);

  if (taskType === "photo" && !uploadedPhotoPending) {
    const uploaded = await uploadPhotoForCheckpoint(cp);
    if (!uploaded) return;
  }

  const correct = checkCurrentTask();

  if (correct) {
    if (hasModule("score")) {
      gameState.score += Number(cp.pointsCorrect || 0);
    }
    handleCheckpointSuccess(cp, "correct");
    return;
  }

  handleWrongAttempt(cp);
}

function loadCheckpoint() {
  const target = getActiveTarget();
  const cp = getCurrentCheckpoint();
  const markerIcon = getCurrentMarkerIcon();

  if (!target || !map) return;

  clearSearchCollectibleLayers();

  if (checkpointMarker) map.removeLayer(checkpointMarker);
  if (checkpointCircle) map.removeLayer(checkpointCircle);

  checkpointMarker = L.marker(target.coords, { icon: markerIcon }).addTo(map).bindPopup(target.name);
  checkpointCircle = L.circle(target.coords, { radius: target.radius }).addTo(map);

  if (gameState.gatherMode) {
    setText("modeText", "Spelmodus: verzamelpunt");
    setText("progressText", "Iedereen naar het verzamelpunt");
  } else if (gameState.finished) {
    setText("modeText", "Spelmodus: afgerond");
    setText("progressText", "Alle checkpoints afgerond");
  } else if (activeCollectibleSearch) {
    setText("modeText", "Spelmodus: zoek object");
    setText("progressText", `Zoek het object voor ${activeCollectibleSearch.checkpointName}`);
  } else {
    setText("modeText", `Spelmodus: ${currentGameType?.name || "normaal"}`);
    setText("progressText", "Checkpoint " + (routeIndex + 1) + " / " + route.length);
  }

  const scoreEl = byId("scoreText");
  if (hasModule("score")) {
    setText("scoreText", (gameState.finished ? "Eindscore: " : "Score: ") + gameState.score);
    if (scoreEl) scoreEl.style.display = "";
  } else {
    if (scoreEl) scoreEl.style.display = "none";
  }

  setText("answerFeedback", "");
  setText("triesFeedback", "");
  if (byId("modalAnswerInput")) byId("modalAnswerInput").value = "";
  currentPuzzleOrder = [];
  currentPuzzleSelectedIndex = null;
  resetPhotoTaskUI();
  resetCheckpointMedia();

  if (!gameState.gatherMode && !gameState.finished && !activeCollectibleSearch && cp) {
    renderTaskUI(cp);
  }

  closeQuestion();
  questionOpen = false;
  renderEvidenceUI();
  saveLocalState();

  if (lastKnownLat !== null && lastKnownLng !== null) {
    updateNavigation(lastKnownLat, lastKnownLng);
    updateRouteLine(lastKnownLat, lastKnownLng);
  }
}

function listenTeacherCommands() {
  if (groupListenerStarted || !gameState.groupId) return;
  groupListenerStarted = true;

  onValue(ref(db, "groups/" + gameState.groupId), (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    if (data.commandNextAt && data.commandNextAt > gameState.lastProcessedNextAt) {
      gameState.lastProcessedNextAt = data.commandNextAt;
      if (!gameState.gatherMode && !gameState.finished && !activeCollectibleSearch) {
        nextCheckpoint();
      }
      saveLocalState();
    }

    if (data.commandPointsAt && data.commandPointsAt > gameState.lastProcessedPointsAt) {
      gameState.lastProcessedPointsAt = data.commandPointsAt;
      if (hasModule("score")) {
        gameState.score += Number(data.commandPointsValue || 0);
        setText("scoreText", (gameState.finished ? "Eindscore: " : "Score: ") + gameState.score);
      }
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
      activeCollectibleSearch = null;
      clearSearchCollectibleLayers();
      closeQuestion();
      loadCheckpoint();
      setText("status", "De begeleider heeft iedereen naar het verzamelpunt gestuurd.");
    }

    if (data.type === "resume") {
      if (!gameState.finished) {
        gameState.gatherMode = false;
        closeQuestion();
        loadCheckpoint();
        setText("status", "Het normale spel is hervat.");
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

    if (!data || !currentCityKey || !hasModule("ranking")) {
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

      let rightText = `${g.score || 0} punten`;
      if (shouldUseInventoryUI()) rightText += ` | 🧾 ${g.evidenceCount || 0}`;

      row.innerHTML = `
        <span>${index + 1}. Groep ${g.groupNumber}: ${g.groupName}</span>
        <span>${rightText}</span>
      `;
      container.appendChild(row);
    });
  });
}

async function startGame() {
  const name = byId("groupName")?.value?.trim() || "";
  const members = byId("groupMembers")?.value?.trim() || "";

  if (!name || !members) {
    setText("loginFeedback", "Vul alles in.");
    return;
  }

  setText("loginFeedback", "Spel wordt geladen...");

  try {
    const citySnapshot = await get(ref(db, "control/currentCity"));

    if (!citySnapshot.exists()) {
      setText("loginFeedback", "De leerkracht heeft nog geen stad geactiveerd.");
      return;
    }

    const cityKey = citySnapshot.val();
    currentCityKey = cityKey;

    await loadGameTypeForCity(cityKey);
    setActiveCityUI(cityKey);
    applyGameTypeUI();

    const theme = await loadThemeForCity(cityKey);
    applyTheme(theme);

    currentCheckpoints = await loadCheckpointsForCity(cityKey);

    if (!currentCheckpoints || !currentCheckpoints.length) {
      setText("loginFeedback", "Er zijn nog geen checkpoints ingesteld voor deze stad.");
      return;
    }

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
    gameState.collectedEvidence = {};
    gameState.selectedEvidenceId = "";

    route = generateRoute(gameState.groupNumber, currentCheckpoints.length);
    routeIndex = 0;
    activeCollectibleSearch = null;

    byId("loginCard")?.classList.add("hidden");
    byId("gameArea")?.classList.remove("hidden");
    setText("teamDisplay", "Groep " + gameState.groupNumber + ": " + name);

    renderEvidenceUI();
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

    setText("loginFeedback", "");
  } catch (error) {
    console.error("Fout bij starten van spel:", error);
    setText("loginFeedback", "Fout bij laden van het spel: " + (error?.message || error));
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

  await loadGameTypeForCity(currentCityKey);
  setActiveCityUI(currentCityKey);
  applyGameTypeUI();

  await enableCompass();

  const theme = await loadThemeForCity(currentCityKey);
  applyTheme(theme);

  currentCheckpoints = await loadCheckpointsForCity(currentCityKey);

  byId("loginCard")?.classList.add("hidden");
  byId("gameArea")?.classList.remove("hidden");
  setText("teamDisplay", "Groep " + gameState.groupNumber + ": " + gameState.groupName);

  renderEvidenceUI();
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

  if (!cityKey) {
    currentGameType = normalizeGameType({ engine: "classic" });
    applyGameTypeUI();
    applyTheme(null);
    return;
  }

  await loadGameTypeForCity(cityKey);
  setActiveCityUI(cityKey);
  applyGameTypeUI();

  const theme = await loadThemeForCity(cityKey);
  applyTheme(theme);

  currentCheckpoints = await loadCheckpointsForCity(cityKey);
  renderEvidenceUI();

  if (map) {
    map.setView(getCityRecord(cityKey).center, 16);
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

function bindUI() {
  const startButton = byId("startButton");
  if (startButton) startButton.addEventListener("click", startGame);

  const submitAnswerButton = byId("submitAnswerButton");
  if (submitAnswerButton) submitAnswerButton.addEventListener("click", checkAnswer);

  const closeMessageButton = byId("closeMessageButton");
  if (closeMessageButton) closeMessageButton.addEventListener("click", closeTeacherMessage);

  const openEvidenceButton = byId("openEvidenceButton");
  if (openEvidenceButton) openEvidenceButton.addEventListener("click", () => openEvidenceModal());

  const closeEvidenceButton = byId("closeEvidenceButton");
  if (closeEvidenceButton) closeEvidenceButton.addEventListener("click", closeEvidenceModal);

  const closeFoundEvidenceButton = byId("closeFoundEvidenceButton");
  if (closeFoundEvidenceButton) closeFoundEvidenceButton.addEventListener("click", closeFoundEvidenceModal);

  renderEvidenceUI();
  bootstrapCurrentCity().catch((error) => {
    console.error("Fout bij bootstrapCurrentCity:", error);
  });
}

onValue(ref(db, "cities"), (snapshot) => {
  citiesCache = snapshot.val() || {};
  if (currentCityKey) {
    setActiveCityUI(currentCityKey);
    if (map) {
      map.setView(getCityRecord(currentCityKey).center, map.getZoom() || 16);
    }
  }
});

onValue(ref(db, "control/currentCity"), async (snapshot) => {
  const cityKey = snapshot.val();
  await handleCityChange(cityKey);
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindUI);
} else {
  bindUI();
}
