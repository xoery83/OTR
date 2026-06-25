"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { getApproxExchangeRate } from "@/lib/exchange-rates";
import { getErrorMessage } from "@/lib/errors";
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

const categories: { value: LedgerCategory; label: string }[] = [
  { value: "flight", label: "Flight" },
  { value: "hotel", label: "Hotel" },
  { value: "car", label: "Car" },
  { value: "fuel", label: "Fuel" },
  { value: "food", label: "Food" },
  { value: "ticket", label: "Ticket" },
  { value: "shopping", label: "Shopping" },
  { value: "transport", label: "Transport" },
  { value: "insurance", label: "Insurance" },
  { value: "other", label: "Other" },
];

const commonCurrencies = ["NZD", "CNY", "EUR", "DKK", "USD", "ISK", "GBP"];

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

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function groupedByDate(entries: LedgerEntry[]) {
  return entries.reduce<Record<string, LedgerEntry[]>>((groups, entry) => {
    groups[entry.expenseDate] = [...(groups[entry.expenseDate] ?? []), entry];
    return groups;
  }, {});
}

function categoryLabel(value: LedgerCategory) {
  return categories.find((category) => category.value === value)?.label ?? value;
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

function buildDailyLedgerReports(entries: LedgerEntry[]) {
  const reports = new Map<string, DailyLedgerReport>();

  entries.forEach((entry) => {
    const dates = getEntryAllocationDates(entry);
    const allocatedAmount = Number((entry.baseAmount / dates.length).toFixed(2));
    const allocationNote =
      dates.length > 1
        ? `${money(entry.baseAmount, entry.baseCurrency)} split across ${
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
            (totals, category) => ({ ...totals, [category.value]: 0 }),
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

function categoryColor(index: number) {
  return [
    "bg-emerald-600",
    "bg-amber-500",
    "bg-sky-500",
    "bg-rose-500",
    "bg-violet-500",
    "bg-lime-600",
    "bg-orange-500",
    "bg-stone-500",
  ][index % 8];
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
        (totals, category) => ({ ...totals, [category.value]: 0 }),
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
}: {
  label: string;
  value: string;
  tone?: "emerald" | "amber" | "stone";
}) {
  const toneClass = {
    emerald: "bg-emerald-50 text-emerald-900",
    amber: "bg-amber-50 text-amber-900",
    stone: "bg-stone-50 text-stone-900",
  }[tone];

  return (
    <div className={`rounded-3xl p-4 ${toneClass}`}>
      <p className="text-xs font-bold uppercase tracking-[0.12em] opacity-70">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
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
            {report.entryCount} related expenses
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-800">
            Trip cost
          </p>
          <p className="mt-1 text-xl font-semibold text-emerald-950">
            {money(report.totalTripCost, currency)}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-amber-50 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-amber-800">
            Shared share
          </p>
          <p className="mt-1 font-semibold text-amber-950">
            {money(report.sharedCost, currency)}
          </p>
        </div>
        <div className="rounded-2xl bg-stone-50 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-stone-500">
            Personal stats
          </p>
          <p className="mt-1 font-semibold text-stone-950">
            {money(report.personalCost, currency)}
          </p>
        </div>
        <div className="rounded-2xl bg-emerald-50 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">
            Paid shared
          </p>
          <p className="mt-1 font-semibold text-emerald-950">
            {money(report.paidShared, currency)}
          </p>
        </div>
        <div className="rounded-2xl bg-stone-50 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-stone-500">
            Settlement
          </p>
          <p
            className={`mt-1 font-semibold ${
              report.settlementBalance >= 0
                ? "text-emerald-900"
                : "text-amber-900"
            }`}
          >
            {money(report.settlementBalance, currency)}
          </p>
        </div>
      </div>

      {topCategories.length > 0 ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-stone-500">
            Category mix
          </p>
          {topCategories.map(([category, amount]) => (
            <div
              key={category}
              className="flex items-center justify-between gap-3 rounded-2xl bg-[#fff8ec] px-3 py-2 text-sm"
            >
              <span className="font-semibold text-stone-700">
                {categoryLabel(category)}
              </span>
              <span className="font-bold text-stone-950">
                {money(amount, currency)}
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
  onEditEntry,
  onDeleteEntry,
  deletingEntryId,
}: {
  reports: DailyLedgerReport[];
  currency: string;
  onEditEntry: (entry: LedgerEntry) => void;
  onDeleteEntry: (entry: LedgerEntry) => void;
  deletingEntryId: string | null;
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
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
        No expenses yet. Daily analysis will appear after costs are recorded.
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-stone-950">
          Daily expense analysis
        </h2>
        <p className="mt-1 text-sm text-stone-500">
          Costs are allocated by travel day. Multi-day expenses are averaged
          across their date range.
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
                  {money(report.total, currency)}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Day total"
          value={money(activeReport.total, currency)}
        />
        <StatCard
          label="Shared"
          value={money(activeReport.shared, currency)}
          tone="amber"
        />
        <StatCard
          label="Stats only"
          value={money(activeReport.statsOnly, currency)}
          tone="stone"
        />
      </section>

      <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-stone-950">
              {dateLabel(activeReport.date)}
            </h3>
            <p className="mt-1 text-sm text-stone-500">
              {activeReport.entries.length} expense details
            </p>
          </div>
          <p className="text-right text-xl font-semibold text-emerald-900">
            {money(activeReport.total, currency)}
          </p>
        </div>

        {categoryBreakdown.length > 0 ? (
          <div className="mt-4 space-y-3">
            <div className="flex h-4 overflow-hidden rounded-full bg-stone-100">
              {categoryBreakdown.map(([category, amount], index) => (
                <div
                  key={category}
                  className={categoryColor(index)}
                  style={{
                    width: `${Math.max(
                      3,
                      (amount / activeReport.total) * 100,
                    )}%`,
                  }}
                  title={`${categoryLabel(category)} ${money(amount, currency)}`}
                />
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {categoryBreakdown.map(([category, amount], index) => {
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
                        className={`size-2.5 rounded-full ${categoryColor(index)}`}
                      />
                      {categoryLabel(category)}
                    </span>
                    <span className="text-right font-bold text-stone-950">
                      {money(amount, currency)} · {percent}%
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
          Details
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
                    {categoryLabel(entry.category)}
                  </span>
                  <span
                    className={`rounded-full px-2 py-1 text-[11px] font-bold ${
                      entry.accountingMode === "shared"
                        ? "bg-amber-50 text-amber-800"
                        : "bg-stone-100 text-stone-600"
                    }`}
                  >
                    {entry.accountingMode === "shared" ? "Shared" : "Stats only"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-stone-500">
                  {entry.payer ? `Paid by ${entry.payer.displayName}` : "No payer"}
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
                  {money(allocatedAmount, currency)}
                </p>
                {allocatedAmount !== entry.baseAmount ? (
                  <p className="mt-1 text-xs text-stone-500">
                    of {money(entry.baseAmount, currency)}
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
                Edit
              </button>
              <button
                type="button"
                onClick={() => onDeleteEntry(entry)}
                disabled={deletingEntryId === entry.id}
                className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 disabled:text-red-300"
              >
                {deletingEntryId === entry.id ? "Deleting..." : "Delete"}
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
  const tripId = params.tripId;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [ledgerData, setLedgerData] = useState<LedgerData | null>(null);
  const [form, setForm] = useState<LedgerFormState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [isSavingCurrency, setIsSavingCurrency] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<LedgerView>("days");
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
          setError(getErrorMessage(loadError, "Could not load ledger."));
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

  const entryGroups = useMemo(
    () => groupedByDate(ledgerData?.entries ?? []),
    [ledgerData?.entries],
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
    () => buildDailyLedgerReports(ledgerData?.entries ?? []),
    [ledgerData?.entries],
  );

  function updateForm(patch: Partial<LedgerFormState>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
  }

  function startCreateExpense() {
    if (ledgerData) {
      setForm(initialForm(ledgerData.ledger.baseCurrency, ledgerData.members));
    }
    setEditingEntryId(null);
    setShowForm((current) => !current || Boolean(editingEntryId));
  }

  function startEditExpense(entry: LedgerEntry) {
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
      participantMemberIds: entry.participants.map(
        (participant) => participant.memberId,
      ),
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
        getErrorMessage(currencyUpdateError, "Could not update currency."),
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
        participantMemberIds: form.participantMemberIds,
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
      setSaveError(getErrorMessage(submitError, "Could not save expense."));
    } finally {
      setIsSaving(false);
    }
  }

  async function removeExpense(entry: LedgerEntry) {
    const confirmed = globalThis.confirm(
      `Delete "${entry.title}" from the ledger?`,
    );
    if (!confirmed) return;

    setDeletingEntryId(entry.id);
    setSaveError(null);

    try {
      await deleteLedgerEntry(entry.id);
      applyLedgerSnapshot(await loadLedgerSnapshot());
    } catch (deleteError) {
      setSaveError(getErrorMessage(deleteError, "Could not delete expense."));
    } finally {
      setDeletingEntryId(null);
    }
  }

  if (isLoading) {
    return <div className="rounded-3xl bg-white p-5">Loading ledger...</div>;
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
        Ledger is not available yet.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-bold text-emerald-800">Journey Ledger</p>
            <h1 className="mt-1 text-2xl font-semibold text-stone-950">
              {trip?.name || "Trip accounting"}
            </h1>
            <p className="mt-2 text-sm text-stone-600">
              Track total costs, shared expenses, personal stats, and settlement.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 rounded-full bg-stone-50 px-3 py-2 text-xs font-bold text-stone-700">
              Base
              <select
                value={baseCurrency}
                disabled={isSavingCurrency}
                onChange={(event) => saveCurrencySettings(event.target.value)}
                className="bg-transparent text-sm font-bold text-stone-950 outline-none"
                title="Journey base currency"
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
              Add Expense
            </button>
          </div>
        </div>
        {currencyError ? (
          <p className="mt-3 rounded-2xl bg-red-50 p-3 text-sm font-medium text-red-700">
            {currencyError}
          </p>
        ) : null}
      </section>

      <section className="grid gap-3 sm:grid-cols-4">
        <StatCard
          label="Total cost"
          value={money(ledgerData.summary.totalBase, displayCurrency)}
        />
        <StatCard
          label="Shared"
          value={money(ledgerData.summary.sharedBase, displayCurrency)}
          tone="amber"
        />
        <StatCard
          label="Stats only"
          value={money(ledgerData.summary.statsOnlyBase, displayCurrency)}
          tone="stone"
        />
        <StatCard
          label="Needs review"
          value={`${ledgerData.summary.incompleteCount}`}
          tone="stone"
        />
      </section>

      {showForm ? (
        <form
          onSubmit={submitExpense}
          className="space-y-4 rounded-3xl border border-emerald-100 bg-white p-4 shadow-sm"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-950">
                {editingEntryId ? "Edit expense" : "Add expense"}
              </h2>
              <p className="mt-1 text-sm text-stone-500">
                {editingEntryId
                  ? "Update the amount, payer, split, date, or notes."
                  : "Manual entry is here for cleanup; day cards can still detect costs from memories."}
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
              Cancel
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-bold text-stone-800">Title</span>
              <input
                value={form.title}
                onChange={(event) => updateForm({ title: event.target.value })}
                required
                placeholder="Dinner in Reykjavik"
                className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-bold text-stone-800">Category</span>
              <select
                value={form.category}
                onChange={(event) =>
                  updateForm({ category: event.target.value as LedgerCategory })
                }
                className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
              >
                {categories.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <label className="space-y-1 sm:col-span-2">
              <span className="text-sm font-bold text-stone-800">Amount</span>
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
              <span className="text-sm font-bold text-stone-800">Currency</span>
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
                Rate to {baseCurrency}
                {isLoadingRate ? " · loading" : ""}
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
              <span className="text-sm font-bold text-stone-800">Expense date</span>
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
              <span className="text-sm font-bold text-stone-800">Start date</span>
              <input
                value={form.startDate}
                onChange={(event) => updateForm({ startDate: event.target.value })}
                type="date"
                className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-bold text-stone-800">End date</span>
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
              <span className="text-sm font-bold text-stone-800">Accounting mode</span>
              <select
                value={form.accountingMode}
                onChange={(event) =>
                  updateForm({
                    accountingMode: event.target.value as LedgerAccountingMode,
                  })
                }
                className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
              >
                <option value="shared">Shared · split later</option>
                <option value="stats_only">Stats only · no split</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-bold text-stone-800">Payer</span>
              <select
                value={form.payerMemberId}
                onChange={(event) =>
                  updateForm({ payerMemberId: event.target.value })
                }
                className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
              >
                <option value="">Select payer</option>
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
                  ? "Split participants"
                  : "Count for"}
              </p>
              <p className="text-xs font-semibold text-emerald-800">
                Equal share ·{" "}
                {form.participantMemberIds.length > 0
                  ? money(
                      totalPreview / form.participantMemberIds.length,
                      baseCurrency,
                    )
                  : "No people selected"}{" "}
                each
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
                Stats only entries are included in personal trip cost stats, not
                final settlement.
              </p>
            ) : null}
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-bold text-stone-800">Location</span>
              <input
                value={form.addressText}
                onChange={(event) =>
                  updateForm({ addressText: event.target.value })
                }
                placeholder="Restaurant, airport, hotel..."
                className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-bold text-stone-800">Notes</span>
              <input
                value={form.description}
                onChange={(event) =>
                  updateForm({ description: event.target.value })
                }
                placeholder="Optional context"
                className="w-full rounded-2xl border border-stone-200 px-4 py-3 text-stone-950 outline-none focus:border-emerald-300"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium text-stone-600">
              Base amount:{" "}
              <span className="font-bold text-stone-950">
                {money(totalPreview, baseCurrency)}
              </span>
            </p>
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-full bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:bg-stone-300"
            >
              {isSaving
                ? "Saving..."
                : editingEntryId
                  ? "Update expense"
                  : "Save expense"}
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
            ["days", "Days"],
            ["expenses", "Expenses"],
            ["people", "People"],
            ["settlement", "Settlement"],
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
          reports={dailyReports}
          currency={displayCurrency}
          onEditEntry={startEditExpense}
          onDeleteEntry={removeExpense}
          deletingEntryId={deletingEntryId}
        />
      ) : null}

      {activeView === "expenses" ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-stone-950">
              Expenses by date
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              All recorded costs, grouped by payment date.
            </p>
          </div>
          {ledgerData.entries.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-stone-200 bg-white p-5 text-stone-500">
              No expenses yet. Add the first one when someone pays for the group.
            </div>
          ) : (
            Object.entries(entryGroups).map(([date, entries]) => (
              <section
                key={date}
                className="overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm"
              >
                <div className="flex items-center justify-between bg-[#fff8ec] px-4 py-3">
                  <h3 className="font-semibold text-stone-950">
                    {dateLabel(date)}
                  </h3>
                  <p className="text-sm font-bold text-emerald-800">
                    {money(
                      entries.reduce((sum, entry) => sum + entry.baseAmount, 0),
                      displayCurrency,
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
                                ? "Shared"
                                : "Stats only"}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-stone-500">
                            {categoryLabel(entry.category)}
                            {entry.payer
                              ? ` · paid by ${entry.payer.displayName}`
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
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => removeExpense(entry)}
                              disabled={deletingEntryId === entry.id}
                              className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 disabled:text-red-300"
                            >
                              {deletingEntryId === entry.id
                                ? "Deleting..."
                                : "Delete"}
                            </button>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-stone-950">
                            {money(entry.baseAmount, displayCurrency)}
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
              Personal cost reports
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              Each person&apos;s real trip cost: shared share plus stats-only
              personal expenses.
            </p>
          </div>
          {memberReports.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-stone-200 bg-white p-5 text-stone-500">
              Add journey members before building personal reports.
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
              Shared expense balance
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              Only shared expenses are included here. Stats-only costs are
              excluded from AA settlement.
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
                      {money(balance.balance, displayCurrency)}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-stone-500">
                    Paid {money(balance.paidTotal, displayCurrency)} · owes{" "}
                    {money(balance.owedTotal, displayCurrency)}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-stone-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-semibold text-stone-950">
              Suggested transfers
            </h2>
            {ledgerData.summary.settlements.length === 0 ? (
              <p className="mt-3 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-900">
                No settlement needed yet.
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
                    pays{" "}
                    <span className="font-bold text-stone-950">
                      {settlement.toMember.displayName}
                    </span>
                    <p className="mt-1 font-bold text-amber-900">
                      {money(settlement.amount, settlement.currency)}
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
