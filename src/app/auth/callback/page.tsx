import { Suspense } from "react";
import { AuthCallback } from "./ui";

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-2xl border border-stone-200 bg-white p-5 text-sm font-medium text-stone-600 shadow-sm">
          Finishing sign in...
        </div>
      }
    >
      <AuthCallback />
    </Suspense>
  );
}
