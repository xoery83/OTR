type ErrorLike = {
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  code?: unknown;
};

export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const errorLike = error as ErrorLike;
    const parts = [
      errorLike.message,
      errorLike.details,
      errorLike.hint,
      errorLike.code ? `Code: ${errorLike.code}` : null,
    ].filter((part): part is string => typeof part === "string" && part.length > 0);

    if (parts.length > 0) {
      return parts.join(" ");
    }
  }

  return fallback;
}
