// Google Identity Services browser token flow.
// This public client identifier is not a password or client secret.
const CLIENT_ID = "789168568609-beodk1ohqkhtfm00h7pdbk4ee24u5dgn.apps.googleusercontent.com";
const IDENTITY_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const REQUESTED_SCOPES = `${IDENTITY_SCOPE} ${DRIVE_SCOPE}`;

// UI access gate only; Google Drive permissions are the real data security boundary.
const AUTHORISED_EMAIL_HASHES = new Set([
  "ea19d264f19a7bde231e60d34fd3628b920225ea7400d68c6c7f3ec6387db228"
]);

let loginClient = null;
let identityToken = null;
let driveToken = null;
let identityExpiresAt = 0;
let driveExpiresAt = 0;
let signedInSubject = null;
let callbacks = null;

async function isAuthorisedEmail(email) {
  const data = new TextEncoder().encode(String(email).trim().toLowerCase());
  const hash = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(hash)]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
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
    script.onerror = () =>
      reject(new Error("Could not load Google sign-in. Check your connection."));
    document.head.append(script);
  });
}

async function getVerifiedAccount(token) {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Google could not verify the selected account.");
  const account = await response.json();
  if (!account.email || account.email_verified !== true || !account.sub) {
    throw new Error("Google did not return a verified account.");
  }
  return account;
}

function tokenExpiry(response) {
  // Renew through a new user click before token expiration.
  return Date.now() + Math.max(0, Number(response.expires_in || 0) - 60) * 1000;
}

function clearTokens() {
  identityToken = null;
  driveToken = null;
  identityExpiresAt = 0;
  driveExpiresAt = 0;
  signedInSubject = null;
}

async function receiveLoginToken(response) {
  if (response?.error || !response?.access_token) {
    callbacks.onError("Google sign-in was not completed.");
    return;
  }

  try {
    const account = await getVerifiedAccount(response.access_token);
    if (!(await isAuthorisedEmail(account.email))) {
      clearTokens();
      callbacks.onUnauthorized(account.email);
      return;
    }

    clearTokens();
    signedInSubject = account.sub;
    identityToken = response.access_token;
    identityExpiresAt = tokenExpiry(response);
    callbacks.onSignedIn(account.email);

    // The same Google sign-in gesture requests both identity and Drive permission.
    // No separate Connect Google Drive button is needed for a granted session.
    const grantedScopes = String(response.scope || "").split(/\s+/);
    if (!grantedScopes.includes(DRIVE_SCOPE)) {
      callbacks.onDriveError(
        "Google Drive permission is missing. Sign out and sign in again to grant access."
      );
      return;
    }

    driveToken = response.access_token; // Temporary, memory-only token.
    driveExpiresAt = tokenExpiry(response);
    await callbacks.onDriveReady();
  } catch (error) {
    clearTokens();
    callbacks.onError(error.message || "Google sign-in could not be verified.");
  }
}

export async function initialiseGoogleLogin(handlers) {
  callbacks = handlers;
  await loadGoogleLibrary();
  loginClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: REQUESTED_SCOPES,
    callback: receiveLoginToken,
    error_callback: () =>
      callbacks.onError("Google sign-in was cancelled or blocked.")
  });
}

export function signIn({ fast = false } = {}) {
  if (!loginClient) throw new Error("Google sign-in is not ready.");
  // OAuth token requests must come from a real user gesture.
  // "fast" can skip repeated consent/account selection, but is not a persistent login.
  loginClient.requestAccessToken({ prompt: fast ? "" : "select_account" });
}

export function getDriveToken() {
  if (!identityToken || !signedInSubject || Date.now() >= identityExpiresAt) {
    return null;
  }
  return driveToken && Date.now() < driveExpiresAt ? driveToken : null;
}

export function signOut() {
  // Clear temporary tokens. The browser never stores a password or access token.
  clearTokens();
}
