"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { getErrorMessage } from "@/lib/errors";
import { createTrip } from "@/lib/supabase/trips";

function NewTripForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const trip = await createTrip(
        {
          name,
          destination,
          startDate,
          endDate,
        }
      );
      router.push(`/trips/${trip.id}`);
    } catch (tripError) {
      setError(getErrorMessage(tripError, "Could not create trip."));
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm font-semibold text-emerald-700">New trip</p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          Create a group trip
        </h1>
        <p className="mt-3 text-base leading-7 text-stone-600">
          The database trigger will add you as the trip owner automatically.
        </p>
      </section>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
      >
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-bold text-stone-800">
            Name
          </label>
          <input
            id="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            placeholder="Iceland 2026"
            className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-stone-950 placeholder:text-stone-500 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-100"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="destination"
            className="text-sm font-bold text-stone-800"
          >
            Destination
          </label>
          <input
            id="destination"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            placeholder="Reykjavik, South Coast"
            className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-stone-950 placeholder:text-stone-500 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-100"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label
              htmlFor="start-date"
              className="text-sm font-bold text-stone-800"
            >
              Start date
            </label>
            <input
              id="start-date"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-stone-950 placeholder:text-stone-500 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="end-date"
              className="text-sm font-bold text-stone-800"
            >
              End date
            </label>
            <input
              id="end-date"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-stone-950 placeholder:text-stone-500 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !name.trim()}
          className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          Create trip
        </button>

        {error ? (
          <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}
      </form>
    </div>
  );
}

export default function NewTripPage() {
  return <AuthGate>{() => <NewTripForm />}</AuthGate>;
}
