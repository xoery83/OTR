# OTR i18n conventions

OTR supports English and Simplified Chinese from `src/lib/i18n/dictionaries.ts`.

For new user-facing UI:

- Do not hardcode display strings directly in components.
- Add a translation key to the English dictionary first.
- Add the matching Simplified Chinese value.
- In client components, use `const { t } = useI18n()` and render `t("your.key")`.
- For repeated domain language, prefer stable keys such as `nav.planner` or `ledger.totalCost`.

Full legacy coverage can be completed module by module after Journey, Capture, Map, and Ledger flows stabilize.
