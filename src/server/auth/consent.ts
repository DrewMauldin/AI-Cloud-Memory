export const CONSENT_SUBMIT_PATH = "/bridge/finish";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function filterScopes(
  requested: readonly string[],
  supported: readonly string[],
): string[] {
  const supportedSet = new Set(supported);
  return [...new Set(requested.filter((scope) => supportedSet.has(scope)))];
}

export function unsupportedScopes(
  requested: readonly string[],
  supported: readonly string[],
): string[] {
  const supportedSet = new Set(supported);
  return [...new Set(requested.filter((scope) => !supportedSet.has(scope)))];
}

export function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}
