import { describe, expect, it } from "vitest";

import {
  SecretPatternError,
  assertSafeMemoryContent,
  hasSecretPattern,
} from "./safety";

describe("memory secret-pattern guard", () => {
  it.each([
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
    "-----BEGIN PRIVATE KEY-----",
    `OPENAI_API_KEY=sk-${"x".repeat(32)}`,
    "password: this-is-a-very-long-password-value",
    `github_pat_${"x".repeat(40)}`,
    `AWS_ACCESS_KEY_ID=AKIA${"A".repeat(16)}`,
  ])("detects secret-like content without returning the value", (content) => {
    expect(hasSecretPattern(content)).toBe(true);
    expect(() => assertSafeMemoryContent(content)).toThrow(SecretPatternError);
    expect(() => assertSafeMemoryContent(content)).toThrow("secret-like material");
    try {
      assertSafeMemoryContent(content);
    } catch (error) {
      expect(String(error)).not.toContain(content);
    }
  });

  it("allows ordinary durable memory content", () => {
    expect(() => assertSafeMemoryContent(
      "Prefer Australian English and concise technical explanations.",
    )).not.toThrow();
  });
});
