import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  get,
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

let speltypesCache = {};
let selectedKey = null;

/* ================= HELPERS ================= */

function byId(id) {
  return document.getElementById(id);
}

function getVal(id) {
  return byId(id)?.value || "";
}

function setVal(id, val) {
  if (byId(id)) byId(id).value = val ?? "";
}

function isChecked(id) {
  return !!byId(id)?.checked;
}

function setChecked(id, val) {
  if (byId(id)) byId(id).checked = !!val;
}

function setText(id, txt) {
  if (byId(id)) byId(id).innerText = txt;
}

/* ================= LOGIN ================= */

function login() {
  signInWithEmailAndPassword(
    auth,
    getVal("email"),
    getVal("password")
  ).catch(e => alert("Login mislukt: " + e.message));
}

function logout() {
  signOut(auth);
}

window.login = login;
window.logout = logout;

onAuthStateChanged(auth, (user) => {
  byId("loginScreen").style.display = user ? "none" : "block";
  byId("appContent").style.display = user ? "block" : "none";

  if (user) {
    setText("loginStatus", "Ingelogd als: " + user.email);
    listenSpeltypes();
  }
});

/* ================= LOAD ================= */

function listenSpeltypes() {
  onValue(ref(db, "speltypes"), (snap) => {
    speltypesCache = snap.val() || {};
    populateSelector();
  });
}

function populateSelector() {
  const select = byId("speltypeSelector");
  select.innerHTML = "";

  Object.keys(speltypesCache).forEach(key => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = speltypesCache[key].name || key;
    select.appendChild(opt);
  });
}

/* ================= ENGINE SWITCH ================= */

function updateEngineUI() {
  const engine = getVal("speltypeEngine");

  document.querySelectorAll(".engine-panel").forEach(p => {
    p.classList.add("hidden");
  });

  if (engine === "classic") byId("engineClassicPanel").classList.remove("hidden");
  if (engine === "collectibles") byId("engineCollectiblesPanel").classList.remove("hidden");
  if (engine === "murder") byId("engineMurderPanel").classList.remove("hidden");
  if (engine === "mole") byId("engineMolePanel").classList.remove("hidden");
  if (engine === "hunters") byId("engineHuntersPanel").classList.remove("hidden");
}

/* ================= SAVE ================= */

function buildSpeltypeObject() {
  return {
    name: getVal("speltypeNameInput"),
    description: getVal("speltypeDescription"),
    engine: getVal("speltypeEngine"),

    modules: {
      questions: isChecked("moduleQuestions"),
      story: isChecked("moduleStory"),
      inventory: isChecked("moduleInventory"),
      collectibles: isChecked("moduleCollectibles"),
      searchZones: isChecked("moduleSearchZones"),
      hiddenReveal: isChecked("moduleHiddenReveal"),
      clickableItems: isChecked("moduleClickableMapItems"),
      dialogs: isChecked("moduleDialogs"),
      evidenceBook: isChecked("moduleEvidenceBook"),
      fingerprints: isChecked("moduleFingerprintSystem"),
      fakeClues: isChecked("moduleFakeClues"),
      secretRoles: isChecked("moduleSecretRoles"),
      sabotage: isChecked("moduleSabotage"),
      roleSwitch: isChecked("moduleRoleSwitch"),
      chase: isChecked("moduleChaseMechanic"),
      score: isChecked("moduleScore"),
      ranking: isChecked("moduleRanking"),
      teacherControls: isChecked("moduleTeacherControls")
    },

    settings: {
      checkpointFlow: getVal("checkpointFlowType"),
      collectibleUnlock: getVal("collectibleUnlockMode"),
      mapVisibility: getVal("mapCollectibleVisibility"),
      finalObjective: getVal("finalObjectiveType"),
      searchRadius: Number(getVal("searchZoneRadius") || 30),
      revealDistance: Number(getVal("nearbyRevealDistance") || 15),
      maxTries: Number(getVal("maxTriesDefault") || 3),
      scoreMode: getVal("scoreMode")
    },

    engineConfig: buildEngineConfig()
  };
}

function buildEngineConfig() {
  const engine = getVal("speltypeEngine");

  if (engine === "collectibles") {
    return {
      theme: getVal("collectiblesTheme"),
      inventoryName: getVal("collectiblesInventoryName"),
      blurZones: getVal("collectiblesUseBlurZones"),
      clickToCollect: getVal("collectiblesRequireClickToCollect")
    };
  }

  if (engine === "murder") {
    return {
      bookName: getVal("murderBookName"),
      finale: getVal("murderFinaleType"),
      dialogs: isChecked("murderUseDialogs"),
      fingerprints: isChecked("murderUseFingerprints")
    };
  }

  if (engine === "mole") {
    return {
      roleDistribution: getVal("moleRoleDistribution"),
      revealMoment: getVal("moleRevealMoment")
    };
  }

  if (engine === "hunters") {
    return {
      startRole: getVal("huntersStartRole"),
      switchTrigger: getVal("huntersRoleSwitchTrigger"),
      threshold: Number(getVal("huntersSwitchThreshold") || 3)
    };
  }

  return {};
}

async function saveSpeltype() {
  const key = getVal("speltypeKeyInput").trim();

  if (!key) {
    setText("speltypeFeedback", "Geef een key op.");
    return;
  }

  const obj = buildSpeltypeObject();

  await set(ref(db, "speltypes/" + key), obj);

  setText("speltypeFeedback", "Opgeslagen.");
}

/* ================= LOAD INTO FORM ================= */

function loadSpeltype() {
  const key = byId("speltypeSelector").value;
  const s = speltypesCache[key];
  if (!s) return;

  selectedKey = key;

  setVal("speltypeKeyInput", key);
  setVal("speltypeNameInput", s.name);
  setVal("speltypeDescription", s.description);
  setVal("speltypeEngine", s.engine);

  updateEngineUI();

  // modules
  Object.keys(s.modules || {}).forEach(k => {
    setChecked("module" + capitalize(k), s.modules[k]);
  });

  // settings
  setVal("checkpointFlowType", s.settings?.checkpointFlow);
  setVal("collectibleUnlockMode", s.settings?.collectibleUnlock);

  setText("speltypeFeedback", "Geladen.");
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/* ================= DELETE ================= */

async function deleteSpeltype() {
  const key = byId("speltypeSelector").value;
  if (!key) return;

  if (!confirm("Verwijderen?")) return;

  await remove(ref(db, "speltypes/" + key));
}

/* ================= EVENTS ================= */

byId("speltypeEngine").onchange = updateEngineUI;
byId("saveSpeltypeButton").onclick = saveSpeltype;
byId("loadSpeltypeButton").onclick = loadSpeltype;
byId("deleteSpeltypeButton").onclick = deleteSpeltype;

byId("newSpeltypeButton").onclick = () => {
  document.querySelectorAll("input, textarea").forEach(el => el.value = "");
};

/* ================= INIT ================= */

updateEngineUI();
