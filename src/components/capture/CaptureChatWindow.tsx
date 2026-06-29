"use client";

import { useState } from "react";
import type {
  CaptureActionGraphNode,
  CaptureIntentDetection,
} from "@/lib/capture-ai/types";
import { useI18n } from "@/components/I18nProvider";
import type { JourneyMember } from "@/types";

export type CaptureChatMessage =
  | {
      id: string;
      role: "user";
      text: string;
      attachmentName?: string;
    }
  | {
      id: string;
      role: "assistant";
      text?: string;
      sourceText?: string;
      intent?: CaptureIntentDetection;
    };

type QuickAction =
  | {
      type: "payer";
      memberId: string;
    }
  | {
      type: "split_all";
    }
  | {
      type: "split_members";
      memberIds: string[];
    }
  | {
      type: "stats_only";
    }
  | {
      type: "memory_only";
    };

function visibleActionFacts(action: CaptureActionGraphNode) {
  const facts = action.facts?.length
    ? action.facts
    : action.details.map((detail) => ({
        key: `${detail.label}-${detail.value}`,
        label: detail.label,
        value: detail.value,
        source: detail.source ?? ("explicit" as const),
        evidence: detail.evidence,
      }));

  return facts.filter((fact) => fact.source !== "inferred");
}

function stringPayload(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function localizedActionTitle(action: CaptureActionGraphNode, t: ReturnType<typeof useI18n>["t"]) {
  if (action.intent === "planner_update") {
    if (action.type.includes("hotel") || action.type.includes("accommodation")) {
      return t("capture.card.title.stay");
    }
    return t("capture.card.title.planner");
  }
  if (action.intent === "expense") return t("capture.card.title.expense");
  if (action.intent === "memory") return t("capture.card.title.memory");
  if (action.intent === "navigation") return t("capture.card.title.navigation");
  return action.title;
}

function fieldLabel(key: string, t: ReturnType<typeof useI18n>["t"]) {
  const labels: Record<string, string> = {
    title: t("capture.field.title"),
    date: t("capture.field.date"),
    time: t("capture.field.time"),
    locationName: t("capture.field.location"),
    location: t("capture.field.location"),
    amount: t("capture.field.amount"),
    currency: t("capture.field.currency"),
    payerName: t("capture.field.payer"),
    category: t("capture.field.category"),
    content: t("capture.field.content"),
  };
  return labels[key] ?? key;
}

function keyFieldEntries(action: CaptureActionGraphNode, t: ReturnType<typeof useI18n>["t"]) {
  const keys =
    action.intent === "planner_update"
      ? ["title", "date", "time", "locationName"]
      : action.intent === "expense"
        ? ["title", "amount", "currency", "payerName", "category", "date"]
        : action.intent === "memory"
          ? ["content", "date", "locationName"]
        : ["title", "date", "locationName"];

  return keys
    .map((key) => ({
      key,
      label: fieldLabel(key, t),
      value:
        stringPayload(action.payload?.[key]) ||
        visibleActionFacts(action).find((fact) => fact.key === key)?.value ||
        "",
    }))
    .filter((item) => item.value);
}

function LinkedText({ text }: { text: string }) {
  const { t } = useI18n();
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={`${part}-${index}`}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-emerald-700 underline underline-offset-2"
          >
            {part.includes("google.com/maps") ? t("capture.card.openNavigation") : part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function CaptureIntentCard({
  action,
  onUpdate,
}: {
  action: CaptureActionGraphNode;
  onUpdate?: (nodeId: string, payloadPatch: Record<string, string>) => void;
}) {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(() => ({
    title: stringPayload(action.payload?.title),
    date: stringPayload(action.payload?.date),
    time: stringPayload(action.payload?.time),
    locationName:
      stringPayload(action.payload?.locationName) ||
      stringPayload(action.payload?.location),
    amount: stringPayload(action.payload?.amount),
    currency: stringPayload(action.payload?.currency),
    content: stringPayload(action.payload?.content) || action.summary,
  }));
  const actionBadge = action.payload?.queryAnswer
    ? t("capture.card.answer")
    : action.intent === "planner_update"
      ? t("capture.card.addPlanner")
      : action.intent === "expense"
        ? t("capture.card.recordExpense")
        : action.intent === "navigation"
          ? t("capture.card.openMap")
          : action.intent === "assistant"
            ? t("capture.card.assistant")
            : t("capture.card.willCreate");
  const keyFields = keyFieldEntries(action, t);

  function updateDraft(key: string, value: string) {
    const nextDraft = { ...draft, [key]: value };
    setDraft(nextDraft);
    onUpdate?.(action.id, { [key]: value });
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-xl">
          {action.icon || "✓"}
        </span>
        <button
          type="button"
          onClick={() => setIsExpanded((current) => !current)}
          className="min-w-0 flex-1 text-left"
        >
          <h3 className="font-semibold text-stone-950">
            {localizedActionTitle(action, t)}
          </h3>
          {action.summary && action.intent !== "memory" ? (
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-stone-600">
              <LinkedText text={action.summary} />
            </p>
          ) : null}
          {keyFields.length > 0 ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {keyFields.map((field) => (
                <span
                  key={`${action.id}-${field.key}`}
                  className="rounded-2xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-900"
                >
                  {field.label}: {field.value}
                </span>
              ))}
            </div>
          ) : null}
          {visibleActionFacts(action).length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {visibleActionFacts(action).map((fact) => (
                <span
                  key={`${action.id}-${fact.key}-${fact.value}`}
                  className="rounded-full bg-stone-50 px-2.5 py-1 text-xs font-bold text-stone-700"
                >
                  {fact.label}: {fact.value}
                </span>
              ))}
            </div>
          ) : null}
        </button>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase ${
            action.mandatoryMissing.length === 0
              ? "bg-emerald-50 text-emerald-800"
              : "bg-amber-50 text-amber-800"
          }`}
        >
          {actionBadge}
        </span>
      </div>
      {isExpanded && onUpdate ? (
        <div className="mt-4 grid gap-3 rounded-2xl bg-stone-50 p-3 sm:grid-cols-2">
          {(action.intent === "memory"
            ? ["content", "date", "locationName"]
            : ["title", "date", "time", "locationName"]
          ).map((key) => (
            <label key={key} className="text-xs font-bold text-stone-600">
              {fieldLabel(key, t)}
              {key === "content" ? (
                <textarea
                  value={draft[key] ?? ""}
                  onChange={(event) => updateDraft(key, event.target.value)}
                  rows={4}
                  className="mt-1 w-full resize-y rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold leading-6 text-stone-950 outline-none focus:border-emerald-300"
                />
              ) : (
                <input
                  value={draft[key] ?? ""}
                  onChange={(event) => updateDraft(key, event.target.value)}
                  placeholder={
                    key === "time"
                      ? "14:30"
                      : key === "date"
                        ? "2026-08-13"
                        : undefined
                  }
                  className="mt-1 min-h-10 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-950 outline-none focus:border-emerald-300"
                />
              )}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CaptureQuestionCard({
  intent,
  members,
  onQuickAction,
}: {
  intent: CaptureIntentDetection;
  members: JourneyMember[];
  onQuickAction: (action: QuickAction) => void;
}) {
  const { t } = useI18n();
  if (!intent.needsClarification) return null;

  const activeMembers = members.filter(
    (member) => member.role === "owner" || member.role === "group_member",
  );
  const needsPayer = intent.missingInformation.includes("payer");
  const needsSplit = intent.missingInformation.includes("splitMembers");

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-800">
        {t("capture.question.title")}
      </p>
      <div className="mt-3 space-y-3">
        {needsPayer ? (
          <div className="rounded-2xl bg-white p-3">
            <p className="font-semibold text-stone-950">{t("capture.question.payer")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {activeMembers.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() =>
                    onQuickAction({ type: "payer", memberId: member.id })
                  }
                  className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-900"
                >
                  {member.displayName}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {needsSplit ? (
          <div className="rounded-2xl bg-white p-3">
            <p className="font-semibold text-stone-950">{t("capture.question.split")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onQuickAction({ type: "split_all" })}
                className="rounded-full bg-emerald-700 px-3 py-2 text-xs font-bold text-white"
              >
                {t("capture.question.splitAll")}
              </button>
              <button
                type="button"
                onClick={() =>
                  onQuickAction({
                    type: "split_members",
                    memberIds: activeMembers.map((member) => member.id),
                  })
                }
                className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-900"
              >
                {t("capture.question.splitMembers")}
              </button>
              <button
                type="button"
                onClick={() => onQuickAction({ type: "stats_only" })}
                className="rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-stone-700"
              >
                {t("capture.question.statsOnly")}
              </button>
            </div>
          </div>
        ) : null}

        {intent.clarificationQuestions
          .filter(
            (question) => question.id !== "payer" && question.id !== "splitMembers",
          )
          .map((question) => (
            <div key={question.id} className="rounded-2xl bg-white p-3">
              <p className="font-semibold text-stone-950">{question.question}</p>
              {question.options?.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {question.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-900"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
      </div>
    </div>
  );
}

export function CaptureMessageList({
  messages,
  members,
  onQuickAction,
  onActionUpdate,
}: {
  messages: CaptureChatMessage[];
  members: JourneyMember[];
  onQuickAction: (messageId: string, action: QuickAction) => void;
  onActionUpdate?: (
    messageId: string,
    nodeId: string,
    payloadPatch: Record<string, string>,
  ) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      {messages.map((message) =>
        message.role === "user" ? (
          <div key={message.id} className="flex justify-end">
            <div className="max-w-[86%] rounded-3xl bg-emerald-700 px-4 py-3 text-sm leading-6 text-white">
              <p className="whitespace-pre-wrap">{message.text}</p>
              {message.attachmentName ? (
                <p className="mt-1 text-xs font-semibold text-emerald-100">
                  {message.attachmentName}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div key={message.id} className="space-y-3">
            <div className="max-w-[92%] rounded-3xl bg-white px-4 py-3 text-sm leading-6 text-stone-800 shadow-sm">
              <LinkedText text={message.text || t("capture.message.ready")} />
            </div>
            {message.intent ? (
              <>
                <div className="space-y-2">
                  {message.intent.actionGraph.nodes.map((action) => (
                    <CaptureIntentCard
                      key={action.id}
                      action={action}
                      onUpdate={
                        onActionUpdate
                          ? (nodeId, payloadPatch) =>
                              onActionUpdate(message.id, nodeId, payloadPatch)
                          : undefined
                      }
                    />
                  ))}
                  {message.intent.actionGraph.relations.map((relation) => (
                    <div
                      key={`${relation.from}-${relation.type}-${relation.to}`}
                      className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900"
                    >
                      {relation.label}
                    </div>
                  ))}
                </div>
                <CaptureQuestionCard
                  intent={message.intent}
                  members={members}
                  onQuickAction={(action) => onQuickAction(message.id, action)}
                />
              </>
            ) : null}
          </div>
        ),
      )}
    </div>
  );
}

export function CaptureConfirmCard({
  intent,
  isSubmitting,
  confirmLabel,
  onConfirm,
}: {
  intent: CaptureIntentDetection | null;
  isSubmitting: boolean;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  if (!intent) return null;

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-stone-500">
            {intent.needsClarification
              ? t("capture.confirm.needMore")
              : t("capture.confirm.ready")}
          </p>
          <p className="mt-1 text-sm font-semibold text-stone-900">
            {intent.needsClarification
              ? t("capture.confirm.needMoreDescription")
              : t("capture.confirm.readyDescription")}
          </p>
        </div>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSubmitting || intent.needsClarification}
          className="rounded-full bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:bg-stone-300"
        >
          {isSubmitting
            ? t("capture.confirm.saving")
            : intent.needsClarification
              ? t("capture.action.waitingInfo")
              : confirmLabel}
        </button>
      </div>
    </div>
  );
}

export type { QuickAction as CaptureQuickAction };
