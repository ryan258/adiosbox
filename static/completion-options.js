export const teachbackRoutes = ['proceed', 'revise', 'stop'];
export const providerSlug = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*){0,2}$/;
export const completionTokenLimit = 2048;
export const reasoningTokenLimit = 1024;
// ponytail: one model needs a reasoning cap to leave room for an answer; generalize when a second one does.
const reasoningCapped = new Set(['nvidia/nemotron-3.5-super-vl', 'nvidia/nemotron-3.5-super-vl:free']);

const teachbackFormat = {
  type: 'json_schema',
  json_schema: {
    name: 'teachback_review',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        route: { type: 'string', enum: teachbackRoutes },
        reason: { type: 'string' },
      },
      required: ['route', 'reason'],
      additionalProperties: false,
    },
  },
};

// The one request body for hosted and local runs. The local launcher validates it and forwards it.
export function completionBody({ modelId, prompt, input, includeUsage = false, provider, enforceTeachbackSchema = false }) {
  return {
    model: modelId,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: input },
    ],
    max_tokens: completionTokenLimit,
    stream: false,
    ...(reasoningCapped.has(modelId) && { reasoning: { max_tokens: reasoningTokenLimit } }),
    ...(includeUsage && { usage: { include: true } }),
    ...(provider && { provider: { only: [provider], allow_fallbacks: false, require_parameters: true } }),
    ...(enforceTeachbackSchema && { response_format: teachbackFormat }),
  };
}
