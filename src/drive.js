// Private Drive storage. Uses only the user's temporary drive.file OAuth token.
// This stage creates/checks an app-owned empty folder; no financial files are written.
const API = "https://www.googleapis.com/drive/v3/files";
const FOLDER_NAME = "Bills";
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


// TEST ONLY. Keeps all test text inside the private Bills folder.
// Appends lines by re-uploading the entire text file with its earlier contents intact.
const TEST_FILE_NAME = "storage-check.txt";
const TEST_MARKER = "wallet-storage-test";

async function getFileText(token, fileId) {
  if (!token) throw new Error("Google Drive session expired. Connect again.");
  const response = await fetch(API + "/" + encodeURIComponent(fileId) + "?alt=media", {
    headers: { Authorization: "Bearer " + token },
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error("Google Drive could not read the test TXT file (" + response.status + ").");
  }
  return response.text();
}

async function findTestFile(token, folderId) {
  const url = new URL(API);
  url.searchParams.set("q",
    "'" + folderId + "' in parents and name = '" + TEST_FILE_NAME + "' and trashed = false");
  url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,appProperties,parents)");
  url.searchParams.set("pageSize", "100");
  const matches = [];
  let page = "";
  do {
    if (page) url.searchParams.set("pageToken", page);
    const result = await driveFetch(url, token);
    matches.push(...(result.files || []));
    page = result.nextPageToken || "";
  } while (page);
  const own = matches.filter(file => file.appProperties?.purpose === TEST_MARKER);
  if (own.length > 1) throw new Error("Multiple test files exist. Review them before testing.");
  return own[0] || null;
}

async function createTestFile(token, folderId) {
  const boundary = "wallet-test-" + Date.now().toString(36);
  const metadata = {
    name: TEST_FILE_NAME,
    mimeType: "text/plain",
    parents: [folderId],
    appProperties: { purpose: TEST_MARKER }
  };
  const text = "TXT storage check\n";
  const payload = new Blob([
    "--" + boundary + "\r\n",
    "Content-Type: application/json; charset=UTF-8\r\n\r\n",
    JSON.stringify(metadata),
    "\r\n--" + boundary + "\r\n",
    "Content-Type: text/plain; charset=UTF-8\r\n\r\n",
    text,
    "\r\n--" + boundary + "--\r\n"
  ], { type: "multipart/related; boundary=" + boundary });
  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,parents,appProperties",
    {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: payload
    }
  );
  if (!response.ok) {
    throw new Error("Google Drive could not create a TXT test file (" + response.status + ").");
  }
  const created = await response.json();
  if (!created.id || created.name !== TEST_FILE_NAME ||
      !created.parents?.includes(folderId) ||
      created.appProperties?.purpose !== TEST_MARKER) {
    throw new Error("Google Drive did not confirm the correct test file.");
  }
  return created;
}

async function updateTestFile(token, fileId, text) {
  if (!token) throw new Error("Google Drive session expired. Connect again.");
  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files/" +
      encodeURIComponent(fileId) + "?uploadType=media&fields=id",
    {
      method: "PATCH",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "text/plain; charset=UTF-8"
      },
      body: text
    }
  );
  if (!response.ok) {
    throw new Error("Google Drive could not update the TXT test file (" + response.status + ").");
  }
  const result = await response.json();
  if (result.id !== fileId) throw new Error("Google Drive did not confirm the updated file.");
}

export async function testTextStorage(token, folderId) {
  if (!token || !folderId) throw new Error("Connect to the private Bills folder first.");
  // Preserve any existing test text; never touch financial records.
  let file = await findTestFile(token, folderId);
  if (!file) {
    file = await createTestFile(token, folderId);
  }
  const previous = await getFileText(token, file.id);
  if (new Blob([previous]).size > 1024 * 1024) {
    throw new Error("Test TXT file unexpectedly large. Review it before modifying.");
  }
  const newText = previous + (previous && !previous.endsWith("\n") ? "\n" : "") +
    "Append/read check passed\n";
  await updateTestFile(token, file.id, newText);
  const confirmed = await getFileText(token, file.id);
  if (confirmed !== newText) {
    throw new Error("Google Drive saved content did not match the data read back.");
  }
  return { name: file.name, verified: true };
}
