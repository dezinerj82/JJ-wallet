// Display-only currency conversion. Wallet records remain in MYR.
// Only the currency code is sent to the public rate provider; never item names or amounts.
const RATE_ENDPOINT = "https://open.er-api.com/v6/latest/MYR";
const SESSION_RATE_KEY = "home-wallet-myr-krw-reference-v1";
const MIN_REQUEST_GAP_MS = 60 * 60 * 1000;

let cachedRate = null;
let pendingRate = null;

function isValidRate(value) {
  return !!value &&
    Number.isFinite(value.rate) && value.rate > 0 &&
    Number.isFinite(value.updatedAt) && value.updatedAt > 0 &&
    Number.isFinite(value.expiresAt) &&
    value.expiresAt > Date.now() &&
    value.expiresAt <= Date.now() + 48 * 60 * 60 * 1000;
}

function restoreReferenceRate() {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_RATE_KEY) || "null");
    return isValidRate(value) ? value : null;
  } catch {
    return null;
  }
}

// Latest published MYR/KRW reference rate, refreshed when the next daily rate
// is expected. Never use a fixed rate, a guessed fallback or a user-entered amount.
export async function getMyrKrwRate() {
  if (isValidRate(cachedRate)) return cachedRate;
  const restored = restoreReferenceRate();
  if (restored) {
    cachedRate = restored;
    return restored;
  }
  if (pendingRate) return pendingRate;

  pendingRate = (async () => {
    let response;
    try {
      response = await fetch(RATE_ENDPOINT, { cache: "no-store", mode: "cors" });
    } catch {
      throw new Error("Couldn't reach the exchange-rate service. Try again.");
    }
    if (!response.ok) {
      throw new Error("The exchange rate isn't available right now. Try again.");
    }

    const data = await response.json();
    const rate = data?.rates?.KRW;
    const updatedAt = Number(data?.time_last_update_unix) * 1000;
    const nextAt = Number(data?.time_next_update_unix) * 1000;
    if (data?.result !== "success" || data?.base_code !== "MYR" ||
        !Number.isFinite(rate) || rate <= 0 ||
        !Number.isFinite(updatedAt) || updatedAt <= 0 ||
        updatedAt > Date.now() + MIN_REQUEST_GAP_MS ||
        !Number.isFinite(nextAt)) {
      throw new Error("Couldn't verify the latest exchange rate. Try again.");
    }
    const now = Date.now();
    const result = {
      rate,
      updatedAt,
      // Respect the daily source update schedule and minimum request interval.
      expiresAt: Math.max(now + MIN_REQUEST_GAP_MS, Math.min(nextAt, now + 26 * 60 * 60 * 1000))
    };
    if (!isValidRate(result)) throw new Error("Couldn't verify the exchange-rate update.");
    cachedRate = result;
    try {
      sessionStorage.setItem(SESSION_RATE_KEY, JSON.stringify(result));
    } catch { /* Reference rates can be used without browser storage. */ }
    return result;
  })().finally(() => { pendingRate = null; });

  return pendingRate;
}

const myrFormatter = new Intl.NumberFormat("en-MY", {
  useGrouping: false,
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});
const krwFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0
});

export function formatWalletCurrency(amount, currency, referenceRate) {
  if (!Number.isFinite(amount)) return "—";
  if (currency === "MYR") return "RM " + myrFormatter.format(amount);
  if (currency === "KRW") {
    if (!referenceRate || !Number.isFinite(referenceRate.rate) || referenceRate.rate <= 0) {
      return "—";
    }
    const converted = amount * referenceRate.rate;
    if (!Number.isFinite(converted) || converted < 0) return "—";
    // KRW display is always rounded UP to the next 100 won.
    const rounded = Math.max(0, Math.ceil(converted / 100 - 1e-10) * 100);
    return Number.isSafeInteger(rounded) ? "₩" + krwFormatter.format(rounded) : "—";
  }
  return "—";
}

export function rateDateLabel(referenceRate) {
  if (!Number.isFinite(referenceRate?.updatedAt)) return "";
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC"
  }).format(new Date(referenceRate.updatedAt));
}
