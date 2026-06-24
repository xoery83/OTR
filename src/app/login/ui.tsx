"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { signInWithEmailOtp, signInWithGoogle } from "@/lib/supabase/auth";
import { supabase } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const next = searchParams.get("next") || "/trips";
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        router.replace(next);
      }
    });
  }, [router, searchParams]);

  async function handleGoogleLogin() {
    setError(null);
    setIsSubmitting(true);

    try {
      await signInWithGoogle(searchParams.get("next"));
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : "Could not start Google login.",
      );
      setIsSubmitting(false);
    }
  }

  async function handleEmailLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsSubmitting(true);

    try {
      await signInWithEmailOtp(email, searchParams.get("next"));
      setMessage("Check your email for the magic link.");
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : "Could not send magic link.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const next = searchParams.get("next");

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm font-semibold text-emerald-700">Welcome back</p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          Sign in to OTR
        </h1>
        <p className="mt-3 text-base leading-7 text-stone-600">
          Use Google or a magic link to open your group travel workspace.
        </p>
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={isSubmitting}
          className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          Continue with Google
        </button>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-stone-200" />
          <span className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">
            or
          </span>
          <div className="h-px flex-1 bg-stone-200" />
        </div>

        <form onSubmit={handleEmailLogin} className="space-y-3">
          <label htmlFor="email" className="text-sm font-bold text-stone-800">
            Email magic link
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
            className="w-full rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-base text-stone-950 placeholder:text-stone-500 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-100"
          />
          <button
            type="submit"
            disabled={isSubmitting || !email}
            className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            Send magic link
          </button>
        </form>

        {message ? (
          <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}
        {next ? (
          <p className="mt-4 text-center text-xs text-stone-500">
            You will continue after signing in.
          </p>
        ) : null}
      </section>
    </div>
  );
}
