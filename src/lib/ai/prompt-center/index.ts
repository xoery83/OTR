import "server-only";

import { getPromptCenterSupabase } from "./client";
import { renderPromptBody } from "./render";
import {
  PromptCenterError,
  type ActivePrompt,
  type CreatePromptVersionInput,
  type PromptCenterOptions,
  type PromptTemplate,
  type PromptTemplateVersion,
  type RenderPromptResult,
} from "./types";

type PromptTemplateRow = {
  id: string;
  key: string;
  worker: string;
  task: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type PromptTemplateVersionRow = {
  id: string;
  template_id: string;
  language: string;
  environment: string;
  version: string;
  status: "draft" | "active" | "archived";
  prompt_body: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  prompt_templates?: PromptTemplateRow | PromptTemplateRow[] | null;
};

function normalizeLanguage(language: string) {
  return language.trim() || "en";
}

function normalizeEnvironment(environment?: string) {
  return environment?.trim() || process.env.JIE_PROMPT_ENVIRONMENT || "production";
}

function mapTemplate(row: PromptTemplateRow): PromptTemplate {
  return {
    id: row.id,
    key: row.key,
    worker: row.worker,
    task: row.task,
    description: row.description,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function firstTemplate(
  value: PromptTemplateVersionRow["prompt_templates"],
): PromptTemplateRow | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function mapVersion(row: PromptTemplateVersionRow): PromptTemplateVersion {
  return {
    id: row.id,
    templateId: row.template_id,
    language: row.language,
    environment: row.environment,
    version: row.version,
    status: row.status,
    promptBody: row.prompt_body,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapActivePrompt(row: PromptTemplateVersionRow): ActivePrompt {
  const template = firstTemplate(row.prompt_templates);
  if (!template) {
    throw new PromptCenterError("Prompt template relation was not returned.");
  }

  return {
    ...mapVersion(row),
    template: mapTemplate(template),
  };
}

export async function getActivePrompt(
  key: string,
  language: string,
  options?: PromptCenterOptions,
): Promise<ActivePrompt | null> {
  try {
    const supabase = options?.supabase ?? getPromptCenterSupabase();
    const environment = normalizeEnvironment(options?.environment);
    const normalizedLanguage = normalizeLanguage(language);

    const { data, error } = await supabase
      .from("prompt_template_versions")
      .select(
        "id, template_id, language, environment, version, status, prompt_body, metadata, created_at, updated_at, prompt_templates!inner(id, key, worker, task, description, metadata, created_at, updated_at)",
      )
      .eq("status", "active")
      .eq("language", normalizedLanguage)
      .eq("environment", environment)
      .eq("prompt_templates.key", key)
      .maybeSingle();

    if (error) {
      throw new PromptCenterError("Could not load active prompt.", error);
    }

    return data ? mapActivePrompt(data as PromptTemplateVersionRow) : null;
  } catch (error) {
    if (error instanceof PromptCenterError) throw error;
    throw new PromptCenterError("Prompt Center getActivePrompt failed.", error);
  }
}

export async function renderPrompt(
  key: string,
  language: string,
  variables: Record<string, unknown>,
  options?: PromptCenterOptions,
): Promise<RenderPromptResult | null> {
  const prompt = await getActivePrompt(key, language, options);
  if (!prompt) return null;

  const rendered = renderPromptBody(prompt.promptBody, variables);
  return {
    prompt,
    variables,
    renderedPrompt: rendered.renderedPrompt,
    missingVariables: rendered.missingVariables,
  };
}

export async function createPromptVersion(
  input: CreatePromptVersionInput,
): Promise<ActivePrompt> {
  try {
    const supabase = input.supabase ?? getPromptCenterSupabase();
    const environment = normalizeEnvironment(input.environment);
    const language = normalizeLanguage(input.language);
    const status = input.status ?? "draft";

    const { data: templateRow, error: templateError } = await supabase
      .from("prompt_templates")
      .upsert(
        {
          key: input.key,
          worker: input.worker,
          task: input.task,
          description: input.description ?? null,
          metadata: input.templateMetadata ?? {},
        },
        { onConflict: "key" },
      )
      .select("id, key, worker, task, description, metadata, created_at, updated_at")
      .single();

    if (templateError || !templateRow) {
      throw new PromptCenterError(
        "Could not upsert prompt template.",
        templateError,
      );
    }

    if (status === "active" && input.archiveExistingActive !== false) {
      const { error: archiveError } = await supabase
        .from("prompt_template_versions")
        .update({ status: "archived" })
        .eq("template_id", templateRow.id)
        .eq("language", language)
        .eq("environment", environment)
        .eq("status", "active");

      if (archiveError) {
        throw new PromptCenterError(
          "Could not archive existing active prompt version.",
          archiveError,
        );
      }
    }

    const { data: versionRow, error: versionError } = await supabase
      .from("prompt_template_versions")
      .insert({
        template_id: templateRow.id,
        language,
        environment,
        version: input.version,
        status,
        prompt_body: input.promptBody,
        metadata: input.versionMetadata ?? {},
      })
      .select(
        "id, template_id, language, environment, version, status, prompt_body, metadata, created_at, updated_at",
      )
      .single();

    if (versionError || !versionRow) {
      throw new PromptCenterError(
        "Could not create prompt template version.",
        versionError,
      );
    }

    return {
      ...mapVersion(versionRow as PromptTemplateVersionRow),
      template: mapTemplate(templateRow as PromptTemplateRow),
    };
  } catch (error) {
    if (error instanceof PromptCenterError) throw error;
    throw new PromptCenterError("Prompt Center createPromptVersion failed.", error);
  }
}

export type {
  ActivePrompt,
  CreatePromptVersionInput,
  PromptCenterOptions,
  PromptStatus,
  PromptTemplate,
  PromptTemplateVersion,
  RenderPromptResult,
} from "./types";

