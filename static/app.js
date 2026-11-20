const endpoint = 'https://openrouter.ai/api/v1/chat/completions';

const form = document.getElementById('experiment-form');
const notes = document.getElementById('notes');
const instructions = document.getElementById('instructions');
const key = document.getElementById('api-key');
const run = document.getElementById('run');
const cancel = document.getElementById('cancel');
const result = document.getElementById('result');
const resultTitle = document.getElementById('result-title');
const resultMeta = document.getElementById('result-meta');
const runStatus = document.getElementById('run-status');
const copyStatus = document.getElementById('copy-status');
let activeRequest;

function setStatus(element, message, error = false) {
  element.toggleAttribute('data-error', error);
  element.textContent = message;
}

async function copy(value, status, success, failure) {
  try {
    await navigator.clipboard.writeText(value);
    setStatus(status, success);
  } catch {
    setStatus(status, failure, true);
  }
}

function providerError(status) {
  switch (status) {
    case 401: return 'OpenRouter rejected the key. Check it or create a new one.';
    case 402: return 'OpenRouter requires attention to your account balance or key limit.';
    case 403: return 'OpenRouter denied the request. Check your account and key settings.';
    case 429: return 'OpenRouter or the model is rate-limited. Try again in a moment.';
    case 502:
    case 503: return 'The free model is temporarily unavailable. Try again in a moment.';
    default: return `OpenRouter returned an error (${status}). Try again or check your account.`;
  }
}

document.getElementById('load-sample').addEventListener('click', event => {
  if (notes.value.trim() && notes.value !== event.currentTarget.dataset.notes) {
    if (!window.confirm('Replace your notes with the sample?')) return;
  }
  notes.value = event.currentTarget.dataset.notes;
  notes.focus();
});

document.getElementById('clear-key').addEventListener('click', () => {
  key.value = '';
  activeRequest?.abort('key-cleared');
  key.focus();
  setStatus(runStatus, 'Key cleared.');
});

window.addEventListener('pageshow', event => {
  if (event.persisted) key.value = '';
});

document.getElementById('share').addEventListener('click', event => {
  const url = new URL(window.location.pathname, window.location.origin);
  url.hash = event.currentTarget.closest('section').id;
  copy(url.href, document.getElementById('share-status'), 'Example link copied.',
    `Copy this example link: ${url.href}`);
});

document.getElementById('copy-result').addEventListener('click', () => {
  copy(result.textContent, copyStatus, 'Result copied.', 'Select the result text and copy it.');
});

cancel.addEventListener('click', () => activeRequest?.abort());

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (activeRequest) return;

  const input = notes.value.trim();
  const prompt = instructions.value.trim();
  const apiKey = key.value.trim();
  const missing = [
    [notes, input, 'Enter your notes or load the sample.'],
    [instructions, prompt, 'Enter instructions for the model.'],
    [key, apiKey, 'Enter your OpenRouter key to run the example.'],
  ].find(([, value]) => !value);
  if (missing) {
    const [field, , message] = missing;
    if (field === instructions) document.getElementById('prompt').open = true;
    field.focus();
    setStatus(runStatus, message, true);
    return;
  }

  const request = new AbortController();
  activeRequest = request;
  const timeout = window.setTimeout(() => request.abort('timeout'), 60_000);
  const focusOnRun = document.activeElement === run;
  run.disabled = true;
  cancel.hidden = false;
  if (focusOnRun) cancel.focus();
  setStatus(runStatus, 'Waiting for OpenRouter…');
  setStatus(copyStatus, '');

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: form.dataset.model,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: input },
        ],
        max_tokens: 650,
        stream: false,
      }),
      signal: request.signal,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) {
      setStatus(runStatus, providerError(response.status), true);
      return;
    }

    const payload = await response.json();
    const choice = payload?.choices?.[0];
    const content = choice?.message?.content;
    if (choice?.error || choice?.finish_reason === 'error' || typeof content !== 'string' || !content.trim()) {
      setStatus(runStatus, 'OpenRouter returned no usable text. Try again.', true);
      return;
    }

    result.textContent = content.trim();
    resultTitle.textContent = 'Your result';
    resultMeta.textContent = typeof payload.model === 'string' ? payload.model : 'Generated with OpenRouter';
    const message = choice.finish_reason === 'length'
      ? 'Partial result ready. The model reached its output limit.'
      : 'Result ready.';
    setStatus(runStatus, message);
  } catch {
    if (request.signal.aborted) {
      if (request.signal.reason === 'key-cleared') return;
      const timedOut = request.signal.reason === 'timeout';
      setStatus(runStatus, timedOut ? 'OpenRouter took too long. Try again.' : 'Run canceled.', timedOut);
      return;
    }
    setStatus(runStatus, 'Could not read a response from OpenRouter. Check your connection and try again.', true);
  } finally {
    window.clearTimeout(timeout);
    activeRequest = undefined;
    run.disabled = false;
    if (document.activeElement === cancel) run.focus();
    cancel.hidden = true;
  }
});
