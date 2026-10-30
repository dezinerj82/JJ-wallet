import {
  initialiseGoogleLogin, signIn, signOut, connectDrive, getDriveToken
} from "./auth.js";
import { findBillsFolder, testTextStorage } from "./drive.js";

const TRUST_KEY = "home-wallet-remember-browser-v1";

const status = document.getElementById("setup-status");
const signInActions = document.getElementById("sign-in-actions");
const loginButton = document.getElementById("login-button");
const rememberBrowser = document.getElementById("remember-browser");
const signedInView = document.getElementById("signed-in-view");
const signedInAccount = document.getElementById("signed-in-account");
const unauthorizedView = document.getElementById("unauthorized-view");
const unauthorizedAccount = document.getElementById("unauthorized-account");
const unauthorizedLogoutButton = document.getElementById("unauthorized-logout-button");
const logoutButton = document.getElementById("logout-button");
const driveStatus = document.getElementById("drive-status");
const connectButton = document.getElementById("connect-drive-button");
const testStorageButton = document.getElementById("test-storage-button");

let activeFolderId = null;
let selectingAccountRequired = false;
let attemptedFastLogin = false;
let signInReady = false;

function readRememberedBrowser() {
  try { return localStorage.getItem(TRUST_KEY) === "yes"; }
  catch { return false; }
}

function setRememberedBrowser(remember) {
  // A convenience preference only — never a credential or access token.
  try {
    if (remember) localStorage.setItem(TRUST_KEY, "yes");
    else localStorage.removeItem(TRUST_KEY);
  } catch { /* private browsing may block storage */ }
}

rememberBrowser.checked = readRememberedBrowser();

function refreshLoginButton() {
  const fast = rememberBrowser.checked && !selectingAccountRequired;
  loginButton.textContent = fast ? "Continue with Google" : "Sign in with Google";
  loginButton.disabled = !signInReady;
}

function showSignedOut(message = "Sign in with your Google account.") {
  activeFolderId = null;
  signInActions.hidden = false;
  signedInView.hidden = true;
  unauthorizedView.hidden = true;
  signedInAccount.textContent = "";
  unauthorizedAccount.textContent = "";
  driveStatus.textContent = "Google Drive is not connected.";
  connectButton.disabled = false;
  testStorageButton.hidden = true;
  testStorageButton.disabled = false;
  status.textContent = message;
  refreshLoginButton();
}

function showSignedIn(email) {
  setRememberedBrowser(rememberBrowser.checked);
  attemptedFastLogin = false;
  selectingAccountRequired = false;
  activeFolderId = null;
  signInActions.hidden = true;
  unauthorizedView.hidden = true;
  signedInView.hidden = false;
  signedInAccount.textContent = "Signed in as " + email;
  status.textContent = "Google identity confirmed.";
  driveStatus.textContent = "Google Drive is not connected.";
  connectButton.disabled = false;
  testStorageButton.hidden = true;
}

function showUnauthorized(email) {
  // Google verified an identity, but it is not in the wallet owner's allowlist.
  signOut();
  attemptedFastLogin = false;
  selectingAccountRequired = true;
  rememberBrowser.checked = false;
  setRememberedBrowser(false);
  activeFolderId = null;
  signInActions.hidden = true;
  signedInView.hidden = true;
  unauthorizedView.hidden = false;
  unauthorizedAccount.textContent = "Signed in as " + email;
  status.textContent = "Google identity confirmed.";
}

async function checkFolder() {
  driveStatus.textContent = "Looking for your private Bills folder...";
  const folder = await findBillsFolder(getDriveToken());
  if (!getDriveToken()) throw new Error("Google Drive session expired. Reconnect Google Drive.");
  if (!folder) {
    activeFolderId = null;
    testStorageButton.hidden = true;
    driveStatus.textContent =
      "Bills folder not found. If you moved it, check access and reconnect; no new folder was created.";
    return;
  }
  // The folder is recognized by its app marker, even after moving it under Github/Bills.
  activeFolderId = folder.id;
  testStorageButton.hidden = false;
  driveStatus.textContent = "Google Drive connected. Bills folder found.";
}

async function onDriveReady() {
  connectButton.disabled = true;
  try {
    await checkFolder();
  } catch (error) {
    activeFolderId = null;
    testStorageButton.hidden = true;
    driveStatus.textContent = error.message || "Google Drive could not be checked.";
  } finally {
    connectButton.disabled = false;
  }
}

rememberBrowser.addEventListener("change", () => {
  selectingAccountRequired = false;
  refreshLoginButton();
});

loginButton.addEventListener("click", () => {
  try {
    const fast = rememberBrowser.checked && !selectingAccountRequired;
    attemptedFastLogin = fast;
    status.textContent = fast ? "Trying faster Google sign-in..." : "Opening Google sign-in...";
    // The request is synchronous with the click so Google can open a login popup.
    signIn({ fast });
  } catch (error) {
    selectingAccountRequired = true;
    showSignedOut(error.message);
  }
});

connectButton.addEventListener("click", () => {
  try {
    driveStatus.textContent = "Opening Google Drive permission...";
    connectButton.disabled = true;
    connectDrive();
  } catch (error) {
    connectButton.disabled = false;
    driveStatus.textContent = error.message;
  }
});

testStorageButton.addEventListener("click", async () => {
  if (!activeFolderId) {
    driveStatus.textContent = "Connect the private Bills folder first.";
    return;
  }
  testStorageButton.disabled = true;
  driveStatus.textContent = "Testing TXT save and read...";
  try {
    const result = await testTextStorage(getDriveToken(), activeFolderId);
    driveStatus.textContent =
      "TXT storage confirmed: " + result.name + " was saved and read successfully.";
  } catch (error) {
    driveStatus.textContent = error.message || "TXT storage test failed.";
  } finally {
    testStorageButton.disabled = false;
  }
});

function logout() {
  signOut();
  // Signing out deliberately removes the remembered-browser preference.
  setRememberedBrowser(false);
  rememberBrowser.checked = false;
  selectingAccountRequired = false;
  attemptedFastLogin = false;
  showSignedOut();
}

logoutButton.addEventListener("click", logout);
unauthorizedLogoutButton.addEventListener("click", logout);

try {
  await initialiseGoogleLogin({
    onSignedIn: showSignedIn,
    onUnauthorized: showUnauthorized,
    onError: message => {
      if (attemptedFastLogin) {
        selectingAccountRequired = true;
        attemptedFastLogin = false;
        showSignedOut("Fast login unavailable. Click Sign in with Google to choose your account.");
      } else {
        showSignedOut(message);
      }
    },
    onDriveReady,
    onDriveError: message => {
      connectButton.disabled = false;
      driveStatus.textContent = message;
    }
  });
  signInReady = true;
  showSignedOut(
    rememberBrowser.checked
      ? "Welcome back. Continue with Google."
      : "Sign in with your Google account."
  );
} catch (error) {
  signInReady = false;
  showSignedOut(error.message);
}
