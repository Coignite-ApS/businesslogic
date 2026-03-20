/** Model pricing: cost per token */
const RATES = {
  'claude-sonnet-4-6': { input: 3 / 1_000_000, output: 15 / 1_000_000 },
  'claude-opus-4-6': { input: 15 / 1_000_000, output: 75 / 1_000_000 },
  'claude-haiku-4-5-20251001': { input: 0.8 / 1_000_000, output: 4 / 1_000_000 },
};

export function calculateCost(model, inputTokens, outputTokens) {
  const r = RATES[model] || RATES['claude-sonnet-4-6'];
  return +(inputTokens * r.input + outputTokens * r.output).toFixed(6);
}
