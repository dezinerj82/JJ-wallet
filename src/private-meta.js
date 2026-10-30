import { isWalletGroup } from "./groups.js";

// Saved as @META JSON lines inside private item TXT files only.
const PREFIX = "@META\t";
const MONTH = /^(?:19|20|21)\d{2}(?:0[1-9]|1[0-2])$/;

export function validMeta(meta) {
  return !!meta && isWalletGroup(meta.group) &&
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
    access: group === "Saving" ? String(input.access || "protected") : ""
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

export function serviceReminders(metaMap, now = new Date()) {
  const current = now.getFullYear() * 12 + now.getMonth();
  const dueItems = [];
  for (const meta of metaMap.values()) {
    if (!meta.lastService || !meta.interval || !meta.remindBefore) continue;
    const last = Number(meta.lastService.slice(0,4)) * 12 + Number(meta.lastService.slice(4,6)) - 1;
    const next = last + meta.interval;
    if (current >= next - meta.remindBefore) {
      const date = new Date(Math.floor(next / 12), next % 12, 1);
      const dueMonth = String(date.getFullYear()) + String(date.getMonth() + 1).padStart(2,"0");
      dueItems.push({ group: meta.group, item: meta.item, dueMonth });
    }
  }
  return dueItems.sort((a,b) => a.dueMonth.localeCompare(b.dueMonth));
}
