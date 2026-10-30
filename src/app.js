import {
  initialiseGoogleLogin, signIn, signOut, connectDrive, getDriveToken
} from "./auth.js";
import { findBillsFolder, createBillsFolder } from "./drive.js";

const status = document.getElementById("setup-status");
const loginButton = document.getElementById("login-button");
const logoutButton = document.getElementById("logout-button");
const signedInView = document.getElementById("signed-in-view");
const signedInAccount = document.getElementById("signed-in-account");
const driveStatus = document.getElementById("drive-status");
const connectButton = document.getElementById("connect-drive-button");
const createFolderButton = document.getElementById("create-folder-button");

function showSignedOut(message = "Sign in with your authorised Google account.") {
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
    driveStatus.textContent = "Google Drive connected. The bills folder is ready.";
    createFolderButton.hidden = true;
  } else {
    driveStatus.textContent = "Drive connected. No app-created bills folder exists yet.";
    createFolderButton.hidden = false;
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
    await createBillsFolder(getDriveToken());
    driveStatus.textContent = "Google Drive connected. The bills folder is ready.";
    createFolderButton.hidden = true;
  } catch (error) {
    driveStatus.textContent = error.message || "Could not verify the storage folder.";
  } finally {
    createFolderButton.disabled = false;
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
