export const themePreferences = ["system", "light", "dark"];

export function normalizeThemePreference(value) {
  return themePreferences.includes(value) ? value : "system";
}

export function resolveTheme(preference, prefersDark) {
  const normalized = normalizeThemePreference(preference);
  return normalized === "system" ? (prefersDark ? "dark" : "light") : normalized;
}

export function applyTheme(root, themeColorMeta, preference, prefersDark) {
  const theme = resolveTheme(preference, prefersDark);
  root.dataset.theme = theme;
  themeColorMeta.content = theme === "dark" ? "#0c1320" : "#f4f7f8";
  return theme;
}
