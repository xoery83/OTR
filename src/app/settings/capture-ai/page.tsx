"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { getErrorMessage } from "@/lib/errors";
import {
  detectCaptureIntent,
  getCaptureIntentConfig,
  saveCaptureIntentConfig,
} from "@/lib/capture-ai/client";
import type {
  CaptureIntentConfig,
  CaptureIntentDetection,
  CaptureIntentRule,
  CapturePromptTemplate,
  CaptureRoutingConfig,
} from "@/lib/capture-ai/types";

function updateRule(
  config: CaptureIntentConfig,
  intentKey: CaptureIntentRule["intentKey"],
  patch: Partial<CaptureIntentRule>,
) {
  return {
    ...config,
    rules: config.rules.map((rule) =>
      rule.intentKey === intentKey ? { ...rule, ...patch } : rule,
    ),
  };
}

function updatePrompt(
  config: CaptureIntentConfig,
  templateKey: CapturePromptTemplate["templateKey"],
  prompt: string,
) {
  return {
    ...config,
    prompts: config.prompts.map((template) =>
      template.templateKey === templateKey ? { ...template, prompt } : template,
    ),
  };
}

function updateRouting(
  config: CaptureIntentConfig,
  patch: Partial<CaptureRoutingConfig>,
) {
  return {
    ...config,
    routing: {
      ...config.routing,
      ...patch,
    },
  };
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="overflow-x-auto rounded-2xl bg-stone-950 p-4 text-xs leading-5 text-stone-50">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function CaptureAiSettingsContent() {
  const [config, setConfig] = useState<CaptureIntentConfig | null>(null);
  const [playgroundText, setPlaygroundText] = useState("");
  const [playgroundResult, setPlaygroundResult] =
    useState<CaptureIntentDetection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadConfig() {
      try {
        const loaded = await getCaptureIntentConfig();
        if (isMounted) setConfig(loaded);
      } catch (loadError) {
        if (isMounted) {
          setError(getErrorMessage(loadError, "Could not load Capture AI config."));
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadConfig();
    return () => {
      isMounted = false;
    };
  }, []);

  async function saveConfig() {
    if (!config) return;
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await saveCaptureIntentConfig(config);
      setConfig(saved);
      setNotice("Capture AI configuration saved.");
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Could not save Capture AI config."));
    } finally {
      setIsSaving(false);
    }
  }

  async function runPlayground() {
    const text = playgroundText.trim();
    if (!text) return;

    setIsTesting(true);
    setError(null);
    setPlaygroundResult(null);
    try {
      const result = await detectCaptureIntent({ text, inputTypes: ["text"] });
      setPlaygroundResult(result);
    } catch (testError) {
      setError(getErrorMessage(testError, "Could not test Capture intent."));
    } finally {
      setIsTesting(false);
    }
  }

  if (isLoading) {
    return <div className="rounded-2xl bg-white p-5">Loading Capture AI...</div>;
  }

  if (!config) {
    return (
      <div className="rounded-2xl bg-red-50 p-5 text-sm font-semibold text-red-700">
        Capture AI config is not available.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm font-semibold text-emerald-700">Settings</p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-950">
          Capture AI
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-stone-600">
          Configure Phase 1 intent routing, prompt templates, and simulate
          detection without database writes.
        </p>
      </section>

      {error ? (
        <p className="rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-2xl bg-emerald-50 p-4 text-sm font-bold text-emerald-800">
          {notice}
        </p>
      ) : null}

      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-stone-950">
              Supported intents
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Phase 1 executes the highest-confidence intent only.
            </p>
          </div>
          <button
            type="button"
            onClick={saveConfig}
            disabled={isSaving}
            className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:bg-stone-300"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>

        <div className="mt-5 grid gap-3">
          {config.rules.map((rule) => (
            <div
              key={rule.intentKey}
              className="rounded-2xl border border-stone-200 bg-[#fffdf8] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-stone-950">
                    {rule.displayName}
                  </h3>
                  <p className="mt-1 text-sm text-stone-600">
                    {rule.description}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm font-bold text-stone-700">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(event) =>
                      setConfig(updateRule(config, rule.intentKey, {
                        enabled: event.target.checked,
                      }))
                    }
                  />
                  Enabled
                </label>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <label className="text-xs font-bold uppercase tracking-[0.12em] text-stone-500">
                  Threshold
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={rule.confidenceThreshold}
                    onChange={(event) =>
                      setConfig(updateRule(config, rule.intentKey, {
                        confidenceThreshold: Number(event.target.value),
                      }))
                    }
                    className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-950"
                  />
                </label>
                <label className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-bold text-stone-700">
                  <input
                    type="checkbox"
                    checked={rule.autoExecute}
                    onChange={(event) =>
                      setConfig(updateRule(config, rule.intentKey, {
                        autoExecute: event.target.checked,
                      }))
                    }
                  />
                  Auto execute
                </label>
                <label className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-bold text-stone-700">
                  <input
                    type="checkbox"
                    checked={rule.requiresConfirmation}
                    onChange={(event) =>
                      setConfig(updateRule(config, rule.intentKey, {
                        requiresConfirmation: event.target.checked,
                      }))
                    }
                  />
                  Requires confirmation
                </label>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-stone-950">
              Routing configuration
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-600">
              Capture runs local parser and local intent first, then escalates
              complex requests to the server-side LLM router.
            </p>
          </div>
          <button
            type="button"
            onClick={saveConfig}
            disabled={isSaving}
            className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:bg-stone-300"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {[
            {
              key: "enableLocalParser",
              label: "Enable Local Parser",
              value: config.routing.enableLocalParser,
            },
            {
              key: "enableLocalIntentEngine",
              label: "Enable Local Intent Engine",
              value: config.routing.enableLocalIntentEngine,
            },
            {
              key: "enableLlmRouter",
              label: "Enable LLM Router",
              value: config.routing.enableLlmRouter,
            },
            {
              key: "forceAllRequestsToLlm",
              label: "Force All Requests To LLM",
              value: config.routing.forceAllRequestsToLlm,
            },
            {
              key: "forceLocalOnly",
              label: "Force Local Only",
              value: config.routing.forceLocalOnly,
            },
          ].map((item) => (
            <label
              key={item.key}
              className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-[#fffdf8] px-4 py-3 text-sm font-bold text-stone-800"
            >
              {item.label}
              <input
                type="checkbox"
                checked={item.value}
                onChange={(event) =>
                  setConfig(
                    updateRouting(config, {
                      [item.key]: event.target.checked,
                    } as Partial<CaptureRoutingConfig>),
                  )
                }
              />
            </label>
          ))}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-xs font-bold uppercase tracking-[0.12em] text-stone-500">
            Local Confidence Threshold
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={config.routing.localConfidenceThreshold}
              onChange={(event) =>
                setConfig(
                  updateRouting(config, {
                    localConfidenceThreshold: Number(event.target.value),
                  }),
                )
              }
              className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-950"
            />
          </label>
          <label className="text-xs font-bold uppercase tracking-[0.12em] text-stone-500">
            Complexity Threshold
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={config.routing.complexityThreshold}
              onChange={(event) =>
                setConfig(
                  updateRouting(config, {
                    complexityThreshold: Number(event.target.value),
                  }),
                )
              }
              className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-950"
            />
          </label>
        </div>
      </section>

      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold text-stone-950">
          Prompt templates
        </h2>
        <p className="mt-1 text-sm leading-6 text-stone-600">
          Prompts are stored in the database and used by the server-side intent
          detector.
        </p>
        <div className="mt-5 grid gap-4">
          {config.prompts.map((template) => (
            <label
              key={template.templateKey}
              className="block text-sm font-bold text-stone-800"
            >
              {template.displayName}
              <textarea
                value={template.prompt}
                onChange={(event) =>
                  setConfig(updatePrompt(config, template.templateKey, event.target.value))
                }
                rows={5}
                className="mt-2 w-full resize-y rounded-2xl border border-stone-200 bg-[#fffdf8] p-3 text-sm font-medium leading-6 text-stone-900 outline-none focus:border-emerald-600"
              />
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-3xl bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold text-stone-950">
          Test playground
        </h2>
        <p className="mt-1 text-sm leading-6 text-stone-600">
          Simulate intent detection only. No database writes and no actions
          executed.
        </p>
        <textarea
          value={playgroundText}
          onChange={(event) => setPlaygroundText(event.target.value)}
          rows={6}
          placeholder="Fuel cost 900 ISK. Leon paid."
          className="mt-4 w-full resize-y rounded-2xl border border-stone-200 bg-[#fffdf8] p-4 text-base leading-7 text-stone-950 outline-none focus:border-emerald-600"
        />
        <button
          type="button"
          onClick={runPlayground}
          disabled={isTesting || !playgroundText.trim()}
          className="mt-3 rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:bg-stone-300"
        >
          {isTesting ? "Testing..." : "Test"}
        </button>

        {playgroundResult ? (
          <div className="mt-5 space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl bg-emerald-50 p-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-800">
                  Intent
                </p>
                <p className="mt-1 text-lg font-semibold text-stone-950">
                  {playgroundResult.intent}
                </p>
              </div>
              <div className="rounded-2xl bg-stone-50 p-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-stone-500">
                  Confidence
                </p>
                <p className="mt-1 text-lg font-semibold text-stone-950">
                  {Math.round(playgroundResult.confidence * 100)}%
                </p>
              </div>
              <div className="rounded-2xl bg-stone-50 p-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-stone-500">
                  Interaction
                </p>
                <p className="mt-1 text-lg font-semibold text-stone-950">
                  {playgroundResult.interactionLevel}
                </p>
              </div>
            </div>
            <JsonBlock
              value={{
                entities: playgroundResult.entities,
                actionGraph: playgroundResult.actionGraph,
                missingInformation: playgroundResult.missingInformation,
                clarificationQuestions: playgroundResult.clarificationQuestions,
                proposedAction: playgroundResult.proposedAction,
                requiresConfirmation: playgroundResult.requiresConfirmation,
                reason: playgroundResult.reason,
                wouldAutoExecute: playgroundResult.shouldAutoExecute,
                fallbackToMemory: playgroundResult.fallbackToMemory,
                provider: playgroundResult.provider,
                model: playgroundResult.model,
                routing: playgroundResult.routing,
              }}
            />
          </div>
        ) : null}
      </section>

      <Link
        href="/settings"
        className="block rounded-2xl bg-emerald-50 px-5 py-3 text-center text-sm font-bold text-emerald-900"
      >
        Back to settings
      </Link>
    </div>
  );
}

export default function CaptureAiSettingsPage() {
  return <AuthGate>{() => <CaptureAiSettingsContent />}</AuthGate>;
}
