import { isExpenseGroup } from "./groups.js";

const MONTH = /^(?:19|20|21)\d{2}(?:0[1-9]|1[0-2])$/;
const AMOUNT = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
export const CARRY_START_MONTH = "202611";

export function paymentLine(info) {
  const { group, item, originMonth, paidMonth, amount } = info || {};
  if (!isExpenseGroup(group) || typeof item !== "string" || !item ||
      item.length > 120 || /[\t\r\n\x00-\x1f]/.test(item) ||
      !MONTH.test(originMonth) || !MONTH.test(paidMonth) ||
      originMonth >= paidMonth || paidMonth < CARRY_START_MONTH ||
      !Number.isFinite(amount) || amount <= 0 ||
      !AMOUNT.test(String(amount)) ||
      !Number.isSafeInteger(Math.round(amount * 100))) {
    throw new Error("Invalid overdue payment.");
  }
  return ["@PAY",group,item,originMonth,paidMonth,amount.toFixed(2)].join("\t") + "\n";
}

export function parsePaymentLine(line) {
  if (typeof line !== "string" || !line.startsWith("@PAY\t")) return null;
  const cells = line.replace(/\r$/, "").split("\t");
  if (cells.length !== 6) return null;
  const info = { group:cells[1], item:cells[2],
    originMonth:cells[3],paidMonth:cells[4],amount:Number(cells[5]) };
  try {
    if (paymentLine(info).trim() !== cells.join("\t")) return null;
    return info;
  } catch { return null; }
}

export function effectiveUnpaid(entry, month) {
  if (!isExpenseGroup(entry?.group) || typeof entry.unpaid !== "number" ||
      !Number.isFinite(entry.unpaid) || entry.unpaid < 0) return 0;
  let remaining = Math.round(entry.unpaid * 100);
  for (const p of entry.settlements || []) {
    if (p.paidMonth <= month) remaining -= Math.round(p.amount * 100);
  }
  return Math.max(0,remaining) / 100;
}
