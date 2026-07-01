import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type PromptStatus = "draft" | "active" | "archived";

export type PromptTemplate = {
  id: string;
  key: string;
  worker: string;
  task: string;
  description: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type PromptTemplateVersion = {
  id: string;
  templateId: string;
  language: string;
  environment: string;
  version: string;
  status: PromptStatus;
  promptBody: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ActivePrompt = PromptTemplateVersion & {
  template: PromptTemplate;
};

export type PromptCenterSupabase = SupabaseClient;

export type PromptCenterOptions = {
  supabase?: PromptCenterSupabase;
  environment?: string;
};

export type RenderPromptResult = {
  prompt: ActivePrompt;
  renderedPrompt: string;
  variables: Record<string, unknown>;
  missingVariables: string[];
};

export type CreatePromptVersionInput = {
  key: string;
  worker: string;
  task: string;
  language: string;
  version: string;
  status?: PromptStatus;
  promptBody: string;
  environment?: string;
  description?: string | null;
  templateMetadata?: Record<string, unknown>;
  versionMetadata?: Record<string, unknown>;
  archiveExistingActive?: boolean;
  supabase?: PromptCenterSupabase;
};

export class PromptCenterError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PromptCenterError";
  }
}

