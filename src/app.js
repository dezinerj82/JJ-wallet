import { initialiseGoogleLogin, restoreLoginSession, signIn, signOut, getDriveToken } from "./auth.js";
import { findBillsFolder, readWalletTextFiles, addWalletItem, updateWalletItem, deleteWalletItem, renewRecurringBills, renewScheduledItems, importWalletSetup, saveSavingSettings, withdrawSavingItem } from "./drive.js";
import { getMyrKrwRate, formatWalletCurrency, rateDateLabel } from "./currency.js";
import { displayGroup, availableGroups, isCustomGroup, NEW_CATEGORY, NEW_ITEM } from "./groups.js";
import { buildMeta, parseAllMetadata, serviceReminders, effectiveServiceMonth, metaKey } from "./private-meta.js";
import { plannedAlerts, validateSetupPayload } from "./setup.js";
import {
  WALLET_GROUPS, parseWalletFiles, entriesForMonth, calculateMonthlyPlan,
  monthKey, shiftedMonthKey, formatMonth, formatAmount
} from "./records.js";

const TRUST_KEY = "home-wallet-remember-browser-v1";
const currentMonth = monthKey(new Date());
let selectedMonth = currentMonth;
let comparisonMonth = shiftedMonthKey(currentMonth, 1);
let walletEntries = [];
let walletBalanceReady = false;
let walletBalanceComplete = false;
let activeFolderId = null;
let connectionVersion = 0;
let selectingAccountRequired = false;
let attemptedFastLogin = false;
let signInReady = false;
let editingEntry = null;
let editingSavings = null;
let withdrawApproved = false;
let lastAddGroup = "IN";
let walletMetadata = new Map();
let walletCatalog = [];
let walletSchedules = [];
const reminderSeen = new Set();
let walletProgressTicket = 0;
const displayCurrencies = { main: "MYR", other: "MYR" };
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
const walletBalanceRow = document.getElementById("wallet-balance-row");
const walletBalanceWarning = document.getElementById("wallet-balance-warning");
const walletBalanceOutput = document.getElementById("wallet-balance");
const walletBalanceAmount = document.getElementById("wallet-balance-amount");
const monthLabel = document.getElementById("month-label");
const otherMonthsButton = document.getElementById("other-months-button");
const otherMonthsWindow = document.getElementById("other-months-window");
const otherMonthsDragHandle = document.getElementById("other-months-drag-handle");
const otherMonthsResizeHandle = document.getElementById("other-months-resize-handle");
const otherMonthsClose = document.getElementById("other-months-close");
const otherMonthsPrev = document.getElementById("other-months-prev");
const otherMonthsNext = document.getElementById("other-months-next");
const otherMonthsLabel = document.getElementById("other-months-label");
const otherMonthsBody = document.getElementById("other-months-table-body");
const mainCurrencySelect = document.getElementById("main-currency-select");
const otherCurrencySelect = document.getElementById("other-currency-select");
const exchangeNotes = {
  main: {
    container: document.getElementById("main-exchange-info"),
    text: document.getElementById("main-exchange-text"),
    credit: document.getElementById("main-exchange-credit"),
    progress: document.getElementById("main-exchange-progress")
  },
  other: {
    container: document.getElementById("other-exchange-info"),
    text: document.getElementById("other-exchange-text"),
    credit: document.getElementById("other-exchange-credit"),
    progress: document.getElementById("other-exchange-progress")
  }
};
const refreshButton = document.getElementById("refresh-wallet-button");
const addButton = document.getElementById("add-item-button");
const walletSetupButton = document.getElementById("wallet-setup-button");
const walletSetupFile = document.getElementById("wallet-setup-file");
const addPanel = document.getElementById("add-item-panel");
const addHeading = document.getElementById("add-item-heading");
const addForm = document.getElementById("add-item-form");
const addGroup = document.getElementById("add-item-group");
const addCategoryField = document.getElementById("add-category-field");
const addCategoryName = document.getElementById("add-category-name");
const addItemSelectField = document.getElementById("add-item-select-field");
const addItemSelect = document.getElementById("add-item-select");
const addNameField = document.getElementById("add-item-name-field");
const addName = document.getElementById("add-item-name");
const addMonth = document.getElementById("add-item-month");
const addAmount = document.getElementById("add-item-amount");
const addRecurringField = document.getElementById("add-recurring-field");
const addRecurring = document.getElementById("add-item-recurring");
const addOptions = document.getElementById("add-item-options");
const addHoverNote = document.getElementById("add-item-hover-note");
const addLastService = document.getElementById("add-last-service");
const addServiceInterval = document.getElementById("add-service-interval");
const addRemindBefore = document.getElementById("add-remind-before");
const addRetailField = document.getElementById("add-retail-field");
const addUrlField = document.getElementById("add-url-field");
const addRemarkField = document.getElementById("add-remark-field");
const addRetail = document.getElementById("add-item-retail");
const addUrl = document.getElementById("add-item-url");
const addRemark = document.getElementById("add-item-remark");
const addStatus = document.getElementById("add-item-status");
const submitItemButton = document.getElementById("submit-item-button");
const cancelItemButton = document.getElementById("cancel-item-button");
const deleteItemButton = document.getElementById("delete-item-button");
const savingsPanel = document.getElementById("saving-settings-panel");
const savingsForm = document.getElementById("saving-settings-form");
const savingsName = document.getElementById("saving-settings-name");
const savingsAccessible = document.getElementById("saving-accessible");
const savingsMonthlyTarget = document.getElementById("saving-monthly-target");
const savingsAdjustable = document.getElementById("saving-adjustable");
const savingsNote = document.getElementById("saving-hover-note");
const savingsStatus = document.getElementById("saving-settings-status");
const savingsCancel = document.getElementById("saving-settings-cancel");
const savingsSave = document.getElementById("saving-settings-save");
const walletDialog = document.getElementById("wallet-dialog");
const walletDialogText = document.getElementById("wallet-dialog-text");
const walletDialogCancel = document.getElementById("wallet-dialog-cancel");
const walletDialogOk = document.getElementById("wallet-dialog-ok");
const hoverTooltip = document.createElement("div");
hoverTooltip.className = "hover-tooltip";
hoverTooltip.hidden = true;
hoverTooltip.setAttribute("role", "tooltip");
document.body.append(hoverTooltip);

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

// The two tables choose display currency independently; one verified rate
// can serve either view without ever modifying the underlying MYR amounts.
function anyWonView() {
  return displayCurrencies.main === "KRW" || displayCurrencies.other === "KRW";
}

function updateExchangeNotes() {
  for (const [view, note] of Object.entries(exchangeNotes)) {
    const converted = displayCurrencies[view] === "KRW";
    note.container.hidden = !converted;
    note.progress.hidden = !converted || !currencyLoading;
    note.credit.hidden = !converted || currencyLoading || !!currencyError || !referenceRate;
    note.text.textContent = !converted
      ? ""
      : currencyLoading
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
  if (!anyWonView()) return;
  // A shared request updates whichever table currently displays won.
  const requestId = ++currencyRequestId;
  currencyLoading = true;
  currencyError = "";
  updateExchangeNotes();
  try {
    const latestRate = await getMyrKrwRate();
    if (requestId !== currencyRequestId || !anyWonView()) return;
    referenceRate = latestRate;
  } catch {
    if (requestId !== currencyRequestId || !anyWonView()) return;
    referenceRate = null;
    currencyError = "Couldn't get the exchange rate. Press Refresh to retry, or choose RM.";
  } finally {
    if (requestId === currencyRequestId) {
      currencyLoading = false;
      updateExchangeNotes();
      renderMonth();
      renderComparisonMonth();
    }
  }
}

function selectCurrency(view, value) {
  if (!Object.hasOwn(displayCurrencies, view) ||
      (value !== "MYR" && value !== "KRW")) return;
  displayCurrencies[view] = value;
  if (view === "main") mainCurrencySelect.value = value;
  else otherCurrencySelect.value = value;

  if (!anyWonView()) {
    // Cancel updates to the display when neither table needs the rate.
    ++currencyRequestId;
    currencyLoading = false;
    currencyError = "";
  }
  updateExchangeNotes();
  if (view === "main") renderMonth();
  else renderComparisonMonth();

  // No second network fetch while the other view is already loading.
  if (value === "KRW" && !currencyLoading) void refreshCurrencyRate();
}

mainCurrencySelect.addEventListener("change", () =>
  selectCurrency("main", mainCurrencySelect.value));
otherCurrencySelect.addEventListener("change", () =>
  selectCurrency("other", otherCurrencySelect.value));

function resetWallet() {
  connectionVersion++;
  ++currencyRequestId;
  displayCurrencies.main = "MYR";
  displayCurrencies.other = "MYR";
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
  walletMetadata = new Map();
  walletCatalog = [];
  walletSchedules = [];
  reminderSeen.clear();
  withdrawApproved = false;
  savingsPanel.hidden = true;
  editingSavings = null;
  if (walletDialog.open) walletDialog.close("cancel");
  hideItemTooltip();
  walletBalanceReady = false;
  walletBalanceComplete = false;
  walletBalanceRow.hidden = true;
  walletBalanceWarning.hidden = true;
  walletBalanceAmount.textContent = "—";
  walletBalanceOutput.removeAttribute("title");
  walletView.hidden = true;
  walletTableWrap.hidden = true;
  walletTableBody.replaceChildren();
  closeOtherMonths(false);
  comparisonMonth = shiftedMonthKey(currentMonth, 1);
  comparisonGroups.forEach((_, key) => comparisonGroups.set(key, true));
  otherMonthsButton.disabled = true;
  walletSetupButton.disabled = true;
  walletSetupFile.value = "";
  addPanel.hidden = true;
  editingEntry = null;
  deleteItemButton.hidden = true;
  deleteItemButton.disabled = false;
  addGroup.disabled = false;
  addName.readOnly = false;
  addMonth.disabled = false;
  addForm.reset();
  addRecurring.checked = false;
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
function confirmWallet(message = "Are you sure?") {
  if (walletDialog.open) return Promise.resolve(false);
  walletDialogText.textContent = message;
  return new Promise(resolve => {
    const ok = () => walletDialog.close("ok");
    const cancel = () => walletDialog.close("cancel");
    const finish = () => {
      walletDialogOk.removeEventListener("click", ok);
      walletDialogCancel.removeEventListener("click", cancel);
      walletDialog.removeEventListener("close", finish);
      resolve(walletDialog.returnValue === "ok");
    };
    walletDialogOk.addEventListener("click", ok);
    walletDialogCancel.addEventListener("click", cancel);
    walletDialog.addEventListener("close", finish);
    walletDialog.returnValue = "cancel";
    walletDialog.showModal();
    walletDialogOk.focus();
  });
}

function hideItemTooltip() {
  hoverTooltip.hidden = true;
}

function showItemTooltip(target, text) {
  if (!text) return;
  hoverTooltip.textContent = text;
  hoverTooltip.hidden = false;
  const rect = target.getBoundingClientRect();
  const width = hoverTooltip.getBoundingClientRect().width;
  const height = hoverTooltip.getBoundingClientRect().height;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const top = rect.top >= height + 14
    ? rect.top - height - 8
    : Math.min(window.innerHeight - height - 8, rect.bottom + 8);
  hoverTooltip.style.left = left + "px";
  hoverTooltip.style.top = Math.max(8, top) + "px";
}

function tooltipText(entry) {
  const meta = entry.meta;
  if (!meta) return "";
  const lines = [];
  if (meta.note.trim()) lines.push(meta.note.trim());
  if (meta.hoverUnpaid && Number.isFinite(entry.unpaid)) {
    lines.push("Remaining balance : RM" + formatAmount(entry.unpaid));
  }
  if (meta.lastService) {
    const effective = effectiveServiceMonth(meta, walletEntries);
    lines.push("Last service : " + formatMonth(effective));
  }
  return lines.join("\n\n");
}

function addItemNameCell(row, entry) {
  const cell = document.createElement("td");
  cell.className = "wallet-item";
  const label = document.createElement("span");
  label.textContent = entry.item;
  const note = tooltipText(entry);
  if (note) {
    label.className = "wallet-item-note";
    label.tabIndex = 0;
    label.setAttribute("aria-label", entry.item + ". " + note.replace(/\n/g, " "));
    label.addEventListener("pointerenter", () => showItemTooltip(label, note));
    label.addEventListener("pointerleave", hideItemTooltip);
    label.addEventListener("focus", () => showItemTooltip(label, note));
    label.addEventListener("blur", hideItemTooltip);
  }
  cell.append(label);
  row.append(cell);
}

async function showDueServiceReminders() {
  if (!activeFolderId || !getDriveToken() || walletDialog.open) return;
  const upcoming = serviceReminders(walletMetadata, walletEntries)
    .map(reminder => ({
      id: metaKey(reminder.group, reminder.item) + ":" + reminder.dueMonth,
      text: reminder.item + " · Service due " + formatMonth(reminder.dueMonth)
    }));
  upcoming.push(...plannedAlerts(walletSchedules));
  for (const reminder of upcoming) {
    if (!activeFolderId || !getDriveToken()) return;
    if (reminderSeen.has(reminder.id)) continue;
    reminderSeen.add(reminder.id);
    await confirmWallet(reminder.text);
  }
}

function renderTable(month, target, groupStates, fromComparison = false) {
  const groups = entriesForMonth(walletEntries, month);
  let savingPlan = null;
  try {
    savingPlan = calculateMonthlyPlan(walletEntries, month);
  } catch {
    // Display saved entries even if a planning total cannot be calculated.
  }
  const rows = document.createDocumentFragment();

  for (const group of availableGroups(walletEntries)) {
    const entries = groups[group];
    const expanded = groupStates.get(group) !== false;
    const headingRow = document.createElement("tr");
    headingRow.className = "group-heading";
    const headingCell = document.createElement("th");
    headingCell.colSpan = 4;
    headingCell.scope = "rowgroup";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "group-toggle group-" +
      (isCustomGroup(group) ? "custom" : group.toLowerCase());
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("aria-label", (expanded ? "Collapse " : "Expand ") + displayGroup(group));
    button.textContent = displayGroup(group);
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
      addItemNameCell(row, entry);
      const viewCurrency = fromComparison ? displayCurrencies.other : displayCurrencies.main;
      const amountCell = addTextCell(row, formatWalletCurrency(
        entry.group === "Saving" ? entry.balance : entry.amount,
        viewCurrency, referenceRate
      ), "wallet-amount");
      const planned = entry.group === "Saving"
        ? savingPlan?.savingPlans.get(entry.item) : null;
      if (planned) {
        const amountNote = document.createElement("small");
        amountNote.className = "saving-plan-detail" +
          (planned.adjusted ? " saving-plan-adjusted" : "");
        amountNote.textContent = (planned.adjusted ? "Adjusted: " : "Save: ") +
          formatWalletCurrency(planned.amount, viewCurrency, referenceRate);
        amountNote.title = "Target: " +
          formatWalletCurrency(planned.requested, viewCurrency, referenceRate);
        amountCell.append(amountNote);
      }
      addTextCell(row, entry.remark || "—", "wallet-detail");

      const actionCell = document.createElement("td");
      actionCell.className = "wallet-update-cell";
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "update-item-button";
      editButton.setAttribute("aria-label", "Update " + entry.item);
      const editable = entry.group === "Saving" || entry.month >= currentMonth;
      editButton.disabled = !editable;
      editButton.title = editable
        ? entry.group === "Saving" ? "Savings settings" : "Update " + entry.item
        : "Past months can't be edited";
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
          if (entry.group === "Saving") openSavingSettings(entry);
          else openUpdateForm(entry);
          if (fromComparison) {
            const panel = entry.group === "Saving" ? savingsPanel : addPanel;
            panel.scrollIntoView({ behavior: "smooth", block: "start" });
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

function renderBalance() {
  walletBalanceWarning.hidden = true;
  if (!walletBalanceReady || !activeFolderId || walletView.hidden) {
    walletBalanceRow.hidden = true;
    return;
  }
  walletBalanceRow.hidden = false;
  if (!walletBalanceComplete) {
    walletBalanceAmount.textContent = "—";
    walletBalanceOutput.title = "Some records couldn't be read. Balance isn't available.";
    return;
  }
  try {
    const plan = calculateMonthlyPlan(walletEntries, currentMonth);
    walletBalanceWarning.hidden = !plan.insufficientForBills;
    walletBalanceAmount.textContent = formatWalletCurrency(
      plan.balance, displayCurrencies.main, referenceRate
    );
    walletBalanceOutput.title = plan.insufficientForBills
      ? "Income is below committed spending."
      : plan.savingsAdjusted ? "Savings adjusted for this month."
      : "Planned balance, not a bank balance.";
  } catch {
    walletBalanceAmount.textContent = "—";
    walletBalanceOutput.title = "Couldn't calculate the balance. Please refresh.";
  }
}

function renderMonth() {
  // The main page always displays the current month.
  selectedMonth = currentMonth;
  monthLabel.textContent = formatMonth(currentMonth);
  renderTable(currentMonth, walletTableBody, expandedGroups);
  renderBalance();
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
  const initialPosition = otherMonthsWindow.getBoundingClientRect();
  moveOtherMonthsTo(initialPosition.left, initialPosition.top);
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
  walletBalanceReady = false;
  walletBalanceComplete = false;
  walletBalanceRow.hidden = true;
  refreshButton.disabled = true;
  addButton.disabled = true;
  walletSetupButton.disabled = true;
  setWalletMessage("Loading items...");

  try {
    let files = await readWalletTextFiles(getDriveToken(), folderId);
    if (version !== connectionVersion || !getDriveToken()) return;
    let recurringError = "";
    try {
      const changed = await renewRecurringBills(getDriveToken(), folderId, files);
      if (version !== connectionVersion || !getDriveToken()) return;
      if (changed) files = await readWalletTextFiles(getDriveToken(), folderId);
      const scheduled = await renewScheduledItems(getDriveToken(), folderId, files);
      if (version !== connectionVersion || !getDriveToken()) return;
      if (scheduled) files = await readWalletTextFiles(getDriveToken(), folderId);
    } catch {
      recurringError = "Couldn't update scheduled items. Press Refresh.";
      // Earlier files may have been saved before another one failed.
      files = await readWalletTextFiles(getDriveToken(), folderId);
    }
    if (version !== connectionVersion || !getDriveToken()) return;
    const parsed = parseWalletFiles(files);
    walletEntries = parsed.entries;
    walletCatalog = parsed.catalog;
    walletSchedules = parsed.schedules;
    walletMetadata = parseAllMetadata(files);
    walletBalanceReady = true;
    walletBalanceComplete = parsed.invalidLines === 0 && !recurringError;
    renderMonth();
    renderComparisonMonth();
    walletTableWrap.hidden = false;
    if (recurringError) {
      setWalletMessage(recurringError, true);
    } else if (parsed.invalidLines) {
      setWalletMessage("Some records couldn't be loaded. Press Refresh.", true);
    } else {
      setWalletMessage("");
      void showDueServiceReminders();
    }
  } catch (error) {
    if (version !== connectionVersion) return;
    walletEntries = [];
    walletMetadata = new Map();
    walletCatalog = [];
    walletSchedules = [];
    walletBalanceReady = false;
    walletBalanceComplete = false;
    walletBalanceRow.hidden = true;
    walletTableWrap.hidden = true;
    closeOtherMonths(false);
    setWalletMessage(error.message || "Could not read wallet records.", true);
  } finally {
    finishWalletProgress(ticket);
    if (version === connectionVersion) {
      refreshButton.disabled = false;
      addButton.disabled = !activeFolderId;
      otherMonthsButton.disabled = !activeFolderId;
      walletSetupButton.disabled = !activeFolderId;
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
    walletSetupButton.disabled = false;
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


function populateCategoryChoices() {
  const prior = addGroup.value;
  for (const option of [...addGroup.options]) {
    if (option.dataset.extra === "true") option.remove();
  }
  const anchor = addGroup.querySelector('option[value="Withdraw"]');
  for (const category of availableGroups([...walletEntries, ...walletCatalog])) {
    if (!isCustomGroup(category)) continue;
    const option = new Option(category, category);
    option.dataset.extra = "true";
    addGroup.insertBefore(option, anchor);
  }
  addGroup.value = [...addGroup.options].some(option => option.value === prior)
    ? prior : "IN";
}

function activeAddCategory() {
  return addGroup.value === NEW_CATEGORY
    ? addCategoryName.value.trim() : addGroup.value;
}

function populateItemChoices(previous = "") {
  if (editingEntry) return;
  const group = activeAddCategory();
  const isWithdrawal = group === "Withdraw";
  const names = isWithdrawal
    ? entriesForMonth(walletEntries, currentMonth).Saving
      .filter(entry => entry.meta?.access === "accessible")
      .map(entry => entry.item)
    : [...walletEntries, ...walletCatalog]
      .filter(entry => entry.group === group).map(entry => entry.item);
  const unique = [...new Set(names)].sort((a, b) => a.localeCompare(b));
  addItemSelect.replaceChildren();
  const empty = new Option(isWithdrawal && !unique.length
    ? "No accessible savings" : "Select item", "");
  addItemSelect.append(empty);
  for (const name of unique) addItemSelect.append(new Option(name, name));
  if (!isWithdrawal) addItemSelect.append(new Option("+ Add new item", NEW_ITEM));
  if (previous && [...addItemSelect.options].some(option => option.value === previous)) {
    addItemSelect.value = previous;
  } else if (!isWithdrawal && unique.length === 0) {
    addItemSelect.value = NEW_ITEM;
  }
  syncItemChoice();
}

function syncItemChoice() {
  if (editingEntry) {
    addItemSelectField.hidden = true;
    addItemSelect.required = false;
    addNameField.hidden = false;
    addName.required = true;
    return;
  }
  addItemSelectField.hidden = false;
  const newItem = addItemSelect.value === NEW_ITEM;
  addNameField.hidden = !newItem;
  addName.required = newItem;
  addItemSelect.required = true;
  if (!newItem) addName.value = "";
  const managed = walletSchedules.some(rule => rule.active &&
    rule.group === activeAddCategory() && rule.item === addItemSelect.value);
  if (managed && activeAddCategory() === "Bills") {
    addRecurringField.hidden = true;
    addRecurring.checked = false;
  }
}

function updateOptionalFields() {
  const group = activeAddCategory();
  const isWithdrawal = group === "Withdraw";
  const others = group === "Others";
  const bills = group === "Bills";
  const service = group !== "IN" && group !== "Saving" && !isWithdrawal;
  addCategoryField.hidden = addGroup.value !== NEW_CATEGORY;
  addCategoryName.required = !addCategoryField.hidden;
  const scheduleManaged = Boolean(editingEntry?.scheduled);
  addRecurringField.hidden = !bills || isWithdrawal || scheduleManaged;
  if (!bills || scheduleManaged) addRecurring.checked = false;
  addRetailField.hidden = !others;
  addUrlField.hidden = !others;
  addRemarkField.hidden = false;
  addOptions.hidden = isWithdrawal;
  if (!editingEntry) {
    addHeading.textContent = isWithdrawal ? "Withdraw" : "Add item";
    submitItemButton.textContent = isWithdrawal ? "Withdraw" : "Submit";
  }
  document.getElementById("add-service-field").hidden = !service;
  document.getElementById("add-service-interval-field").hidden = !service;
  document.getElementById("add-remind-field").hidden = !service;
  if (!others) {
    addRetail.value = "";
    addUrl.value = "";
  }
  if (isWithdrawal) {
    addMonth.value = currentMonth.slice(0,4) + "-" + currentMonth.slice(4);
    addMonth.disabled = true;
  } else if (!editingEntry) {
    addMonth.disabled = false;
  }
  if (!editingEntry) populateItemChoices();
}

function enteredItemName() {
  return editingEntry?.item ||
    (addItemSelect.value === NEW_ITEM ? addName.value.trim() : addItemSelect.value);
}

function enteredPrivateMeta(group, item) {
  if (group === "Withdraw") return null;
  const service = group !== "IN" && group !== "Saving";
  const input = {
    note: addHoverNote.value,
    lastService: service ? addLastService.value.replace("-", "") : "",
    interval: service ? Number(addServiceInterval.value) : 0,
    remindBefore: service ? Number(addRemindBefore.value) : 0
  };
  const hasDetails = Boolean(input.note.trim() || input.lastService ||
    input.interval || input.remindBefore || editingEntry?.meta);
  return hasDetails ? buildMeta(group, item, input) : null;
}

function fillPrivateMeta(meta) {
  addHoverNote.value = meta?.note || "";
  addLastService.value = meta?.lastService
    ? meta.lastService.slice(0, 4) + "-" + meta.lastService.slice(4) : "";
  addServiceInterval.value = String(meta?.interval || 0);
  addRemindBefore.value = String(meta?.remindBefore || 0);
  addOptions.open = Boolean(meta && (meta.note || meta.lastService));
}

function closeAddPanel() {
  addPanel.hidden = true;
  withdrawApproved = false;
  lastAddGroup = "IN";
  setItemProgress();
  cancelItemButton.disabled = false;
  deleteItemButton.hidden = true;
  deleteItemButton.disabled = false;
  editingEntry = null;
  addHeading.textContent = "Add item";
  submitItemButton.textContent = "Submit";
  addGroup.disabled = false;
  addName.readOnly = false;
  addMonth.disabled = false;
  addStatus.textContent = "";
  addForm.reset();
  addRecurring.checked = false;
  addCategoryName.required = false;
  addName.required = false;
  addItemSelect.required = false;
  addOptions.open = false;
  submitItemButton.disabled = false;
}

function openUpdateForm(entry) {
  if (!activeFolderId || !getDriveToken()) {
    setWalletMessage("Your session expired. Sign in again to update this item.", true);
    return;
  }
  if (entry.group === "Saving" || entry.month < currentMonth) return;
  closeSavingSettings();

  addForm.reset();
  editingEntry = { ...entry };
  addHeading.textContent = "Update item";
  submitItemButton.textContent = "Update";
  populateCategoryChoices();
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
  syncItemChoice();
  fillPrivateMeta(entry.meta);
  addRecurring.checked = entry.group === "Bills" && entry.recurring === true;
  deleteItemButton.hidden = false;
  const paid = entry.group !== "IN" && entry.paid > 0;
  deleteItemButton.disabled = paid;
  deleteItemButton.title = paid ? "Paid items can't be deleted" : "Delete item";
  addStatus.textContent = paid ? "Paid items can't be deleted." : "";
  addPanel.hidden = false;
  addAmount.focus();
}

function closeSavingSettings() {
  savingsPanel.hidden = true;
  editingSavings = null;
  savingsStatus.textContent = "";
}

function openSavingSettings(entry) {
  if (!activeFolderId || !getDriveToken()) return;
  const latest = entriesForMonth(walletEntries, currentMonth).Saving
    .find(value => value.item === entry.item);
  if (!latest) {
    setWalletMessage("Savings item not found. Press Refresh.", true);
    return;
  }
  closeAddPanel();
  editingSavings = { ...latest };
  savingsName.textContent = latest.item;
  savingsAccessible.checked = latest.meta?.access === "accessible";
  savingsMonthlyTarget.value = String(latest.meta?.monthlySaving || 0);
  savingsAdjustable.checked = latest.meta?.adjustableSaving === true;
  savingsNote.value = latest.meta?.note || "";
  savingsStatus.textContent = "";
  savingsPanel.hidden = false;
  savingsAccessible.focus();
}

savingsCancel.addEventListener("click", closeSavingSettings);
savingsForm.addEventListener("submit", async event => {
  event.preventDefault();
  const previous = editingSavings;
  if (!previous || !activeFolderId || !getDriveToken()) return;
  const version = connectionVersion;
  savingsSave.disabled = true;
  savingsCancel.disabled = true;
  savingsStatus.textContent = "";
  try {
    await saveSavingSettings(getDriveToken(), activeFolderId, previous, {
      access: savingsAccessible.checked ? "accessible" : "protected",
      note: savingsNote.value,
      monthlySaving: savingsMonthlyTarget.value,
      adjustableSaving: savingsAdjustable.checked
    });
    if (version !== connectionVersion) return;
    closeSavingSettings();
    await loadWalletRecords("Refreshing...");
  } catch (error) {
    if (version === connectionVersion) savingsStatus.textContent =
      error.message || "Couldn't save. Try again.";
  } finally {
    savingsSave.disabled = false;
    savingsCancel.disabled = false;
  }
});

walletSetupButton.addEventListener("click", () => {
  if (!activeFolderId || !getDriveToken() || walletSetupButton.disabled) return;
  walletSetupFile.click();
});

walletSetupFile.addEventListener("change", async () => {
  const file = walletSetupFile.files?.[0];
  if (!file) return;
  const version = connectionVersion;
  const folderId = activeFolderId;
  const token = getDriveToken();
  let progressTicket = null;
  let started = false;
  try {
    if (!folderId || !token) throw new Error("Sign in again.");
    if (file.size > 100 * 1024) throw new Error("Setup file is too large.");
    const source = validateSetupPayload(JSON.parse(await file.text()));
    if (version !== connectionVersion) return;
    if (!await confirmWallet("Import November setup?")) return;
    if (version !== connectionVersion || !getDriveToken()) return;

    started = true;
    walletSetupButton.disabled = true;
    addButton.disabled = true;
    refreshButton.disabled = true;
    otherMonthsButton.disabled = true;
    progressTicket = beginWalletProgress("Importing...");
    const result = await importWalletSetup(token, folderId, source, (done,total) => {
      if (version === connectionVersion) {
        walletProgressText.textContent = "Importing " + done + " / " + total;
      }
    });
    if (version !== connectionVersion) return;
    await loadWalletRecords("Refreshing...");
    if (walletBalanceReady) {
      setWalletMessage("Import complete. " +
        (result.created + result.updated) + " items saved.");
    }
  } catch (error) {
    if (version === connectionVersion) {
      setWalletMessage(
        (error instanceof SyntaxError ? "Invalid setup file." :
          error.message || "Import stopped.") +
        (started ? " Select the file again to resume." : ""), true
      );
    }
  } finally {
    walletSetupFile.value = "";
    if (progressTicket !== null) finishWalletProgress(progressTicket);
    if (version === connectionVersion) {
      walletSetupButton.disabled = !activeFolderId;
      addButton.disabled = !activeFolderId;
      refreshButton.disabled = false;
      otherMonthsButton.disabled = !activeFolderId;
    }
  }
});

addButton.addEventListener("click", () => {
  if (!activeFolderId || !getDriveToken()) {
    setWalletMessage("Please sign in again to add an item.", true);
    return;
  }
  closeAddPanel();
  savingsPanel.hidden = true;
  editingSavings = null;
  populateCategoryChoices();
  addGroup.value = "IN";
  lastAddGroup = "IN";
  addMonth.min = currentMonth.slice(0, 4) + "-" + currentMonth.slice(4);
  addMonth.value = selectedMonth.slice(0, 4) + "-" + selectedMonth.slice(4);
  updateOptionalFields();
  addStatus.textContent = "";
  addPanel.hidden = false;
  if (addNameField.hidden) addItemSelect.focus();
  else addName.focus();
});

addGroup.addEventListener("change", async () => {
  if (addGroup.value === "Withdraw") {
    const accepted = await confirmWallet("Are you sure?");
    if (!accepted) {
      addGroup.value = lastAddGroup;
      updateOptionalFields();
      return;
    }
    withdrawApproved = true;
  } else {
    withdrawApproved = false;
  }
  lastAddGroup = addGroup.value;
  updateOptionalFields();
});
addCategoryName.addEventListener("change", () => {
  if (addGroup.value === NEW_CATEGORY) populateItemChoices();
});
addItemSelect.addEventListener("change", syncItemChoice);
cancelItemButton.addEventListener("click", closeAddPanel);

deleteItemButton.addEventListener("click", async () => {
  const previous = editingEntry;
  if (!previous || deleteItemButton.disabled) return;
  if (!activeFolderId || !getDriveToken()) {
    addStatus.textContent = "Your session has expired. Please sign in again.";
    return;
  }
  if (previous.group === "Saving" || previous.month < currentMonth) return;

  const confirmed = await confirmWallet("Are you sure?");
  if (!confirmed) return;

  const version = connectionVersion;
  const folderId = activeFolderId;
  const token = getDriveToken();
  deleteItemButton.disabled = true;
  submitItemButton.disabled = true;
  cancelItemButton.disabled = true;
  addButton.disabled = true;
  otherMonthsButton.disabled = true;
  refreshButton.disabled = true;
  addStatus.textContent = "";
  setItemProgress("Deleting...");

  try {
    const result = await deleteWalletItem(token, folderId, previous);
    if (version !== connectionVersion) return;
    expandedGroups.set(result.group, true);
    comparisonGroups.set(result.group, true);
    closeAddPanel();
    await loadWalletRecords("Refreshing your list...");
  } catch (error) {
    if (version === connectionVersion) {
      addStatus.textContent = error.message || "Couldn't delete this item. Please try again.";
    }
  } finally {
    if (version === connectionVersion) {
      setItemProgress();
      deleteItemButton.disabled = Boolean(editingEntry && editingEntry.group !== "IN" &&
        editingEntry.paid > 0);
      submitItemButton.disabled = false;
      cancelItemButton.disabled = false;
      addButton.disabled = !activeFolderId;
      otherMonthsButton.disabled = !activeFolderId;
      refreshButton.disabled = false;
    }
  }
});

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
  deleteItemButton.disabled = true;
  addButton.disabled = true;
  refreshButton.disabled = true;
  addStatus.textContent = "";
  setItemProgress(previous ? "Updating your item..." : "Saving your item...");

  try {
    const group = previous ? previous.group : activeAddCategory();
    const item = enteredItemName();
    let result;
    if (group === "Withdraw") {
      if (!withdrawApproved) throw new Error("Select Withdraw again.");
      const savings = entriesForMonth(walletEntries, currentMonth).Saving
        .find(value => value.item === item);
      if (!savings) throw new Error("Select accessible savings.");
      result = await withdrawSavingItem(getDriveToken(), activeFolderId, {
        item, previous: savings, amount: addAmount.value, remark: addRemark.value
      });
    } else {
      if (addGroup.value === NEW_CATEGORY && !isCustomGroup(group)) {
        throw new Error("Enter a valid category.");
      }
      const payload = {
        group, item,
        month: previous ? previous.month : addMonth.value.replace("-", ""),
        amount: addAmount.value,
        retail: addRetail.value,
        url: addUrl.value,
        remark: addRemark.value,
        recurring: group === "Bills" && addRecurring.checked,
        meta: enteredPrivateMeta(group, item)
      };
      result = previous
        ? await updateWalletItem(getDriveToken(), activeFolderId, { ...payload, previous })
        : await addWalletItem(getDriveToken(), activeFolderId, payload);
    }
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
      deleteItemButton.disabled = Boolean(editingEntry && editingEntry.group !== "IN" &&
        editingEntry.paid > 0);
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
// Resize the floating window independently of the page, with its table
// flowing in the available width via CSS container queries.
function resizeOtherMonthsTo(width, height) {
  const maxWidth = Math.max(0, window.innerWidth - 16);
  const maxHeight = Math.max(0, window.innerHeight - 16);
  const minWidth = Math.min(288, maxWidth);
  const minHeight = Math.min(240, maxHeight);
  const newWidth = Math.max(minWidth, Math.min(width, maxWidth));
  const newHeight = Math.max(minHeight, Math.min(height, maxHeight));
  const position = otherMonthsWindow.getBoundingClientRect();

  otherMonthsWindow.style.width = newWidth + "px";
  otherMonthsWindow.style.height = newHeight + "px";
  moveOtherMonthsTo(
    Math.min(position.left, Math.max(8, window.innerWidth - newWidth - 8)),
    Math.min(position.top, Math.max(8, window.innerHeight - newHeight - 8))
  );
}

let resizingOtherMonths = null;
otherMonthsResizeHandle.addEventListener("pointerdown", event => {
  if (event.button !== 0 || otherMonthsWindow.hidden) return;
  const rect = otherMonthsWindow.getBoundingClientRect();
  resizingOtherMonths = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    width: rect.width,
    height: rect.height
  };
  otherMonthsResizeHandle.setPointerCapture(event.pointerId);
  event.preventDefault();
});
otherMonthsResizeHandle.addEventListener("pointermove", event => {
  if (!resizingOtherMonths || event.pointerId !== resizingOtherMonths.pointerId) return;
  resizeOtherMonthsTo(
    resizingOtherMonths.width + event.clientX - resizingOtherMonths.x,
    resizingOtherMonths.height + event.clientY - resizingOtherMonths.y
  );
});
function stopOtherMonthsResize(event) {
  if (resizingOtherMonths?.pointerId === event.pointerId) resizingOtherMonths = null;
}
otherMonthsResizeHandle.addEventListener("pointerup", stopOtherMonthsResize);
otherMonthsResizeHandle.addEventListener("pointercancel", stopOtherMonthsResize);
otherMonthsResizeHandle.addEventListener("keydown", event => {
  const step = event.shiftKey ? 50 : 20;
  const sizes = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step]
  };
  const delta = sizes[event.key];
  if (!delta || otherMonthsWindow.hidden) return;
  const rect = otherMonthsWindow.getBoundingClientRect();
  resizeOtherMonthsTo(rect.width + delta[0], rect.height + delta[1]);
  event.preventDefault();
});

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
  if (otherMonthsWindow.hidden) return;
  const rect = otherMonthsWindow.getBoundingClientRect();
  resizeOtherMonthsTo(rect.width, rect.height);
});

refreshButton.addEventListener("click", () => {
  if (activeFolderId) {
    void loadWalletRecords();
    if (anyWonView()) void refreshCurrencyRate();
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
