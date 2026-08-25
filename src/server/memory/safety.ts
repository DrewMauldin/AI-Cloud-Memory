const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/-]{20,}/i,
  /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|recovery[_ -]?code|token|secret|password|passwd)\s*[:=]\s*['"]?\S{8,}/i,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
] as const;

export class SecretPatternError extends Error {
  readonly code = "SECRET_PATTERN" as const;

  constructor() {
    super("Memory content appears to contain secret-like material");
    this.name = "SecretPatternError";
  }
}

export function hasSecretPattern(content: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(content));
}

export function assertSafeMemoryContent(content: string): void {
  if (hasSecretPattern(content)) throw new SecretPatternError();
}
