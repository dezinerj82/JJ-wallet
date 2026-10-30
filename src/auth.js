// Public Google OAuth client ID: safe to include in a browser application.
// Never add a client secret, password, access token or financial record here.
const CLIENT_ID = "789168568609-beodk1ohqkhtfm00h7pdbk4ee24u5dgn.apps.googleusercontent.com";

// Only request basic identity for this first login test.
// Google Drive file access will be requested separately when implemented.
const IDENTITY_SCOPE = "https://www.googleapis.com/auth/userinfo.email";

let tokenClient;
let accessToken = null;
let expiresAt = 0;
let handlers;

function loadGoogleLibrary() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      if (window.google?.accounts?.oauth2) resolve();
      else reject(new Error("Google sign-in library is unavailable."));
    };
    script.onerror = () => reject(new Error("Could not load Google sign-in. Check your connection."));
    document.head.append(script);
  });
}

async function receiveToken(response) {
  if (response?.error || !response?.access_token) {
    handlers.onError("Google sign-in was not completed.");
    return;
  }

  const candidate = response.access_token;
  try {
    const reply = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${candidate}` },
      cache: "no-store"
    });
    if (!reply.ok) throw new Error("Google could not confirm your account.");

    const account = await reply.json();
    if (!account.email || account.email_verified !== true) {
      throw new Error("Google did not return a verified email address.");
    }

    accessToken = candidate; // memory only, never localStorage or cookies
    expiresAt = Date.now() + Math.max(0, Number(response.expires_in || 0) - 60) * 1000;
    handlers.onSignedIn(account.email);
  } catch (error) {
    accessToken = null;
    expiresAt = 0;
    handlers.onError(error instanceof Error ? error.message : "Sign-in could not be verified.");
  }
}

export async function initialiseGoogleLogin(callbacks) {
  handlers = callbacks;
  await loadGoogleLibrary();
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: IDENTITY_SCOPE,
    callback: receiveToken,
    error_callback: error => {
      if (error.type !== "popup_closed") {
        handlers.onError("Google sign-in popup could not open. Check browser pop-up settings.");
      }
    }
  });
}

export function signIn() {
  if (!tokenClient) throw new Error("Google sign-in is not ready.");
  // Must run immediately from the user's click, so browsers allow Google's popup.
  tokenClient.requestAccessToken({ prompt: "select_account" });
}

export function signOut() {
  const oldToken = accessToken;
  accessToken = null;
  expiresAt = 0;
  if (oldToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(oldToken, () => {});
  }
}

export function getIdentityToken() {
  return accessToken && Date.now() < expiresAt ? accessToken : null;
}
