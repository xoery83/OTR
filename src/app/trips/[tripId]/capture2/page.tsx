"use client";

import { useParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { Capture2InboxContent } from "@/app/settings/capture2-inbox/page";

export default function JourneyCapture2Page() {
  const params = useParams<{ tripId: string }>();

  return (
    <AuthGate>
      {() => <Capture2InboxContent tripId={params.tripId} />}
    </AuthGate>
  );
}
