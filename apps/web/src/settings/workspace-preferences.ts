export type WorkspaceTheme = 'LIGHT' | 'DARK';
export type WorkspaceFontFamily = 'PRETENDARD' | 'NOTO_SANS_KR' | 'SYSTEM';
export type WorkspaceDensity = 'COMFORTABLE' | 'COMPACT';

export interface WorkspacePreferences {
  theme: WorkspaceTheme;
  fontFamily: WorkspaceFontFamily;
  fontScale: number;
  density: WorkspaceDensity;
  reduceMotion: boolean;
  version: number;
  updatedAt: string | null;
}

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  theme: 'LIGHT', fontFamily: 'PRETENDARD', fontScale: 100, density: 'COMFORTABLE', reduceMotion: false, version: 0, updatedAt: null
};

export const WORKSPACE_PREFERENCE_EVENT = 'claim-center-workspace-preferences';

export function applyWorkspacePreferences(preferences: WorkspacePreferences): void {
  const root = document.documentElement;
  root.dataset.theme = preferences.theme.toLowerCase();
  root.dataset.fontFamily = preferences.fontFamily.toLowerCase();
  root.dataset.density = preferences.density.toLowerCase();
  root.dataset.reduceMotion = preferences.reduceMotion ? 'true' : 'false';
  root.style.colorScheme = preferences.theme.toLowerCase();
  root.style.setProperty('--user-font-scale', String(preferences.fontScale / 100));
  window.localStorage.setItem('claim-center-theme', preferences.theme.toLowerCase());
  window.localStorage.setItem('claim-center-workspace-preferences', JSON.stringify(preferences));
}

export function readCachedWorkspacePreferences(): WorkspacePreferences {
  try {
    const raw = window.localStorage.getItem('claim-center-workspace-preferences');
    if (!raw) return DEFAULT_WORKSPACE_PREFERENCES;
    const value = JSON.parse(raw) as Partial<WorkspacePreferences>;
    if (!['LIGHT','DARK'].includes(String(value.theme)) || !['PRETENDARD','NOTO_SANS_KR','SYSTEM'].includes(String(value.fontFamily))
      || !['COMFORTABLE','COMPACT'].includes(String(value.density)) || !Number.isInteger(value.fontScale)
      || Number(value.fontScale) < 90 || Number(value.fontScale) > 130 || typeof value.reduceMotion !== 'boolean') return DEFAULT_WORKSPACE_PREFERENCES;
    return { ...DEFAULT_WORKSPACE_PREFERENCES, ...value } as WorkspacePreferences;
  } catch { return DEFAULT_WORKSPACE_PREFERENCES; }
}

export function announceWorkspacePreferences(preferences: WorkspacePreferences): void {
  applyWorkspacePreferences(preferences);
  window.dispatchEvent(new CustomEvent<WorkspacePreferences>(WORKSPACE_PREFERENCE_EVENT, { detail: preferences }));
}
