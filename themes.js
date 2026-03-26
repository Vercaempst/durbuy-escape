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

let themesCache = {};
let activeThemeKey = null;

function byId(id) {
  return document.getElementById(id);
}

function login() {
  const email = byId("email").value.trim();
  const password = byId("password").value;

  signInWithEmailAndPassword(auth, email, password)
    .catch((error) => {
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

function setProtectedUIVisible(isVisible) {
  const loginScreen = byId("loginScreen");
  const appContent = byId("appContent");
  const loginStatus = byId("loginStatus");

  if (loginScreen) loginScreen.style.display = isVisible ? "none" : "block";
  if (appContent) appContent.style.display = isVisible ? "block" : "none";

  if (loginStatus) {
    loginStatus.innerText =
      isVisible && auth.currentUser
        ? "Ingelogd als: " + auth.currentUser.email
        : "";
  }
}

function defaultThemeObject(key = "") {
  return {
    key: key || "",
    name: "",
    backgroundType: "color",
    backgroundColor: "#1b1028",
    backgroundImage: "",
    fontFamily: "Arial, sans-serif",
    textColor: "#ffffff",
    cardColor: "rgba(34,20,52,0.88)",
    primaryColor: "#7c5cc4",
    secondaryColor: "#2e1f47",
    buttonColor: "#7c5cc4",
    buttonTextColor: "#ffffff",
    iconCheckpoint: "🚩",
    iconGather: "⭐",
    iconPlayer: "🚶",
    backgroundMusic: "",
    backgroundMusicVolume: 0.25,
    useGlowEffect: false,
    useFogEffect: false,
    borderRadius: "14px",
    boxShadow: "0 6px 18px rgba(0,0,0,0.35)"
  };
}

function populateThemeSelector() {
  const select = byId("themeSelector");
  if (!select) return;

  select.innerHTML = "";

  const keys = Object.keys(themesCache).sort((a, b) => a.localeCompare(b));

  if (!keys.length) {
    activeThemeKey = null;
    return;
  }

  if (!activeThemeKey || !keys.includes(activeThemeKey)) {
    activeThemeKey = keys[0];
  }

  keys.forEach((key) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = themesCache[key]?.name || key;
    select.appendChild(option);
  });

  select.value = activeThemeKey;
}

function fillThemeForm(themeKey) {
  const t = themesCache[themeKey] || defaultThemeObject(themeKey);

  byId("themeKeyInput").value = themeKey || "";
  byId("themeNameInput").value = t.name || "";
  byId("themeBackgroundType").value = t.backgroundType || "color";
  byId("themeBackgroundColor").value = t.backgroundColor || "#1b1028";
  byId("themeBackgroundImage").value = t.backgroundImage || "";
  byId("themeFontFamily").value = t.fontFamily || "Arial, sans-serif";
  byId("themeTextColor").value = t.textColor || "#ffffff";
  byId("themeCardColor").value = t.cardColor || "rgba(34,20,52,0.88)";
  byId("themePrimaryColor").value = t.primaryColor || "#7c5cc4";
  byId("themeSecondaryColor").value = t.secondaryColor || "#2e1f47";
  byId("themeButtonColor").value = t.buttonColor || "#7c5cc4";
  byId("themeButtonTextColor").value = t.buttonTextColor || "#ffffff";
  byId("themeIconCheckpoint").value = t.iconCheckpoint || "🚩";
  byId("themeIconGather").value = t.iconGather || "⭐";
  byId("themeIconPlayer").value = t.iconPlayer || "🚶";
  byId("themeBackgroundMusic").value = t.backgroundMusic || "";
  byId("themeBackgroundMusicVolume").value =
    typeof t.backgroundMusicVolume === "number" ? t.backgroundMusicVolume : 0.25;
  byId("themeUseGlowEffect").checked = !!t.useGlowEffect;
  byId("themeUseFogEffect").checked = !!t.useFogEffect;
  byId("themeBorderRadius").value = t.borderRadius || "14px";
  byId("themeBoxShadow").value = t.boxShadow || "0 6px 18px rgba(0,0,0,0.35)";

  updateFontPreview();
  updateThemePreview();
}

function buildThemeFromForm() {
  return {
    name: byId("themeNameInput").value.trim(),
    backgroundType: byId("themeBackgroundType").value,
    backgroundColor: byId("themeBackgroundColor").value.trim(),
    backgroundImage: byId("themeBackgroundImage").value.trim(),
    fontFamily: byId("themeFontFamily").value.trim(),
    textColor: byId("themeTextColor").value.trim(),
    cardColor: byId("themeCardColor").value.trim(),
    primaryColor: byId("themePrimaryColor").value.trim(),
    secondaryColor: byId("themeSecondaryColor").value.trim(),
    buttonColor: byId("themeButtonColor").value.trim(),
    buttonTextColor: byId("themeButtonTextColor").value.trim(),
    iconCheckpoint: byId("themeIconCheckpoint").value,
    iconGather: byId("themeIconGather").value,
    iconPlayer: byId("themeIconPlayer").value,
    backgroundMusic: byId("themeBackgroundMusic").value.trim(),
    backgroundMusicVolume: Number(byId("themeBackgroundMusicVolume").value || 0.25),
    useGlowEffect: byId("themeUseGlowEffect").checked,
    useFogEffect: byId("themeUseFogEffect").checked,
    borderRadius: byId("themeBorderRadius").value.trim(),
    boxShadow: byId("themeBoxShadow").value.trim()
  };
}

function updateFontPreview() {
  const fontPreviewText = byId("fontPreviewText");
  const fontFamily = byId("themeFontFamily").value;

  if (fontPreviewText) {
    fontPreviewText.style.fontFamily = fontFamily;
  }
}

function updateThemePreview() {
  const theme = buildThemeFromForm();

  const preview = byId("themePreview");
  const previewTitle = byId("previewTitle");
  const previewText = byId("previewText");
  const previewCard = byId("previewCard");
  const previewButtonA = byId("previewButtonA");
  const previewButtonB = byId("previewButtonB");
  const previewCheckpointIcon = byId("previewCheckpointIcon");
  const previewGatherIcon = byId("previewGatherIcon");
  const previewPlayerIcon = byId("previewPlayerIcon");

  if (!preview) return;

  preview.classList.toggle("theme-preview-fog", !!theme.useFogEffect);

  preview.style.color = theme.textColor || "#ffffff";
  preview.style.fontFamily = theme.fontFamily || "Arial, sans-serif";
  preview.style.borderRadius = theme.borderRadius || "14px";
  preview.style.boxShadow = theme.boxShadow || "0 6px 18px rgba(0,0,0,0.35)";

  if (theme.useGlowEffect) {
    preview.style.boxShadow = `0 0 18px ${theme.primaryColor || "#7c5cc4"}`;
  }

  if (theme.backgroundType === "image" && theme.backgroundImage) {
    preview.style.backgroundImage = `url('${theme.backgroundImage}')`;
    preview.style.backgroundSize = "cover";
    preview.style.backgroundPosition = "center";
    preview.style.backgroundColor = theme.backgroundColor || "#1b1028";
  } else {
    preview.style.backgroundImage = "none";
    preview.style.backgroundColor = theme.backgroundColor || "#1b1028";
  }

  if (previewTitle) previewTitle.style.fontFamily = theme.fontFamily || "Arial, sans-serif";
  if (previewText) previewText.style.fontFamily = theme.fontFamily || "Arial, sans-serif";

  if (previewCard) {
    previewCard.style.background = theme.cardColor || "rgba(34,20,52,0.88)";
    previewCard.style.color = theme.textColor || "#ffffff";
    previewCard.style.borderRadius = theme.borderRadius || "14px";
    previewCard.style.boxShadow = theme.boxShadow || "0 6px 18px rgba(0,0,0,0.35)";
  }

  [previewButtonA, previewButtonB].forEach((btn) => {
    if (!btn) return;
    btn.style.background = theme.buttonColor || "#7c5cc4";
    btn.style.color = theme.buttonTextColor || "#ffffff";
    btn.style.borderRadius = theme.borderRadius || "14px";
    btn.style.boxShadow = theme.boxShadow || "0 6px 18px rgba(0,0,0,0.35)";
    btn.style.fontFamily = theme.fontFamily || "Arial, sans-serif";
  });

  if (previewCheckpointIcon) previewCheckpointIcon.innerText = theme.iconCheckpoint || "🚩";
  if (previewGatherIcon) previewGatherIcon.innerText = theme.iconGather || "⭐";
  if (previewPlayerIcon) previewPlayerIcon.innerText = theme.iconPlayer || "🚶";
}

async function saveTheme() {
  const themeKey = byId("themeKeyInput").value.trim().toLowerCase();
  const themeName = byId("themeNameInput").value.trim();

  if (!themeKey || !themeName) {
    byId("themeFeedback").innerText = "Vul minstens een thema key en naam in.";
    return;
  }

  const theme = buildThemeFromForm();
  theme.name = themeName;

  await set(ref(db, "themes/" + themeKey), theme);

  activeThemeKey = themeKey;
  byId("themeFeedback").innerText = "Thema opgeslagen.";
}

async function loadTheme() {
  if (!activeThemeKey) return;

  const snapshot = await get(ref(db, "themes/" + activeThemeKey));
  if (!snapshot.exists()) {
    byId("themeFeedback").innerText = "Thema niet gevonden.";
    return;
  }

  themesCache[activeThemeKey] = snapshot.val();
  fillThemeForm(activeThemeKey);
  byId("themeFeedback").innerText = "Thema geladen.";
}

function newThemeForm() {
  activeThemeKey = null;
  byId("themeSelector").value = "";
  fillThemeForm("");
  byId("themeKeyInput").value = "";
  byId("themeNameInput").value = "";
  byId("themeFeedback").innerText = "Nieuw thema gestart.";
}

async function deleteTheme() {
  const themeKey = byId("themeKeyInput").value.trim().toLowerCase();

  if (!themeKey) {
    byId("themeFeedback").innerText = "Geen thema geselecteerd.";
    return;
  }

  const confirmed = confirm("Ben je zeker dat je dit thema wilt verwijderen?");
  if (!confirmed) return;

  await remove(ref(db, "themes/" + themeKey));
  byId("themeFeedback").innerText = "Thema verwijderd.";
}

function attachPreviewListeners() {
  const ids = [
    "themeBackgroundType",
    "themeBackgroundColor",
    "themeBackgroundImage",
    "themeFontFamily",
    "themeTextColor",
    "themeCardColor",
    "themePrimaryColor",
    "themeSecondaryColor",
    "themeButtonColor",
    "themeButtonTextColor",
    "themeIconCheckpoint",
    "themeIconGather",
    "themeIconPlayer",
    "themeBackgroundMusic",
    "themeBackgroundMusicVolume",
    "themeUseGlowEffect",
    "themeUseFogEffect",
    "themeBorderRadius",
    "themeBoxShadow"
  ];

  ids.forEach((id) => {
    const el = byId(id);
    if (!el) return;

    el.addEventListener("input", () => {
      if (id === "themeFontFamily") {
        updateFontPreview();
      }
      updateThemePreview();
    });

    el.addEventListener("change", () => {
      if (id === "themeFontFamily") {
        updateFontPreview();
      }
      updateThemePreview();
    });
  });
}

byId("themeSelector")?.addEventListener("change", (e) => {
  activeThemeKey = e.target.value;
  fillThemeForm(activeThemeKey);
});

byId("loadThemeButton")?.addEventListener("click", loadTheme);
byId("saveThemeButton")?.addEventListener("click", saveTheme);
byId("newThemeButton")?.addEventListener("click", newThemeForm);
byId("deleteThemeButton")?.addEventListener("click", deleteTheme);
byId("previewThemeButton")?.addEventListener("click", () => {
  updateFontPreview();
  updateThemePreview();
});

attachPreviewListeners();

onValue(ref(db, "themes"), (snapshot) => {
  themesCache = snapshot.val() || {};
  populateThemeSelector();

  if (activeThemeKey) {
    fillThemeForm(activeThemeKey);
  } else {
    fillThemeForm("");
  }
});

onAuthStateChanged(auth, (user) => {
  setProtectedUIVisible(!!user);
});
