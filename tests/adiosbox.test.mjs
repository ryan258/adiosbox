// Run with: npm run check   (or: node --test tests/*.test.mjs)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { cleanCase } from '../static/cases.js';
import { redactTraceText, traceBody } from '../static/call-trace.js';
import { checkRecall, checkStopCases, formatReportedUsage } from '../static/comparison-lab.js';
import { checkFactPair, compareFactChecks, prepareFactInputs, sameFactScenario } from '../static/fact-test.js';
import { parseInline, parseMarkdown } from '../static/markdown.js';
import { enrich, readFields, sections, stepKind, toneFor } from '../static/layouts.js';
import {
  CompletionError, completionBody, freeRetryLimit, readCompletion, withFreeRetries,
} from '../static/completion-options.js';
import { checkSchedule, readVote, runPromptExperiment, validatePromptCase } from '../static/prompt-experiments.js';
import { createExperimentGraph, requestLimits } from '../assets/graph-runtime.js';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('saved cases accept camelCase role keys from tree graphs', () => {
  const record = cleanCase({
    id: '00000000-0000-4000-8000-000000000000', experiment: 'the-last-ferry-before-dawn', savedAt: 1,
    name: 'Ferry', expected: '', model: 'openrouter/free', revision: 'r', graphRevision: '',
    fields: { notes: 'x', 'role:branchA': '', 'role:childB': '', 'fact:expected': 'A' },
  });
  assert.equal(record.fields['role:branchA'], '');
  assert.throws(() => cleanCase({ ...record, fields: { 'role:bad key': '' } }));
});

test('ballot votes tolerate light formatting only', () => {
  assert.deepEqual(['A', 'b', 'C.', '**D**', '(A)', 'Answer: A', 'AB', ''].map(readVote),
    ['A', 'B', 'C', 'D', 'A', null, null, null]);
});

test('schedule checker catches a prerequisite violation and passes a valid plan', () => {
  const brief = { deadline: 40, jobs: [
    { id: 'unpack', minutes: 10, resource: 'crew', after: [] },
    { id: 'mount', minutes: 20, resource: 'crew', after: ['unpack'] },
    { id: 'wire', minutes: 15, resource: 'electrician', after: ['unpack'] },
    { id: 'test', minutes: 10, resource: 'electrician', after: ['mount', 'wire'] },
    { id: 'labels', minutes: 10, resource: 'crew', after: ['mount'] },
  ] };
  const plan = starts => JSON.stringify({ jobs: Object.entries(starts).map(([id, start]) => ({ id, start })) });
  assert.deepEqual(checkSchedule(plan({ unpack: 0, mount: 10, wire: 10, test: 30, labels: 30 }), brief), []);
  assert.deepEqual(checkSchedule(plan({ unpack: 0, mount: 10, wire: 10, test: 25, labels: 30 }), brief),
    ['test starts before mount finishes.']);
});

test('a prompt comparison reports zero replies when every call fails', async () => {
  const replies = await runPromptExperiment({ technique: 'ballot', prompt: 'p' }, {
    input: 'q', values: { expected: 'A' }, signal: new AbortController().signal,
    record() {}, progress() {}, usageText: () => '',
    request: async () => { throw new Error('down'); },
  });
  assert.deepEqual(replies, { received: 0, scorable: 0 });
});

test('truncated prompt comparison replies are counted but excluded from scoring', async () => {
  const replies = await runPromptExperiment({ technique: 'ballot', prompt: 'p' }, {
    input: 'q', values: { expected: 'A' }, signal: new AbortController().signal,
    record() {}, progress() {}, usageText: () => '',
    request: async () => ({ content: 'A', truncated: true }),
  });
  assert.deepEqual(replies, { received: 3, scorable: 0 });
});

test('tree graph uses its full budget on success and stops after a bad prune', async () => {
  const nodes = Object.fromEntries(['branchA', 'branchB', 'branchC', 'prune', 'childA', 'childB', 'finish']
    .map(key => [key, { title: key, prompt: key }]));
  for (const [verdict, calls, ended] of [['{"route":"branchB","reason":"best"}', 7, 'final'], ['not json', 4, 'stopped']]) {
    let made = 0;
    const graph = createExperimentGraph({ mode: 'tree', nodes }, {
      signal: new AbortController().signal, record() {},
      complete: async ({ prompt }) => {
        made += 1;
        return { content: prompt === 'prune' ? verdict : `${prompt} out`, reportedModel: 'm', truncated: false };
      },
    });
    const { result } = await graph.start('task');
    assert.equal(made, calls);
    assert.ok(result[ended]);
  }
});

test('each graph YAML displays the request limit the runtime enforces', () => {
  for (const file of readdirSync(new URL('data/experiments/', root)).filter(name => name.endsWith('.yaml'))) {
    const yaml = read(`data/experiments/${file}`);
    const mode = yaml.match(/^graph:\n(?:[ ]{2,}.*\n|\n)*?[ ]{2}mode: (\S+)/m)?.[1];
    if (!mode) continue;
    assert.equal(Number(yaml.match(/^maxRequests: (\d+)/m)?.[1]), requestLimits[mode], file);
  }
});

test('the built catalog has valid prompt samples and model budgets', {
  skip: !existsSync(new URL('public/index.html', root)),
}, () => {
  const parsed = execFileSync('python3', ['-I', '-B', '-c', `
from html.parser import HTMLParser
import json, sys
class Catalog(HTMLParser):
    def __init__(self):
        super().__init__()
        self.specs = []
        self.current = None
        self.spec = None
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "data-experiment" in attrs:
            self.current = attrs
        if tag == "textarea" and attrs.get("data-part") == "spec":
            self.spec = []
    def handle_data(self, data):
        if self.spec is not None:
            self.spec.append(data)
    def handle_endtag(self, tag):
        if tag == "textarea" and self.spec is not None:
            self.specs.append([self.current, json.loads("".join(self.spec))])
            self.spec = None
catalog = Catalog()
catalog.feed(sys.stdin.read())
print(json.dumps(catalog.specs))
`], { input: read('public/index.html') });
  const labs = JSON.parse(parsed).filter(([attrs]) => attrs['data-lab'] === 'prompt');
  assert.ok(labs.length, 'the rendered catalog contains prompt experiments');
  for (const [attrs, spec] of labs) {
    const expectedCalls = ['dependencies', 'ballot'].includes(spec.technique) ? 3 : 2;
    assert.equal(Number(attrs['data-base-calls']), expectedCalls, attrs.id);
    const defaults = Object.fromEntries((spec.fields ?? []).map(field => [field.key, field.sample ?? '']));
    const model = spec.roles[0].defaultModel || 'openrouter/free';
    for (const sample of spec.cases) {
      const issue = validatePromptCase(spec.technique, sample.input, { ...defaults, ...sample.fields }, model);
      assert.equal(issue, null, `${attrs.id} / ${sample.title}`);
    }
  }
});

test('the local launcher accepts the browser body and rejects a widened provider', () => {
  const body = completionBody({
    modelId: 'nvidia/nemotron-3.5-super-vl:free', prompt: 's', input: 'u', includeUsage: true,
    provider: 'openai', enforceTeachbackSchema: true,
  });
  const relay = payload => JSON.parse(execFileSync('python3', ['-I', '-B', '-c', `
import json, sys
sys.path.insert(0, ${JSON.stringify(new URL('scripts', root).pathname)})
import playground
try: print(json.dumps(playground.completion_request(json.load(sys.stdin))))
except ValueError: print('null')
`], { input: JSON.stringify(payload) }));
  assert.deepEqual(relay(body), body);
  assert.equal(relay(body).max_tokens, 4096, 'a capped reasoning model gets the larger ceiling');
  const router = completionBody({ modelId: 'openrouter/free', prompt: 's', input: 'u' });
  assert.deepEqual([router.max_tokens, router.reasoning], [4096, { max_tokens: 1024 }], 'the free router caps reasoning');
  assert.deepEqual(relay(router), router);
  const pinned = completionBody({ modelId: 'x/y:free', prompt: 's', input: 'u', provider: 'openai' });
  assert.deepEqual([pinned.max_tokens, pinned.reasoning], [2048, undefined], 'a provider-pinned free model skips the cap');
  assert.equal(relay({ ...pinned, reasoning: { max_tokens: 1024 } }), null);
  const paid = completionBody({ modelId: 'openai/gpt-oss-20b', prompt: 's', input: 'u' });
  assert.deepEqual([paid.max_tokens, paid.reasoning], [2048, undefined]);
  assert.deepEqual(relay(paid), paid);
  assert.equal(relay({ ...paid, reasoning: { max_tokens: 1024 } }), null, 'a paid model may not send a reasoning cap');
  assert.equal(relay({ ...body, provider: { ...body.provider, allow_fallbacks: true } }), null);
  assert.equal(relay({ ...body, reasoning: { max_tokens: 99999 } }), null);
  const { provider, ...unpinned } = body;
  assert.equal(relay(unpinned), null, 'a response format needs a pinned provider');
});

test('call traces redact the key, including its JSON-escaped form', () => {
  assert.deepEqual(traceBody('{"a":"sk-1","b":"k\\"q"}', 'sk-1'), { a: '[redacted]', b: 'k"q' });
  assert.deepEqual(traceBody('{"b":"k\\"q"}', 'k"q'), { b: '[redacted]' });
});

test('provider diagnostics use redacted text', () => {
  const key = 'fixture"key';
  const raw = JSON.stringify({ error: { message: `Rejected ${key}` } });
  assert.throws(() => readCompletion({ ok: false, status: 401 }, redactTraceText(raw, key), { modelId: 'test/model' }),
    error => !error.message.includes(key) && error.message.includes('[redacted]'));
});

test('free models retry transient failures; paid models and permanent errors do not', async () => {
  const run = () => new AbortController().signal;
  const flaky = failures => { let calls = 0; return { get calls() { return calls; }, attempt: async () => {
    calls += 1;
    if (calls <= failures) throw Object.assign(new Error('empty reply.'), { retryable: true });
    return 'ok';
  } }; };
  const free = flaky(2);
  assert.equal(await withFreeRetries('openrouter/free', run(), free.attempt, [0, 0]), 'ok');
  assert.equal(free.calls, 3);
  const exhausted = flaky(3);
  await assert.rejects(withFreeRetries('x/y:free', run(), exhausted.attempt, [0, 0]), /Tried 3 times/);
  const paid = flaky(1);
  await assert.rejects(withFreeRetries('openai/gpt-oss-20b', run(), paid.attempt, [0, 0]));
  assert.equal(paid.calls, 1);
  let permanent = 0;
  await assert.rejects(withFreeRetries('openrouter/free', run(), async () => {
    permanent += 1;
    throw Object.assign(new Error('bad key'), { retryable: false });
  }, [0, 0]));
  assert.equal(permanent, 1);
});

test('free retries need an explicit retryable mark and share one budget per run', async () => {
  let calls = 0;
  await assert.rejects(withFreeRetries('openrouter/free', new AbortController().signal, async () => {
    calls += 1;
    throw new SyntaxError('Unexpected token');
  }, [0, 0]));
  assert.equal(calls, 1, 'an unclassified error is terminal');

  const run = new AbortController().signal;
  calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls % 2) throw Object.assign(new Error('rate-limited.'), { retryable: true });
    return 'ok';
  };
  for (let step = 0; step < 2; step += 1) assert.equal(await withFreeRetries('openrouter/free', run, flaky, [0, 0]), 'ok');
  await assert.rejects(withFreeRetries('openrouter/free', run, flaky, [0, 0]), /already used its automatic retries/);
  assert.equal(calls, 5, 'three steps on one run send at most 3 + freeRetryLimit attempts');
  assert.equal(freeRetryLimit, 2);
});

test('a reply is classified by how the completion ended, not just its HTTP status', () => {
  const read = (body, response = { ok: true, status: 200 }) => {
    try {
      return readCompletion(response, typeof body === 'string' ? body : JSON.stringify(body), { modelId: 'm' });
    } catch (error) {
      assert.ok(error instanceof CompletionError, error.message);
      return error;
    }
  };
  const reply = (content, finish_reason, message = {}) => ({ choices: [{ message: { content, ...message }, finish_reason }] });
  const retryable = result => result instanceof CompletionError ? result.retryable : 'returned';
  assert.equal(read(reply(' answer ', 'stop')).content, 'answer');
  assert.equal(read(reply('cut', 'length')).truncated, true, 'partial text at the limit is returned and flagged');
  for (const [name, body, expected] of [
    ['filtered with text', reply('partial', 'content_filter'), false],
    ['refusal with text', reply('text', 'stop', { refusal: 'no' }), false],
    ['empty at the limit', reply('', 'length'), false],
    ['empty reply', reply('', 'stop'), true],
    ['embedded 401', { error: { code: 401, message: 'bad key' } }, false],
    ['embedded 502', { error: { code: 502 } }, true],
    ['embedded error without a code', reply('', 'error'), false],
    ['malformed JSON', '{oops', false],
  ]) assert.equal(retryable(read(body)), expected, name);
  assert.match(read(reply('partial', 'content_filter')).message, /filtered/);
  assert.equal(retryable(read('', { ok: false, status: 429 })), true);
  assert.equal(retryable(read('', { ok: false, status: 401 })), false);
  assert.match(read('', { ok: false, status: 401 }).message, /Check it or create/, 'the hosted key message');
});

test('replies render as structured markdown and stay text-only', () => {
  const blocks = parseMarkdown([
    '## Verdict', '', 'March: **120 ÷ 2,000 = 6%**.', 'April: *same* rate.', '',
    '- one', '  - nested', '- two `x_y`', '', '1. first', '2. second', '',
    '| Month | Rate |', '|---|---:|', '| March | 6% |', '',
    '> quoted', '', '```', '<script>alert(1)</script>', '```', '---', 'snake_case_name and 2 * 3 * 4',
  ].join('\n'));
  assert.deepEqual(blocks.map(block => block.type),
    ['heading', 'paragraph', 'list', 'list', 'table', 'quote', 'pre', 'hr', 'paragraph']);
  assert.deepEqual(blocks[1].children, ['March: ', { type: 'strong', children: ['120 ÷ 2,000 = 6%'] }, '.',
    { type: 'br' }, 'April: ', { type: 'em', children: ['same'] }, ' rate.']);
  assert.equal(blocks[2].items.length, 2);
  assert.equal(blocks[2].items[0].blocks[0].type, 'list', 'an indented bullet nests');
  assert.deepEqual(blocks[2].items[1].children, ['two ', { type: 'code', text: 'x_y' }]);
  assert.equal(blocks[3].ordered, true);
  assert.deepEqual(blocks[4].rows, [[['March'], ['6%']]]);
  assert.equal(blocks[6].text, '<script>alert(1)</script>', 'code stays literal text');
  assert.deepEqual(blocks[8].children, ['snake_case_name and 2 * 3 * 4'], 'no false emphasis');
  assert.deepEqual(parseInline('[docs](javascript:alert(1)) [ok](https://example.com)'),
    ['[docs](javascript:alert(1)) ', { type: 'link', href: 'https://example.com', children: ['ok'] }]);
  assert.deepEqual(parseMarkdown('Plain line one\nline two').map(block => block.type), ['paragraph']);
  const tabbed = parseMarkdown('- one\n\t- nested');
  assert.equal(tabbed[0].items[0].blocks[0].type, 'list', 'a tab-indented bullet nests without slicing the marker');
  assert.deepEqual(tabbed[0].items[0].blocks[0].items[0].children, ['nested']);
});

test('every experiment sits on a known shelf, and Start here picks real experiments', () => {
  const shelves = read('data/shelves.yaml');
  const keys = [...shelves.matchAll(/^  - key: (\S+)/gm)].map(match => match[1]);
  const slugs = [];
  for (const file of readdirSync(new URL('data/experiments/', root)).filter(name => name.endsWith('.yaml'))) {
    const yaml = read(`data/experiments/${file}`);
    slugs.push(yaml.match(/^slug: (\S+)/m)[1]);
    assert.ok(keys.includes(yaml.match(/^shelf: (\S+)/m)?.[1]), `${file} needs a shelf from data/shelves.yaml`);
  }
  for (const slug of shelves.match(/^startHere: \[(.*)\]/m)[1].split(', ')) assert.ok(slugs.includes(slug), slug);
});

test('layouts find sections and the line patterns each experiment uses', () => {
  const kinds = text => enrich(parseMarkdown(text), { columns: ['Action', 'Owner', 'Due'] }).map(block => block.type);
  const { pre, sections: found } = sections(parseMarkdown('Intro line.\n\n**Summary**\nOne line.\n\n**Actions**\n- a\n- b\n\n## Start here\nDo it.'));
  assert.equal(pre.length, 1);
  assert.deepEqual(found.map(section => section.label), ['Summary', 'Actions', 'Start here']);
  assert.deepEqual(found[0].blocks.map(block => block.type), ['paragraph'], 'text under a label stays in its section');
  assert.deepEqual(kinds('Supported — A says so.\nUnclear — B is silent.'), ['verdicts']);
  assert.deepEqual(kinds('**Supported —** A says so. **(C)**\n\n**Unclear —** B is silent.'), ['verdicts'], 'bold verdicts in separate paragraphs merge');
  assert.deepEqual(sections(parseMarkdown('**Supported —** A. **(C)**\n\n**Rewrite**\nB.')).sections.map(section => section.label), ['Rewrite'], 'a line with other bold text is not a label');
  assert.deepEqual(sections(parseMarkdown('Supported — A.\n\n**Defensible rewrite** — B holds.\n\n**Missing evidence:** C.')).sections.map(section => [section.label, section.blocks[0].lines[0]]),
    [['Defensible rewrite', 'B holds.'], ['Missing evidence', 'C.']], 'an inline bold label opens a section');
  const [rows] = enrich(parseMarkdown('Send it | Priya | Friday\nPost it | Lee | Monday'), { columns: ['Action', 'Owner', 'Due'] });
  assert.equal(rows.type, 'rows');
  assert.deepEqual(rows.head, ['Action', 'Owner', 'Due']);
  assert.deepEqual(kinds('Ana · Monday works.\nSam · Friday works.'), ['keyed']);
  assert.deepEqual(kinds('- Trial: two weeks.\n- Rollback: export first.'), ['keyed']);
  assert.deepEqual(kinds('Presenter: Hi.\nBoard: Why?\nPresenter: Because.'), ['dialogue']);
  assert.deepEqual(kinds('- Given a booking, when they cancel, then refund.\n- Given none, when asked, then decline.'), ['tests']);
  assert.deepEqual(kinds('Criterion: Short walk. A wins.'), ['paragraph'], 'one colon line is just prose');
  assert.deepEqual(kinds('Plain answer with no structure.'), ['paragraph'], 'unrecognized text falls back to Markdown');
  assert.equal(toneFor('First blockage'), 'warn');
  assert.equal(toneFor('First blockage', { tones: { 'First blockage': 'ask' } }), 'ask');
  assert.equal(toneFor('Start here'), 'act');
  assert.deepEqual(readFields('```json\n{"decision": "full credit"}\n```'), { decision: 'full credit' });
  assert.equal(readFields('{not json'), null);
  assert.equal(stepKind('Search decision'), 'decision');
  assert.equal(stepKind('Paused for your choice'), 'human');
  assert.equal(stepKind('Boundary examples · Check'), 'check');
  assert.equal(stepKind('Three boarding policies'), 'step');
});

test('every worked example with a section layout has the sections it names', () => {
  for (const file of readdirSync(new URL('data/experiments/', root)).filter(name => name.endsWith('.yaml'))) {
    const yaml = read(`data/experiments/${file}`);
    const layout = yaml.match(/^layout:\n((?:  .*\n)+)/m)?.[1] ?? '';
    const sample = yaml.match(/^sampleResult: \|-\n((?:  .*\n|\n)+)/m)?.[1].replace(/^  /gm, '') ?? '';
    const labels = sections(parseMarkdown(sample)).sections.map(section => section.label.toLowerCase());
    for (const [, role, label] of layout.matchAll(/^  (lead|pin|spread|checklist|takeaway): (.+)$/gm)) {
      assert.ok(labels.some(found => found.startsWith(label.toLowerCase())), `${file}: ${role} “${label}” is not in the sample`);
    }
  }
});

test('a failed graph step can be picked up without rerunning finished steps', async () => {
  const nodes = Object.fromEntries(['branchA', 'branchB', 'branchC', 'prune', 'childA', 'childB', 'finish']
    .map(key => [key, { title: key, prompt: key }]));
  const seen = [];
  let failNext = 'branchB';
  const graph = createExperimentGraph({ mode: 'tree', nodes }, {
    signal: new AbortController().signal, record() {},
    complete: async ({ prompt, node }) => {
      seen.push(prompt);
      if (prompt === failNext) { failNext = failNext === 'branchB' ? 'childB' : null; throw new Error(`${node} failed`); }
      return { content: prompt === 'prune' ? '{"route":"branchB","reason":"best"}' : `${prompt} out`, reportedModel: 'm', truncated: false };
    },
  });
  await assert.rejects(graph.start('task'), /branchB failed/);
  assert.deepEqual(await graph.pickupPoint(), { title: 'branchB', role: 'branchB' });
  await assert.rejects(graph.pickUp(new AbortController().signal), /childB failed/, 'the pick-up runs the failed branch, then fails later');
  assert.equal((await graph.pickupPoint()).role, 'childB');
  const { result, paused } = await graph.pickUp(new AbortController().signal);
  assert.equal(paused, false);
  assert.ok(result.final);
  const runs = name => seen.filter(prompt => prompt === name).length;
  assert.deepEqual(['branchA', 'branchC', 'prune', 'childA', 'finish'].map(runs), [1, 1, 1, 1, 1], 'finished steps never rerun');
  assert.deepEqual([runs('branchB'), runs('childB')], [2, 2]);
  assert.equal(await graph.pickupPoint(), null, 'a finished run has nothing to pick up');
});

test('an approved checkpoint can retry the failed follow-up without repeating preparation', async () => {
  const nodes = Object.fromEntries(['prepare', 'finish'].map(key => [key, { title: key, prompt: key }]));
  const seen = [];
  const graph = createExperimentGraph({
    mode: 'checkpoint', nodes, options: [{ id: 'draft', label: 'Draft', instruction: 'Draft it' }],
  }, {
    signal: new AbortController().signal, record() {},
    complete: async ({ prompt, input }) => {
      seen.push(prompt);
      if (prompt === 'prepare') return { content: 'Assessment' };
      assert.equal(JSON.parse(input).choice, 'Draft it');
      if (seen.length === 2) throw new Error('follow-up failed');
      return { content: 'Finished' };
    },
  });
  assert.equal((await graph.start('task')).paused, true);
  assert.equal(graph.remainingCalls(), 1);
  assert.equal(await graph.pickupPoint(), null);
  await assert.rejects(graph.resume('draft'), /follow-up failed/);
  assert.equal(graph.remainingCalls(), 1);
  assert.equal((await graph.pickupPoint()).role, 'finish');
  assert.equal((await graph.pickUp(new AbortController().signal)).result.final, 'Finished');
  assert.deepEqual(seen, ['prepare', 'finish', 'finish']);
});

test('nested specialists retain a validated role when the work call fails', async () => {
  const nodes = Object.fromEntries(['plan', 'shape', 'work', 'assemble'].map(key => [key, { title: key, prompt: key }]));
  const proposal = {
    role: 'Lead', deliverable: 'Brief', approach: 'Split work', checks: ['Grounded'],
    stages: ['Extract facts', 'Write summary'], question: '',
  };
  const brief = JSON.stringify({ role: 'Analyst', approach: 'Check facts', checks: ['Cite'] });
  const calls = [];
  let fail = true;
  const graph = createExperimentGraph({ mode: 'orchestrated-subgraphs', nodes }, {
    signal: new AbortController().signal, record() {},
    complete: async ({ prompt, node }) => {
      calls.push(`${node}:${prompt}`);
      if (prompt === 'work' && fail) {
        fail = false;
        throw new Error('work failed');
      }
      return { content: { plan: JSON.stringify(proposal), shape: brief, work: 'Handoff', assemble: 'Finished' }[prompt] };
    },
  });
  assert.equal((await graph.start('task')).paused, true);
  await assert.rejects(graph.resume(proposal), /work failed/);
  assert.equal((await graph.pickupPoint()).role, 'specialist-1');
  assert.equal((await graph.pickUp(new AbortController().signal)).result.final, 'Finished');
  assert.deepEqual(calls, [
    'plan:plan', 'specialist-1:shape', 'specialist-1:work', 'specialist-1:work',
    'specialist-2:shape', 'specialist-2:work', 'assemble:assemble',
  ]);
});

test('claim validation retries the call that produced malformed data', async () => {
  const nodes = Object.fromEntries(['extract', 'rewrite'].map(key => [key, { title: key, prompt: key }]));
  const claims = JSON.stringify({ claims: [{ claim: 'Example', source: 'A', quote: 'Source text' }] });
  const seen = [];
  const graph = createExperimentGraph({ mode: 'evidence', nodes }, {
    signal: new AbortController().signal, record() {},
    complete: async ({ prompt }) => {
      seen.push(prompt);
      return { content: seen.length === 1 ? 'invalid' : claims };
    },
  });
  await assert.rejects(graph.start('[A] Source text'), /JSON claim list/);
  assert.equal((await graph.pickupPoint()).role, 'extract');
  const { result } = await graph.pickUp(new AbortController().signal);
  assert.equal(result.final[0].status, 'Exact quote carried through');
  assert.deepEqual(seen, ['extract', 'extract', 'rewrite']);
});

test('fork and review loops pick up at the failed step too', async () => {
  for (const [mode, names, failing, reply] of [
    ['fork', ['left', 'right', 'merge'], 'right', () => 'out'],
    ['revise', ['draft', 'review'], 'review', prompt => prompt === 'review' ? '{"route":"proceed","reason":"ok"}' : 'draft'],
  ]) {
    const nodes = Object.fromEntries(names.map(key => [key, { title: key, prompt: key }]));
    const seen = [];
    let fail = true;
    const graph = createExperimentGraph({ mode, nodes }, {
      signal: new AbortController().signal, record() {},
      complete: async ({ prompt }) => {
        seen.push(prompt);
        if (prompt === failing && fail) { fail = false; throw new Error('down'); }
        return { content: reply(prompt), reportedModel: 'm', truncated: false };
      },
    });
    await assert.rejects(graph.start('task'));
    assert.equal((await graph.pickupPoint()).role, failing, mode);
    const { result } = await graph.pickUp(new AbortController().signal);
    assert.ok(result.final, mode);
    assert.equal(seen.filter(prompt => prompt === names[0]).length, 1, `${mode}: the finished first step is kept`);
  }
});

test('orchestrated specialist validation failure reports the failed role for pick-up', async () => {
  const nodes = Object.fromEntries(['plan', 'specialist', 'assemble'].map(key => [key, { title: key, prompt: key }]));
  const proposal = {
    role: 'Lead', deliverable: 'Brief', approach: 'Split work', checks: ['Grounded'],
    stages: ['Extract facts', 'Write summary'], question: '',
  };
  const validSpecialist = JSON.stringify({ role: 'Analyst', approach: 'Check facts', checks: ['Cite'], handoff: 'Ready' });
  let badOnce = true;
  const graph = createExperimentGraph({ mode: 'orchestrated', nodes }, {
    signal: new AbortController().signal, record() {},
    complete: async ({ prompt }) => {
      if (prompt === 'plan') return { content: JSON.stringify(proposal), reportedModel: 'm', truncated: false };
      if (prompt === 'specialist' && badOnce) { badOnce = false; return { content: 'not json', reportedModel: 'm', truncated: false }; }
      return { content: prompt === 'specialist' ? validSpecialist : 'Final artifact', reportedModel: 'm', truncated: false };
    },
  });
  const { paused } = await graph.start('task');
  assert.equal(paused, true);
  await assert.rejects(graph.resume({ ...proposal, clarification: '' }), /usable handoff/);
  assert.deepEqual(await graph.pickupPoint(), { title: 'Specialist 1 · Model response', role: 'specialist-1' });
  const { result } = await graph.pickUp(new AbortController().signal);
  assert.equal(result.final, 'Final artifact');
});

test('fact-test helpers prepare pairs, grade JSON replies, and compare against saved checks', () => {
  assert.deepEqual(prepareFactInputs('Cutoff: {{fact}}.', '24 hours', '23 hours'),
    ['Cutoff: 24 hours.', 'Cutoff: 23 hours.']);
  assert.throws(() => prepareFactInputs('No marker', 'a', 'b'));
  assert.throws(() => prepareFactInputs('{{fact}}', 'same', 'same'));

  const expectations = { baseline: 'full credit', changed: 'no credit', invariant: 'Mina | R184' };
  const reply = (decision, invariant = 'Mina | R184') => ({
    content: JSON.stringify({ decision, invariant }), truncated: false,
  });
  const pass = checkFactPair(expectations, reply('Full Credit'), reply('no credit'));
  assert.deepEqual(pass.checks, [true, true, true]);
  assert.equal(pass.verdict, '3 of 3 checks passed');

  const partial = checkFactPair(expectations, reply('Full Credit'), reply('full credit', 'wrong'));
  assert.deepEqual(partial.checks, [true, false, false]);
  assert.equal(compareFactChecks(partial.checks, pass.checks), 'Improved · Changed decision, Invariant in both answers');
  assert.equal(compareFactChecks(pass.checks, partial.checks), 'Regressed · Changed decision, Invariant in both answers');
  assert.equal(compareFactChecks(pass.checks, pass.checks), 'All three check outcomes match the saved run.');

  const truncated = checkFactPair(expectations, { ...reply('full credit'), truncated: true }, reply('no credit'));
  assert.equal(truncated.verdict, 'Incomplete');
  const fields = { notes: 'a', 'fact:baseline': '1', 'fact:changed': '2', 'fact:baseline-decision': 'x', 'fact:changed-decision': 'y', 'fact:invariant': 'z' };
  assert.equal(sameFactScenario(fields, { ...fields }), true);
  assert.equal(sameFactScenario(fields, { ...fields, 'fact:changed': '3' }), false);
});

test('comparison-lab pure helpers grade stop cases, cold recall, and partial usage coverage', () => {
  const stopChecks = checkStopCases(
    { decision: { route: 'proceed' }, final: 'Draft ready.' },
    { decision: { route: 'alternate' }, final: 'What is the target deadline and owner?' },
    'deadline, owner',
  );
  assert.deepEqual(stopChecks.map(check => check.pass), [true, true, true]);

  const recall = checkRecall(
    { next: 'Send the draft to Priya', source: 'In the Q3 Notion doc', decision: 'Whether to keep the Friday slot' },
    { next: 'Priya', source: 'Notion', decision: 'Monday' },
  );
  assert.deepEqual(recall.map(item => item.pass), [true, true, false]);

  assert.equal(formatReportedUsage([]), 'No completed model responses.');
  assert.equal(
    formatReportedUsage([{ total_tokens: 100, cost: 0.00025 }, { total_tokens: 50 }]),
    '2 completed requests · tokens 150 · cost in USD $0.00025 (1 of 2 responses reported)',
  );
});
