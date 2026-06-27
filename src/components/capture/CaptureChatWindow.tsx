"use client";

import type {
  CaptureActionGraphNode,
  CaptureIntentDetection,
} from "@/lib/capture-ai/types";
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

function actionBadge(action: CaptureActionGraphNode) {
  if (action.payload?.queryAnswer) return "Answer";
  if (action.type === "hotel_stay") return "Add to Planner";
  if (action.intent === "expense") return "Record Expense";
  if (action.intent === "navigation") return "Open Map";
  if (action.intent === "assistant") return "Assistant";
  return "Will Create";
}

function LinkedText({ text }: { text: string }) {
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
            {part.includes("google.com/maps") ? "打开导航" : part}
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
}: {
  action: CaptureActionGraphNode;
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-xl">
          {action.icon || "✓"}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-stone-950">{action.title}</h3>
          {action.summary ? (
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-stone-600">
              <LinkedText text={action.summary} />
            </p>
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
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase ${
            action.mandatoryMissing.length === 0
              ? "bg-emerald-50 text-emerald-800"
              : "bg-amber-50 text-amber-800"
          }`}
        >
          {actionBadge(action)}
        </span>
      </div>
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
  if (!intent.needsClarification) return null;

  const activeMembers = members.filter(
    (member) => member.role === "owner" || member.role === "group_member",
  );
  const needsPayer = intent.missingInformation.includes("payer");
  const needsSplit = intent.missingInformation.includes("splitMembers");

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-800">
        还需要补充的信息
      </p>
      <div className="mt-3 space-y-3">
        {needsPayer ? (
          <div className="rounded-2xl bg-white p-3">
            <p className="font-semibold text-stone-950">谁支付的？</p>
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
            <p className="font-semibold text-stone-950">这笔费用怎么分摊？</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onQuickAction({ type: "split_all" })}
                className="rounded-full bg-emerald-700 px-3 py-2 text-xs font-bold text-white"
              >
                全员人均摊
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
                指定成员
              </button>
              <button
                type="button"
                onClick={() => onQuickAction({ type: "stats_only" })}
                className="rounded-full bg-stone-100 px-3 py-2 text-xs font-bold text-stone-700"
              >
                只统计不分摊
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
  onUpgradeParser,
}: {
  messages: CaptureChatMessage[];
  members: JourneyMember[];
  onQuickAction: (messageId: string, action: QuickAction) => void;
  onUpgradeParser?: (messageId: string, intent: CaptureIntentDetection) => void;
}) {
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
              <LinkedText text={message.text || "我准备帮你完成下面的操作。"} />
            </div>
            {message.intent ? (
              <>
                <div className="space-y-2">
                  {message.intent.actionGraph.nodes.map((action) => (
                    <CaptureIntentCard key={action.id} action={action} />
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
                {onUpgradeParser ? (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => onUpgradeParser(message.id, message.intent!)}
                      className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800"
                    >
                      解析不对？教它一次
                    </button>
                  </div>
                ) : null}
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
  if (!intent) return null;

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-stone-500">
            {intent.needsClarification ? "Need more info" : "Ready to confirm"}
          </p>
          <p className="mt-1 text-sm font-semibold text-stone-900">
            {intent.needsClarification
              ? "补充上面的信息后就可以保存。"
              : "确认后我会写入 Journey。"}
          </p>
        </div>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isSubmitting || intent.needsClarification}
          className="rounded-full bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:bg-stone-300"
        >
          {isSubmitting
            ? "Saving..."
            : intent.needsClarification
              ? "请先补充信息"
              : confirmLabel}
        </button>
      </div>
    </div>
  );
}

export type { QuickAction as CaptureQuickAction };
