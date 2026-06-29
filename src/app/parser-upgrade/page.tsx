"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { getErrorMessage } from "@/lib/errors";
import { supabase } from "@/lib/supabase/client";
import { getProfile } from "@/lib/supabase/profiles";
import type { Profile } from "@/types";

type UpgradePayload = {
  source: "capture" | "planner_import" | "ledger_import" | "memory_import";
  journeyId?: string | null;
  dayId?: string | null;
  originalText: string;
  currentParseResult?: unknown;
  language?: string | null;
  contextSnapshot?: unknown;
  returnTo?: string | null;
};

const errorTypeOptions = [
  ["intent_wrong", "intent 错了"],
  ["people_wrong", "人名/参与人错了"],
  ["datetime_wrong", "日期/时间错了"],
  ["place_wrong", "地点错了"],
  ["money_wrong", "金额/货币错了"],
  ["split_wrong", "分摊方式错了"],
  ["missing_items", "少生成了项目"],
  ["extra_items", "多生成了项目"],
  ["order_wrong", "顺序错了"],
  ["other", "其他"],
] as const;

function safeJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function parseJsonInput(value: string) {
  if (!value.trim()) return {};
  return JSON.parse(value);
}

function readUpgradeDraft() {
  if (typeof window === "undefined") {
    return {
      payload: null as UpgradePayload | null,
      correctedJson: "{}",
      error: null as string | null,
    };
  }

  const stored = window.sessionStorage.getItem("otr:parser-upgrade:draft");
  if (!stored) {
    return {
      payload: null as UpgradePayload | null,
      correctedJson: "{}",
      error: null as string | null,
    };
  }

  try {
    const payload = JSON.parse(stored) as UpgradePayload;
    return {
      payload,
      correctedJson: safeJson(payload.currentParseResult ?? {}),
      error: null as string | null,
    };
  } catch {
    return {
      payload: null as UpgradePayload | null,
      correctedJson: "{}",
      error: "无法读取 Parser Upgrade 草稿。",
    };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)))
    : [];
}

function textValue(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function fieldLine(label: string, value: unknown) {
  const text = Array.isArray(value)
    ? value.map((item) => textValue(item)).filter(Boolean).join(", ")
    : textValue(value);
  return text ? `${label}: ${text}` : null;
}

function summarizeParseResult(value: unknown) {
  const result = asRecord(value);
  if (!result) return [];

  const parsed = asRecord(result.parsed) ?? result;
  const summaries: { title: string; badge: string; lines: string[] }[] = [];

  const actionGraph = asRecord(parsed.actionGraph);
  const nodes = asArray(actionGraph?.nodes);
  nodes.forEach((node) => {
    const detailLines = asArray(node.details)
      .map((detail) => fieldLine(String(detail.label ?? "字段"), detail.value))
      .filter((line): line is string => Boolean(line));
    summaries.push({
      title: textValue(node.title) ?? textValue(node.type) ?? "Capture 动作",
      badge: textValue(node.intent) ?? "capture",
      lines: [
        textValue(node.summary),
        ...detailLines,
        fieldLine("缺少必填", node.mandatoryMissing),
      ].filter((line): line is string => Boolean(line)),
    });
  });

  asArray(parsed.events).forEach((event) => {
    summaries.push({
      title: textValue(event.title) ?? "行程",
      badge: "行程",
      lines: [
        fieldLine("类型", event.event_type),
        fieldLine("日期", event.day_date),
        fieldLine("开始", event.planned_start),
        fieldLine("结束", event.planned_end),
        fieldLine("地点", event.location_name),
        fieldLine("参与人", event.participant_names),
      ].filter((line): line is string => Boolean(line)),
    });
  });

  asArray(parsed.reservations).forEach((reservation) => {
    summaries.push({
      title: textValue(reservation.title) ?? "预订",
      badge: "预订",
      lines: [
        fieldLine("类型", reservation.reservation_type),
        fieldLine("日期", reservation.day_date),
        fieldLine("开始", reservation.starts_at),
        fieldLine("结束", reservation.ends_at),
        fieldLine("地点", reservation.location_name),
        fieldLine("入住/参与人", reservation.participant_names),
      ].filter((line): line is string => Boolean(line)),
    });
  });

  asArray(parsed.expenses).forEach((expense) => {
    summaries.push({
      title: textValue(expense.title) ?? "账本",
      badge: "账本",
      lines: [
        fieldLine("分类", expense.category),
        fieldLine(
          "金额",
          [expense.original_amount, expense.original_currency].filter(Boolean).join(" "),
        ),
        fieldLine("日期", expense.expense_date),
        fieldLine("付款人", expense.payer_name),
        fieldLine("分摊人", expense.participant_names),
        fieldLine("关联住宿", expense.linked_stay_title),
        fieldLine("地址", expense.address_text),
      ].filter((line): line is string => Boolean(line)),
    });
  });

  if (summaries.length > 0) return summaries;

  return [
    {
      title: textValue(parsed.intent) ?? "解析结果",
      badge: textValue(parsed.source) ?? "result",
      lines: [
        fieldLine("置信度", parsed.confidence),
        fieldLine("原因", parsed.reason),
      ].filter((line): line is string => Boolean(line)),
    },
  ];
}

function ParseSummary({ value, title }: { value: unknown; title: string }) {
  const summaries = summarizeParseResult(value);
  return (
    <section className="rounded-3xl border border-emerald-100 bg-emerald-50 p-5">
      <h2 className="text-lg font-semibold text-stone-950">{title}</h2>
      {summaries.length === 0 ? (
        <p className="mt-3 text-sm text-stone-600">暂时无法生成摘要，请查看下面的 JSON。</p>
      ) : (
        <div className="mt-4 space-y-3">
          {summaries.map((item, index) => (
            <article
              key={`${item.badge}-${item.title}-${index}`}
              className="rounded-2xl bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold text-stone-950">{item.title}</h3>
                <span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black uppercase text-emerald-800">
                  {item.badge}
                </span>
              </div>
              {item.lines.length > 0 ? (
                <ul className="mt-3 space-y-1 text-sm leading-6 text-stone-700">
                  {item.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function JsonDisclosure({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-lg font-semibold text-stone-950">
        <span>{title}</span>
        <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-600 group-open:hidden">
          展开
        </span>
        <span className="hidden rounded-full bg-stone-100 px-3 py-1 text-xs font-bold text-stone-600 group-open:inline-flex">
          收起
        </span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function ParserUpgradeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sourceParam = searchParams.get("source");
  const [initialDraft] = useState(readUpgradeDraft);
  const [payload] = useState<UpgradePayload | null>(initialDraft.payload);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [errorTypes, setErrorTypes] = useState<string[]>([]);
  const [correctedJson, setCorrectedJson] = useState(initialDraft.correctedJson);
  const [aliasesJson, setAliasesJson] = useState("[]");
  const [rulesJson, setRulesJson] = useState("[]");
  const [guidance, setGuidance] = useState("");
  const [scopeOverride, setScopeOverride] = useState<"journey" | "global" | null>(
    null,
  );
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialDraft.error);
  const [afterJson, setAfterJson] = useState<string | null>(null);
  const [afterResult, setAfterResult] = useState<unknown>(null);
  const scope =
    scopeOverride ?? (profile?.accountRole === "admin" ? "global" : "journey");

  const correctedPreview = useMemo(() => {
    try {
      return parseJsonInput(correctedJson);
    } catch {
      return null;
    }
  }, [correctedJson]);

  useEffect(() => {
    let isMounted = true;
    async function loadProfile() {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      const currentProfile = await getProfile(data.user.id);
      if (isMounted) setProfile(currentProfile);
    }
    loadProfile().catch(() => null);
    return () => {
      isMounted = false;
    };
  }, []);

  function returnToSource() {
    const returnTo = payload?.returnTo;
    if (returnTo && returnTo.startsWith("/")) {
      router.push(returnTo);
      return;
    }
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push(payload?.journeyId ? `/trips/${payload.journeyId}/planner` : "/trips");
  }

  const sourceLabel = useMemo(() => {
    const source = payload?.source ?? sourceParam;
    if (source === "capture") return "Capture";
    if (source === "planner_import") return "行程导入 Parser";
    if (source === "ledger_import") return "账本导入 Parser";
    if (source === "memory_import") return "记忆导入 Parser";
    return "Parser";
  }, [payload?.source, sourceParam]);

  async function authHeaders() {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error("请先登录。");
    return {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };
  }

  async function suggestUpgrade() {
    if (!payload) return;
    setError(null);
    setNotice(null);
    setIsSuggesting(true);
    try {
      const response = await fetch("/api/parser-upgrade", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          action: "suggest",
          source: payload.source,
          journeyId: payload.journeyId,
          originalText: payload.originalText,
          currentParseResult: payload.currentParseResult,
          errorTypes,
          guidance: guidance.trim() || null,
          language: payload.language,
          contextSnapshot: payload.contextSnapshot,
        }),
      });
      const body = (await response.json()) as {
        suggestion?: {
          corrected_parse_result?: unknown;
          proposed_aliases?: unknown;
          proposed_rules?: unknown;
          explanation?: string;
        };
        error?: string;
      };
      if (!response.ok || !body.suggestion) {
        throw new Error(body.error || "无法生成解析器升级建议。");
      }
      setCorrectedJson(safeJson(body.suggestion.corrected_parse_result ?? {}));
      setAliasesJson(safeJson(body.suggestion.proposed_aliases ?? []));
      setRulesJson(safeJson(body.suggestion.proposed_rules ?? []));
      setNotice(body.suggestion.explanation || "已生成建议，请确认或修改后保存。");
    } catch (suggestError) {
      setError(getErrorMessage(suggestError, "无法生成解析器升级建议。"));
    } finally {
      setIsSuggesting(false);
    }
  }

  async function saveAndRetest() {
    if (!payload) return;
    setError(null);
    setNotice(null);
    setAfterJson(null);
    setAfterResult(null);
    setIsSaving(true);
    try {
      const correctedParseResult = parseJsonInput(correctedJson);
      const aliases = parseJsonInput(aliasesJson);
      const rules = parseJsonInput(rulesJson);
      const headers = await authHeaders();
      const saveResponse = await fetch("/api/parser-upgrade", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "save",
          source: payload.source,
          journeyId: payload.journeyId,
          originalText: payload.originalText,
          wrongParseResult: payload.currentParseResult ?? null,
          correctedParseResult,
          errorTypes,
          language: payload.language,
          aliases,
          rules,
          scope,
        }),
      });
      const saveBody = (await saveResponse.json()) as { error?: string };
      if (!saveResponse.ok) {
        throw new Error(saveBody.error || "无法保存解析器升级。");
      }

      if (payload.source === "planner_import" && payload.journeyId) {
        const parseResponse = await fetch("/api/ai/parse-itinerary", {
          method: "POST",
          headers,
          body: JSON.stringify({
            tripId: payload.journeyId,
            rawText: payload.originalText,
          }),
        });
        const parseBody = (await parseResponse.json()) as {
          parsed?: unknown;
          source?: string;
          error?: string;
        };
        if (!parseResponse.ok || !parseBody.parsed) {
          throw new Error(parseBody.error || "已保存，但重新测试失败。");
        }
        const after = { source: parseBody.source, parsed: parseBody.parsed };
        setAfterResult(after);
        setAfterJson(safeJson(after));
      }

      setNotice(
        scope === "global"
          ? "已保存。Global example 会立即用于 exact match；Global rule 仍可能 pending。"
          : "已保存。Journey-level example 会立即用于下一次解析。",
      );
    } catch (saveError) {
      setError(getErrorMessage(saveError, "无法保存解析器升级。"));
    } finally {
      setIsSaving(false);
    }
  }

  if (!payload) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-8">
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-900">
          没有找到需要升级的解析记录。请从 Capture 或行程导入结果页点击“教它一次”进入。
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <section>
        <button
          type="button"
          onClick={returnToSource}
          className="mb-5 rounded-full bg-white px-4 py-2 text-sm font-bold text-emerald-800 shadow-sm"
        >
          返回上一页
        </button>
        <p className="text-sm font-black uppercase tracking-[0.14em] text-emerald-700">
          Upgrade Parser
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-stone-950">
          教它一次
        </h1>
        <p className="mt-3 max-w-3xl text-base leading-7 text-stone-600">
          当前来源：{sourceLabel}。这里不会修改代码，只会保存 example、alias 或规则到数据库。
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-stone-950">原始输入</h2>
          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-2xl bg-stone-50 p-4 text-sm leading-6 text-stone-800">
            {payload.originalText}
          </pre>
        </div>
        <JsonDisclosure title="当前错误解析 JSON">
          <pre className="mt-3 max-h-80 overflow-auto rounded-2xl bg-stone-950 p-4 text-xs leading-5 text-stone-50">
            {safeJson(payload.currentParseResult)}
          </pre>
        </JsonDisclosure>
      </section>

      <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-stone-950">错误类型</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {errorTypeOptions.map(([value, label]) => {
            const checked = errorTypes.includes(value);
            return (
              <button
                key={value}
                type="button"
                onClick={() =>
                  setErrorTypes((current) =>
                    checked
                      ? current.filter((item) => item !== value)
                      : [...current, value],
                  )
                }
                className={`rounded-full px-4 py-2 text-sm font-bold ${
                  checked
                    ? "bg-emerald-700 text-white"
                    : "bg-stone-100 text-stone-700"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <label className="mt-5 block">
          <span className="text-sm font-bold text-stone-800">
            补充说明给大模型
          </span>
          <textarea
            value={guidance}
            onChange={(event) => setGuidance(event.target.value)}
            rows={4}
            placeholder="例如：不是新增住宿，这是住宿费用；付款人是 Bao，分摊给所有入住人；不要生成预订。"
            className="mt-2 w-full resize-y rounded-2xl border border-stone-200 bg-[#fffdf8] p-4 text-sm leading-6 text-stone-950 outline-none focus:border-emerald-600"
          />
        </label>
        <button
          type="button"
          onClick={suggestUpgrade}
          disabled={isSuggesting}
          className="mt-5 rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:bg-stone-300"
        >
          {isSuggesting ? "正在分析..." : "让大模型给出修正建议"}
        </button>
      </section>

      <ParseSummary
        title="新的解析结果会变成"
        value={correctedPreview ?? payload.currentParseResult}
      />

      <section className="grid gap-4 lg:grid-cols-2">
        <JsonDisclosure title="高级编辑：JSON">
          <textarea
            value={correctedJson}
            onChange={(event) => setCorrectedJson(event.target.value)}
            rows={18}
            className="mt-3 w-full resize-y rounded-2xl border border-stone-200 bg-[#fffdf8] p-4 font-mono text-xs leading-5 text-stone-950 outline-none focus:border-emerald-600"
          />
        </JsonDisclosure>
        <div className="space-y-4">
          <JsonDisclosure title="proposed_aliases JSON">
            <textarea
              value={aliasesJson}
              onChange={(event) => setAliasesJson(event.target.value)}
              rows={8}
              className="mt-3 w-full resize-y rounded-2xl border border-stone-200 bg-[#fffdf8] p-4 font-mono text-xs leading-5 text-stone-950 outline-none focus:border-emerald-600"
            />
          </JsonDisclosure>
          <JsonDisclosure title="proposed_rules JSON">
            <textarea
              value={rulesJson}
              onChange={(event) => setRulesJson(event.target.value)}
              rows={8}
              className="mt-3 w-full resize-y rounded-2xl border border-stone-200 bg-[#fffdf8] p-4 font-mono text-xs leading-5 text-stone-950 outline-none focus:border-emerald-600"
            />
          </JsonDisclosure>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-3xl border border-emerald-100 bg-emerald-50 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-bold text-emerald-900">启用范围</p>
          <p className="mt-1 text-xs font-semibold text-emerald-800">
            {profile?.accountRole === "admin"
              ? "当前账号是管理员，默认全局应用。"
              : "当前账号不是管理员，默认只在当前 Journey 应用。"}
          </p>
          <select
            value={scope}
            onChange={(event) =>
              setScopeOverride(event.target.value as "journey" | "global")
            }
            className="mt-2 rounded-2xl border border-emerald-100 bg-white px-4 py-3 text-sm font-bold text-stone-950"
          >
            <option value="journey">当前 Journey，立即启用</option>
            <option value="global" disabled={profile?.accountRole !== "admin"}>
              全局规则，管理员可用
            </option>
          </select>
        </div>
        <button
          type="button"
          onClick={saveAndRetest}
          disabled={isSaving}
          className="rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white disabled:bg-stone-300"
        >
          {isSaving ? "正在保存..." : "保存并重新测试"}
        </button>
      </section>

      {afterJson ? (
        <>
          <ParseSummary title="重新测试后实际命中的结果" value={afterResult} />
          <JsonDisclosure title="重新测试 JSON">
            <pre className="mt-3 max-h-96 overflow-auto rounded-2xl bg-stone-950 p-4 text-xs leading-5 text-stone-50">
              {afterJson}
            </pre>
          </JsonDisclosure>
        </>
      ) : null}

      {notice ? (
        <p className="rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={returnToSource}
        className="rounded-full bg-white px-4 py-2 text-sm font-bold text-emerald-800 shadow-sm"
      >
        返回上一页
      </button>
    </main>
  );
}

export default function ParserUpgradePage() {
  return <AuthGate>{() => <ParserUpgradeContent />}</AuthGate>;
}
