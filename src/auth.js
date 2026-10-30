// Public browser OAuth client identifier. Never place a client secret here.
const CLIENT_ID = "789168568609-beodk1ohqkhtfm00h7pdbk4ee24u5dgn.apps.googleusercontent.com";
const IDENTITY_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

let loginClient = null;
let driveClient = null;
let identityToken = null;
let driveToken = null;
let identityExpiresAt = 0;
let driveExpiresAt = 0;
let signedInSubject = null;
let callbacks = null;

function loadGoogleLibrary() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => window.google?.accounts?.oauth2
      ? resolve()
      : reject(new Error("Google sign-in library is unavailable."));
    script.onerror = () => reject(new Error("Could not load Google sign-in. Check your connection."));
    document.head.append(script);
  });
}

async function getVerifiedAccount(accessToken) {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Google could not verify the selected account.");
  const account = await response.json();
  if (account.email_verified !== true || !account.email || !account.sub) {
    throw new Error("Google did not return a verified account.");
  }
  return account;
}

function tokenExpiry(response) {
  return Date.now() + Math.max(0, Number(response.expires_in || 0) - 60) * 1000;
}

function clearDriveToken() {
  driveToken = null;
  driveExpiresAt = 0;
}

async function receiveLoginToken(response) {
  if (response?.error || !response?.access_token) {
    callbacks.onError("Google sign-in was not completed.");
    return;
  }
  try {
    const account = await getVerifiedAccount(response.access_token);
    clearDriveToken();
    identityToken = response.access_token;
    identityExpiresAt = tokenExpiry(response);
    signedInSubject = account.sub;
    callbacks.onSignedIn(account.email);
  } catch (error) {
    identityToken = null;
    identityExpiresAt = 0;
    signedInSubject = null;
    clearDriveToken();
    callbacks.onError(error.message || "Google sign-in could not be verified.");
  }
}

async function receiveDriveToken(response) {
  if (response?.error || !response?.access_token) {
    callbacks.onDriveError("Drive permission was not granted.");
    return;
  }
  try {
    const granted = String(response.scope || "").split(/\s+/);
    if (!granted.includes(DRIVE_SCOPE)) {
      throw new Error("Google Drive permission was not granted.");
    }
    const account = await getVerifiedAccount(response.access_token);
    if (!signedInSubject || account.sub !== signedInSubject) {
      throw new Error("Please select the same Google account used to sign in.");
    }
    driveToken = response.access_token; // Stored only in memory, never on disk.
    driveExpiresAt = tokenExpiry(response);
    callbacks.onDriveReady();
  } catch (error) {
    clearDriveToken();
    callbacks.onDriveError(error.message || "Google Drive could not be connected.");
  }
}

export async function initialiseGoogleLogin(handlers) {
  callbacks = handlers;
  await loadGoogleLibrary();
  const oauth = window.google.accounts.oauth2;
  loginClient = oauth.initTokenClient({
    client_id: CLIENT_ID,
    scope: IDENTITY_SCOPE,
    callback: receiveLoginToken,
    error_callback: () => callbacks.onError("Google sign-in was cancelled or blocked.")
  });
  driveClient = oauth.initTokenClient({
    client_id: CLIENT_ID,
    scope: `${IDENTITY_SCOPE} ${DRIVE_SCOPE}`,
    callback: receiveDriveToken,
    error_callback: () => callbacks.onDriveError("Google Drive connection was cancelled or blocked.")
  });
}

export function signIn() {
  if (!loginClient) throw new Error("Google sign-in is not ready.");
  // Call from a direct user click to allow Google's popup.
  loginClient.requestAccessToken({ prompt: "select_account" });
}

export function connectDrive() {
  if (!driveClient || !signedInSubject) throw new Error("Sign in to Google first.");
  // Separate consent action: no Drive access is requested at initial login.
  driveClient.requestAccessToken({ prompt: "consent select_account" });
}

export function getDriveToken() {
  if (!signedInSubject || Date.now() >= identityExpiresAt) return null;
  return driveToken && Date.now() < driveExpiresAt ? driveToken : null;
}

export function signOut() {
  const tokens = new Set([identityToken, driveToken].filter(Boolean));
  identityToken = null;
  identityExpiresAt = 0;
  signedInSubject = null;
  clearDriveToken();
  for (const token of tokens) {
    window.google?.accounts?.oauth2?.revoke(token, () => {});
  }
}
