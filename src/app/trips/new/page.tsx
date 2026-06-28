"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useI18n } from "@/components/I18nProvider";
import { getAppOrigin } from "@/lib/app-url";
import { getErrorMessage } from "@/lib/errors";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createJourneyInvite } from "@/lib/supabase/invites";
import {
  createJourneyMember,
  getJourneyMembers,
  getJourneyMemberSuggestions,
  type JourneyMemberSuggestion,
  updateJourneyMember,
} from "@/lib/supabase/journey-members";
import { getProfile } from "@/lib/supabase/profiles";
import { createTrip, updateTripSettings } from "@/lib/supabase/trips";
import type { PhotoStorageProvider, Trip } from "@/types";

type Step = 1 | 2 | 3;

type TravelerDraft = {
  id: string;
  name: string;
  email: string;
  notes: string;
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
    notes: "",
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
  const { t } = useI18n();
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
  const storageOptions = [
    [
      "none",
      t("journeyCreate.storage.none.title"),
      t("journeyCreate.storage.none.description"),
    ],
    [
      "google_drive",
      t("journeyCreate.storage.google.title"),
      t("journeyCreate.storage.google.description"),
    ],
    [
      "onedrive",
      t("journeyCreate.storage.onedrive.title"),
      t("journeyCreate.storage.onedrive.description"),
    ],
  ] as const;

  const matchedSuggestions = useMemo(() => {
    const query = travelers
      .map((traveler) => traveler.name)
      .find((value) => value.trim().length > 0)
      ?.trim()
      .toLocaleLowerCase();

    if (!query) return suggestions.slice(0, 5);

    return suggestions
      .filter((suggestion) =>
        `${suggestion.displayName} ${suggestion.notes}`
          .toLocaleLowerCase()
          .includes(query),
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
      notes: suggestion.notes,
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
      const currentUser = await getCurrentUser();
      const currentProfile = currentUser
        ? await getProfile(currentUser.id).catch(() => null)
        : null;
      const currentSuggestions =
        suggestions.length > 0 ? suggestions : await getJourneyMemberSuggestions();
      const ownerSuggestion = currentSuggestions.find(
        (suggestion) => suggestion.isCurrentUser && suggestion.notes.trim(),
      );
      const ownerAka =
        ownerSuggestion?.notes.trim() || currentProfile?.globalAka?.trim() || "";
      if (ownerAka) {
        const tripMembers = await getJourneyMembers(trip.id);
        const ownerMember = tripMembers.find(
          (member) => member.role === "owner" && member.userId === currentUser?.id,
        );

        if (ownerMember && !ownerMember.notes?.trim()) {
          await updateJourneyMember({
            memberId: ownerMember.id,
            notes: ownerAka,
          });
        }
      }

      const origin = getAppOrigin();
      const createdInvites: InviteLink[] = [];

      for (const traveler of activeTravelers) {
        const email = traveler.email.trim();
        await createJourneyMember({
          tripId: trip.id,
          displayName: traveler.name.trim(),
          role: "group_member",
          inviteEmail: email,
          notes: traveler.notes,
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
      setError(getErrorMessage(createError, t("journeyCreate.error.create")));
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
      router.push(`/trips/${createdTrip.id}/planner`);
    } catch (settingsError) {
      setError(
        getErrorMessage(settingsError, t("journeyCreate.error.saveSettings")),
      );
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
        <p className="text-sm font-semibold text-emerald-700">
          {t("journeyCreate.eyebrow")}
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          {t("journeyCreate.title")}
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-stone-600">
          {t("journeyCreate.description")}
        </p>
      </section>

      <div className="grid gap-2 sm:grid-cols-3">
        <StepPill value={1} current={step} label={t("journeyCreate.step.basics")} />
        <StepPill value={2} current={step} label={t("journeyCreate.step.travelers")} />
        <StepPill value={3} current={step} label={t("journeyCreate.step.coverStorage")} />
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
              <span className="text-sm font-bold text-stone-800">
                {t("journeyCreate.field.name")}
              </span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                placeholder={t("journeyCreate.placeholder.name")}
                className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-stone-950 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-bold text-stone-800">
                {t("journeyCreate.field.place")}
              </span>
              <input
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                placeholder={t("journeyCreate.placeholder.place")}
                className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-stone-950 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-bold text-stone-800">
                {t("journeyCreate.field.startDate")}
              </span>
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-stone-950 outline-none focus:border-emerald-600 focus:ring-4 focus:ring-emerald-100"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-bold text-stone-800">
                {t("journeyCreate.field.endDate")}
              </span>
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
            {t("journeyCreate.continue")}
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
              {t("journeyCreate.travelers.title")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              {t("journeyCreate.travelers.description")}
            </p>
          </div>

          <div className="space-y-3">
            {travelers.map((traveler) => {
              const travelerSuggestions = traveler.name.trim()
                ? suggestions
                    .filter((suggestion) =>
                      `${suggestion.displayName} ${suggestion.notes}`
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
                        {t("journeyCreate.field.name")}
                      </span>
                      <input
                        value={traveler.name}
                        onChange={(event) =>
                          updateTraveler(traveler.id, {
                            name: event.target.value,
                            suggestionKey: undefined,
                          })
                        }
                        placeholder={t("journeyCreate.placeholder.travelerName")}
                        className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-stone-950 outline-none focus:border-emerald-600"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-bold text-stone-700">
                        {t("journeyCreate.field.email")}
                      </span>
                      <input
                        value={traveler.email}
                        onChange={(event) =>
                          updateTraveler(traveler.id, {
                            email: event.target.value,
                          })
                        }
                        type="email"
                        placeholder={t("journeyCreate.placeholder.email")}
                        className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-stone-950 outline-none focus:border-emerald-600"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeTraveler(traveler.id)}
                      className="self-end rounded-2xl bg-white px-4 py-3 text-sm font-bold text-stone-500"
                    >
                      {t("journeyCreate.traveler.remove")}
                    </button>
                  </div>

                  <label className="space-y-1">
                    <span className="text-xs font-bold text-stone-700">
                      {t("journeyCreate.field.aka")}
                    </span>
                    <input
                      value={traveler.notes}
                      onChange={(event) =>
                        updateTraveler(traveler.id, {
                          notes: event.target.value,
                        })
                      }
                      placeholder={t("journeyCreate.placeholder.aka")}
                      className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-stone-950 outline-none focus:border-emerald-600"
                    />
                    <span className="block text-[11px] leading-5 text-stone-500">
                      {t("journeyCreate.akaHelp")}
                    </span>
                  </label>

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
                          {suggestion.notes ? ` · AKA ${suggestion.notes}` : ""}
                        </button>
                      ))}
                    </div>
                  ) : isLoadingSuggestions ? (
                    <p className="text-xs font-medium text-stone-500">
                      {t("journeyCreate.travelers.loading")}
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
            {t("journeyCreate.traveler.add")}
          </button>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              disabled={isCreating}
              className="rounded-2xl bg-stone-100 px-5 py-3 text-sm font-bold text-stone-700 disabled:text-stone-400"
            >
              {t("journeyCreate.back")}
            </button>
            <button
              type="submit"
              disabled={isCreating || !canContinueStepOne}
              className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              {isCreating
                ? t("journeyCreate.creating")
                : t("journeyCreate.create")}
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
                  {t("journeyCreate.invites.title")}
                </h2>
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  {t("journeyCreate.invites.description")}
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
                        {invite.email || t("journeyCreate.invites.reusable")}
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
                      {copiedUrl === invite.url
                        ? t("journeyCreate.copied")
                        : t("journeyCreate.copy")}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <div>
            <h2 className="text-xl font-semibold text-stone-950">
              {t("journeyCreate.cover.title")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">
              {t("journeyCreate.cover.description")}
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
                ? t("journeyCreate.ai.limit")
                : t("journeyCreate.ai.generate", { count: 3 - aiCoverCount })}
            </button>
          </div>

          <section className="space-y-3">
            <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-stone-500">
              {t("journeyCreate.storage.title")}
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {storageOptions.map(([value, label, description]) => (
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
              {t("journeyCreate.back")}
            </button>
            <button
              type="button"
              onClick={saveSettingsAndOpenJourney}
              disabled={isSavingSettings || !createdTrip}
              className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              {isSavingSettings
                ? t("journeyCreate.saving")
                : t("journeyCreate.openJourney")}
            </button>
          </div>

          {createdTrip ? (
            <Link
              href={`/trips/${createdTrip.id}/planner`}
              className="block rounded-2xl bg-emerald-50 px-5 py-3 text-center text-sm font-bold text-emerald-900"
            >
              {t("journeyCreate.skipSettings")}
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
