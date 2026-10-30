import { isWalletGroup } from "./groups.js";

// Saved as @META JSON lines inside private item TXT files only.
const PREFIX = "@META\t";
const MONTH = /^(?:19|20|21)\d{2}(?:0[1-9]|1[0-2])$/;

export function validMeta(meta) {
  const target = meta?.monthlySaving ?? 0;
  return !!meta && typeof (meta.hoverUnpaid ?? false) === "boolean" &&
    Number.isFinite(target) && target >= 0 &&
    Number.isSafeInteger(Math.round(target * 100)) &&
    Math.abs(target * 100 - Math.round(target * 100)) < 0.000001 &&
    (meta.group === "Saving" || target === 0) &&
    isWalletGroup(meta.group) &&
    typeof meta.item === "string" && meta.item.trim().length > 0 &&
    meta.item.length <= 120 && !/[\t\r\n]/.test(meta.item) &&
    typeof meta.note === "string" && meta.note.length <= 1600 &&
    ["", "accessible", "protected"].includes(meta.access) &&
    (meta.group === "Saving" || meta.access === "") &&
    (meta.lastService === "" || MONTH.test(meta.lastService)) &&
    [0,3,6,12].includes(meta.interval) &&
    [0,1,2].includes(meta.remindBefore) &&
    (meta.interval > 0) === (meta.lastService !== "") &&
    (meta.interval > 0 || meta.remindBefore === 0);
}

export function buildMeta(group, item, input = {}) {
  const meta = {
    group, item, note: String(input.note || ""),
    lastService: String(input.lastService || ""),
    interval: Number(input.interval || 0),
    remindBefore: Number(input.remindBefore || 0),
    access: group === "Saving" ? String(input.access || "protected") : "",
    monthlySaving: group === "Saving" ? Number(input.monthlySaving || 0) : 0,
    hoverUnpaid: group !== "Saving" && input.hoverUnpaid === true
  };
  if (!validMeta(meta)) throw new Error("Check the item details.");
  return meta;
}

export function metaLine(meta) {
  if (!validMeta(meta)) throw new Error("Check the item details.");
  return PREFIX + JSON.stringify(meta) + "\n";
}

export function parseMetaLine(line) {
  if (typeof line !== "string" || !line.startsWith(PREFIX)) return null;
  try {
    const value = JSON.parse(line.slice(PREFIX.length).replace(/\r$/, ""));
    // Earlier settings predate monthly savings targets; default them to zero.
    if (value && typeof value === "object" && value.monthlySaving === undefined) {
      value.monthlySaving = 0;
    }
    if (value && typeof value === "object" && value.hoverUnpaid === undefined) {
      value.hoverUnpaid = false;
    }
    return validMeta(value) ? value : null;
  } catch {
    return null;
  }
}

export function metaKey(group, item) {
  return JSON.stringify([group, String(item).toLocaleLowerCase("en")]);
}

export function lastMeta(content, group, item) {
  let found = null;
  for (const line of String(content).split("\n")) {
    if (!line.startsWith(PREFIX)) continue;
    const result = parseMetaLine(line);
    if (result && metaKey(result.group, result.item) === metaKey(group, item)) found = result;
  }
  return found;
}

export function parseAllMetadata(files) {
  const byItem = new Map();
  for (const file of files) {
    if (!file?.content || !file.name?.toLowerCase().endsWith(".txt")) continue;
    for (const line of file.content.split("\n")) {
      if (!line.startsWith(PREFIX)) continue;
      const meta = parseMetaLine(line);
      if (meta) byItem.set(metaKey(meta.group, meta.item), meta);
    }
  }
  return byItem;
}

export function effectiveServiceMonth(meta, entries = [], now = new Date()) {
  if (!meta?.lastService) return "";
  const current = String(now.getFullYear()) + String(now.getMonth() + 1).padStart(2, "0");
  let recent = meta.lastService;
  for (const entry of entries) {
    if (entry.group !== meta.group ||
        entry.item.toLocaleLowerCase("en") !== meta.item.toLocaleLowerCase("en") ||
        entry.month > current || entry.month < recent ||
        !Number.isFinite(entry.amount) || entry.amount <= 0 ||
        !Number.isFinite(entry.paid) || entry.paid < entry.amount) continue;
    recent = entry.month;
  }
  return recent;
}

export function serviceReminders(metaMap, entries = [], now = new Date()) {
  const current = now.getFullYear() * 12 + now.getMonth();
  const dueItems = [];
  for (const meta of metaMap.values()) {
    if (!meta.lastService || !meta.interval || !meta.remindBefore) continue;
    if (!entries.some(entry => entry.group === meta.group &&
        entry.item.toLocaleLowerCase("en") ===
          meta.item.toLocaleLowerCase("en"))) continue;
    const serviceMonth = effectiveServiceMonth(meta, entries, now);
    const last = Number(serviceMonth.slice(0,4)) * 12 + Number(serviceMonth.slice(4,6)) - 1;
    let next = last + meta.interval;
    // Skip old reminder windows, including missed service dates.
    while (next <= current) next += meta.interval;
    if (current === next - meta.remindBefore) {
      const date = new Date(Math.floor(next / 12), next % 12, 1);
      const dueMonth = String(date.getFullYear()) + String(date.getMonth() + 1).padStart(2,"0");
      dueItems.push({ group: meta.group, item: meta.item, dueMonth });
    }
  }
  return dueItems.sort((a,b) => a.dueMonth.localeCompare(b.dueMonth));
}
