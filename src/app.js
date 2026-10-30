import { initialiseGoogleLogin, signIn, signOut, getDriveToken } from "./auth.js";
import { findBillsFolder, readWalletTextFiles } from "./drive.js";
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

const loginView = document.getElementById("login-view");
const status = document.getElementById("setup-status");
const signInActions = document.getElementById("sign-in-actions");
const loginButton = document.getElementById("login-button");
const rememberBrowser = document.getElementById("remember-browser");
const unauthorizedView = document.getElementById("unauthorized-view");
const unauthorizedAccount = document.getElementById("unauthorized-account");
const unauthorizedLogoutButton = document.getElementById("unauthorized-logout-button");
const logoutButton = document.getElementById("logout-button");

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
  // Convenience preference only, never passwords, access tokens or wallet records.
  try {
    if (remember) localStorage.setItem(TRUST_KEY, "yes");
    else localStorage.removeItem(TRUST_KEY);
  } catch { /* Browser storage may be disabled. */ }
}

rememberBrowser.checked = readRememberedBrowser();

function refreshLoginButton() {
  const fast = rememberBrowser.checked && !selectingAccountRequired;
  loginButton.textContent = fast ? "Continue with Google" : "Sign in with Google";
  loginButton.disabled = !signInReady;
}

// Ordinary loading messages are read to assistive technologies, not shown as logs.
// Only errors and data warnings become visible in the wallet.
function setWalletMessage(message, problem = false) {
  walletState.textContent = message;
  walletState.classList.toggle("visually-hidden", !problem);
  walletState.classList.toggle("wallet-message-error", problem);
}

function resetWallet() {
  connectionVersion++;
  activeFolderId = null;
  walletEntries = [];
  walletView.hidden = true;
  walletTableWrap.hidden = true;
  walletTableBody.replaceChildren();
  setWalletMessage("");
  selectedMonth = currentMonth;
}

function showSignedOut(message = "Sign in with your Google account.") {
  resetWallet();
  loginView.hidden = false;
  signInActions.hidden = false;
  unauthorizedView.hidden = true;
  unauthorizedAccount.textContent = "";
  status.textContent = message;
  refreshLoginButton();
}

function showSignedIn() {
  resetWallet();
  setRememberedBrowser(rememberBrowser.checked);
  attemptedFastLogin = false;
  selectingAccountRequired = false;
  loginView.hidden = true;
  walletView.hidden = false;
  setWalletMessage("Checking private Drive storage...");
  monthLabel.textContent = formatMonth(selectedMonth);
  prevButton.disabled = true;
}

function showUnauthorized(email) {
  signOut();
  resetWallet();
  attemptedFastLogin = false;
  selectingAccountRequired = true;
  rememberBrowser.checked = false;
  setRememberedBrowser(false);
  loginView.hidden = false;
  signInActions.hidden = true;
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
  setWalletMessage("Reading wallet records...");

  try {
    const files = await readWalletTextFiles(getDriveToken(), folderId);
    if (version !== connectionVersion || !getDriveToken()) return;
    const parsed = parseWalletFiles(files);
    walletEntries = parsed.entries;
    renderMonth();
    walletTableWrap.hidden = false;
    if (parsed.invalidLines) {
      setWalletMessage(
        "Some TXT rows could not be read (" + parsed.invalidLines +
        "). Only valid records are shown. Review your files.", true
      );
    } else {
      setWalletMessage("");
    }
  } catch (error) {
    if (version !== connectionVersion) return;
    walletEntries = [];
    walletTableWrap.hidden = true;
    setWalletMessage(error.message || "Could not read wallet records.", true);
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
      setWalletMessage(
        "Wallet bills folder not found. Check its Drive access. No folder was created.", true
      );
      return;
    }
    activeFolderId = folder.id;
    if (folder.name !== "Wallet bills") {
      setWalletMessage("Rename the connected Drive folder to Wallet bills.", true);
    }
    await loadWalletRecords();
  } catch (error) {
    if (version !== connectionVersion) return;
    setWalletMessage(error.message || "Google Drive could not be checked.", true);
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
    signIn({ fast }); // Must run from a direct user click.
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
  if (activeFolderId) {
    void loadWalletRecords();
  } else {
    setWalletMessage("Storage is not connected. Sign out and sign in again.", true);
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
      activeFolderId = null;
      setWalletMessage(message, true);
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
