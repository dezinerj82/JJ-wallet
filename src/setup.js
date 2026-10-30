import { isWalletGroup } from "./groups.js";
import { recurringHorizon } from "./recurring.js";

const MONTH = /^(?:19|20|21)\d{2}(?:0[1-9]|1[0-2])$/;
const SUM = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
const OK_INTERVALS = [1, 3, 6, 12];

function goodName(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 120 &&
    value.trim() === value && !/[\t\r\n\x00-\x1f]/.test(value);
}

function goodMoney(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 &&
    SUM.test(String(value)) && Number.isSafeInteger(Math.round(value * 100));
}

export function itemMarkerLine(group, item) {
  if (!isWalletGroup(group) || !goodName(item)) throw new Error("Invalid item name.");
  return ["@ITEM", group, item].join("\t") + "\n";
}

export function parseItemMarker(line) {
  if (typeof line !== "string") return null;
  const cells = line.replace(/\r$/, "").split("\t");
  return cells.length === 3 && cells[0] === "@ITEM" &&
    isWalletGroup(cells[1]) && goodName(cells[2])
    ? { group: cells[1], item: cells[2] } : null;
}

export function validateSchedule(rule) {
  if (!rule || typeof rule !== "object" ||
      !isWalletGroup(rule.group) || rule.group === "Saving" ||
      !goodName(rule.item) ||
      !["monthly", "annual", "interval"].includes(rule.type) ||
      !MONTH.test(rule.start) || !goodMoney(rule.amount) ||
      ![0,1,2].includes(rule.remindBefore || 0) ||
      typeof rule.active !== "boolean") return false;
  if (rule.end !== undefined && rule.end !== "" &&
      (!MONTH.test(rule.end) || rule.end < rule.start)) return false;
  if (rule.type === "annual") {
    if (!Array.isArray(rule.months) || !rule.months.length ||
        rule.months.length > 12 || !rule.months.every(m => Number.isInteger(m) &&
          m >= 1 && m <= 12) || new Set(rule.months).size !== rule.months.length) return false;
  } else if (rule.months !== undefined && rule.months.length) return false;
  if (rule.type === "interval" &&
      !OK_INTERVALS.includes(rule.interval)) return false;
  if (rule.type !== "interval" && rule.interval !== undefined && rule.interval !== 0) return false;
  if (rule.changes !== undefined && (!Array.isArray(rule.changes) ||
      rule.changes.length > 20 || !rule.changes.every(c =>
        c && MONTH.test(c.from) && c.from >= rule.start && goodMoney(c.amount)))) return false;
  if (rule.alerts !== undefined && (!Array.isArray(rule.alerts) ||
      rule.alerts.length > 10 || !rule.alerts.every(a =>
        a && Number.isInteger(a.month) && a.month >= 1 && a.month <= 12 &&
        Number.isInteger(a.day) && a.day >= 1 && a.day <= 31 &&
        typeof a.text === "string" && a.text.trim() && a.text.length <= 100 &&
        !/[\t\r\n\x00-\x1f]/.test(a.text)))) return false;
  return true;
}

export function scheduleLine(rule) {
  if (!validateSchedule(rule)) throw new Error("Invalid schedule.");
  return "@SCHEDULE\t" + JSON.stringify(rule) + "\n";
}

export function parseScheduleLine(line) {
  if (typeof line !== "string" || !line.startsWith("@SCHEDULE\t")) return null;
  try {
    const rule = JSON.parse(line.slice("@SCHEDULE\t".length).replace(/\r$/, ""));
    return validateSchedule(rule) ? rule : null;
  } catch { return null; }
}

export function lastSchedule(content, group, item) {
  let found = null;
  for (const line of String(content).split("\n")) {
    const rule = parseScheduleLine(line);
    if (rule && rule.group === group &&
        rule.item.toLocaleLowerCase("en") === item.toLocaleLowerCase("en")) {
      found = rule;
    }
  }
  return found;
}

function monthNumber(key) { return Number(key.slice(0,4))*12 + Number(key.slice(4,6))-1; }

export function scheduleApplies(rule, month) {
  if (!rule.active || month < rule.start || (rule.end && month > rule.end)) return false;
  if (rule.type === "monthly") return true;
  if (rule.type === "annual") return rule.months.includes(Number(month.slice(4, 6)));
  return (monthNumber(month) - monthNumber(rule.start)) % rule.interval === 0;
}

export function scheduleAmount(rule, month) {
  let amount = rule.amount;
  for (const change of [...(rule.changes || [])].sort((a,b) => a.from.localeCompare(b.from))) {
    if (month >= change.from) amount = change.amount;
  }
  return amount;
}

export function scheduledMonthsDue(content, rule, now = new Date()) {
  if (!validateSchedule(rule) || !rule.active) return [];
  const current = String(now.getFullYear()) + String(now.getMonth()+1).padStart(2, "0");
  const end = recurringHorizon(now);
  const from = [rule.start, current].sort().at(-1);
  if (from > end) return [];
  // All existing snapshots, including deletes and manually revised amounts,
  // are permanent exclusions. Never reinsert them by automatic scheduling.
  const seen = new Set();
  for (const line of String(content).split("\n")) {
    const cells = line.replace(/\r$/, "").split("\t");
    if (cells[0] === rule.group &&
        (cells[1] || "").toLocaleLowerCase("en") === rule.item.toLocaleLowerCase("en") &&
        MONTH.test(cells[2])) seen.add(cells[2]);
  }
  const due = [];
  for(let y=Number(from.slice(0,4));y<=Number(end.slice(0,4));y++) {
    for(let m=1;m<=12;m++) {
      const key = String(y)+String(m).padStart(2,"0");
      if (key >= from && key <= end && !seen.has(key) &&
          scheduleApplies(rule,key) && scheduleAmount(rule,key)>0) due.push(key);
    }
  }
  return due;
}

export function scheduledRecordLine(rule, month) {
  if (!validateSchedule(rule) || !scheduleApplies(rule, month) ||
      !MONTH.test(month)) throw new Error("Invalid scheduled entry.");
  const amount = scheduleAmount(rule,month);
  if (!goodMoney(amount) || amount === 0) throw new Error("Invalid scheduled amount.");
  const amountText = amount.toFixed(2);
  const fields = [rule.group,rule.item,month,amountText];
  if (rule.group !== "IN") fields.push("0.00",amountText);
  return fields.join("\t")+"\n";
}

export function plannedAlerts(rules, now = new Date()) {
  const currentMonth = String(now.getFullYear()) + String(now.getMonth()+1).padStart(2,"0");
  const day = now.getDate();
  const results = [];
  for (const rule of rules) {
    if (!validateSchedule(rule) || !rule.active) continue;
    if (rule.alerts) for(const alert of rule.alerts) {
      if (alert.month === now.getMonth()+1 && alert.day === day &&
          String(now.getFullYear()) + String(alert.month).padStart(2,"0") >= rule.start) {
        results.push({
          id: rule.group+"|"+rule.item+"|"+now.getFullYear()+"|"+alert.month+"|"+alert.day,
          group: rule.group, item: rule.item, text: alert.text
        });
      }
    }
    if (!rule.remindBefore) continue;
    // Alert once in the exact lead month; missed months are never replayed.
    const lookahead = new Date(now.getFullYear(),now.getMonth()+rule.remindBefore,1);
    const next = String(lookahead.getFullYear())+
      String(lookahead.getMonth()+1).padStart(2,"0");
    if (scheduleApplies(rule,next) && scheduleAmount(rule,next)>0) {
      results.push({ id: rule.group+"|"+rule.item+"|"+next,
        group: rule.group, item: rule.item,
        text: rule.item+" · Due "+new Intl.DateTimeFormat("en-MY",{month:"long",year:"numeric"}).format(lookahead) });
    }
  }
  return results;
}

export function validateSetupPayload(data) {
  if (!data || data.version !== 1 || !MONTH.test(data.month) ||
      !Array.isArray(data.items) || data.items.length < 1 || data.items.length > 100) {
    throw new Error("Invalid setup file.");
  }
  const seen = new Set();
  for (const entry of data.items) {
    if (!entry || !isWalletGroup(entry.group) || !goodName(entry.item)) {
      throw new Error("Invalid setup item.");
    }
    const key = JSON.stringify([entry.group,entry.item.toLocaleLowerCase("en")]);
    if (seen.has(key)) throw new Error("Repeated setup item.");
    seen.add(key);
    if (entry.openingBalance !== undefined &&
        (entry.group !== "Saving" || !goodMoney(entry.openingBalance))) {
      throw new Error("Invalid savings balance.");
    }
    if (entry.record !== undefined) {
      if (!entry.record || entry.group === "Saving" ||
          !MONTH.test(entry.record.month) ||
          entry.record.month < data.month || !goodMoney(entry.record.amount)) {
        throw new Error("Invalid November entry.");
      }
    }
    if (entry.meta !== undefined && (!entry.meta || typeof entry.meta !== "object")) {
      throw new Error("Invalid setup note.");
    }
    if (entry.schedule !== undefined &&
        (!validateSchedule(entry.schedule) || entry.schedule.group !== entry.group ||
          entry.schedule.item !== entry.item)) {
      throw new Error("Invalid setup schedule.");
    }
    if (entry.group === "Saving" && entry.schedule) throw new Error("Invalid saving schedule.");
  }
  return data;
}
