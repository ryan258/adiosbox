// Arranges a reply so each experiment reads the way it works: section cards, verdicts, tables, dialogues,
// tests, checklists, A/B differences, and graph flows. Each experiment picks its emphasis with `layout:` in its YAML.
// Everything is built from text nodes. The raw reply stays in data-source for copy, handoff, and export,
// and anything a layout doesn't recognize falls back to plain formatted Markdown.
import { appendBlocks, appendInline, parseInline, parseMarkdown, renderMarkdown } from './markdown.js';

const sectionLabel = /^\*\*([^*]+?):?\*\*:?$/;
// “**Defensible rewrite** — text” opens a section with its text on the same line.
const inlineLabel = /^\*\*([^*]{2,60}?)(:?)\*\*\s*([—–:]?)\s+(.+)$/;
const keyedLine = /^(.{1,60}?)\s+·\s+(.+)$/;
const colonLine = /^([^:]{1,40}):\s+(.+)$/;
const speakerLine = /^([A-Z][\w’'. ]{0,24}):\s+(.+)$/;
const verdictLine = /^(supported|contradicted|unclear|partly supported|unsupported)\s*[—–-]\s*(.+)$/i;
const tagSuffix = /\s*\[([A-Z0-9]{1,3})\]$/;

export const norm = text => String(text).toLowerCase().replace(tagSuffix, '').replace(/[“”"’']/g, '')
  .replace(/[:.]$/, '').replace(/\s+/g, ' ').trim();
const matches = (label, wanted) => wanted !== undefined && [].concat(wanted).some(item => norm(label).startsWith(norm(item)));

export function plainText(nodes) {
  return nodes.map(node => typeof node === 'string' ? node : node.text ?? (node.children ? plainText(node.children) : '')).join('');
}

// Split a reply into an untitled preamble and sections that start at a bold label line or a heading.
export function sections(blocks) {
  const pre = [];
  const found = [];
  for (const block of blocks) {
    let label;
    let rest = [];
    if (block.type === 'heading') label = plainText(block.children);
    else if (block.type === 'paragraph' && sectionLabel.test(block.lines[0])) {
      label = block.lines[0].match(sectionLabel)[1];
      rest = block.lines.slice(1);
    } else if (block.type === 'paragraph' && inlineLabel.test(block.lines[0])) {
      const [, name, colon, separator, text] = block.lines[0].match(inlineLabel);
      if ((colon || separator) && name.split(/\s+/).length <= 6 && !/[—–-]$/.test(name.trim())) {
        label = name;
        rest = [text, ...block.lines.slice(1)];
      }
    }
    if (label === undefined) {
      (found.at(-1)?.blocks ?? pre).push(block);
      continue;
    }
    found.push({ label: label.trim(), blocks: rest.length ? parseMarkdown(rest.join('\n')) : [] });
  }
  return { pre, sections: found };
}

function testLine(line) {
  return line.split(/\b(given|when|then)\b/i).filter(Boolean).flatMap(part =>
    /^(given|when|then)$/i.test(part) ? [{ type: 'strong', children: [part] }] : parseInline(part));
}

// Recognize line-level structure inside a paragraph or a flat list.
function enrichBlock(block, config) {
  const flatList = block.type === 'list' && block.items.every(item => !item.blocks.length);
  if (block.type !== 'paragraph' && !flatList) return block;
  const lines = block.type === 'paragraph' ? block.lines : block.items.map(item => item.raw);
  if (!lines.length) return block;
  const bare = line => line.replace(/\*\*/g, '').trim();
  if (lines.every(line => verdictLine.test(bare(line)))) {
    return { type: 'verdicts', items: lines.map(line => {
      const [, verdict, rest] = bare(line).match(verdictLine);
      return { verdict: verdict.toLowerCase(), children: parseInline(rest) };
    }) };
  }
  const cells = lines.map(line => line.split(/\s+\|\s+/));
  if (block.type === 'paragraph' && cells.every(row => row.length >= 2 && row.length === cells[0].length)) {
    const head = config.columns?.length === cells[0].length ? config.columns : null;
    return { type: 'rows', head, rows: cells.map(row => row.map(cell => parseInline(cell))) };
  }
  if (block.type === 'paragraph' && lines.length >= 3 && lines.every(line => speakerLine.test(line))) {
    const speakers = lines.map(line => line.match(speakerLine)[1]);
    if (new Set(speakers).size < speakers.length) {
      const order = [...new Set(speakers)];
      return { type: 'dialogue', lines: lines.map(line => {
        const [, speaker, rest] = line.match(speakerLine);
        return { speaker, side: order.indexOf(speaker) % 2, children: parseInline(rest) };
      }) };
    }
  }
  const keyed = pattern => lines.length >= 2 && lines.every(line => pattern.test(line)) &&
    (pattern === keyedLine || block.type === 'list') &&
    lines.every(line => line.match(pattern)[1].split(/\s+/).length <= 6);
  for (const pattern of [keyedLine, colonLine]) {
    if (keyed(pattern)) {
      return { type: 'keyed', ordered: block.ordered, items: lines.map(line => {
        const [, key, rest] = line.match(pattern);
        return { key: key.trim(), children: parseInline(rest) };
      }) };
    }
  }
  if (block.type === 'list' && lines.every(line => /^given\b/i.test(line) && /\bthen\b/i.test(line))) {
    return { type: 'tests', items: lines.map(testLine) };
  }
  return block;
}

// Consecutive verdict lines written as separate paragraphs read as one list.
export const enrich = (blocks, config = {}) => blocks.map(block => enrichBlock(block, config)).reduce((out, block) => {
  const last = out.at(-1);
  if (block.type === 'verdicts' && last?.type === 'verdicts') last.items.push(...block.items);
  else out.push(block);
  return out;
}, []);

export function toneFor(label, config = {}) {
  const set = Object.entries(config.tones ?? {}).find(([key]) => matches(label, key));
  if (set) return set[1];
  const text = norm(label);
  if (/start here|safe action|next step|^trial|^actions?$/.test(text)) return 'act';
  if (/block|risk|missing|fail|stop|conflict|invalidat|rollback/.test(text)) return 'warn';
  if (/question|unknown|unclear|crux/.test(text)) return 'ask';
  if (/trade-off|judgment|decide/.test(text)) return 'decide';
  if (/verify|support|essential|survive/.test(text)) return 'good';
  return '';
}

export function readFields(source) {
  const text = source.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  if (!text.startsWith('{')) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length ? value : null;
  } catch {
    return null;
  }
}

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function appendAll(parent, blocks, config) {
  for (const block of blocks) {
    if (block.type === 'verdicts') {
      const list = el('ul', 'lay-verdicts');
      for (const item of block.items) {
        const li = el('li');
        li.dataset.verdict = item.verdict.split(' ').at(-1);
        li.append(el('span', 'lay-verdict', item.verdict[0].toUpperCase() + item.verdict.slice(1)));
        const body = el('span');
        appendInline(body, item.children);
        li.append(body);
        list.append(li);
      }
      parent.append(list);
    } else if (block.type === 'keyed') {
      const list = el('dl', 'lay-keyed');
      block.items.forEach((item, index) => {
        const row = el('div');
        const tone = toneFor(item.key, config);
        if (tone) row.dataset.tone = tone;
        const term = el('dt');
        if (block.ordered) term.append(el('span', 'lay-number', String(index + 1)));
        appendInline(term, parseInline(item.key));
        const detail = el('dd');
        appendInline(detail, item.children);
        row.append(term, detail);
        list.append(row);
      });
      parent.append(list);
    } else if (block.type === 'rows') {
      const wrap = el('div', 'md-table lay-table');
      wrap.tabIndex = 0;
      wrap.setAttribute('role', 'region');
      wrap.setAttribute('aria-label', 'Table, scrolls sideways');
      const table = el('table');
      if (block.head) {
        const tr = el('tr');
        for (const name of block.head) {
          const th = el('th', '', name);
          th.scope = 'col';
          tr.append(th);
        }
        table.append(el('thead'));
        table.tHead.append(tr);
      }
      const body = el('tbody');
      for (const row of block.rows) {
        const tr = el('tr');
        for (const cell of row) {
          const td = el('td');
          appendInline(td, cell);
          tr.append(td);
        }
        body.append(tr);
      }
      table.append(body);
      wrap.append(table);
      parent.append(wrap);
    } else if (block.type === 'dialogue') {
      const talk = el('div', 'lay-dialogue');
      for (const line of block.lines) {
        const p = el('p');
        p.dataset.side = String(line.side);
        p.append(el('strong', 'lay-speaker', line.speaker));
        const body = el('span');
        appendInline(body, line.children);
        p.append(body);
        talk.append(p);
      }
      parent.append(talk);
    } else if (block.type === 'tests') {
      const list = el('ul', 'lay-tests');
      for (const item of block.items) {
        const li = el('li');
        appendInline(li, item);
        list.append(li);
      }
      parent.append(list);
    } else {
      appendBlocks(parent, [block]);
    }
  }
}

function sectionCard(section, role, config) {
  const box = el('section', `lay-${role}`);
  const tone = role === 'card' || role === 'pin' ? toneFor(section.label, config) : '';
  if (tone) box.dataset.tone = tone;
  const heading = el('h5');
  const tag = section.label.match(tagSuffix)?.[1];
  appendInline(heading, parseInline(section.label.replace(tagSuffix, '')));
  if (tag) {
    const chip = el('span', 'lay-tag');
    chip.append(el('span', 'visually-hidden', 'From part '), tag);
    heading.append(' ', chip);
  }
  const text = section.blocks.map(block => block.lines?.join(' ') ?? block.items?.map(item => item.raw).join(' ') ?? '').join(' ');
  const winner = config.winners && (text.match(/\b([A-Z])\s+wins\b/)?.[0] ?? (/\bno change\b|\bstays the same\b/i.test(text) ? 'No change' : ''));
  if (winner) heading.append(' ', el('span', 'lay-badge', winner));
  box.append(heading);

  const list = section.blocks.find(block => block.type === 'list');
  if (list && (matches(section.label, config.spread) || matches(section.label, config.checklist))) {
    const checklist = matches(section.label, config.checklist);
    for (const block of section.blocks) {
      if (block !== list) { appendAll(box, enrich([block], config), config); continue; }
      const group = el(checklist ? 'ul' : 'div', checklist ? 'lay-checklist' : 'lay-spread');
      for (const item of list.items) {
        const cell = el(checklist ? 'li' : 'div', checklist ? '' : 'lay-mini');
        if (checklist) {
          const label = el('label');
          const tick = el('input');
          tick.type = 'checkbox';
          const words = el('span');
          appendInline(words, item.children);
          label.append(tick, words);
          cell.append(label);
        } else {
          // A short opening phrase ("Visibility. Some attendees…") becomes the card's title.
          const named = item.raw.match(/^\*\*([^*]{2,40}?)[.:]?\*\*[.:—–-]?\s+(.+)$/) ?? item.raw.match(/^([^.?!:*]{2,40})[.:]\s+(.+)$/) ??
            item.raw.match(/^([^→]{2,90}?)\s+→\s+(.+)$/);
          if (named && named[1].split(/\s+/).length <= 12) {
            const title = el('strong', 'lay-mini-title');
            appendInline(title, parseInline(named[1]));
            cell.append(title);
            appendInline(cell, parseInline(named[2]));
          } else {
            appendInline(cell, item.children);
          }
        }
        appendBlocks(cell, item.blocks);
        group.append(cell);
      }
      box.append(group);
    }
  } else {
    appendAll(box, enrich(section.blocks, config), config);
  }
  return box;
}

function appendFields(parent, fields, config) {
  const list = el('dl', 'lay-fields');
  for (const [key, value] of Object.entries(fields)) {
    const row = el('div');
    if (key === config.headline) row.className = 'lay-headline';
    row.append(el('dt', '', config.fields?.[key] ?? key.replace(/[_-]/g, ' ').replace(/^./, letter => letter.toUpperCase())));
    row.append(el('dd', '', typeof value === 'string' ? value : JSON.stringify(value)));
    list.append(row);
  }
  parent.append(list);
}

function readConfig(element) {
  try {
    return JSON.parse(element.closest('[data-layout]')?.dataset.layout || '{}');
  } catch {
    return {};
  }
}

function build(element, blocks, source) {
  const config = readConfig(element);
  const fields = readFields(source);
  const { pre, sections: found } = sections(blocks);
  if (fields) {
    appendFields(element, fields, config);
  } else if (element.closest('.graph-trace') || found.length < 2) {
    // Run-record steps and unsectioned replies keep their flow; line patterns still apply.
    appendAll(element, enrich(blocks, config), config);
  } else {
    element.classList.add('lay');
    appendAll(element, enrich(pre, config), config);
    for (const section of found.filter(item => matches(item.label, config.pin))) element.append(sectionCard(section, 'pin', config));
    let row;
    for (const section of found) {
      if (matches(section.label, config.pin)) continue;
      const role = matches(section.label, config.lead) ? 'lead' : matches(section.label, config.takeaway) ? 'takeaway' : 'card';
      if (role === 'card' && (config.grid || matches(section.label, config.group))) {
        if (!row) element.append(row = el('div', 'lay-row'));
        row.append(sectionCard(section, role, config));
      } else {
        row = undefined;
        element.append(sectionCard(section, role, config));
      }
    }
  }
  const versus = element.closest('[data-versus]');
  if (versus) markDifferences([...versus.querySelectorAll('.comparison-results [data-handoff-text]')]);
}

export function renderResult(element, text) {
  element.classList.remove('lay');
  renderMarkdown(element, text, build);
}

// A/B and fact tests: mark each line, row, or field that the other result doesn't share.
const comparable = text => text.toLowerCase().replace(/\s+/g, ' ').replace(/[.。]$/, '').trim();
function leaves(element) {
  return [...element.querySelectorAll('li, tr, .lay-fields > div, .lay-keyed > div, p')]
    .filter(node => !node.querySelector('li, tr, p'));
}
export function markDifferences(results) {
  for (const result of results) {
    result.querySelectorAll('.is-different').forEach(node => node.classList.remove('is-different'));
    result.querySelectorAll('.diff-note').forEach(node => node.remove());
  }
  if (results.length !== 2 || !results.every(result => result.dataset.source)) return;
  const [first, second] = results.map(result => new Set(leaves(result).map(node => comparable(node.textContent))));
  results.forEach((result, index) => {
    const other = index ? first : second;
    for (const node of leaves(result)) {
      if (other.has(comparable(node.textContent))) continue;
      node.classList.add('is-different');
      (node.tagName === 'TR' ? node.lastElementChild : node).append(el('span', 'visually-hidden diff-note', ' (differs from the other result)'));
    }
  });
}

// Graph and lab run records: tag each step so the record reads as a flow, with branches side by side.
const stepKinds = [
  [/^(route selected|search decision|review decision|check the minutes|decision checks|placement comparison|single attempt versus majority)/i, 'decision'],
  [/^(paused for your choice|your choice|approved |stopped at checkpoint|edited finding|repair one finding|proposed |picked up)/i, 'human'],
  [/^(graph stopped)/i, 'stop'],
  [/(usage)$|^(model comparison caveat|review setup)/i, 'meta'],
  [/· (check|checks|phrase found|review)$/i, 'check'],
];
const pairedFlows = new Set(['fork', 'stop', 'blind']);

export function stepKind(title) {
  return stepKinds.find(([pattern]) => pattern.test(title))?.[1] ?? 'step';
}

export function layoutTrace(trace) {
  const flow = trace.dataset.flow;
  const entries = [...trace.children];
  let afterDecision = false;
  let paired = 0;
  const groups = { branch: [], child: [] };
  for (const entry of entries) {
    const title = entry.querySelector('[data-handoff-title]')?.textContent.trim() ?? '';
    let kind = stepKind(title);
    if (flow === 'tree' && kind === 'step') kind = afterDecision ? 'child' : 'branch';
    if (flow === 'tree' && /^search decision/i.test(title)) {
      afterDecision = true;
      // The pruning step's own reply sits just before its decision; it isn't a fourth branch.
      const prune = entry.previousElementSibling;
      if (prune?.dataset.kind === 'branch' && groups.branch.length > 3) {
        prune.dataset.kind = 'step';
        groups.branch.splice(groups.branch.indexOf(prune), 1);
      }
    }
    if (pairedFlows.has(flow) && kind === 'step' && paired < 2) { kind = 'branch'; paired += 1; }
    entry.dataset.kind = kind;
    entry.removeAttribute('data-wide');
    groups[kind]?.push(entry);
  }
  // The tree's last descendant is its finished answer.
  if (flow === 'tree' && groups.child.length > 1) groups.child.pop().dataset.kind = 'final';
  for (const group of Object.values(groups)) if (group.length === 1) group[0].dataset.wide = '';
}
