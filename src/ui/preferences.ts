export type DoneBoardRetentionDays = 0 | 3 | 7 | 14 | 30;

export interface UiPreferences {
  textScale: "standard" | "large";
  density: "comfortable" | "compact";
  reduceMotion: boolean;
  highContrast: boolean;
  showMemoryExcerpts: boolean;
  expandCompletedTasks: boolean;
  doneBoardRetentionDays: DoneBoardRetentionDays;
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  textScale: "large",
  density: "comfortable",
  reduceMotion: false,
  highContrast: false,
  showMemoryExcerpts: true,
  expandCompletedTasks: false,
  doneBoardRetentionDays: 3,
};

const DONE_RETENTION_OPTIONS: readonly DoneBoardRetentionDays[] = [0, 3, 7, 14, 30];

const STORAGE_KEY = "cloud-memory-ui-preferences";

export function loadUiPreferences(): UiPreferences {
  try {
    const parsed: unknown = JSON.parse(window.localStorage?.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return DEFAULT_UI_PREFERENCES;
    const candidate = parsed as Partial<UiPreferences>;
    return {
      textScale: candidate.textScale === "standard" ? "standard" : "large",
      density: candidate.density === "compact" ? "compact" : "comfortable",
      reduceMotion: candidate.reduceMotion === true,
      highContrast: candidate.highContrast === true,
      showMemoryExcerpts: candidate.showMemoryExcerpts !== false,
      expandCompletedTasks: candidate.expandCompletedTasks === true,
      doneBoardRetentionDays: DONE_RETENTION_OPTIONS.includes(candidate.doneBoardRetentionDays as DoneBoardRetentionDays)
        ? candidate.doneBoardRetentionDays as DoneBoardRetentionDays
        : 3,
    };
  } catch {
    return DEFAULT_UI_PREFERENCES;
  }
}

export function applyUiPreferences(preferences: UiPreferences) {
  const root = document.documentElement;
  root.dataset.textScale = preferences.textScale;
  root.dataset.density = preferences.density;
  root.dataset.reduceMotion = String(preferences.reduceMotion);
  root.dataset.highContrast = String(preferences.highContrast);
  root.dataset.memoryExcerpts = String(preferences.showMemoryExcerpts);
}

export function saveUiPreferences(preferences: UiPreferences) {
  try { window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(preferences)); }
  catch { /* Private browsing can disable persistent storage. */ }
}
