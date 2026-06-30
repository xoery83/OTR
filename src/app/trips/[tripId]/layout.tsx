import { JourneyResourcePreloader } from "@/components/JourneyResourcePreloader";

export default async function JourneyLayout({
  params,
  children,
}: {
  params: Promise<{ tripId: string }>;
  children: React.ReactNode;
}) {
  const { tripId } = await params;

  return (
    <JourneyResourcePreloader tripId={tripId}>
      {children}
    </JourneyResourcePreloader>
  );
}
