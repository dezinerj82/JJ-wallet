// Private Bills-only monthly recurrence. No amounts or rules are stored on GitHub.
// @RECUR directives live inside each app-owned item's private TXT history.
const DIRECTIVE = "@RECUR";
const MONTH_RE = /^(?:19|20|21)\d{2}(?:0[1-9]|1[0-2])$/;
const AMOUNT_RE = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;

function cleanText(text, max) {
  return typeof text === "string" && text.length <= max &&
    !/[\t\r\n\x00-\x1f]/.test(text);
}

export function parseRecurringDirective(line) {
  if (typeof line !== "string") return null;
  const fields = line.replace(/\r$/, "").split("\t");
  if (fields.length !== 7 || fields[0] !== DIRECTIVE ||
      fields[1] !== "Bills" || !cleanText(fields[2], 120) ||
      !fields[2].trim() || !MONTH_RE.test(fields[3]) ||
      !AMOUNT_RE.test(fields[4]) || !cleanText(fields[5], 300) ||
      !["ON", "OFF"].includes(fields[6])) return null;
  const amount = Number(fields[4]);
  if (!Number.isSafeInteger(Math.round(amount * 100))) return null;
  return {
    item: fields[2], month: fields[3], amount,
    remark: fields[5], active: fields[6] === "ON"
  };
}

export function recurringDirectiveLine(rule, active) {
  const month = String(rule?.month || "");
  const item = String(rule?.item || "");
  const remark = String(rule?.remark || "");
  const rawAmount = String(rule?.amount ?? "");
  if (!cleanText(item, 120) || !item.trim() ||
      !MONTH_RE.test(month) || !AMOUNT_RE.test(rawAmount) ||
      !Number.isSafeInteger(Math.round(Number(rawAmount) * 100)) ||
      !cleanText(remark, 300)) {
    throw new Error("Invalid recurring bill.");
  }
  return [DIRECTIVE, "Bills", item, month,
    Number(rawAmount).toFixed(2), remark, active ? "ON" : "OFF"].join("\t") + "\n";
}

export function latestRecurringRule(content, item) {
  if (typeof content !== "string") return null;
  let rule = null;
  for (const line of content.split("\n")) {
    if (!line.startsWith(DIRECTIVE + "\t")) continue;
    const parsed = parseRecurringDirective(line);
    if (parsed && parsed.item.toLocaleLowerCase("en") ===
        String(item).toLocaleLowerCase("en")) rule = parsed;
  }
  return rule;
}

// Initial window: 2026–27. From June 2027, add 2028–29.
// From June 2029 add 2030–31, and so on every two years.
export function recurringHorizon(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (year < 2027 || (year === 2027 && month < 6)) return "202712";
  const cycle = Math.max(0, Math.floor(
    (year - 2027 - (month < 6 ? 1 : 0)) / 2
  ));
  const lastYear = Math.min(2199, 2029 + 2 * cycle);
  return String(lastYear) + "12";
}

export function recurringMonthsDue(content, rule, now = new Date()) {
  if (!rule?.active) return [];
  const cutoff = recurringHorizon(now);
  const current = String(now.getFullYear()) +
    String(now.getMonth() + 1).padStart(2, "0");
  const start = [current, rule.month].sort().at(-1);
  if (start > cutoff) return [];

  // Any earlier snapshot, edit or DELETE tombstone blocks regeneration.
  const seen = new Set();
  for (const line of content.split("\n")) {
    const fields = line.replace(/\r$/, "").split("\t");
    if (fields[0] === "Bills" &&
        String(fields[1] || "").toLocaleLowerCase("en") ===
          rule.item.toLocaleLowerCase("en") && MONTH_RE.test(fields[2])) {
      seen.add(fields[2]);
    }
  }
  const due = [];
  const startYear = Number(start.slice(0, 4));
  const endYear = Number(cutoff.slice(0, 4));
  for (let year = startYear; year <= endYear; year++) {
    for (let m = 1; m <= 12; m++) {
      const key = String(year) + String(m).padStart(2, "0");
      if (key >= start && key <= cutoff && !seen.has(key)) due.push(key);
    }
  }
  return due;
}

export function recurringBillLine(rule, month) {
  if (!rule?.active || !MONTH_RE.test(month) || !cleanText(rule.item, 120) ||
      !rule.item.trim() || !Number.isFinite(rule.amount) || rule.amount < 0 ||
      !Number.isSafeInteger(Math.round(rule.amount * 100)) ||
      !cleanText(rule.remark, 300)) throw new Error("Invalid recurring bill.");
  const money = rule.amount.toFixed(2);
  const fields = ["Bills", rule.item, month, money, "0.00", money];
  if (rule.remark) fields.push(rule.remark);
  return fields.join("\t") + "\n";
}
