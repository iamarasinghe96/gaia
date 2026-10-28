// The Groq chat models every AI feature tries, in order, and the per-model request settings.
// Groq retires models often: a retired one answers 404 and the next one is used, so keep this
// list current (console.groq.com/docs/models) and the rest of the code needs no change.
export const CHAT_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.3-70b-versatile',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'llama-3.1-8b-instant',
];

// gpt-oss models think before they answer, and that thinking counts towards the answer
// allowance. Keep it short and leave room for it, or the answer is cut off.
const REASONING = /^openai\/gpt-oss-/;
export function groqBody(model, body){
  if (!REASONING.test(model)) return body;
  return { ...body, reasoning_effort: 'low', max_completion_tokens: Math.min(32768, (body.max_completion_tokens || 4096) + 2048) };
}
