// Private Drive storage. Uses only the user's temporary drive.file OAuth token.
// This stage creates/checks an app-owned empty folder; no financial files are written.
const API = "https://www.googleapis.com/drive/v3/files";
const FOLDER_NAME = "bills";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const APP_MARKER = "home-wallet-records";

async function driveFetch(url, token, options = {}) {
  if (!token) throw new Error("Google Drive session expired. Connect again.");
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, {
    ...options,
    headers,
    cache: "no-store"
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Google Drive session expired. Connect again.");
    if (response.status === 403) {
      throw new Error("Google Drive denied access. Check the app's Drive permission.");
    }
    throw new Error(`Google Drive returned an error (${response.status}). Try again.`);
  }
  return response.json();
}

export async function findBillsFolder(token) {
  const q = `name = '${FOLDER_NAME}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const folders = [];
  let pageToken = "";
  do {
    const url = new URL(API);
    url.searchParams.set("q", q);
    url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,appProperties)");
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("spaces", "drive");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const result = await driveFetch(url, token);
    folders.push(...(result.files || []));
    pageToken = result.nextPageToken || "";
  } while (pageToken);
  // drive.file only lists files the application is authorised to use.
  return folders.find(folder => folder.appProperties?.purpose === APP_MARKER) ||
    folders[0] || null;
}

export async function createBillsFolder(token) {
  // First recheck: retrying after a network failure should not create duplicates.
  const existing = await findBillsFolder(token);
  if (existing) return existing;

  const folder = await driveFetch(`${API}?fields=id,name,mimeType,appProperties`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: FOLDER_MIME,
      appProperties: { purpose: APP_MARKER }
    })
  });
  if (!folder.id || folder.name !== FOLDER_NAME || folder.mimeType !== FOLDER_MIME) {
    throw new Error("Drive did not confirm creation of the storage folder.");
  }
  // Confirm it exists and can be read before reporting success.
  const confirmed = await driveFetch(`${API}/${encodeURIComponent(folder.id)}?fields=id,name,mimeType`, token);
  if (confirmed.id !== folder.id || confirmed.name !== FOLDER_NAME) {
    throw new Error("Drive could not verify the storage folder. Try checking again.");
  }
  return confirmed;
}
