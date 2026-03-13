import { cities } from "./cities.js";
import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  get,
  set
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

let activeCityKey = Object.keys(cities)[0];
let checkpoints = [];
let selectedIndex = null;
let map;
let markers = [];
let tempClickMarker = null;

function populateCitySelector(){
  const select = document.getElementById("adminCitySelector");
  select.innerHTML = "";

  Object.entries(cities).forEach(([key, city]) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = city.name;
    select.appendChild(option);
  });

  select.value = activeCityKey;
}

function initMap(){
  map = L.map("map").setView(cities[activeCityKey].center, 15);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "OpenStreetMap"
  }).addTo(map);

  map.on("click", (e) => {
    document.getElementById("cpLat").value = e.latlng.lat.toFixed(6);
    document.getElementById("cpLng").value = e.latlng.lng.toFixed(6);

    if(tempClickMarker){
      map.removeLayer(tempClickMarker);
    }

    tempClickMarker = L.marker(e.latlng).addTo(map);
  });
}

function resetMapCity(){
  map.setView(cities[activeCityKey].center, 15);
}

function clearMarkers(){
  markers.forEach(marker => map.removeLayer(marker));
  markers = [];
}

function renderMarkers(){
  clearMarkers();

  checkpoints.forEach((cp, index) => {
    const marker = L.marker(cp.coords).addTo(map).bindPopup(cp.name);
    marker.on("click", () => {
      loadCheckpointIntoForm(index);
    });
    markers.push(marker);
  });
}

function renderCheckpointList(){
  const container = document.getElementById("checkpointList");
  container.innerHTML = "";

  if(checkpoints.length === 0){
    container.innerHTML = "<p>Nog geen checkpoints voor deze stad.</p>";
    return;
  }

  checkpoints.forEach((cp, index) => {
    const div = document.createElement("div");
    div.className = "checkpoint-card" + (selectedIndex === index ? " selected-card" : "");
    div.innerHTML = `
      <h3>${index + 1}. ${cp.name}</h3>
      <p><strong>Locatie:</strong> ${cp.coords[0]}, ${cp.coords[1]}</p>
      <p><strong>Radius:</strong> ${cp.radius} m</p>
      <p><strong>Vraag:</strong> ${cp.question}</p>
      <p><strong>Antwoorden:</strong> ${cp.answers.join(", ")}</p>
      <p><strong>Punten:</strong> juist ${cp.pointsCorrect}, na 3 pogingen ${cp.pointsAfterMaxTries}</p>
      <div class="checkpoint-actions">
        <button data-edit="${index}">Bewerk</button>
        <button data-delete="${index}">Verwijder</button>
      </div>
    `;
    container.appendChild(div);
  });

  container.querySelectorAll("button[data-edit]").forEach(button => {
    button.addEventListener("click", () => {
      loadCheckpointIntoForm(Number(button.dataset.edit));
    });
  });

  container.querySelectorAll("button[data-delete]").forEach(button => {
    button.addEventListener("click", () => {
      deleteCheckpoint(Number(button.dataset.delete));
    });
  });
}

function clearForm(){
  selectedIndex = null;
  document.getElementById("cpName").value = "";
  document.getElementById("cpLat").value = "";
  document.getElementById("cpLng").value = "";
  document.getElementById("cpRadius").value = "50";
  document.getElementById("cpQuestion").value = "";
  document.getElementById("cpAnswers").value = "";
  document.getElementById("cpPointsCorrect").value = "10";
  document.getElementById("cpPointsAfterMaxTries").value = "4";
  document.getElementById("adminFeedback").innerText = "Nieuw checkpoint.";
  renderCheckpointList();
}

function loadCheckpointIntoForm(index){
  const cp = checkpoints[index];
  if(!cp) return;

  selectedIndex = index;
  document.getElementById("cpName").value = cp.name;
  document.getElementById("cpLat").value = cp.coords[0];
  document.getElementById("cpLng").value = cp.coords[1];
  document.getElementById("cpRadius").value = cp.radius;
  document.getElementById("cpQuestion").value = cp.question;
  document.getElementById("cpAnswers").value = cp.answers.join(", ");
  document.getElementById("cpPointsCorrect").value = cp.pointsCorrect;
  document.getElementById("cpPointsAfterMaxTries").value = cp.pointsAfterMaxTries;
  document.getElementById("adminFeedback").innerText = "Checkpoint geladen in formulier.";
  renderCheckpointList();
}

function buildCheckpointFromForm(){
  const name = document.getElementById("cpName").value.trim();
  const lat = Number(document.getElementById("cpLat").value);
  const lng = Number(document.getElementById("cpLng").value);
  const radius = Number(document.getElementById("cpRadius").value);
  const question = document.getElementById("cpQuestion").value.trim();
  const answers = document.getElementById("cpAnswers").value
    .split(",")
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
  const pointsCorrect = Number(document.getElementById("cpPointsCorrect").value);
  const pointsAfterMaxTries = Number(document.getElementById("cpPointsAfterMaxTries").value);

  if(!name || Number.isNaN(lat) || Number.isNaN(lng) || Number.isNaN(radius) || !question){
    return null;
  }

  return {
    name,
    coords: [lat, lng],
    radius,
    question,
    answers,
    pointsCorrect,
    pointsAfterMaxTries
  };
}

function saveCheckpointToList(){
  const cp = buildCheckpointFromForm();

  if(!cp){
    document.getElementById("adminFeedback").innerText =
      "Vul minstens naam, latitude, longitude, radius en vraag correct in.";
    return;
  }

  if(selectedIndex === null){
    checkpoints.push(cp);
    selectedIndex = checkpoints.length - 1;
    document.getElementById("adminFeedback").innerText =
      "Checkpoint toegevoegd aan de lijst.";
  } else {
    checkpoints[selectedIndex] = cp;
    document.getElementById("adminFeedback").innerText =
      "Checkpoint bijgewerkt in de lijst.";
  }

  renderCheckpointList();
  renderMarkers();
}

function deleteCheckpoint(index){
  checkpoints.splice(index, 1);

  if(selectedIndex === index){
    selectedIndex = null;
  } else if(selectedIndex !== null && selectedIndex > index){
    selectedIndex--;
  }

  document.getElementById("adminFeedback").innerText =
    "Checkpoint verwijderd.";
  renderCheckpointList();
  renderMarkers();
}

async function loadCityFromFirebase(){
  const snapshot = await get(ref(db, "cityData/" + activeCityKey + "/checkpoints"));

  if(snapshot.exists()){
    const data = snapshot.val();
    checkpoints = Array.isArray(data) ? data : [];
    document.getElementById("adminFeedback").innerText =
      "Checkpoints geladen uit Firebase.";
  } else {
    checkpoints = [];
    document.getElementById("adminFeedback").innerText =
      "Nog geen checkpoints gevonden in Firebase voor deze stad.";
  }

  selectedIndex = null;
  renderCheckpointList();
  renderMarkers();
  resetMapCity();
}

function loadTemplateData(){
  checkpoints = JSON.parse(JSON.stringify(cities[activeCityKey].defaultCheckpoints || []));
  selectedIndex = null;
  renderCheckpointList();
  renderMarkers();
  resetMapCity();

  document.getElementById("adminFeedback").innerText =
    "Standaarddata geladen voor " + cities[activeCityKey].name + ".";
}

async function saveAllToFirebase(){
  await set(ref(db, "cityData/" + activeCityKey + "/checkpoints"), checkpoints);
  document.getElementById("adminFeedback").innerText =
    "Alle checkpoints opgeslagen in Firebase voor " + cities[activeCityKey].name + ".";
}

populateCitySelector();
initMap();
loadTemplateData();

document.getElementById("adminCitySelector").addEventListener("change", () => {
  activeCityKey = document.getElementById("adminCitySelector").value;
  document.getElementById("adminCityInfo").innerText =
    "Huidige stad: " + cities[activeCityKey].name;
  resetMapCity();
  clearForm();
  checkpoints = [];
  renderCheckpointList();
  renderMarkers();
});

document.getElementById("loadCityButton").addEventListener("click", loadCityFromFirebase);
document.getElementById("loadTemplateButton").addEventListener("click", loadTemplateData);
document.getElementById("newCheckpointButton").addEventListener("click", clearForm);
document.getElementById("saveCheckpointButton").addEventListener("click", saveCheckpointToList);
document.getElementById("deleteCheckpointButton").addEventListener("click", () => {
  if(selectedIndex === null){
    document.getElementById("adminFeedback").innerText = "Selecteer eerst een checkpoint.";
    return;
  }
  deleteCheckpoint(selectedIndex);
});
document.getElementById("saveAllButton").addEventListener("click", saveAllToFirebase);

document.getElementById("adminCityInfo").innerText =
  "Huidige stad: " + cities[activeCityKey].name;