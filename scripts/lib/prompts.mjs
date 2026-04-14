import fs from "node:fs";
import path from "node:path";

/**
 * Replace {{KEY}} placeholders in a template string.
 * Unknown keys are replaced with empty string.
 * @param {string} template
 * @param {Record<string, string>} vars
 * @returns {string}
 */
export function interpolateTemplate(template, vars) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => vars[key] ?? "");
}

/**
 * Load a prompt template from the prompts/ directory.
 * @param {string} pluginRoot - CLAUDE_PLUGIN_ROOT path
 * @param {string} name - Template name (without .md extension)
 * @returns {string} Template content
 */
export function loadPromptTemplate(pluginRoot, name) {
  const filePath = path.join(pluginRoot, "prompts", `${name}.md`);
  return fs.readFileSync(filePath, "utf8");
}
