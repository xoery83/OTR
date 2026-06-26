import type {
  CreateLedgerEntryInput,
  JourneyLedger,
  JourneyMember,
  LedgerCategory,
  LedgerEntry,
  LedgerEntryParticipant,
  LedgerMemberBalance,
  LedgerSettlementSuggestion,
  UpdateLedgerEntryInput,
} from "@/types";
import { getApproxExchangeRate } from "@/lib/exchange-rates";
import { getCurrentUser } from "./auth";
import { getJourneyMembers } from "./journey-members";
import { supabase } from "./client";

type JourneyLedgerRow = {
  id: string;
  journey_id: string;
  base_currency: string;
  display_currency: string;
  created_at: string;
  updated_at: string;
};

type LedgerEntryRow = {
  id: string;
  journey_id: string;
  itinerary_event_id: string | null;
  itinerary_reservation_id: string | null;
  memory_entry_id: string | null;
  title: string;
  description: string | null;
  category: LedgerCategory;
  accounting_mode: "stats_only" | "shared";
  expense_date: string;
  start_date: string | null;
  end_date: string | null;
  original_amount: number | string;
  original_currency: string;
  base_amount: number | string;
  base_currency: string;
  exchange_rate: number | string;
  exchange_rate_date: string | null;
  exchange_rate_source: string | null;
  payer_member_id: string | null;
  address_text: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  location_source: string | null;
  status: "draft" | "complete" | "needs_review";
  created_by_member_id: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

type LedgerParticipantRow = {
  id: string;
  ledger_entry_id: string;
  member_id: string;
  split_method: "equal" | "custom_amount" | "custom_percentage";
  share_amount: number | string | null;
  share_percentage: number | string | null;
  computed_share_base_amount: number | string | null;
  created_at: string;
  updated_at: string;
};

type LinkedReservationRangeRow = {
  id: string;
  starts_at: string | null;
  ends_at: string | null;
};

type LinkedEventRangeRow = {
  id: string;
  planned_start: string | null;
  planned_end: string | null;
};

export type LedgerSummary = {
  totalBase: number;
  sharedBase: number;
  statsOnlyBase: number;
  incompleteCount: number;
  byCategory: Record<LedgerCategory, number>;
  byCurrency: Record<string, number>;
  balances: LedgerMemberBalance[];
  settlements: LedgerSettlementSuggestion[];
};

export type LedgerData = {
  ledger: JourneyLedger;
  members: JourneyMember[];
  entries: LedgerEntry[];
  summary: LedgerSummary;
};

const ledgerCategories: LedgerCategory[] = [
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

function toNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  return Number(value);
}

function mapLedger(row: JourneyLedgerRow): JourneyLedger {
  return {
    id: row.id,
    journeyId: row.journey_id,
    baseCurrency: row.base_currency,
    displayCurrency: row.display_currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapParticipant(
  row: LedgerParticipantRow,
  membersById: Map<string, JourneyMember>,
): LedgerEntryParticipant {
  return {
    id: row.id,
    ledgerEntryId: row.ledger_entry_id,
    memberId: row.member_id,
    splitMethod: row.split_method,
    shareAmount: toNumber(row.share_amount),
    sharePercentage: toNumber(row.share_percentage),
    computedShareBaseAmount: toNumber(row.computed_share_base_amount),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    member: membersById.get(row.member_id),
  };
}

function mapEntry(
  row: LedgerEntryRow,
  participants: LedgerEntryParticipant[],
  membersById: Map<string, JourneyMember>,
): LedgerEntry {
  return {
    id: row.id,
    journeyId: row.journey_id,
    itineraryEventId: row.itinerary_event_id,
    itineraryReservationId: row.itinerary_reservation_id,
    memoryEntryId: row.memory_entry_id,
    title: row.title,
    description: row.description,
    category: row.category,
    accountingMode: row.accounting_mode,
    expenseDate: row.expense_date,
    startDate: row.start_date,
    endDate: row.end_date,
    originalAmount: Number(row.original_amount),
    originalCurrency: row.original_currency,
    baseAmount: Number(row.base_amount),
    baseCurrency: row.base_currency,
    exchangeRate: Number(row.exchange_rate),
    exchangeRateDate: row.exchange_rate_date,
    exchangeRateSource: row.exchange_rate_source,
    payerMemberId: row.payer_member_id,
    addressText: row.address_text,
    latitude: toNumber(row.latitude),
    longitude: toNumber(row.longitude),
    locationSource: row.location_source,
    status: row.status,
    createdByMemberId: row.created_by_member_id,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    payer: row.payer_member_id ? membersById.get(row.payer_member_id) ?? null : null,
    participants,
  };
}

function activeLedgerMembers(members: JourneyMember[]) {
  return members.filter(
    (member) => member.role === "owner" || member.role === "group_member",
  );
}

function dateOnly(value: string | null | undefined) {
  return value ? value.slice(0, 10) : null;
}

async function applyLinkedDateRanges(entries: LedgerEntry[]) {
  const reservationIds = [
    ...new Set(
      entries
        .map((entry) => entry.itineraryReservationId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const eventIds = [
    ...new Set(
      entries
        .map((entry) => entry.itineraryEventId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [{ data: reservationRows, error: reservationError }, { data: eventRows, error: eventError }] =
    await Promise.all([
      reservationIds.length > 0
        ? supabase
            .from("itinerary_reservations")
            .select("id, starts_at, ends_at")
            .in("id", reservationIds)
        : Promise.resolve({ data: [], error: null }),
      eventIds.length > 0
        ? supabase
            .from("itinerary_events")
            .select("id, planned_start, planned_end")
            .in("id", eventIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (reservationError) throw reservationError;
  if (eventError) throw eventError;

  const reservationRanges = new Map(
    ((reservationRows ?? []) as LinkedReservationRangeRow[]).map((row) => {
      const startDate = dateOnly(row.starts_at) ?? dateOnly(row.ends_at);
      return [
        row.id,
        {
          startDate,
          endDate: dateOnly(row.ends_at) ?? startDate,
        },
      ];
    }),
  );
  const eventRanges = new Map(
    ((eventRows ?? []) as LinkedEventRangeRow[]).map((row) => {
      const startDate = dateOnly(row.planned_start) ?? dateOnly(row.planned_end);
      return [
        row.id,
        {
          startDate,
          endDate: dateOnly(row.planned_end) ?? startDate,
        },
      ];
    }),
  );

  return entries.map((entry) => {
    if (entry.startDate && entry.endDate) {
      return entry;
    }

    const range =
      (entry.itineraryReservationId
        ? reservationRanges.get(entry.itineraryReservationId)
        : null) ??
      (entry.itineraryEventId ? eventRanges.get(entry.itineraryEventId) : null);

    if (!range?.startDate) {
      return entry;
    }

    return {
      ...entry,
      startDate: entry.startDate ?? range.startDate,
      endDate: entry.endDate ?? range.endDate ?? range.startDate,
    };
  });
}

function currentUserMember(members: JourneyMember[], userId: string) {
  return members.find((member) => member.userId === userId) ?? null;
}

async function ensureJourneyLedger(journeyId: string) {
  const { data: existing, error: selectError } = await supabase
    .from("journey_ledgers")
    .select("*")
    .eq("journey_id", journeyId)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return mapLedger(existing as JourneyLedgerRow);

  const { data, error } = await supabase
    .from("journey_ledgers")
    .insert({
      journey_id: journeyId,
      base_currency: "NZD",
      display_currency: "NZD",
    })
    .select("*")
    .single();

  if (error) throw error;
  return mapLedger(data as JourneyLedgerRow);
}

function emptyCategoryTotals() {
  return ledgerCategories.reduce(
    (totals, category) => ({ ...totals, [category]: 0 }),
    {} as Record<LedgerCategory, number>,
  );
}

function calculateSettlements(
  balances: LedgerMemberBalance[],
  currency: string,
): LedgerSettlementSuggestion[] {
  const debtors = balances
    .filter((balance) => balance.balance < -0.005)
    .map((balance) => ({
      member: balance.member,
      amount: Math.abs(balance.balance),
    }))
    .sort((a, b) => b.amount - a.amount);
  const creditors = balances
    .filter((balance) => balance.balance > 0.005)
    .map((balance) => ({
      member: balance.member,
      amount: balance.balance,
    }))
    .sort((a, b) => b.amount - a.amount);

  const suggestions: LedgerSettlementSuggestion[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtors[debtorIndex] && creditors[creditorIndex]) {
    const amount = Math.min(
      debtors[debtorIndex].amount,
      creditors[creditorIndex].amount,
    );

    if (amount > 0.005) {
      suggestions.push({
        fromMember: debtors[debtorIndex].member,
        toMember: creditors[creditorIndex].member,
        amount,
        currency,
      });
    }

    debtors[debtorIndex].amount -= amount;
    creditors[creditorIndex].amount -= amount;

    if (debtors[debtorIndex].amount <= 0.005) debtorIndex += 1;
    if (creditors[creditorIndex].amount <= 0.005) creditorIndex += 1;
  }

  return suggestions;
}

function calculateSummary(
  entries: LedgerEntry[],
  members: JourneyMember[],
  currency: string,
): LedgerSummary {
  const byCategory = emptyCategoryTotals();
  const byCurrency: Record<string, number> = {};
  const activeMembers = activeLedgerMembers(members);
  const balanceByMember = new Map(
    activeMembers.map((member) => [
      member.id,
      {
        member,
        paidTotal: 0,
        owedTotal: 0,
        statsOnlyTotal: 0,
        balance: 0,
      } satisfies LedgerMemberBalance,
    ]),
  );

  let totalBase = 0;
  let sharedBase = 0;
  let statsOnlyBase = 0;
  let incompleteCount = 0;

  entries.forEach((entry) => {
    totalBase += entry.baseAmount;
    byCategory[entry.category] += entry.baseAmount;
    byCurrency[entry.originalCurrency] =
      (byCurrency[entry.originalCurrency] ?? 0) + entry.originalAmount;
    if (entry.status !== "complete") incompleteCount += 1;

    if (entry.accountingMode === "stats_only") {
      statsOnlyBase += entry.baseAmount;

      if (entry.participants.length > 0) {
        entry.participants.forEach((participant) => {
          const balance = balanceByMember.get(participant.memberId);
          if (balance) {
            balance.statsOnlyTotal += participant.computedShareBaseAmount ?? 0;
          }
        });
      } else if (entry.payerMemberId) {
        const payerBalance = balanceByMember.get(entry.payerMemberId);
        if (payerBalance) {
          payerBalance.statsOnlyTotal += entry.baseAmount;
        }
      }
      return;
    }

    sharedBase += entry.baseAmount;
    if (entry.payerMemberId) {
      const balance = balanceByMember.get(entry.payerMemberId);
      if (balance) balance.paidTotal += entry.baseAmount;
    }

    entry.participants.forEach((participant) => {
      const balance = balanceByMember.get(participant.memberId);
      if (balance) {
        balance.owedTotal += participant.computedShareBaseAmount ?? 0;
      }
    });
  });

  const balances = [...balanceByMember.values()].map((balance) => ({
    ...balance,
    balance: balance.paidTotal - balance.owedTotal,
  }));

  return {
    totalBase,
    sharedBase,
    statsOnlyBase,
    incompleteCount,
    byCategory,
    byCurrency,
    balances,
    settlements: calculateSettlements(balances, currency),
  };
}

async function rebaseEntriesForDisplayCurrency(
  entries: LedgerEntry[],
  displayCurrency: string,
) {
  const targetCurrency = displayCurrency.toUpperCase();
  const rateCache = new Map<string, number>();

  async function rateFor(fromCurrency: string) {
    const from = fromCurrency.toUpperCase();
    const cacheKey = `${from}-${targetCurrency}`;

    if (rateCache.has(cacheKey)) {
      return rateCache.get(cacheKey)!;
    }

    const result = await getApproxExchangeRate(from, targetCurrency);
    rateCache.set(cacheKey, result.rate);
    return result.rate;
  }

  return Promise.all(
    entries.map(async (entry) => {
      const rate = await rateFor(entry.originalCurrency);
      const baseAmount = Number((entry.originalAmount * rate).toFixed(2));
      const equalShare =
        entry.participants.length > 0
          ? Number((baseAmount / entry.participants.length).toFixed(2))
          : null;

      return {
        ...entry,
        baseAmount,
        baseCurrency: targetCurrency,
        exchangeRate: rate,
        participants: entry.participants.map((participant) => ({
          ...participant,
          computedShareBaseAmount:
            equalShare ?? participant.computedShareBaseAmount,
        })),
      };
    }),
  );
}

export async function getLedgerData(journeyId: string): Promise<LedgerData> {
  const [ledger, members] = await Promise.all([
    ensureJourneyLedger(journeyId),
    getJourneyMembers(journeyId),
  ]);
  const membersById = new Map(members.map((member) => [member.id, member]));

  const { data: entryRows, error: entriesError } = await supabase
    .from("ledger_entries")
    .select("*")
    .eq("journey_id", journeyId)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (entriesError) throw entriesError;

  const entries = (entryRows ?? []) as LedgerEntryRow[];
  const entryIds = entries.map((entry) => entry.id);
  const { data: participantRows, error: participantsError } =
    entryIds.length > 0
      ? await supabase
          .from("ledger_entry_participants")
          .select("*")
          .in("ledger_entry_id", entryIds)
      : { data: [], error: null };

  if (participantsError) throw participantsError;

  const participantsByEntry = new Map<string, LedgerEntryParticipant[]>();
  ((participantRows ?? []) as LedgerParticipantRow[]).forEach((row) => {
    const participant = mapParticipant(row, membersById);
    participantsByEntry.set(row.ledger_entry_id, [
      ...(participantsByEntry.get(row.ledger_entry_id) ?? []),
      participant,
    ]);
  });

  const mappedEntries = entries.map((entry) =>
    mapEntry(entry, participantsByEntry.get(entry.id) ?? [], membersById),
  );
  const rangeAwareEntries = await applyLinkedDateRanges(mappedEntries);
  const displayCurrency = ledger.displayCurrency || ledger.baseCurrency;
  const displayEntries = await rebaseEntriesForDisplayCurrency(
    rangeAwareEntries,
    displayCurrency,
  );

  return {
    ledger,
    members,
    entries: displayEntries,
    summary: calculateSummary(
      displayEntries,
      members,
      displayCurrency,
    ),
  };
}

export async function updateJourneyLedgerCurrency({
  journeyId,
  baseCurrency,
  displayCurrency,
}: {
  journeyId: string;
  baseCurrency: string;
  displayCurrency: string;
}) {
  await ensureJourneyLedger(journeyId);

  const { error } = await supabase
    .from("journey_ledgers")
    .update({
      base_currency: baseCurrency.trim().toUpperCase(),
      display_currency: displayCurrency.trim().toUpperCase(),
    })
    .eq("journey_id", journeyId);

  if (error) throw error;
}

export async function createLedgerEntry(input: CreateLedgerEntryInput) {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be logged in to add expenses.");

  const members = await getJourneyMembers(input.journeyId);
  const creatorMember = currentUserMember(members, user.id);
  const amount = Number(input.originalAmount);
  const rate = Number(input.exchangeRate || 1);
  const baseAmount = Number((amount * rate).toFixed(2));
  const participantMemberIds = [
    ...new Set(
      input.accountingMode === "shared" &&
      (!input.participantMemberIds || input.participantMemberIds.length === 0) &&
      input.payerMemberId
        ? [input.payerMemberId]
        : (input.participantMemberIds ?? []),
    ),
  ];
  const shareAmount =
    participantMemberIds.length > 0
      ? Number((baseAmount / participantMemberIds.length).toFixed(2))
      : null;

  const { data, error } = await supabase
    .from("ledger_entries")
    .insert({
      journey_id: input.journeyId,
      itinerary_event_id: input.itineraryEventId || null,
      itinerary_reservation_id: input.itineraryReservationId || null,
      memory_entry_id: input.memoryEntryId || null,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      category: input.category,
      accounting_mode: input.accountingMode,
      expense_date: input.expenseDate,
      start_date: input.startDate || null,
      end_date: input.endDate || null,
      original_amount: amount,
      original_currency: input.originalCurrency.toUpperCase(),
      base_amount: baseAmount,
      base_currency: input.baseCurrency.toUpperCase(),
      exchange_rate: rate,
      exchange_rate_date: input.expenseDate,
      exchange_rate_source:
        input.originalCurrency.toUpperCase() === input.baseCurrency.toUpperCase()
          ? "same_currency"
          : "manual",
      payer_member_id: input.payerMemberId || null,
      address_text: input.addressText?.trim() || null,
      location_source: input.addressText?.trim() ? "manual" : null,
      status:
        input.accountingMode === "shared" &&
        (!input.payerMemberId || participantMemberIds.length === 0)
          ? "needs_review"
          : "complete",
      created_by_member_id: creatorMember?.id ?? null,
      created_by_user_id: user.id,
    })
    .select("id")
    .single();

  if (error) throw error;

  if (participantMemberIds.length > 0) {
    const { error: participantError } = await supabase
      .from("ledger_entry_participants")
      .insert(
        participantMemberIds.map((memberId) => ({
          ledger_entry_id: data.id,
          member_id: memberId,
          split_method: "equal",
          computed_share_base_amount: shareAmount,
        })),
      );

    if (participantError) throw participantError;
  }
}

export async function updateLedgerEntry(input: UpdateLedgerEntryInput) {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be logged in to update expenses.");

  const amount = Number(input.originalAmount);
  const rate = Number(input.exchangeRate || 1);
  const baseAmount = Number((amount * rate).toFixed(2));
  const participantMemberIds = [
    ...new Set(
      input.accountingMode === "shared" &&
      (!input.participantMemberIds || input.participantMemberIds.length === 0) &&
      input.payerMemberId
        ? [input.payerMemberId]
        : (input.participantMemberIds ?? []),
    ),
  ];
  const shareAmount =
    participantMemberIds.length > 0
      ? Number((baseAmount / participantMemberIds.length).toFixed(2))
      : null;

  const { error } = await supabase
    .from("ledger_entries")
    .update({
      title: input.title.trim(),
      description: input.description?.trim() || null,
      category: input.category,
      accounting_mode: input.accountingMode,
      expense_date: input.expenseDate,
      start_date: input.startDate || null,
      end_date: input.endDate || null,
      original_amount: amount,
      original_currency: input.originalCurrency.toUpperCase(),
      base_amount: baseAmount,
      base_currency: input.baseCurrency.toUpperCase(),
      exchange_rate: rate,
      exchange_rate_date: input.expenseDate,
      exchange_rate_source:
        input.originalCurrency.toUpperCase() === input.baseCurrency.toUpperCase()
          ? "same_currency"
          : "manual",
      payer_member_id: input.payerMemberId || null,
      address_text: input.addressText?.trim() || null,
      location_source: input.addressText?.trim() ? "manual" : null,
      status:
        input.accountingMode === "shared" &&
        (!input.payerMemberId || participantMemberIds.length === 0)
          ? "needs_review"
          : "complete",
    })
    .eq("id", input.id)
    .eq("journey_id", input.journeyId);

  if (error) throw error;

  const { error: deleteParticipantsError } = await supabase
    .from("ledger_entry_participants")
    .delete()
    .eq("ledger_entry_id", input.id);

  if (deleteParticipantsError) throw deleteParticipantsError;

  if (participantMemberIds.length > 0) {
    const { error: participantError } = await supabase
      .from("ledger_entry_participants")
      .insert(
        participantMemberIds.map((memberId) => ({
          ledger_entry_id: input.id,
          member_id: memberId,
          split_method: "equal",
          computed_share_base_amount: shareAmount,
        })),
      );

    if (participantError) throw participantError;
  }
}

export async function deleteLedgerEntry(entryId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("You must be logged in to delete expenses.");

  const { error } = await supabase
    .from("ledger_entries")
    .delete()
    .eq("id", entryId);

  if (error) throw error;
}
