// HTML-escape a value before interpolating it into an innerHTML template.
// Whitespace normalization (see the app's escapeText) is not sanitization: a value
// that reaches innerHTML must have its meta-characters escaped here first.
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
