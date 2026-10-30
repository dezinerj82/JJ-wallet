import {
  initialiseGoogleLogin, signIn, signOut, connectDrive, getDriveToken
} from "./auth.js";
import { findBillsFolder, createBillsFolder, testTextStorage } from "./drive.js";

const status = document.getElementById("setup-status");
const loginButton = document.getElementById("login-button");
const logoutButton = document.getElementById("logout-button");
const signedInView = document.getElementById("signed-in-view");
const signedInAccount = document.getElementById("signed-in-account");
const driveStatus = document.getElementById("drive-status");
const connectButton = document.getElementById("connect-drive-button");
const createFolderButton = document.getElementById("create-folder-button");
const testStorageButton = document.getElementById("test-storage-button");
let activeFolderId = null;

function showSignedOut(message = "Sign in with your authorised Google account.") {
  activeFolderId = null;
  testStorageButton.hidden = true;
  signedInView.hidden = true;
  loginButton.hidden = false;
  status.textContent = message;
  signedInAccount.textContent = "";
  driveStatus.textContent = "Google Drive is not connected.";
  connectButton.disabled = false;
  createFolderButton.hidden = true;
  createFolderButton.disabled = false;
}

function showSignedIn(email) {
  activeFolderId = null;
  testStorageButton.hidden = true;
  loginButton.hidden = true;
  signedInView.hidden = false;
  signedInAccount.textContent = `Signed in as ${email}`;
  status.textContent = "Google identity confirmed.";
  driveStatus.textContent = "Google Drive is not connected.";
  connectButton.disabled = false;
  createFolderButton.hidden = true;
}

async function checkFolder() {
  driveStatus.textContent = "Checking the private Drive folder...";
  const folder = await findBillsFolder(getDriveToken());
  if (!getDriveToken()) throw new Error("Google Drive session expired. Connect again.");
  if (folder) {
    activeFolderId = folder.id;
    driveStatus.textContent = "Google Drive connected. The Bills folder is ready.";
    createFolderButton.hidden = true;
    testStorageButton.hidden = false;
  } else {
    activeFolderId = null;
    driveStatus.textContent = "Drive connected. No app-created Bills folder exists yet.";
    createFolderButton.hidden = false;
    testStorageButton.hidden = true;
  }
}

async function onDriveReady() {
  connectButton.disabled = true;
  try {
    await checkFolder();
  } catch (error) {
    driveStatus.textContent = error.message || "Google Drive could not be checked.";
  } finally {
    connectButton.disabled = false;
  }
}

loginButton.addEventListener("click", () => {
  try {
    status.textContent = "Opening Google sign-in...";
    signIn();
  } catch (error) {
    showSignedOut(error.message);
  }
});

connectButton.addEventListener("click", () => {
  try {
    driveStatus.textContent = "Opening Google Drive permission...";
    connectButton.disabled = true;
    connectDrive(); // Start the popup synchronously from a user gesture.
  } catch (error) {
    connectButton.disabled = false;
    driveStatus.textContent = error.message;
  }
});

createFolderButton.addEventListener("click", async () => {
  createFolderButton.disabled = true;
  driveStatus.textContent = "Creating and checking the private bills folder...";
  try {
    const folder = await createBillsFolder(getDriveToken());
    activeFolderId = folder.id;
    driveStatus.textContent = "Google Drive connected. The Bills folder is ready.";
    createFolderButton.hidden = true;
    testStorageButton.hidden = false;
  } catch (error) {
    driveStatus.textContent = error.message || "Could not verify the storage folder.";
  } finally {
    createFolderButton.disabled = false;
  }
});

testStorageButton.addEventListener("click", async () => {
  testStorageButton.disabled = true;
  driveStatus.textContent = "Testing TXT save and read...";
  try {
    const result = await testTextStorage(getDriveToken(), activeFolderId);
    driveStatus.textContent = "TXT storage confirmed: " + result.name + " was saved and read successfully.";
  } catch (error) {
    driveStatus.textContent = error.message || "TXT storage test failed.";
  } finally {
    testStorageButton.disabled = false;
  }
});

logoutButton.addEventListener("click", () => {
  signOut();
  showSignedOut();
});

try {
  await initialiseGoogleLogin({
    onSignedIn: showSignedIn,
    onError: message => showSignedOut(message),
    onDriveReady,
    onDriveError: message => {
      connectButton.disabled = false;
      driveStatus.textContent = message;
    }
  });
  loginButton.disabled = false;
  showSignedOut();
} catch (error) {
  loginButton.disabled = true;
  showSignedOut(error.message);
}
