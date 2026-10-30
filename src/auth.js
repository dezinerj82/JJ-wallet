// Google Identity Services OAuth token flow. No password or client secret here.
const CLIENT_ID = "789168568609-beodk1ohqkhtfm00h7pdbk4ee24u5dgn.apps.googleusercontent.com";
const IDENTITY_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

// Only an email fingerprint is in this public code; never put the plain email here.
// IMPORTANT: This is a UI allowlist, not a substitute for Google's Drive file permissions.
const AUTHORISED_EMAIL_HASHES = new Set([
  "ea19d264f19a7bde231e60d34fd3628b920225ea7400d68c6c7f3ec6387db228"
]);

let loginClient = null;
let driveClient = null;
let identityToken = null;
let driveToken = null;
let identityExpiresAt = 0;
let driveExpiresAt = 0;
let signedInSubject = null;
let callbacks = null;

async function isAuthorisedEmail(email) {
  const data = new TextEncoder().encode(String(email).trim().toLowerCase());
  const hash = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return AUTHORISED_EMAIL_HASHES.has(hex);
}

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

function clearLoginTokens() {
  identityToken = null;
  identityExpiresAt = 0;
  signedInSubject = null;
  clearDriveToken();
}

async function receiveLoginToken(response) {
  if (response?.error || !response?.access_token) {
    callbacks.onError("Google could not sign in automatically. Select your account to continue.");
    return;
  }
  try {
    const account = await getVerifiedAccount(response.access_token);
    if (!(await isAuthorisedEmail(account.email))) {
      clearLoginTokens();
      callbacks.onUnauthorized(account.email);
      return;
    }
    clearDriveToken();
    identityToken = response.access_token;
    identityExpiresAt = tokenExpiry(response);
    signedInSubject = account.sub;
    callbacks.onSignedIn(account.email);
  } catch (error) {
    clearLoginTokens();
    callbacks.onError(error.message || "Google sign-in could not be verified.");
  }
}

async function receiveDriveToken(response) {
  if (response?.error || !response?.access_token) {
    callbacks.onDriveError("Drive permission was not granted.");
    return;
  }
  try {
    if (!signedInSubject || !getIdentityToken()) {
      throw new Error("Please sign in again.");
    }
    const granted = String(response.scope || "").split(/\s+/);
    if (!granted.includes(DRIVE_SCOPE)) {
      throw new Error("Google Drive permission was not granted.");
    }
    const account = await getVerifiedAccount(response.access_token);
    if (account.sub !== signedInSubject || !(await isAuthorisedEmail(account.email))) {
      throw new Error("Please select your authorised Google account.");
    }
    driveToken = response.access_token; // In memory only, never browser storage.
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

export function signIn({ fast = false } = {}) {
  if (!loginClient) throw new Error("Google sign-in is not ready.");
  // OAuth tokens are requested ONLY from the user's click, as required by Google.
  // Fast mode avoids selecting the account when Google already has a grant/session.
  loginClient.requestAccessToken({ prompt: fast ? "" : "select_account" });
}

export function connectDrive() {
  if (!driveClient || !signedInSubject || !getIdentityToken()) {
    throw new Error("Sign in to your authorised Google account first.");
  }
  driveClient.requestAccessToken({ prompt: "select_account" });
}

export function getIdentityToken() {
  return identityToken && Date.now() < identityExpiresAt ? identityToken : null;
}

export function getDriveToken() {
  if (!signedInSubject || !getIdentityToken()) return null;
  return driveToken && Date.now() < driveExpiresAt ? driveToken : null;
}

export function signOut() {
  // Sign-out removes only in-memory tokens. DO NOT revoke Google's long-lived grant:
  // revoking it on every logout would force repeated consent and break fast login.
  clearLoginTokens();
}
