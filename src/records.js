import { parseRecurringDirective } from "./recurring.js";
import { WALLET_GROUPS, isWalletGroup, isExpenseGroup, availableGroups } from "./groups.js";
import { parseMetaLine, metaKey } from "./private-meta.js";

// Pure read-only wallet record parsing. No financial records are stored in GitHub.
// Item TXT lines are tab-separated. Last valid entry for an item/month wins.
// Planning balance uses current saved items only; automatic carry-forward is not enabled yet.

export { WALLET_GROUPS };
const MONTH_RE = /^(?:19|20|21)\d{2}(?:0[1-9]|1[0-2])$/;
const AMOUNT_RE = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;

function safeAmount(value) {
  if (typeof value !== "string" || !AMOUNT_RE.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(Math.round(n * 100)) ? n : null;
}

function parseLine(line) {
  const fields = line.replace(/\r$/, "").split("\t");
  if (fields.length < 4) return null;

  const group = fields[0] === "Other" ? "Others" : fields[0];
  const item = fields[1]?.trim();
  const month = fields[2];
  if (!isWalletGroup(group) || !item || item.length > 180 ||
      !MONTH_RE.test(month) || /[\u0000-\u001f]/.test(item)) {
    return null;
  }

  // Deletion is an append-only tombstone for ONE group/item/month.
  // It overrides the previous month's snapshot without erasing its history.
  if (fields.length === 4 && fields[3] === "DELETE" &&
      group !== "Saving") {
    return { group, item, month, deleted: true };
  }

  if (group === "IN" && fields.length >= 4) {
    const amount = safeAmount(fields[3]);
    return amount === null ? null : { group, item, month, amount, remark: fields[4] || "" };
  }

  if (group === "Saving" && fields.length >= 6) {
    const added = safeAmount(fields[3]);
    const withdrawn = safeAmount(fields[4]);
    const balance = safeAmount(fields[5]);
    return [added, withdrawn, balance].some(v => v === null)
      ? null : { group, item, month, added, withdrawn, balance, remark: fields[6] || "" };
  }

  if (isExpenseGroup(group) && fields.length >= 6) {
    const amount = safeAmount(fields[3]);
    const paid = safeAmount(fields[4]);
    const unpaid = safeAmount(fields[5]);
    if ([amount, paid, unpaid].some(v => v === null)) return null;
    return group === "Others"
      ? { group, item, month, amount, paid, unpaid,
          retail: fields[6] || "", url: fields[7] || "", remark: fields[8] || "" }
      : { group, item, month, amount, paid, unpaid, remark: fields[6] || "" };
  }

  return null;
}

export function parseWalletFiles(files) {
  if (!Array.isArray(files)) throw new TypeError("Expected wallet TXT files.");
  const byMonth = new Map();
  const repeatRules = new Map();
  const metadata = new Map();
  let validLines = 0;
  let invalidLines = 0;

  // TXT files are sorted by file name. Each later valid row updates the item/month.
  for (const file of files) {
    if (!file || typeof file.content !== "string" ||
        !file.name?.toLowerCase().endsWith(".txt") ||
        file.name.toLowerCase() === "storage-check.txt") continue;

    for (const line of file.content.split("\n")) {
      if (!line.trim()) continue;
      if (line.startsWith("@META\t")) {
        const meta = parseMetaLine(line);
        if (meta) {
          metadata.set(metaKey(meta.group, meta.item), meta);
          validLines++;
        } else {
          invalidLines++;
        }
        continue;
      }
      if (line.startsWith("@RECUR\t")) {
        const rule = parseRecurringDirective(line);
        if (!rule) {
          invalidLines++;
        } else {
          repeatRules.set(rule.item.toLocaleLowerCase("en"), rule.active);
          validLines++;
        }
        continue;
      }
      const entry = parseLine(line);
      if (!entry) {
        invalidLines++;
        continue;
      }
      validLines++;
      const key = JSON.stringify([entry.group, entry.item, entry.month]);
      byMonth.set(key, entry);
    }
  }

  return {
    entries: Array.from(byMonth.values())
      .filter(entry => !entry.deleted)
      .map(entry => ({
        ...entry,
        ...(entry.group === "Bills"
          ? { recurring: repeatRules.get(entry.item.toLocaleLowerCase("en")) === true } : {}),
        meta: metadata.get(metaKey(entry.group, entry.item)) || null
      })),
    validLines, invalidLines
  };
}

export function entriesForMonth(allEntries, month) {
  if (!MONTH_RE.test(month)) throw new Error("Invalid month.");
  const groupList = availableGroups(allEntries);
  const groups = Object.fromEntries(groupList.map(group => [group, []]));
  const latestSavings = new Map();

  for (const entry of allEntries) {
    if (entry.group === "Saving" && entry.month <= month) {
      const key = entry.item;
      if (!latestSavings.has(key) || latestSavings.get(key).month < entry.month) {
        latestSavings.set(key, entry);
      }
    } else if (entry.month === month && entry.group !== "Saving" && groups[entry.group]) {
      groups[entry.group].push(entry);
    }
  }

  groups.Saving = [...latestSavings.values()];
  for (const group of groupList) {
    groups[group].sort((a, b) => a.item.localeCompare(b.item));
  }
  return groups;
}

// Monthly planning estimate, not an actual bank balance.
// A = this month's IN; B = this month's Bills + Others + this month's
// recorded savings additions. Carry-forward amounts will be included when
// that separate workflow is implemented; never assume unrecorded carry.
export function calculateMonthlyBalance(allEntries, month) {
  const groups = entriesForMonth(allEntries, month);
  const sumCents = (items, field) => items.reduce((sum, item) => {
    const amount = item[field];
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error("Could not calculate the monthly balance.");
    }
    const cents = Math.round(amount * 100);
    if (!Number.isSafeInteger(cents) || !Number.isSafeInteger(sum + cents)) {
      throw new Error("The monthly amount is too large to calculate safely.");
    }
    return sum + cents;
  }, 0);

  const income = sumCents(groups.IN, "amount");
  const bills = sumCents(groups.Bills, "amount");
  const others = sumCents(groups.Others, "amount");
  const custom = availableGroups(allEntries).filter(isExpenseGroup)
    .filter(group => group !== "Bills" && group !== "Others")
    .reduce((total, group) => total + sumCents(groups[group], "amount"), 0);
  if (!Number.isSafeInteger(custom)) throw new Error("Balance exceeds the safe limit.");
  // entriesForMonth carries the last savings balance forward for display.
  // Never count that balance or historical additions as this month's cost.
  const currentSavings = groups.Saving.filter(entry => entry.month === month);
  const saving = sumCents(currentSavings, "added");
  const totalExpenses = bills + others + saving + custom;
  if (!Number.isSafeInteger(totalExpenses) ||
      !Number.isSafeInteger(income - totalExpenses)) {
    throw new Error("The monthly balance could not be calculated safely.");
  }
  return (income - totalExpenses) / 100;
}

export function monthKey(date) {
  return String(date.getFullYear()) + String(date.getMonth() + 1).padStart(2, "0");
}

export function shiftedMonthKey(month, offset) {
  if (!MONTH_RE.test(month) || !Number.isInteger(offset)) throw new Error("Invalid month.");
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(4, 6)) - 1;
  return monthKey(new Date(year, monthIndex + offset, 1));
}

export function formatMonth(month) {
  if (!MONTH_RE.test(month)) throw new Error("Invalid month.");
  return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric" })
    .format(new Date(Number(month.slice(0, 4)), Number(month.slice(4, 6)) - 1, 1));
}

export function formatAmount(value) {
  if (!Number.isFinite(value)) return "—";
  // Remove trailing .00 in the UI, while keeping meaningful cents.
  // TXT log values retain their original two-decimal precision.
  return new Intl.NumberFormat("en-MY", {
    useGrouping: false,
    minimumFractionDigits: 0, maximumFractionDigits: 2
  }).format(value);
}
