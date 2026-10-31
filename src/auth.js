// Google Identity Services browser OAuth. Never put a client secret or private data here.
const CLIENT_ID = "789168568609-beodk1ohqkhtfm00h7pdbk4ee24u5dgn.apps.googleusercontent.com";
const IDENTITY_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const REQUESTED_SCOPES = IDENTITY_SCOPE + " " + DRIVE_SCOPE;
const SESSION_KEY = "home-wallet-current-tab-token-v1";

// UI access gate only: the private Drive account's permissions protect financial files.
const AUTHORISED_EMAIL_HASHES = new Set([
  "ea19d264f19a7bde231e60d34fd3628b920225ea7400d68c6c7f3ec6387db228"
]);

let tokenClient = null;
let accessToken = null;
let expiresAt = 0;
let signedInSubject = null;
let handlers = null;
let requestedEmail = "";

async function isAuthorisedEmail(email) {
  const data = new TextEncoder().encode(String(email).trim().toLowerCase());
  const hash = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(hash)]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  return AUTHORISED_EMAIL_HASHES.has(hex);
}

function clearStoredSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* Storage may be unavailable. */ }
}

function clearTokens() {
  accessToken = null;
  expiresAt = 0;
  signedInSubject = null;
}

function saveShortSession() {
  clearStoredSession();
  if (!handlers?.shouldRememberSession?.() || !getDriveToken()) return;
  // A short-lived same-tab token is the only credential persisted, with explicit opt-in.
  // It disappears when the tab closes, expires, or the user signs out.
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      token: accessToken, expiresAt, subject: signedInSubject, scope: REQUESTED_SCOPES
    }));
  } catch { /* The user can still sign in normally. */ }
}

async function getVerifiedAccount(token) {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: "Bearer " + token },
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Google could not verify the current session.");
  const account = await response.json();
  if (!account.email || account.email_verified !== true || !account.sub) {
    throw new Error("Google did not return a verified account.");
  }
  return account;
}

function expiryTime(result) {
  // Expire at least one minute early and never retain a token without a finite TTL.
  const seconds = Number(result.expires_in);
  if (!Number.isFinite(seconds) || seconds <= 60) return 0;
  return Date.now() + (seconds - 60) * 1000;
}

async function receiveLoginToken(response) {
  if (response?.error || !response?.access_token) {
    handlers.onError("Google sign-in was not completed.");
    return;
  }
  try {
    const account = await getVerifiedAccount(response.access_token);
    if (account.email.trim().toLowerCase() !== requestedEmail ||
        !(await isAuthorisedEmail(account.email))) {
      clearTokens();
      clearStoredSession();
      handlers.onUnauthorized(account.email);
      return;
    }

    const scopes = String(response.scope || "").split(/\s+/);
    if (!scopes.includes(DRIVE_SCOPE) || !scopes.includes(IDENTITY_SCOPE)) {
      throw new Error("Google Drive permission was not granted. Please sign in again.");
    }
    const expiry = expiryTime(response);
    if (!expiry) throw new Error("Google did not return a usable session lifetime.");

    clearTokens();
    accessToken = response.access_token;
    expiresAt = expiry;
    signedInSubject = account.sub;
    saveShortSession();

    handlers.onSignedIn(account.email);
    await handlers.onDriveReady();
  } catch (error) {
    clearTokens();
    clearStoredSession();
    handlers.onError(error.message || "Google sign-in could not be verified.");
  }
}

function loadGoogleLibrary() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => window.google?.accounts?.oauth2
      ? resolve() : reject(new Error("Google sign-in library is unavailable."));
    script.onerror = () =>
      reject(new Error("Could not load Google sign-in. Check your connection."));
    document.head.append(script);
  });
}

// Restore only a currently valid SAME-TAB token. Verify the actual Google account
// and Drive permission again; a local "remember me" flag never grants access.
export async function restoreLoginSession() {
  clearTokens();
  if (!handlers?.shouldRememberSession?.()) {
    clearStoredSession();
    return false;
  }

  let saved;
  try { saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); }
  catch { clearStoredSession(); return false; }
  if (!saved || typeof saved.token !== "string" || saved.token.length > 4096 ||
      !Number.isFinite(saved.expiresAt) || saved.expiresAt <= Date.now() ||
      saved.expiresAt > Date.now() + 2 * 60 * 60 * 1000 ||
      !saved.subject || typeof saved.subject !== "string" ||
      !String(saved.scope).split(/\s+/).includes(DRIVE_SCOPE)) {
    clearStoredSession();
    return false;
  }

  try {
    const account = await getVerifiedAccount(saved.token);
    if (account.sub !== saved.subject || !(await isAuthorisedEmail(account.email))) {
      clearStoredSession();
      handlers.onUnauthorized(account.email);
      return true;
    }
    accessToken = saved.token;
    expiresAt = saved.expiresAt;
    signedInSubject = account.sub;
    handlers.onSignedIn(account.email);
    await handlers.onDriveReady();
    return true;
  } catch {
    clearTokens();
    clearStoredSession();
    return false;
  }
}

export async function initialiseGoogleLogin(callbacks) {
  handlers = callbacks;
  await loadGoogleLibrary();
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: REQUESTED_SCOPES,
    callback: receiveLoginToken,
    error_callback: () => handlers.onError("Google sign-in was cancelled or blocked.")
  });
}

export function signIn({ email, fast = false } = {}) {
  if (!tokenClient) throw new Error("Google sign-in is not ready.");
  requestedEmail = String(email || "").trim().toLowerCase();
  if (!requestedEmail) throw new Error("Enter your email.");
  tokenClient.requestAccessToken({
    prompt: fast ? "" : "select_account",
    login_hint: requestedEmail
  });
}

export function getDriveToken() {
  return signedInSubject && accessToken && Date.now() < expiresAt ? accessToken : null;
}

export function signOut() {
  clearTokens();
  clearStoredSession();
}
