"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { MemoryCard } from "@/components/MemoryCard";
import { formatDateRange, formatTime } from "@/lib/format";
import { getJourneyDayNumber, getJourneyStatus } from "@/lib/journeys/status";
import {
  getActiveJourneyMembers,
  getJourneyParticipantCount,
  getMemoryStats,
  getTodayMemoryStats,
} from "@/lib/journeys/stats";
import { getCurrentUser } from "@/lib/supabase/auth";
import { getItineraryEvents } from "@/lib/supabase/itinerary";
import { getJourneyMembers } from "@/lib/supabase/journey-members";
import { getLedgerData, type LedgerData } from "@/lib/supabase/ledger";
import {
  getSignedMemoryImageUrls,
  getTripMemories,
} from "@/lib/supabase/memories";
import { deleteTrip, getTrip } from "@/lib/supabase/trips";
import type { ItineraryEvent, JourneyMember, MemoryEntry, Trip } from "@/types";

type TutorialId = "import" | "capture" | "expense" | "map" | "invite" | "aka";

type TutorialCard = {
  id: TutorialId;
  title: string;
  copy: string;
  cta: string;
  href?: string;
  icon: string;
  completed: boolean;
};

const itineraryExamples = [
  {
    title: "Iceland starter",
    text: `7 Jul\nArrive Reykjavik\nCheck in Hotel Cabin\nBlue Lagoon\n\n8 Jul\nGolden Circle\nThingvellir\nGeysir\nGullfoss`,
  },
  {
    title: "NZ road trip",
    text: `Day 1\nDrive from Auckland to Rotorua\nLunch at Hobbiton\nStay at Lakefront Lodge\n\nDay 2\nWai-O-Tapu in the morning\nDrive to Taupo\nDinner near the lake`,
  },
];

function memberInitial(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");
}

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function widgetClass() {
  return "rounded-3xl border border-stone-200 bg-white p-4 shadow-sm";
}

function ImportTutorialModal({
  tripId,
  onClose,
}: {
  tripId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [rawText, setRawText] = useState(itineraryExamples[0].text);

  function continueToImport() {
    window.localStorage.setItem(`otr:planner-import-draft:${tripId}`, rawText);
    router.push(`/trips/${tripId}/planner/import`);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-stone-950/30 p-3 sm:place-items-center">
      <section className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-emerald-800">Import Planner</p>
            <h2 className="mt-1 text-2xl font-semibold text-stone-950">
              Paste an itinerary for AI
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              Use dates, days, places, bookings, and rough notes. OTR will turn it
              into planner days and schedule items.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-stone-600"
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {itineraryExamples.map((example) => (
            <button
              key={example.title}
              type="button"
              onClick={() => setRawText(example.text)}
              className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-left text-sm font-bold text-emerald-900"
            >
              Use example: {example.title}
            </button>
          ))}
        </div>

        <textarea
          value={rawText}
          onChange={(event) => setRawText(event.target.value)}
          rows={10}
          className="mt-4 w-full resize-none rounded-2xl border border-stone-200 bg-[#fffdf8] p-4 text-sm leading-6 text-stone-950 outline-none focus:border-emerald-600"
        />

        <button
          type="button"
          onClick={continueToImport}
          disabled={!rawText.trim()}
          className="mt-4 w-full rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:bg-stone-300"
        >
          Continue to AI Import
        </button>
      </section>
    </div>
  );
}

function TripDashboardContent() {
  const params = useParams<{ tripId: string }>();
  const router = useRouter();
  const tripId = params.tripId;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [members, setMembers] = useState<JourneyMember[]>([]);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [events, setEvents] = useState<ItineraryEvent[]>([]);
  const [ledgerData, setLedgerData] = useState<LedgerData | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [hideTutorials, setHideTutorials] = useState(false);
  const [skippedTutorials, setSkippedTutorials] = useState<TutorialId[]>([]);

  useEffect(() => {
    let isMounted = true;

    async function loadDashboard() {
      try {
        const [tripData, memberData, memoryData, user] = await Promise.all([
          getTrip(tripId),
          getJourneyMembers(tripId),
          getTripMemories(tripId),
          getCurrentUser(),
        ]);
        const [eventData, signedUrls, ledgerSnapshot] = await Promise.all([
          getItineraryEvents(tripId),
          getSignedMemoryImageUrls(memoryData),
          getLedgerData(tripId).catch(() => null),
        ]);

        if (isMounted) {
          setTrip(tripData);
          setMembers(memberData);
          setMemories(memoryData);
          setEvents(eventData);
          setImageUrls(signedUrls);
          setLedgerData(ledgerSnapshot);
          setCurrentUserId(user?.id ?? null);
          setHideTutorials(
            window.localStorage.getItem(`otr:overview-hide-tutorials:${tripId}`) ===
              "1",
          );
          setSkippedTutorials(
            JSON.parse(
              window.localStorage.getItem(`otr:overview-skipped:${tripId}`) || "[]",
            ) as TutorialId[],
          );
        }
      } catch (dashboardError) {
        if (isMounted) {
          setError(
            dashboardError instanceof Error
              ? dashboardError.message
              : "Could not load trip.",
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadDashboard();

    return () => {
      isMounted = false;
    };
  }, [tripId]);

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-5 text-sm font-medium text-stone-600 shadow-sm">
        Loading trip...
      </div>
    );
  }

  if (error || !trip) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-700">
        {error || "Trip not found."}
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayEvents = events.filter((event) => event.plannedStart?.startsWith(today));
  const status = getJourneyStatus(trip);
  const dayNumber = getJourneyDayNumber(trip);
  const totalStats = getMemoryStats(memories);
  const todayStats = getTodayMemoryStats(memories);
  const currentMember = members.find((member) => member.userId === currentUserId);
  const activeMembers = getActiveJourneyMembers(members);
  const participantCount = getJourneyParticipantCount(members);
  const canManageJourney =
    currentMember?.role === "owner" || trip.createdBy === currentUserId;
  const ledgerCurrency = ledgerData?.ledger.displayCurrency || ledgerData?.ledger.baseCurrency || "NZD";
  const ledgerTotal = ledgerData?.summary.totalBase ?? 0;
  const hasExpense = (ledgerData?.entries.length ?? 0) > 0;
  const hasMapContent = memories.some((memory) => memory.locationName) || events.some((event) => event.locationName);
  const hasPlanner = events.length > 0;
  const hasInvitedPeople = activeMembers.length > 1;
  const hasEnoughAka = activeMembers.filter((member) => member.notes?.trim()).length >= 2;

  const tutorials: TutorialCard[] = [
    {
      id: "import",
      icon: "✦",
      title: "Import your itinerary",
      copy: "Paste your travel plan and let AI build your planner.",
      cta: "Import now",
      completed: hasPlanner,
    },
    {
      id: "capture",
      icon: "+",
      title: "Capture your first moment",
      copy: "Record anything with voice, photo or text.",
      cta: "Try Capture",
      href: `/trips/${trip.id}/capture`,
      completed: memories.length > 0,
    },
    {
      id: "expense",
      icon: "$",
      title: "Add your first expense",
      copy: "Track shared costs and settle later.",
      cta: "Add Expense",
      href: `/trips/${trip.id}/ledger`,
      completed: hasExpense,
    },
    {
      id: "map",
      icon: "⌖",
      title: "Explore the map",
      copy: "See your memories and plans on a travel map.",
      cta: "Open Map",
      href: `/trips/${trip.id}/map`,
      completed: hasMapContent,
    },
    {
      id: "invite",
      icon: "@",
      title: "Invite your friends",
      copy: "Travel together in one shared Journey.",
      cta: "Invite Members",
      href: `/trips/${trip.id}/invite`,
      completed: hasInvitedPeople,
    },
    {
      id: "aka",
      icon: "Aa",
      title: "Add traveler nicknames",
      copy: "Fill AKA for at least two people so OTR can recognize names in notes and voice.",
      cta: "Add AKA",
      href: `/trips/${trip.id}/people`,
      completed: hasEnoughAka,
    },
  ];
  const activeTutorials = tutorials.filter(
    (item) => !item.completed && !skippedTutorials.includes(item.id),
  );
  const completedTutorials = tutorials.filter(
    (item) => item.completed || skippedTutorials.includes(item.id),
  );

  function skipTutorial(id: TutorialId) {
    const next = [...new Set([...skippedTutorials, id])];
    setSkippedTutorials(next);
    window.localStorage.setItem(`otr:overview-skipped:${tripId}`, JSON.stringify(next));
  }

  function hideAllTutorials() {
    setHideTutorials(true);
    window.localStorage.setItem(`otr:overview-hide-tutorials:${tripId}`, "1");
  }

  async function handleDeleteJourney() {
    if (!trip) {
      return;
    }

    if (!canManageJourney) {
      setError("Only journey owners and admins can delete this journey.");
      return;
    }

    if (deleteConfirmation !== trip.name) {
      setError("Type the journey name exactly before deleting.");
      return;
    }

    setIsDeleting(true);
    setError(null);

    try {
      await deleteTrip(trip.id);
      router.replace("/trips");
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete journey.",
      );
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-emerald-700">Journey Home</p>
            <h1 className="mt-1 truncate text-3xl font-semibold text-stone-950">
              {trip.name}
            </h1>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              {formatDateRange(trip.startDate, trip.endDate)}
              {trip.destination ? ` · ${trip.destination}` : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-800">
                {status}
              </span>
              {dayNumber ? (
                <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-700">
                  Day {dayNumber}
                </span>
              ) : null}
              <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-700">
                {participantCount} travelers
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:w-64">
            <div className="rounded-2xl bg-stone-50 p-3">
              <p className="text-xl font-semibold text-stone-950">
                {status === "completed" ? totalStats.total : todayStats.total}
              </p>
              <p className="text-xs text-stone-500">
                {status === "completed" ? "total memories" : "today memories"}
              </p>
            </div>
            <div className="rounded-2xl bg-stone-50 p-3">
              <p className="text-xl font-semibold text-stone-950">{events.length}</p>
              <p className="text-xs text-stone-500">planner items</p>
            </div>
          </div>
        </div>
      </section>

      {!hideTutorials ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-emerald-700">Getting Started</p>
              <h2 className="mt-1 text-2xl font-semibold text-stone-950">
                Next best actions
              </h2>
            </div>
            <button
              type="button"
              onClick={hideAllTutorials}
              className="rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-stone-600"
            >
              Hide tutorials
            </button>
          </div>
          {activeTutorials.length > 0 ? (
            <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-2">
              {activeTutorials.map((item) => (
                <article
                  key={item.id}
                  className="flex min-w-[260px] max-w-[280px] flex-col justify-between rounded-3xl border border-emerald-100 bg-white p-4 shadow-sm"
                >
                  <div>
                    <div className="grid size-10 place-items-center rounded-2xl bg-emerald-50 text-lg font-black text-emerald-800">
                      {item.icon}
                    </div>
                    <h3 className="mt-3 text-lg font-semibold text-stone-950">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-stone-600">
                      {item.copy}
                    </p>
                  </div>
                  <div className="mt-4 grid gap-2">
                    {item.id === "import" ? (
                      <button
                        type="button"
                        onClick={() => setIsImportOpen(true)}
                        className="rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white"
                      >
                        {item.cta}
                      </button>
                    ) : (
                      <Link
                        href={item.href ?? `/trips/${trip.id}`}
                        className="rounded-2xl bg-emerald-700 px-4 py-3 text-center text-sm font-bold text-white"
                      >
                        {item.cta}
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => skipTutorial(item.id)}
                      className="rounded-2xl bg-stone-100 px-4 py-2 text-xs font-bold text-stone-600"
                    >
                      Skip
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <details className="rounded-3xl bg-emerald-50 p-4">
              <summary className="cursor-pointer text-sm font-bold text-emerald-900">
                All getting started tasks are complete
              </summary>
              <div className="mt-3 flex flex-wrap gap-2">
                {completedTutorials.map((item) => (
                  <span
                    key={item.id}
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-emerald-800"
                  >
                    ✓ {item.title}
                  </span>
                ))}
              </div>
            </details>
          )}
        </section>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <article className={widgetClass()}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-950">Planner</h2>
              <p className="mt-1 text-sm text-stone-500">Today&apos;s Plan</p>
            </div>
            <Link href={`/trips/${trip.id}/planner`} className="text-sm font-bold text-emerald-800">
              Open
            </Link>
          </div>
          {todayEvents.length > 0 ? (
            <div className="mt-4 space-y-2">
              {todayEvents.slice(0, 3).map((event) => (
                <div key={event.id} className="rounded-2xl bg-stone-50 px-3 py-2 text-sm">
                  <span className="font-bold text-emerald-800">
                    {event.plannedStart ? formatTime(event.plannedStart) : "Any"}
                  </span>{" "}
                  {event.title}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-2xl bg-stone-50 p-3 text-sm text-stone-600">
              No itinerary yet. <button type="button" onClick={() => setIsImportOpen(true)} className="font-bold text-emerald-800">Import itinerary →</button>
            </p>
          )}
        </article>

        <article className={widgetClass()}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-950">Capture</h2>
              <p className="mt-1 text-sm text-stone-500">Recent memory</p>
            </div>
            <Link href={`/trips/${trip.id}/capture`} className="text-sm font-bold text-emerald-800">
              Capture
            </Link>
          </div>
          {memories[0] ? (
            <p className="mt-4 line-clamp-3 rounded-2xl bg-stone-50 p-3 text-sm leading-6 text-stone-700">
              {memories[0].content || "Photo memory"}
            </p>
          ) : (
            <p className="mt-4 rounded-2xl bg-stone-50 p-3 text-sm text-stone-600">
              No memories yet. Capture your first moment →
            </p>
          )}
        </article>

        <article className={widgetClass()}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-950">Ledger</h2>
              <p className="mt-1 text-sm text-stone-500">
                Today&apos;s and total spending
              </p>
            </div>
            <Link href={`/trips/${trip.id}/ledger`} className="text-sm font-bold text-emerald-800">
              Open
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-emerald-50 p-3">
              <p className="text-xs font-bold text-emerald-800">Total</p>
              <p className="mt-1 font-semibold text-emerald-950">
                {money(ledgerTotal, ledgerCurrency)}
              </p>
            </div>
            <div className="rounded-2xl bg-stone-50 p-3">
              <p className="text-xs font-bold text-stone-500">Entries</p>
              <p className="mt-1 font-semibold text-stone-950">
                {ledgerData?.entries.length ?? 0}
              </p>
            </div>
          </div>
        </article>

        <article className={widgetClass()}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-950">Map</h2>
              <p className="mt-1 text-sm text-stone-500">Locations and memories</p>
            </div>
            <Link href={`/trips/${trip.id}/map`} className="text-sm font-bold text-emerald-800">
              Open
            </Link>
          </div>
          <p className="mt-4 rounded-2xl bg-stone-50 p-3 text-sm text-stone-600">
            {hasMapContent
              ? "Mapped stops are ready. Open the full map to explore."
              : "Map will appear after locations are added."}
          </p>
        </article>

        <article className={widgetClass()}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-950">People</h2>
              <p className="mt-1 text-sm text-stone-500">Traveling with</p>
            </div>
            <Link href={`/trips/${trip.id}/people`} className="text-sm font-bold text-emerald-800">
              Manage
            </Link>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {activeMembers.length > 0 ? (
              activeMembers.slice(0, 8).map((member) => (
                <Link
                  key={member.id}
                  href={member.userId ? `/people/${member.userId}` : `/trips/${trip.id}/people`}
                  className="grid size-9 place-items-center overflow-hidden rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-800 ring-2 ring-white"
                  title={member.displayName}
                >
                  {member.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={member.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    memberInitial(member.displayName)
                  )}
                </Link>
              ))
            ) : (
              <p className="text-sm text-stone-600">Only you are here. Invite friends →</p>
            )}
          </div>
        </article>

        <article className={widgetClass()}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-stone-950">Timeline</h2>
              <p className="mt-1 text-sm text-stone-500">Your travel story</p>
            </div>
            <Link href={`/trips/${trip.id}/timeline`} className="text-sm font-bold text-emerald-800">
              Open
            </Link>
          </div>
          <p className="mt-4 rounded-2xl bg-stone-50 p-3 text-sm text-stone-600">
            {memories.length > 0
              ? `${memories.length} memories are building your story.`
              : "Your travel story starts here."}
          </p>
        </article>
      </section>

      {memories.length > 0 ? (
        <section className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-emerald-700">Latest</p>
              <h2 className="mt-1 text-2xl font-semibold text-stone-950">
                Recent memories
              </h2>
            </div>
            <Link
              href={`/trips/${trip.id}/timeline`}
              className="rounded-full bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800"
            >
              View full timeline
            </Link>
          </div>
          <div className="space-y-4">
            {memories.slice(0, 3).map((memory) => (
              <MemoryCard
                key={memory.id}
                memory={memory}
                displayUrl={memory.mediaUrl ? imageUrls[memory.mediaUrl] : undefined}
              />
            ))}
          </div>
        </section>
      ) : null}

      {canManageJourney ? (
        <section className="rounded-3xl border border-red-200 bg-red-50 p-5 shadow-sm">
          <h2 className="text-xl font-semibold text-red-900">Danger Zone</h2>
          <p className="mt-2 text-sm leading-6 text-red-800">
            Delete this journey and all related memories, media records, members,
            and planner items. Storage files may remain in the bucket and can be
            cleaned separately.
          </p>
          <label
            htmlFor="delete-journey-confirm"
            className="mt-4 block text-sm font-bold text-red-900"
          >
            Type “{trip.name}” to confirm
          </label>
          <input
            id="delete-journey-confirm"
            value={deleteConfirmation}
            onChange={(event) => setDeleteConfirmation(event.target.value)}
            className="mt-3 w-full rounded-2xl border border-red-200 bg-white px-4 py-3 text-stone-950 outline-none focus:border-red-500 focus:ring-4 focus:ring-red-100"
          />
          <button
            type="button"
            onClick={handleDeleteJourney}
            disabled={isDeleting || deleteConfirmation !== trip.name}
            className="mt-4 w-full rounded-2xl bg-red-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-red-200 disabled:text-red-500"
          >
            {isDeleting ? "Deleting journey..." : "Delete Journey"}
          </button>
        </section>
      ) : null}

      {isImportOpen ? (
        <ImportTutorialModal tripId={trip.id} onClose={() => setIsImportOpen(false)} />
      ) : null}
    </div>
  );
}

export default function TripDashboardPage() {
  return <AuthGate>{() => <TripDashboardContent />}</AuthGate>;
}
