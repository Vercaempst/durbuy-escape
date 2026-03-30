import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
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

const MAP_ICON_CHOICES = [
  "🎯","✅","✨","🚶","⭐","📍","📌","🧭","🏁","🗺️",
  "🔮","🕯️","📜","💎","🧪","🗝️","🛡️","⚡","🔥","❄️",
  "🌪️","🕵️","👣","🧩","💰","🎒","📖","🔍","🪄","🎲",
  "🪙","🧱","🦉","🐺","🐉","🌙","☀️","🍀","💀","👑"
];

const MODULE_IDS = {
  navigation: "modNavigation",
  questions: "modQuestions",
  score: "modScore",
  ranking: "modRanking",
  timer: "modTimer",
  story: "modStory",
  dialogs: "modDialogs",
  media: "modMedia",
  inventory: "modInventory",
  collectibles: "modCollectibles",
  searchZones: "modSearchZones",
  hiddenReveal: "modHiddenReveal",
  clickableItems: "modClickableItems",
  usableItems: "modUsableItems",
  evidenceBook: "modEvidenceBook",
  fingerprints: "modFingerprints",
  fakeClues: "modFakeClues",
  deduction: "modDeduction",
  secretRoles: "modSecretRoles",
  publicRoles: "modPublicRoles",
  roleSwitch: "modRoleSwitch",
  abilities: "modAbilities",
  proximity: "modProximity",
  sabotage: "modSabotage",
  effects: "modEffects",
  chase: "modChase",
  zoneControl: "modZoneControl",
  trading: "modTrading",
  resources: "modResources",
  puzzles: "modPuzzles",
  discovery: "modDiscovery",
  teacherControls: "modTeacherControls"
};

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
    mapIcons: {
      checkpoint: "🎯",
      done: "✅",
      collectible: "✨",
      player: "🚶",
      gather: "⭐"
    },
    modules: {
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
    },
    rules: {
      checkpointFlow: "rotatingRoute",
      finalObjective: "gatherPoint",
      scoreMode: "normal",
      allowRetries: "limited",
      maxTries: 3,
      wrongAnswerPenalty: "skipCollectible"
    },
    timer: {
      mode: "global",
      totalMinutes: 90,
      checkpointSeconds: 0,
      expiryAction: "endGame"
    },
    inventory: {
      name: "Grimoire",
      mode: "visual",
      capacity: 20
    },
    collectibles: {
      unlockCondition: "searchZoneAfterCorrect",
      mapVisibility: "blurZone",
      searchRadius: 30,
      revealDistance: 15,
      contentType: "usableItem"
    },
    usableItems: {
      targetMode: "enemy",
      useMode: "manual",
      charges: 1
    },
    effects: {
      enabled: true,
      allowedEffects: ["map_blur", "score_steal", "compass_off", "freeze", "shield"],
      defaultDuration: 40,
      stackMode: "replace"
    },
    ui: {
      showRanking: true,
      showTimer: false,
      showInventory: true,
      showRoles: false,
      showScore: true,
      showDistance: true,
      showMap: true,
      showCompass: true
    }
  };
}

function mergeGameTypeWithDefaults(raw = {}) {
  const base = defaultGameType();
  return {
    ...base,
    ...raw,
    mapIcons: { ...base.mapIcons, ...(raw.mapIcons || {}) },
    modules: { ...base.modules, ...(raw.modules || {}) },
    rules: { ...base.rules, ...(raw.rules || {}) },
    timer: { ...base.timer, ...(raw.timer || {}) },
    inventory: { ...base.inventory, ...(raw.inventory || {}) },
    collectibles: { ...base.collectibles, ...(raw.collectibles || {}) },
    usableItems: { ...base.usableItems, ...(raw.usableItems || {}) },
    effects: { ...base.effects, ...(raw.effects || {}) },
    ui: { ...base.ui, ...(raw.ui || {}) }
  };
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function fillIconSelector(id, currentValue) {
  const select = byId(id);
  if (!select) return;

  select.innerHTML = MAP_ICON_CHOICES
    .map((icon) => `<option value="${icon}">${icon} ${icon}</option>`)
    .join("");

  select.value = MAP_ICON_CHOICES.includes(currentValue) ? currentValue : MAP_ICON_CHOICES[0];
}

function readAllowedEffects() {
  const effects = [];
  if (byId("effectMapBlur")?.checked) effects.push("map_blur");
  if (byId("effectCompassOff")?.checked) effects.push("compass_off");
  if (byId("effectFreeze")?.checked) effects.push("freeze");
  if (byId("effectScoreSteal")?.checked) effects.push("score_steal");
  if (byId("effectShield")?.checked) effects.push("shield");
  if (byId("effectFakeTarget")?.checked) effects.push("fake_target");
  if (byId("effectFogOverlay")?.checked) effects.push("fog_overlay");
  if (byId("effectNoInventory")?.checked) effects.push("no_inventory");
  if (byId("effectNoMap")?.checked) effects.push("no_map");
  if (byId("effectDoublePoints")?.checked) effects.push("double_points");
  if (byId("effectExtraTime")?.checked) effects.push("extra_time");
  if (byId("effectRevealEnemy")?.checked) effects.push("reveal_enemy");
  if (byId("effectRevealCheckpoint")?.checked) effects.push("reveal_checkpoint");
  if (byId("effectCleanse")?.checked) effects.push("cleanse");
  return effects;
}

function writeAllowedEffects(effects = []) {
  byId("effectMapBlur").checked = effects.includes("map_blur");
  byId("effectCompassOff").checked = effects.includes("compass_off");
  byId("effectFreeze").checked = effects.includes("freeze");
  byId("effectScoreSteal").checked = effects.includes("score_steal");
  byId("effectShield").checked = effects.includes("shield");
  byId("effectFakeTarget").checked = effects.includes("fake_target");
  byId("effectFogOverlay").checked = effects.includes("fog_overlay");
  byId("effectNoInventory").checked = effects.includes("no_inventory");
  byId("effectNoMap").checked = effects.includes("no_map");
  byId("effectDoublePoints").checked = effects.includes("double_points");
  byId("effectExtraTime").checked = effects.includes("extra_time");
  byId("effectRevealEnemy").checked = effects.includes("reveal_enemy");
  byId("effectRevealCheckpoint").checked = effects.includes("reveal_checkpoint");
  byId("effectCleanse").checked = effects.includes("cleanse");
}

function populateGameTypeSelector() {
  const selector = byId("gameTypeSelector");
  if (!selector) return;

  const current = selector.value;
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

  selector.value = current && gameTypesCache[current] ? current : "";
}

function clearForm() {
  const base = defaultGameType();
  byId("gameTypeId").value = "";
  byId("gameTypeName").value = "";
  byId("gameTypeDescription").value = "";
  byId("gameTypeEngine").value = "classic";

  fillIconSelector("mapIconCheckpoint", base.mapIcons.checkpoint);
  fillIconSelector("mapIconDone", base.mapIcons.done);
  fillIconSelector("mapIconCollectible", base.mapIcons.collectible);
  fillIconSelector("mapIconPlayer", base.mapIcons.player);
  fillIconSelector("mapIconGather", base.mapIcons.gather);

  Object.entries(MODULE_IDS).forEach(([key, id]) => {
    if (byId(id)) byId(id).checked = !!base.modules[key];
  });

  byId("rulesCheckpointFlow").value = base.rules.checkpointFlow;
  byId("rulesFinalObjective").value = base.rules.finalObjective;
  byId("rulesScoreMode").value = base.rules.scoreMode;
  byId("rulesAllowRetries").value = base.rules.allowRetries;
  byId("rulesMaxTries").value = base.rules.maxTries;
  byId("rulesWrongAnswerPenalty").value = base.rules.wrongAnswerPenalty;

  byId("timerMode").value = base.timer.mode;
  byId("timerTotalMinutes").value = base.timer.totalMinutes;
  byId("timerCheckpointSeconds").value = base.timer.checkpointSeconds;
  byId("timerExpiryAction").value = base.timer.expiryAction;

  byId("inventoryName").value = base.inventory.name;
  byId("inventoryMode").value = base.inventory.mode;
  byId("inventoryCapacity").value = base.inventory.capacity;

  byId("collectiblesUnlockCondition").value = base.collectibles.unlockCondition;
  byId("collectiblesMapVisibility").value = base.collectibles.mapVisibility;
  byId("collectiblesSearchRadius").value = base.collectibles.searchRadius;
  byId("collectiblesRevealDistance").value = base.collectibles.revealDistance;
  byId("collectiblesContentType").value = base.collectibles.contentType;

  byId("usableItemsTargetMode").value = base.usableItems.targetMode;
  byId("usableItemsUseMode").value = base.usableItems.useMode;
  byId("usableItemsCharges").value = base.usableItems.charges;

  byId("effectsEnabled").checked = !!base.effects.enabled;
  writeAllowedEffects(base.effects.allowedEffects);
  byId("effectsDefaultDuration").value = base.effects.defaultDuration;
  byId("effectsStackMode").value = base.effects.stackMode;

  byId("uiShowRanking").checked = !!base.ui.showRanking;
  byId("uiShowTimer").checked = !!base.ui.showTimer;
  byId("uiShowInventory").checked = !!base.ui.showInventory;
  byId("uiShowRoles").checked = !!base.ui.showRoles;
  byId("uiShowScore").checked = !!base.ui.showScore;
  byId("uiShowDistance").checked = !!base.ui.showDistance;
  byId("uiShowMap").checked = !!base.ui.showMap;
  byId("uiShowCompass").checked = !!base.ui.showCompass;
}

function loadGameTypeIntoForm(id) {
  const gt = mergeGameTypeWithDefaults(gameTypesCache[id] || {});

  byId("gameTypeId").value = id || "";
  byId("gameTypeName").value = gt.name || "";
  byId("gameTypeDescription").value = gt.description || "";
  byId("gameTypeEngine").value = gt.engine || "classic";

  fillIconSelector("mapIconCheckpoint", gt.mapIcons.checkpoint);
  fillIconSelector("mapIconDone", gt.mapIcons.done);
  fillIconSelector("mapIconCollectible", gt.mapIcons.collectible);
  fillIconSelector("mapIconPlayer", gt.mapIcons.player);
  fillIconSelector("mapIconGather", gt.mapIcons.gather);

  Object.entries(MODULE_IDS).forEach(([key, fieldId]) => {
    if (byId(fieldId)) byId(fieldId).checked = !!gt.modules[key];
  });

  byId("rulesCheckpointFlow").value = gt.rules.checkpointFlow;
  byId("rulesFinalObjective").value = gt.rules.finalObjective;
  byId("rulesScoreMode").value = gt.rules.scoreMode;
  byId("rulesAllowRetries").value = gt.rules.allowRetries;
  byId("rulesMaxTries").value = gt.rules.maxTries;
  byId("rulesWrongAnswerPenalty").value = gt.rules.wrongAnswerPenalty;

  byId("timerMode").value = gt.timer.mode;
  byId("timerTotalMinutes").value = gt.timer.totalMinutes;
  byId("timerCheckpointSeconds").value = gt.timer.checkpointSeconds;
  byId("timerExpiryAction").value = gt.timer.expiryAction;

  byId("inventoryName").value = gt.inventory.name;
  byId("inventoryMode").value = gt.inventory.mode;
  byId("inventoryCapacity").value = gt.inventory.capacity;

  byId("collectiblesUnlockCondition").value = gt.collectibles.unlockCondition;
  byId("collectiblesMapVisibility").value = gt.collectibles.mapVisibility;
  byId("collectiblesSearchRadius").value = gt.collectibles.searchRadius;
  byId("collectiblesRevealDistance").value = gt.collectibles.revealDistance;
  byId("collectiblesContentType").value = gt.collectibles.contentType;

  byId("usableItemsTargetMode").value = gt.usableItems.targetMode;
  byId("usableItemsUseMode").value = gt.usableItems.useMode;
  byId("usableItemsCharges").value = gt.usableItems.charges;

  byId("effectsEnabled").checked = !!gt.effects.enabled;
  writeAllowedEffects(gt.effects.allowedEffects || []);
  byId("effectsDefaultDuration").value = gt.effects.defaultDuration;
  byId("effectsStackMode").value = gt.effects.stackMode;

  byId("uiShowRanking").checked = !!gt.ui.showRanking;
  byId("uiShowTimer").checked = !!gt.ui.showTimer;
  byId("uiShowInventory").checked = !!gt.ui.showInventory;
  byId("uiShowRoles").checked = !!gt.ui.showRoles;
  byId("uiShowScore").checked = !!gt.ui.showScore;
  byId("uiShowDistance").checked = !!gt.ui.showDistance;
  byId("uiShowMap").checked = !!gt.ui.showMap;
  byId("uiShowCompass").checked = !!gt.ui.showCompass;
}

function collectFormData() {
  const rawId = byId("gameTypeId")?.value || byId("gameTypeName")?.value || "";
  const id = slugify(rawId);

  if (!id) {
    throw new Error("Geef eerst een geldige interne ID of naam op.");
  }

  const modules = {};
  Object.entries(MODULE_IDS).forEach(([key, fieldId]) => {
    modules[key] = !!byId(fieldId)?.checked;
  });

  return {
    id,
    data: {
      name: byId("gameTypeName")?.value?.trim() || id,
      description: byId("gameTypeDescription")?.value?.trim() || "",
      engine: byId("gameTypeEngine")?.value || "classic",
      mapIcons: {
        checkpoint: byId("mapIconCheckpoint")?.value || "🎯",
        done: byId("mapIconDone")?.value || "✅",
        collectible: byId("mapIconCollectible")?.value || "✨",
        player: byId("mapIconPlayer")?.value || "🚶",
        gather: byId("mapIconGather")?.value || "⭐"
      },
      modules,
      rules: {
        checkpointFlow: byId("rulesCheckpointFlow")?.value || "rotatingRoute",
        finalObjective: byId("rulesFinalObjective")?.value || "gatherPoint",
        scoreMode: byId("rulesScoreMode")?.value || "normal",
        allowRetries: byId("rulesAllowRetries")?.value || "limited",
        maxTries: Number(byId("rulesMaxTries")?.value || 3),
        wrongAnswerPenalty: byId("rulesWrongAnswerPenalty")?.value || "skipCollectible"
      },
      timer: {
        mode: byId("timerMode")?.value || "global",
        totalMinutes: Number(byId("timerTotalMinutes")?.value || 90),
        checkpointSeconds: Number(byId("timerCheckpointSeconds")?.value || 0),
        expiryAction: byId("timerExpiryAction")?.value || "endGame"
      },
      inventory: {
        name: byId("inventoryName")?.value?.trim() || "Grimoire",
        mode: byId("inventoryMode")?.value || "visual",
        capacity: Number(byId("inventoryCapacity")?.value || 20)
      },
      collectibles: {
        unlockCondition: byId("collectiblesUnlockCondition")?.value || "searchZoneAfterCorrect",
        mapVisibility: byId("collectiblesMapVisibility")?.value || "blurZone",
        searchRadius: Number(byId("collectiblesSearchRadius")?.value || 30),
        revealDistance: Number(byId("collectiblesRevealDistance")?.value || 15),
        contentType: byId("collectiblesContentType")?.value || "usableItem"
      },
      usableItems: {
        targetMode: byId("usableItemsTargetMode")?.value || "enemy",
        useMode: byId("usableItemsUseMode")?.value || "manual",
        charges: Number(byId("usableItemsCharges")?.value || 1)
      },
      effects: {
        enabled: !!byId("effectsEnabled")?.checked,
        allowedEffects: readAllowedEffects(),
        defaultDuration: Number(byId("effectsDefaultDuration")?.value || 40),
        stackMode: byId("effectsStackMode")?.value || "replace"
      },
      ui: {
        showRanking: !!byId("uiShowRanking")?.checked,
        showTimer: !!byId("uiShowTimer")?.checked,
        showInventory: !!byId("uiShowInventory")?.checked,
        showRoles: !!byId("uiShowRoles")?.checked,
        showScore: !!byId("uiShowScore")?.checked,
        showDistance: !!byId("uiShowDistance")?.checked,
        showMap: !!byId("uiShowMap")?.checked,
        showCompass: !!byId("uiShowCompass")?.checked
      }
    }
  };
}

function setProtectedUIVisible(isVisible) {
  const loginScreen = byId("loginScreen");
  const appContent = byId("appContent");
  const loginStatus = byId("loginStatus");

  if (loginScreen) loginScreen.style.display = isVisible ? "none" : "block";
  if (appContent) appContent.style.display = isVisible ? "block" : "none";

  if (loginStatus) {
    loginStatus.innerText = isVisible && auth.currentUser ? `Ingelogd als: ${auth.currentUser.email}` : "";
  }
}

function initButtons() {
  byId("newGameTypeButton")?.addEventListener("click", () => {
    clearForm();
    setStatus("Nieuw speltype gestart.");
  });

  byId("gameTypeSelector")?.addEventListener("change", () => {
    const id = byId("gameTypeSelector")?.value || "";
    if (!id) {
      clearForm();
      return;
    }
    loadGameTypeIntoForm(id);
  });

  byId("saveGameTypeButton")?.addEventListener("click", async () => {
    try {
      const { id, data } = collectFormData();
      await set(ref(db, `speltypes/${id}`), data);
      setStatus(`Speltype "${id}" opgeslagen.`);
      byId("gameTypeSelector").value = id;
    } catch (error) {
      setStatus(error.message || "Opslaan mislukt.", true);
    }
  });

  byId("deleteGameTypeButton")?.addEventListener("click", async () => {
    const id = byId("gameTypeId")?.value?.trim() || byId("gameTypeSelector")?.value || "";
    if (!id) {
      setStatus("Kies eerst een speltype om te verwijderen.", true);
      return;
    }

    const ok = confirm(`Wil je speltype "${id}" echt verwijderen?`);
    if (!ok) return;

    await remove(ref(db, `speltypes/${id}`));
    setStatus(`Speltype "${id}" verwijderd.`);
    clearForm();
  });
}

function initRealtimeData() {
  onValue(ref(db, "speltypes"), (snapshot) => {
    gameTypesCache = snapshot.exists() ? snapshot.val() || {} : {};
    populateGameTypeSelector();

    const selected = byId("gameTypeSelector")?.value || "";
    if (selected && gameTypesCache[selected]) {
      loadGameTypeIntoForm(selected);
    }
  });
}

function bootstrap() {
  if (initialized) return;
  initialized = true;

  fillIconSelector("mapIconCheckpoint", "🎯");
  fillIconSelector("mapIconDone", "✅");
  fillIconSelector("mapIconCollectible", "✨");
  fillIconSelector("mapIconPlayer", "🚶");
  fillIconSelector("mapIconGather", "⭐");
  clearForm();
  initButtons();

  onAuthStateChanged(auth, (user) => {
    setProtectedUIVisible(!!user);
    if (!user) return;
    initRealtimeData();
  });
}

bootstrap();
