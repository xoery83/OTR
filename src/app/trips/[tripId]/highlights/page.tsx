"use client";

import { useParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";

function HighlightsContent() {
  const { tripId } = useParams<{ tripId: string }>();
  const sections = [
    "Best Photos",
    "Funniest Moments",
    "Best Meals",
    "Biggest Disaster",
    "Daily Summaries",
    "AI Highlights coming soon",
  ];

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm font-semibold text-emerald-700">Highlights</p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          Journey Highlights
        </h1>
        <p className="mt-3 text-base leading-7 text-stone-600">
          Highlights for {tripId} are placeholders for now.
        </p>
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        {sections.map((section) => (
          <div key={section} className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-stone-950">{section}</h2>
            <p className="mt-2 text-sm text-stone-500">Coming soon</p>
          </div>
        ))}
      </section>
    </div>
  );
}

export default function HighlightsPage() {
  return <AuthGate>{() => <HighlightsContent />}</AuthGate>;
}
