export function runRecordText(trace) {
  return [...trace.querySelectorAll('[data-handoff-output]')].map(entry =>
    [...entry.querySelectorAll('[data-handoff-title], [data-handoff-model], [data-handoff-text]')]
      .map(item => item.textContent.trim()).join('\n')).join('\n\n');
}

export function setupHandoff(experiments, openExperiment) {
  const dialog = document.getElementById('handoff');
  const form = document.getElementById('handoff-form');
  const sourceLabel = document.getElementById('handoff-source');
  const destination = document.getElementById('handoff-destination');
  const text = document.getElementById('handoff-text');
  const append = document.getElementById('handoff-append');
  const status = document.getElementById('handoff-status');
  const fields = new Map(experiments.map(experiment =>
    [experiment.id, { experiment, notes: experiment.querySelector('[data-part="notes"]') }]));
  let source;

  function prepare() {
    const target = fields.get(destination.value);
    const draft = target?.notes.value;
    const hasDraft = Boolean(draft?.trim() && draft !== target.notes.defaultValue);
    const incoming = text.value.trim();
    const combined = hasDraft && append.checked
      ? `${draft}\n\nFrom ${source.label}\n${incoming}`
      : incoming;
    return { target, hasDraft, incoming, combined };
  }

  function describe() {
    const { target, hasDraft, incoming, combined } = prepare();
    status.removeAttribute('data-error');
    if (!target) status.textContent = '';
    else if (!incoming) status.textContent = 'Enter some text to carry forward.';
    else if (combined.length > target.notes.maxLength) {
      status.textContent = `Shorten the text by at least ${combined.length - target.notes.maxLength} characters to fit the next input.`;
      status.setAttribute('data-error', '');
    } else if (hasDraft) {
      status.textContent = append.checked ? 'Your existing draft will be kept.' : 'This will replace the current draft.';
    } else {
      status.textContent = '';
    }
  }

  destination.addEventListener('change', () => {
    append.checked = true;
    append.parentElement.hidden = !prepare().hasDraft;
    describe();
  });
  text.addEventListener('input', describe);
  append.addEventListener('change', describe);

  form.addEventListener('submit', event => {
    event.preventDefault();
    const { target, incoming, combined } = prepare();
    if (!target) {
      status.textContent = 'Choose the next experiment.';
      destination.focus();
      return;
    }
    if (!incoming || combined.length > target.notes.maxLength) {
      describe();
      text.focus();
      return;
    }
    target.notes.value = combined;
    target.experiment.dispatchEvent(new Event('input-handoff'));
    dialog.close();
    openExperiment(target.experiment, target.notes);
  });

  document.getElementById('handoff-cancel').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    source = undefined;
    text.value = '';
  });

  for (const experiment of experiments) {
    experiment.addEventListener('click', event => {
      if (!event.target.closest('[data-handoff]')) return;
      const output = event.target.closest('[data-handoff-output]');
      const content = output.hasAttribute('data-handoff-record')
        ? runRecordText(output)
        : output.querySelector('[data-handoff-text]').textContent.trim();
      if (!content) return;

      const experimentTitle = experiment.querySelector('h2').textContent.trim();
      const outputTitle = output.querySelector('[data-handoff-title]').textContent.trim();
      source = { label: `${experimentTitle} · ${outputTitle}` };
      sourceLabel.textContent = source.label;
      text.value = content;
      for (const option of destination.options) option.disabled = option.value === experiment.id;
      destination.value = '';
      append.parentElement.hidden = true;
      append.checked = true;
      describe();
      dialog.showModal();
      destination.focus();
    });
  }
}

export function appendRunRecord(trace, title, content, model = '') {
  const entry = document.createElement('li');
  entry.setAttribute('data-handoff-output', '');
  const heading = document.createElement('h4');
  heading.setAttribute('data-handoff-title', '');
  heading.textContent = title;
  entry.append(heading);
  if (model) {
    const meta = document.createElement('p');
    meta.className = 'help';
    meta.setAttribute('data-handoff-model', '');
    meta.textContent = model;
    entry.append(meta);
  }
  const text = document.createElement('div');
  text.className = 'result';
  text.setAttribute('data-handoff-text', '');
  text.textContent = content;
  entry.append(text);
  const options = document.getElementById('step-options');
  if (options) entry.append(options.content.cloneNode(true));
  trace.append(entry);
}
