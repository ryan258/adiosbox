import { providerSlug, teachbackRoutes } from './completion-options.js';

const placementMarker = '{{fact}}';
const comparable = text => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const containsCue = (text, cue) => ` ${comparable(text)} `.includes(` ${comparable(cue)} `);
export const canaryGraderRevision = 2;

function canaryValue(answer, kind) {
  if (typeof answer !== 'string' && typeof answer !== 'number') return null;
  if (typeof answer === 'number' && (kind === 'cents' ? Math.abs(answer) >= 2 ** 45 : !Number.isSafeInteger(answer))) return null;
  const value = String(answer).trim();
  if (kind === 'grid') return /^(?:\d{6}\/){4}\d{6}$/.test(value) ? value : null;
  if (kind === 'action') return /^[a-z]+(?:_[a-z]+)*$/.test(value) ? value : null;
  if (kind === 'abstention' && /^unknown$/i.test(value)) return 'unknown';
  if (kind === 'cents') {
    const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
    if (!match) return null;
    const [, sign, whole, fraction = ''] = match;
    return BigInt(sign + whole + fraction.padEnd(2, '0'));
  }
  return /^-?\d+$/.test(value) ? BigInt(value) : null;
}

function readJSON(text) {
  try {
    return JSON.parse(text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1'));
  } catch {
    return null;
  }
}

function readScheduleInput(input) {
  const spec = readJSON(input);
  const jobs = spec?.jobs;
  if (!Number.isInteger(spec?.deadline) || spec.deadline < 1 || spec.deadline > 1440 ||
      !Array.isArray(jobs) || jobs.length < 1 || jobs.length > 10) {
    throw new Error('Enter a JSON schedule with a deadline from 1 to 1,440 minutes and 1–10 jobs.');
  }
  if (Object.hasOwn(spec, 'dependencyNotes')) {
    throw new Error('Remove dependencyNotes from the input. The comparison generates it for the second schedule.');
  }
  const ids = new Set(jobs.map(job => job?.id));
  if (ids.size !== jobs.length || jobs.some(job =>
    typeof job?.id !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(job.id) ||
    !Number.isInteger(job.minutes) || job.minutes < 1 || job.minutes > 1440 ||
    typeof job.resource !== 'string' || !job.resource.trim() || job.resource.length > 60 ||
    !Array.isArray(job.after) || job.after.some(id => id === job.id || !ids.has(id)))) {
    throw new Error('Give every job a unique ID, positive whole minutes, one resource, and an after list of other job IDs.');
  }
  const remaining = new Map(jobs.map(job => [job.id, job.after]));
  while (remaining.size) {
    const ready = [...remaining].filter(([, prerequisites]) => prerequisites.every(id => !remaining.has(id)));
    if (!ready.length) throw new Error(`A dependency cycle blocks these jobs: ${[...remaining.keys()].join(', ')}. Break the cycle before running.`);
    for (const [id] of ready) remaining.delete(id);
  }
  return spec;
}

export function validatePromptCase(technique, input, values, modelId, answerKind) {
  if (technique === 'boundary' && (!['draft', 'ask'].includes(values.expected) ||
      (values.expected === 'ask' && !comparable(values.cue || '')))) {
    return { field: 'expected', message: 'Use draft or ask as the expected decision. For ask, enter the deciding phrase.' };
  }
  if (technique === 'placement' && (input.split(placementMarker).length !== 2 ||
      input.split(placementMarker).some(section => !section.trim()))) {
    return { field: 'notes', message: 'Put {{fact}} on a line between two parts of the source packet.' };
  }
  if (technique === 'canary') {
    if (!(values.expected || '').split('|').every(answer => canaryValue(answer, answerKind) !== null)) {
      return { field: 'expected', message: 'Enter a valid answer key in the format shown in the prompt. Separate accepted alternatives with |.' };
    }
    if (!modelId || modelId.startsWith('openrouter/')) {
      return { field: 'model', message: 'Choose a specific model for all three canary attempts.' };
    }
  }
  if (technique === 'ballot' && !/^[A-D]$/.test(values.expected)) {
    return { field: 'expected', message: 'Use one uppercase option letter from A to D as the answer key.' };
  }
  if (technique === 'dependencies') {
    try {
      readScheduleInput(input);
    } catch (error) {
      return { field: 'notes', message: error.message };
    }
  }
  if (technique === 'schema') {
    const review = readJSON(input);
    if (![review?.originalInput, review?.draft].every(field => typeof field === 'string' && field.trim())) {
      return { field: 'notes', message: 'Enter a JSON object with nonempty originalInput and draft strings.' };
    }
    if (!teachbackRoutes.includes(values.expected)) {
      return { field: 'expected', message: 'Use proceed, revise, or stop as the expected review decision.' };
    }
    if (values.provider.length > 100 || !providerSlug.test(values.provider)) {
      return { field: 'provider', message: 'Enter the endpoint slug from OpenRouter’s Providers list, such as openai.' };
    }
    if (modelId.startsWith('openrouter/')) {
      return { field: 'model', message: 'Choose a specific reviewer model so both calls use the same model and provider.' };
    }
  }
  return null;
}

// Accepts "A", "a", "A.", "**A**", or "(A)". Anything with more words is not a vote.
export function readVote(text) {
  const vote = text.replace(/[\s*_`.()[\]]/g, '').toUpperCase();
  return /^[A-D]$/.test(vote) ? vote : null;
}

export function checkSchedule(text, { deadline, jobs }) {
  const answer = readJSON(text)?.jobs;
  if (!Array.isArray(answer)) return ['Return a JSON object with a jobs array.'];
  const byId = new Map(jobs.map(job => [job.id, job]));
  const starts = new Map();
  const issues = [];
  for (const entry of answer) {
    if (!byId.has(entry?.id)) issues.push('An unrecognized job was scheduled.');
    else if (starts.has(entry.id)) issues.push(`${entry.id} was scheduled more than once.`);
    else if (!Number.isInteger(entry.start) || entry.start < 0) issues.push(`${entry.id} needs a nonnegative whole start minute.`);
    else starts.set(entry.id, entry.start);
  }
  const scheduled = [];
  for (const job of jobs) {
    if (!starts.has(job.id)) {
      issues.push(`${job.id} has no valid start.`);
      continue;
    }
    const start = starts.get(job.id);
    const end = start + job.minutes;
    if (end > deadline) issues.push(`${job.id} ends at ${end}, after minute ${deadline}.`);
    for (const prior of job.after) {
      if (starts.has(prior) && start < starts.get(prior) + byId.get(prior).minutes) {
        issues.push(`${job.id} starts before ${prior} finishes.`);
      }
    }
    for (const other of scheduled) {
      if (other.resource === job.resource && other.start < end && start < other.end) {
        issues.push(`${job.id} and ${other.id} overlap on ${job.resource}.`);
      }
    }
    scheduled.push({ ...job, start, end });
  }
  return issues;
}

export function gradeCanary(text, expected, kind) {
  const answer = readJSON(text || '')?.answer;
  const actual = canaryValue(answer, kind);
  return actual === null ? null : expected.split('|').some(key => canaryValue(key, kind) === actual);
}

function gradeBoundary(result, values) {
  if (!result) return 'No complete reply to check.';
  const answer = readJSON(result.content);
  const question = typeof answer?.question === 'string' ? answer.question.trim() : '';
  const route = answer?.decision === values.expected;
  const questionOk = values.expected === 'draft' ? answer?.question === ''
    : /\?$/.test(question) && question.split('?').length === 2 && containsCue(question, values.cue);
  return `Decision: ${route ? 'Pass' : 'Miss'} (expected ${values.expected})\nQuestion: ${questionOk ? 'Pass' : 'Miss'}${values.expected === 'ask' ? ` (expected “${values.cue}”)` : ' (expected empty)'}`;
}

function gradePlacement(result, values) {
  if (!result) return 'No complete reply to check.';
  const answer = readJSON(result.content);
  const matches = (property, expected) => typeof answer?.[property] === 'string' && comparable(answer[property]) === comparable(expected);
  return `Decision: ${matches('decision', values.expected) ? 'Pass' : 'Miss'} (expected ${values.expected})\nSource: ${matches('source', values.source) ? 'Pass' : 'Miss'} (expected ${values.source})`;
}

function gradeReview(result, values) {
  if (!result) return 'Handoff unavailable. See the call outcome above.';
  const answer = readJSON(result.content);
  const usable = answer && teachbackRoutes.includes(answer.route) && typeof answer.reason === 'string' && Boolean(answer.reason.trim());
  if (!usable) return 'Handoff rejected by the graph’s route and reason checks.';
  let exact = false;
  try {
    exact = Object.keys(JSON.parse(result.content)).length === 2;
  } catch {
    // The graph accepts a fenced JSON object. A strict response should be bare JSON.
  }
  return [
    `Graph handoff: Usable`,
    `Exact two-field JSON: ${exact ? 'Pass' : 'Miss'}`,
    `Route: ${answer.route === values.expected ? 'Pass' : 'Miss'} (expected ${values.expected})`,
    values.cue ? `Evidence or repair cue: ${containsCue(answer.reason, values.cue) ? 'Found' : 'Review manually'} (expected “${values.cue}”)` : '',
  ].filter(Boolean).join('\n');
}

export async function runPromptExperiment(spec, { input, values, request, record, progress, signal, usageText }) {
  const results = [];
  async function run(label, userInput, prompt = spec.prompt, options = {}) {
    progress(`Running ${label.toLowerCase()}…`);
    if (userInput.length > 8000) {
      record(label, 'This handoff exceeded the input limit. Try a shorter case.');
      return null;
    }
    try {
      const response = await request({ input: userInput, prompt, step: label, includeUsage: true, ...options });
      signal.throwIfAborted();
      results.push(response);
      record(label, response.truncated ? `${response.content}\n\nOutput limit reached. This reply was excluded from scoring.` : response.content,
        response.reportedModel, response.requestedModel, response.truncated ? 'partial' : 'step', response.receipt);
      if (response.usage) record(`${label} · Usage`, usageText([response.usage]));
      return response.truncated ? null : response;
    } catch (error) {
      signal.throwIfAborted();
      record(label, error.message || 'The call did not return a reply.');
      return null;
    }
  }

  if (spec.technique === 'boundary') {
    for (const arm of spec.arms) {
      const result = await run(arm.title, input, `${spec.prompt}\n\nExamples\n${arm.examples}`);
      record(`${arm.title} · Check`, gradeBoundary(result, values));
    }
  }
  if (spec.technique === 'placement') {
    const [before, after] = input.split(placementMarker).map(part => part.trim());
    const replies = [];
    for (const [label, sections] of [['Fact in the middle', [before, values.fact, after]], ['Fact at the end', [before, after, values.fact]]]) {
      const result = await run(label, sections.join('\n\n'));
      record(`${label} · Check`, gradePlacement(result, values));
      replies.push(readJSON(result?.content || ''));
    }
    if (replies.every(answer => typeof answer?.decision === 'string' && typeof answer?.source === 'string')) {
      const [middle, end] = replies;
      const unchanged = comparable(middle.decision) === comparable(end.decision) && comparable(middle.source) === comparable(end.source);
      record('Placement comparison', unchanged ? 'Both replies use the same decision and source.' : 'The decision, source, or both changed.');
    }
  }
  if (spec.technique === 'dependencies') {
    const schedule = readScheduleInput(input);
    const direct = await run('One-pass schedule', input);
    const dependencies = await run('Dependency map', input, spec.dependencyPrompt);
    const staged = dependencies
      ? await run('Schedule with dependency map', JSON.stringify({ ...schedule, dependencyNotes: dependencies.content }))
      : null;
    for (const [label, answer] of [['One-pass schedule', direct], ['Schedule with dependency map', staged]]) {
      const issues = answer ? checkSchedule(answer.content, schedule) : ['No complete schedule to check.'];
      record(`${label} · Checks`, issues.length ? issues.join('\n') : 'Pass. Every job fits its deadline, prerequisites, and resource.');
    }
  }
  if (spec.technique === 'ballot') {
    const attempts = [];
    for (let number = 1; number <= 3; number += 1) attempts.push(await run(`Attempt ${number}`, input));
    const votes = attempts.map(answer => readVote(answer?.content || ''));
    const winner = votes.find(vote => vote && votes.filter(candidate => candidate === vote).length >= 2);
    const unanimous = winner && votes.every(vote => vote === winner);
    const voteLabel = winner ? `${winner} (${winner === values.expected ? 'correct' : unanimous ? 'unanimous and wrong' : 'wrong'})` : 'No majority';
    record('Single attempt versus majority', [
      `Answer key: ${values.expected}`,
      `First attempt: ${votes[0] || 'no valid vote'}${votes[0] ? votes[0] === values.expected ? ' (correct)' : ' (wrong)' : ''}`,
      `Votes: ${votes.map(vote => vote || 'invalid').join(', ')} · Result: ${voteLabel}`,
      `First attempt usage: ${usageText(attempts[0] ? [attempts[0].usage] : [])}`,
      `Ballot usage: ${usageText(results.map(result => result.usage))}`,
    ].join('\n'));
  }
  if (spec.technique === 'canary') {
    const checks = [];
    for (let number = 1; number <= 3; number += 1) {
      const result = await run(`Attempt ${number}`, input);
      const pass = result ? gradeCanary(result.content, values.expected, spec.answerKind) : null;
      checks.push(pass);
      record(`Attempt ${number} · Check`, !result ? 'No complete reply.' : pass === null ? 'Miss. Answer format is invalid.' : pass ? 'Pass' : 'Miss');
    }
    const passed = checks.filter(Boolean).length;
    const missing = results.some(reply => !reply.reportedModel);
    const mixed = new Set(results.map(reply => reply.reportedModel).filter(Boolean)).size > 1;
    const providers = new Set(results.map(reply => reply.reportedProvider).filter(Boolean));
    const reason = results.length !== 3 || results.some(reply => reply.truncated) ? 'Fewer than three complete replies.'
      : missing ? 'OpenRouter omitted a responding model.'
        : mixed ? 'OpenRouter reported different responding models.'
          : providers.size > 1 ? 'OpenRouter reported different providers.' : '';
    record('Canary verdict', [
      `${reason ? 'Inconclusive' : passed === 3 ? 'Tripped' : 'Not yet'}. ${passed} of 3 attempts matched the answer key.`,
      reason,
      `Answer key: ${values.expected}`,
    ].filter(Boolean).join('\n'));
  }
  if (spec.technique === 'schema') {
    const provider = values.provider;
    record('Review setup', `Both arms use the same supplied draft, reviewer prompt, and requested endpoint (${provider}).`);
    for (const [label, enforceTeachbackSchema] of [['Prompt-only JSON', false], ['Enforced JSON schema', true]]) {
      const result = await run(label, input, spec.prompt, { provider, enforceTeachbackSchema });
      record(`${label} · Check`, gradeReview(result, values));
    }
  }

  const reported = results.map(result => result.reportedModel);
  if (spec.technique !== 'canary' && new Set(reported.filter(Boolean)).size > 1) {
    record('Model comparison caveat', 'OpenRouter reported different responding models. Choose one specific model and rerun for a controlled comparison.');
  } else if (spec.technique !== 'canary' && reported.some(id => !id)) {
    record('Model comparison caveat', 'OpenRouter omitted the responding model on at least one reply.');
  }
  if (spec.technique !== 'canary' && new Set(results.map(reply => reply.reportedProvider).filter(Boolean)).size > 1) {
    record('Provider comparison caveat', 'OpenRouter reported different providers. Endpoint differences can affect this comparison.');
  }
  return { received: results.length, scorable: results.filter(result => !result.truncated).length };
}
