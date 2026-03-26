import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  update,
  get
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let currentCityKey = null;

function byId(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const el = byId(id);
  if (el) el.innerText = text;
}

function listenCurrentCity() {
  onValue(ref(db, "control/currentCity"), (snapshot) => {
    currentCityKey = snapshot.val();
    renderGroups();
  });
}

function renderGroups() {
  onValue(ref(db, "groups"), (snapshot) => {
    const data = snapshot.val();
    const container = byId("groupsContainer");

    if (!container) return;
    container.innerHTML = "";

    if (!data || !currentCityKey) {
      container.innerHTML = "<p>Geen groepen actief.</p>";
      return;
    }

    const groups = Object.values(data)
      .filter(g => g.cityKey === currentCityKey)
      .sort((a, b) => (a.groupNumber || 0) - (b.groupNumber || 0));

    if (!groups.length) {
      container.innerHTML = "<p>Geen groepen actief.</p>";
      return;
    }

    groups.forEach((g) => {
      const div = document.createElement("div");
      div.className = "teacher-card";

      let status = "Bezig";
      if (g.finished) status = "Klaar";
      if (g.gatherMode && !g.finished) status = "Verzamelpunt";

      let evidenceInfo = "";
      if (g.evidenceCount !== undefined) {
        evidenceInfo = `<p>🧾 Items: ${g.evidenceCount}</p>`;
      }

      div.innerHTML = `
        <h3>Groep ${g.groupNumber}: ${g.groupName}</h3>
        <p><strong>Leden:</strong> ${g.groupMembers}</p>
        <p><strong>Status:</strong> ${status}</p>
        <p><strong>Checkpoint:</strong> ${g.checkpoint || "-"}</p>
        <p><strong>Volgende:</strong> ${g.nextCheckpoint || "-"}</p>
        <p><strong>Score:</strong> ${g.score || 0}</p>
        <p><strong>Speltype:</strong> ${g.gameTypeName || "klassiek"}</p>
        ${evidenceInfo}

        <div class="button-grid">
          <button onclick="nextGroup('${g.groupId}')">➡️ Volgende</button>
          <button onclick="addPoints('${g.groupId}')">➕ Punten</button>
          <button onclick="sendMessage('${g.groupId}')">💬 Bericht</button>
          <button onclick="resetGroup('${g.groupId}')">🔄 Reset</button>
        </div>
      `;

      container.appendChild(div);
    });
  });
}

// --- COMMANDS ---

window.nextGroup = async function (groupId) {
  await update(ref(db, "groups/" + groupId), {
    commandNextAt: Date.now()
  });
};

window.addPoints = async function (groupId) {
  const value = prompt("Hoeveel punten toevoegen?");
  if (!value) return;

  await update(ref(db, "groups/" + groupId), {
    commandPointsAt: Date.now(),
    commandPointsValue: Number(value)
  });
};

window.sendMessage = async function (groupId) {
  const text = prompt("Bericht naar groep:");
  if (!text) return;

  await update(ref(db, "groups/" + groupId), {
    commandMessageAt: Date.now(),
    commandMessageText: text
  });
};

window.resetGroup = async function (groupId) {
  const confirmReset = confirm("Reset deze groep?");
  if (!confirmReset) return;

  await update(ref(db, "groups/" + groupId), {
    commandResetAt: Date.now()
  });
};

// --- GLOBAL COMMANDS ---

window.sendAllToGather = async function () {
  await update(ref(db, "control/globalCommands/" + currentCityKey), {
    type: "gather",
    at: Date.now()
  });
};

window.resumeGame = async function () {
  await update(ref(db, "control/globalCommands/" + currentCityKey), {
    type: "resume",
    at: Date.now()
  });
};

window.broadcastMessage = async function () {
  const text = prompt("Bericht naar alle groepen:");
  if (!text) return;

  await update(ref(db, "control/broadcasts/" + currentCityKey), {
    text: text,
    at: Date.now()
  });
};

window.hardResetAll = async function () {
  const confirmReset = confirm("ALLE groepen resetten?");
  if (!confirmReset) return;

  await update(ref(db, "control/globalReset"), {
    at: Date.now()
  });
};

// --- INIT ---

listenCurrentCity();
