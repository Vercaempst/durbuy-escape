import { cities, getGatherCheckpoint } from "./cities.js";
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

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzvFlESGMqtYAbYMtRtCJhL511GNhRLUquYGcktW-2P7frf8Ay0b13IW0ZKmXRq8s2M/exec";

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

const playerIcon = L.divIcon({
  className: "custom-emoji-icon",
  html: `<div style="font-size:32px; line-height:32px;">🚶</div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -28]
});

const checkpointIcon = L.divIcon({
  className: "custom-emoji-icon",
  html: `<div style="font-size:30px; line-height:30px;">🚩</div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 30],
  popupAnchor: [0, -26]
});

const gatherIcon = L.divIcon({
  className: "custom-emoji-icon",
  html: `<div style="font-size:30px; line-height:30px;">⭐</div>`,
  iconSize: [30, 30],
  iconAnchor: [15, 30],
  popupAnchor: [0, -26]
});

function saveLocalState() {
  localStorage.setItem(
    "cityEscapeState",
    JSON.stringify({
      gameState,
      route,
      routeIndex
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
  return true;
}

function clearLocalState() {
  localStorage.removeItem("cityEscapeState");
}

function setActiveCityUI(cityKey) {
  const titleEl = document.getElementById("appTitle");

  if (!cityKey || !cities[cityKey]) {
    if (titleEl) titleEl.innerText = "City Escape";
    return;
  }

  if (titleEl) {
    titleEl.innerText = cities[cityKey].name + " Escape";
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

  return cities[cityKey].defaultCheckpoints || [];
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
  const center = cities[currentCityKey].center;

  map = L.map("map").setView(center, 16);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "OpenStreetMap"
  }).addTo(map);

  loadCheckpoint();
}

function resetMapToCity() {
  const center = cities[currentCityKey].center;
  map.setView(center, 16);
}

function hideAllTaskWrappers() {
  document.getElementById("taskTextWrapper").classList.add("hidden-task");
  document.getElementById("taskMultipleChoiceWrapper").classList.add("hidden-task");
  document.getElementById("taskMatchingWrapper").classList.add("hidden-task");
  document.getElementById("taskImagePuzzleWrapper").classList.add("hidden-task");
  document.getElementById("taskPhotoWrapper").classList.add("hidden-task");
}

function resetPhotoTaskUI() {
  selectedPhotoFile = null;
  uploadedPhotoPending = false;

  const photoInput = document.getElementById("photoInput");
  const photoPreview = document.getElementById("photoPreview");
  const photoStatus = document.getElementById("photoUploadStatus");

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
  const grid = document.getElementById("puzzleGrid");

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
  const photoInput = document.getElementById("photoInput");
  const photoPreview = document.getElementById("photoPreview");
  const photoStatus = document.getElementById("photoUploadStatus");

  if (!photoInput) return;

  photoInput.onchange = () => {
    const file = photoInput.files && photoInput.files[0] ? photoInput.files[0] : null;
    selectedPhotoFile = file || null;
    uploadedPhotoPending = false;

    if (!file) {
      photoPreview.src = "";
      photoPreview.classList.add("hidden-task");
      photoStatus.innerText = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      photoPreview.src = e.target.result;
      photoPreview.classList.remove("hidden-task");
    };
    reader.readAsDataURL(file);

    photoStatus.innerText = "Foto gekozen. Klik op 'Controleer opdracht' om te uploaden.";
  };
}

function renderTaskUI(cp) {
  hideAllTaskWrappers();
  resetPhotoTaskUI();

  const taskType = normalizeTaskType(cp);

  if (taskType === "text" || taskType === "riddle") {
    document.getElementById("taskTextWrapper").classList.remove("hidden-task");
    document.getElementById("modalAnswerInput").value = "";
    document.getElementById("modalAnswerInput").placeholder =
      taskType === "riddle" ? "Typ hier jullie oplossing" : "Typ hier jullie antwoord";
  }

  if (taskType === "multipleChoice") {
    document.getElementById("taskMultipleChoiceWrapper").classList.remove("hidden-task");
    const container = document.getElementById("multipleChoiceOptions");
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

  if (taskType === "matching") {
    document.getElementById("taskMatchingWrapper").classList.remove("hidden-task");
    const container = document.getElementById("matchingContainer");
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

  if (taskType === "imagePuzzle") {
    document.getElementById("taskImagePuzzleWrapper").classList.remove("hidden-task");
    renderImagePuzzle(cp);
  }

  if (taskType === "photo") {
    document.getElementById("taskPhotoWrapper").classList.remove("hidden-task");
    attachPhotoListeners();
  }
}

function loadCheckpoint() {
  const cp = getCurrentCheckpoint();
  const markerIcon = getCurrentMarkerIcon();

  if (checkpointMarker) map.removeLayer(checkpointMarker);
  if (checkpointCircle) map.removeLayer(checkpointCircle);

  checkpointMarker = L.marker(cp.coords, { icon: markerIcon })
    .addTo(map)
    .bindPopup(cp.name);

  checkpointCircle = L.circle(cp.coords, { radius: cp.radius }).addTo(map);

  if (gameState.gatherMode) {
    document.getElementById("modeText").innerText = "Spelmodus: verzamelpunt";
    document.getElementById("progressText").innerText = "Iedereen naar het verzamelpunt";
  } else if (gameState.finished) {
    document.getElementById("modeText").innerText = "Spelmodus: afgerond";
    document.getElementById("progressText").innerText = "Alle checkpoints afgerond";
  } else {
    document.getElementById("modeText").innerText = "Spelmodus: normaal";
    document.getElementById("progressText").innerText =
      "Checkpoint " + (routeIndex + 1) + " / " + route.length;
  }

  document.getElementById("scoreText").innerText =
    (gameState.finished ? "Eindscore: " : "Score: ") + gameState.score;

  document.getElementById("answerFeedback").innerText = "";
  document.getElementById("triesFeedback").innerText = "";
  document.getElementById("modalAnswerInput").value = "";
  currentPuzzleOrder = [];
  currentPuzzleSelectedIndex = null;
  resetPhotoTaskUI();

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
  if (!cp) return;

  const dist = map.distance([lat, lng], cp.coords);
  document.getElementById("distanceText").innerText = "Afstand: " + Math.round(dist) + " m";

  if (gameState.gatherMode) {
    if (dist < cp.radius) {
      document.getElementById("status").innerText =
        "Jullie zijn aangekomen op het verzamelpunt. Wacht op verdere instructies.";
    } else {
      document.getElementById("status").innerText =
        "Ga naar het verzamelpunt. Nog " + Math.round(dist) + " meter.";
    }
    return;
  }

  if (gameState.finished) {
    if (dist < cp.radius) {
      document.getElementById("status").innerText =
        "Jullie zijn aangekomen op het verzamelpunt. Proficiat met jullie score.";
    } else {
      document.getElementById("status").innerText =
        "Proficiat. Ga nu naar het verzamelpunt. Nog " + Math.round(dist) + " meter.";
    }
    return;
  }

  if (dist < cp.radius) {
    document.getElementById("status").innerText = "Jullie zijn aangekomen bij " + cp.name + ".";
    if (!questionOpen) {
      openQuestion();
    }
  } else {
    document.getElementById("status").innerText =
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

function updateNavigation(lat, lng) {
  const cp = getCurrentCheckpoint();
  if (!cp) return;

  const targetBearing = getBearing(lat, lng, cp.coords[0], cp.coords[1]);

  let rotation = targetBearing;

  if (deviceHeading !== null) {
    rotation = targetBearing - deviceHeading;
  }

  document.getElementById("arrow").style.transform = "rotate(" + rotation + "deg)";
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
  document.getElementById("modalTitle").innerText = cp.name;
  document.getElementById("modalQuestion").innerText = cp.question;
  renderTaskUI(cp);
  document.getElementById("questionModal").classList.remove("hidden");
}

function closeQuestion() {
  document.getElementById("questionModal").classList.add("hidden");
  questionOpen = false;
}

function showTeacherMessage(text) {
  document.getElementById("teacherMessageText").innerText = text;
  document.getElementById("messageModal").classList.remove("hidden");
}

function closeTeacherMessage() {
  document.getElementById("messageModal").classList.add("hidden");
}

function finishGame() {
  gameState.finished = true;
  gameState.gatherMode = false;
  closeQuestion();

  const gather = getGatherCheckpoint(currentCityKey);

  document.getElementById("modeText").innerText = "Spelmodus: afgerond";
  document.getElementById("progressText").innerText = "Alle checkpoints afgerond";
  document.getElementById("scoreText").innerText = "Eindscore: " + gameState.score;

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

  document.getElementById("status").innerText =
    "Proficiat. Ga nu naar het verzamelpunt.";

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
    const input = document.getElementById("modalAnswerInput").value.toLowerCase().trim();
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
      const select = document.getElementById("matching-" + index);
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
  const photoStatus = document.getElementById("photoUploadStatus");

  if (!selectedPhotoFile) {
    photoStatus.innerText = "Kies eerst een foto.";
    return false;
  }

  try {
    photoStatus.innerText = "Foto wordt geüpload...";

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

    const payload = {
      image: base64,
      filename: safeCheckpointName + ".jpg",
      groupFolderName: `Groep_${gameState.groupNumber}_${gameState.groupName}`,
      cityKey: currentCityKey,
      groupId: gameState.groupId,
      groupNumber: gameState.groupNumber,
      groupName: gameState.groupName,
      groupMembers: gameState.groupMembers,
      checkpointName: cp.name,
      checkpointIndex: routeIndex,
      safeCheckpointName: safeCheckpointName
    };

    console.log("UPLOAD PAYLOAD:", payload);
    console.log("SCRIPT_URL:", SCRIPT_URL);

    const response = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    console.log("Apps Script raw response:", responseText);

    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      throw new Error("Ongeldige response van Apps Script: " + responseText);
    }

    console.log("Apps Script parsed response:", result);

    if (result.status !== "ok") {
      throw new Error(result.message || "Onbekende fout bij upload");
    }

    uploadedPhotoPending = true;
    photoStatus.innerText = "Foto succesvol geüpload.";
    return true;
  } catch (error) {
    console.error("Foto-upload mislukt:", error);
    photoStatus.innerText = "Upload mislukt: " + error.message;
    return false;
  }
}

function handleWrongAttempt(cp) {
  gameState.currentTries++;

  if (gameState.currentTries >= 3) {
    gameState.score += Number(cp.pointsAfterMaxTries || 0);
    nextCheckpoint();
  } else {
    document.getElementById("answerFeedback").innerText = "Niet juist, probeer opnieuw.";
    document.getElementById("triesFeedback").innerText =
      "Pogingen over: " + (3 - gameState.currentTries);
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

function startGPS() {
  navigator.geolocation.watchPosition(
    (pos) => {
      updateLocation(pos.coords.latitude, pos.coords.longitude);
    },
    (err) => {
      document.getElementById("status").innerText = "GPS kon niet worden opgehaald.";
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
      document.getElementById("scoreText").innerText =
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
      document.getElementById("status").innerText =
        "De begeleider heeft iedereen naar het verzamelpunt gestuurd.";
    }

    if (data.type === "resume") {
      if (!gameState.finished) {
        gameState.gatherMode = false;
        closeQuestion();
        loadCheckpoint();
        document.getElementById("status").innerText =
          "Het normale spel is hervat.";
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
    const container = document.getElementById("studentRankingContainer");
    container.innerHTML = "";

    if (!data || !currentCityKey) {
      container.innerHTML = "<p>Nog geen scoregegevens beschikbaar.</p>";
      return;
    }

    const groups = Object.values(data)
      .filter((g) => g.cityKey === currentCityKey)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 10);

    if (groups.length === 0) {
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
  const name = document.getElementById("groupName").value.trim();
  const members = document.getElementById("groupMembers").value.trim();

  if (!currentCityKey) {
    document.getElementById("loginFeedback").innerText =
      "De leerkracht heeft nog geen stad geactiveerd.";
    return;
  }

  if (!cityLoaded) {
    document.getElementById("loginFeedback").innerText =
      "De stad wordt nog geladen. Probeer binnen enkele seconden opnieuw.";
    return;
  }

  if (!name || !members) {
    document.getElementById("loginFeedback").innerText = "Vul alles in.";
    return;
  }

  if (currentCheckpoints.length === 0) {
    document.getElementById("loginFeedback").innerText =
      "Er zijn nog geen checkpoints ingesteld voor deze stad.";
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

  route = generateRoute(gameState.groupNumber, currentCheckpoints.length);
  routeIndex = 0;

  document.getElementById("loginCard").classList.add("hidden");
  document.getElementById("gameArea").classList.remove("hidden");
  document.getElementById("teamDisplay").innerText =
    "Groep " + gameState.groupNumber + ": " + name;

  initMap();
  startGPS();
  listenTeacherCommands();
  listenGlobalCommands();
  listenBroadcastMessages();
  listenHardReset();
  listenStudentRanking();
  saveLocalState();
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

  currentCheckpoints = await loadCheckpointsForCity(currentCityKey);
  cityLoaded = true;

  document.getElementById("loginCard").classList.add("hidden");
  document.getElementById("gameArea").classList.remove("hidden");
  document.getElementById("teamDisplay").innerText =
    "Groep " + gameState.groupNumber + ": " + gameState.groupName;

  initMap();
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

  if (!cityKey || !cities[cityKey]) return;

  currentCheckpoints = await loadCheckpointsForCity(cityKey);
  cityLoaded = true;

  if (map) {
    resetMapToCity();
  }

  if (!gameState.groupId) {
    await restoreSessionIfPossible();
  }
}

onValue(ref(db, "control/currentCity"), async (snapshot) => {
  const cityKey = snapshot.val();
  await handleCityChange(cityKey);
});

document.getElementById("startButton").onclick = startGame;
document.getElementById("submitAnswerButton").onclick = checkAnswer;
document.getElementById("closeMessageButton").onclick = closeTeacherMessage;
