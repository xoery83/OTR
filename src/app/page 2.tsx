import Link from "next/link";

export default function Home() {
  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-3xl bg-white text-stone-950 shadow-sm">
        <div
          className="min-h-[430px] bg-cover bg-center"
          style={{
            backgroundImage:
              "url(https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80)",
          }}
        >
          <div className="flex min-h-[430px] flex-col justify-end bg-gradient-to-t from-white via-white/80 to-white/10 p-6">
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-emerald-700">
              Group travel memory app
            </p>
            <h1 className="mt-3 text-4xl font-semibold leading-tight">
              OTR
            </h1>
            <p className="mt-3 max-w-md text-base leading-7 text-stone-700">
              Capture the daily texture of a trip through quick notes, photos,
              voice moments, and soon, generated travel reports.
            </p>
            <div className="mt-6 flex gap-3">
              <Link
                href="/trips"
                className="rounded-full bg-emerald-700 px-5 py-3 text-sm font-bold text-white"
              >
                View trips
              </Link>
              <Link
                href="/login"
                className="rounded-full border border-emerald-200 bg-white/80 px-5 py-3 text-sm font-bold text-emerald-800"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          ["Capture", "Text memories now, richer media later."],
          ["Timeline", "See each day unfold in order."],
          ["Reports", "AI summaries are reserved for a later phase."],
        ].map(([title, copy]) => (
          <div
            key={title}
            className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
          >
            <h2 className="font-semibold text-stone-950">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-stone-600">{copy}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
