import type { DailyReport } from "@/types";
import { formatDate } from "@/lib/format";

type DailyReportCardProps = {
  report: DailyReport;
};

export function DailyReportCard({ report }: DailyReportCardProps) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-emerald-700">
        {formatDate(report.date)}
      </p>
      <h2 className="mt-2 text-2xl font-semibold leading-tight text-stone-950">
        {report.title}
      </h2>
      <p className="mt-4 text-base leading-7 text-stone-700">
        {report.summary}
      </p>
      <div className="mt-5">
        <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-stone-500">
          Highlights
        </h3>
        <ul className="mt-3 space-y-3">
          {report.highlights.map((highlight) => (
            <li
              key={highlight}
              className="rounded-xl bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-700"
            >
              {highlight}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
