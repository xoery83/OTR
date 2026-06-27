"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { useI18n } from "@/components/I18nProvider";
import { getApproxExchangeRate } from "@/lib/exchange-rates";
import { getErrorMessage } from "@/lib/errors";
import type { Locale, TranslationKey } from "@/lib/i18n/dictionaries";
import {
  createLedgerEntry,
  deleteLedgerEntry,
  getLedgerData,
  type LedgerData,
  updateLedgerEntry,
  updateJourneyLedgerCurrency,
} from "@/lib/supabase/ledger";
import { getTrip } from "@/lib/supabase/trips";
import type {
  CreateLedgerEntryInput,
  JourneyMember,
  LedgerAccountingMode,
  LedgerCategory,
  LedgerEntry,
  Trip,
} from "@/types";

const categories: LedgerCategory[] = [
  "flight",
  "hotel",
  "car",
  "fuel",
  "food",
  "ticket",
  "shopping",
  "transport",
  "insurance",
  "other",
];

const categoryLabelKeys: Record<LedgerCategory, TranslationKey> = {
  flight: "planner.expense.flight",
  hotel: "planner.expense.hotel",
  car: "planner.expense.car",
  fuel: "planner.expense.fuel",
  food: "planner.expense.food",
  ticket: "planner.expense.ticket",
  shopping: "planner.expense.shopping",
  transport: "planner.expense.transport",
  insurance: "planner.expense.insurance",
  other: "planner.expense.other",
};

const commonCurrencies = [
  "NZD",
  "AUD",
  "CHF",
  "CNY",
  "EUR",
  "DKK",
  "USD",
  "ISK",
  "GBP",
];

type LedgerFormState = {
  title: string;
  description: string;
  category: LedgerCategory;
  accountingMode: LedgerAccountingMode;
  expenseDate: string;
  startDate: string;
  endDate: string;
  originalAmount: string;
  originalCurrency: string;
  exchangeRate: string;
  payerMemberId: string;
  participantMemberIds: string[];
  addressText: string;
};

type LedgerView = "days" | "expenses" | "people" | "settlement";
type ExpenseCategoryFilter = LedgerCategory | "all";
type ExpenseSortMode = "latest" | "date" | "amount";

type MemberLedgerReport = {
  member: JourneyMember;
  totalTripCost: number;
  sharedCost: number;
  personalCost: number;
  paidShared: number;
  settlementBalance: number;
  entryCount: number;
  categories: Record<LedgerCategory, number>;
};

type DailyLedgerEntry = {
  entry: LedgerEntry;
  allocatedAmount: number;
  allocationNote: string | null;
};

type DailyLedgerReport = {
  date: string;
  total: number;
  shared: number;
  statsOnly: number;
  categories: Record<LedgerCategory, number>;
  entries: DailyLedgerEntry[];
};

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(now.getDate()).padStart(2, "0")}`;
}

function activeMembers(members: JourneyMember[]) {
  return members.filter(
    (member) => member.role === "owner" || member.role === "group_member",
  );
}

function money(amount: number, currency: string, locale: Locale) {
  return new Intl.NumberFormat(locale === "zh-CN" ? "zh-CN" : "en", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function dateLabel(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function timestamp(value: string | null | undefined) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function buildExpenseSections(entries: LedgerEntry[], sortMode: ExpenseSortMode) {
  const sortedEntries = [...entries].sort((left, right) => {
    if (sortMode === "date") {
      const dateOrder = left.expenseDate.localeCompare(right.expenseDate);
      return dateOrder || timestamp(right.createdAt) - timestamp(left.createdAt);
    }

    if (sortMode === "amount") {
      return (
        right.baseAmount - left.baseAmount ||
        timestamp(right.createdAt) - timestamp(left.createdAt)
      );
    }

    return (
      timestamp(right.createdAt) - timestamp(left.createdAt) ||
      right.expenseDate.localeCompare(left.expenseDate)
    );
  });

  const sections = new Map<string, LedgerEntry[]>();
  sortedEntries.forEach((entry) => {
    sections.set(entry.expenseDate, [
      ...(sections.get(entry.expenseDate) ?? []),
      entry,
    ]);
  });

  return [...sections.entries()].map(([date, sectionEntries]) => ({
    date,
    entries: sectionEntries,
  }));
}

function normalizeSearchText(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function entryMatchesSearch(
  entry: LedgerEntry,
  query: string,
  categoryLabel: string,
) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const searchableText = [
    entry.title,
    entry.description,
    entry.addressText,
    entry.expenseDate,
    entry.startDate,
    entry.endDate,
    entry.originalCurrency,
    entry.baseCurrency,
    entry.originalAmount,
    entry.baseAmount,
    entry.accountingMode,
    categoryLabel,
    entry.payer?.displayName,
    ...entry.participants.map((participant) => participant.member?.displayName),
  ]
    .map(normalizeSearchText)
    .filter(Boolean)
    .join(" ");

  return searchableText.includes(normalizedQuery);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function getEntryAllocationDates(entry: LedgerEntry) {
  const start = entry.startDate || entry.expenseDate;
  const end = entry.endDate || start;
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return [entry.expenseDate];
  }

  if (endDate < startDate) {
    return [entry.expenseDate];
  }

  const dates: string[] = [];
  let cursor = startDate;

  while (cursor <= endDate && dates.length < 90) {
    dates.push(dateKey(cursor));
    cursor = addDays(cursor, 1);
  }

  return dates.length > 0 ? dates : [entry.expenseDate];
}

function buildDailyLedgerReports(entries: LedgerEntry[], locale: Locale) {
  const reports = new Map<string, DailyLedgerReport>();

  entries.forEach((entry) => {
    const dates = getEntryAllocationDates(entry);
    const allocatedAmount = Number((entry.baseAmount / dates.length).toFixed(2));
    const allocationNote =
      dates.length > 1
        ? locale === "zh-CN"
          ? `${money(entry.baseAmount, entry.baseCurrency, locale)} 平均分摊到 ${
              dates.length
            } 天`
          : `${money(entry.baseAmount, entry.baseCurrency, locale)} split across ${
              dates.length
            } days`
        : null;

    dates.forEach((date) => {
      const report =
        reports.get(date) ??
        ({
          date,
          total: 0,
          shared: 0,
          statsOnly: 0,
          categories: categories.reduce(
            (totals, category) => ({ ...totals, [category]: 0 }),
            {} as Record<LedgerCategory, number>,
          ),
          entries: [],
        } satisfies DailyLedgerReport);

      report.total += allocatedAmount;
      report.categories[entry.category] += allocatedAmount;
      if (entry.accountingMode === "shared") {
        report.shared += allocatedAmount;
      } else {
        report.statsOnly += allocatedAmount;
      }
      report.entries.push({ entry, allocatedAmount, allocationNote });
      reports.set(date, report);
    });
  });

  return [...reports.values()]
    .map((report) => ({
      ...report,
      total: Number(report.total.toFixed(2)),
      shared: Number(report.shared.toFixed(2)),
      statsOnly: Number(report.statsOnly.toFixed(2)),
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function nearestReportDate(reports: DailyLedgerReport[]) {
  if (reports.length === 0) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return [...reports].sort((left, right) => {
    const leftDistance = Math.abs(
      new Date(`${left.date}T00:00:00`).getTime() - today.getTime(),
    );
    const rightDistance = Math.abs(
      new Date(`${right.date}T00:00:00`).getTime() - today.getTime(),
    );
    return leftDistance - rightDistance;
  })[0].date;
}

const categoryColorClasses: Record<LedgerCategory, string> = {
  flight: "bg-emerald-600",
  hotel: "bg-orange-500",
  car: "bg-sky-500",
  fuel: "bg-lime-600",
  food: "bg-amber-500",
  ticket: "bg-violet-500",
  shopping: "bg-rose-500",
  transport: "bg-cyan-600",
  insurance: "bg-indigo-500",
  other: "bg-stone-500",
};

function categoryColor(category: LedgerCategory) {
  return categoryColorClasses[category];
}

function buildMemberReports(
  entries: LedgerEntry[],
  balances: LedgerData["summary"]["balances"],
  members: JourneyMember[],
) {
  const reports = new Map<string, MemberLedgerReport>();
  const balanceByMember = new Map(
    balances.map((balance) => [balance.member.id, balance]),
  );

  members.forEach((member) => {
    const balance = balanceByMember.get(member.id);
    reports.set(member.id, {
      member,
      totalTripCost: (balance?.owedTotal ?? 0) + (balance?.statsOnlyTotal ?? 0),
      sharedCost: balance?.owedTotal ?? 0,
      personalCost: balance?.statsOnlyTotal ?? 0,
      paidShared: balance?.paidTotal ?? 0,
      settlementBalance: balance?.balance ?? 0,
      entryCount: 0,
      categories: categories.reduce(
        (totals, category) => ({ ...totals, [category]: 0 }),
        {} as Record<LedgerCategory, number>,
      ),
    });
  });

  entries.forEach((entry) => {
    const participants =
      entry.participants.length > 0
        ? entry.participants
        : entry.payerMemberId
          ? [{ memberId: entry.payerMemberId, computedShareBaseAmount: entry.baseAmount }]
          : [];

    participants.forEach((participant) => {
      const report = reports.get(participant.memberId);
      if (!report) return;
      const share = participant.computedShareBaseAmount ?? 0;
      report.categories[entry.category] += share;
      report.entryCount += 1;
    });
  });

  return [...reports.values()].sort(
    (first, second) => second.totalTripCost - first.totalTripCost,
  );
}

function initialForm(
  baseCurrency: string,
  members: JourneyMember[],
): LedgerFormState {
  const memberIds = activeMembers(members).map((member) => member.id);
  return {
    title: "",
    description: "",
    category: "food",
    accountingMode: "shared",
    expenseDate: todayKey(),
    startDate: "",
    endDate: "",
    originalAmount: "",
    originalCurrency: baseCurrency,
    exchangeRate: "1",
    payerMemberId: "",
    participantMemberIds: memberIds,
    addressText: "",
  };
}

function StatCard({
  label,
  value,
  tone = "emerald",
  compact = false,
}: {
  label: string;
  value: string;
  tone?: "emerald" | "amber" | "stone";
  compact?: boolean;
}) {
  const toneClass = {
    emerald: "bg-emerald-50 text-emerald-900",
    amber: "bg-amber-50 text-amber-900",
    stone: "bg-stone-50 text-stone-900",
  }[tone];

  return (
    <div
      className={`${compact ? "rounded-2xl p-3" : "rounded-3xl p-4"} ${toneClass}`}
    >
      <p
        className={`font-bold uppercase tracking-[0.12em] opacity-70 ${
          compact ? "text-[11px]" : "text-xs"
        }`}
      >
        {label}
      </p>
      <p className={`${compact ? "mt-1 text-lg" : "mt-2 text-2xl"} font-semibold`}>
        {value}
      </p>
    </div>
  );
}

function MemberPill({ member }: { member: JourneyMember }) {
  return (
    <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-bold text-stone-700">
      {member.displayName}
    </span>
  );
}

function PersonReportCard({
  report,
  currency,
}: {
  report: MemberLedgerReport;
  currency: string;
}) {
  const { locale, t } = useI18n();
  const topCategories = Object.entries(report.categories)
    .filter(([, amount]) => amount > 0)
    .sort((first, second) => second[1] - first[1])
    .slice(0, 4) as [LedgerCategory, number][];

  return (
    <article className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-stone-950">
            {report.member.displayName}
          </h3>
          <p className="mt-1 text-sm text-stone-500">
            {t("ledger.relatedExpenses", { count: report.entryCount })}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-800">
            {t("ledger.tripCost")}
          </p>
          <p className="mt-1 text-xl font-semibold text-emerald-950">
            {money(report.totalTripCost, currency, locale)}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-amber-50 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-amber-800">
            {t("ledger.sharedShare")}
          </p>
          <p className="mt-1 font-semibold text-amber-950">
            {money(report.sharedCost, currency, locale)}
          </p>
        </div>
        <div className="rounded-2xl bg-stone-50 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-stone-500">
            {t("ledger.personalStats")}
          </p>
          <p className="mt-1 font-semibold text-stone-950">
            {money(report.personalCost, currency, locale)}
          </p>
        </div>
        <div className="rounded-2xl bg-emerald-50 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">
            {t("ledger.paidShared")}
          </p>
          <p className="mt-1 font-semibold text-emerald-950">
            {money(report.paidShared, currency, locale)}
          </p>
        </div>
        <div className="rounded-2xl bg-stone-50 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-stone-500">
            {t("ledger.tabs.settlement")}
          </p>
          <p
            className={`mt-1 font-semibold ${
              report.settlementBalance >= 0
                ? "text-emerald-900"
                : "text-amber-900"
            }`}
          >
            {money(report.settlementBalance, currency, locale)}
          </p>
        </div>
      </div>

      {topCategories.length > 0 ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-stone-500">
            {t("ledger.categoryMix")}
          </p>
          {topCategories.map(([category, amount]) => (
            <div
              key={category}
              className="flex items-center justify-between gap-3 rounded-2xl bg-[#fff8ec] px-3 py-2 text-sm"
            >
              <span className="font-semibold text-stone-700">
                {t(categoryLabelKeys[category])}
              </span>
              <span className="font-bold text-stone-950">
                {money(amount, currency, locale)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function DailyLedgerAnalysis({
  reports,
  currency,
  initialDate,
  onEditEntry,
  onDeleteEntry,
  deletingEntryId,
}: {
  reports: DailyLedgerReport[];
  currency: string;
  initialDate?: string | null;
  onEditEntry: (entry: LedgerEntry) => void;
  onDeleteEntry: (entry: LedgerEntry) => void;
  deletingEntryId: string | null;
}) {
  const { locale, t } = useI18n();
  const [selectedDate, setSelectedDate] = useState<string | null>(
    initialDate ?? null,
  );
  const activeDate =
    selectedDate && reports.some((report) => report.date === selectedDate)
      ? selectedDate
      : nearestReportDate(reports);
  const activeReport = reports.find((report) => report.date === activeDate) ?? null;
  const categoryBreakdown = activeReport
    ? (Object.entries(activeReport.categories) as [LedgerCategory, number][])
        .filter(([, amount]) => amount > 0)
        .sort((first, second) => second[1] - first[1])
    : [];

  if (reports.length === 0 || !activeReport) {
    return (
      <div className="rounded-3xl border border-dashed border-stone-200 bg-white p-5 text-stone-500">
        {t("ledger.dailyAnalysis.empty")}
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-stone-950">
          {t("ledger.dailyAnalysis.title")}
        </h2>
        <p className="mt-1 text-sm text-stone-500">
          {t("ledger.dailyAnalysis.description")}
        </p>
      </div>

      <div className="sticky top-0 z-20 -mx-4 overflow-x-auto border-y border-emerald-100 bg-stone-50/95 px-4 py-3 backdrop-blur">
        <div className="flex gap-2">
          {reports.map((report) => {
            const active = report.date === activeReport.date;

            return (
              <button
                type="button"
                key={report.date}
                onClick={() => setSelectedDate(report.date)}
                className={`shrink-0 rounded-2xl px-4 py-2 text-left shadow-sm ${
                  active
                    ? "bg-emerald-700 text-white"
                    : "bg-white text-stone-700"
                }`}
              >
                <p className="text-xs font-black uppercase tracking-wide">
                  {new Date(`${report.date}T00:00:00`).toLocaleDateString(
                    undefined,
                    {
                      month: "short",
                      day: "numeric",
                    },
                  )}
                </p>
                <p className="mt-1 text-sm font-black">
                  {money(report.total, currency, locale)}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <section className="-mx-1 overflow-x-auto px-1">
        <div className="grid min-w-[540px] grid-cols-3 gap-2 sm:min-w-0">
          <StatCard
            label={t("ledger.dayTotal")}
            value={money(activeReport.total, currency, locale)}
            compact
          />
          <StatCard
            label={t("ledger.shared")}
            value={money(activeReport.shared, currency, locale)}
            tone="amber"
            compact
          />
          <StatCard
            label={t("ledger.statsOnly")}
            value={money(activeReport.statsOnly, currency, locale)}
            tone="stone"
            compact
          />
        </div>
      </section>

      <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-stone-950">
              {dateLabel(activeReport.date, locale)}
            </h3>
            <p className="mt-1 text-sm text-stone-500">
              {t("ledger.expenseDetails", {
                count: activeReport.entries.length,
              })}
            </p>
          </div>
          <p className="text-right text-xl font-semibold text-emerald-900">
            {money(activeReport.total, currency, locale)}
          </p>
        </div>

        {categoryBreakdown.length > 0 ? (
          <div className="mt-4 space-y-3">
            <div className="flex h-4 overflow-hidden rounded-full bg-stone-100">
              {categoryBreakdown.map(([category, amount]) => (
                <div
                  key={category}
                  className={categoryColor(category)}
                  style={{
                    width: `${Math.max(
                      3,
                      (amount / activeReport.total) * 100,
                    )}%`,
                  }}
                  title={`${t(categoryLabelKeys[category])} ${money(
                    amount,
                    currency,
                    locale,
                  )}`}
                />
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {categoryBreakdown.map(([category, amount]) => {
                const percent =
                  activeReport.total > 0
                    ? Math.round((amount / activeReport.total) * 100)
                    : 0;

                return (
                  <div
                    key={category}
                    className="flex items-center justify-between gap-3 rounded-2xl bg-stone-50 px-3 py-2 text-sm"
                  >
                    <span className="flex items-center gap-2 font-semibold text-stone-700">
                      <span
                        className={`size-2.5 rounded-full ${categoryColor(category)}`}
                      />
                      {t(categoryLabelKeys[category])}
                    </span>
                    <span className="text-right font-bold text-stone-950">
                      {money(amount, currency, locale)} · {percent}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-stone-500">
          {t("ledger.details")}
        </h3>
        {activeReport.entries.map(({ entry, allocatedAmount, allocationNote }) => (
          <article
            key={`${activeReport.date}-${entry.id}`}
            className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-semibold text-stone-950">{entry.title}</h4>
                  <span className="rounded-full bg-stone-100 px-2 py-1 text-[11px] font-bold text-stone-600">
                    {t(categoryLabelKeys[entry.category])}
                  </span>
                  <span
                    className={`rounded-full px-2 py-1 text-[11px] font-bold ${
                      entry.accountingMode === "shared"
                        ? "bg-amber-50 text-amber-800"
                        : "bg-stone-100 text-stone-600"
                    }`}
                  >
                    {entry.accountingMode === "shared"
                      ? t("ledger.shared")
                      : t("ledger.statsOnly")}
                  </span>
                </div>
                <p className="mt-1 text-sm text-stone-500">
                  {entry.payer
                    ? t("ledger.paidByName", {
                        name: entry.payer.displayName,
                      })
                    : t("ledger.noPayer")}
                  {entry.addressText ? ` · ${entry.addressText}` : ""}
                </p>
                {allocationNote ? (
                  <p className="mt-2 rounded-2xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-900">
                    {allocationNote}
                  </p>
                ) : null}
                {entry.description ? (
                  <p className="mt-2 text-sm leading-6 text-stone-600">
                    {entry.description}
                  </p>
                ) : null}
                {entry.participants.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {entry.participants.map((participant) =>
                      participant.member ? (
                        <MemberPill
                          key={participant.id}
                          member={participant.member}
                        />
                      ) : null,
                    )}
                  </div>
                ) : null}
              </div>
              <div className="shrink-0 text-right">
                <p className="font-semibold text-stone-950">
                  {money(allocatedAmount, currency, locale)}
                </p>
                {allocatedAmount !== entry.baseAmount ? (
                  <p className="mt-1 text-xs text-stone-500">
                    {t("ledger.ofAmount", {
                      amount: money(entry.baseAmount, currency, locale),
                    })}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onEditEntry(entry)}
                className="rounded-full bg-stone-100 px-3 py-1.5 text-xs font-bold text-stone-700"
              >
                {t("common.edit")}
              </button>
              <button
                type="button"
                onClick={() => onDeleteEntry(entry)}
                disabled={deletingEntryId === entry.id}
                className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 disabled:text-red-300"
              >
                {deletingEntryId === entry.id
                  ? t("common.deleting")
                  : t("common.delete")}
              </button>
            </div>
          </article>
        ))}
      </section>
    </section>
  );
}

function LedgerContent() {
  const params = useParams<{ tripId: string }>();
  const searchParams = useSearchParams();
  const tripId = params.tripId;
  const initialLedgerView =
    searchParams.get("view") === "days" ? "days" : undefined;
  const initialLedgerDate = searchParams.get("date");
  const { locale, t } = useI18n();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [ledgerData, setLedgerData] = useState<LedgerData | null>(null);
  const [form, setForm] = useState<LedgerFormState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [isSavingCurrency, setIsSavingCurrency] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<LedgerView>(
    initialLedgerView ?? "days",
  );
  const [expenseCategoryFilter, setExpenseCategoryFilter] =
    useState<ExpenseCategoryFilter>("all");
  const [expenseSortMode, setExpenseSortMode] =
    useState<ExpenseSortMode>("latest");
  const [expenseSearchQuery, setExpenseSearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [currencyError, setCurrencyError] = useState<string | null>(null);
  const [isLoadingRate, setIsLoadingRate] = useState(false);

  async function loadLedgerSnapshot() {
    const [tripData, data] = await Promise.all([
      getTrip(tripId),
      getLedgerData(tripId),
    ]);
    return { tripData, data };
  }

  function applyLedgerSnapshot({
    tripData,
    data,
  }: {
    tripData: Trip;
    data: LedgerData;
  }) {
    setTrip(tripData);
    setLedgerData(data);
    setForm(initialForm(data.ledger.baseCurrency, data.members));
  }

  useEffect(() => {
    let isMounted = true;

    async function loadInitialLedger() {
      try {
        const snapshot = await loadLedgerSnapshot();
        if (isMounted) {
          applyLedgerSnapshot(snapshot);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(getErrorMessage(loadError, t("ledger.error.load")));
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadInitialLedger();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  const expenseCategoryTotals = useMemo(() => {
    const totals = categories.reduce(
      (current, category) => ({ ...current, [category]: 0 }),
      {} as Record<LedgerCategory, number>,
    );

    (ledgerData?.entries ?? []).forEach((entry) => {
      totals[entry.category] += entry.baseAmount;
    });

    return totals;
  }, [ledgerData?.entries]);
  const filteredExpenseEntries = useMemo(
    () =>
      (ledgerData?.entries ?? []).filter((entry) => {
        const matchesCategory =
          expenseCategoryFilter === "all" ||
          entry.category === expenseCategoryFilter;
        const matchesSearch = entryMatchesSearch(
          entry,
          expenseSearchQuery,
          t(categoryLabelKeys[entry.category]),
        );

        return matchesCategory && matchesSearch;
      }),
    [expenseCategoryFilter, expenseSearchQuery, ledgerData?.entries, t],
  );
  const expenseSections = useMemo(
    () => buildExpenseSections(filteredExpenseEntries, expenseSortMode),
    [expenseSortMode, filteredExpenseEntries],
  );
  const expenseFilterSummary = useMemo(
    () =>
      filteredExpenseEntries.reduce(
        (summary, entry) => ({
          total: summary.total + entry.baseAmount,
          shared:
            summary.shared +
            (entry.accountingMode === "shared" ? entry.baseAmount : 0),
          statsOnly:
            summary.statsOnly +
            (entry.accountingMode === "stats_only" ? entry.baseAmount : 0),
          count: summary.count + 1,
        }),
        { total: 0, shared: 0, statsOnly: 0, count: 0 },
      ),
    [filteredExpenseEntries],
  );

  const baseCurrency = ledgerData?.ledger.baseCurrency ?? "NZD";
  const displayCurrency = ledgerData?.ledger.displayCurrency ?? baseCurrency;
  const members = useMemo(
    () => (ledgerData ? activeMembers(ledgerData.members) : []),
    [ledgerData],
  );
  const totalPreview =
    form?.originalAmount && form?.exchangeRate
      ? Number(form.originalAmount || 0) * Number(form.exchangeRate || 1)
      : 0;
  const isSharedSplitInvalid =
    form?.accountingMode === "shared" &&
    form.participantMemberIds.length === 0;
  const memberReports = useMemo(
    () =>
      ledgerData
        ? buildMemberReports(
            ledgerData.entries,
            ledgerData.summary.balances,
            members,
          )
        : [],
    [ledgerData, members],
  );
  const dailyReports = useMemo(
    () => buildDailyLedgerReports(ledgerData?.entries ?? [], locale),
    [ledgerData?.entries, locale],
  );
  const trimmedExpenseSearchQuery = expenseSearchQuery.trim();

  function updateExpenseSearchQuery(value: string) {
    setExpenseSearchQuery(value);
    setActiveView("expenses");
    if (value.trim()) {
      setExpenseCategoryFilter("all");
    }
  }

  function updateForm(patch: Partial<LedgerFormState>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
  }

  function sharedParticipantIdsForForm(nextForm: LedgerFormState) {
    if (nextForm.accountingMode !== "shared") {
      return nextForm.participantMemberIds;
    }
    if (nextForm.participantMemberIds.length > 0) {
      return nextForm.participantMemberIds;
    }
    return nextForm.payerMemberId ? [nextForm.payerMemberId] : [];
  }

  function startCreateExpense() {
    if (ledgerData) {
      setForm(initialForm(ledgerData.ledger.baseCurrency, ledgerData.members));
    }
    setEditingEntryId(null);
    setShowForm((current) => !current || Boolean(editingEntryId));
  }

  function startEditExpense(entry: LedgerEntry) {
    const participantMemberIds = entry.participants.map(
      (participant) => participant.memberId,
    );
    setEditingEntryId(entry.id);
    setForm({
      title: entry.title,
      description: entry.description ?? "",
      category: entry.category,
      accountingMode: entry.accountingMode,
      expenseDate: entry.expenseDate,
      startDate: entry.startDate ?? "",
      endDate: entry.endDate ?? "",
      originalAmount: String(entry.originalAmount),
      originalCurrency: entry.originalCurrency,
      exchangeRate: String(entry.exchangeRate || 1),
      payerMemberId: entry.payerMemberId ?? "",
      participantMemberIds:
        entry.accountingMode === "shared" &&
        participantMemberIds.length === 0 &&
        entry.payerMemberId
          ? [entry.payerMemberId]
          : participantMemberIds,
      addressText: entry.addressText ?? "",
    });
    setShowForm(true);
    setSaveError(null);
    globalThis.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveCurrencySettings(nextBaseCurrency: string) {
    if (!ledgerData || isSavingCurrency) return;

    setIsSavingCurrency(true);
    setCurrencyError(null);

    try {
      await updateJourneyLedgerCurrency({
        journeyId: tripId,
        baseCurrency: nextBaseCurrency,
        displayCurrency: nextBaseCurrency,
      });
      const data = await getLedgerData(tripId);
      setLedgerData(data);
      setForm(initialForm(data.ledger.baseCurrency, data.members));
    } catch (currencyUpdateError) {
      setCurrencyError(
        getErrorMessage(currencyUpdateError, t("ledger.error.currency")),
      );
    } finally {
      setIsSavingCurrency(false);
    }
  }

  useEffect(() => {
    if (!form) return;

    let isMounted = true;

    async function loadRate() {
      if (!form) return;

      setIsLoadingRate(true);
      try {
        const result = await getApproxExchangeRate(
          form.originalCurrency,
          baseCurrency,
        );
        if (isMounted) {
          updateForm({ exchangeRate: result.rate.toFixed(4) });
        }
      } catch {
        if (isMounted && form.originalCurrency === baseCurrency) {
          updateForm({ exchangeRate: "1" });
        }
      } finally {
        if (isMounted) setIsLoadingRate(false);
      }
    }

    loadRate();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.originalCurrency, baseCurrency]);

  function toggleParticipant(memberId: string) {
    if (!form) return;
    const selected = new Set(form.participantMemberIds);
    if (selected.has(memberId)) {
      selected.delete(memberId);
    } else {
      selected.add(memberId);
    }
    updateForm({ participantMemberIds: [...selected] });
  }

  async function submitExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || !ledgerData) return;

    const participantMemberIds = sharedParticipantIdsForForm(form);
    if (form.accountingMode === "shared" && participantMemberIds.length === 0) {
      setSaveError(t("ledger.error.splitMembersRequired"));
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      const payload: CreateLedgerEntryInput = {
        journeyId: tripId,
        title: form.title,
        description: form.description,
        category: form.category,
        accountingMode: form.accountingMode,
        expenseDate: form.expenseDate,
        startDate: form.startDate,
        endDate: form.endDate,
        originalAmount: Number(form.originalAmount),
        originalCurrency: form.originalCurrency,
        baseCurrency,
        exchangeRate: Number(form.exchangeRate || 1),
        payerMemberId: form.payerMemberId || null,
        participantMemberIds,
        addressText: form.addressText,
      };
      if (editingEntryId) {
        await updateLedgerEntry({ ...payload, id: editingEntryId });
      } else {
        await createLedgerEntry(payload);
      }
      applyLedgerSnapshot(await loadLedgerSnapshot());
      setEditingEntryId(null);
      setShowForm(false);
    } catch (submitError) {
      setSaveError(getErrorMessage(submitError, t("ledger.error.save")));
    } finally {
      setIsSaving(false);
    }
  }

  async function removeExpense(entry: LedgerEntry) {
    const confirmed = globalThis.confirm(
      t("ledger.confirm.delete", { title: entry.title }),
    );
    if (!confirmed) return;

    setDeletingEntryId(entry.id);
    setSaveError(null);

    try {
      await deleteLedgerEntry(entry.id);
      applyLedgerSnapshot(await loadLedgerSnapshot());
    } catch (deleteError) {
      setSaveError(getErrorMessage(deleteError, t("ledger.error.delete")));
    } finally {
      setDeletingEntryId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="rounded-3xl bg-white p-5">{t("ledger.loading")}</div>
    );
  }

  if (error) {
    return (
      <div className="rounded-3xl bg-red-50 p-5 text-sm font-medium text-red-700">
        {error}
      </div>
    );
  }

  if (!ledgerData || !form) {
    return (
      <div className="rounded-3xl bg-white p-5 text-stone-600">
        {t("ledger.unavailable")}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-bold text-emerald-800">
              {t("ledger.title")}
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-stone-950">
              {trip?.name || t("ledger.tripAccounting")}
            </h1>
            <p className="mt-2 text-sm text-stone-600">
              {t("ledger.description")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 rounded-full bg-stone-50 px-3 py-2 text-xs font-bold text-stone-700">
              {t("ledger.base")}
              <select
                value={baseCurrency}
                disabled={isSavingCurrency}
                onChange={(event) => saveCurrencySettings(event.target.value)}
                className="bg-transparent text-sm font-bold text-stone-950 outline-none"
                title={t("ledger.baseCurrency")}
              >
                {commonCurrencies.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={startCreateExpense}
              className="shrink-0 rounded-full bg-emerald-700 px-4 py-2 text-sm font-bold text-white shadow-sm"
            >
              {t("ledger.addExpense")}
            </button>
          </div>
        </div>
        {currencyError ? (
          <p className="mt-3 rounded-2xl bg-red-50 p-3 text-sm font-medium text-red-700">
            {currencyError}
          </p>
        ) : null}
        <div className="mt-4 flex flex-col gap-2 rounded-2xl bg-stone-50 p-2 sm:flex-row sm:items-center">
          <input
            value={expenseSearchQuery}
            onChange={(event) => updateExpenseSearchQuery(event.target.value)}
            placeholder={t("ledger.search.placeholder")}
            className="min-h-11 flex-1 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-950 outline-none placeholder:text-stone-400 focus:border-emerald-300"
          />
          {trimmedExpenseSearchQuery ? (
            <button
              type="button"
              onClick={() => updateExpenseSearchQuery("")}
              className="rounded-full bg-white px-4 py-2 text-xs font-bold text-stone-600 shadow-sm"
            >
              {t("ledger.search.clear")}
            </button>
          ) : null}
        </div>
      </section>

      <section className="-mx-1 overflow-x-auto px-1">
        <div className="grid min-w-[720px] grid-cols-4 gap-2 sm:min-w-0">
          <StatCard
            label={t("ledger.totalCost")}
            value={money(ledgerData.summary.totalBase, displayCurrency, locale)}
            compact
          />
          <StatCard
            label={t("ledger.shared")}
            value={money(ledgerData.summary.sharedBase, displayCurrency, locale)}
            tone="amber"
            compact
          />
          <StatCard
            label={t("ledger.statsOnly")}
            value={money(ledgerData.summary.statsOnlyBase, displayCurrency, locale)}
            tone="stone"
            compact
          />
          <StatCard
            label={t("ledger.needsReview")}
            value={`${ledgerData.summary.incompleteCount}`}
            tone="stone"
            compact
          />
        </div>
      </section>

      {showForm ? (
        <form
          onSubmit={submitExpense}
          className="space-y-4 rounded-3xl border border-emerald-100 bg-white p-4 shadow-sm"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-950">
                {editingEntryId ? t("ledger.editExpense") : t("ledger.addExpense")}
              </h2>
              <p className="mt-1 text-sm text-stone-500">
                {editingEntryId
                  ? t("ledger.form.editDescription")
                  : t("ledger.form.addDescription")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setEditingEntryId(null);
                setSaveError(null);
              }}
              className="rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-stone-600"
            >
              {t("common.cancel")}
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-bold text-stone-800">
                {t("planner.field.title")}
              </span>
              <input
                value={form.title}
                onChange={(event) => updateForm({ title: event.target.value })}
                required
                placeholder={t("ledger.placeholder.title")}
                className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-bold text-stone-800">
                {t("planner.field.category")}
              </span>
              <select
                value={form.category}
                onChange={(event) =>
                  updateForm({ category: event.target.value as LedgerCategory })
                }
                className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
              >
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {t(categoryLabelKeys[category])}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <label className="space-y-1 sm:col-span-2">
              <span className="text-sm font-bold text-stone-800">
                {t("planner.field.amount")}
              </span>
              <input
                value={form.originalAmount}
                onChange={(event) =>
                  updateForm({ originalAmount: event.target.value })
                }
                required
                min="0"
                step="0.01"
                type="number"
                placeholder="100"
                className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-bold text-stone-800">
                {t("planner.field.currency")}
              </span>
              <select
                value={form.originalCurrency}
                onChange={(event) => {
                  const currency = event.target.value;
                  updateForm({
                    originalCurrency: currency,
                    exchangeRate: currency === baseCurrency ? "1" : "",
                  });
                }}
                className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
              >
                {commonCurrencies.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-bold text-stone-800">
                {t("planner.field.rateTo", { currency: baseCurrency })}
                {isLoadingRate ? t("planner.loadingSuffix") : ""}
              </span>
              <input
                value={form.exchangeRate}
                onChange={(event) =>
                  updateForm({ exchangeRate: event.target.value })
                }
                required
                min="0"
                step="0.0001"
                type="number"
                className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1">
              <span className="text-sm font-bold text-stone-800">
                {t("ledger.field.expenseDate")}
              </span>
              <input
                value={form.expenseDate}
                onChange={(event) =>
                  updateForm({ expenseDate: event.target.value })
                }
                required
                type="date"
                className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-bold text-stone-800">
                {t("ledger.field.startDate")}
              </span>
              <input
                value={form.startDate}
                onChange={(event) => updateForm({ startDate: event.target.value })}
                type="date"
                className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-bold text-stone-800">
                {t("ledger.field.endDate")}
              </span>
              <input
                value={form.endDate}
                onChange={(event) => updateForm({ endDate: event.target.value })}
                type="date"
                className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-bold text-stone-800">
                {t("ledger.field.accountingMode")}
              </span>
              <select
                value={form.accountingMode}
                onChange={(event) => {
                  const accountingMode = event.target.value as LedgerAccountingMode;
                  const shouldSeedPayer =
                    accountingMode === "shared" &&
                    form.participantMemberIds.length === 0 &&
                    form.payerMemberId;
                  updateForm({
                    accountingMode,
                    ...(shouldSeedPayer
                      ? { participantMemberIds: [form.payerMemberId] }
                      : {}),
                  });
                }}
                className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
              >
                <option value="shared">{t("ledger.mode.shared")}</option>
                <option value="stats_only">{t("ledger.mode.statsOnly")}</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-bold text-stone-800">
                {t("ledger.field.payer")}
              </span>
              <select
                value={form.payerMemberId}
                onChange={(event) => {
                  const payerMemberId = event.target.value;
                  const participantMemberIds =
                    form.accountingMode === "shared" &&
                    payerMemberId &&
                    form.participantMemberIds.length === 0
                      ? [payerMemberId]
                      : form.participantMemberIds;
                  updateForm({ payerMemberId, participantMemberIds });
                }}
                className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
              >
                <option value="">{t("ledger.field.selectPayer")}</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <section className="space-y-2 rounded-3xl bg-emerald-50/70 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-bold text-emerald-900">
                {form.accountingMode === "shared"
                  ? t("ledger.splitParticipants")
                  : t("planner.expense.countFor")}
              </p>
              <p className="text-xs font-semibold text-emerald-800">
                {t("ledger.equalShare")} ·{" "}
                {form.participantMemberIds.length > 0
                  ? money(
                      totalPreview / form.participantMemberIds.length,
                      baseCurrency,
                      locale,
                    )
                  : t("ledger.noPeopleSelected")}{" "}
                {t("ledger.each")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {members.map((member) => {
                const selected = form.participantMemberIds.includes(member.id);
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => toggleParticipant(member.id)}
                    className={`rounded-full px-3 py-2 text-xs font-bold transition ${
                      selected
                        ? "bg-emerald-700 text-white"
                        : "bg-white text-stone-600"
                    }`}
                  >
                    {member.displayName}
                  </button>
                );
              })}
            </div>
            {form.accountingMode === "stats_only" ? (
              <p className="text-xs leading-5 text-emerald-900/70">
                {t("ledger.statsOnlyNote")}
              </p>
            ) : null}
            {isSharedSplitInvalid ? (
              <p className="text-xs font-bold text-red-700">
                {t("ledger.error.splitMembersRequired")}
              </p>
            ) : null}
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-bold text-stone-800">
                {t("planner.field.location")}
              </span>
              <input
                value={form.addressText}
                onChange={(event) =>
                  updateForm({ addressText: event.target.value })
                }
                placeholder={t("ledger.placeholder.location")}
                className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-bold text-stone-800">
                {t("ledger.field.notes")}
              </span>
              <input
                value={form.description}
                onChange={(event) =>
                  updateForm({ description: event.target.value })
                }
                placeholder={t("ledger.placeholder.notes")}
                className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium text-stone-600">
              {t("ledger.baseAmount")}{" "}
              <span className="font-bold text-stone-950">
                {money(totalPreview, baseCurrency, locale)}
              </span>
            </p>
            <button
              type="submit"
              disabled={isSaving || isSharedSplitInvalid}
              className="rounded-full bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:bg-stone-300"
            >
              {isSaving
                ? t("common.saving")
                : editingEntryId
                  ? t("ledger.updateExpense")
                  : t("ledger.saveExpense")}
            </button>
          </div>
          {saveError ? (
            <p className="rounded-2xl bg-red-50 p-3 text-sm font-medium text-red-700">
              {saveError}
            </p>
          ) : null}
        </form>
      ) : null}

      <section className="rounded-3xl border border-stone-200 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-4 gap-1">
          {[
            ["days", t("ledger.tabs.days")],
            ["expenses", t("ledger.tabs.expenses")],
            ["people", t("ledger.tabs.personal")],
            ["settlement", t("ledger.tabs.settlement")],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setActiveView(value as LedgerView)}
              className={`rounded-2xl px-3 py-3 text-sm font-bold transition ${
                activeView === value
                  ? "bg-emerald-700 text-white"
                  : "text-stone-600 hover:bg-stone-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {activeView === "days" ? (
        <DailyLedgerAnalysis
          key={initialLedgerDate ?? "nearest"}
          reports={dailyReports}
          currency={displayCurrency}
          initialDate={initialLedgerDate}
          onEditEntry={startEditExpense}
          onDeleteEntry={removeExpense}
          deletingEntryId={deletingEntryId}
        />
      ) : null}

      {activeView === "expenses" ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-stone-950">
              {trimmedExpenseSearchQuery
                ? t("ledger.search.resultsTitle")
                : t("ledger.expensesByDate")}
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              {trimmedExpenseSearchQuery
                ? t("ledger.search.resultsDescription", {
                    keyword: trimmedExpenseSearchQuery,
                  })
                : t("ledger.expensesByDateDescription")}
            </p>
          </div>
          <div className="overflow-x-auto rounded-3xl bg-white p-2 shadow-sm">
            <div className="flex min-w-max gap-2">
              {(["all", ...categories] as ExpenseCategoryFilter[]).map((category) => {
                const active = expenseCategoryFilter === category;
                const categoryTotal =
                  category === "all"
                    ? ledgerData.summary.totalBase
                    : expenseCategoryTotals[category];

                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setExpenseCategoryFilter(category)}
                    className={`rounded-2xl px-3 py-2 text-left text-xs font-bold ${
                      active
                        ? "bg-emerald-700 text-white"
                        : "bg-stone-50 text-stone-700"
                    }`}
                  >
                    <span className="block">
                      {category === "all"
                        ? t("ledger.category.all")
                        : t(categoryLabelKeys[category])}
                    </span>
                    <span
                      className={`mt-1 block text-[11px] ${
                        active ? "text-white/80" : "text-stone-500"
                      }`}
                    >
                      {money(categoryTotal, displayCurrency, locale)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto rounded-3xl bg-white px-3 py-2 shadow-sm">
            <label className="flex shrink-0 items-center gap-2">
              <span className="text-xs font-bold text-stone-500">
                {t("ledger.sort.label")}
              </span>
              <select
                value={expenseSortMode}
                onChange={(event) =>
                  setExpenseSortMode(event.target.value as ExpenseSortMode)
                }
                className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs font-bold text-stone-900 outline-none focus:border-emerald-300"
              >
                <option value="latest">{t("ledger.sort.latest")}</option>
                <option value="date">{t("ledger.sort.date")}</option>
                <option value="amount">{t("ledger.sort.amount")}</option>
              </select>
            </label>
            <div className="h-8 w-px shrink-0 bg-stone-100" />
            {[
              [
                t("ledger.filteredTotal"),
                money(expenseFilterSummary.total, displayCurrency, locale),
                "text-emerald-900",
              ],
              [
                t("ledger.shared"),
                money(expenseFilterSummary.shared, displayCurrency, locale),
                "text-amber-900",
              ],
              [
                t("ledger.statsOnly"),
                money(expenseFilterSummary.statsOnly, displayCurrency, locale),
                "text-stone-900",
              ],
              [t("ledger.filteredCount"), `${expenseFilterSummary.count}`, "text-stone-900"],
            ].map(([label, value, color]) => (
              <div key={label} className="min-w-[92px] shrink-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-stone-400">
                  {label}
                </p>
                <p className={`mt-0.5 text-sm font-black ${color}`}>{value}</p>
              </div>
            ))}
          </div>
          {ledgerData.entries.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-stone-200 bg-white p-5 text-stone-500">
              {t("ledger.empty.expenses")}
            </div>
          ) : filteredExpenseEntries.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-stone-200 bg-white p-5 text-stone-500">
              {trimmedExpenseSearchQuery
                ? t("ledger.empty.searchExpenses")
                : t("ledger.empty.filteredExpenses")}
            </div>
          ) : (
            expenseSections.map(({ date, entries }) => (
              <section
                key={date}
                className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm"
              >
                <div className="flex items-center justify-between bg-[#fff8ec] px-4 py-3">
                  <h3 className="font-semibold text-stone-950">
                    {dateLabel(date, locale)}
                  </h3>
                  <p className="text-sm font-bold text-emerald-800">
                    {money(
                      entries.reduce((sum, entry) => sum + entry.baseAmount, 0),
                      displayCurrency,
                      locale,
                    )}
                  </p>
                </div>
                <div className="divide-y divide-stone-100">
                  {entries.map((entry) => (
                    <article key={entry.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="font-semibold text-stone-950">
                              {entry.title}
                            </h4>
                            <span
                              className={`rounded-full px-2 py-1 text-[11px] font-bold ${
                                entry.accountingMode === "shared"
                                  ? "bg-amber-50 text-amber-800"
                                  : "bg-stone-100 text-stone-600"
                              }`}
                            >
                              {entry.accountingMode === "shared"
                                ? t("ledger.shared")
                                : t("ledger.statsOnly")}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-stone-500">
                            {t(categoryLabelKeys[entry.category])}
                            {entry.payer
                              ? ` · ${t("ledger.paidByName", {
                                  name: entry.payer.displayName,
                                })}`
                              : ""}
                          </p>
                          {entry.description ? (
                            <p className="mt-2 text-sm leading-6 text-stone-600">
                              {entry.description}
                            </p>
                          ) : null}
                          {entry.participants.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {entry.participants.map((participant) =>
                                participant.member ? (
                                  <MemberPill
                                    key={participant.id}
                                    member={participant.member}
                                  />
                                ) : null,
                              )}
                            </div>
                          ) : null}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => startEditExpense(entry)}
                              className="rounded-full bg-stone-100 px-3 py-1.5 text-xs font-bold text-stone-700"
                            >
                              {t("common.edit")}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeExpense(entry)}
                              disabled={deletingEntryId === entry.id}
                              className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 disabled:text-red-300"
                            >
                              {deletingEntryId === entry.id
                                ? t("common.deleting")
                                : t("common.delete")}
                            </button>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-stone-950">
                            {money(entry.baseAmount, displayCurrency, locale)}
                          </p>
                          <p className="mt-1 text-xs text-stone-500">
                            {entry.originalAmount} {entry.originalCurrency}
                          </p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))
          )}
        </section>
      ) : null}

      {activeView === "people" ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-stone-950">
              {t("ledger.personalReports")}
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              {t("ledger.personalReportsDescription")}
            </p>
          </div>
          {memberReports.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-stone-200 bg-white p-5 text-stone-500">
              {t("ledger.empty.people")}
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {memberReports.map((report) => (
                <PersonReportCard
                  key={report.member.id}
                  report={report}
                  currency={displayCurrency}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeView === "settlement" ? (
        <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-stone-950">
              {t("ledger.sharedBalance")}
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              {t("ledger.sharedBalanceDescription")}
            </p>
            <div className="mt-3 space-y-3">
              {ledgerData.summary.balances.map((balance) => (
                <div
                  key={balance.member.id}
                  className="rounded-2xl bg-stone-50 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold text-stone-950">
                      {balance.member.displayName}
                    </p>
                    <p
                      className={`text-sm font-bold ${
                        balance.balance >= 0
                          ? "text-emerald-800"
                          : "text-amber-800"
                      }`}
                    >
                      {money(balance.balance, displayCurrency, locale)}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-stone-500">
                    {t("ledger.balanceLine", {
                      paid: money(balance.paidTotal, displayCurrency, locale),
                      owes: money(balance.owedTotal, displayCurrency, locale),
                    })}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-stone-950">
              {t("ledger.suggestedTransfers")}
            </h2>
            {ledgerData.summary.settlements.length === 0 ? (
              <p className="mt-3 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-900">
                {t("ledger.noSettlementNeeded")}
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {ledgerData.summary.settlements.map((settlement) => (
                  <div
                    key={`${settlement.fromMember.id}-${settlement.toMember.id}-${settlement.amount}`}
                    className="rounded-2xl bg-amber-50 p-3 text-sm"
                  >
                    <span className="font-bold text-stone-950">
                      {settlement.fromMember.displayName}
                    </span>{" "}
                    {t("ledger.pays")}{" "}
                    <span className="font-bold text-stone-950">
                      {settlement.toMember.displayName}
                    </span>
                    <p className="mt-1 font-bold text-amber-900">
                      {money(settlement.amount, settlement.currency, locale)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </section>
      ) : null}
    </div>
  );
}

export default function LedgerPage() {
  return (
    <AuthGate>{() => <LedgerContent />}</AuthGate>
  );
}
