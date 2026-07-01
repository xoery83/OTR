import "server-only";

function valueAtPath(value: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, value);
}

function stringifyPromptValue(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function renderPromptBody(
  promptBody: string,
  variables: Record<string, unknown>,
) {
  const missingVariables = new Set<string>();
  const renderedPrompt = promptBody.replace(
    /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g,
    (_match, variableName: string) => {
      const value = valueAtPath(variables, variableName);
      if (value === undefined) {
        missingVariables.add(variableName);
        return "";
      }
      return stringifyPromptValue(value);
    },
  );

  return {
    renderedPrompt,
    missingVariables: [...missingVariables],
  };
}

