const prefix = 'adiosbox.case.1.';
const format = 'adiosbox-cases';
const schemaVersion = 1;
const fieldName = /^(?:notes|instructions(?:-b)?|minutes|(?:role|fact):[a-z][a-z0-9-]*)$/;
const keyPattern = /\bsk-or-v1-[a-z0-9_-]{16,}\b/i;

function cleanCase(value) {
  if (!value || !/^[a-f0-9-]{36}$/.test(value.id ?? '') ||
      !/^[a-z0-9-]+$/.test(value.experiment ?? '') ||
      !Number.isSafeInteger(value.savedAt) ||
      typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100 ||
      typeof value.expected !== 'string' || value.expected.length > 1500 ||
      typeof value.model !== 'string' || value.model.length > 200 ||
      typeof value.revision !== 'string' || value.revision.length > 140 ||
      typeof value.graphRevision !== 'string' || value.graphRevision.length > 100 ||
      !value.fields || typeof value.fields !== 'object' || Array.isArray(value.fields)) {
    throw new Error('The case data has an invalid format.');
  }
  const fields = Object.entries(value.fields);
  if (fields.length > 50 || fields.some(([name, value]) =>
    !fieldName.test(name) || typeof value !== 'string' || value.length > 8000)) {
    throw new Error('A saved input or model field has an invalid format.');
  }
  if ([value.name, value.expected, value.model, ...fields.map(([, content]) => content)]
    .some(content => keyPattern.test(content))) {
    throw new Error('Remove the OpenRouter key from the case before saving or importing.');
  }
  const receipt = value.receipt;
  if (receipt != null && (value.experiment !== 'change-one-fact' ||
      !Array.isArray(receipt) || receipt.length !== 3 || receipt.some(check => typeof check !== 'boolean'))) {
    throw new Error('The saved fact-test checks have an invalid format.');
  }
  const { id, experiment, name, expected, model, revision, graphRevision, savedAt } = value;
  return { id, experiment, name, expected, model, revision, graphRevision, savedAt, fields: Object.fromEntries(fields), receipt };
}

function workbenchFields(experiment) {
  const fields = new Map();
  for (const name of ['notes', 'instructions', 'instructions-b', 'minutes']) {
    const field = experiment.querySelector(`[data-part="${name}"]`);
    if (field) fields.set(name, field);
  }
  for (const field of experiment.querySelectorAll('[data-role-model]')) {
    fields.set('role:' + field.dataset.roleModel, field);
  }
  for (const field of experiment.querySelectorAll('[data-case-field]')) {
    fields.set('fact:' + field.dataset.caseField, field);
  }
  return fields;
}

export function readCaseSetup(experiment, model) {
  return {
    model,
    fields: Object.fromEntries([...workbenchFields(experiment)].map(([name, field]) => [name, field.value])),
  };
}

export function setupCases(experiments, model, openExperiment) {
  const byId = new Map(experiments.map(experiment => [experiment.id, experiment]));
  const get = id => document.getElementById(id);
  const library = get('saved-cases');
  const select = get('saved-case');
  const summary = get('saved-case-summary');
  const libraryStatus = get('case-library-status');
  const fileInput = get('case-file');
  const dialog = get('save-case');
  const caseName = get('case-name');
  const expected = get('case-expected');
  const saveStatus = get('save-case-status');
  const graphRevision = document.body.dataset.graphRevision || '';
  const recentChecks = new WeakMap();
  let records = [];
  let saving;

  function show(element, message, error = false) {
    element.textContent = message;
    element.toggleAttribute('data-error', error);
  }

  function readCases() {
    const found = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      try {
        const value = cleanCase(JSON.parse(localStorage.getItem(key)));
        if (key === prefix + value.id) found.push(value);
      } catch {
        // Keep unreadable local entries for recovery and skip them in the picker.
      }
    }
    return found.sort((a, b) => b.savedAt - a.savedAt);
  }

  function revisionFor(experiment) {
    const source = byId.get(experiment.dataset.labGraph);
    return [experiment.dataset.caseRevision, source?.dataset.caseRevision].filter(Boolean).join(':');
  }

  function selectedCase() {
    return records.find(record => record.id === select.value);
  }

  function describeSelection() {
    const selected = selectedCase();
    const experiment = byId.get(selected?.experiment);
    get('case-open').disabled = !selected || !experiment;
    get('case-delete').disabled = !selected;
    get('case-export').disabled = records.length === 0;
    summary.textContent = selected
      ? [experiment?.querySelector('h2').textContent || 'Experiment unavailable in this build', experiment?.dataset.lab !== 'cold' && selected.expected]
        .filter(Boolean).join(' · ')
      : 'Use Save case on an experiment to keep its setup.';
  }

  function refresh(preferred = select.value) {
    try {
      records = readCases();
    } catch {
      show(libraryStatus, 'This browser blocked local case storage.', true);
      return;
    }
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = records.length ? 'Choose a case' : 'No saved cases yet';
    const options = records.map(record => {
      const option = document.createElement('option');
      option.value = record.id;
      option.textContent = `${record.name} · ${new Date(record.savedAt).toLocaleString()}`;
      return option;
    });
    select.replaceChildren(placeholder, ...options);
    select.value = records.some(record => record.id === preferred) ? preferred : '';
    describeSelection();
  }

  for (const experiment of experiments) {
    experiment.addEventListener('fact-checked', event => recentChecks.set(experiment, event.detail));
    experiment.querySelector('[data-case-save]')?.addEventListener('click', () => {
      saving = experiment;
      caseName.value = experiment.querySelector('h2').textContent;
      expected.value = experiment.dataset.caseExpected || '';
      get('save-case-source').textContent = experiment.querySelector('h2').textContent;
      show(saveStatus, '');
      dialog.showModal();
      caseName.select();
    });
  }

  get('save-case-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!saving) return;
    if (!caseName.value.trim()) {
      show(saveStatus, 'Give the case a name.', true);
      caseName.focus();
      return;
    }
    let record;
    try {
      const setup = readCaseSetup(saving, model.value);
      const lastRun = recentChecks.get(saving);
      const receipt = lastRun && JSON.stringify(lastRun.setup) === JSON.stringify(setup) ? lastRun.checks : null;
      record = cleanCase({
        ...setup,
        receipt,
        id: crypto.randomUUID(),
        experiment: saving.id,
        name: caseName.value.trim(),
        expected: expected.value.trim(),
        revision: revisionFor(saving),
        graphRevision: saving.hasAttribute('data-graph') ||
          ['repair', 'evidence', 'stop', 'cost'].includes(saving.dataset.lab) ? graphRevision : '',
        savedAt: Date.now(),
      });
    } catch (error) {
      show(saveStatus, error.message, true);
      return;
    }
    try {
      localStorage.setItem(prefix + record.id, JSON.stringify(record));
    } catch {
      show(saveStatus, 'The browser could not save this case. Check storage access or export older cases to free space.', true);
      return;
    }
    saving.dataset.caseExpected = record.expected;
    saving = undefined;
    dialog.close();
    refresh(record.id);
    library.open = true;
    show(libraryStatus, `Saved ${record.name}.`);
  });

  get('save-case-cancel').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if (!dialog.open) saving = undefined; });
  select.addEventListener('change', describeSelection);

  get('case-open').addEventListener('click', () => {
    const record = selectedCase();
    const experiment = byId.get(record?.experiment);
    if (!experiment) return;
    if (experiment.querySelector('[data-part="run"]')?.disabled) {
      show(libraryStatus, 'Finish or cancel the running experiment before opening this case.', true);
      return;
    }
    const fields = workbenchFields(experiment);
    const edited = [...fields].some(([name, field]) =>
      field.value !== field.defaultValue && field.value !== record.fields[name]);
    if (edited && !window.confirm('Replace the current workbench input with this saved case?')) return;
    for (const [name, field] of fields) field.value = record.fields[name] ?? field.defaultValue;
    model.value = record.model;
    experiment.dataset.caseExpected = record.expected;
    const revisionChanged = record.revision !== revisionFor(experiment) ||
      (Boolean(record.graphRevision) && record.graphRevision !== graphRevision);
    const context = experiment.querySelector('[data-case-context]');
    context.textContent = [
      `Opened ${record.name}.`,
      record.expected && experiment.dataset.lab !== 'cold' && `Expected behavior · ${record.expected}`,
      record.receipt && `Saved run · ${record.receipt.filter(Boolean).length} of 3 checks passed.`,
      revisionChanged && 'This case was saved with a different experiment revision. A new run uses the current version.',
    ].filter(Boolean).join('\n');
    context.hidden = false;
    recentChecks.delete(experiment);
    experiment.dispatchEvent(new CustomEvent('case-restored', { detail: record }));
    show(libraryStatus, `Opened ${record.name}.`);
    const coldForm = experiment.querySelector('[data-part="cold-form"]');
    const firstField = coldForm && !coldForm.hidden
      ? experiment.querySelector('[data-part="cold-next"]') : fields.get('notes');
    openExperiment(experiment, firstField);
  });

  get('case-delete').addEventListener('click', () => {
    const record = selectedCase();
    if (!record || !window.confirm(`Delete the saved case “${record.name}” from this browser?`)) return;
    try {
      localStorage.removeItem(prefix + record.id);
      refresh('');
      show(libraryStatus, `Deleted ${record.name}.`);
    } catch {
      show(libraryStatus, 'The browser could not delete this case.', true);
    }
  });

  get('case-export').addEventListener('click', () => {
    const payload = JSON.stringify({ format, schemaVersion, cases: records }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'adiosbox-cases.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    show(libraryStatus, 'Case export ready.');
  });

  get('case-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const added = [];
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Choose an export smaller than 10 MB.');
      const imported = JSON.parse(await file.text());
      if (imported?.format !== format || imported.schemaVersion !== schemaVersion || !Array.isArray(imported.cases)) {
        throw new Error('Choose an Adiosbox case export.');
      }
      const cases = imported.cases.map(cleanCase);
      for (const record of cases) {
        const key = prefix + record.id;
        if (localStorage.getItem(key) !== null) continue;
        localStorage.setItem(key, JSON.stringify(record));
        added.push(key);
      }
      refresh();
      const count = added.length;
      show(libraryStatus, `Imported ${count} new ${count === 1 ? "case" : "cases"}. Existing copies were kept.`);
    } catch (error) {
      for (const key of added) localStorage.removeItem(key);
      show(libraryStatus, `Import stopped. ${error.message}`, true);
    }
  });

  window.addEventListener('storage', event => {
    if (event.key === null || event.key.startsWith(prefix)) refresh();
  });
  refresh();
}
