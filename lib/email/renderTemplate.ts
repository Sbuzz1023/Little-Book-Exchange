// Fills {{name}} placeholders in a plain-text email template. Unknown
// placeholders (not present in `vars`) are left as-is rather than blanked
// out, so a typo in an admin-edited template is visible, not silently eaten.
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match
  )
}
