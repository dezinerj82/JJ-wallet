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


// Wallet Add: one app-owned TXT file per group/item, with append-only month rows.
// No savings balance is written here; savings need the End Payment workflow.
const ITEM_MARKER = "home-wallet-item";
const WRITE_LIMIT = 5 * 1024 * 1024;

function validateEntry(entry) {
  const group = String(entry?.group || "");
  if (!["IN", "Bills", "Others"].includes(group)) {
    throw new Error("This group is not available for new items yet.");
  }
  const item = String(entry?.item || "").trim();
  if (!item || item.length > 120 || /[\t\r\n\x00-\x1f]/.test(item)) {
    throw new Error("Enter a valid item name (up to 120 characters).");
  }
  const month = String(entry?.month || "");
  if (!/^(?:19|20|21)\d{2}(?:0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("Choose a valid payment month.");
  }
  const now = new Date();
  const earliest = String(now.getFullYear()) + String(now.getMonth() + 1).padStart(2, "0");
  if (month < earliest) throw new Error("Previous months cannot be edited.");

  const rawAmount = String(entry?.amount ?? "").trim();
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(rawAmount)) {
    throw new Error("Enter a valid amount using up to two decimal places.");
  }
  const amount = Number(rawAmount);
  if (!Number.isSafeInteger(Math.round(amount * 100))) {
    throw new Error("The entered amount is too large.");
  }

  const optional = {};
  for (const field of ["retail", "url", "remark"]) {
    const max = field === "url" ? 300 : field === "retail" ? 120 : 300;
    const value = String(entry?.[field] || "").trim();
    if (value.length > max || /[\t\r\n\x00-\x1f]/.test(value)) {
      throw new Error("Please use a single line for " + field + ".");
    }
    optional[field] = value;
  }
  if (optional.url) {
    let url;
    try { url = new URL(optional.url); }
    catch { throw new Error("Enter a valid website link, starting with https://"); }
    if (!["https:", "http:"].includes(url.protocol)) {
      throw new Error("Only http or https links are supported.");
    }
  }

  const fields = [group, item, month, amount.toFixed(2)];
  if (group !== "IN") fields.push("0.00", amount.toFixed(2));
  if (group === "Others") {
    fields.push(optional.retail, optional.url, optional.remark);
  } else if (optional.remark) {
    // Keep legacy 4-field IN and 6-field Bills entries unchanged when no
    // remark was supplied; append optional remarks only when actually present.
    fields.push(optional.remark);
  }
  return { group, item, month, line: fields.join("\t") + "\n" };
}

async function listWalletFileMetadata(token, folderId) {
  const results = [];
  let pageToken = "";
  do {
    const url = new URL(API);
    url.searchParams.set("q", "'" + folderId + "' in parents and trashed = false");
    url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,appProperties,size)");
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await driveFetch(url, token);
    results.push(...(page.files || []));
    if (results.length > 500) {
      throw new Error("Too many files in Wallet bills. Review the folder first.");
    }
    pageToken = page.nextPageToken || "";
  } while (pageToken);
  return results.filter(file =>
    file.name?.toLowerCase().endsWith(".txt") &&
    file.name.toLowerCase() !== TEST_FILE_NAME
  );
}

async function itemFileName(group, item) {
  const key = group + "\u0000" + item.toLocaleLowerCase("en");
  const bytes = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const suffix = Array.from(new Uint8Array(digest)).slice(0, 10)
    .map(b => b.toString(16).padStart(2, "0")).join("");
  const shortName = item.normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "").slice(0, 35) || "item";
  return group + "-" + shortName + "-" + suffix + ".txt";
}

function fileHasItem(content, group, item) {
  const itemKey = item.toLocaleLowerCase("en");
  return content.split("\n").some(line => {
    const fields = line.replace(/\r$/, "").split("\t");
    return fields[0] === group && String(fields[1] || "").toLocaleLowerCase("en") === itemKey;
  });
}

function monthIsPresent(content, group, item, month) {
  // A deleted month may be added again; earlier snapshots remain in history.
  const last = lastMonthSnapshot(content, group, item, month);
  return !!last && !(last.length === 4 && last[3] === "DELETE");
}

async function createWalletTextFile(token, folderId, filename, line) {
  const boundary = "home-wallet-" + crypto.randomUUID().replace(/-/g, "");
  const metadata = {
    name: filename, mimeType: "text/plain", parents: [folderId],
    appProperties: { purpose: ITEM_MARKER }
  };
  const payload = new Blob([
    "--" + boundary + "\r\n",
    "Content-Type: application/json; charset=UTF-8\r\n\r\n",
    JSON.stringify(metadata),
    "\r\n--" + boundary + "\r\n",
    "Content-Type: text/plain; charset=UTF-8\r\n\r\n",
    line,
    "\r\n--" + boundary + "--\r\n"
  ], { type: "multipart/related; boundary=" + boundary });
  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,parents,appProperties",
    { method: "POST", headers: { Authorization: "Bearer " + token }, body: payload }
  );
  if (!response.ok) {
    throw new Error("Couldn’t save your item (" + response.status + ").");
  }
  const file = await response.json();
  if (!file.id || file.name !== filename ||
      !file.parents?.includes(folderId) || file.appProperties?.purpose !== ITEM_MARKER) {
    throw new Error("Google Drive did not confirm the new item file.");
  }
  return file;
}

async function replaceWalletText(token, fileId, text) {
  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files/" +
    encodeURIComponent(fileId) + "?uploadType=media&fields=id",
    {
      method: "PATCH",
      headers: { Authorization: "Bearer " + token,
                 "Content-Type": "text/plain; charset=UTF-8" },
      body: text
    }
  );
  if (!response.ok) {
    throw new Error("Couldn’t save your item (" + response.status + ").");
  }
  const result = await response.json();
  if (result.id !== fileId) {
    throw new Error("Drive did not confirm the saved item.");
  }
}

export async function addWalletItem(token, folderId, entry) {
  if (!token || !folderId) {
    throw new Error("Google Drive is not connected. Sign in again.");
  }
  const item = validateEntry(entry);
  const filename = await itemFileName(item.group, item.item);
  const files = await listWalletFileMetadata(token, folderId);

  const matching = [];
  for (const file of files) {
    if (Number(file.size || 0) > WRITE_LIMIT) {
      throw new Error("A TXT file exceeds the safe storage limit. Review it first.");
    }
    const content = await getFileText(token, file.id);
    if (new Blob([content]).size > WRITE_LIMIT) {
      throw new Error("A TXT file exceeds the safe storage limit. Review it first.");
    }
    if (file.name === filename || fileHasItem(content, item.group, item.item)) {
      matching.push({ file, content });
    }
  }
  if (matching.length > 1) {
    throw new Error("Duplicate item files were found. Review them before saving.");
  }

  let fileId;
  let expected;
  if (matching.length) {
    const existing = matching[0];
    if (existing.file.appProperties?.purpose !== ITEM_MARKER ||
        !fileHasItem(existing.content, item.group, item.item)) {
      throw new Error("An existing TXT file conflicts with this item. No changes were saved.");
    }
    if (monthIsPresent(existing.content, item.group, item.item, item.month)) {
      throw new Error("This item is already listed for that month. Use Update to change it.");
    }
    expected = existing.content +
      (existing.content && !existing.content.endsWith("\n") ? "\n" : "") +
      item.line;
    if (new Blob([expected]).size > WRITE_LIMIT) {
      throw new Error("This item’s saved history is full. No changes were made.");
    }
    await replaceWalletText(token, existing.file.id, expected);
    fileId = existing.file.id;
  } else {
    const created = await createWalletTextFile(token, folderId, filename, item.line);
    fileId = created.id;
    expected = item.line;
  }

  // Verify full file text before reporting success. Never write any financial data to GitHub.
  const confirmed = await getFileText(token, fileId);
  if (confirmed !== expected) {
    throw new Error("Your item might not have saved correctly. Check Google Drive before retrying.");
  }
  return { group: item.group, item: item.item, month: item.month };
}


// Updates append a complete replacement snapshot for the same item/month.
// Historical lines are never edited or removed. The existing paid amount is
// preserved and the unpaid amount is recalculated from the revised bill amount.
function lastMonthSnapshot(content, group, item, month) {
  const itemKey = item.toLocaleLowerCase("en");
  let snapshot = null;
  for (const line of content.split("\n")) {
    const fields = line.replace(/\r$/, "").split("\t");
    if (fields[0] === group &&
        String(fields[1] || "").toLocaleLowerCase("en") === itemKey &&
        fields[2] === month) {
      snapshot = fields;
    }
  }
  return snapshot;
}

function matchesDisplayedSnapshot(fields, previous) {
  if (!fields || !previous || fields[0] !== previous.group ||
      fields[1] !== previous.item || fields[2] !== previous.month ||
      Number(fields[3]) !== previous.amount) {
    return false;
  }
  if (previous.group !== "IN") {
    if (!Number.isFinite(previous.paid) || !Number.isFinite(previous.unpaid) ||
        Number(fields[4]) !== previous.paid ||
        Number(fields[5]) !== previous.unpaid) {
      return false;
    }
  }
  if (previous.group === "Others") {
    return (fields[6] || "") === (previous.retail || "") &&
      (fields[7] || "") === (previous.url || "") &&
      (fields[8] || "") === (previous.remark || "");
  }
  // Verify the last saved remark too, so stale changes cannot silently win.
  const remarkIndex = previous.group === "IN" ? 4 : 6;
  return (fields[remarkIndex] || "") === (previous.remark || "");
}

export async function updateWalletItem(token, folderId, changes) {
  if (!token || !folderId) {
    throw new Error("Google Drive session expired. Sign in again.");
  }
  const item = validateEntry(changes);
  const prior = changes?.previous;
  if (!prior || prior.group !== item.group || prior.item !== item.item ||
      prior.month !== item.month) {
    throw new Error("Item identity and payment month cannot be changed during an update.");
  }

  const filename = await itemFileName(item.group, item.item);
  const files = await listWalletFileMetadata(token, folderId);
  const matches = [];
  for (const file of files) {
    if (Number(file.size || 0) > WRITE_LIMIT) {
      throw new Error("This item’s saved history is too large to update right now.");
    }
    const content = await getFileText(token, file.id);
    if (new Blob([content]).size > WRITE_LIMIT) {
      throw new Error("This item’s saved history is too large to update right now.");
    }
    if (file.name === filename || fileHasItem(content, item.group, item.item)) {
      matches.push({ file, content });
    }
  }

  if (matches.length !== 1) {
    throw new Error("Couldn’t find this item. Please refresh and try again.");
  }
  const existing = matches[0];
  if (existing.file.appProperties?.purpose !== ITEM_MARKER ||
      !fileHasItem(existing.content, item.group, item.item)) {
    throw new Error("This item can’t be updated here yet. No changes were saved.");
  }

  const last = lastMonthSnapshot(existing.content, item.group, item.item, item.month);
  if (!matchesDisplayedSnapshot(last, prior)) {
    throw new Error("The item changed since it was loaded. Refresh and try again.");
  }

  const revised = item.line.slice(0, -1).split("\t");
  if (item.group !== "IN") {
    const previouslyPaid = Number(last[4]);
    const newAmount = Number(revised[3]);
    if (!Number.isFinite(previouslyPaid) || previouslyPaid < 0 ||
        previouslyPaid > newAmount) {
      throw new Error("New amount cannot be smaller than the already paid amount.");
    }
    revised[4] = previouslyPaid.toFixed(2);
    revised[5] = (Math.round((newAmount - previouslyPaid) * 100) / 100).toFixed(2);
  }

  if (last.join("\t") === revised.join("\t")) {
    throw new Error("No changes to save.");
  }
  const log = existing.content +
    (existing.content && !existing.content.endsWith("\n") ? "\n" : "") +
    revised.join("\t") + "\n";
  if (new Blob([log]).size > WRITE_LIMIT) {
    throw new Error("This item’s saved history is full. No changes were made.");
  }

  await replaceWalletText(token, existing.file.id, log);
  const confirmed = await getFileText(token, existing.file.id);
  if (confirmed !== log) {
    throw new Error("Your update might not have saved correctly. Check Google Drive before retrying.");
  }
  return { group: item.group, item: item.item, month: item.month };
}


// Delete only the selected open month. Do not remove the file or any historical
// snapshots: append one unambiguous tombstone record instead.
// Already-paid obligations cannot be erased by a Delete action.
export async function deleteWalletItem(token, folderId, previous) {
  if (!token || !folderId) {
    throw new Error("Your session has expired. Please sign in again.");
  }
  const group = previous?.group;
  const item = previous?.item;
  const month = previous?.month;
  if (!["IN", "Bills", "Others"].includes(group) ||
      typeof item !== "string" || !item || item.length > 180 ||
      /[\t\r\n\x00-\x1f]/.test(item) ||
      !/^(?:19|20|21)\d{2}(?:0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("This item cannot be deleted here.");
  }
  const now = new Date();
  const current = String(now.getFullYear()) + String(now.getMonth() + 1).padStart(2, "0");
  if (month < current) {
    throw new Error("Past months are locked. Nothing was deleted.");
  }
  if (group !== "IN" &&
      (!Number.isFinite(previous.paid) || !Number.isFinite(previous.unpaid))) {
    throw new Error("Could not verify the payment status. Refresh before deleting.");
  }
  if (group !== "IN" && previous.paid > 0) {
    throw new Error("This item has a payment recorded. It cannot be deleted.");
  }

  const filename = await itemFileName(group, item);
  const files = await listWalletFileMetadata(token, folderId);
  const matches = [];
  for (const file of files) {
    if (Number(file.size || 0) > WRITE_LIMIT) {
      throw new Error("Saved history is too large to delete this item safely.");
    }
    const content = await getFileText(token, file.id);
    if (new Blob([content]).size > WRITE_LIMIT) {
      throw new Error("Saved history is too large to delete this item safely.");
    }
    if (file.name === filename || fileHasItem(content, group, item)) {
      matches.push({ file, content });
    }
  }

  if (matches.length !== 1) {
    throw new Error("Couldn't find this item. Please refresh and try again.");
  }
  const existing = matches[0];
  if (existing.file.appProperties?.purpose !== ITEM_MARKER ||
      !fileHasItem(existing.content, group, item)) {
    throw new Error("This record can't be deleted here. Nothing was changed.");
  }
  const last = lastMonthSnapshot(existing.content, group, item, month);
  if (!matchesDisplayedSnapshot(last, previous)) {
    throw new Error("This item has changed. Refresh before trying again.");
  }
  // A defensive second check: trust the last saved payment, not only the UI.
  if (group !== "IN" && (!Number.isFinite(Number(last[4])) ||
      Number(last[4]) > 0 || Number(last[4]) < 0)) {
    throw new Error("This item has a payment recorded and cannot be deleted.");
  }

  const marker = [group, item, month, "DELETE"].join("\t") + "\n";
  const expected = existing.content +
    (existing.content && !existing.content.endsWith("\n") ? "\n" : "") +
    marker;
  if (new Blob([expected]).size > WRITE_LIMIT) {
    throw new Error("The item history is full. Nothing was deleted.");
  }

  await replaceWalletText(token, existing.file.id, expected);
  const confirmed = await getFileText(token, existing.file.id);
  if (confirmed !== expected) {
    throw new Error("Couldn't verify this deletion. Check Drive before retrying.");
  }
  return { group, item, month };
}
