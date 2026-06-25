import Link from "next/link";

export default async function JourneyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const items = [
    ["Overview", `/trips/${tripId}`],
    ["Planner", `/trips/${tripId}/planner`],
    ["Ledger", `/trips/${tripId}/ledger`],
    ["Timeline", `/trips/${tripId}/timeline`],
    ["People", `/trips/${tripId}/people`],
    ["Highlights", `/trips/${tripId}/highlights`],
  ];

  return (
    <div className="space-y-5">
      <nav className="-mx-1 flex gap-2 overflow-x-auto pb-1">
        {items.map(([label, href]) => (
          <Link
            key={label}
            href={href}
            className="shrink-0 rounded-full bg-white px-4 py-2 text-sm font-bold text-stone-700 shadow-sm"
          >
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
