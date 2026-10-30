export const WALLET_GROUPS = Object.freeze(["IN", "Saving", "Bills", "Others"]);
export const NEW_CATEGORY = "__new_category__";
export const NEW_ITEM = "__new_item__";
export function displayGroup(group) { return group === "IN" ? "Income" : group; }
export function isCustomGroup(group) {
  if (typeof group !== "string" || group.length < 1 || group.length > 50 ||
      group !== group.trim() || group.startsWith("@")) return false;
  if (["in", "income", "saving", "bills", "others", "other", "withdraw"].includes(group.toLowerCase())) return false;
  return /^[\p{L}\p{N}][\p{L}\p{N} _&'().-]*$/u.test(group);
}
export function isWalletGroup(group) { return WALLET_GROUPS.includes(group) || isCustomGroup(group); }
export function isExpenseGroup(group) { return group !== "IN" && group !== "Saving" && isWalletGroup(group); }
export function availableGroups(entries) {
  const extra = new Set();
  for (const entry of entries) if (isCustomGroup(entry.group)) extra.add(entry.group);
  return [...WALLET_GROUPS, ...[...extra].sort((a,b) => a.localeCompare(b))];
}
