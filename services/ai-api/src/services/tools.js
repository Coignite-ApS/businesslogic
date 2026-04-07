import { randomUUID } from 'node:crypto';
import { queryAll, queryOne, query } from '../db.js';
import { config } from '../config.js';
import { executeToolViaFlow, isFlowToolEnabled } from './flow-tools.js';
import { LOCAL_EMBEDDING_MODEL } from './embedding-factory.js';

export const AI_TOOLS = [
  {
    name: 'list_calculators',
    description: "List all calculators available in the user's account. Returns calculator ID, name, description, and status.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'describe_calculator',
    description: 'Get detailed information about a specific calculator including its expected inputs, outputs, and description. Use this before executing a calculator to understand what inputs are needed.',
    input_schema: {
      type: 'object',
      properties: {
        calculator_id: { type: 'string', description: 'The calculator ID (e.g. "my-calculator")' },
      },
      required: ['calculator_id'],
    },
  },
  {
    name: 'execute_calculator',
    description: 'Execute a calculator with the given inputs and return the results. Always describe the calculator first to know the required inputs.',
    input_schema: {
      type: 'object',
      properties: {
        calculator_id: { type: 'string', description: 'The calculator ID' },
        inputs: { type: 'object', description: 'Input values as key-value pairs' },
        test: { type: 'boolean', description: 'If true, execute against the test environment. Defaults to false.' },
      },
      required: ['calculator_id', 'inputs'],
    },
  },
  {
    name: 'create_calculator',
    description: "Create a new calculator in the user's account.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Unique calculator ID. Lowercase alphanumeric with hyphens, 2-50 chars' },
        name: { type: 'string', description: 'Human-readable name' },
        description: { type: 'string', description: 'Optional description' },
      },
      required: ['id', 'name'],
    },
  },
  {
    name: 'update_calculator',
    description: "Update a calculator's name or description.",
    input_schema: {
      type: 'object',
      properties: {
        calculator_id: { type: 'string', description: 'The calculator ID to update' },
        name: { type: 'string', description: 'New name' },
        description: { type: 'string', description: 'New description' },
      },
      required: ['calculator_id'],
    },
  },
  {
    name: 'get_calculator_config',
    description: 'Get the full configuration status of a calculator.',
    input_schema: {
      type: 'object',
      properties: {
        calculator_id: { type: 'string', description: 'The calculator ID' },
        test: { type: 'boolean', description: 'If true, get test config. Defaults to false.' },
      },
      required: ['calculator_id'],
    },
  },
  {
    name: 'configure_calculator',
    description: "Configure a calculator's input and/or output schema. Uses partial merge.",
    input_schema: {
      type: 'object',
      properties: {
        calculator_id: { type: 'string', description: 'The calculator ID to configure' },
        test: { type: 'boolean', description: 'If true, configure test config.' },
        input: { type: 'object', description: 'Input schema with "properties" key' },
        output: { type: 'object', description: 'Output schema with "properties" key' },
      },
      required: ['calculator_id'],
    },
  },
  {
    name: 'deploy_calculator',
    description: 'Deploy a calculator to the Formula API. Config must be complete before deploying.',
    input_schema: {
      type: 'object',
      properties: {
        calculator_id: { type: 'string', description: 'The calculator ID to deploy' },
        test: { type: 'boolean', description: 'If true, deploy to test (6h window).' },
      },
      required: ['calculator_id'],
    },
  },
  {
    name: 'search_knowledge',
    description: "Search the user's knowledge bases for relevant document chunks using semantic similarity.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        knowledge_base_id: { type: 'string', description: 'Optional: specific KB ID to search' },
        limit: { type: 'number', description: 'Max results (default: 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'ask_knowledge',
    description: "Ask a question and get a cited answer from the user's knowledge base documents.",
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to answer' },
        knowledge_base_id: { type: 'string', description: 'Optional: specific KB ID' },
      },
      required: ['question'],
    },
  },
  {
    name: 'list_knowledge_bases',
    description: "List all knowledge bases in the user's account.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'create_knowledge_base',
    description: "Create a new knowledge base in the user's account.",
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name for the knowledge base' },
        description: { type: 'string', description: 'Optional description' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_knowledge_base',
    description: 'Get detailed information about a specific knowledge base. Lookup by ID or name.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Knowledge base ID (exact match)' },
        name: { type: 'string', description: 'Knowledge base name (partial match, case-insensitive)' },
      },
      required: [],
    },
  },
  {
    name: 'upload_to_knowledge_base',
    description: 'Upload a file to a knowledge base for indexing. File must already be in Directus.',
    input_schema: {
      type: 'object',
      properties: {
        knowledge_base_id: { type: 'string', description: 'The KB ID to upload to' },
        file_id: { type: 'string', description: 'The Directus file ID (UUID)' },
        title: { type: 'string', description: 'Optional title for the document' },
      },
      required: ['knowledge_base_id', 'file_id'],
    },
  },
];

/**
 * Safe subset of tools for public API access.
 * Only read/execute operations — no admin, create, update, configure, or deploy.
 */
export const PUBLIC_TOOLS = new Set([
  'list_calculators',
  'describe_calculator',
  'execute_calculator',
  'search_knowledge',
  'ask_knowledge',
  'list_knowledge_bases',
  'get_knowledge_base',
]);

/**
 * Filter AI_TOOLS based on API key permissions and public mode.
 * permissions: { ai: true, calc: true, flow: false, kb: true }
 * - calc: false → remove calculator tools
 * - kb: false → remove knowledge base tools
 * - flow: false → remove flow tools
 * - isPublicRequest: true → restrict to PUBLIC_TOOLS
 * If permissions is empty/null, return all tools (admin/internal calls).
 */
export function filterToolsByPermissions(tools, permissions, isPublicRequest = false) {
  let filtered = tools;

  // Public requests only get the safe subset
  if (isPublicRequest) {
    filtered = filtered.filter(tool => PUBLIC_TOOLS.has(tool.name));
  }

  if (!permissions || Object.keys(permissions).length === 0) return filtered;

  const calcTools = new Set([
    'list_calculators', 'describe_calculator', 'execute_calculator',
    'create_calculator', 'update_calculator', 'get_calculator_config',
    'configure_calculator', 'deploy_calculator',
  ]);
  const kbTools = new Set([
    'search_knowledge', 'ask_knowledge', 'list_knowledge_bases',
    'create_knowledge_base', 'get_knowledge_base', 'upload_to_knowledge_base',
  ]);
  const flowTools = new Set(['execute_flow']);

  return filtered.filter(tool => {
    if (calcTools.has(tool.name) && permissions.calc === false) return false;
    if (kbTools.has(tool.name) && permissions.kb === false) return false;
    if (flowTools.has(tool.name) && permissions.flow === false) return false;
    return true;
  });
}

export async function executeTool(toolName, toolInput, deps) {
  const { accountId, logger, allowedKbIds } = deps;

  // Try flow-based execution first (if enabled)
  if (isFlowToolEnabled()) {
    const flowResult = await executeToolViaFlow(toolName, toolInput, accountId, logger);
    if (flowResult.viaFlow && flowResult.result !== undefined) {
      return { result: flowResult.result, _flowExecutionId: flowResult.flowExecutionId };
    }
  }

  try {
    switch (toolName) {
      case 'list_calculators':
        return await listCalculators(accountId);
      case 'describe_calculator':
        return await describeCalculator(accountId, toolInput.calculator_id);
      case 'execute_calculator':
        return await executeCalculator(accountId, toolInput.calculator_id, toolInput.inputs, toolInput.test ?? false);
      case 'create_calculator':
        return await createCalculator(accountId, toolInput);
      case 'update_calculator':
        return await updateCalculator(accountId, toolInput);
      case 'get_calculator_config':
        return await getCalculatorConfig(accountId, toolInput.calculator_id, toolInput.test ?? false);
      case 'configure_calculator':
        return await configureCalculator(accountId, toolInput);
      case 'deploy_calculator':
        return await deployCalculator(accountId, toolInput.calculator_id, toolInput.test ?? false, logger);
      case 'search_knowledge':
        return await searchKnowledge(accountId, toolInput.query, toolInput.knowledge_base_id, toolInput.limit, allowedKbIds);
      case 'ask_knowledge':
        return await askKnowledge(accountId, toolInput.question, toolInput.knowledge_base_id, allowedKbIds);
      case 'list_knowledge_bases':
        return await listKnowledgeBases(accountId, allowedKbIds);
      case 'create_knowledge_base':
        return await createKnowledgeBase(accountId, toolInput);
      case 'get_knowledge_base':
        return await getKnowledgeBase(accountId, toolInput, allowedKbIds);
      case 'upload_to_knowledge_base':
        return await uploadToKb(accountId, toolInput, logger, allowedKbIds);
      default:
        return { result: `Unknown tool: ${toolName}`, isError: true };
    }
  } catch (err) {
    logger.error(`Tool ${toolName} failed: ${err.message}`);
    return { result: `Tool error: ${err.message}`, isError: true };
  }
}

// ─── Calculator tools ────────────────────────────────────────

async function listCalculators(accountId) {
  const rows = await queryAll(
    `SELECT id, name, description, activated, over_limit, test_enabled_at, test_expires_at
     FROM calculators WHERE account = $1 ORDER BY name`,
    [accountId],
  );
  const list = rows.map(c => ({
    id: c.id,
    name: c.name,
    description: c.description,
    status: c.activated ? (c.over_limit ? 'over_limit' : 'live') : 'inactive',
    test_available: !!(c.test_enabled_at && c.test_expires_at && new Date(c.test_expires_at) > new Date()),
  }));
  return { result: { calculators: list, count: list.length } };
}

async function describeCalculator(accountId, calculatorId) {
  const calc = await queryOne(
    'SELECT id, name, description FROM calculators WHERE id = $1 AND account = $2',
    [calculatorId, accountId],
  );
  if (!calc) return { result: `Calculator "${calculatorId}" not found in your account.`, isError: true };

  const cfg = await queryOne(
    'SELECT input, output, api_key FROM calculator_configs WHERE calculator = $1 AND test_environment = false',
    [calculatorId],
  );
  if (!cfg) return { result: `Calculator "${calculatorId}" has no live configuration.`, isError: true };

  // Try Formula API describe
  try {
    const headers = {};
    if (config.formulaApiAdminToken) headers['X-Admin-Token'] = config.formulaApiAdminToken;
    const res = await fetch(`${config.formulaApiUrl}/calculator/${encodeURIComponent(calculatorId)}/describe`, { headers });
    if (res.ok) {
      const data = await res.json();
      return { result: { id: calculatorId, name: calc.name, description: calc.description, ...data } };
    }
  } catch { /* fall back to stored config */ }

  return { result: { id: calculatorId, name: calc.name, description: calc.description, input: cfg.input, output: cfg.output } };
}

async function executeCalculator(accountId, calculatorId, inputs, test) {
  const calc = await queryOne(
    'SELECT id FROM calculators WHERE id = $1 AND account = $2',
    [calculatorId, accountId],
  );
  if (!calc) return { result: `Calculator "${calculatorId}" not found in your account.`, isError: true };

  const formulaId = test ? `${calculatorId}-test` : calculatorId;
  const cfg = await queryOne(
    'SELECT api_key FROM calculator_configs WHERE calculator = $1 AND test_environment = $2',
    [calculatorId, test],
  );
  if (!cfg) return { result: `Calculator "${calculatorId}" has no ${test ? 'test' : 'live'} configuration.`, isError: true };

  const headers = { 'Content-Type': 'application/json' };
  if (config.formulaApiAdminToken) headers['X-Admin-Token'] = config.formulaApiAdminToken;

  const res = await fetch(`${config.formulaApiUrl}/execute/calculator/${encodeURIComponent(formulaId)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(inputs),
  });
  const data = await res.json();
  if (!res.ok) return { result: `Execution failed: ${JSON.stringify(data)}`, isError: true };
  return { result: data };
}

const CALC_ID_RE = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/;

async function createCalculator(accountId, input) {
  if (!input.id || input.id.length < 2 || input.id.length > 50 || !CALC_ID_RE.test(input.id)) {
    return { result: 'Calculator ID must be 2-50 lowercase alphanumeric with hyphens', isError: true };
  }
  const existing = await queryOne('SELECT id FROM calculators WHERE id = $1', [input.id]);
  if (existing) return { result: `Calculator "${input.id}" already exists.`, isError: true };

  await query(
    `INSERT INTO calculators (id, account, name, description, activated, over_limit, date_created)
     VALUES ($1, $2, $3, $4, false, false, NOW())`,
    [input.id, accountId, input.name, input.description || null],
  );

  // Create test + live configs
  for (const testEnv of [false, true]) {
    await query(
      `INSERT INTO calculator_configs (id, calculator, test_environment, input, output, date_created)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [randomUUID(), input.id, testEnv, JSON.stringify({ type: 'object', properties: {} }), JSON.stringify({ type: 'object', properties: {} })],
    );
  }

  return { result: { id: input.id, name: input.name, status: 'created', next_steps: 'Upload an Excel file in the Calculators module, then configure inputs/outputs.' } };
}

async function updateCalculator(accountId, input) {
  const calc = await queryOne('SELECT id FROM calculators WHERE id = $1 AND account = $2', [input.calculator_id, accountId]);
  if (!calc) return { result: `Calculator "${input.calculator_id}" not found.`, isError: true };

  const updates = [];
  const params = [];
  let idx = 1;
  if (input.name !== undefined) { updates.push(`name = $${idx++}`); params.push(input.name); }
  if (input.description !== undefined) { updates.push(`description = $${idx++}`); params.push(input.description); }
  if (updates.length === 0) return { result: 'Nothing to update' };

  params.push(input.calculator_id);
  await query(`UPDATE calculators SET ${updates.join(', ')} WHERE id = $${idx}`, params);
  return { result: { id: input.calculator_id, updated: true } };
}

async function getCalculatorConfig(accountId, calculatorId, test) {
  const calc = await queryOne('SELECT id, name FROM calculators WHERE id = $1 AND account = $2', [calculatorId, accountId]);
  if (!calc) return { result: `Calculator "${calculatorId}" not found.`, isError: true };

  const cfg = await queryOne(
    'SELECT input, output, sheets, formulas FROM calculator_configs WHERE calculator = $1 AND test_environment = $2',
    [calculatorId, test],
  );
  if (!cfg) return { result: `No ${test ? 'test' : 'live'} configuration found.`, isError: true };

  const inputSchema = typeof cfg.input === 'string' ? JSON.parse(cfg.input) : cfg.input;
  const outputSchema = typeof cfg.output === 'string' ? JSON.parse(cfg.output) : cfg.output;
  const inputFields = Object.keys(inputSchema?.properties || {}).length;
  const outputFields = Object.keys(outputSchema?.properties || {}).length;
  const hasSheets = !!cfg.sheets;
  const hasFormulas = !!cfg.formulas;

  return {
    result: {
      calculator: calculatorId,
      environment: test ? 'test' : 'live',
      input_fields: inputFields,
      output_fields: outputFields,
      has_sheets: hasSheets,
      has_formulas: hasFormulas,
      complete: inputFields > 0 && outputFields > 0 && hasSheets && hasFormulas,
      input: inputSchema,
      output: outputSchema,
    },
  };
}

async function configureCalculator(accountId, input) {
  const calc = await queryOne('SELECT id FROM calculators WHERE id = $1 AND account = $2', [input.calculator_id, accountId]);
  if (!calc) return { result: `Calculator "${input.calculator_id}" not found.`, isError: true };

  const test = input.test ?? false;
  const cfg = await queryOne(
    'SELECT id, input, output FROM calculator_configs WHERE calculator = $1 AND test_environment = $2',
    [input.calculator_id, test],
  );
  if (!cfg) return { result: `No ${test ? 'test' : 'live'} configuration found.`, isError: true };

  const currentInput = typeof cfg.input === 'string' ? JSON.parse(cfg.input) : (cfg.input || { type: 'object', properties: {} });
  const currentOutput = typeof cfg.output === 'string' ? JSON.parse(cfg.output) : (cfg.output || { type: 'object', properties: {} });

  if (input.input?.properties) {
    for (const [key, val] of Object.entries(input.input.properties)) {
      if (val === null) { delete currentInput.properties[key]; }
      else { currentInput.properties[key] = val; }
    }
  }
  if (input.output?.properties) {
    for (const [key, val] of Object.entries(input.output.properties)) {
      if (val === null) { delete currentOutput.properties[key]; }
      else { currentOutput.properties[key] = val; }
    }
  }

  await query(
    'UPDATE calculator_configs SET input = $1, output = $2 WHERE id = $3',
    [JSON.stringify(currentInput), JSON.stringify(currentOutput), cfg.id],
  );

  return {
    result: {
      calculator: input.calculator_id,
      environment: test ? 'test' : 'live',
      input_fields: Object.keys(currentInput.properties).length,
      output_fields: Object.keys(currentOutput.properties).length,
    },
  };
}

async function deployCalculator(accountId, calculatorId, test, logger) {
  const calc = await queryOne('SELECT id, name, activated FROM calculators WHERE id = $1 AND account = $2', [calculatorId, accountId]);
  if (!calc) return { result: `Calculator "${calculatorId}" not found.`, isError: true };

  const cfg = await queryOne(
    'SELECT id, input, output, sheets, formulas, api_key FROM calculator_configs WHERE calculator = $1 AND test_environment = $2',
    [calculatorId, test],
  );
  if (!cfg) return { result: `No ${test ? 'test' : 'live'} configuration found.`, isError: true };

  const inputSchema = typeof cfg.input === 'string' ? JSON.parse(cfg.input) : cfg.input;
  const outputSchema = typeof cfg.output === 'string' ? JSON.parse(cfg.output) : cfg.output;
  if (!cfg.sheets || !cfg.formulas) return { result: 'Cannot deploy: missing sheets or formulas. Upload an Excel file first.', isError: true };
  if (Object.keys(inputSchema?.properties || {}).length === 0) return { result: 'Cannot deploy: no input fields configured.', isError: true };
  if (Object.keys(outputSchema?.properties || {}).length === 0) return { result: 'Cannot deploy: no output fields configured.', isError: true };

  const formulaId = test ? `${calculatorId}-test` : calculatorId;
  const headers = { 'Content-Type': 'application/json' };
  if (config.formulaApiAdminToken) headers['X-Admin-Token'] = config.formulaApiAdminToken;

  try {
    const res = await fetch(`${config.formulaApiUrl}/calculators`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: formulaId,
        sheets: typeof cfg.sheets === 'string' ? JSON.parse(cfg.sheets) : cfg.sheets,
        formulas: typeof cfg.formulas === 'string' ? JSON.parse(cfg.formulas) : cfg.formulas,
        input: inputSchema,
        output: outputSchema,
      }),
    });
    const data = await res.json();
    if (!res.ok) return { result: `Deploy failed: ${JSON.stringify(data)}`, isError: true };

    if (test) {
      const expires = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
      await query('UPDATE calculators SET test_enabled_at = NOW(), test_expires_at = $1 WHERE id = $2', [expires, calculatorId]);
    } else {
      await query('UPDATE calculators SET activated = true WHERE id = $1', [calculatorId]);
    }

    return { result: { calculator: calculatorId, deployed: true, environment: test ? 'test' : 'live' } };
  } catch (err) {
    logger.error(`Deploy calculator ${calculatorId} failed: ${err.message}`);
    return { result: `Deploy failed: ${err.message}`, isError: true };
  }
}

// ─── Knowledge base tools ────────────────────────────────────

async function searchKnowledge(accountId, searchQuery, kbId, limit, allowedKbIds) {
  // Check KB scoping: if key is restricted and tool requests a specific KB
  if (kbId && allowedKbIds !== null && allowedKbIds !== undefined && !allowedKbIds.includes(kbId)) {
    return { result: 'API key does not have access to this knowledge base', isError: true };
  }
  // This delegates to the KB search endpoint (internal call)
  const params = { query: searchQuery, knowledge_base_id: kbId, limit: limit || 5 };
  // Pass allowed KBs for cross-KB search filtering
  if (!kbId && allowedKbIds !== null && allowedKbIds !== undefined) {
    params.allowed_kb_ids = allowedKbIds;
  }
  const headers = { 'Content-Type': 'application/json' };
  if (config.adminToken) headers['X-Admin-Token'] = config.adminToken;
  headers['X-Account-Id'] = accountId;

  try {
    const res = await fetch(`http://localhost:${config.port}/v1/ai/kb/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { result: `Search failed: ${err.error || res.statusText}`, isError: true };
    }
    const data = await res.json();
    return { result: data.data || data };
  } catch (err) {
    return { result: `Search failed: ${err.message}`, isError: true };
  }
}

async function askKnowledge(accountId, question, kbId, allowedKbIds) {
  // Check KB scoping: if key is restricted and tool requests a specific KB
  if (kbId && allowedKbIds !== null && allowedKbIds !== undefined && !allowedKbIds.includes(kbId)) {
    return { result: 'API key does not have access to this knowledge base', isError: true };
  }
  const params = { question, knowledge_base_id: kbId };
  // Pass allowed KBs for cross-KB search filtering
  if (!kbId && allowedKbIds !== null && allowedKbIds !== undefined) {
    params.allowed_kb_ids = allowedKbIds;
  }
  const headers = { 'Content-Type': 'application/json' };
  if (config.adminToken) headers['X-Admin-Token'] = config.adminToken;
  headers['X-Account-Id'] = accountId;

  try {
    const res = await fetch(`http://localhost:${config.port}/v1/ai/kb/ask`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { result: `Ask failed: ${err.error || res.statusText}`, isError: true };
    }
    const data = await res.json();
    return { result: data.data || data };
  } catch (err) {
    return { result: `Ask failed: ${err.message}`, isError: true };
  }
}

async function listKnowledgeBases(accountId, allowedKbIds) {
  let kbs;
  if (allowedKbIds !== null && allowedKbIds !== undefined) {
    if (allowedKbIds.length === 0) return { result: { knowledge_bases: [], count: 0 } };
    kbs = await queryAll(
      `SELECT id, name, description, icon, document_count, chunk_count, last_indexed, status
       FROM knowledge_bases WHERE account = $1 AND id = ANY($2::uuid[])
       ORDER BY sort, name`,
      [accountId, allowedKbIds],
    );
  } else {
    kbs = await queryAll(
      `SELECT id, name, description, icon, document_count, chunk_count, last_indexed, status
       FROM knowledge_bases WHERE account = $1 ORDER BY sort, name`,
      [accountId],
    );
  }
  return { result: { knowledge_bases: kbs, count: kbs.length } };
}

async function createKnowledgeBase(accountId, input) {
  if (!input.name?.trim()) return { result: 'Name is required', isError: true };

  const embeddingModel = config.useLocalEmbeddings ? LOCAL_EMBEDDING_MODEL : config.embeddingModel;

  const id = randomUUID();
  await query(
    `INSERT INTO knowledge_bases (id, account, name, description, icon, document_count, chunk_count, embedding_model, status, date_created)
     VALUES ($1, $2, $3, $4, $5, 0, 0, $6, 'active', NOW())`,
    [id, accountId, input.name.trim(), input.description?.trim() || null, 'menu_book', embeddingModel],
  );
  const kb = await queryOne('SELECT * FROM knowledge_bases WHERE id = $1', [id]);
  return { result: kb };
}

async function getKnowledgeBase(accountId, input, allowedKbIds) {
  // KB scoping: check if API key has access to this specific KB
  if (input.id && allowedKbIds !== null && allowedKbIds !== undefined && !allowedKbIds.includes(input.id)) {
    return { result: 'API key does not have access to this knowledge base', isError: true };
  }
  let kb;
  if (input.id) {
    kb = await queryOne('SELECT * FROM knowledge_bases WHERE id = $1 AND account = $2', [input.id, accountId]);
  } else if (input.name) {
    kb = await queryOne('SELECT * FROM knowledge_bases WHERE LOWER(name) LIKE $1 AND account = $2 LIMIT 1', [`%${input.name.toLowerCase()}%`, accountId]);
  }
  if (!kb) return { result: 'Knowledge base not found', isError: true };

  const docs = await queryAll(
    `SELECT id, title, file_type, file_size, chunk_count, indexing_status, indexing_error, last_indexed
     FROM kb_documents WHERE knowledge_base = $1 ORDER BY date_created DESC`,
    [kb.id],
  );
  return { result: { ...kb, documents: docs } };
}

async function uploadToKb(accountId, input, logger, allowedKbIds) {
  // KB scoping: check if API key has access to this specific KB
  if (input.knowledge_base_id && allowedKbIds !== null && allowedKbIds !== undefined && !allowedKbIds.includes(input.knowledge_base_id)) {
    return { result: 'API key does not have access to this knowledge base', isError: true };
  }
  // This delegates to the KB upload endpoint (internal call)
  const params = { file_id: input.file_id, title: input.title };
  const headers = { 'Content-Type': 'application/json' };
  if (config.adminToken) headers['X-Admin-Token'] = config.adminToken;
  headers['X-Account-Id'] = accountId;

  try {
    const res = await fetch(`http://localhost:${config.port}/v1/ai/kb/${input.knowledge_base_id}/upload`, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { result: `Upload failed: ${err.error || res.statusText}`, isError: true };
    }
    const data = await res.json();
    return { result: data.data || data };
  } catch (err) {
    return { result: `Upload failed: ${err.message}`, isError: true };
  }
}

