import { Suspense } from "react";
import { LoginForm } from "./ui";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-2xl border border-stone-200 bg-white p-5 text-sm font-medium text-stone-600 shadow-sm">
          Loading login...
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
