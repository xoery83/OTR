"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { getErrorMessage } from "@/lib/errors";
import { getTrip } from "@/lib/supabase/trips";
import type { Trip } from "@/types";

function JourneyMapContent() {
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadTrip() {
      try {
        const data = await getTrip(tripId);
        if (isMounted) setTrip(data);
      } catch (mapError) {
        if (isMounted) {
          setError(getErrorMessage(mapError, "Could not load journey map."));
        }
      }
    }

    loadTrip();
    return () => {
      isMounted = false;
    };
  }, [tripId]);

  return (
    <section className="rounded-[28px] border border-stone-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-bold text-emerald-800">Journey Map</p>
      <h1 className="mt-1 text-3xl font-semibold text-stone-950">
        {trip?.name || "Map"}
      </h1>
      <p className="mt-3 max-w-2xl text-base leading-7 text-stone-600">
        A spatial view for routes, bookings, memories, places, and live member
        locations will live here.
      </p>

      {error ? (
        <p className="mt-4 rounded-2xl bg-red-50 p-3 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {[
          ["Live", "Member locations, last update, distance from me"],
          ["Route", "Journey route, hotels, airports, major stops"],
          ["Day", "Daily route, attractions, parking, fuel, restaurants"],
          ["Memories", "Photo, voice, text, and video markers"],
          ["Places", "Hotels, supermarkets, trailheads, emergency points"],
        ].map(([title, description]) => (
          <div key={title} className="rounded-2xl bg-emerald-50 p-4">
            <h2 className="font-semibold text-emerald-950">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-emerald-900/75">
              {description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function JourneyMapPage() {
  return <AuthGate>{() => <JourneyMapContent />}</AuthGate>;
}
