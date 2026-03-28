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

let gameTypesCache = {};
let initialized = false;

function byId(id) {
  return document.getElementById(id);
}

function setStatus(text, isError = false) {
  const el = byId("gameTypeStatus");
  if (!el) return;
  el.innerText = text || "";
  el.style.color = isError ? "#ffb4b4" : "";
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

function defaultGameType() {
  return {
    name: "",
    description: "",
    engine: "classic",

    modules: {
      navigation: true,
      questions: true,
      score: true,
      ranking: true,
      story: false,
      dialogs: false,
      inventory: false,
      collectibles: false,
      searchZones: false,
      hiddenReveal: false,
      clickableItems: false,
      evidenceBook: false,
      fingerprints: false,
      fakeClues: false,
      secretRoles: false,
      sabotage: false,
      roleSwitch: false,
      chase: false,
      teacherControls: true
    },

    settings: {
      checkpointFlow: "rotatingRoute",
      collectibleUnlock: "none",
      mapVisibility: "none",
      finalObjective: "gatherPoint",
      searchRadius: 30,
      revealDistance: 15,
      maxTries: 3,
      scoreMode: "normal"
    },

    roles: {
      enabled: false,
      type: "none",
      autoAssign: true,
      maxRoles: 1,
      rotation: {
        enabled: false,
        intervalMinutes: 15
      }
    },

    inventory: {
      name: "Grimoire"
    },

    effects: {
      enabled: false,
      allowedEffects: []
    },

    sabotage: {
      enabled: false,
      requiresProximity: true,
      cooldownSeconds: 60
    },

    ui: {
      showRanking: true,
      showTimer: false,
      showInventory: true,
      showRoles: false
    }
  };
}

function mergeGameTypeWithDefaults(raw = {}) {
  const base = defaultGameType();

  return {
    name: raw.name ?? base.name,
    description: raw.description ?? base.description,
    engine: raw.engine ?? base.engine,

    modules: {
      ...base.modules,
      ...(raw.modules || {})
    },

    settings: {
      ...base.settings,
      ...(raw.settings || {})
    },

    roles: {
      ...base.roles,
      ...(raw.roles || {}),
      rotation: {
        ...base.roles.rotation,
        ...(raw.roles?.rotation || {})
      }
    },

    inventory: {
      ...base.inventory,
      ...(raw.inventory || {})
    },

    effects: {
      ...base.effects,
      ...(raw.effects || {})
    },

    sabotage: {
      ...base.sabotage,
      ...(raw.sabotage || {})
    },

    ui: {
      ...base.ui,
      ...(raw.ui || {})
    }
  };
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function readAllowedEffects() {
  const effects = [];
  if (byId("effectMapBlur")?.checked) effects.push("map_blur");
  if (byId("effectCompassOff")?.checked) effects.push("compass_off");
  if (byId("effectFreeze")?.checked) effects.push("freeze");
  if (byId("effectScoreSteal")?.checked) effects.push("score_steal");
  if (byId("effectShield")?.checked) effects.push("shield");
  if (byId("effectFakeTarget")?.checked) effects.push("fake_target");
  return effects;
}

function writeAllowedEffects(effects = []) {
  byId("effectMapBlur").checked = effects.includes("map_blur");
  byId("effectCompassOff").checked = effects.includes("compass_off");
  byId("effectFreeze").checked = effects.includes("freeze");
  byId("effectScoreSteal").checked = effects.includes("score_steal");
  byId("effectShield").checked = effects.includes("shield");
  byId("effectFakeTarget").checked = effects.includes("fake_target");
}

function collectFormData() {
  const id = slugify(byId("gameTypeId")?.value || "");

  return {
    id,
    data: {
      name: byId("gameTypeName")?.value?.trim() || "",
      description: byId("gameTypeDescription")?.value?.trim() || "",
      engine: byId("gameTypeEngine")?.value || "classic",

      modules: {
        navigation: byId("modNavigation")?.checked || false,
        questions: byId("modQuestions")?.checked || false,
        score: byId("modScore")?.checked || false,
        ranking: byId("modRanking")?.checked || false,
        story: byId("modStory")?.checked || false,
        dialogs: byId("modDialogs")?.checked || false,
        inventory: byId("modInventory")?.checked || false,
        collectibles: byId("modCollectibles")?.checked || false,
        searchZones: byId("modSearchZones")?.checked || false,
        hiddenReveal: byId("modHiddenReveal")?.checked || false,
        clickableItems: byId("modClickableItems")?.checked || false,
        evidenceBook: byId("modEvidenceBook")?.checked || false,
        fingerprints: byId("modFingerprints")?.checked || false,
        fakeClues: byId("modFakeClues")?.checked || false,
        secretRoles: byId("modSecretRoles")?.checked || false,
        sabotage: byId("modSabotage")?.checked || false,
        roleSwitch: byId("modRoleSwitch")?.checked || false,
        chase: byId("modChase")?.checked || false,
        teacherControls: byId("modTeacherControls")?.checked || false
      },

      settings: {
        checkpointFlow: byId("settingCheckpointFlow")?.value || "rotatingRoute",
        collectibleUnlock: byId("settingCollectibleUnlock")?.value || "none",
        mapVisibility: byId("settingMapVisibility")?.value || "none",
        finalObjective: byId("settingFinalObjective")?.value || "gatherPoint",
        searchRadius: Number(byId("settingSearchRadius")?.value || 30),
        revealDistance: Number(byId("settingRevealDistance")?.value || 15),
        maxTries: Number(byId("settingMaxTries")?.value || 3),
        scoreMode: byId("settingScoreMode")?.value || "normal"
      },

      roles: {
        enabled: byId("rolesEnabled")?.checked || false,
        type: byId("rolesType")?.value || "none",
        autoAssign: byId("rolesAutoAssign")?.checked || false,
        maxRoles: Number(byId("rolesMaxRoles")?.value || 1),
        rotation: {
          enabled: byId("rolesRotationEnabled")?.checked || false,
          intervalMinutes: Number(byId("rolesRotationMinutes")?.value || 15)
        }
      },

      inventory: {
        name: byId("inventoryName")?.value?.trim() || "Grimoire"
      },

      effects: {
        enabled: readAllowedEffects().length > 0,
        allowedEffects: readAllowedEffects()
      },

      sabotage: {
        enabled: byId("sabotageEnabled")?.checked || false,
        requiresProximity: byId("sabotageRequiresProximity")?.checked || false,
        cooldownSeconds: Number(byId("sabotageCooldownSeconds")?.value || 60)
      },

      ui: {
        showRanking: byId("uiShowRanking")?.checked || false,
        showTimer: byId("uiShowTimer")?.checked || false,
        showInventory: byId("uiShowInventory")?.checked || false,
        showRoles: byId("uiShowRoles")?.checked || false
      }
    }
  };
}

function fillForm(gameTypeId, rawData) {
  const data = mergeGameTypeWithDefaults(rawData);

  byId("gameTypeId").value = gameTypeId || "";
  byId("gameTypeName").value = data.name || "";
  byId("gameTypeDescription").value = data.description || "";
  byId("gameTypeEngine").value = data.engine || "classic";

  byId("modNavigation").checked = !!data.modules.navigation;
  byId("modQuestions").checked = !!data.modules.questions;
  byId("modScore").checked = !!data.modules.score;
  byId("modRanking").checked = !!data.modules.ranking;
  byId("modStory").checked = !!data.modules.story;
  byId("modDialogs").checked = !!data.modules.dialogs;
  byId("modInventory").checked = !!data.modules.inventory;
  byId("modCollectibles").checked = !!data.modules.collectibles;
  byId("modSearchZones").checked = !!data.modules.searchZones;
  byId("modHiddenReveal").checked = !!data.modules.hiddenReveal;
  byId("modClickableItems").checked = !!data.modules.clickableItems;
  byId("modEvidenceBook").checked = !!data.modules.evidenceBook;
  byId("modFingerprints").checked = !!data.modules.fingerprints;
  byId("modFakeClues").checked = !!data.modules.fakeClues;
  byId("modSecretRoles").checked = !!data.modules.secretRoles;
  byId("modSabotage").checked = !!data.modules.sabotage;
  byId("modRoleSwitch").checked = !!data.modules.roleSwitch;
  byId("modChase").checked = !!data.modules.chase;
  byId("modTeacherControls").checked = !!data.modules.teacherControls;

  byId("settingCheckpointFlow").value = data.settings.checkpointFlow;
  byId("settingCollectibleUnlock").value = data.settings.collectibleUnlock;
  byId("settingMapVisibility").value = data.settings.mapVisibility;
  byId("settingFinalObjective").value = data.settings.finalObjective;
  byId("settingSearchRadius").value = data.settings.searchRadius;
  byId("settingRevealDistance").value = data.settings.revealDistance;
  byId("settingMaxTries").value = data.settings.maxTries;
  byId("settingScoreMode").value = data.settings.scoreMode;

  byId("rolesEnabled").checked = !!data.roles.enabled;
  byId("rolesType").value = data.roles.type;
  byId("rolesAutoAssign").checked = !!data.roles.autoAssign;
  byId("rolesMaxRoles").value = data.roles.maxRoles;
  byId("rolesRotationEnabled").checked = !!data.roles.rotation.enabled;
  byId("rolesRotationMinutes").value = data.roles.rotation.intervalMinutes;

  byId("inventoryName").value = data.inventory.name || "Grimoire";

  writeAllowedEffects(data.effects.allowedEffects || []);

  byId("sabotageEnabled").checked = !!data.sabotage.enabled;
  byId("sabotageRequiresProximity").checked = !!data.sabotage.requiresProximity;
  byId("sabotageCooldownSeconds").value = data.sabotage.cooldownSeconds;

  byId("uiShowRanking").checked = !!data.ui.showRanking;
  byId("uiShowTimer").checked = !!data.ui.showTimer;
  byId("uiShowInventory").checked = !!data.ui.showInventory;
  byId("uiShowRoles").checked = !!data.ui.showRoles;
}

function clearForm() {
  fillForm("", defaultGameType());
  setStatus("Nieuw speltype gestart.");
}

function refreshSelector() {
  const selector = byId("gameTypeSelector");
  if (!selector) return;

  const currentValue = selector.value;
  selector.innerHTML = "";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "-- Kies een speltype --";
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

  if (currentValue && gameTypesCache[currentValue]) {
    selector.value = currentValue;
  } else {
    selector.value = "";
  }
}

async function saveGameType() {
  const { id, data } = collectFormData();

  if (!id) {
    setStatus("Vul eerst een geldige interne ID in.", true);
    return;
  }

  if (!data.name) {
    setStatus("Vul eerst een naam voor het speltype in.", true);
    return;
  }

  try {
    await set(ref(db, "speltypes/" + id), data);
    setStatus("Speltype opgeslagen.");
    byId("gameTypeSelector").value = id;
  } catch (error) {
    console.error(error);
    setStatus("Opslaan mislukt: " + error.message, true);
  }
}

async function deleteGameType() {
  const id = byId("gameTypeId")?.value?.trim() || "";
  if (!id) {
    setStatus("Geen speltype geselecteerd om te verwijderen.", true);
    return;
  }

  const ok = confirm(`Verwijder speltype "${id}"?`);
  if (!ok) return;

  try {
    await remove(ref(db, "speltypes/" + id));
    clearForm();
    setStatus("Speltype verwijderd.");
  } catch (error) {
    console.error(error);
    setStatus("Verwijderen mislukt: " + error.message, true);
  }
}

function loadSelectedGameType() {
  const selector = byId("gameTypeSelector");
  const id = selector?.value || "";

  if (!id || !gameTypesCache[id]) {
    clearForm();
    return;
  }

  fillForm(id, gameTypesCache[id]);
  setStatus(`Speltype "${gameTypesCache[id]?.name || id}" geladen.`);
}

function attachEvents() {
  byId("newGameTypeButton")?.addEventListener("click", clearForm);
  byId("saveGameTypeButton")?.addEventListener("click", saveGameType);
  byId("deleteGameTypeButton")?.addEventListener("click", deleteGameType);
  byId("gameTypeSelector")?.addEventListener("change", loadSelectedGameType);

  byId("gameTypeName")?.addEventListener("input", () => {
    const idField = byId("gameTypeId");
    if (!idField) return;
    if (!idField.value.trim()) {
      idField.value = slugify(byId("gameTypeName")?.value || "");
    }
  });
}

function initDataListeners() {
  onValue(ref(db, "speltypes"), (snapshot) => {
    gameTypesCache = snapshot.val() || {};
    refreshSelector();

    const currentId = byId("gameTypeId")?.value?.trim() || "";
    if (currentId && gameTypesCache[currentId]) {
      fillForm(currentId, gameTypesCache[currentId]);
    }
  });
}

function initApp() {
  if (initialized) return;
  initialized = true;

  attachEvents();
  clearForm();
  initDataListeners();
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
