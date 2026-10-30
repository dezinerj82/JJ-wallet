import { parseRecurringDirective } from "./recurring.js";
import { WALLET_GROUPS, isWalletGroup, isExpenseGroup, availableGroups } from "./groups.js";
import { parseMetaLine, metaKey } from "./private-meta.js";
import { parseItemMarker, parseScheduleLine } from "./setup.js";

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
  const directory = new Map();
  const schedules = new Map();
  let validLines = 0;
  let invalidLines = 0;

  // TXT files are sorted by file name. Each later valid row updates the item/month.
  for (const file of files) {
    if (!file || typeof file.content !== "string" ||
        !file.name?.toLowerCase().endsWith(".txt") ||
        file.name.toLowerCase() === "storage-check.txt") continue;

    for (const line of file.content.split("\n")) {
      if (!line.trim()) continue;
      if (line.startsWith("@ITEM\t")) {
        const found = parseItemMarker(line);
        if (found) {
          directory.set(metaKey(found.group, found.item), found);
          validLines++;
        } else invalidLines++;
        continue;
      }
      if (line.startsWith("@SCHEDULE\t")) {
        const found = parseScheduleLine(line);
        if (found) {
          schedules.set(metaKey(found.group, found.item), found);
          validLines++;
        } else invalidLines++;
        continue;
      }
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
      directory.set(metaKey(entry.group, entry.item), {
        group: entry.group, item: entry.item
      });
    }
  }

  const active = Array.from(byMonth.values()).filter(entry => !entry.deleted);
  // A savings target can exist even when its confirmed balance is unknown.
  // Display the target with an unknown balance, never an invented RM0 record.
  for (const found of directory.values()) {
    if (found.group !== "Saving" || active.some(entry =>
      entry.group === "Saving" && entry.item.toLocaleLowerCase("en") ===
        found.item.toLocaleLowerCase("en"))) continue;
    const details = metadata.get(metaKey(found.group, found.item));
    active.push({
      group:"Saving", item: found.item, month:"190001",
      added:0, withdrawn:0, balance:details?.openingBalance ?? null,
      remark:"", catalogOnly:true
    });
  }
  return {
    entries: active.map(entry => ({
      ...entry,
      ...(entry.group === "Bills"
        ? { recurring: repeatRules.get(entry.item.toLocaleLowerCase("en")) === true } : {}),
      scheduled: schedules.get(metaKey(entry.group, entry.item))?.active === true,
      meta: metadata.get(metaKey(entry.group, entry.item)) || null
    })),
    catalog: [...directory.values()],
    schedules: [...schedules.values()],
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

// Savings targets are plans, never recorded deposits. Bills and already saved
// amounts remain untouched. Reduce only still-uncommitted monthly targets.
export function calculateMonthlyPlan(allEntries, month) {
  const groups = entriesForMonth(allEntries, month);
  function cents(value) {
    if (!Number.isFinite(value) || value < 0 ||
        !Number.isSafeInteger(Math.round(value * 100))) {
      throw new Error("Invalid wallet amount.");
    }
    return Math.round(value * 100);
  }
  function sum(items, field) {
    return items.reduce((total, item) => {
      const next = total + cents(item[field]);
      if (!Number.isSafeInteger(next)) throw new Error("Monthly total is too large.");
      return next;
    }, 0);
  }

  const income = sum(groups.IN, "amount");
  const expenses = availableGroups(allEntries)
    .filter(isExpenseGroup)
    .reduce((total, group) => {
      const next = total + sum(groups[group], "amount");
      if (!Number.isSafeInteger(next)) throw new Error("Monthly total is too large.");
      return next;
    }, 0);
  const committedSavings = sum(groups.Saving.filter(e => e.month === month), "added");
  const committedSpending = expenses + committedSavings;
  if (!Number.isSafeInteger(committedSpending)) {
    throw new Error("Monthly commitments are too large.");
  }

  // A current-month savings snapshot already exists in the private ledger.
  // Treat it as committed and never overwrite or plan a second allocation.
  const targets = groups.Saving
    .filter(e => e.month !== month && (e.meta?.monthlySaving || 0) > 0)
    .map(e => ({ item: e.item, targetCents: cents(e.meta.monthlySaving) }))
    .sort((a, b) => a.item.localeCompare(b.item));
  let requested = 0;
  for (const target of targets) {
    requested += target.targetCents;
    if (!Number.isSafeInteger(requested)) throw new Error("Savings plan is too large.");
  }

  const available = Math.max(0, income - committedSpending);
  const budget = Math.min(available, requested);
  const savingPlans = new Map();
  if (requested > 0) {
    // Exact integer-cent pro-rata allocation, with deterministic remainder
    // distribution; total allocations never exceed the available income.
    const parts = targets.map(target => {
      const numerator = BigInt(target.targetCents) * BigInt(budget);
      const denominator = BigInt(requested);
      return {
        ...target,
        allocated: Number(numerator / denominator),
        remainder: numerator % denominator
      };
    });
    const used = parts.reduce((total, part) => total + part.allocated, 0);
    let leftovers = budget - used;
    const byRemainder = [...parts].sort((a, b) =>
      a.remainder === b.remainder
        ? a.item.localeCompare(b.item)
        : a.remainder > b.remainder ? -1 : 1
    );
    for (const part of byRemainder) {
      if (leftovers <= 0) break;
      part.allocated += 1;
      leftovers--;
    }
    for (const part of parts) {
      savingPlans.set(part.item, {
        requested: part.targetCents / 100,
        amount: part.allocated / 100,
        adjusted: part.allocated < part.targetCents
      });
    }
  }

  const remainingCents = income - committedSpending - budget;
  if (!Number.isSafeInteger(remainingCents)) {
    throw new Error("Monthly balance is too large.");
  }
  return {
    income: income / 100,
    expenses: expenses / 100,
    committedSavings: committedSavings / 100,
    requestedSavings: requested / 100,
    plannedSavings: budget / 100,
    balance: remainingCents / 100,
    savingPlans,
    savingsAdjusted: budget < requested,
    insufficientForBills: income < committedSpending
  };
}

export function calculateMonthlyBalance(allEntries, month) {
  return calculateMonthlyPlan(allEntries, month).balance;
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
