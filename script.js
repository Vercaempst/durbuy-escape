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

let map;
let playerMarker;
let checkpointMarker;
let checkpointCircle;
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
  lastProcessedHardResetAt: 0
};

const playerIcon = L.icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/149/149071.png",
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -30]
});

const checkpointIcon = L.icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/684/684908.png",
  iconSize: [34, 34],
  iconAnchor: [17, 34],
  popupAnchor: [0, -28]
});

const gatherIcon = L.icon({
  iconUrl: "https://cdn-icons-png.flaticon.com/512/1828/1828884.png",
  iconSize: [34, 34],
  iconAnchor: [17, 34],
  popupAnchor: [0, -28]
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
  if (!cityKey || !cities[cityKey]) {
    document.getElementById("activeCityLabel").innerText =
      "Actieve stad: nog niet ingesteld";
    document.getElementById("appTitle").innerText = "City Escape";
    return;
  }

  document.getElementById("activeCityLabel").innerText =
    "Actieve stad: " + cities[cityKey].name;
  document.getElementById("appTitle").innerText =
    cities[cityKey].name + " Escape";
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
    document.getElementById("progressText").innerText =
      "Iedereen naar het verzamelpunt";
  } else if (gameState.finished) {
    document.getElementById("modeText").innerText = "Spelmodus: afgerond";
    document.getElementById("progressText").innerText =
      "Alle checkpoints afgerond";
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
  closeQuestion();

  questionOpen = false;
  saveLocalState();
}

function updateLocation(lat, lng) {
  if (!playerMarker) {
    playerMarker = L.marker([lat, lng], { icon: playerIcon })
      .addTo(map)
      .bindPopup("Jullie locatie");
  } else {
    playerMarker.setLatLng([lat, lng]);
  }

  updateNavigation(lat, lng);
  checkDistance(lat, lng);
  syncGroup(lat, lng);
}

function checkDistance(lat, lng) {
  const cp = getCurrentCheckpoint();
  if (!cp) return;

  const dist = map.distance([lat, lng], cp.coords);
  document.getElementById("distanceText").innerText =
    "Afstand: " + Math.round(dist) + " m";

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
        "Proficiat. Ga nu naar het verzamelpunt. Nog " +
        Math.round(dist) +
        " meter.";
    }
    return;
  }

  if (dist < cp.radius) {
    document.getElementById("status").innerText =
      "Jullie zijn aangekomen bij " + cp.name + ".";
    if (!questionOpen) {
      openQuestion();
    }
  } else {
    document.getElementById("status").innerText =
      "Nog " + Math.round(dist) + " meter tot " + cp.name + ".";
  }
}

function updateNavigation(lat, lng) {
  const cp = getCurrentCheckpoint();
  if (!cp) return;

  const angle = Math.atan2(cp.coords[1] - lng, cp.coords[0] - lat);
  const deg = (angle * 180) / Math.PI;
  document.getElementById("arrow").style.transform = "rotate(" + deg + "deg)";
}

function openQuestion() {
  if (gameState.gatherMode || gameState.finished) return;

  const cp = getCurrentCheckpoint();
  if (!cp) return;

  questionOpen = true;
  document.getElementById("modalTitle").innerText = cp.name;
  document.getElementById("modalQuestion").innerText = cp.question;
  document.getElementById("questionModal").classList.remove("hidden");
}

function closeQuestion() {
  document.getElementById("questionModal").classList.add("hidden");
  questionOpen = false;
}

function finishGame() {
  gameState.finished = true;
  gameState.gatherMode = false;
  closeQuestion();

  const gather = getGatherCheckpoint(currentCityKey);

  document.getElementById("modeText").innerText = "Spelmodus: afgerond";
  document.getElementById("progressText").innerText =
    "Alle checkpoints afgerond";
  document.getElementById("scoreText").innerText =
    "Eindscore: " + gameState.score;

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

  saveLocalState();
  syncGroup();
}

function checkAnswer() {
  const cp = getCurrentCheckpoint();
  if (!cp || gameState.finished) return;

  const input = document
    .getElementById("modalAnswerInput")
    .value.toLowerCase()
    .trim();

  if (cp.answers.includes(input)) {
    gameState.score += Number(cp.pointsCorrect || 0);
    nextCheckpoint();
    return;
  }

  gameState.currentTries++;

  if (gameState.currentTries >= 3) {
    gameState.score += Number(cp.pointsAfterMaxTries || 0);
    nextCheckpoint();
  } else {
    document.getElementById("answerFeedback").innerText =
      "Niet juist, probeer opnieuw.";
    document.getElementById("triesFeedback").innerText =
      "Pogingen over: " + (3 - gameState.currentTries);
  }

  saveLocalState();
}

function nextCheckpoint() {
  closeQuestion();
  gameState.currentTries = 0;
  routeIndex++;

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
      document.getElementById("status").innerText =
        "GPS kon niet worden opgehaald.";
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

    if (
      data.commandNextAt &&
      data.commandNextAt > gameState.lastProcessedNextAt
    ) {
      gameState.lastProcessedNextAt = data.commandNextAt;
      if (!gameState.gatherMode && !gameState.finished) {
        nextCheckpoint();
      }
      saveLocalState();
    }

    if (
      data.commandPointsAt &&
      data.commandPointsAt > gameState.lastProcessedPointsAt
    ) {
      gameState.lastProcessedPointsAt = data.commandPointsAt;
      gameState.score += Number(data.commandPointsValue || 0);
      document.getElementById("scoreText").innerText =
        (gameState.finished ? "Eindscore: " : "Score: ") + gameState.score;
      saveLocalState();
      syncGroup();
    }

    if (
      data.commandResetAt &&
      data.commandResetAt > gameState.lastProcessedResetAt
    ) {
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

function listenHardReset() {
  if (resetListenerStarted) return;
  resetListenerStarted = true;

  onValue(ref(db, "control/globalReset"), (snapshot) => {
    const data = snapshot.val();
    if (!data || !data.at) return;
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

document.getElementById("routeButton").onclick = () => {
  const cp = getCurrentCheckpoint();
  if (!cp) return;

  const url =
    "https://www.google.com/maps/dir/?api=1&destination=" +
    cp.coords[0] +
    "," +
    cp.coords[1];

  window.open(url, "_blank");
};
