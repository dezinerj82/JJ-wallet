import { initialiseGoogleLogin, restoreLoginSession, signIn, signOut, getDriveToken } from "./auth.js";
import { findBillsFolder, readWalletTextFiles, addWalletItem, updateWalletItem } from "./drive.js";
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
let editingEntry = null;
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
const addButton = document.getElementById("add-item-button");
const addPanel = document.getElementById("add-item-panel");
const addHeading = document.getElementById("add-item-heading");
const addForm = document.getElementById("add-item-form");
const addGroup = document.getElementById("add-item-group");
const addName = document.getElementById("add-item-name");
const addMonth = document.getElementById("add-item-month");
const addAmount = document.getElementById("add-item-amount");
const addRetailField = document.getElementById("add-retail-field");
const addUrlField = document.getElementById("add-url-field");
const addRemarkField = document.getElementById("add-remark-field");
const addRetail = document.getElementById("add-item-retail");
const addUrl = document.getElementById("add-item-url");
const addRemark = document.getElementById("add-item-remark");
const addStatus = document.getElementById("add-item-status");
const submitItemButton = document.getElementById("submit-item-button");
const cancelItemButton = document.getElementById("cancel-item-button");

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
  addPanel.hidden = true;
  editingEntry = null;
  addGroup.disabled = false;
  addName.readOnly = false;
  addMonth.disabled = false;
  addForm.reset();
  addButton.disabled = true;
  submitItemButton.disabled = false;
  addStatus.textContent = "";
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
  setWalletMessage("Opening wallet...");
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
    headingCell.colSpan = 4;
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
      cell.colSpan = 4;
      cell.textContent = "No items";
      empty.append(cell);
      rows.append(empty);
      continue;
    }
    for (const entry of entries) {
      const row = document.createElement("tr");
      addTextCell(row, entry.item, "wallet-item");
      const value = entry.group === "Saving" ? entry.balance : entry.amount;
      addTextCell(row, formatAmount(value), "wallet-amount");

      // Details are only the user's own remark. Payment and storage data
      // remain in the item record but aren't presented as log messages.
      addTextCell(row, entry.remark || "—", "wallet-detail");

      const actionCell = document.createElement("td");
      actionCell.className = "wallet-update-cell";
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "update-item-button";
      editButton.setAttribute("aria-label", "Update " + entry.item);
      const editable = entry.group !== "Saving" && entry.month >= currentMonth;
      editButton.disabled = !editable;
      editButton.title = editable ? "Update " + entry.item :
        "Completed months and savings balances cannot be edited here";
      const pencil = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      pencil.setAttribute("viewBox", "0 0 24 24");
      pencil.setAttribute("width", "19");
      pencil.setAttribute("height", "19");
      pencil.setAttribute("fill", "none");
      pencil.setAttribute("stroke", "currentColor");
      pencil.setAttribute("stroke-width", "2");
      pencil.setAttribute("stroke-linecap", "round");
      pencil.setAttribute("stroke-linejoin", "round");
      pencil.setAttribute("aria-hidden", "true");
      const mark = document.createElementNS("http://www.w3.org/2000/svg", "path");
      mark.setAttribute("d", "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4Z");
      pencil.append(mark);
      editButton.append(pencil);
      if (editable) {
        editButton.addEventListener("click", () => openUpdateForm(entry));
      }
      actionCell.append(editButton);
      row.append(actionCell);
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
  setWalletMessage("Loading items...");

  try {
    const files = await readWalletTextFiles(getDriveToken(), folderId);
    if (version !== connectionVersion || !getDriveToken()) return;
    const parsed = parseWalletFiles(files);
    walletEntries = parsed.entries;
    renderMonth();
    walletTableWrap.hidden = false;
    if (parsed.invalidLines) {
      setWalletMessage(
        "Some saved items couldn't be displayed (" + parsed.invalidLines +
        "). Please check your records.", true
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
    addButton.disabled = false;
    if (folder.name !== "Wallet bills") {
      setWalletMessage("Rename the connected Drive folder to Wallet bills.", true);
    }
    await loadWalletRecords();
  } catch (error) {
    if (version !== connectionVersion) return;
    setWalletMessage(error.message || "Google Drive could not be checked.", true);
  }
}


function updateOptionalFields() {
  const others = addGroup.value === "Others";
  addRetailField.hidden = !others;
  addUrlField.hidden = !others;
  addRemarkField.hidden = false;
  if (!others) {
    addRetail.value = "";
    addUrl.value = "";
  }
}

function closeAddPanel() {
  addPanel.hidden = true;
  editingEntry = null;
  addHeading.textContent = "Add item";
  submitItemButton.textContent = "Submit";
  addGroup.disabled = false;
  addName.readOnly = false;
  addMonth.disabled = false;
  addStatus.textContent = "";
  addForm.reset();
  submitItemButton.disabled = false;
}

function openUpdateForm(entry) {
  if (!activeFolderId || !getDriveToken()) {
    setWalletMessage("Your session expired. Sign in again to update this item.", true);
    return;
  }
  if (entry.group === "Saving" || entry.month < currentMonth) return;

  addForm.reset();
  editingEntry = { ...entry };
  addHeading.textContent = "Update item";
  submitItemButton.textContent = "Update";
  addGroup.value = entry.group;
  addGroup.disabled = true;
  addName.value = entry.item;
  addName.readOnly = true;
  addMonth.min = currentMonth.slice(0, 4) + "-" + currentMonth.slice(4);
  addMonth.value = entry.month.slice(0, 4) + "-" + entry.month.slice(4);
  addMonth.disabled = true;
  addAmount.value = String(entry.amount);
  addRetail.value = entry.retail || "";
  addUrl.value = entry.url || "";
  addRemark.value = entry.remark || "";
  updateOptionalFields();
  addStatus.textContent = "";
  addPanel.hidden = false;
  addAmount.focus();
}

addButton.addEventListener("click", () => {
  if (!activeFolderId || !getDriveToken()) {
    setWalletMessage("Please sign in again to add an item.", true);
    return;
  }
  closeAddPanel();
  addGroup.value = "IN";
  addMonth.min = currentMonth.slice(0, 4) + "-" + currentMonth.slice(4);
  addMonth.value = selectedMonth.slice(0, 4) + "-" + selectedMonth.slice(4);
  updateOptionalFields();
  addStatus.textContent = "";
  addPanel.hidden = false;
  addName.focus();
});

addGroup.addEventListener("change", updateOptionalFields);
cancelItemButton.addEventListener("click", closeAddPanel);

addForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!activeFolderId || !getDriveToken()) {
    addStatus.textContent = "Your session has expired. Please sign in again.";
    return;
  }
  if (!addForm.reportValidity()) return;
  const version = connectionVersion;
  const previous = editingEntry;
  submitItemButton.disabled = true;
  addStatus.textContent = previous ? "Updating..." : "Saving...";

  try {
    const payload = {
      group: previous ? previous.group : addGroup.value,
      item: previous ? previous.item : addName.value,
      month: previous ? previous.month : addMonth.value.replace("-", ""),
      amount: addAmount.value,
      retail: addRetail.value,
      url: addUrl.value,
      remark: addRemark.value
    };
    const result = previous
      ? await updateWalletItem(getDriveToken(), activeFolderId, { ...payload, previous })
      : await addWalletItem(getDriveToken(), activeFolderId, payload);
    if (version !== connectionVersion) return;
    selectedMonth = result.month;
    expandedGroups.set(result.group, true);
    closeAddPanel();
    await loadWalletRecords();
  } catch (error) {
    if (version === connectionVersion) {
      addStatus.textContent = error.message || "Could not save the item.";
    }
  } finally {
    if (version === connectionVersion) submitItemButton.disabled = false;
  }
});

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
    shouldRememberSession: () => rememberBrowser.checked,
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
  const restored = await restoreLoginSession();
  if (!restored) {
    showSignedOut(
      rememberBrowser.checked
        ? "Welcome back. Continue with Google."
        : "Sign in with your Google account."
    );
  }
} catch (error) {
  signInReady = false;
  showSignedOut(error.message);
}
