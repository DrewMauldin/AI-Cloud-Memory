// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { applyUiPreferences, DEFAULT_UI_PREFERENCES, loadUiPreferences, saveUiPreferences } from "./preferences";

describe("UI preferences", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
    document.documentElement.removeAttribute("data-text-scale");
    document.documentElement.removeAttribute("data-density");
  });

  it("falls back safely when stored preferences are invalid", () => {
    window.localStorage.setItem("cloud-memory-ui-preferences", "not-json");

    expect(loadUiPreferences()).toEqual(DEFAULT_UI_PREFERENCES);
  });

  it("keeps Done retention on a bounded supported value", () => {
    window.localStorage.setItem("cloud-memory-ui-preferences", JSON.stringify({
      ...DEFAULT_UI_PREFERENCES,
      doneBoardRetentionDays: 999,
    }));

    expect(loadUiPreferences().doneBoardRetentionDays).toBe(3);
  });

  it("round-trips bounded preferences and applies display attributes", () => {
    const preferences = {
      ...DEFAULT_UI_PREFERENCES,
      density: "compact" as const,
      reduceMotion: true,
      showMemoryExcerpts: false,
      doneBoardRetentionDays: 7 as const,
    };

    saveUiPreferences(preferences);
    expect(loadUiPreferences()).toEqual(preferences);

    applyUiPreferences(preferences);
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(document.documentElement.dataset.reduceMotion).toBe("true");
    expect(document.documentElement.dataset.memoryExcerpts).toBe("false");
  });
});
