import { prepareFactInputs } from './fact-test.js';
import { appendRunRecord, runRecordText } from './handoff.js';
import { runPromptExperiment, validatePromptCase } from './prompt-experiments.js';

const normalize = value => value.normalize('NFKC').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function containsPhrase(answer, phrase) {
  const normalizedPhrase = normalize(phrase);
  return Boolean(normalizedPhrase) && ` ${normalize(answer)} `.includes(` ${normalizedPhrase} `);
}

export function checkStopCases(present, absent, cue) {
  const words = cue.split(',').map(word => word.trim()).filter(word => normalize(word));
  return [
    { label: 'Brief with the fact routes to a draft', pass: present.decision?.route === 'proceed' && Boolean(present.final) },
    { label: 'Brief without the fact routes to a question', pass: absent.decision?.route === 'alternate' && /\?/.test(absent.final || '') },
    { label: 'Question mentions the deciding details', pass: absent.decision?.route === 'alternate' &&
      words.length > 0 && words.every(word => containsPhrase(absent.final || '', word)) },
  ];
}

export function formatReportedUsage(entries) {
  if (!entries.length) return 'No completed model responses.';
  const details = [`${entries.length} completed ${entries.length === 1 ? 'request' : 'requests'}`];
  for (const [property, name, format] of [
    ['total_tokens', 'tokens', total => total.toLocaleString()],
    ['cost', 'cost in USD', total => total.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 8 })],
  ]) {
    const reported = entries.map(entry => entry?.[property]).filter(value => Number.isFinite(value) && value >= 0);
    const total = reported.reduce((sum, value) => sum + value, 0);
    const coverage = reported.length < entries.length ? ` (${reported.length} of ${entries.length} responses reported)` : '';
    details.push(reported.length ? `${name} ${format(total)}${coverage}` : `${name} unreported`);
  }
  return details.join(' · ');
}

export function checkRecall(answers, expected) {
  return ['next', 'source', 'decision'].map(key => ({
    key, pass: containsPhrase(answers[key], expected[key]),
  }));
}

const makeChecks = checks => checks.map(({ label, pass }) => `${label} · ${pass ? 'Pass' : 'Review'}`).join('\n');

export function setupLab(experiment, ui) {
  const { complete, chooseModel, copy, describeModel, experiments, getApiKey, local, model, modelIdPattern, revealField, setStatus } = ui;
  const part = name => experiment.querySelector(`[data-part="${name}"]`);
  const spec = JSON.parse(part('spec').value);
  const notes = part('notes');
  const form = part('experiment-form');
  const run = part('run');
  const cancel = part('cancel');
  const trace = part('trace');
  const title = part('trace-title');
  const status = part('run-status');
  const copyStatus = part('copy-status');
  const sample = [...trace.children].map(child => child.cloneNode(true));
  const fields = new Map([...experiment.querySelectorAll('[data-case-field]')].map(field =>
    [field.dataset.caseField, field]));
  const modelFields = new Map([...experiment.querySelectorAll('[data-role-model]')].map(field =>
    [field.dataset.roleModel, field]));
  const repairForm = part('repair-form');
  const blindForm = part('blind-form');
  const coldForm = part('cold-form');
  const loadSample = part('load-prompt-sample');
  let active;
  let repair;
  let blind;
  let cold;

  function record(heading, content, reported, requested) {
    appendRunRecord(trace, heading, content, requested ? describeModel(requested, reported) : '');
  }

  function resetTrace(heading = 'Run record') {
    trace.replaceChildren();
    title.textContent = heading;
    setStatus(copyStatus, '');
  }

  function reset() {
    repair = blind = cold = undefined;
    if (repairForm) repairForm.hidden = true;
    if (blindForm) blindForm.hidden = true;
    if (coldForm) coldForm.hidden = true;
    form.hidden = false;
    const save = experiment.querySelector('[data-case-save]');
    if (save) save.hidden = false;
    resetTrace('Written sample');
    trace.replaceChildren(...sample.map(child => child.cloneNode(true)));
    setStatus(status, '');
  }

  // The provider is the visitor's choice and survives a sample load.
  const sampleState = () => JSON.stringify([notes.value, ...[...fields].filter(([key]) => key !== 'provider').map(([, field]) => field.value)]);
  let loadedState = sampleState();
  loadSample?.addEventListener('click', () => {
    if (active) return;
    if (sampleState() !== loadedState && !window.confirm('Replace your input with the sample case?')) return;
    const selected = spec.cases[Number(part('prompt-sample').value)];
    notes.value = selected.input;
    for (const [key, field] of fields) {
      if (key !== 'provider') field.value = selected.fields?.[key] || '';
    }
    loadedState = sampleState();
    reset();
    setStatus(status, `Loaded ${selected.title}.`);
  });

  function validated(field, message) {
    if (field) revealField(experiment, field);
    setStatus(status, message, true);
  }

  function cancelRun(message) {
    active?.abort(message);
  }

  async function withRun(button, task) {
    if (active) return;
    const controller = new AbortController();
    active = controller;
    run.disabled = true;
    const repairRun = part('repair-run');
    if (repairRun) repairRun.disabled = true;
    cancel.hidden = false;
    if (document.activeElement === button) cancel.focus();
    try {
      await task(controller);
      controller.signal.throwIfAborted();
    } catch (error) {
      const reason = controller.signal.aborted ? controller.signal.reason : error.message;
      if (!controller.signal.aborted) controller.abort(reason);
      setStatus(status, reason || 'The experiment stopped.', true);
    } finally {
      active = undefined;
      run.disabled = false;
      if (repairRun) repairRun.disabled = false;
      if (document.activeElement === cancel) button.focus();
      cancel.hidden = true;
    }
  }

  async function request(controller, options) {
    controller.signal.throwIfAborted();
    const timer = window.setTimeout(() => controller.abort('OpenRouter took too long.'), 60_000);
    try {
      return await complete({ ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
    }
  }

  function graphDefinition() {
    if (spec.graphSpec) return spec.graphSpec;
    const source = experiments.find(panel => panel.id === spec.graph);
    return JSON.parse(source.querySelector('[data-part="spec"]').value);
  }

  async function invokeGraph({ input, controller, apiKey, selectedModels, tag = '', retained, usage }) {
    const { createExperimentGraph } = await import(document.body.dataset.graphModule);
    controller.signal.throwIfAborted();
    const graph = createExperimentGraph(graphDefinition(), {
      signal: controller.signal,
      record(heading, content, reported, requested) {
        record(tag + heading, content, reported, requested);
      },
      async complete({ input, prompt, node }) {
        const requestedModel = selectedModels[node];
        const outcome = await request(controller, {
          input, prompt, modelId: requestedModel, apiKey, includeUsage: Boolean(usage), step: tag ? `${tag}${node}` : node,
        });
        if (usage) usage.push(outcome.usage);
        return { ...outcome, requestedModel };
      },
    });
    return (await graph.start(input, undefined, retained)).result;
  }

  async function originalRepair(input, selectedModels, controller, apiKey) {
    setStatus(status, 'Building the original fork and merge…');
    const result = await invokeGraph({ input, selectedModels, controller, apiKey, tag: 'Original · ' });
    if (!result.final || !result.leftOutput || !result.rightOutput) throw new Error('The original run did not produce both findings.');
    repair = { input, selectedModels, left: result.leftOutput, right: result.rightOutput };
    const chooser = part('repair-node');
    chooser.value = 'left';
    part('repair-text').value = repair.left;
    repairForm.hidden = false;
    setStatus(status, 'Original run ready. Edit a finding and rerun the merge.');
  }

  async function followClaim(input, selectedModels, controller, apiKey) {
    setStatus(status, 'Extracting claims and checking the rewrite…');
    const result = await invokeGraph({ input, selectedModels, controller, apiKey });
    for (const item of result.final) {
      record(item.status, `${item.claim}\n[${item.source}] “${item.quote}”`);
    }
    setStatus(status, 'Quote checks finished. Read each citation in context before using a claim.');
  }

  async function compareStop(input, values, selectedModels, controller, apiKey) {
    const [hasFact, lacksFact] = prepareFactInputs(input, values.present, values.absent);
    setStatus(status, 'Running the brief with the fact…');
    const first = await invokeGraph({ input: hasFact, controller, apiKey, selectedModels, tag: 'Fact present · ' });
    setStatus(status, 'Running the brief without the fact…');
    const second = await invokeGraph({ input: lacksFact, controller, apiKey, selectedModels, tag: 'Fact missing · ' });
    const checks = checkStopCases(first, second, values.cue);
    record('Decision checks', makeChecks(checks));
    setStatus(status, `${checks.filter(check => check.pass).length} of ${checks.length} checks passed.`);
  }

  async function compareReviewers(input, selectedModels, controller, apiKey) {
    const graph = graphDefinition();
    const sharedUsage = [];
    const draftStart = performance.now();
    setStatus(status, 'Generating one shared first draft…');
    const draft = await request(controller, {
      input: JSON.stringify({ originalInput: input }),
      prompt: graph.nodes.draft.prompt,
      modelId: selectedModels.writer,
      apiKey,
      includeUsage: true,
      step: 'Shared first draft',
    });
    record('Shared first draft', draft.content, draft.reportedModel, selectedModels.writer);
    if (draft.truncated) throw new Error('The shared first draft was incomplete. Neither reviewer ran.');
    sharedUsage.push(draft.usage);
    record('Shared draft usage', `${Math.round(performance.now() - draftStart)} ms · ${formatReportedUsage(sharedUsage)}`);
    for (const [role, label] of [['baseline', 'Baseline'], ['challenger', 'Challenger']]) {
      const usage = [];
      const started = performance.now();
      setStatus(status, `Running ${label.toLowerCase()} reviewer…`);
      const result = await invokeGraph({
        input, controller, apiKey, tag: `${label} · `, retained: { draft: draft.content }, usage,
        selectedModels: { draft: selectedModels.writer, review: selectedModels[role] },
      });
      const outcome = result.final ? 'Accepted by the reviewer' : 'Stopped without acceptance';
      record(`${label} outcome and usage`, `${outcome} · ${result.passes - 1} writer revisions\n${Math.round(performance.now() - started)} ms · ${formatReportedUsage(usage)}`);
    }
    setStatus(status, 'Both reviewer runs are ready. Compare what each reviewer caught and the reported usage.');
  }

  function showBlindAnswers() {
    resetTrace('Blind answers');
    for (const [position, id] of blind.order.entries()) {
      record(`Answer ${position === 0 ? 'A' : 'B'}`, blind.answers[id].content);
    }
    part('score-a').value = '';
    part('score-b').value = '';
  }

  function scores() {
    const first = part('score-a');
    const second = part('score-b');
    for (const field of [first, second]) {
      if (!Number.isInteger(field.valueAsNumber) || field.valueAsNumber < 0 || field.valueAsNumber > 5) {
        validated(field, 'Give both answers a whole-number score from 0 to 5.');
        return null;
      }
    }
    return Object.fromEntries([[blind.order[0], first.valueAsNumber], [blind.order[1], second.valueAsNumber]]);
  }

  async function startBlind(input, values, selectedModels, controller, apiKey) {
    const answers = [];
    for (const role of ['first', 'second']) {
      setStatus(status, `Collecting answer ${answers.length + 1} of 2…`);
      const result = await request(controller, { input, prompt: spec.prompt, modelId: selectedModels[role], apiKey, step: role });
      if (result.truncated) throw new Error('An answer reached its output limit. Try a shorter task.');
      answers.push({ ...result, requestedModel: selectedModels[role] });
    }
    const reverse = crypto.getRandomValues(new Uint8Array(1))[0] % 2;
    blind = { answers, order: reverse ? [1, 0] : [0, 1] };
    part('frozen-rubric').textContent = values.rubric;
    part('blind-swap').disabled = false;
    showBlindAnswers();
    blindForm.hidden = false;
    setStatus(status, 'Rate both answers before revealing the models.');
  }

  function startCold() {
    const answers = Object.fromEntries([...fields].map(([key, field]) => [key, field.value.trim()]));
    for (const [key, value] of Object.entries(answers)) {
      if (!normalize(value)) {
        validated(fields.get(key), 'Enter a checkable phrase for all three answers.');
        return false;
      }
    }
    if (!notes.value.trim()) {
      validated(notes, 'Enter the handoff a fresh reader will receive.');
      return false;
    }
    cold = { answers };
    form.hidden = true;
    coldForm.hidden = false;
    const save = experiment.querySelector('[data-case-save]');
    if (save) save.hidden = true;
    part('cold-handoff').textContent = notes.value;
    for (const key of Object.keys(answers)) part('cold-' + key).value = '';
    resetTrace('Recall checks');
    setStatus(status, 'Use only the handoff to recover the three details.');
    part('cold-next').focus();
    return true;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (active) return;
    if (spec.mode === 'cold') {
      startCold();
      return;
    }
    const input = notes.value.trim();
    if (!input) return validated(notes, 'Enter an input to run the experiment.');
    const values = Object.fromEntries([...fields].map(([key, field]) => [key, field.value.trim()]));
    for (const { key, optional } of spec.fields || []) {
      if (!values[key] && !optional) return validated(fields.get(key), 'Fill in this field before running.');
    }
    if (spec.mode === 'stop') {
      try {
        prepareFactInputs(input, values.present, values.absent);
        if (!values.cue.split(',').some(word => normalize(word))) throw new Error('Enter at least one checkable word.');
      } catch (error) {
        return validated(notes, error.message);
      }
    }
    const selectedModels = {};
    for (const [role, field] of modelFields) {
      const selection = chooseModel(field, model.value.trim());
      if (!modelIdPattern.test(selection.id)) return validated(selection.field, 'Choose an OpenRouter model or paste its full model ID.');
      selectedModels[role] = selection.id;
    }
    if (spec.mode === 'prompt') {
      const issue = validatePromptCase(spec.technique, input, values, selectedModels.comparison);
      if (issue) return validated(fields.get(issue.field) || (issue.field === 'model' ? modelFields.get('comparison') : notes), issue.message);
    }
    const twins = spec.mode === 'blind' ? ['first', 'second'] : spec.mode === 'cost' ? ['baseline', 'challenger'] : null;
    if (twins && selectedModels[twins[0]] === selectedModels[twins[1]]) {
      return validated(modelFields.get(twins[1]), 'Choose two different model IDs for this comparison.');
    }
    const apiKey = getApiKey();
    if (!local && !apiKey) return validated(document.getElementById('api-key'), 'Enter your OpenRouter key to run the experiment.');
    reset();
    resetTrace();
    await withRun(run, async controller => {
      if (spec.mode === 'repair') await originalRepair(input, selectedModels, controller, apiKey);
      if (spec.mode === 'evidence') await followClaim(input, selectedModels, controller, apiKey);
      if (spec.mode === 'stop') await compareStop(input, values, selectedModels, controller, apiKey);
      if (spec.mode === 'cost') await compareReviewers(input, selectedModels, controller, apiKey);
      if (spec.mode === 'blind') await startBlind(input, values, selectedModels, controller, apiKey);
      if (spec.mode === 'prompt') {
        const prompt = spec.technique === 'schema' ? graphDefinition().nodes.review.prompt : spec.prompt;
        const replies = await runPromptExperiment({ ...spec, prompt }, {
          input, values, record, signal: controller.signal, usageText: formatReportedUsage,
          progress: message => setStatus(status, message),
          request: async options => ({
            ...await request(controller, { ...options, modelId: selectedModels.comparison, apiKey }),
            requestedModel: selectedModels.comparison,
          }),
        });
        setStatus(status, replies
          ? 'Comparison finished. Review the answers and checks in the run record.'
          : 'No call returned a reply. Each error is in the run record.', !replies);
      }
    });
  });

  if (repairForm) {
    const role = part('repair-node');
    const edit = part('repair-text');
    role.addEventListener('change', () => { edit.value = repair[role.value]; });
    repairForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (active || !repair) return;
      const value = edit.value.trim();
      const branch = role.value;
      if (!value || value === repair[branch]) return validated(edit, 'Change one finding before rerunning the merge.');
      const apiKey = getApiKey();
      if (!local && !apiKey) return validated(document.getElementById('api-key'), 'Enter your OpenRouter key to rerun the merge.');
      const retained = { left: repair.left, right: repair.right, [branch]: value };
      record('Edited finding', value);
      await withRun(part('repair-run'), async controller => {
        setStatus(status, 'Rerunning the merge with your correction…');
        await invokeGraph({
          input: repair.input, selectedModels: repair.selectedModels,
          controller, apiKey, retained, tag: 'Revised · ',
        });
        setStatus(status, 'Revised merge ready. The original run remains above it.');
      });
    });
  }

  if (blindForm) {
    part('blind-swap').addEventListener('click', () => {
      if (!blind || blind.firstScores) return;
      const ratings = scores();
      if (!ratings) return;
      blind.firstScores = ratings;
      blind.order.reverse();
      showBlindAnswers();
      part('blind-swap').disabled = true;
      setStatus(status, 'Answers swapped. Rate them again before revealing the models.');
      part('score-a').focus();
    });
    blindForm.addEventListener('submit', event => {
      event.preventDefault();
      if (!blind) return;
      const ratings = scores();
      if (!ratings) return;
      resetTrace('Revealed answers');
      for (const [position, id] of blind.order.entries()) {
        const score = blind.firstScores ? `First score ${blind.firstScores[id]}/5 · Second score ${ratings[id]}/5` : `Score ${ratings[id]}/5`;
        const answer = blind.answers[id];
        record(`Answer ${position === 0 ? 'A' : 'B'}`, `${answer.content}\n\n${score}`, answer.reportedModel, answer.requestedModel);
      }
      const preference = blind.firstScores
        ? Math.sign(blind.firstScores[0] - blind.firstScores[1]) === Math.sign(ratings[0] - ratings[1])
          ? 'Your preference stayed the same after the swap.'
          : 'Your preference changed after the swap.'
        : 'The models are revealed.';
      setStatus(status, preference);
      blindForm.hidden = true;
      run.focus();
    });
  }

  if (coldForm) {
    coldForm.addEventListener('submit', event => {
      event.preventDefault();
      if (!cold) return;
      const answers = {};
      for (const key of Object.keys(cold.answers)) {
        const field = part('cold-' + key);
        answers[key] = field.value.trim();
        if (!answers[key]) return validated(field, 'Enter your answer before checking recall.');
      }
      const labels = { next: 'Next action', source: 'Source of truth', decision: 'Open decision' };
      const checks = checkRecall(answers, cold.answers);
      resetTrace('Recall checks');
      for (const { key, pass } of checks) {
        record(`${labels[key]} · ${pass ? 'Phrase found' : 'Review'}`,
          `Your answer: ${answers[key]}\nExpected phrase: ${cold.answers[key]}`);
      }
      setStatus(status, `${checks.filter(check => check.pass).length} of 3 phrases found. Check paraphrases against the expected meaning.`);
    });
    part('cold-back').addEventListener('click', () => { reset(); notes.focus(); });
    experiment.addEventListener('input-handoff', () => { if (cold) reset(); });
  }

  experiment.addEventListener('case-restored', () => {
    reset();
    if (coldForm) startCold();
  });

  part('share').addEventListener('click', () => {
    const url = new URL(window.location.pathname, window.location.origin);
    url.hash = experiment.id;
    copy(url.href, part('share-status'), 'Example link copied.', `Copy this example link: ${url.href}`);
  });
  part('copy-trace').addEventListener('click', () => {
    copy(runRecordText(trace), copyStatus, 'Run record copied.', 'Select the run record text and copy it.');
  });
  cancel?.addEventListener('click', () => cancelRun('Run canceled.'));
  return () => cancelRun('Run canceled because the key was cleared.');
}
