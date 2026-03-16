/*
VOORBEELDEN VAN CHECKPOINT TYPES

1. TEXT
{
  name: "Checkpoint 1",
  coords: [50.3528, 5.4560],
  radius: 40,
  taskType: "text",
  question: "Hoe heet dit plein?",
  answers: ["grote markt", "markt"],
  pointsCorrect: 10,
  pointsAfterMaxTries: 3
}

2. RIDDLE
{
  name: "Checkpoint 2",
  coords: [50.3535, 5.4570],
  radius: 40,
  taskType: "riddle",
  question: "Ik heb steden maar geen huizen. Ik heb water maar geen vissen. Wat ben ik?",
  answers: ["kaart", "een kaart"],
  pointsCorrect: 12,
  pointsAfterMaxTries: 4
}

3. MULTIPLE CHOICE
{
  name: "Checkpoint 3",
  coords: [50.3540, 5.4580],
  radius: 40,
  taskType: "multipleChoice",
  question: "Waarvoor diende dit gebouw vroeger?",
  options: ["Kerk", "Stadhuis", "School", "Gevangenis"],
  correctOption: 1,
  pointsCorrect: 10,
  pointsAfterMaxTries: 3
}

4. MATCHING
{
  name: "Checkpoint 4",
  coords: [50.3550, 5.4590],
  radius: 40,
  taskType: "matching",
  question: "Koppel de plaats aan de juiste beschrijving.",
  leftItems: ["Brug", "Fontein", "Kasteel"],
  rightItems: ["Over de rivier", "Water in het midden", "Oud verdedigingsgebouw"],
  correctPairs: {
    "Brug": "Over de rivier",
    "Fontein": "Water in het midden",
    "Kasteel": "Oud verdedigingsgebouw"
  },
  pointsCorrect: 15,
  pointsAfterMaxTries: 5
}

5. IMAGE PUZZLE
{
  name: "Checkpoint 5",
  coords: [50.3560, 5.4600],
  radius: 40,
  taskType: "imagePuzzle",
  question: "Los de puzzel op en herken deze plaats in het echt.",
  imageUrl: "images/brug.jpg",
  gridSize: 3,
  pointsCorrect: 20,
  pointsAfterMaxTries: 5
}

6. PHOTO
Nog niet actief in de huidige versie, hiervoor is Firebase Storage nodig.

{
  name: "Checkpoint 6",
  coords: [50.3570, 5.4610],
  radius: 40,
  taskType: "photo",
  question: "Neem een groepsfoto met het monument op de achtergrond.",
  pointsCorrect: 20,
  pointsAfterMaxTries: 0
}
*/

export const cities = {
    durbuy: {
      name: "Durbuy",
      center: [50.3528, 5.4560],
      gather: [50.3528, 5.4560],
      defaultCheckpoints: [
        {
          name: "Checkpoint 1",
          coords: [50.3523, 5.4562],
          radius: 50,
          question: "Neem een groepsfoto met een straatnaambord. Typ daarna: klaar",
          answers: ["klaar"],
          pointsCorrect: 10,
          pointsAfterMaxTries: 4
        },
        {
          name: "Checkpoint 2",
          coords: [50.3534, 5.4572],
          radius: 50,
          question: "In welk jaar kreeg Durbuy stadsrechten?",
          answers: ["1331"],
          pointsCorrect: 10,
          pointsAfterMaxTries: 4
        },
        {
          name: "Checkpoint 3",
          coords: [50.3518, 5.4551],
          radius: 50,
          question: "Welke watersport zie je hier vaak?",
          answers: ["kajak", "kano"],
          pointsCorrect: 10,
          pointsAfterMaxTries: 4
        },
        {
          name: "Checkpoint 4",
          coords: [50.3529, 5.4546],
          radius: 50,
          question: "Noem een reden waarom deze plek strategisch lag.",
          answers: ["rivier", "brug", "hoogte", "uitzicht"],
          pointsCorrect: 20,
          pointsAfterMaxTries: 8
        },
        {
          name: "Checkpoint 5",
          coords: [50.3540, 5.4567],
          radius: 50,
          question: "Neem een foto van een standbeeld en poseer hetzelfde. Typ daarna: klaar",
          answers: ["klaar"],
          pointsCorrect: 10,
          pointsAfterMaxTries: 4
        },
        {
          name: "Checkpoint 6",
          coords: [50.3530, 5.4580],
          radius: 50,
          question: "Welke kleur heeft de natuursteen meestal?",
          answers: ["grijs"],
          pointsCorrect: 10,
          pointsAfterMaxTries: 4
        },
        {
          name: "Checkpoint 7",
          coords: [50.3515, 5.4570],
          radius: 50,
          question: "Noem een nadeel van massatoerisme.",
          answers: ["drukte", "afval", "verkeer", "overlast"],
          pointsCorrect: 20,
          pointsAfterMaxTries: 8
        },
        {
          name: "Checkpoint 8",
          coords: [50.3525, 5.4555],
          radius: 50,
          question: "Maak een overwinningsfoto. Typ daarna: klaar",
          answers: ["klaar"],
          pointsCorrect: 10,
          pointsAfterMaxTries: 4
        }
      ]
    },
  
    brugge: {
      name: "Brugge",
      center: [51.2089, 3.2243],
      gather: [51.2089, 3.2243],
      defaultCheckpoints: []
    },
  
    gent: {
      name: "Gent",
      center: [51.0543, 3.7174],
      gather: [51.0543, 3.7174],
      defaultCheckpoints: []
    },

    school: {
        name: "MSKA",
        center: [50.95151, 3.12365],
        gather: [50.95151, 3.12365],
        defaultCheckpoints: [
            {
                name: "Checkpoint 1",
                coords: [50.951403, 3.124427],
                radius: 10,
                question: "Welk deel van de school neemt deze deur naar binnen?",
                answers: ["zoom"],
                pointsCorrect: 10,
                pointsAfterMaxTries: 4
              },
              {
                name: "Checkpoint 2",
                coords: [50.951864, 3.123595],
                radius: 10,
                question: "In welk lokaal sta je nu?",
                answers: ["lk206"],
                pointsCorrect: 10,
                pointsAfterMaxTries: 4
              },
              {
                name: "Checkpoint 3",
                coords: [50.951230, 3.123028],
                radius: 10,
                question: "Op welke campus sta je nu?",
                answers: ["tant"],
                pointsCorrect: 10,
                pointsAfterMaxTries: 4
              },
        ]
      },

    thuis: {
        name: "thuis",
        center: [50.89795, 3.26638],
        gather: [50.89795, 3.26638],
        defaultCheckpoints: [
            {
                name: "Checkpoint 1",
                coords: [50.898054, 3.266636],
                radius: 10,
                question: "Waar sta je nu? oprit, keuken, achtertuin of voortuin?",
                answers: ["oprit"],
                pointsCorrect: 3,
                pointsAfterMaxTries: 4
              },
              {
                name: "Checkpoint 2",
                coords: [50.89791, 3.26626],
                radius: 10,
                taskType: "imagePuzzle",
                question: "Los de puzzel op en herken deze plaats in het echt.",
                imageUrl: "images/check2thuis.jpg",
                gridSize: 3,
                pointsCorrect: 20,
                pointsAfterMaxTries: 5
              },
              {
                name: "Checkpoint 3",
                coords: [50.897954, 3.266054],
                radius: 10,
                question: "Waar sta je nu? oprit, keuken, achtertuin of voortuin?",
                answers: ["achtertuin"],
                pointsCorrect: 3,
                pointsAfterMaxTries: 4
              },
              {
                name: "Checkpoint 4",
                coords: [50.897926, 3.266512],
                radius: 10,
                question: "Waar sta je nu? oprit, keuken, achtertuin of voortuin?",
                answers: ["voortuin"],
                pointsCorrect: 3,
                pointsAfterMaxTries: 4
              },
        ]
      },

  };
  
  export function getGatherCheckpoint(cityKey){
    const city = cities[cityKey];
    return {
      name: "Verzamelpunt",
      coords: city.gather,
      radius: 10,
      question: "",
      answers: [],
      pointsCorrect: 0,
      pointsAfterMaxTries: 0
    };

  }
