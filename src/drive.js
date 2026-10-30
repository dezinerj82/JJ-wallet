// Private Drive storage. Uses only the user's temporary drive.file OAuth token.
// Recognize the original app-created Wallet bills folder by its marker after moves within Drive.
// Do not create another folder if it is temporarily invisible after a move.
const API = "https://www.googleapis.com/drive/v3/files";
const FOLDER_NAME = "Wallet bills";
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
  // Match the app-owned folder by its stable marker, not a changeable name or parent.
  const q = `mimeType = '${FOLDER_MIME}' and trashed = false and appProperties has { key='purpose' and value='${APP_MARKER}' }`;
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
  // drive.file only lists files the app may access. Never guess from the name.
  const owned = folders.filter(folder => folder.appProperties?.purpose === APP_MARKER);
  if (owned.length > 1) throw new Error("Multiple wallet storage folders found. Review them before continuing.");
  return owned[0] || null;
}


// TEST ONLY. Keeps all test text inside the private Wallet bills folder.
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
  if (!token || !folderId) throw new Error("Connect to the private Wallet bills folder first.");
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


// Read-only wallet TXT loading. The separate storage-check.txt file is ignored.
// Storage writes for real wallet items are not enabled in this stage.
export async function readWalletTextFiles(token, folderId) {
  if (!token || !folderId) throw new Error("Sign in and connect Wallet bills first.");

  const q = "'" + folderId + "' in parents and trashed = false";
  const files = [];
  let pageToken = "";
  do {
    const url = new URL(API);
    url.searchParams.set("q", q);
    url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size)");
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await driveFetch(url, token);
    files.push(...(page.files || []));
    if (files.length > 500) {
      throw new Error("Too many files in Wallet bills. Review the folder before loading.");
    }
    pageToken = page.nextPageToken || "";
  } while (pageToken);

  const walletFiles = files.filter(file =>
    file.name?.toLowerCase().endsWith(".txt") &&
    file.name.toLowerCase() !== TEST_FILE_NAME
  ).sort((a, b) => a.name.localeCompare(b.name, "en"));

  const contents = [];
  for (const file of walletFiles) {
    // The segmenting limit is not implemented yet; never silently truncate.
    if (Number(file.size || 0) > 5 * 1024 * 1024) {
      throw new Error("A wallet TXT file exceeds the read limit: " + file.name);
    }
    const content = await getFileText(token, file.id);
    if (new Blob([content]).size > 5 * 1024 * 1024) {
      throw new Error("A wallet TXT file exceeds the read limit: " + file.name);
    }
    contents.push({ name: file.name, content });
  }

  return contents;
}
