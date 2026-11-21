import { sourceText } from './markdown.js';
import { receipts } from './run-state.js';

const outputSelector = '[data-handoff-output]';
const htmlEntities = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

function readText(container, selector) {
  return container.querySelector(selector)?.textContent ?? '';
}

function readOutput(output) {
  const result = output.querySelector('[data-handoff-text]');
  return {
    title: readText(output, '[data-handoff-title]').trim(),
    note: readText(output, '[data-handoff-model]').trim(),
    text: sourceText(result),
    state: result?.dataset.resultState || 'sample',
    receipt: receipts.get(result),
  };
}

function readExport(experiment, controls) {
  const scope = controls.dataset.exportScope;
  const output = controls.closest(outputSelector);
  if (scope === 'output') {
    const entry = readOutput(output);
    return { title: entry.title, note: '', entries: [entry] };
  }

  const source = scope === 'record' ? output : experiment;
  const entries = [...source.querySelectorAll(outputSelector)].map(readOutput);
  const title = scope === 'record' ? readText(output, '[data-handoff-title]').trim() : 'Run results';
  const note = scope === 'record' ? readText(output, '[data-part="trace-meta"]').trim() : '';
  const comparison = readText(experiment, '[data-part="comparison-status"]');
  if (scope === 'pair' && comparison.trim()) {
    entries.push({ title: 'Comparison notes', text: comparison, state: 'record' });
  }
  return { title, note, entries };
}

const states = {
  sample: 'Written sample', previous: 'Previous run', live: 'Live result',
  partial: 'Partial live result', invalid: 'Live response that failed a check',
};

function receiptText(entry) {
  return entry.receipt ? JSON.stringify(entry.receipt, null, 2) : '';
}

function escapeHtml(value) {
  return value.replace(/[&<>]/g, character => htmlEntities[character]);
}

function renderHtml(title, note, entries, timestamp) {
  const sections = entries.map(entry => [
    '<section>',
    `<h2>${escapeHtml(entry.title)}</h2>`,
    states[entry.state] ? `<p>${states[entry.state]}</p>` : '',
    entry.note ? `<p>${escapeHtml(entry.note)}</p>` : '',
    `<div class="result">${escapeHtml(entry.text)}</div>`,
    entry.receipt ? `<details><summary>Request and outcome</summary><div class="result">${escapeHtml(receiptText(entry))}</div></details>` : '',
    '</section>',
  ].filter(Boolean).join('\n'));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 2rem auto; padding: 0 1rem; max-width: 54rem; color: #1e2321; background: #fbfcf8; font: 1rem/1.6 system-ui, sans-serif; overflow-wrap: anywhere; }
  .result { padding: 1rem; border: 1px solid #cdd5c8; border-radius: .2rem; background: #f2f5ee; white-space: pre-wrap; }
  h1, h2 { line-height: 1.25; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(title)}</h1>
<p>Exported from Adiosbox on ${timestamp} (UTC)</p>
${note ? `<p>${escapeHtml(note)}</p>` : ''}
${sections.join('\n')}
</main>
</body>
</html>
`;
}

function markdownInline(value) {
  return value.replace(/\s+/g, ' ').replace(/[\\`*_{}[\]()<>!&#]/g, '\\$&');
}

function renderMarkdown(title, note, entries, timestamp) {
  const blocks = [`# ${markdownInline(title)}`, `Exported from Adiosbox on ${timestamp} (UTC)`];
  if (note) blocks.push(markdownInline(note));
  for (const entry of entries) {
    blocks.push(`## ${markdownInline(entry.title)}`);
    if (states[entry.state]) blocks.push(states[entry.state]);
    if (entry.note) blocks.push(markdownInline(entry.note));
    const longestFence = (entry.text.match(/~+/g) ?? []).reduce((length, run) => Math.max(length, run.length), 2);
    const fence = '~'.repeat(longestFence + 1);
    blocks.push(`${fence}text\n${entry.text}\n${fence}`);
    const receipt = receiptText(entry);
    if (receipt) {
      const receiptFence = '~'.repeat(Math.max(2, ...(receipt.match(/~+/g) ?? []).map(run => run.length)) + 1);
      blocks.push(`### Request and outcome\n\n${receiptFence}json\n${receipt}\n${receiptFence}`);
    }
  }
  return blocks.join('\n\n') + '\n';
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-export-format]');
  if (!button) return;

  const controls = button.closest('[data-export-scope]');
  const status = controls.querySelector('[data-export-status]');
  const experiment = controls.closest('[data-experiment]');
  const { title, note, entries } = readExport(experiment, controls);
  const available = entries.filter(entry => entry.text.trim());
  status.textContent = '';
  if (!available.length) {
    status.textContent = 'There is no output to export yet.';
    return;
  }

  const heading = `${readText(experiment, 'h2').trim()} · ${title}`;
  const revision = experiment.dataset.caseRevision;
  const exportNote = [note, revision && `Experiment revision ${revision}`].filter(Boolean).join('\n');
  const timestamp = new Date().toISOString();
  const label = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'result';
  const format = button.dataset.exportFormat;
  const html = format === 'html';
  const content = (html ? renderHtml : renderMarkdown)(heading, exportNote, available, timestamp);
  const mimeType = html ? 'text/html' : 'text/markdown';
  const filename = `${experiment.id}-${label}-${timestamp.replace(/[:.]/g, '-')}.${format}`;
  const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  try {
    link.click();
    status.textContent = html ? 'HTML export ready.' : 'Markdown export ready.';
  } catch {
    status.textContent = 'Could not start the download. Try again.';
  } finally {
    link.remove();
    // Allow the browser to begin the download before releasing the object URL.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
});
