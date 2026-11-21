export const teachbackRoutes = ['proceed', 'revise', 'stop'];
export const providerSlug = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*){0,2}$/;
export const completionTokenLimit = 2048;
export const reasoningTokenLimit = 1024;
// A capped reasoning model gets extra room so the answer still fits if its endpoint ignores the cap.
export const reasoningCompletionTokenLimit = 4096;
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

export const isFreeModel = id => id === 'openrouter/free' || id.endsWith(':free');
// A reasoning model can spend the whole reply budget thinking and return nothing. Every free model OpenRouter lists
// now reasons, so free models (and the router) get the same cap as the Nemotron Super VL IDs. A provider-pinned
// request skips it for free models, because require_parameters would rule out endpoints that don't take it.
// Mirrored by caps_reasoning in scripts/playground.py.
export const capsReasoning = (modelId, provider) => reasoningCapped.has(modelId) || (isFreeModel(modelId) && !provider);

// Free endpoints are flaky, and a retry costs nothing, so a failure marked retryable: true may get another try.
// Paid models never retry silently, and anything not explicitly marked retryable stops at once.
// The retries share one budget per run (one AbortSignal), so a run sends at most its displayed request count
// plus freeRetryLimit. The caller's deadline covers the backoff too.
// ponytail: fixed backoff; honor Retry-After if free endpoints start sending it.
export const freeRetryLimit = 2;
const retriesUsed = new WeakMap();

export async function withFreeRetries(modelId, signal, attempt, delays = [1000, 3000]) {
  for (let tries = 0; ; tries += 1) {
    try {
      return await attempt(tries);
    } catch (error) {
      if (signal.aborted) throw error;
      const used = retriesUsed.get(signal) ?? 0;
      if (!isFreeModel(modelId) || error?.retryable !== true || tries >= delays.length || used >= freeRetryLimit) {
        if (error instanceof Error && tries) error.message += ` Tried ${tries + 1} times on the free model.`;
        else if (error instanceof Error && error.retryable === true && isFreeModel(modelId) && used >= freeRetryLimit) {
          error.message += ' This run already used its automatic retries.';
        }
        throw error;
      }
      retriesUsed.set(signal, used + 1);
      await new Promise((resolve, reject) => {
        const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, delays[tries]);
        signal.addEventListener('abort', onAbort, { once: true });
      });
    }
  }
}

// The one request body for hosted and local runs. The local launcher validates it and forwards it.
export function completionBody({ modelId, prompt, input, includeUsage = false, provider, enforceTeachbackSchema = false }) {
  return {
    model: modelId,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: input },
    ],
    max_tokens: capsReasoning(modelId, provider) ? reasoningCompletionTokenLimit : completionTokenLimit,
    stream: false,
    ...(capsReasoning(modelId, provider) && { reasoning: { max_tokens: reasoningTokenLimit } }),
    ...(includeUsage && { usage: { include: true } }),
    ...(provider && { provider: { only: [provider], allow_fallbacks: false, require_parameters: true } }),
    ...(enforceTeachbackSchema && { response_format: teachbackFormat }),
  };
}

export function describeModel(requested, reported) {
  if (!reported) return `Requested ${requested} · OpenRouter did not report the responding model`;
  return requested === reported ? reported : `Requested ${requested} · Responded with ${reported}`;
}

function providerError(status, local) {
  switch (status) {
    case 401: return local
      ? 'OpenRouter rejected the key. Update .env and restart the local playground.'
      : 'OpenRouter rejected the key. Check it or create a new one.';
    case 402: return 'OpenRouter requires attention to your account balance or key limit.';
    case 403: return 'OpenRouter denied the request. Check your account and key settings.';
    case 429: return 'OpenRouter or the model is rate-limited. Try again in a moment.';
    case 504: return 'OpenRouter took too long. Try again.';
    case 502:
    case 503: return 'The selected model is temporarily unavailable. Try again in a moment.';
    default: return `OpenRouter returned an error (${status}). Try again or check your account.`;
  }
}

function openRouterMessage(text) {
  try {
    const message = JSON.parse(text)?.error?.message;
    return typeof message === 'string' && message.trim() ? `OpenRouter said: ${message.trim().slice(0, 300)}` : '';
  } catch {
    return '';
  }
}

export class CompletionError extends Error {
  constructor(message, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}

const transientStatus = new Set([408, 429, 500, 502, 503, 504]);

// Turn one OpenRouter response into a completion or a CompletionError marked retryable only when another try may help.
export function readCompletion(response, responseText, { modelId, provider, includeUsage = false, local = false }) {
  if (!response.ok) {
    if (provider && response.status === 404) {
      throw new CompletionError(`OpenRouter found no matching endpoint for ${modelId} at ${provider}. Check the provider and its supported parameters.`);
    }
    throw new CompletionError([providerError(response.status, local), openRouterMessage(responseText)].filter(Boolean).join(' '),
      transientStatus.has(response.status));
  }

  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new CompletionError('OpenRouter sent a reply that is not valid JSON. Call trace shows the raw response.');
  }
  const choice = payload?.choices?.[0];
  const content = choice?.message?.content;
  const reportedModel = typeof payload?.model === 'string' ? payload.model : '';
  const truncated = choice?.finish_reason === 'length';
  if (payload?.error || choice?.error || choice?.finish_reason === 'error') {
    // Only an embedded transient code (a 429 or 5xx relayed inside a 200) is worth another try.
    const code = Number((payload?.error ?? choice?.error)?.code);
    throw new CompletionError([`OpenRouter reported a completion error. ${describeModel(modelId, reportedModel)}.`,
      openRouterMessage(responseText), 'Try again or choose another model.'].filter(Boolean).join(' '), transientStatus.has(code));
  }
  const modelDetails = describeModel(modelId, reportedModel);
  // A filtered or refused reply is not an answer, even when partial text came back. Call trace keeps that text.
  if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) {
    throw new CompletionError(`The model declined or its reply was filtered. ${modelDetails}. Revise the prompt or input and try again. Call trace shows any partial text.`);
  }
  if (typeof content !== 'string' || !content.trim()) {
    if (truncated) {
      // Retrying with the same ceiling would hit it again.
      throw new CompletionError(`The model reached its token limit before returning an answer. ${modelDetails}. Try a shorter task or choose a non-reasoning model.`);
    }
    throw new CompletionError(`OpenRouter returned an empty reply. ${modelDetails}. Try choosing another model.`, true);
  }
  return {
    content: content.trim(),
    reportedModel,
    reportedProvider: typeof payload?.provider === 'string' ? payload.provider : '',
    truncated,
    usage: includeUsage ? payload.usage : undefined,
  };
}
