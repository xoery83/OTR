import Link from "next/link";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-emerald-100 bg-[#fffdf8]/95 backdrop-blur md:hidden">
      <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-emerald-700 text-sm font-bold text-white">
            O
          </span>
          <div>
            <p className="text-lg font-semibold tracking-wide text-stone-950">
              OTR
            </p>
            <p className="text-xs font-medium text-stone-500">
              journeys and memories
            </p>
          </div>
        </Link>
        <Link
          href="/trips"
          className="rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm"
        >
          Journeys
        </Link>
      </div>
    </header>
  );
}
