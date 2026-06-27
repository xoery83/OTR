export type ExchangeRateResult = {
  rate: number;
  date: string;
  source: string;
};

const fallbackRatesToNzd: Record<string, number> = {
  NZD: 1,
  ISK: 0.014,
  DKK: 0.258,
  EUR: 1.93,
  CNY: 0.229,
  RMB: 0.229,
  USD: 1.68,
  GBP: 2.25,
  AUD: 1.09,
  CHF: 2.07,
};

export async function getApproxExchangeRate(
  fromCurrency: string,
  toCurrency: string,
): Promise<ExchangeRateResult> {
  const from = fromCurrency.trim().toUpperCase();
  const to = toCurrency.trim().toUpperCase();

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
  } catch (error) {
    const rate = fallbackRate();

    if (!rate) {
      throw error;
    }

    return {
      rate,
      date: new Date().toISOString().slice(0, 10),
      source: "fallback_estimate",
    };
  }
}
