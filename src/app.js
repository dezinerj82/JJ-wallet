import { initialiseGoogleLogin, signIn, signOut, getDriveToken } from "./auth.js";
import { findBillsFolder, readWalletTextFiles, testTextStorage } from "./drive.js";
import {
  WALLET_GROUPS, parseWalletFiles, entriesForMonth,
  monthKey, shiftedMonthKey, formatMonth, formatAmount
} from "./records.js";

const TRUST_KEY = "home-wallet-remember-browser-v1";
const currentMonth = monthKey(new Date());
let selectedMonth = currentMonth;
let walletEntries = [];
let activeFolderId = null;
let connectionVersion = 0;
let selectingAccountRequired = false;
let attemptedFastLogin = false;
let signInReady = false;
const expandedGroups = new Map(WALLET_GROUPS.map(group => [group, true]));

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
const testTools = document.getElementById("storage-test-tools");

const walletView = document.getElementById("wallet-view");
const walletState = document.getElementById("wallet-state");
const walletTableWrap = document.getElementById("wallet-table-wrap");
const walletTableBody = document.getElementById("wallet-table-body");
const monthLabel = document.getElementById("month-label");
const prevButton = document.getElementById("month-prev-button");
const nextButton = document.getElementById("month-next-button");
const refreshButton = document.getElementById("refresh-wallet-button");

function readRememberedBrowser() {
  try { return localStorage.getItem(TRUST_KEY) === "yes"; }
  catch { return false; }
}

function setRememberedBrowser(remember) {
  // Preference only. Never store passwords, access tokens or wallet records.
  try {
    if (remember) localStorage.setItem(TRUST_KEY, "yes");
    else localStorage.removeItem(TRUST_KEY);
  } catch { /* Browser storage can be disabled. */ }
}

rememberBrowser.checked = readRememberedBrowser();

function refreshLoginButton() {
  const fast = rememberBrowser.checked && !selectingAccountRequired;
  loginButton.textContent = fast ? "Continue with Google" : "Sign in with Google";
  loginButton.disabled = !signInReady;
}

function resetWallet() {
  connectionVersion++;
  activeFolderId = null;
  walletEntries = [];
  walletView.hidden = true;
  walletTableWrap.hidden = true;
  testTools.hidden = true;
  testTools.open = false;
  testStorageButton.disabled = false;
  selectedMonth = currentMonth;
}

function showSignedOut(message = "Sign in with your Google account.") {
  resetWallet();
  signInActions.hidden = false;
  signedInView.hidden = true;
  unauthorizedView.hidden = true;
  signedInAccount.textContent = "";
  unauthorizedAccount.textContent = "";
  driveStatus.textContent = "Google Drive is not connected.";
  status.textContent = message;
  refreshLoginButton();
}

function showSignedIn(email) {
  resetWallet();
  setRememberedBrowser(rememberBrowser.checked);
  attemptedFastLogin = false;
  selectingAccountRequired = false;
  signInActions.hidden = true;
  unauthorizedView.hidden = true;
  signedInView.hidden = false;
  signedInAccount.textContent = "Signed in as " + email;
  status.textContent = "Google identity confirmed.";
  driveStatus.textContent = "Checking private Drive storage...";
}

function showUnauthorized(email) {
  signOut();
  resetWallet();
  attemptedFastLogin = false;
  selectingAccountRequired = true;
  rememberBrowser.checked = false;
  setRememberedBrowser(false);
  signInActions.hidden = true;
  signedInView.hidden = true;
  unauthorizedView.hidden = false;
  unauthorizedAccount.textContent = "Signed in as " + email;
  status.textContent = "Google identity confirmed.";
}

function addTextCell(row, text, className) {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  cell.textContent = text;
  row.append(cell);
  return cell;
}

function renderMonth() {
  const groups = entriesForMonth(walletEntries, selectedMonth);
  monthLabel.textContent = formatMonth(selectedMonth);
  prevButton.disabled = selectedMonth <= currentMonth;

  const rows = document.createDocumentFragment();
  for (const group of WALLET_GROUPS) {
    const entries = groups[group];
    const expanded = expandedGroups.get(group) !== false;

    const headingRow = document.createElement("tr");
    headingRow.className = "group-heading";
    const headingCell = document.createElement("th");
    headingCell.colSpan = 3;
    headingCell.scope = "rowgroup";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "group-toggle";
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("aria-label", (expanded ? "Collapse " : "Expand ") + group);
    button.textContent = (expanded ? "− " : "+ ") + group + " (" + entries.length + ")";
    button.addEventListener("click", () => {
      expandedGroups.set(group, !expanded);
      renderMonth();
    });

    headingCell.append(button);
    headingRow.append(headingCell);
    rows.append(headingRow);

    if (!expanded) continue;
    if (!entries.length) {
      const empty = document.createElement("tr");
      empty.className = "empty-row";
      const cell = document.createElement("td");
      cell.colSpan = 3;
      cell.textContent = group === "Saving"
        ? "No confirmed savings balance recorded."
        : "No entries recorded for this month.";
      empty.append(cell);
      rows.append(empty);
      continue;
    }

    for (const entry of entries) {
      const row = document.createElement("tr");
      addTextCell(row, entry.item, "wallet-item");
      const value = entry.group === "Saving" ? entry.balance : entry.amount;
      addTextCell(row, formatAmount(value), "wallet-amount");

      let description = "";
      if (entry.group === "Saving") {
        description = "Last recorded balance: " + formatMonth(entry.month);
      } else if (entry.group === "Bills" || entry.group === "Others") {
        description = "Paid: " + formatAmount(entry.paid) +
          " · Unpaid: " + formatAmount(entry.unpaid);
      } else {
        description = "Recorded income";
      }
      addTextCell(row, description, "wallet-detail");
      rows.append(row);
    }
  }
  walletTableBody.replaceChildren(rows);
}

async function loadWalletRecords() {
  if (!activeFolderId) return;
  const version = connectionVersion;
  const folderId = activeFolderId;
  walletView.hidden = false;
  walletTableWrap.hidden = true;
  refreshButton.disabled = true;
  walletState.textContent = "Reading wallet TXT files from your private Drive folder...";

  try {
    const files = await readWalletTextFiles(getDriveToken(), folderId);
    if (version !== connectionVersion || !getDriveToken()) return;
    const parsed = parseWalletFiles(files);
    walletEntries = parsed.entries;
    renderMonth();
    walletTableWrap.hidden = false;

    if (!files.length) {
      walletState.textContent =
        "No wallet item TXT files yet. Storage test files are excluded.";
    } else if (parsed.invalidLines) {
      walletState.textContent =
        "Some TXT rows could not be read (" + parsed.invalidLines +
        "). Only valid recorded entries are shown; review your files.";
    } else {
      walletState.textContent =
        "Wallet records loaded. Showing entries for the selected month.";
    }
  } catch (error) {
    if (version !== connectionVersion) return;
    walletEntries = [];
    walletTableWrap.hidden = true;
    walletState.textContent = error.message || "Could not read wallet records.";
  } finally {
    if (version === connectionVersion) refreshButton.disabled = false;
  }
}

async function onDriveReady() {
  const version = connectionVersion;
  try {
    const token = getDriveToken();
    if (!token) throw new Error("Drive session unavailable. Please sign out and sign in again.");

    const folder = await findBillsFolder(token);
    if (version !== connectionVersion || !getDriveToken()) return;
    if (!folder) {
      driveStatus.textContent =
        "Wallet bills folder not found. Check its Drive access. No new folder was created.";
      return;
    }
    activeFolderId = folder.id;
    testTools.hidden = false;
    driveStatus.textContent = folder.name === "Wallet bills"
      ? "Google Drive connected. Wallet bills folder found."
      : "Drive connected to existing folder: " + folder.name +
        ". Rename it to Wallet bills in Drive.";
    await loadWalletRecords();
  } catch (error) {
    if (version !== connectionVersion) return;
    walletView.hidden = true;
    testTools.hidden = true;
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
    signIn({ fast }); // Must be called directly from the user's click.
  } catch (error) {
    selectingAccountRequired = true;
    showSignedOut(error.message);
  }
});

prevButton.addEventListener("click", () => {
  if (selectedMonth > currentMonth) {
    selectedMonth = shiftedMonthKey(selectedMonth, -1);
    renderMonth();
  }
});

nextButton.addEventListener("click", () => {
  selectedMonth = shiftedMonthKey(selectedMonth, 1);
  renderMonth();
});

refreshButton.addEventListener("click", () => {
  if (activeFolderId) void loadWalletRecords();
});

testStorageButton.addEventListener("click", async () => {
  if (!activeFolderId || !getDriveToken()) {
    driveStatus.textContent = "Please sign in again to access Wallet bills.";
    return;
  }
  const version = connectionVersion;
  testStorageButton.disabled = true;
  driveStatus.textContent = "Testing TXT save and read...";
  try {
    const result = await testTextStorage(getDriveToken(), activeFolderId);
    if (version !== connectionVersion) return;
    driveStatus.textContent =
      "TXT storage confirmed: " + result.name + " was saved and read successfully.";
  } catch (error) {
    if (version === connectionVersion) {
      driveStatus.textContent = error.message || "TXT storage test failed.";
    }
  } finally {
    if (version === connectionVersion) testStorageButton.disabled = false;
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
      resetWallet();
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
