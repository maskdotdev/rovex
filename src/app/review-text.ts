const DEFAULT_REVIEW_MESSAGE_MAX_CHARS = 4_000;

function decodeEscapedWhitespace(message: string) {
  return message
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "  ");
}

export function formatReviewMessage(
  message: string | null | undefined,
  maxChars = DEFAULT_REVIEW_MESSAGE_MAX_CHARS
) {
  const raw = message?.trim();
  if (!raw) return "";

  const normalized = decodeEscapedWhitespace(raw).replace(/\r\n/g, "\n");
  if (maxChars <= 0 || normalized.length <= maxChars) {
    return normalized;
  }

  const remaining = normalized.length - maxChars;
  const clipped = normalized.slice(0, maxChars).trimEnd();
  return `${clipped}\n\n...(${remaining.toLocaleString()} more characters)`;
}
