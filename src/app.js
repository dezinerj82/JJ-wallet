import { initialiseGoogleLogin, signIn, signOut, getDriveToken } from "./auth.js";
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
  // This stores a convenience preference only, never proof of authentication.
  try {
    if (remember) localStorage.setItem(TRUST_KEY, "yes");
    else localStorage.removeItem(TRUST_KEY);
  } catch { /* Private browsing may block preference storage. */ }
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
  driveStatus.textContent = "Checking private Drive storage...";
  testStorageButton.hidden = true;
}

function showUnauthorized(email) {
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
  testStorageButton.hidden = true;
}

async function onDriveReady() {
  try {
    const token = getDriveToken();
    if (!token) throw new Error("Drive session unavailable. Please sign out and sign in again.");
    const folder = await findBillsFolder(token);
    if (!getDriveToken()) throw new Error("Drive session expired. Please sign out and sign in again.");
    if (!folder) {
      activeFolderId = null;
      testStorageButton.hidden = true;
      driveStatus.textContent =
        "Wallet bills folder not found. Check its name and Drive access. No folder was created.";
      return;
    }
    activeFolderId = folder.id;
    testStorageButton.hidden = false;
    driveStatus.textContent = folder.name === "Wallet bills"
      ? "Google Drive connected. Wallet bills folder found."
      : "Drive connected to existing folder: " + folder.name +
        ". Rename it to Wallet bills in Drive.";
  } catch (error) {
    activeFolderId = null;
    testStorageButton.hidden = true;
    driveStatus.textContent = error.message || "Google Drive could not be checked.";
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
    // The OAuth popup is requested synchronously from this click.
    signIn({ fast });
  } catch (error) {
    selectingAccountRequired = true;
    showSignedOut(error.message);
  }
});

testStorageButton.addEventListener("click", async () => {
  if (!activeFolderId) {
    driveStatus.textContent = "Sign in to access the Wallet bills folder first.";
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
      activeFolderId = null;
      testStorageButton.hidden = true;
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
