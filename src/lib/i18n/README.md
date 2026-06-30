# OTR i18n conventions

OTR supports English and Simplified Chinese from JSON locale bundles:

- `src/locales/en.json` is the source of truth.
- `src/locales/zh-CN.json` is the first reviewed built-in translation.
- `src/lib/i18n/dictionaries.ts` loads built-in bundles, formats placeholders,
  and falls back to English for missing keys.

For new user-facing UI:

- Do not hardcode display strings directly in components.
- Add a translation key to `src/locales/en.json` first.
- Add the matching Simplified Chinese value to `src/locales/zh-CN.json`.
- In client components, use `const { t } = useI18n()` and render `t("your.key")`.
- For repeated domain language, prefer stable keys such as `nav.planner` or `ledger.totalCost`.

Translation provider code lives in `src/lib/translation`. OTR app language codes
are mapped before calling external engines; for LibreTranslate, `zh-CN` and
`zh-TW` currently map to `zh-Hans`.

Full legacy coverage can be completed module by module after Journey, Capture, Map, and Ledger flows stabilize.
