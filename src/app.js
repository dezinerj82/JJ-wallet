import { initialiseGoogleLogin, restoreLoginSession, signIn, signOut, getDriveToken } from "./auth.js";
import { findBillsFolder, readWalletTextFiles, addWalletItem, updateWalletItem } from "./drive.js";
import { getMyrKrwRate, formatWalletCurrency, rateDateLabel } from "./currency.js";
import {
  WALLET_GROUPS, parseWalletFiles, entriesForMonth,
  monthKey, shiftedMonthKey, formatMonth
} from "./records.js";

const TRUST_KEY = "home-wallet-remember-browser-v1";
const currentMonth = monthKey(new Date());
let selectedMonth = currentMonth;
let comparisonMonth = shiftedMonthKey(currentMonth, 1);
let walletEntries = [];
let activeFolderId = null;
let connectionVersion = 0;
let selectingAccountRequired = false;
let attemptedFastLogin = false;
let signInReady = false;
let editingEntry = null;
let walletProgressTicket = 0;
let displayCurrency = "MYR";
let referenceRate = null;
let currencyLoading = false;
let currencyError = "";
let currencyRequestId = 0;
const expandedGroups = new Map(WALLET_GROUPS.map(group => [group, true]));
const comparisonGroups = new Map(WALLET_GROUPS.map(group => [group, true]));

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
const walletProgress = document.getElementById("wallet-progress");
const walletProgressText = document.getElementById("wallet-progress-text");
const itemProgress = document.getElementById("item-progress");
const itemProgressText = document.getElementById("item-progress-text");
const walletTableWrap = document.getElementById("wallet-table-wrap");
const walletTableBody = document.getElementById("wallet-table-body");
const monthLabel = document.getElementById("month-label");
const otherMonthsButton = document.getElementById("other-months-button");
const otherMonthsWindow = document.getElementById("other-months-window");
const otherMonthsDragHandle = document.getElementById("other-months-drag-handle");
const otherMonthsClose = document.getElementById("other-months-close");
const otherMonthsPrev = document.getElementById("other-months-prev");
const otherMonthsNext = document.getElementById("other-months-next");
const otherMonthsLabel = document.getElementById("other-months-label");
const otherMonthsBody = document.getElementById("other-months-table-body");
const mainCurrencySelect = document.getElementById("main-currency-select");
const otherCurrencySelect = document.getElementById("other-currency-select");
const exchangeNotes = [
  {
    container: document.getElementById("main-exchange-info"),
    text: document.getElementById("main-exchange-text"),
    credit: document.getElementById("main-exchange-credit"),
    progress: document.getElementById("main-exchange-progress")
  },
  {
    container: document.getElementById("other-exchange-info"),
    text: document.getElementById("other-exchange-text"),
    credit: document.getElementById("other-exchange-credit"),
    progress: document.getElementById("other-exchange-progress")
  }
];
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

function beginWalletProgress(message) {
  const ticket = ++walletProgressTicket;
  walletProgressText.textContent = message;
  walletProgress.querySelector('[role="progressbar"]').setAttribute("aria-valuetext", message);
  walletProgress.hidden = false;
  return ticket;
}

function finishWalletProgress(ticket) {
  if (ticket !== walletProgressTicket) return;
  walletProgress.hidden = true;
  walletProgressText.textContent = "";
}

function setItemProgress(message = "") {
  itemProgress.hidden = !message;
  itemProgressText.textContent = message;
  if (message) {
    itemProgress.querySelector('[role="progressbar"]').setAttribute("aria-valuetext", message);
  }
}

function updateExchangeNotes() {
  const converted = displayCurrency === "KRW";
  for (const note of exchangeNotes) {
    note.container.hidden = !converted;
    if (!converted) continue;
    note.progress.hidden = !currencyLoading;
    note.credit.hidden = currencyLoading || !!currencyError || !referenceRate;
    note.text.textContent = currencyLoading
      ? "Getting the latest exchange rate..."
      : currencyError
        ? currencyError
        : referenceRate
          ? "Approximate conversion · Rate updated " + rateDateLabel(referenceRate) +
            " · Rounded up to the next ₩100."
          : "Checking the exchange rate...";
  }
}

async function refreshCurrencyRate() {
  if (displayCurrency !== "KRW") return;
  const requestId = ++currencyRequestId;
  currencyLoading = true;
  currencyError = "";
  updateExchangeNotes();
  try {
    const latestRate = await getMyrKrwRate();
    if (requestId !== currencyRequestId || displayCurrency !== "KRW") return;
    referenceRate = latestRate;
  } catch {
    if (requestId !== currencyRequestId || displayCurrency !== "KRW") return;
    referenceRate = null;
    currencyError = "Couldn't get the exchange rate. Press Refresh to retry, or choose RM.";
  } finally {
    if (requestId === currencyRequestId && displayCurrency === "KRW") {
      currencyLoading = false;
      updateExchangeNotes();
      renderMonth();
      renderComparisonMonth();
    }
  }
}

function selectCurrency(value) {
  if (value !== "MYR" && value !== "KRW") return;
  ++currencyRequestId;
  displayCurrency = value;
  mainCurrencySelect.value = value;
  otherCurrencySelect.value = value;
  currencyLoading = false;
  currencyError = "";
  if (value === "KRW") referenceRate = null;
  updateExchangeNotes();
  renderMonth();
  renderComparisonMonth();
  if (value === "KRW") void refreshCurrencyRate();
}

mainCurrencySelect.addEventListener("change", () => selectCurrency(mainCurrencySelect.value));
otherCurrencySelect.addEventListener("change", () => selectCurrency(otherCurrencySelect.value));

function resetWallet() {
  connectionVersion++;
  ++currencyRequestId;
  displayCurrency = "MYR";
  referenceRate = null;
  currencyLoading = false;
  currencyError = "";
  mainCurrencySelect.value = "MYR";
  otherCurrencySelect.value = "MYR";
  updateExchangeNotes();
  walletProgressTicket++;
  walletProgress.hidden = true;
  walletProgressText.textContent = "";
  setItemProgress();
  activeFolderId = null;
  walletEntries = [];
  walletView.hidden = true;
  walletTableWrap.hidden = true;
  walletTableBody.replaceChildren();
  closeOtherMonths(false);
  comparisonMonth = shiftedMonthKey(currentMonth, 1);
  comparisonGroups.forEach((_, key) => comparisonGroups.set(key, true));
  otherMonthsButton.disabled = true;
  addPanel.hidden = true;
  editingEntry = null;
  addGroup.disabled = false;
  addName.readOnly = false;
  addMonth.disabled = false;
  addForm.reset();
  addButton.disabled = true;
  submitItemButton.disabled = false;
  cancelItemButton.disabled = false;
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
  beginWalletProgress("Getting your wallet ready...");
  monthLabel.textContent = formatMonth(currentMonth);
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

// The main and movable comparison tables share exactly the same row renderer.
function renderTable(month, target, groupStates, fromComparison = false) {
  const groups = entriesForMonth(walletEntries, month);
  const rows = document.createDocumentFragment();

  for (const group of WALLET_GROUPS) {
    const entries = groups[group];
    const expanded = groupStates.get(group) !== false;
    const headingRow = document.createElement("tr");
    headingRow.className = "group-heading";
    const headingCell = document.createElement("th");
    headingCell.colSpan = 4;
    headingCell.scope = "rowgroup";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "group-toggle group-" + group.toLowerCase();
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("aria-label", (expanded ? "Collapse " : "Expand ") + group);
    button.textContent = group;
    button.addEventListener("click", () => {
      groupStates.set(group, !expanded);
      renderTable(month, target, groupStates, fromComparison);
    });

    headingCell.append(button);
    headingRow.append(headingCell);
    rows.append(headingRow);
    if (!expanded) continue;

    if (!entries.length) {
      const emptyRow = document.createElement("tr");
      emptyRow.className = "empty-row";
      const emptyCell = document.createElement("td");
      emptyCell.colSpan = 4;
      emptyCell.textContent = "No items";
      emptyRow.append(emptyCell);
      rows.append(emptyRow);
      continue;
    }

    for (const entry of entries) {
      const row = document.createElement("tr");
      addTextCell(row, entry.item, "wallet-item");
      addTextCell(row, formatWalletCurrency(
        entry.group === "Saving" ? entry.balance : entry.amount,
        displayCurrency, referenceRate
      ), "wallet-amount");
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
        "Past months and savings balances cannot be edited here";
      const pencil = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      pencil.setAttribute("viewBox", "0 0 24 24");
      pencil.setAttribute("width", "16");
      pencil.setAttribute("height", "16");
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
        editButton.addEventListener("click", () => {
          openUpdateForm(entry);
          if (fromComparison) {
            addPanel.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        });
      }
      actionCell.append(editButton);
      row.append(actionCell);
      rows.append(row);
    }
  }
  target.replaceChildren(rows);
}

function renderMonth() {
  // The main page always displays the current month.
  selectedMonth = currentMonth;
  monthLabel.textContent = formatMonth(currentMonth);
  renderTable(currentMonth, walletTableBody, expandedGroups);
}

function renderComparisonMonth() {
  if (otherMonthsWindow.hidden) return;
  otherMonthsLabel.textContent = formatMonth(comparisonMonth);
  otherMonthsPrev.disabled = comparisonMonth <= "190001";
  otherMonthsNext.disabled = comparisonMonth >= "219912";
  renderTable(comparisonMonth, otherMonthsBody, comparisonGroups, true);
}

function closeOtherMonths(restoreFocus = true) {
  const wasOpen = !otherMonthsWindow.hidden;
  otherMonthsWindow.hidden = true;
  document.body.classList.remove("other-months-open");
  otherMonthsButton.setAttribute("aria-expanded", "false");
  otherMonthsBody.replaceChildren();
  if (restoreFocus && wasOpen) otherMonthsButton.focus();
}

function openOtherMonths() {
  if (!activeFolderId || !getDriveToken()) {
    setWalletMessage("Please sign in again to view other months.", true);
    return;
  }
  if (!otherMonthsWindow.hidden) {
    otherMonthsClose.focus();
    return;
  }
  otherMonthsWindow.style.left = "";
  otherMonthsWindow.style.top = "";
  otherMonthsWindow.style.right = "";
  otherMonthsWindow.hidden = false;
  document.body.classList.add("other-months-open");
  otherMonthsButton.setAttribute("aria-expanded", "true");
  renderComparisonMonth();
  otherMonthsClose.focus({ preventScroll: true });
}


async function loadWalletRecords(message = "Refreshing your items...") {
  if (!activeFolderId) return;
  const version = connectionVersion;
  const folderId = activeFolderId;
  const ticket = beginWalletProgress(message);
  walletView.hidden = false;
  walletTableWrap.hidden = true;
  refreshButton.disabled = true;
  addButton.disabled = true;
  setWalletMessage("Loading items...");

  try {
    const files = await readWalletTextFiles(getDriveToken(), folderId);
    if (version !== connectionVersion || !getDriveToken()) return;
    const parsed = parseWalletFiles(files);
    walletEntries = parsed.entries;
    renderMonth();
    renderComparisonMonth();
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
    closeOtherMonths(false);
    setWalletMessage(error.message || "Could not read wallet records.", true);
  } finally {
    finishWalletProgress(ticket);
    if (version === connectionVersion) {
      refreshButton.disabled = false;
      addButton.disabled = !activeFolderId;
      otherMonthsButton.disabled = !activeFolderId;
    }
  }
}

async function onDriveReady() {
  const version = connectionVersion;
  const ticket = beginWalletProgress("Connecting to your wallet...");
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
    otherMonthsButton.disabled = false;
    if (folder.name !== "Wallet bills") {
      setWalletMessage("Rename the connected Drive folder to Wallet bills.", true);
    }
    await loadWalletRecords("Loading your items...");
  } catch (error) {
    if (version !== connectionVersion) return;
    setWalletMessage(error.message || "Couldn't open your wallet. Please try again.", true);
  } finally {
    finishWalletProgress(ticket);
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
  setItemProgress();
  cancelItemButton.disabled = false;
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
  cancelItemButton.disabled = true;
  addButton.disabled = true;
  refreshButton.disabled = true;
  addStatus.textContent = "";
  setItemProgress(previous ? "Updating your item..." : "Saving your item...");

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
    expandedGroups.set(result.group, true);
    comparisonGroups.set(result.group, true);
    closeAddPanel();
    await loadWalletRecords("Updating your list...");
  } catch (error) {
    if (version === connectionVersion) {
      addStatus.textContent = error.message || "Couldn't save your item. Please try again.";
    }
  } finally {
    if (version === connectionVersion) {
      setItemProgress();
      submitItemButton.disabled = false;
      cancelItemButton.disabled = false;
      addButton.disabled = !activeFolderId;
      otherMonthsButton.disabled = !activeFolderId;
      refreshButton.disabled = false;
    }
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

otherMonthsButton.addEventListener("click", openOtherMonths);
otherMonthsClose.addEventListener("click", () => closeOtherMonths());
otherMonthsPrev.addEventListener("click", () => {
  if (comparisonMonth > "190001") {
    comparisonMonth = shiftedMonthKey(comparisonMonth, -1);
    renderComparisonMonth();
  }
});
otherMonthsNext.addEventListener("click", () => {
  if (comparisonMonth < "219912") {
    comparisonMonth = shiftedMonthKey(comparisonMonth, 1);
    renderComparisonMonth();
  }
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !otherMonthsWindow.hidden) closeOtherMonths();
});

// Movable non-modal window, leaving the live wallet visible and usable.
function moveOtherMonthsTo(left, top) {
  const rect = otherMonthsWindow.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
  const maxTop = Math.max(8, window.innerHeight - Math.min(rect.height, 90) - 8);
  otherMonthsWindow.style.left = Math.min(Math.max(8, left), maxLeft) + "px";
  otherMonthsWindow.style.top = Math.min(Math.max(8, top), maxTop) + "px";
  otherMonthsWindow.style.right = "auto";
}
let draggingOtherMonths = null;
otherMonthsDragHandle.addEventListener("keydown", event => {
  if (event.target !== otherMonthsDragHandle || otherMonthsWindow.hidden) return;
  const step = event.shiftKey ? 40 : 18;
  const moves = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step]
  };
  const delta = moves[event.key];
  if (!delta) return;
  const rect = otherMonthsWindow.getBoundingClientRect();
  moveOtherMonthsTo(rect.left + delta[0], rect.top + delta[1]);
  event.preventDefault();
});
otherMonthsDragHandle.addEventListener("pointerdown", event => {
  if (event.button !== 0 || event.target.closest("button") || otherMonthsWindow.hidden) return;
  const rect = otherMonthsWindow.getBoundingClientRect();
  draggingOtherMonths = {
    pointerId: event.pointerId,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top
  };
  otherMonthsDragHandle.setPointerCapture(event.pointerId);
  event.preventDefault();
});
otherMonthsDragHandle.addEventListener("pointermove", event => {
  if (!draggingOtherMonths || event.pointerId !== draggingOtherMonths.pointerId) return;
  moveOtherMonthsTo(event.clientX - draggingOtherMonths.offsetX,
    event.clientY - draggingOtherMonths.offsetY);
});
function stopOtherMonthsDrag(event) {
  if (draggingOtherMonths?.pointerId === event.pointerId) draggingOtherMonths = null;
}
otherMonthsDragHandle.addEventListener("pointerup", stopOtherMonthsDrag);
otherMonthsDragHandle.addEventListener("pointercancel", stopOtherMonthsDrag);
window.addEventListener("resize", () => {
  if (otherMonthsWindow.hidden || !otherMonthsWindow.style.left) return;
  const rect = otherMonthsWindow.getBoundingClientRect();
  moveOtherMonthsTo(rect.left, rect.top);
});

refreshButton.addEventListener("click", () => {
  if (activeFolderId) {
    void loadWalletRecords();
    if (displayCurrency === "KRW") void refreshCurrencyRate();
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
