// Run with: npm run check   (or: node --test tests/*.test.mjs)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { cleanCase } from '../static/cases.js';
import { traceBody } from '../static/call-trace.js';
import { completionBody } from '../static/completion-options.js';
import { checkSchedule, readVote, runPromptExperiment } from '../static/prompt-experiments.js';
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
  assert.equal(replies, 0);
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
  assert.equal(relay({ ...body, provider: { ...body.provider, allow_fallbacks: true } }), null);
  assert.equal(relay({ ...body, reasoning: { max_tokens: 99999 } }), null);
  const { provider, ...unpinned } = body;
  assert.equal(relay(unpinned), null, 'a response format needs a pinned provider');
});

test('call traces redact the key, including its JSON-escaped form', () => {
  assert.deepEqual(traceBody('{"a":"sk-1","b":"k\\"q"}', 'sk-1'), { a: '[redacted]', b: 'k"q' });
  assert.deepEqual(traceBody('{"b":"k\\"q"}', 'k"q'), { b: '[redacted]' });
});
