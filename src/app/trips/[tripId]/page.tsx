import { redirect } from "next/navigation";

export default async function TripEntryPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  redirect(`/trips/${tripId}/planner`);
}
