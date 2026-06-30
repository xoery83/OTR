"use client";

import { useEffect } from "react";
import { prefetchJourneyResource } from "@/hooks/useJourneyCachedResource";
import {
  journeyResourceKey,
  loadJourneyChatResource,
  loadJourneyLedgerResource,
  loadJourneyMapResource,
  loadJourneyPlannerResource,
  loadJourneyTimelineResource,
  loadJourneyTripResource,
} from "@/lib/journey-resources";

export function JourneyResourcePreloader({
  tripId,
  children,
}: {
  tripId: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    void prefetchJourneyResource(
      journeyResourceKey.trip(tripId),
      () => loadJourneyTripResource(tripId),
      { ttl: 10 * 60_000 },
    );

    const timer = window.setTimeout(() => {
      void prefetchJourneyResource(
        journeyResourceKey.planner(tripId),
        () => loadJourneyPlannerResource(tripId),
        { ttl: 3 * 60_000 },
      );
      void prefetchJourneyResource(
        journeyResourceKey.map(tripId),
        () => loadJourneyMapResource(tripId),
        { ttl: 90_000 },
      );
      void prefetchJourneyResource(
        journeyResourceKey.chat(tripId),
        () => loadJourneyChatResource(tripId),
        { ttl: 20_000 },
      );
      void prefetchJourneyResource(
        journeyResourceKey.timeline(tripId),
        () => loadJourneyTimelineResource(tripId),
        { ttl: 2 * 60_000 },
      );
      void prefetchJourneyResource(
        journeyResourceKey.ledger(tripId),
        () => loadJourneyLedgerResource(tripId),
        { ttl: 2 * 60_000 },
      );
    }, 120);

    return () => window.clearTimeout(timer);
  }, [tripId]);

  return children;
}
