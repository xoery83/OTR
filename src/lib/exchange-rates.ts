import { normalizeCurrencyCode } from "@/lib/currencies";

export type ExchangeRateResult = {
  rate: number;
  date: string;
  source: string;
};

const fallbackRatesToNzd: Record<string, number> = {
  NZD: 1,
  AUD: 1.09,
  USD: 1.68,
  CAD: 1.23,
  EUR: 1.93,
  GBP: 2.25,
  CHF: 2.07,
  CNY: 0.229,
  JPY: 0.0115,
  KRW: 0.0012,
  SGD: 1.31,
  HKD: 0.215,
  TWD: 0.052,
  THB: 0.052,
  MYR: 0.36,
  IDR: 0.000103,
  PHP: 0.029,
  VND: 0.000064,
  INR: 0.0196,
  AED: 0.458,
  SAR: 0.448,
  QAR: 0.461,
  TRY: 0.052,
  DKK: 0.258,
  SEK: 0.174,
  NOK: 0.165,
  ISK: 0.014,
  PLN: 0.454,
  CZK: 0.078,
  HUF: 0.0048,
  MXN: 0.091,
  BRL: 0.306,
  ZAR: 0.092,
  EGP: 0.035,
};

export async function getApproxExchangeRate(
  fromCurrency: string,
  toCurrency: string,
): Promise<ExchangeRateResult> {
  const from = normalizeCurrencyCode(fromCurrency);
  const to = normalizeCurrencyCode(toCurrency);

  if (!from || !to || from === to) {
    return {
      rate: 1,
      date: new Date().toISOString().slice(0, 10),
      source: "same_currency",
    };
  }

  function fallbackRate() {
    if (to === "NZD" && fallbackRatesToNzd[from]) {
      return fallbackRatesToNzd[from];
    }

    if (from === "NZD" && fallbackRatesToNzd[to]) {
      return 1 / fallbackRatesToNzd[to];
    }

    if (fallbackRatesToNzd[from] && fallbackRatesToNzd[to]) {
      return fallbackRatesToNzd[from] / fallbackRatesToNzd[to];
    }

    return null;
  }

  try {
    const response = await fetch(
      `https://api.frankfurter.app/latest?from=${encodeURIComponent(
        from,
      )}&to=${encodeURIComponent(to)}`,
    );

    if (!response.ok) {
      throw new Error("Could not load exchange rate.");
    }

    const data = (await response.json()) as {
      date?: string;
      rates?: Record<string, number>;
    };
    const rate = data.rates?.[to];

    if (!rate) {
      throw new Error("Exchange rate is not available.");
    }

    return {
      rate,
      date: data.date ?? new Date().toISOString().slice(0, 10),
      source: "frankfurter",
    };
  } catch {
    const rate = fallbackRate();

    if (!rate) {
      throw new Error(`Exchange rate is not available for ${from} to ${to}.`);
    }

    return {
      rate,
      date: new Date().toISOString().slice(0, 10),
      source: "fallback_estimate",
    };
  }
}
