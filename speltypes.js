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
      wrongAnswerPenalty: "none"
    },

    timer: {
      mode: "global",
      totalMinutes: 90,
      checkpointSeconds: 0,
      expiryAction: "endGame"
    },

    story: {
      introMode: "popup",
      checkpointMode: "popup",
      tone: "neutral"
    },

    inventory: {
      name: "Grimoire",
      mode: "visual",
      capacity: 20
    },

    collectibles: {
      unlockCondition: "none",
      mapVisibility: "none",
      searchRadius: 30,
      revealDistance: 15,
      contentType: "story"
    },

    usableItems: {
      targetMode: "self",
      useMode: "manual",
      charges: 1
    },

    effects: {
      enabled: false,
      allowedEffects: [],
      defaultDuration: 30,
      stackMode: "replace"
    },

    roles: {
      enabled: false,
      type: "none",
      autoAssign: true,
      maxRoles: 1,
      assignmentMode: "random",
      objectiveMode: "none",
      rotation: {
        enabled: false,
        intervalMinutes: 15
      }
    },

    abilities: {
      mode: "none",
      allowedAbilities: []
    },

    proximity: {
      actionMode: "none",
      range: 25
    },

    sabotage: {
      enabled: false,
      requiresProximity: true,
      cooldownSeconds: 60,
      maxUses: 3,
      resourceMode: "collectibles"
    },

    chase: {
      mode: "none",
      tagDistance: 10,
      penaltyMode: "losePoints"
    },

    zoneControl: {
      mode: "none",
      scorePerMinute: 5,
      captureSeconds: 20
    },

    trading: {
      mode: "none",
      currencyMode: "points"
    },

    resources: {
      mode: "none",
      startValue: 3,
      maxValue: 5
    },

    puzzles: {
      flowMode: "independent",
      failureMode: "retry"
    },

    discovery: {
      mode: "none",
      rewardMode: "points"
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
    name: raw.name ?? base.name,
    description: raw.description ?? base.description,
    engine: raw.engine ?? base.engine,

    modules: {
      ...base.modules,
      ...(raw.modules || {})
    },

    rules: {
      ...base.rules,
      ...(raw.rules || {})
    },

    timer: {
      ...base.timer,
      ...(raw.timer || {})
    },

    story: {
      ...base.story,
      ...(raw.story || {})
    },

    inventory: {
      ...base.inventory,
      ...(raw.inventory || {})
    },

    collectibles: {
      ...base.collectibles,
      ...(raw.collectibles || {})
    },

    usableItems: {
      ...base.usableItems,
      ...(raw.usableItems || {})
    },

    effects: {
      ...base.effects,
      ...(raw.effects || {})
    },

    roles: {
      ...base.roles,
      ...(raw.roles || {}),
      rotation: {
        ...base.roles.rotation,
        ...(raw.roles?.rotation || {})
      }
    },

    abilities: {
      ...base.abilities,
      ...(raw.abilities || {})
    },

    proximity: {
      ...base.proximity,
      ...(raw.proximity || {})
    },

    sabotage: {
      ...base.sabotage,
      ...(raw.sabotage || {})
    },

    chase: {
      ...base.chase,
      ...(raw.chase || {})
    },

    zoneControl: {
      ...base.zoneControl,
      ...(raw.zoneControl || {})
    },

    trading: {
      ...base.trading,
      ...(raw.trading || {})
    },

    resources: {
      ...base.resources,
      ...(raw.resources || {})
    },

    puzzles: {
      ...base.puzzles,
      ...(raw.puzzles || {})
    },

    discovery: {
      ...base.discovery,
      ...(raw.discovery || {})
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

function readAllowedAbilities() {
  const abilities = [];
  if (byId("abilityScan")?.checked) abilities.push("scan");
  if (byId("abilityShield")?.checked) abilities.push("shield");
  if (byId("abilitySpeedBoost")?.checked) abilities.push("speed_boost");
  if (byId("abilityDoubleScore")?.checked) abilities.push("double_score");
  if (byId("abilityCleanse")?.checked) abilities.push("cleanse");
  if (byId("abilityRevealZone")?.checked) abilities.push("reveal_zone");
  return abilities;
}

function writeAllowedAbilities(abilities = []) {
  byId("abilityScan").checked = abilities.includes("scan");
  byId("abilityShield").checked = abilities.includes("shield");
  byId("abilitySpeedBoost").checked = abilities.includes("speed_boost");
  byId("abilityDoubleScore").checked = abilities.includes("double_score");
  byId("abilityCleanse").checked = abilities.includes("cleanse");
  byId("abilityRevealZone").checked = abilities.includes("reveal_zone");
}

function setModuleCheckbox(id, value) {
  const el = byId(id);
  if (el) el.checked = !!value;
}

function getModuleCheckbox(id) {
  return !!byId(id)?.checked;
}

function getModulesFromForm() {
  return {
    navigation: getModuleCheckbox("modNavigation"),
    questions: getModuleCheckbox("modQuestions"),
    score: getModuleCheckbox("modScore"),
    ranking: getModuleCheckbox("modRanking"),
    timer: getModuleCheckbox("modTimer"),
    story: getModuleCheckbox("modStory"),
    dialogs: getModuleCheckbox("modDialogs"),
    media: getModuleCheckbox("modMedia"),
    inventory: getModuleCheckbox("modInventory"),
    collectibles: getModuleCheckbox("modCollectibles"),
    searchZones: getModuleCheckbox("modSearchZones"),
    hiddenReveal: getModuleCheckbox("modHiddenReveal"),
    clickableItems: getModuleCheckbox("modClickableItems"),
    usableItems: getModuleCheckbox("modUsableItems"),
    evidenceBook: getModuleCheckbox("modEvidenceBook"),
    fingerprints: getModuleCheckbox("modFingerprints"),
    fakeClues: getModuleCheckbox("modFakeClues"),
    deduction: getModuleCheckbox("modDeduction"),
    secretRoles: getModuleCheckbox("modSecretRoles"),
    publicRoles: getModuleCheckbox("modPublicRoles"),
    roleSwitch: getModuleCheckbox("modRoleSwitch"),
    abilities: getModuleCheckbox("modAbilities"),
    proximity: getModuleCheckbox("modProximity"),
    sabotage: getModuleCheckbox("modSabotage"),
    effects: getModuleCheckbox("modEffects"),
    chase: getModuleCheckbox("modChase"),
    zoneControl: getModuleCheckbox("modZoneControl"),
    trading: getModuleCheckbox("modTrading"),
    resources: getModuleCheckbox("modResources"),
    puzzles: getModuleCheckbox("modPuzzles"),
    discovery: getModuleCheckbox("modDiscovery"),
    teacherControls: getModuleCheckbox("modTeacherControls")
  };
}

function fillModules(modules) {
  setModuleCheckbox("modNavigation", modules.navigation);
  setModuleCheckbox("modQuestions", modules.questions);
  setModuleCheckbox("modScore", modules.score);
  setModuleCheckbox("modRanking", modules.ranking);
  setModuleCheckbox("modTimer", modules.timer);
  setModuleCheckbox("modStory", modules.story);
  setModuleCheckbox("modDialogs", modules.dialogs);
  setModuleCheckbox("modMedia", modules.media);
  setModuleCheckbox("modInventory", modules.inventory);
  setModuleCheckbox("modCollectibles", modules.collectibles);
  setModuleCheckbox("modSearchZones", modules.searchZones);
  setModuleCheckbox("modHiddenReveal", modules.hiddenReveal);
  setModuleCheckbox("modClickableItems", modules.clickableItems);
  setModuleCheckbox("modUsableItems", modules.usableItems);
  setModuleCheckbox("modEvidenceBook", modules.evidenceBook);
  setModuleCheckbox("modFingerprints", modules.fingerprints);
  setModuleCheckbox("modFakeClues", modules.fakeClues);
  setModuleCheckbox("modDeduction", modules.deduction);
  setModuleCheckbox("modSecretRoles", modules.secretRoles);
  setModuleCheckbox("modPublicRoles", modules.publicRoles);
  setModuleCheckbox("modRoleSwitch", modules.roleSwitch);
  setModuleCheckbox("modAbilities", modules.abilities);
  setModuleCheckbox("modProximity", modules.proximity);
  setModuleCheckbox("modSabotage", modules.sabotage);
  setModuleCheckbox("modEffects", modules.effects);
  setModuleCheckbox("modChase", modules.chase);
  setModuleCheckbox("modZoneControl", modules.zoneControl);
  setModuleCheckbox("modTrading", modules.trading);
  setModuleCheckbox("modResources", modules.resources);
  setModuleCheckbox("modPuzzles", modules.puzzles);
  setModuleCheckbox("modDiscovery", modules.discovery);
  setModuleCheckbox("modTeacherControls", modules.teacherControls);
}

function setVisible(id, visible) {
  const el = byId(id);
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}

function updateDynamicSections() {
  const modules = getModulesFromForm();

  setVisible("sectionQuestions", modules.questions);
  setVisible("sectionTimer", modules.timer);
  setVisible("sectionStory", modules.story || modules.dialogs || modules.media);
  setVisible("sectionInventory", modules.inventory || modules.evidenceBook);
  setVisible("sectionCollectibles", modules.collectibles);
  setVisible("sectionUsableItems", modules.usableItems);
  setVisible("sectionEffects", modules.effects);
  setVisible("sectionRoles", modules.secretRoles || modules.publicRoles || modules.roleSwitch);
  setVisible("sectionAbilities", modules.abilities);
  setVisible("sectionProximity", modules.proximity);
  setVisible("sectionSabotage", modules.sabotage);
  setVisible("sectionChase", modules.chase);
  setVisible("sectionZoneControl", modules.zoneControl);
  setVisible("sectionTrading", modules.trading);
  setVisible("sectionResources", modules.resources);
  setVisible("sectionPuzzles", modules.puzzles);
  setVisible("sectionDiscovery", modules.discovery);

  const rankingCheckbox = byId("uiShowRanking");
  if (rankingCheckbox && !modules.ranking) {
    rankingCheckbox.checked = false;
  }

  const timerCheckbox = byId("uiShowTimer");
  if (timerCheckbox && !modules.timer) {
    timerCheckbox.checked = false;
  }

  const inventoryCheckbox = byId("uiShowInventory");
  if (inventoryCheckbox && !(modules.inventory || modules.evidenceBook)) {
    inventoryCheckbox.checked = false;
  }

  const rolesCheckbox = byId("uiShowRoles");
  if (rolesCheckbox && !(modules.publicRoles || modules.secretRoles || modules.roleSwitch)) {
    rolesCheckbox.checked = false;
  }

  const scoreCheckbox = byId("uiShowScore");
  if (scoreCheckbox && !modules.score) {
    scoreCheckbox.checked = false;
  }

  const compassCheckbox = byId("uiShowCompass");
  if (compassCheckbox && !modules.navigation) {
    compassCheckbox.checked = false;
  }

  const distanceCheckbox = byId("uiShowDistance");
  if (distanceCheckbox && !modules.navigation) {
    distanceCheckbox.checked = false;
  }

  const mapCheckbox = byId("uiShowMap");
  if (mapCheckbox && !modules.navigation) {
    mapCheckbox.checked = false;
  }
}

function applyEnginePreset(engine) {
  const base = defaultGameType();
  let preset = mergeGameTypeWithDefaults(base);

  if (engine === "classic") {
    preset.modules = {
      ...preset.modules,
      navigation: true,
      questions: true,
      score: true,
      ranking: true
    };
  }

  if (engine === "collectibles") {
    preset.modules = {
      ...preset.modules,
      navigation: true,
      questions: true,
      score: true,
      story: true,
      inventory: true,
      collectibles: true,
      searchZones: true,
      hiddenReveal: true,
      clickableItems: true
    };
    preset.inventory.name = "Grimoire";
    preset.collectibles.unlockCondition = "searchZoneAfterCorrect";
    preset.collectibles.mapVisibility = "blurZone";
  }

  if (engine === "murder") {
    preset.modules = {
      ...preset.modules,
      navigation: true,
      questions: true,
      score: true,
      story: true,
      dialogs: true,
      media: true,
      inventory: true,
      evidenceBook: true,
      collectibles: true,
      fakeClues: true,
      fingerprints: true,
      deduction: true
    };
    preset.inventory.name = "Dossier";
    preset.collectibles.contentType = "evidence";
  }

  if (engine === "mol") {
    preset.modules = {
      ...preset.modules,
      navigation: true,
      questions: true,
      score: true,
      ranking: true,
      timer: true,
      inventory: true,
      collectibles: true,
      usableItems: true,
      secretRoles: true,
      roleSwitch: true,
      proximity: true,
      sabotage: true,
      effects: true
    };
    preset.inventory.name = "Geheim dossier";
    preset.collectibles.contentType = "usable";
    preset.roles.enabled = true;
    preset.roles.type = "secret";
    preset.sabotage.enabled = true;
    preset.effects.enabled = true;
    preset.effects.allowedEffects = ["map_blur", "freeze", "score_steal", "compass_off", "shield"];
    preset.timer.mode = "global";
    preset.timer.totalMinutes = 90;
  }

  if (engine === "hunters") {
    preset.modules = {
      ...preset.modules,
      navigation: true,
      questions: true,
      score: true,
      timer: true,
      publicRoles: true,
      roleSwitch: true,
      proximity: true,
      chase: true,
      effects: true
    };
    preset.roles.enabled = true;
    preset.roles.type = "public";
    preset.chase.mode = "oneHunter";
  }

  if (engine === "race") {
    preset.modules = {
      ...preset.modules,
      navigation: true,
      questions: true,
      score: true,
      ranking: true,
      timer: true
    };
    preset.timer.mode = "global";
    preset.timer.totalMinutes = 60;
    preset.rules.scoreMode = "competitive";
  }

  if (engine === "territory") {
    preset.modules = {
      ...preset.modules,
      navigation: true,
      questions: true,
      score: true,
      ranking: true,
      zoneControl: true,
      proximity: true
    };
    preset.zoneControl.mode = "contest";
  }

  if (engine === "guilds") {
    preset.modules = {
      ...preset.modules,
      navigation: true,
      questions: true,
      score: true,
      publicRoles: true,
      abilities: true,
      inventory: true
    };
    preset.roles.enabled = true;
    preset.roles.type = "public";
    preset.abilities.mode = "roleBased";
  }

  if (engine === "trade") {
    preset.modules = {
      ...preset.modules,
      navigation: true,
      questions: true,
      score: true,
      inventory: true,
      collectibles: true,
      trading: true,
      proximity: true
    };
    preset.collectibles.contentType = "tradeGood";
    preset.trading.mode = "teamToTeam";
  }

  if (engine === "survival") {
    preset.modules = {
      ...preset.modules,
      navigation: true,
      questions: true,
      score: true,
      story: true,
      resources: true,
      effects: true,
      inventory: true,
      collectibles: true
    };
    preset.resources.mode = "remedies";
    preset.collectibles.contentType = "resource";
    preset.effects.allowedEffects = ["fog_overlay", "cleanse", "shield", "extra_time"];
  }

  if (engine === "escape") {
    preset.modules = {
      ...preset.modules,
      navigation: true,
      questions: true,
      story: true,
      puzzles: true,
      media: true
    };
    preset.puzzles.flowMode = "chain";
  }

  if (engine === "exploration") {
    preset.modules = {
      ...preset.modules,
      navigation: true,
      questions: true,
      score: true,
      discovery: true,
      story: true
    };
    preset.rules.checkpointFlow = "freeRoam";
    preset.discovery.mode = "optionalQuests";
  }

  if (engine === "timeTravel") {
    preset.modules = {
      ...preset.modules,
      navigation: true,
      questions: true,
      story: true,
      media: true,
      collectibles: true,
      inventory: true
    };
    preset.inventory.name = "Tijdsdossier";
  }

  if (engine === "mystery") {
    preset.modules = {
      ...preset.modules,
      navigation: true,
      questions: true,
      score: true,
      story: true,
      dialogs: true,
      inventory: true,
      collectibles: true,
      fakeClues: true,
      deduction: true
    };
    preset.inventory.name = "Onderzoeksboek";
  }

  fillFormFromData("", preset);
  setStatus(`Preset voor "${engine}" toegepast.`);
}

function collectFormData() {
  const id = slugify(byId("gameTypeId")?.value || "");
  const modules = getModulesFromForm();

  return {
    id,
    data: {
      name: byId("gameTypeName")?.value?.trim() || "",
      description: byId("gameTypeDescription")?.value?.trim() || "",
      engine: byId("gameTypeEngine")?.value || "classic",

      modules,

      rules: {
        checkpointFlow: byId("settingCheckpointFlow")?.value || "rotatingRoute",
        finalObjective: byId("settingFinalObjective")?.value || "gatherPoint",
        scoreMode: byId("settingScoreMode")?.value || "normal",
        allowRetries: byId("settingAllowRetries")?.value || "limited",
        maxTries: Number(byId("settingMaxTries")?.value || 3),
        wrongAnswerPenalty: byId("settingWrongAnswerPenalty")?.value || "none"
      },

      timer: {
        mode: byId("timerMode")?.value || "global",
        totalMinutes: Number(byId("timerTotalMinutes")?.value || 90),
        checkpointSeconds: Number(byId("timerCheckpointSeconds")?.value || 0),
        expiryAction: byId("timerExpiryAction")?.value || "endGame"
      },

      story: {
        introMode: byId("storyIntroMode")?.value || "popup",
        checkpointMode: byId("storyCheckpointMode")?.value || "popup",
        tone: byId("storyTone")?.value || "neutral"
      },

      inventory: {
        name: byId("inventoryName")?.value?.trim() || "Grimoire",
        mode: byId("inventoryMode")?.value || "visual",
        capacity: Number(byId("inventoryCapacity")?.value || 20)
      },

      collectibles: {
        unlockCondition: byId("settingCollectibleUnlock")?.value || "none",
        mapVisibility: byId("settingMapVisibility")?.value || "none",
        searchRadius: Number(byId("settingSearchRadius")?.value || 30),
        revealDistance: Number(byId("settingRevealDistance")?.value || 15),
        contentType: byId("collectibleContentType")?.value || "story"
      },

      usableItems: {
        targetMode: byId("usableItemsTargetMode")?.value || "self",
        useMode: byId("usableItemsUseMode")?.value || "manual",
        charges: Number(byId("usableItemsCharges")?.value || 1)
      },

      effects: {
        enabled: modules.effects,
        allowedEffects: readAllowedEffects(),
        defaultDuration: Number(byId("effectsDefaultDuration")?.value || 30),
        stackMode: byId("effectsStackMode")?.value || "replace"
      },

      roles: {
        enabled: byId("rolesEnabled")?.checked || false,
        type: byId("rolesType")?.value || "none",
        autoAssign: byId("rolesAutoAssign")?.checked || false,
        maxRoles: Number(byId("rolesMaxRoles")?.value || 1),
        assignmentMode: byId("rolesAssignmentMode")?.value || "random",
        objectiveMode: byId("rolesObjectiveMode")?.value || "none",
        rotation: {
          enabled: byId("rolesRotationEnabled")?.checked || false,
          intervalMinutes: Number(byId("rolesRotationMinutes")?.value || 15)
        }
      },

      abilities: {
        mode: byId("abilitiesMode")?.value || "none",
        allowedAbilities: readAllowedAbilities()
      },

      proximity: {
        actionMode: byId("proximityActionMode")?.value || "none",
        range: Number(byId("proximityRange")?.value || 25)
      },

      sabotage: {
        enabled: byId("sabotageEnabled")?.checked || false,
        requiresProximity: byId("sabotageRequiresProximity")?.checked || false,
        cooldownSeconds: Number(byId("sabotageCooldownSeconds")?.value || 60),
        maxUses: Number(byId("sabotageMaxUses")?.value || 3),
        resourceMode: byId("sabotageResourceMode")?.value || "collectibles"
      },

      chase: {
        mode: byId("chaseMode")?.value || "none",
        tagDistance: Number(byId("chaseTagDistance")?.value || 10),
        penaltyMode: byId("chasePenaltyMode")?.value || "losePoints"
      },

      zoneControl: {
        mode: byId("zoneControlMode")?.value || "none",
        scorePerMinute: Number(byId("zoneScorePerMinute")?.value || 5),
        captureSeconds: Number(byId("zoneCaptureSeconds")?.value || 20)
      },

      trading: {
        mode: byId("tradingMode")?.value || "none",
        currencyMode: byId("tradingCurrencyMode")?.value || "points"
      },

      resources: {
        mode: byId("resourceMode")?.value || "none",
        startValue: Number(byId("resourceStartValue")?.value || 3),
        maxValue: Number(byId("resourceMaxValue")?.value || 5)
      },

      puzzles: {
        flowMode: byId("puzzleFlowMode")?.value || "independent",
        failureMode: byId("puzzleFailureMode")?.value || "retry"
      },

      discovery: {
        mode: byId("discoveryMode")?.value || "none",
        rewardMode: byId("discoveryRewardMode")?.value || "points"
      },

      ui: {
        showRanking: byId("uiShowRanking")?.checked || false,
        showTimer: byId("uiShowTimer")?.checked || false,
        showInventory: byId("uiShowInventory")?.checked || false,
        showRoles: byId("uiShowRoles")?.checked || false,
        showScore: byId("uiShowScore")?.checked || false,
        showDistance: byId("uiShowDistance")?.checked || false,
        showMap: byId("uiShowMap")?.checked || false,
        showCompass: byId("uiShowCompass")?.checked || false
      }
    }
  };
}

function fillFormFromData(gameTypeId, rawData) {
  const data = mergeGameTypeWithDefaults(rawData);

  byId("gameTypeId").value = gameTypeId || "";
  byId("gameTypeName").value = data.name || "";
  byId("gameTypeDescription").value = data.description || "";
  byId("gameTypeEngine").value = data.engine || "classic";

  fillModules(data.modules);

  byId("settingCheckpointFlow").value = data.rules.checkpointFlow;
  byId("settingFinalObjective").value = data.rules.finalObjective;
  byId("settingScoreMode").value = data.rules.scoreMode;
  byId("settingAllowRetries").value = data.rules.allowRetries;
  byId("settingMaxTries").value = data.rules.maxTries;
  byId("settingWrongAnswerPenalty").value = data.rules.wrongAnswerPenalty;

  byId("timerMode").value = data.timer.mode;
  byId("timerTotalMinutes").value = data.timer.totalMinutes;
  byId("timerCheckpointSeconds").value = data.timer.checkpointSeconds;
  byId("timerExpiryAction").value = data.timer.expiryAction;

  byId("storyIntroMode").value = data.story.introMode;
  byId("storyCheckpointMode").value = data.story.checkpointMode;
  byId("storyTone").value = data.story.tone;

  byId("inventoryName").value = data.inventory.name;
  byId("inventoryMode").value = data.inventory.mode;
  byId("inventoryCapacity").value = data.inventory.capacity;

  byId("settingCollectibleUnlock").value = data.collectibles.unlockCondition;
  byId("settingMapVisibility").value = data.collectibles.mapVisibility;
  byId("settingSearchRadius").value = data.collectibles.searchRadius;
  byId("settingRevealDistance").value = data.collectibles.revealDistance;
  byId("collectibleContentType").value = data.collectibles.contentType;

  byId("usableItemsTargetMode").value = data.usableItems.targetMode;
  byId("usableItemsUseMode").value = data.usableItems.useMode;
  byId("usableItemsCharges").value = data.usableItems.charges;

  writeAllowedEffects(data.effects.allowedEffects);
  byId("effectsDefaultDuration").value = data.effects.defaultDuration;
  byId("effectsStackMode").value = data.effects.stackMode;

  byId("rolesEnabled").checked = !!data.roles.enabled;
  byId("rolesType").value = data.roles.type;
  byId("rolesAutoAssign").checked = !!data.roles.autoAssign;
  byId("rolesMaxRoles").value = data.roles.maxRoles;
  byId("rolesAssignmentMode").value = data.roles.assignmentMode;
  byId("rolesObjectiveMode").value = data.roles.objectiveMode;
  byId("rolesRotationEnabled").checked = !!data.roles.rotation.enabled;
  byId("rolesRotationMinutes").value = data.roles.rotation.intervalMinutes;

  byId("abilitiesMode").value = data.abilities.mode;
  writeAllowedAbilities(data.abilities.allowedAbilities);

  byId("proximityActionMode").value = data.proximity.actionMode;
  byId("proximityRange").value = data.proximity.range;

  byId("sabotageEnabled").checked = !!data.sabotage.enabled;
  byId("sabotageRequiresProximity").checked = !!data.sabotage.requiresProximity;
  byId("sabotageCooldownSeconds").value = data.sabotage.cooldownSeconds;
  byId("sabotageMaxUses").value = data.sabotage.maxUses;
  byId("sabotageResourceMode").value = data.sabotage.resourceMode;

  byId("chaseMode").value = data.chase.mode;
  byId("chaseTagDistance").value = data.chase.tagDistance;
  byId("chasePenaltyMode").value = data.chase.penaltyMode;

  byId("zoneControlMode").value = data.zoneControl.mode;
  byId("zoneScorePerMinute").value = data.zoneControl.scorePerMinute;
  byId("zoneCaptureSeconds").value = data.zoneControl.captureSeconds;

  byId("tradingMode").value = data.trading.mode;
  byId("tradingCurrencyMode").value = data.trading.currencyMode;

  byId("resourceMode").value = data.resources.mode;
  byId("resourceStartValue").value = data.resources.startValue;
  byId("resourceMaxValue").value = data.resources.maxValue;

  byId("puzzleFlowMode").value = data.puzzles.flowMode;
  byId("puzzleFailureMode").value = data.puzzles.failureMode;

  byId("discoveryMode").value = data.discovery.mode;
  byId("discoveryRewardMode").value = data.discovery.rewardMode;

  byId("uiShowRanking").checked = !!data.ui.showRanking;
  byId("uiShowTimer").checked = !!data.ui.showTimer;
  byId("uiShowInventory").checked = !!data.ui.showInventory;
  byId("uiShowRoles").checked = !!data.ui.showRoles;
  byId("uiShowScore").checked = !!data.ui.showScore;
  byId("uiShowDistance").checked = !!data.ui.showDistance;
  byId("uiShowMap").checked = !!data.ui.showMap;
  byId("uiShowCompass").checked = !!data.ui.showCompass;

  updateDynamicSections();
}

function clearForm() {
  fillFormFromData("", defaultGameType());
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

  fillFormFromData(id, gameTypesCache[id]);
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

  byId("gameTypeEngine")?.addEventListener("change", () => {
    const engine = byId("gameTypeEngine")?.value || "classic";
    applyEnginePreset(engine);
  });

  [
    "modNavigation","modQuestions","modScore","modRanking","modTimer","modStory","modDialogs","modMedia",
    "modInventory","modCollectibles","modSearchZones","modHiddenReveal","modClickableItems","modUsableItems",
    "modEvidenceBook","modFingerprints","modFakeClues","modDeduction","modSecretRoles","modPublicRoles",
    "modRoleSwitch","modAbilities","modProximity","modSabotage","modEffects","modChase","modZoneControl",
    "modTrading","modResources","modPuzzles","modDiscovery","modTeacherControls"
  ].forEach((id) => {
    byId(id)?.addEventListener("change", updateDynamicSections);
  });
}

function initDataListeners() {
  onValue(ref(db, "speltypes"), (snapshot) => {
    gameTypesCache = snapshot.val() || {};
    refreshSelector();

    const currentId = byId("gameTypeId")?.value?.trim() || "";
    if (currentId && gameTypesCache[currentId]) {
      fillFormFromData(currentId, gameTypesCache[currentId]);
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
