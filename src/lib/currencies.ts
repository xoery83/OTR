export type CurrencyDefinition = {
  code: string;
  name: string;
  zhName: string;
  symbol?: string;
  aliases: string[];
  countries: string[];
};

export const currencyDefinitions: CurrencyDefinition[] = [
  { code: "NZD", name: "New Zealand Dollar", zhName: "新西兰元", symbol: "NZ$", aliases: ["nzd", "nz", "new zealand", "纽币", "新西兰", "新西兰元"], countries: ["new zealand", "nz", "auckland", "queenstown", "新西兰"] },
  { code: "AUD", name: "Australian Dollar", zhName: "澳大利亚元", symbol: "A$", aliases: ["aud", "australia", "澳币", "澳元", "澳大利亚"], countries: ["australia", "sydney", "melbourne", "澳大利亚", "澳洲"] },
  { code: "USD", name: "US Dollar", zhName: "美元", symbol: "$", aliases: ["usd", "us dollar", "dollar", "美元", "美金"], countries: ["united states", "usa", "america", "美国", "夏威夷", "纽约", "洛杉矶"] },
  { code: "CAD", name: "Canadian Dollar", zhName: "加拿大元", symbol: "C$", aliases: ["cad", "canadian", "加币", "加拿大元"], countries: ["canada", "vancouver", "toronto", "加拿大"] },
  { code: "EUR", name: "Euro", zhName: "欧元", symbol: "€", aliases: ["eur", "euro", "eu", "欧元"], countries: ["france", "germany", "italy", "spain", "netherlands", "belgium", "austria", "ireland", "finland", "portugal", "greece", "法国", "德国", "意大利", "西班牙", "荷兰", "比利时", "奥地利", "希腊", "葡萄牙"] },
  { code: "GBP", name: "British Pound", zhName: "英镑", symbol: "£", aliases: ["gbp", "pound", "sterling", "英镑"], countries: ["united kingdom", "uk", "england", "scotland", "london", "英国", "伦敦", "苏格兰"] },
  { code: "CHF", name: "Swiss Franc", zhName: "瑞士法郎", symbol: "CHF", aliases: ["chf", "swiss", "franc", "瑞郎", "瑞士法郎"], countries: ["switzerland", "zurich", "geneva", "瑞士"] },
  { code: "CNY", name: "Chinese Yuan", zhName: "人民币", symbol: "¥", aliases: ["cny", "rmb", "yuan", "人民币", "元", "块"], countries: ["china", "beijing", "shanghai", "中国", "北京", "上海"] },
  { code: "JPY", name: "Japanese Yen", zhName: "日元", symbol: "¥", aliases: ["jpy", "yen", "日元", "円"], countries: ["japan", "tokyo", "osaka", "日本", "东京", "大阪"] },
  { code: "KRW", name: "South Korean Won", zhName: "韩元", symbol: "₩", aliases: ["krw", "won", "韩元"], countries: ["south korea", "korea", "seoul", "韩国", "首尔"] },
  { code: "SGD", name: "Singapore Dollar", zhName: "新加坡元", symbol: "S$", aliases: ["sgd", "singapore", "新币", "新加坡元"], countries: ["singapore", "新加坡"] },
  { code: "HKD", name: "Hong Kong Dollar", zhName: "港币", symbol: "HK$", aliases: ["hkd", "hong kong", "港币", "港元"], countries: ["hong kong", "香港"] },
  { code: "TWD", name: "New Taiwan Dollar", zhName: "新台币", symbol: "NT$", aliases: ["twd", "taiwan", "台币", "新台币"], countries: ["taiwan", "taipei", "台湾", "台北"] },
  { code: "THB", name: "Thai Baht", zhName: "泰铢", symbol: "฿", aliases: ["thb", "baht", "泰铢"], countries: ["thailand", "bangkok", "phuket", "泰国", "曼谷", "普吉"] },
  { code: "MYR", name: "Malaysian Ringgit", zhName: "马来西亚林吉特", symbol: "RM", aliases: ["myr", "ringgit", "马币", "林吉特"], countries: ["malaysia", "kuala lumpur", "马来西亚", "吉隆坡"] },
  { code: "IDR", name: "Indonesian Rupiah", zhName: "印尼盾", symbol: "Rp", aliases: ["idr", "rupiah", "印尼盾"], countries: ["indonesia", "bali", "jakarta", "印尼", "巴厘岛"] },
  { code: "PHP", name: "Philippine Peso", zhName: "菲律宾比索", symbol: "₱", aliases: ["php", "peso", "菲律宾比索"], countries: ["philippines", "manila", "cebu", "菲律宾"] },
  { code: "VND", name: "Vietnamese Dong", zhName: "越南盾", symbol: "₫", aliases: ["vnd", "dong", "越南盾"], countries: ["vietnam", "hanoi", "ho chi minh", "越南"] },
  { code: "INR", name: "Indian Rupee", zhName: "印度卢比", symbol: "₹", aliases: ["inr", "rupee", "卢比", "印度卢比"], countries: ["india", "delhi", "mumbai", "印度"] },
  { code: "AED", name: "UAE Dirham", zhName: "阿联酋迪拉姆", symbol: "د.إ", aliases: ["aed", "dirham", "迪拉姆"], countries: ["uae", "dubai", "abu dhabi", "阿联酋", "迪拜"] },
  { code: "SAR", name: "Saudi Riyal", zhName: "沙特里亚尔", symbol: "﷼", aliases: ["sar", "riyal", "沙特里亚尔"], countries: ["saudi", "saudi arabia", "沙特"] },
  { code: "QAR", name: "Qatari Riyal", zhName: "卡塔尔里亚尔", symbol: "QR", aliases: ["qar", "qatar", "卡塔尔里亚尔"], countries: ["qatar", "doha", "卡塔尔"] },
  { code: "TRY", name: "Turkish Lira", zhName: "土耳其里拉", symbol: "₺", aliases: ["try", "lira", "土耳其里拉"], countries: ["turkey", "istanbul", "土耳其"] },
  { code: "DKK", name: "Danish Krone", zhName: "丹麦克朗", symbol: "kr", aliases: ["dkk", "danish", "丹麦克朗"], countries: ["denmark", "copenhagen", "faroe", "greenland", "丹麦", "哥本哈根", "法罗", "格陵兰"] },
  { code: "SEK", name: "Swedish Krona", zhName: "瑞典克朗", symbol: "kr", aliases: ["sek", "swedish", "瑞典克朗"], countries: ["sweden", "stockholm", "瑞典"] },
  { code: "NOK", name: "Norwegian Krone", zhName: "挪威克朗", symbol: "kr", aliases: ["nok", "norwegian", "挪威克朗"], countries: ["norway", "oslo", "挪威"] },
  { code: "ISK", name: "Icelandic Krona", zhName: "冰岛克朗", symbol: "kr", aliases: ["isk", "iceland", "冰岛克朗"], countries: ["iceland", "reykjavik", "冰岛", "雷克雅未克"] },
  { code: "PLN", name: "Polish Zloty", zhName: "波兰兹罗提", symbol: "zł", aliases: ["pln", "zloty", "波兰兹罗提"], countries: ["poland", "warsaw", "波兰"] },
  { code: "CZK", name: "Czech Koruna", zhName: "捷克克朗", symbol: "Kč", aliases: ["czk", "koruna", "捷克克朗"], countries: ["czech", "prague", "捷克", "布拉格"] },
  { code: "HUF", name: "Hungarian Forint", zhName: "匈牙利福林", symbol: "Ft", aliases: ["huf", "forint", "福林"], countries: ["hungary", "budapest", "匈牙利"] },
  { code: "MXN", name: "Mexican Peso", zhName: "墨西哥比索", symbol: "MX$", aliases: ["mxn", "mexican peso", "墨西哥比索"], countries: ["mexico", "cancun", "墨西哥"] },
  { code: "BRL", name: "Brazilian Real", zhName: "巴西雷亚尔", symbol: "R$", aliases: ["brl", "real", "雷亚尔"], countries: ["brazil", "rio", "巴西"] },
  { code: "ZAR", name: "South African Rand", zhName: "南非兰特", symbol: "R", aliases: ["zar", "rand", "兰特"], countries: ["south africa", "cape town", "南非"] },
  { code: "EGP", name: "Egyptian Pound", zhName: "埃及镑", symbol: "E£", aliases: ["egp", "egyptian pound", "埃及镑"], countries: ["egypt", "cairo", "埃及"] },
];

const aliasToCode = new Map<string, string>();

for (const currency of currencyDefinitions) {
  aliasToCode.set(currency.code.toLowerCase(), currency.code);
  currency.aliases.forEach((alias) => aliasToCode.set(alias.toLowerCase(), currency.code));
}

export const supportedCurrencyCodes = currencyDefinitions.map(
  (currency) => currency.code,
);

export function normalizeCurrencyCode(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const upper = normalized.toUpperCase();
  if (upper === "RMB") return "CNY";
  return aliasToCode.get(normalized.toLowerCase()) ?? upper;
}

export function findCurrencyMatch(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;
  return (
    currencyDefinitions.find((currency) => currency.code.toLowerCase() === normalized) ??
    currencyDefinitions.find((currency) =>
      [currency.name, currency.zhName, ...currency.aliases]
        .map((item) => item.toLowerCase())
        .some((item) => item.includes(normalized) || normalized.includes(item)),
    ) ??
    null
  );
}

export function getCurrencySuggestions(query: string, limit = 8) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return currencyDefinitions.slice(0, limit);
  return currencyDefinitions
    .map((currency) => {
      const haystack = [
        currency.code,
        currency.name,
        currency.zhName,
        ...currency.aliases,
        ...currency.countries,
      ]
        .join(" ")
        .toLowerCase();
      const exact = currency.code.toLowerCase() === normalized ? 0 : 1;
      const starts = haystack
        .split(/\s+/)
        .some((word) => word.startsWith(normalized))
        ? 0
        : 1;
      const includes = haystack.includes(normalized) ? 0 : 1;
      return { currency, score: exact * 100 + starts * 10 + includes };
    })
    .filter((item) => item.score < 111)
    .sort((left, right) => left.score - right.score)
    .slice(0, limit)
    .map((item) => item.currency);
}

export function inferCurrencyFromText(text: string | null | undefined) {
  const normalized = String(text ?? "").toLowerCase();
  if (!normalized) return null;
  return (
    currencyDefinitions.find((currency) =>
      currency.countries.some((country) => normalized.includes(country.toLowerCase())),
    )?.code ?? null
  );
}
