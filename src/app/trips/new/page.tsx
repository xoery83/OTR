"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { getAppOrigin } from "@/lib/app-url";
import { getErrorMessage } from "@/lib/errors";
import { createJourneyInvite } from "@/lib/supabase/invites";
import {
  createJourneyMember,
  getJourneyMemberSuggestions,
  type JourneyMemberSuggestion,
} from "@/lib/supabase/journey-members";
import { createTrip, updateTripSettings } from "@/lib/supabase/trips";
import type { PhotoStorageProvider, Trip } from "@/types";

type Step = 1 | 2 | 3;

type TravelerDraft = {
  id: string;
  name: string;
  email: string;
  suggestionKey?: string;
};

type InviteLink = {
  travelerName: string;
  email: string;
  url: string;
};

type StorageChoice = "none" | "google_drive" | "onedrive";

const fallbackCover =
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1600&q=80";

function createDraftTraveler() {
  return {
    id: crypto.randomUUID(),
    name: "",
    email: "",
  };
}

function generateAiCoverUrl(name: string, destination: string, variant = 1) {
  const subject = [destination, name, "group travel journey cover"]
    .filter(Boolean)
    .join(", ");
  const prompt = `cinematic travel photography cover, ${subject}, natural light, wide angle, no text, visual variation ${variant}`;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(
    prompt,
  )}?width=1600&height=900&nologo=true&seed=${Date.now()}-${variant}`;
}

function storageProviderFromChoice(choice: StorageChoice) {
  return choice === "none" ? null : (choice satisfies PhotoStorageProvider);
}

function StepPill({
  value,
  current,
  label,
}: {
  value: Step;
  current: Step;
  label: string;
}) {
  const active = value === current;
  const done = value < current;

  return (
    <div
      className={`flex min-w-0 items-center gap-2 rounded-full px-3 py-2 text-xs font-bold ${
        active
          ? "bg-emerald-700 text-white"
          : done
            ? "bg-emerald-50 text-emerald-800"
            : "bg-white text-stone-500"
      }`}
    >
      <span
        className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] ${
          active ? "bg-white/20" : "bg-stone-100"
        }`}
      >
        {value}
      </span>
      <span className="truncate">{label}</span>
    </div>
  );
}

function NewJourneyTour() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [travelers, setTravelers] = useState<TravelerDraft[]>([
    createDraftTraveler(),
  ]);
  const [suggestions, setSuggestions] = useState<JourneyMemberSuggestion[]>([]);
  const [createdTrip, setCreatedTrip] = useState<Trip | null>(null);
  const [inviteLinks, setInviteLinks] = useState<InviteLink[]>([]);
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [aiCoverCount, setAiCoverCount] = useState(0);
  const [storageChoice, setStorageChoice] = useState<StorageChoice>("none");
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSuggestions() {
      try {
        const data = await getJourneyMemberSuggestions();
        if (isMounted) setSuggestions(data);
      } catch {
        if (isMounted) setSuggestions([]);
      } finally {
        if (isMounted) setIsLoadingSuggestions(false);
      }
    }

    loadSuggestions();
    return () => {
      isMounted = false;
    };
  }, []);

  const canContinueStepOne = name.trim().length > 0;
  const activeTravelers = travelers.filter((traveler) => traveler.name.trim());
  const coverPreview = coverImageUrl || fallbackCover;

  const matchedSuggestions = useMemo(() => {
    const query = travelers
      .map((traveler) => traveler.name)
      .find((value) => value.trim().length > 0)
      ?.trim()
      .toLocaleLowerCase();

    if (!query) return suggestions.slice(0, 5);

    return suggestions
      .filter((suggestion) =>
        suggestion.displayName.toLocaleLowerCase().includes(query),
      )
      .slice(0, 5);
  }, [suggestions, travelers]);

  function updateTraveler(id: string, patch: Partial<TravelerDraft>) {
    setTravelers((current) =>
      current.map((traveler) =>
        traveler.id === id ? { ...traveler, ...patch } : traveler,
      ),
    );
  }

  function applySuggestion(travelerId: string, suggestion: JourneyMemberSuggestion) {
    updateTraveler(travelerId, {
      name: suggestion.displayName,
      email: suggestion.inviteEmail,
      suggestionKey: suggestion.key,
    });
  }

  function addTraveler() {
    setTravelers((current) => [...current, createDraftTraveler()]);
  }

  function removeTraveler(id: string) {
    setTravelers((current) =>
      current.length === 1
        ? [createDraftTraveler()]
        : current.filter((traveler) => traveler.id !== id),
    );
  }

  function continueFromStepOne(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canContinueStepOne) return;
    setError(null);
    setStep(2);
  }

  async function createJourneyAndInvites(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createdTrip) {
      setStep(3);
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const trip = await createTrip({
        name: name.trim(),
        destination: destination.trim(),
        startDate,
        endDate,
      });
      const origin = getAppOrigin();
      const createdInvites: InviteLink[] = [];

      for (const traveler of activeTravelers) {
        const email = traveler.email.trim();
        await createJourneyMember({
          tripId: trip.id,
          displayName: traveler.name.trim(),
          role: "group_member",
          inviteEmail: email,
        });

        const invite = await createJourneyInvite({
          tripId: trip.id,
          invitedEmail: email,
          role: "member",
          expiresInDays: "30",
          maxUses: 1,
        });
        createdInvites.push({
          travelerName: traveler.name.trim(),
          email,
          url: `${origin}/invite/${invite.token}`,
        });
      }

      setCreatedTrip(trip);
      setInviteLinks(createdInvites);
      setAiCoverCount(1);
      setCoverImageUrl(generateAiCoverUrl(name.trim(), destination.trim(), 1));
      setStep(3);
    } catch (createError) {
      setError(getErrorMessage(createError, "Could not create journey."));
    } finally {
      setIsCreating(false);
    }
  }

  async function saveSettingsAndOpenJourney() {
    if (!createdTrip) return;

    setIsSavingSettings(true);
    setError(null);

    try {
      await updateTripSettings({
        tripId: createdTrip.id,
        coverImageUrl: coverImageUrl.trim() || null,
        photoStorageProvider: storageProviderFromChoice(storageChoice),
      });
      router.push(`/trips/${createdTrip.id}`);
    } catch (settingsError) {
      setError(getErrorMessage(settingsError, "Could not save journey settings."));
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function copyInvite(url: string) {
    await navigator.clipboard.writeText(url);
    setCopiedUrl(url);
  }

  function generateNextCover() {
    if (aiCoverCount >= 3) return;
    const nextCount = aiCoverCount + 1;
    setAiCoverCount(nextCount);
    setCoverImageUrl(
      generateAiCoverUrl(name.trim(), destination.trim(), nextCount),
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm font-semibold text-emerald-700">New Journey</p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          Create a journey
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-stone-600">
          Set the basics, add travelers, then choose the cover and original photo
          storage.
        </p>
      </section>

      <div className="grid gap-2 sm:grid-cols-3">
        <StepPill value={1} current={step} label="Basics" />
        <StepPill value={2} current={step} label="Travelers" />
        <StepPill value={3} current={step} label="Cover & storage" />
      </div>

      {error ? (
        <p className="rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      {step === 1 ? (
        <form
          onSubmit={continueFromStepOne}
          className="space-y-5 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-bold text-stone-800">Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                placeholder="Iceland 2026"
                className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-stone-950 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-bold text-stone-800">Place</span>
              <input
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                placeholder="Reykjavik, South Coast"
                className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-stone-950 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-bold text-stone-800">Start date</span>
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-stone-950 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-bold text-stone-800">End date</span>
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-stone-950 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={!canContinueStepOne}
            className="w-full rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            Continue
          </button>
        </form>
      ) : null}

      {step === 2 ? (
        <form
          onSubmit={createJourneyAndInvites}
          className="space-y-5 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm"
        >
          <div>
            <h2 className="text-xl font-semibold text-stone-950">
              Who is traveling?
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              Type a name to reuse people you have traveled with before. Their
              previous invite email will be filled in when available.
            </p>
          </div>

          <div className="space-y-3">
            {travelers.map((traveler) => {
              const travelerSuggestions = traveler.name.trim()
                ? suggestions
                    .filter((suggestion) =>
                      suggestion.displayName
                        .toLocaleLowerCase()
                        .includes(traveler.name.trim().toLocaleLowerCase()),
                    )
                    .slice(0, 3)
                : matchedSuggestions.slice(0, 3);

              return (
                <section
                  key={traveler.id}
                  className="space-y-3 rounded-2xl bg-stone-50 p-3"
                >
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                    <label className="space-y-1">
                      <span className="text-xs font-bold text-stone-700">
                        Name
                      </span>
                      <input
                        value={traveler.name}
                        onChange={(event) =>
                          updateTraveler(traveler.id, {
                            name: event.target.value,
                            suggestionKey: undefined,
                          })
                        }
                        placeholder="Traveler name"
                        className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-stone-950 outline-none focus:border-emerald-600"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-bold text-stone-700">
                        Email
                      </span>
                      <input
                        value={traveler.email}
                        onChange={(event) =>
                          updateTraveler(traveler.id, {
                            email: event.target.value,
                          })
                        }
                        type="email"
                        placeholder="friend@example.com"
                        className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-stone-950 outline-none focus:border-emerald-600"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeTraveler(traveler.id)}
                      className="self-end rounded-2xl bg-white px-4 py-3 text-sm font-bold text-stone-500"
                    >
                      Remove
                    </button>
                  </div>

                  {travelerSuggestions.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {travelerSuggestions.map((suggestion) => (
                        <button
                          key={suggestion.key}
                          type="button"
                          onClick={() => applySuggestion(traveler.id, suggestion)}
                          className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-emerald-800 shadow-sm"
                        >
                          {suggestion.displayName}
                          {suggestion.inviteEmail ? ` · ${suggestion.inviteEmail}` : ""}
                        </button>
                      ))}
                    </div>
                  ) : isLoadingSuggestions ? (
                    <p className="text-xs font-medium text-stone-500">
                      Loading previous travelers...
                    </p>
                  ) : null}
                </section>
              );
            })}
          </div>

          <button
            type="button"
            onClick={addTraveler}
            className="w-full rounded-2xl bg-emerald-50 px-5 py-3 text-sm font-bold text-emerald-900"
          >
            Add traveler
          </button>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              disabled={isCreating}
              className="rounded-2xl bg-stone-100 px-5 py-3 text-sm font-bold text-stone-700 disabled:text-stone-400"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={isCreating || !canContinueStepOne}
              className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              {isCreating ? "Creating..." : "Create journey & invites"}
            </button>
          </div>
        </form>
      ) : null}

      {step === 3 ? (
        <section className="space-y-5 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
          {inviteLinks.length > 0 ? (
            <section className="space-y-3 rounded-3xl bg-emerald-50 p-4">
              <div>
                <h2 className="text-xl font-semibold text-stone-950">
                  Invite links are ready
                </h2>
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  Paste these directly to your friends.
                </p>
              </div>
              <div className="space-y-2">
                {inviteLinks.map((invite) => (
                  <div
                    key={invite.url}
                    className="grid gap-2 rounded-2xl bg-white p-3 sm:grid-cols-[1fr_auto]"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-stone-950">
                        {invite.travelerName}
                      </p>
                      <p className="truncate text-xs text-stone-500">
                        {invite.email || "Reusable invite link"}
                      </p>
                      <p className="mt-1 truncate text-xs text-emerald-800">
                        {invite.url}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyInvite(invite.url)}
                      className="rounded-2xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white"
                    >
                      {copiedUrl === invite.url ? "Copied" : "Copy"}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <div>
            <h2 className="text-xl font-semibold text-stone-950">
              Cover and storage
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              Use a URL, or generate a cover from the journey name and place.
            </p>
          </div>

          <div
            className="h-56 rounded-3xl bg-cover bg-center shadow-sm"
            style={{ backgroundImage: `url(${coverPreview})` }}
          />

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <input
              value={coverImageUrl}
              onChange={(event) => setCoverImageUrl(event.target.value)}
              placeholder="https://..."
              className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-stone-950 outline-none focus:border-emerald-600"
            />
            <button
              type="button"
              onClick={generateNextCover}
              disabled={aiCoverCount >= 3}
              className="rounded-2xl bg-stone-900 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              {aiCoverCount >= 3
                ? "AI limit reached"
                : `AI generate (${3 - aiCoverCount} left)`}
            </button>
          </div>

          <section className="space-y-3">
            <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-stone-500">
              Original photo storage
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  [
                    "none",
                    "Do not upload originals",
                    "Keep compressed OTR photos only for now.",
                  ],
                  [
                    "google_drive",
                    "Google Drive",
                    "Save originals to the journey owner's Drive.",
                  ],
                  [
                    "onedrive",
                    "Microsoft OneDrive",
                    "Prepare OneDrive as the original-photo destination.",
                  ],
                ] as const
              ).map(([value, label, description]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStorageChoice(value)}
                  className={`rounded-2xl border p-4 text-left transition ${
                    storageChoice === value
                      ? "border-emerald-600 bg-emerald-50"
                      : "border-stone-200 bg-white hover:border-stone-300"
                  }`}
                >
                  <span className="font-bold text-stone-950">{label}</span>
                  <span className="mt-2 block text-sm leading-6 text-stone-600">
                    {description}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={isSavingSettings}
              className="rounded-2xl bg-stone-100 px-5 py-3 text-sm font-bold text-stone-700 disabled:text-stone-400"
            >
              Back
            </button>
            <button
              type="button"
              onClick={saveSettingsAndOpenJourney}
              disabled={isSavingSettings || !createdTrip}
              className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              {isSavingSettings ? "Saving..." : "Open journey"}
            </button>
          </div>

          {createdTrip ? (
            <Link
              href={`/trips/${createdTrip.id}`}
              className="block rounded-2xl bg-emerald-50 px-5 py-3 text-center text-sm font-bold text-emerald-900"
            >
              Skip settings and open journey
            </Link>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export default function NewTripPage() {
  return <AuthGate>{() => <NewJourneyTour />}</AuthGate>;
}
