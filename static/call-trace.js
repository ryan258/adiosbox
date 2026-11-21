const maximumCalls = 20;

export function traceBody(text, apiKey = '') {
  if (text === null) return null;
  const safe = apiKey
    ? text.replaceAll(JSON.stringify(apiKey).slice(1, -1), '[redacted]').replaceAll(apiKey, '[redacted]')
    : text;
  try {
    return JSON.parse(safe);
  } catch {
    return safe;
  }
}

export function setupCallTrace(copy) {
  const dialog = document.getElementById('call-trace');
  const output = document.getElementById('call-trace-json');
  const closeButton = document.getElementById('call-trace-close');
  const copyButton = document.getElementById('call-trace-copy');
  const clearButton = document.getElementById('call-trace-clear');
  const status = document.getElementById('call-trace-status');
  const calls = [];
  let sequence = 0;

  function render() {
    if (!dialog.open) return;
    const { selectionStart, selectionEnd, scrollTop, scrollLeft } = output;
    output.value = calls.length ? JSON.stringify(calls, null, 2) : '';
    output.setSelectionRange(selectionStart, selectionEnd);
    output.scrollTop = scrollTop;
    output.scrollLeft = scrollLeft;
    copyButton.disabled = clearButton.disabled = !calls.length;
  }

  function clear() {
    calls.length = 0;
    status.textContent = '';
    render();
  }

  document.getElementById('call-trace-open').addEventListener('click', () => {
    status.textContent = '';
    dialog.showModal();
    render();
  });
  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { output.value = ''; });
  copyButton.addEventListener('click', () => {
    copy(output.value, status, 'Call trace copied.', 'Select the trace text and copy it.');
  });
  clearButton.addEventListener('click', () => {
    clear();
    closeButton.focus();
  });

  return {
    clear,
    start(experiment, step, request) {
      const call = { call: ++sequence, experiment, step, started_at: new Date().toISOString(), request, state: 'pending' };
      calls.push(call);
      if (calls.length > maximumCalls) calls.shift();
      render();
      return result => {
        if (!calls.includes(call)) return;
        Object.assign(call, { finished_at: new Date().toISOString() }, result);
        render();
      };
    },
  };
}
