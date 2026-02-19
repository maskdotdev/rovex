export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function toOptionalErrorMessage(error: unknown): string | null {
  if (!error) return null;
  return toErrorMessage(error);
}
