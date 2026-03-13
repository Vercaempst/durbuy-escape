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
                coords: [50.951617, 3.123422],
                radius: 10,
                question: "In welk lokaal sta je nu?",
                answers: ["LK206"],
                pointsCorrect: 10,
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
      radius: 60,
      question: "",
      answers: [],
      pointsCorrect: 0,
      pointsAfterMaxTries: 0
    };
  }