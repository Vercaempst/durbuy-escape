const DRIVE_FOLDER_ID = "1uYhnoihQVETAAHo6tsGolekK1njq3IL3";
const FIREBASE_DB_URL = "https://durbuy-escape-default-rtdb.europe-west1.firebasedatabase.app";

function processUploadQueue() {
  try {
    const queueUrl = FIREBASE_DB_URL + "/uploadQueue.json";
    const response = UrlFetchApp.fetch(queueUrl, {
      method: "get",
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    const body = response.getContentText();

    Logger.log("Queue fetch code: " + code);

    if (code < 200 || code >= 300) {
      Logger.log("Queue fetch mislukt: " + body);
      return;
    }

    const queue = JSON.parse(body);

    if (!queue) {
      Logger.log("Geen uploads in wachtrij.");
      return;
    }

    const rootFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID);

    Object.keys(queue).forEach((cityKey) => {
      const cityNode = queue[cityKey];
      if (!cityNode) return;

      Object.keys(cityNode).forEach((groupId) => {
        const groupNode = cityNode[groupId];
        if (!groupNode) return;

        Object.keys(groupNode).forEach((checkpointKey) => {
          const item = groupNode[checkpointKey];
          if (!item || item.processed === true) return;

          try {
            Logger.log("Verwerken: " + cityKey + " / " + groupId + " / " + checkpointKey);

            const groupFolderName = String(item.groupFolderName || ("Groep_" + groupId)).trim();

            let groupFolder;
            const folders = rootFolder.getFoldersByName(groupFolderName);

            if (folders.hasNext()) {
              groupFolder = folders.next();
            } else {
              groupFolder = rootFolder.createFolder(groupFolderName);
            }

            const bytes = Utilities.base64Decode(item.imageBase64);
            const blob = Utilities.newBlob(
              bytes,
              "image/jpeg",
              item.filename || (checkpointKey + ".jpg")
            );

            const file = groupFolder.createFile(blob);

            const submissionPayload = {
              cityKey: item.cityKey || cityKey,
              groupId: item.groupId || groupId,
              groupNumber: item.groupNumber || "",
              groupName: item.groupName || "",
              groupMembers: item.groupMembers || "",
              checkpointName: item.checkpointName || checkpointKey,
              checkpointIndex: item.checkpointIndex ?? "",
              safeCheckpointName: item.safeCheckpointName || checkpointKey,
              driveFileId: file.getId(),
              driveFileUrl: file.getUrl(),
              submittedAt: new Date().toISOString()
            };

            const submissionUrl =
              FIREBASE_DB_URL +
              "/photoSubmissions/" +
              encodeURIComponent(cityKey) + "/" +
              encodeURIComponent(groupId) + "/" +
              encodeURIComponent(checkpointKey) +
              ".json";

            const queueItemUrl =
              FIREBASE_DB_URL +
              "/uploadQueue/" +
              encodeURIComponent(cityKey) + "/" +
              encodeURIComponent(groupId) + "/" +
              encodeURIComponent(checkpointKey) +
              ".json";

            UrlFetchApp.fetch(submissionUrl, {
              method: "put",
              contentType: "application/json",
              payload: JSON.stringify(submissionPayload),
              muteHttpExceptions: true
            });

            const processedPayload = {
              ...item,
              processed: true,
              processedAt: new Date().toISOString(),
              driveFileId: file.getId(),
              driveFileUrl: file.getUrl()
            };

            UrlFetchApp.fetch(queueItemUrl, {
              method: "put",
              contentType: "application/json",
              payload: JSON.stringify(processedPayload),
              muteHttpExceptions: true
            });

            Logger.log("Klaar: " + checkpointKey);

          } catch (err) {
            Logger.log("Fout bij verwerken van item: " + err);

            const queueItemUrl =
              FIREBASE_DB_URL +
              "/uploadQueue/" +
              encodeURIComponent(cityKey) + "/" +
              encodeURIComponent(groupId) + "/" +
              encodeURIComponent(checkpointKey) +
              ".json";

            const failedPayload = {
              ...item,
              processed: false,
              error: String(err),
              lastTriedAt: new Date().toISOString()
            };

            UrlFetchApp.fetch(queueItemUrl, {
              method: "put",
              contentType: "application/json",
              payload: JSON.stringify(failedPayload),
              muteHttpExceptions: true
            });
          }
        });
      });
    });

  } catch (error) {
    Logger.log("Algemene fout in processUploadQueue: " + error);
  }
}

function testDriveAccess() {
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  Logger.log("Mapnaam: " + folder.getName());
}

function testDriveCreateFile() {
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const blob = Utilities.newBlob("test", "text/plain", "test.txt");
  const file = folder.createFile(blob);
  Logger.log("Bestand gemaakt: " + file.getName());
}
