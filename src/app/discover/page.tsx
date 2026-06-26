"use client";

import { AuthGate } from "@/components/AuthGate";
import { useI18n } from "@/components/I18nProvider";

function DiscoverContent() {
  const { t } = useI18n();

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm font-semibold text-emerald-700">
          {t("discover.title")}
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          {t("discover.heading")}
        </h1>
        <p className="mt-3 max-w-xl text-base leading-7 text-stone-600">
          {t("discover.description")}
        </p>
      </section>
    </div>
  );
}

export default function DiscoverPage() {
  return <AuthGate>{() => <DiscoverContent />}</AuthGate>;
}
