import { setupModelPicker } from './model-picker.js';
import { readCaseSetup, setupCases } from './cases.js';
import { checkFactPair, compareFactChecks, prepareFactInputs, sameFactScenario } from './fact-test.js';
import { appendRunRecord, runRecordText, setupHandoff } from './handoff.js';
import { setupLab } from './comparison-lab.js';

const local = document.body.hasAttribute('data-local-openrouter');
const modelIdPattern = /^[\w.-]+\/[\w.:@+-]+$/;
const endpoint = local ? '/api/complete' : 'https://openrouter.ai/api/v1/chat/completions';
const model = document.getElementById('model');
document.querySelectorAll('[data-model-picker]').forEach(setupModelPicker);

const key = document.getElementById('api-key');
const connection = document.getElementById('connection');
const connectionStatus = document.getElementById('connection-status');
const experiments = [...document.querySelectorAll('[data-experiment]')];
const catalogLinks = document.querySelectorAll('.experiment-list a');

function chooseModel(override, defaultId) {
  const value = override?.value.trim();
  return { field: value ? override : model, id: value || defaultId };
}

function revealField(experiment, field) {
  if (field === key) connection.open = true;
  const details = field.closest('details');
  if (details && experiment.contains(details)) details.open = true;
  field.focus();
}

function describeModel(requested, reported) {
  if (!reported) return `Requested ${requested} · OpenRouter did not report the responding model`;
  return requested === reported ? reported : `Requested ${requested} · Responded with ${reported}`;
}

function setStatus(element, message, error = false) {
  element.toggleAttribute('data-error', error);
  element.textContent = message;
}

async function copy(value, status, success, failure) {
  try {
    await navigator.clipboard.writeText(value);
    setStatus(status, success);
  } catch {
    setStatus(status, failure, true);
  }
}

function providerError(status) {
  switch (status) {
    case 401: return local
      ? 'OpenRouter rejected the key. Update .env and restart the local playground.'
      : 'OpenRouter rejected the key. Check it or create a new one.';
    case 402: return 'OpenRouter requires attention to your account balance or key limit.';
    case 403: return 'OpenRouter denied the request. Check your account and key settings.';
    case 429: return 'OpenRouter or the model is rate-limited. Try again in a moment.';
    case 504: return 'OpenRouter took too long. Try again.';
    case 502:
    case 503: return 'The selected model is temporarily unavailable. Try again in a moment.';
    default: return `OpenRouter returned an error (${status}). Try again or check your account.`;
  }
}

class CompletionError extends Error {}

async function complete({ input, prompt, modelId, apiKey, signal, includeUsage = false }) {
  signal.throwIfAborted();
  const headers = { 'Content-Type': 'application/json' };
  if (!local) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: input },
      ],
      max_tokens: 650,
      stream: false,
      ...(includeUsage && { usage: { include: true } }),
    }),
    signal,
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
  });
  signal.throwIfAborted();
  if (!response.ok) throw new CompletionError(providerError(response.status));

  const payload = await response.json();
  signal.throwIfAborted();
  const choice = payload?.choices?.[0];
  const content = choice?.message?.content;
  if (choice?.error || choice?.finish_reason === 'error' || typeof content !== 'string' || !content.trim()) {
    throw new CompletionError('OpenRouter returned no usable text. Try again.');
  }
  return {
    content: content.trim(),
    reportedModel: typeof payload.model === 'string' ? payload.model : '',
    truncated: choice.finish_reason === 'length',
    usage: includeUsage ? payload.usage : undefined,
  };
}

function setupExperiment(experiment) {
  const part = name => experiment.querySelector(`[data-part="${name}"]`);
  const form = part('experiment-form');
  const chain = experiment.hasAttribute('data-chain');
  const factTest = experiment.hasAttribute('data-fact-test');
  const factFields = new Map([...experiment.querySelectorAll('[data-case-field]')].map(field =>
    [field.dataset.caseField, field]));
  const notes = part('notes');
  const cancel = part('cancel');
  const runStatus = part('run-status');
  const comparisonStatus = part('comparison-status');
  const variants = ['', '-b'].filter(suffix => part('result' + suffix)).map(suffix => ({
    run: part('run' + suffix),
    instructions: part('instructions' + (factTest ? '' : suffix)),
    roleModel: experiment.querySelector(`[data-role-model="${suffix ? 'second' : 'first'}"]`),
    result: part('result' + suffix),
    title: part('result-title' + suffix),
    meta: part('result-meta' + suffix),
    copy: part('copy-result' + suffix),
    copyStatus: part('copy-status' + suffix),
    handoff: part('result' + suffix).closest('[data-handoff-output]').querySelector('[data-handoff]'),
    label: comparisonStatus && !factTest ? (suffix ? 'B' : 'A') : '',
    sample: part('result' + suffix).textContent,
    sampleTitle: part('result-title' + suffix).textContent,
    sampleMeta: part('result-meta' + suffix).textContent,
  }));
  let activeRequest;
  let savedCase;

  part('load-sample').addEventListener('click', () => {
    const edited = (notes.value.trim() && notes.value !== notes.defaultValue) ||
      [...factFields.values()].some(field => field.value !== field.defaultValue);
    if (edited) {
      if (!window.confirm('Replace your input with the sample?')) return;
    }
    notes.value = notes.defaultValue;
    for (const field of factFields.values()) field.value = field.defaultValue;
    notes.focus();
  });

  part('share').addEventListener('click', () => {
    const url = new URL(window.location.pathname, window.location.origin);
    url.hash = experiment.id;
    copy(url.href, part('share-status'), 'Example link copied.',
      `Copy this example link: ${url.href}`);
  });

  for (const variant of variants) {
    variant.copy.addEventListener('click', () => {
      copy(variant.result.textContent, variant.copyStatus, 'Result copied.', 'Select the result text and copy it.');
    });
  }

  experiment.addEventListener('case-restored', event => {
    savedCase = event.detail;
    for (const variant of variants) {
      variant.snapshot = undefined;
      variant.result.textContent = variant.sample;
      variant.title.textContent = variant.sampleTitle;
      variant.meta.textContent = variant.sampleMeta;
      variant.copy.disabled = false;
      variant.handoff.disabled = false;
      setStatus(variant.copyStatus, '');
    }
    if (comparisonStatus) setStatus(comparisonStatus, '');
    setStatus(runStatus, '');
  });

  function reportComparison() {
    if (!comparisonStatus) return;
    const [first, second] = variants.map(variant => variant.snapshot);
    if (!first || !second) return;
    if (first.truncated || second.truncated) {
      setStatus(comparisonStatus, 'At least one result hit the output limit. Shorten the input or prompt and run the pair again.', true);
    } else if (first.input !== second.input) {
      setStatus(comparisonStatus, 'The inputs differ. Run both arms on the same input to compare them directly.', true);
    } else if (first.requestedModel !== second.requestedModel) {
      setStatus(comparisonStatus, 'These runs requested different models. Match the models to isolate a prompt change, or match the prompts to compare models.');
    } else if (first.reportedModel && second.reportedModel && first.reportedModel !== second.reportedModel) {
      setStatus(comparisonStatus, 'OpenRouter reported different models for these runs. Pick one specific model and run A and B again.', true);
    } else if (!first.reportedModel || !second.reportedModel) {
      setStatus(comparisonStatus, 'Both runs used the same input and model selection. OpenRouter did not identify both responding models.');
    } else {
      setStatus(comparisonStatus, 'Both runs used the same input and reported model. Repeat the pair to check whether the difference holds.');
    }
  }

  cancel.addEventListener('click', () => activeRequest?.abort());

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (activeRequest) return;

    const selected = variants.find(item => item.run === event.submitter) ?? variants[0];
    const run = selected.run;
    const defaultModel = model.value.trim();
    const stages = (chain || factTest ? variants : [selected]).map(variant => ({
      variant,
      prompt: variant.instructions.value.trim(),
      selection: chooseModel(variant.roleModel, defaultModel),
    }));
    const input = notes.value.trim();
    const apiKey = key?.value.trim();
    const missing = [
      [notes, input, 'Enter some input or load the sample.'],
      ...stages.map(({ variant, prompt }) => [variant.instructions, prompt, 'Enter instructions for the model.']),
      ...stages.map(({ selection }) => [selection.field, modelIdPattern.test(selection.id), 'Choose a model or enter its full OpenRouter ID.']),
      ...[...factFields.values()].map(field => [field, field.value.trim(), 'Enter both facts and all three expectations.']),
      [key, local || apiKey, 'Enter your OpenRouter key to run the example.'],
    ].find(([, value]) => !value);
    if (missing) {
      const [field, , message] = missing;
      revealField(experiment, field);
      setStatus(runStatus, message, true);
      return;
    }

    let factInputs;
    let expectations;
    const setup = factTest && local ? readCaseSetup(experiment, model.value) : null;
    if (factTest) {
      const value = key => factFields.get(key).value.trim();
      try {
        factInputs = prepareFactInputs(input, value('baseline'), value('changed'));
        expectations = {
          baseline: value('baseline-decision'), changed: value('changed-decision'), invariant: value('invariant'),
        };
      } catch (error) {
        setStatus(runStatus, error.message, true);
        return;
      }
      setStatus(comparisonStatus, '');
    }

    if (connectionStatus) setStatus(connectionStatus, '');
    const request = new AbortController();
    activeRequest = request;
    let timeout;
    let step = 0;
    let handoff = input;
    const buttons = variants.map(variant => variant.run).filter(Boolean);
    const focusOnRun = document.activeElement === run;
    buttons.forEach(button => { button.disabled = true; });
    cancel.hidden = false;
    if (focusOnRun) cancel.focus();

    try {
      for (const { variant, prompt, selection: { id: modelId } } of stages) {
        step += 1;
        const { label, result, title, meta, copy: copyButton, copyStatus } = variant;
        const progress = factTest ? (step === 1 ? 'Running baseline…' : 'Running changed fact…')
          : chain ? `Running step ${step} of ${stages.length}…` : label ? `Running prompt ${label}…` : 'Waiting for OpenRouter…';
        setStatus(runStatus, progress);
        setStatus(copyStatus, '');
        timeout = window.setTimeout(() => request.abort('timeout'), 60_000);
        const { content, reportedModel, truncated } = await complete({
          input: factInputs?.[step - 1] ?? handoff, prompt, modelId, apiKey, signal: request.signal,
        });
        window.clearTimeout(timeout);

        result.textContent = content;
        if (!chain && !factTest) title.textContent = label ? `Result ${label}` : 'Your result';
        meta.textContent = describeModel(modelId, reportedModel);
        copyButton.disabled = false;
        variant.handoff.disabled = false;
        if (comparisonStatus) {
          variant.snapshot = { input, requestedModel: modelId, reportedModel, truncated, content };
          if (!factTest) reportComparison();
        }

        if ((chain || factTest) && step === 1) {
          const next = stages[1].variant;
          next.result.textContent = '';
          next.copy.disabled = true;
          next.handoff.disabled = true;
          setStatus(next.copyStatus, '');
          if (factTest) {
            next.meta.textContent = 'Waiting for the changed case…';
            continue;
          }
          if (truncated) {
            next.meta.textContent = 'Step 2 did not run.';
            setStatus(runStatus, 'Step 1 reached its output limit. Shorten its prompt or input and run the chain again.', true);
            return;
          }
          handoff = JSON.stringify({ originalInput: input, stepOne: content });
          if (handoff.length > 8000) {
            next.meta.textContent = 'Step 2 did not run.';
            setStatus(runStatus, 'The input and step 1 result are too long to pass to step 2. Shorten the input and try again.', true);
            return;
          }
          next.meta.textContent = 'Waiting for step 2…';
          continue;
        }

        if (factTest) {
          const [baseline, changed] = variants.map(item => item.snapshot);
          const checks = checkFactPair(expectations, baseline, changed);
          const routedDifferently = baseline.reportedModel && changed.reportedModel &&
            baseline.reportedModel !== changed.reportedModel;
          const caveat = routedDifferently
            ? '\nOpenRouter reported different models. Rerun with a specific model to isolate the fact change.'
            : !baseline.reportedModel || !changed.reportedModel
              ? '\nOpenRouter did not identify both responding models.' : '';
          let change = '';
          if (setup) {
            experiment.dispatchEvent(new CustomEvent('fact-checked', {
              detail: { setup, checks: checks.checks ?? null },
            }));
            if (savedCase?.receipt && checks.checks) {
              change = sameFactScenario(savedCase.fields, setup.fields)
                ? compareFactChecks(savedCase.receipt, checks.checks)
                : 'The scenario or expectations changed since the saved run.';
            }
          }
          setStatus(comparisonStatus, [checks.verdict, checks.text, change].filter(Boolean).join('\n') + caveat);
          setStatus(runStatus, 'Both answers are ready.');
          continue;
        }

        const message = truncated
          ? 'Partial result ready. The model reached its output limit.'
          : chain ? 'Both steps are ready.' : label ? `Result ${label} ready.` : 'Result ready.';
        setStatus(runStatus, message);
      }
    } catch (error) {
      const showFailure = (message, isError = true) => {
        if ((chain || factTest) && step === 2) {
          stages[1].variant.meta.textContent = factTest ? 'The changed case did not finish.' : 'Step 2 did not finish.';
          const remaining = factTest ? 'The baseline is still available.' : 'Step 1 is still available.';
          setStatus(runStatus, `${message} ${remaining}`, isError);
        } else {
          setStatus(runStatus, message, isError);
        }
      };
      if (request.signal.aborted) {
        if (request.signal.reason === 'key-cleared') {
          showFailure('Run canceled because the key was cleared.', false);
          return;
        }
        const timedOut = request.signal.reason === 'timeout';
        showFailure(timedOut ? 'OpenRouter took too long. Try again.' : 'Run canceled.', timedOut);
        return;
      }
      showFailure(error instanceof CompletionError ? error.message : 'Could not read a response from OpenRouter. Check your connection and try again.');
    } finally {
      window.clearTimeout(timeout);
      activeRequest = undefined;
      buttons.forEach(button => { button.disabled = false; });
      if (document.activeElement === cancel) run.focus();
      cancel.hidden = true;
    }
  });
  return () => activeRequest?.abort('key-cleared');
}

function setupGraph(experiment) {
  const part = name => experiment.querySelector(`[data-part="${name}"]`);
  const spec = JSON.parse(part('spec').value);
  const modelFields = new Map([...experiment.querySelectorAll('[data-role-model]')].map(field =>
    [field.dataset.roleModel, field]));
  const notes = part('notes');
  const minutes = part('minutes');
  const run = part('run');
  const cancel = part('cancel');
  const choices = part('choices');
  const orchestrated = spec.mode === 'orchestrated' || spec.mode === 'orchestrated-subgraphs';
  const editableBrief = spec.mode === 'adaptive' || orchestrated;
  const briefFields = ['role', 'deliverable', 'approach', 'checks', 'clarification', ...(orchestrated ? ['stages'] : [])];
  const agentFields = editableBrief
    ? Object.fromEntries(briefFields.map(name => [name, part('agent-' + name)]))
    : null;
  const runStatus = part('run-status');
  const trace = part('trace');
  const traceTitle = part('trace-title');
  const traceMeta = part('trace-meta');
  const copyStatus = part('copy-status');
  const sample = [...trace.children].map(entry => entry.cloneNode(true));
  const sampleTitle = traceTitle.textContent;
  const sampleMeta = traceMeta.textContent;
  let active;

  experiment.addEventListener('case-restored', () => {
    trace.replaceChildren(...sample.map(entry => entry.cloneNode(true)));
    traceTitle.textContent = sampleTitle;
    traceMeta.textContent = sampleMeta;
    setStatus(runStatus, '');
    setStatus(copyStatus, '');
  });

  function record(title, content, respondingModel, requestedModel) {
    const model = requestedModel ? describeModel(requestedModel, respondingModel) : '';
    appendRunRecord(trace, title, content, model);
  }

  function finishRun() {
    choices.hidden = true;
    run.disabled = false;
    if (cancel === document.activeElement || choices.contains(document.activeElement)) run.focus();
    cancel.hidden = true;
    active = undefined;
  }

  function stopRun(message) {
    if (!active) return;
    active.controller.abort(message);
    if (active.paused) {
      record('Stopped at checkpoint', message);
      setStatus(runStatus, message);
      finishRun();
    }
  }

  async function advance(invoke) {
    try {
      const { result, paused } = await invoke();
      active.controller.signal.throwIfAborted();
      if (paused) {
        record('Paused for your choice', choices.querySelector('legend').textContent.trim());
        active.paused = true;
        choices.hidden = false;
        if (editableBrief) {
          const proposal = result.roleProposal;
          active.roleQuestion = proposal.question;
          for (const name of ['role', 'deliverable', 'approach']) agentFields[name].value = proposal[name];
          agentFields.checks.value = proposal.checks.join('\n');
          if (orchestrated) agentFields.stages.value = proposal.stages.join('\n');
          agentFields.clarification.value = '';
          part('agent-question').textContent = proposal.question || 'Extra context';
          setStatus(runStatus, orchestrated ? 'Chain proposed. Review it and decide whether to continue.'
            : 'Assignment ready. Review it and decide whether to continue.');
          agentFields.role.focus();
        } else {
          setStatus(runStatus, 'Paused. Choose how to continue or stop here.');
          choices.querySelector('button').focus();
        }
        return;
      }
      if (result.stopped) {
        record('Graph stopped', result.stopped);
        setStatus(runStatus, 'The graph stopped without accepting a final result.');
      } else {
        setStatus(runStatus, orchestrated ? 'The final artifact and checks are ready.'
          : editableBrief ? 'Draft and review are ready.' : 'Graph finished.');
      }
    } catch (error) {
      const { signal } = active.controller;
      const canceled = signal.aborted;
      const message = canceled ? signal.reason : error.message || 'An error stopped the graph.';
      if (!canceled) active.controller.abort(message);
      record('Graph stopped', message);
      setStatus(runStatus, message, !canceled || message === 'OpenRouter took too long.');
    } finally {
      if (!active.paused) finishRun();
    }
  }

  part('load-sample').addEventListener('click', () => {
    if (notes.value.trim() && notes.value !== notes.defaultValue &&
        !window.confirm('Replace your input with the sample?')) return;
    notes.value = notes.defaultValue;
    if (minutes) minutes.value = minutes.defaultValue;
    notes.focus();
  });

  part('share').addEventListener('click', () => {
    const url = new URL(window.location.pathname, window.location.origin);
    url.hash = experiment.id;
    copy(url.href, part('share-status'), 'Example link copied.', `Copy this example link: ${url.href}`);
  });

  part('copy-trace').addEventListener('click', () => {
    copy(runRecordText(trace), copyStatus, 'Run record copied.', 'Select the run record text and copy it.');
  });

  part('experiment-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (active) return;
    const input = notes.value.trim();
    const defaultModel = model.value.trim();
    const modelRoles = spec.roleModels ? spec.roleModels.map(({ key }) => key) : Object.keys(spec.nodes);
    const roleModels = new Map(modelRoles.map(role => [role, chooseModel(modelFields.get(role), defaultModel)]));
    const invalidModel = [...roleModels.values()].find(selection => !modelIdPattern.test(selection.id));
    const apiKey = key?.value.trim();
    const budget = minutes?.valueAsNumber;
    const missing = [
      [notes, input, 'Enter some input or load the sample.'],
      [minutes, !minutes || (Number.isInteger(budget) && budget >= 1 && budget <= 720), 'Enter a whole number from 1 to 720.'],
      [invalidModel?.field, !invalidModel, 'Choose a model or enter its full OpenRouter ID.'],
      [key, local || apiKey, 'Enter your OpenRouter key to run the graph.'],
    ].find(([, valid]) => !valid);
    if (missing) {
      const [field, , message] = missing;
      revealField(experiment, field);
      setStatus(runStatus, message, true);
      return;
    }

    const controller = new AbortController();
    active = { controller, paused: false, apiKey };
    trace.replaceChildren();
    traceTitle.textContent = 'Run record';
    const modelCount = new Set([...roleModels.values()].map(selection => selection.id)).size;
    traceMeta.textContent = modelCount === 1 ? roleModels.values().next().value.id : 'Model selection shown for each completed node.';
    setStatus(copyStatus, '');
    run.disabled = true;
    cancel.hidden = false;
    if (run === document.activeElement) cancel.focus();
    setStatus(runStatus, 'Starting LangGraph…');

    await advance(async () => {
      const { createExperimentGraph } = await import(document.body.dataset.graphModule);
      controller.signal.throwIfAborted();
      active.graph = createExperimentGraph(spec, {
        signal: controller.signal,
        record,
        async complete({ input: nodeInput, prompt, node }) {
          const modelId = roleModels.get(node).id;
          const timer = window.setTimeout(() => controller.abort('OpenRouter took too long.'), 60_000);
          try {
            const result = await complete({ input: nodeInput, prompt, modelId, apiKey, signal: controller.signal });
            return { ...result, requestedModel: modelId };
          } finally {
            window.clearTimeout(timer);
          }
        },
      });
      return active.graph.start(input, budget);
    });
  });

  function approvedAssignment() {
    const assignment = Object.fromEntries(Object.entries(agentFields).map(([name, field]) =>
      [name, field.value.trim()]));
    assignment.checks = assignment.checks.split('\n').map(line => line.trim()).filter(Boolean);
    if (orchestrated) assignment.stages = assignment.stages.split('\n').map(line => line.trim()).filter(Boolean);
    const invalid = [
      ['role', assignment.role, 'Give the agent a role.'],
      ['deliverable', assignment.deliverable, 'Describe the deliverable.'],
      ['approach', assignment.approach, 'Describe how to do the work.'],
      ['checks', assignment.checks.length >= 1 && assignment.checks.length <= 4 &&
        assignment.checks.every(check => check.length <= 200), 'Enter one to four checks, with at most 200 characters per line.'],
      ['stages', !orchestrated || (assignment.stages.length >= 2 && assignment.stages.length <= 3 &&
        assignment.stages.every(stage => stage.length <= 240)), 'Enter two or three specialist jobs, one per line, up to 240 characters each.'],
      ['clarification', !active.roleQuestion || assignment.clarification,
        'Answer the clarifying question or say what is still unknown.'],
    ].find(([, valid]) => !valid);
    if (!invalid) return assignment;
    const [field, , message] = invalid;
    agentFields[field].focus();
    setStatus(runStatus, message, true);
    return null;
  }

  choices.addEventListener('click', async event => {
    const choice = event.target.closest('[data-choice]')?.dataset.choice;
    if (!active?.paused || !choice) return;
    if (choice === 'stop') {
      stopRun('You chose to stop here.');
      return;
    }
    if (!local && active.apiKey !== key.value.trim()) {
      stopRun('The key changed. Start a new graph to continue.');
      return;
    }
    const selection = editableBrief ? approvedAssignment() : choice;
    if (!selection) return;
    active.paused = false;
    cancel.focus();
    choices.hidden = true;
    setStatus(runStatus, orchestrated ? 'Running the approved chain…'
      : editableBrief ? 'Working from the approved assignment…' : 'Continuing from the checkpoint…');
    await advance(async () => ({ result: await active.graph.resume(selection) }));
  });

  cancel.addEventListener('click', () => stopRun('Run canceled.'));
  return () => stopRun('Run canceled because the key was cleared.');
}

const labUI = {
  complete, chooseModel, copy, describeModel, experiments, getApiKey: () => key?.value.trim(),
  local, model, modelIdPattern, revealField, setStatus,
};
const cancelRequests = experiments.map(experiment => {
  if (experiment.hasAttribute('data-lab')) return setupLab(experiment, labUI);
  return experiment.hasAttribute('data-graph') ? setupGraph(experiment) : setupExperiment(experiment);
});

document.getElementById('clear-key')?.addEventListener('click', () => {
  key.value = '';
  cancelRequests.forEach(cancel => cancel());
  key.focus();
  setStatus(connectionStatus, 'Key cleared.');
});

window.addEventListener('pageshow', event => {
  if (!key || !event.persisted) return;
  key.value = '';
  cancelRequests.forEach(cancel => cancel());
});

function selectExperiment(experiment) {
  for (const panel of experiments) panel.hidden = panel !== experiment;
  for (const link of catalogLinks) {
    if (link.hash === `#${experiment.id}`) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
}

function focusExperiment(experiment, focus = experiment) {
  selectExperiment(experiment);
  focus.focus({ preventScroll: true });
  experiment.scrollIntoView();
}

function openExperiment(experiment, notes) {
  const url = new URL(window.location.href);
  url.hash = experiment.id;
  window.history.pushState(null, '', url);
  focusExperiment(experiment, notes);
}

setupHandoff(experiments, openExperiment);
if (local) setupCases(experiments, model, openExperiment);

function linkedExperiment() {
  return experiments.find(panel => `#${panel.id}` === window.location.hash);
}

const initialExperiment = linkedExperiment();
selectExperiment(initialExperiment ?? experiments[0]);

window.addEventListener('hashchange', () => {
  const target = linkedExperiment();
  if (!target) {
    if (!window.location.hash) selectExperiment(experiments[0]);
    return;
  }
  focusExperiment(target);
});

if (initialExperiment) initialExperiment.scrollIntoView();
