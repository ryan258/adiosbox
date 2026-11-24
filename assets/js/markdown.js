// Model replies are untrusted, so this builds DOM from text nodes only and never parses HTML.
// It covers what models actually send: paragraphs, headings, lists, quotes, code, tables, rules, emphasis, links.
// ponytail: hand-rolled subset; swap for a vetted parser plus sanitizer if replies need full CommonMark.

const fence = /^\s*(```|~~~)/;
const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const rule = /^\s*([-*_])(\s*\1){2,}\s*$/;
const bullet = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const quote = /^\s*>\s?(.*)$/;
const tableRow = /^\s*\|.*\|\s*$/;
const tableDivider = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const inlinePattern = new RegExp([
  '`([^`\\n]+)`',
  '\\*\\*(?=\\S)(.+?)(?<=\\S)\\*\\*',
  '__(?=\\S)(.+?)(?<=\\S)__',
  '(?<![\\w*])\\*(?=\\S)(.+?)(?<=\\S)\\*(?![\\w*])',
  '(?<![\\w_])_(?=\\S)(.+?)(?<=\\S)_(?![\\w_])',
  '\\[([^\\]\\n]+)\\]\\((https?://[^\\s)]+)\\)',
].join('|'), 'g');

export function parseInline(text) {
  const nodes = [];
  let last = 0;
  for (const match of text.matchAll(inlinePattern)) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const [, code, strong1, strong2, em1, em2, label, href] = match;
    if (code !== undefined) nodes.push({ type: 'code', text: code });
    else if (strong1 ?? strong2) nodes.push({ type: 'strong', children: parseInline(strong1 ?? strong2) });
    else if (em1 ?? em2) nodes.push({ type: 'em', children: parseInline(em1 ?? em2) });
    else nodes.push({ type: 'link', href, children: parseInline(label) });
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// Single newlines inside a paragraph stay visible line breaks, matching how the plain output read.
export function inlineLines(lines) {
  return lines.flatMap((line, index) => [...(index ? [{ type: 'br' }] : []), ...parseInline(line.trim())]);
}

const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => parseInline(cell.trim()));
const indentOf = line => line.match(/^\s*/)[0].replace(/\t/g, '    ').length;
const startsBlock = line => fence.test(line) || heading.test(line) || rule.test(line) || bullet.test(line) || quote.test(line);

export function parseMarkdown(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    if (fence.test(line)) {
      const marker = line.match(fence)[1];
      const body = [];
      for (i += 1; i < lines.length && !lines[i].trim().startsWith(marker); i += 1) body.push(lines[i]);
      blocks.push({ type: 'pre', text: body.join('\n') });
      i += 1;
      continue;
    }
    const headingMatch = line.match(heading);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, children: parseInline(headingMatch[2]) });
      i += 1;
      continue;
    }
    if (rule.test(line)) { blocks.push({ type: 'hr' }); i += 1; continue; }
    if (tableRow.test(line) && tableDivider.test(lines[i + 1] ?? '')) {
      const head = cells(line);
      const rows = [];
      for (i += 2; i < lines.length && tableRow.test(lines[i]); i += 1) rows.push(cells(lines[i]));
      blocks.push({ type: 'table', head, rows });
      continue;
    }
    if (quote.test(line)) {
      const body = [];
      for (; i < lines.length && quote.test(lines[i]); i += 1) body.push(lines[i].match(quote)[1]);
      blocks.push({ type: 'quote', children: parseMarkdown(body.join('\n')) });
      continue;
    }
    const item = line.match(bullet);
    if (item) {
      const base = indentOf(line);
      const ordered = /\d/.test(item[2]);
      const list = { type: 'list', ordered, start: ordered ? parseInt(item[2], 10) : 1, items: [] };
      let current;
      for (; i < lines.length; i += 1) {
        const next = lines[i];
        const match = next.match(bullet);
        if (match && indentOf(next) <= base && /\d/.test(match[2]) === ordered) {
          current = { first: [match[3]], rest: [] };
          list.items.push(current);
        } else if (!next.trim()) {
          // A blank line ends the list unless an indented continuation or a sibling item follows.
          const after = lines[i + 1] ?? '';
          if (!after.trim() || (indentOf(after) <= base && !bullet.test(after))) break;
          current.rest.push('');
        } else if (indentOf(next) > base) {
          const expanded = next.replace(/^\s*/, space => space.replace(/\t/g, '    '));
          current.rest.push(expanded.slice(Math.min(indentOf(next), base + 2)));
        } else if (!current.rest.length && !startsBlock(next)) {
          current.first.push(next);
        } else {
          break;
        }
      }
      list.items = list.items.map(({ first, rest }) => ({
        raw: first.map(part => part.trim()).join(' '), children: inlineLines(first), blocks: parseMarkdown(rest.join('\n')),
      }));
      blocks.push(list);
      continue;
    }
    const paragraph = [];
    for (; i < lines.length && lines[i].trim(); i += 1) {
      if (paragraph.length && (startsBlock(lines[i]) || (tableRow.test(lines[i]) && tableDivider.test(lines[i + 1] ?? '')))) break;
      paragraph.push(lines[i]);
    }
    blocks.push({ type: 'paragraph', lines: paragraph.map(part => part.trim()), children: inlineLines(paragraph) });
  }
  return blocks;
}

export function appendInline(parent, nodes) {
  for (const node of nodes) {
    if (typeof node === 'string') { parent.append(node); continue; }
    if (node.type === 'br') { parent.append(document.createElement('br')); continue; }
    if (node.type === 'code') {
      const code = document.createElement('code');
      code.textContent = node.text;
      parent.append(code);
      continue;
    }
    const element = document.createElement(node.type === 'link' ? 'a' : node.type);
    if (node.type === 'link') {
      element.href = node.href;
      element.rel = 'noopener noreferrer nofollow';
      element.target = '_blank';
    }
    appendInline(element, node.children);
    parent.append(element);
  }
}

export function appendBlocks(parent, blocks) {
  for (const block of blocks) {
    let element;
    if (block.type === 'paragraph') {
      element = document.createElement('p');
      appendInline(element, block.children);
    } else if (block.type === 'heading') {
      // Replies sit under an h3 or h4, so their own headings stay below that in the outline.
      element = document.createElement(block.level <= 2 ? 'h5' : 'h6');
      appendInline(element, block.children);
    } else if (block.type === 'hr') {
      element = document.createElement('hr');
    } else if (block.type === 'pre') {
      element = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = block.text;
      element.append(code);
    } else if (block.type === 'quote') {
      element = document.createElement('blockquote');
      appendBlocks(element, block.children);
    } else if (block.type === 'list') {
      element = document.createElement(block.ordered ? 'ol' : 'ul');
      if (block.ordered && block.start !== 1) element.start = block.start;
      for (const item of block.items) {
        const li = document.createElement('li');
        appendInline(li, item.children);
        appendBlocks(li, item.blocks);
        element.append(li);
      }
    } else if (block.type === 'table') {
      element = document.createElement('div');
      element.className = 'md-table';
      element.tabIndex = 0;
      element.setAttribute('role', 'region');
      element.setAttribute('aria-label', 'Table, scrolls sideways');
      const table = document.createElement('table');
      const row = (values, tag) => {
        const tr = document.createElement('tr');
        for (const value of values) {
          const cell = document.createElement(tag);
          if (tag === 'th') cell.scope = 'col';
          appendInline(cell, value);
          tr.append(cell);
        }
        return tr;
      };
      const thead = document.createElement('thead');
      thead.append(row(block.head, 'th'));
      const tbody = document.createElement('tbody');
      for (const values of block.rows) tbody.append(row(values, 'td'));
      table.append(thead, tbody);
      element.append(table);
    }
    parent.append(element);
  }
}

// The element shows formatted text; data-source keeps the reply exactly as received for copy, handoff, and export.
// build lets a layout arrange the parsed blocks; the default is plain formatted Markdown.
export function renderMarkdown(element, text, build = appendBlocks) {
  const source = String(text ?? '');
  element.replaceChildren();
  if (!source.trim()) {
    delete element.dataset.source;
    return;
  }
  element.dataset.source = source;
  build(element, parseMarkdown(source), source);
}

export const sourceText = element => element?.dataset.source ?? element?.textContent ?? '';
