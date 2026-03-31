/**
 * Progressive tool loading — detect which categories are needed
 * and return only those tool schemas.
 *
 * Level 0: no tools loaded, manifest appended to system prompt (~300 tokens)
 * Level 1: one or more category schemas loaded on demand
 */

// Category → tool names mapping (mirrors filterToolsByPermissions sets in tools.js)
export const TOOL_CATEGORIES = {
  calculators: [
    'list_calculators', 'describe_calculator', 'execute_calculator',
    'create_calculator', 'update_calculator', 'get_calculator_config',
    'configure_calculator', 'deploy_calculator',
  ],
  knowledge: [
    'search_knowledge', 'ask_knowledge', 'list_knowledge_bases',
    'create_knowledge_base', 'get_knowledge_base', 'upload_to_knowledge_base',
  ],
};

// Keywords that trigger each category
// Note: 'kb' uses a regex word-boundary check in detectCategories (see below)
const CATEGORY_KEYWORDS = {
  calculators: [
    'calculator', 'calculate', 'calc', 'compute', 'formula',
    'deploy', 'configure', 'execute', 'excel', 'spreadsheet',
    'input', 'output',
  ],
  knowledge: [
    'knowledge', 'knowledge base', 'search', 'document', 'upload',
    'answer', 'source', 'cite', 'reference',
  ],
};

// Regex-based keywords (word-boundary matching to avoid false positives)
const CATEGORY_KEYWORD_PATTERNS = {
  knowledge: [/\bkb\b/i],
};

/**
 * Detect which tool categories are needed based on user message + conversation history.
 *
 * Sticky loading: if a previous assistant turn used a tool from a category,
 * that category stays loaded for this round.
 *
 * @param {string} userMessage
 * @param {Array} conversationMessages — full messages array (before appending current)
 * @returns {Set<string>} category names
 */
export function detectCategories(userMessage, conversationMessages = []) {
  const needed = new Set();
  const lower = userMessage.toLowerCase();

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      needed.add(category);
      continue;
    }
    const patterns = CATEGORY_KEYWORD_PATTERNS[category];
    if (patterns && patterns.some(re => re.test(lower))) {
      needed.add(category);
    }
  }

  // Sticky: keep categories that were used in prior assistant turns
  for (const msg of conversationMessages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          for (const [category, toolNames] of Object.entries(TOOL_CATEGORIES)) {
            if (toolNames.includes(block.name)) {
              needed.add(category);
            }
          }
        }
      }
    }
  }

  return needed;
}

/**
 * Level 0 manifest — appended to system prompt when no categories are loaded.
 * Describes available tool categories without full JSON schemas.
 *
 * @param {object|null} permissions — API key permissions object
 * @param {boolean} isPublicRequest
 * @returns {string} manifest text to append to system prompt (empty string if nothing available)
 */
export function getToolManifest(permissions, isPublicRequest) {
  const hasCalc = !permissions || permissions.calc !== false;
  const hasKb = !permissions || permissions.kb !== false;

  const sections = [];

  if (hasCalc) {
    if (isPublicRequest) {
      sections.push('- **Calculators**: list, describe, and execute calculators');
    } else {
      sections.push('- **Calculators**: list, describe, execute, create, update, configure, and deploy calculators');
    }
  }

  if (hasKb) {
    if (isPublicRequest) {
      sections.push('- **Knowledge Base**: search documents and get cited answers');
    } else {
      sections.push('- **Knowledge Base**: search, ask questions, create knowledge bases, manage documents');
    }
  }

  if (sections.length === 0) return '';

  return `\n\nAvailable tool categories (ask me to use them when needed):\n${sections.join('\n')}`;
}

/**
 * Build the tools array for an API call from the detected categories.
 * Applies category filtering first, then permission filtering via the caller.
 *
 * Returns the subset of allTools that belong to the needed categories.
 * Returns empty array when categories is empty (Level 0 mode).
 *
 * @param {Array} allTools — AI_TOOLS array
 * @param {Set<string>} categories — from detectCategories()
 * @returns {Array} filtered tool definitions (before permission filtering)
 */
export function getToolsForCategories(allTools, categories) {
  if (categories.size === 0) return [];

  const neededNames = new Set();
  for (const cat of categories) {
    const names = TOOL_CATEGORIES[cat];
    if (names) names.forEach(n => neededNames.add(n));
  }

  return allTools.filter(t => neededNames.has(t.name));
}
