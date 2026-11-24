import limits from '../limits.json' with { type: 'json' };
import './run-export.js';
import { setupModelPicker } from './model-picker.js';
import { mayReplaceSetup, readCaseSetup, setupCases } from './cases.js';
import { checkFactPair, compareFactChecks, prepareFactInputs, sameFactScenario } from './fact-test.js';
import { appendRunRecord, runRecordText, setupHandoff } from './handoff.js';
import { setupLab } from './comparison-lab.js';
import { redactTraceText, setupCallTrace, traceBody } from './call-trace.js';
import { sourceText } from './markdown.js';
import { formatWrittenResults, renderResult } from './layouts.js';
import {
  beginRun, keyClearedReason, linkRunOutput, receipts, recordAttempt, setRunActivity, timeoutReason, withCallDeadline,
} from './run-state.js';
import {
  CompletionError, completionBody, describeModel, freeRetryLimit, isFreeModel, readCompletion, withFreeRetries,
} from './completion-options.js';

const local = document.body.hasAttribute('data-local-openrouter');
const modelIdPattern = /^(?=.{1,200}$)[\w.-]+\/[\w.:@+-]+$/;
const endpoint = local ? '/api/complete' : 'https://openrouter.ai/api/v1/chat/completions';
const model = document.getElementById('model');
document.querySelectorAll('#setup [data-model-picker]').forEach(setupModelPicker);

const key = document.getElementById('api-key');
const connectionStatus = document.getElementById('connection-status');
const experiments = [...document.querySelectorAll('[data-experiment]')];
const catalogLinks = document.querySelectorAll('.experiment-list a');
const callTrace = setupCallTrace(copy);
const initializedPanels = new WeakSet();

function makeRunStatus(element, selections, base, recovery = '') {
  const picks = selections.map(pick => typeof pick === 'string' ? { id: pick } : pick);
  const modelIds = picks.map(({ id }) => id);
  const retry = modelIds.some(isFreeModel) ? ` Up to ${freeRetryLimit} extra automatic retries for free models.` : '';
  const labels = picks.map(({ id, label }) => {
    const modelLabel = !id ? 'Choose a model' : isFreeModel(id) ? id : `${id} (may use credits)`;
    return label ? `${label}: ${modelLabel}` : modelLabel;
  });
  element.textContent = `${base} Models: ${labels.join(', ')}.${retry}${recovery ? ' ' + recovery : ''}`;
}

function chooseModel(override, defaultId) {
  const value = override?.value.trim();
  return { field: value ? override : model, id: value || defaultId };
}

function revealField(experiment, field) {
  for (let parent = field?.parentElement; parent && experiment.contains(parent); parent = parent.parentElement) {
    if (parent.matches('details')) parent.open = true;
  }
  field?.focus();
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

function complete(options) {
  return withFreeRetries(options.modelId, options.signal, tries => completeOnce(
    tries ? { ...options, step: `${options.step ?? 'call'} · retry ${tries}` } : options));
}

async function completeOnce({
  input, prompt, modelId, apiKey, signal, includeUsage = false, experiment, step, provider, enforceTeachbackSchema, visibility,
}) {
  signal.throwIfAborted();
  if (!prompt.trim() || prompt.length > limits.promptChars || !input.trim() || input.length > limits.inputChars) {
    throw new CompletionError(`Use a prompt of up to ${limits.promptChars.toLocaleString('en-US')} characters and an input of up to ${limits.inputChars.toLocaleString('en-US')} characters.`, false, 'edit-request');
  }
  const headers = { 'Content-Type': 'application/json' };
  if (!local) headers.Authorization = `Bearer ${apiKey}`;
  const body = JSON.stringify(completionBody({ modelId, prompt, input, includeUsage, provider, enforceTeachbackSchema }));
  if (new TextEncoder().encode(body).length > limits.requestBytes) {
    throw new CompletionError('The full request is too large. Shorten the input or prompt.', false, 'edit-request');
  }
  const request = traceBody(body, apiKey);
  const attempt = { step, modelId, request: local ? null : request, visibility };
  const finishTrace = callTrace.start(experiment, step, attempt.request, visibility);
  const finishAttempt = recordAttempt(signal, attempt);
  const finish = update => {
    finishTrace(update);
    finishAttempt.update(update);
  };
  let response;
  let responseText;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      signal,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    });
    responseText = await response.text();
  } catch (error) {
    finish({ state: signal.aborted ? 'aborted' : 'transport_error', outcome: signal.aborted ? 'aborted' : 'failed',
      http_status: response?.status ?? null });
    if (!signal.aborted && error instanceof Error) error.retryable = true;
    throw error;
  }
  let tracedResponse;
  if (local && response.headers.get('X-Adiosbox-Trace') === '1') {
    let receipt;
    try {
      receipt = JSON.parse(responseText);
      if (typeof receipt?.request !== 'string' || (receipt.response !== null && typeof receipt.response !== 'string')) {
        throw new Error('Invalid relay receipt');
      }
    } catch {
      finish({ state: 'relay_error', http_status: response.status, outcome: 'failed' });
      throw new CompletionError('The local launcher sent an unreadable reply. Restart the launcher and try again.');
    }
    responseText = receipt.response;
    tracedResponse = {
      request: traceBody(receipt.request),
      response: traceBody(responseText),
      response_source: receipt.source,
    };
  } else {
    tracedResponse = { response: traceBody(responseText, apiKey), response_source: local ? 'local proxy' : 'OpenRouter' };
  }
  finish({
    state: signal.aborted ? 'aborted' : response.ok ? 'received' : 'http_error',
    http_status: response.status,
    ...tracedResponse,
  });
  if (signal.aborted) {
    finish({ outcome: 'aborted' });
    signal.throwIfAborted();
  }
  // The trace's state is the HTTP result; outcome says how the completion itself ended.
  try {
    const result = readCompletion(response, redactTraceText(responseText, apiKey), { modelId, provider, includeUsage, local });
    finish({
      outcome: result.truncated ? 'truncated' : 'completed',
      reportedModel: result.reportedModel || null,
      reportedProvider: result.reportedProvider || null,
      usage: result.usage ?? null,
    });
    return { ...result, receipt: {
      runId: finishAttempt.runId,
      attemptNumber: finishAttempt.attemptNumber,
      request: tracedResponse.request ?? request,
      reportedModel: result.reportedModel || null,
      reportedProvider: result.reportedProvider || null,
      outcome: result.truncated ? 'truncated' : 'completed',
      usage: result.usage ?? null,
    } };
  } catch (error) {
    if (!signal.aborted) finish({ outcome: 'failed', error: error.message, retryable: error.retryable === true });
    throw error;
  }
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
    sample: sourceText(part('result' + suffix)),
    sampleTitle: part('result-title' + suffix).textContent,
    sampleMeta: part('result-meta' + suffix).textContent,
  }));
  let activeRequest;
  let savedCase;
  // When step 2 fails, its input is kept so the run can pick up there with a different model or prompt.
  const pickupButton = part('pickup');
  const dismissPickup = part('dismiss-pickup');
  let pickupState;
  const sourceInputs = () => JSON.stringify([notes.value, variants[0]?.instructions.value,
    ...[...factFields.values()].map(field => field.value)]);
  const runBudget = part('run-budget');
  function budget() {
    const modelFor = variant => chooseModel(variant.roleModel, model.value.trim()).id;
    const base = chain || factTest ? 'Full run: two base calls.'
      : comparisonStatus ? 'One base call per arm.' : 'One base call.';
    makeRunStatus(runBudget, variants.map((variant, index) => ({
      id: modelFor(variant),
      label: variant.label ? `Prompt ${variant.label}` : chain ? `Step ${index + 1}`
        : factTest ? ['Baseline', 'Changed fact'][index] : '',
    })), base);
    const pickupBudget = part('pickup-budget');
    if (pickupBudget) {
      pickupBudget.hidden = !pickupState;
      if (pickupState) makeRunStatus(pickupBudget, [modelFor(variants[1])], 'Pick-up: one base call.');
    }
  }
  for (const name of ['input', 'change', 'click', 'case-restored']) experiment.addEventListener(name, budget);
  for (const name of ['input', 'change']) model.addEventListener(name, budget);
  budget();
  function clearPickup() {
    if (pickupState && !activeRequest) setRunActivity(experiment);
    pickupState = undefined;
    if (pickupButton) pickupButton.hidden = true;
    if (dismissPickup) dismissPickup.hidden = true;
    budget();
  }
  dismissPickup?.addEventListener('click', () => {
    clearPickup();
    setStatus(runStatus, 'Left as it is. Run again to start over.');
    variants[0].run.focus();
  });
  form.addEventListener('input', event => {
    if (event.target === notes || event.target === variants[0]?.instructions || [...factFields.values()].includes(event.target)) clearPickup();
  });
  experiment.addEventListener('setup-changed', () => {
    clearPickup();
    for (const variant of variants) {
      variant.snapshot = undefined;
      if (receipts.has(variant.result)) {
        variant.result.dataset.resultState = 'previous';
        variant.meta.textContent = 'Previous result · run this setup to update it.';
      }
    }
    if (comparisonStatus) setStatus(comparisonStatus, '');
    setStatus(runStatus, '');
  });

  part('load-sample').addEventListener('click', () => {
    const edited = notes.value !== notes.defaultValue ||
      [...factFields.values()].some(field => field.value !== field.defaultValue);
    if (!mayReplaceSetup(experiment, runStatus, edited ? 'Replace your input with the sample?' : '')) return;
    notes.value = notes.defaultValue;
    for (const field of factFields.values()) field.value = field.defaultValue;
    experiment.dispatchEvent(new Event('setup-changed'));
    notes.focus();
  });

  for (const variant of variants) {
    variant.copy.addEventListener('click', () => {
      copy(sourceText(variant.result), variant.copyStatus, 'Result copied.', 'Select the result text and copy it.');
    });
  }

  experiment.addEventListener('case-restored', event => {
    savedCase = event.detail;
    clearPickup();
    for (const variant of variants) {
      variant.snapshot = undefined;
      receipts.delete(variant.result);
      linkRunOutput(variant.result);
      variant.result.dataset.resultState = 'sample';
      renderResult(variant.result, variant.sample);
      variant.title.textContent = variant.sampleTitle;
      variant.meta.textContent = variant.sampleMeta;
      variant.copy.disabled = false;
      variant.handoff.disabled = false;
      setStatus(variant.copyStatus, '');
    }
    if (comparisonStatus) setStatus(comparisonStatus, '');
    linkRunOutput(experiment);
    setStatus(runStatus, '');
  });

  experiment.addEventListener('case-saved', event => { savedCase = event.detail; });

  function reportComparison() {
    if (!comparisonStatus) return;
    const [first, second] = variants.map(variant => variant.snapshot);
    if (!first || !second) {
      setStatus(comparisonStatus, 'Run both arms for a live comparison. Check the label on each result.');
      return;
    }
    if (first.truncated || second.truncated) {
      setStatus(comparisonStatus, 'At least one result hit the output limit. Shorten the input or prompt and run the pair again.', true);
    } else if (first.input !== second.input) {
      setStatus(comparisonStatus, 'The inputs differ. Run both arms on the same input to compare them directly.', true);
    } else if (first.requestedModel !== second.requestedModel) {
      setStatus(comparisonStatus, 'These runs requested different models. Match the models to isolate a prompt change, or match the prompts to compare models.');
    } else if (first.reportedModel && second.reportedModel && first.reportedModel !== second.reportedModel) {
      setStatus(comparisonStatus, 'OpenRouter reported different models for these runs. Pick one specific model and run A and B again.', true);
    } else if (first.reportedProvider && second.reportedProvider && first.reportedProvider !== second.reportedProvider) {
      setStatus(comparisonStatus, 'OpenRouter reported different providers for the two calls.', true);
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

    const resuming = Boolean(pickupState) && event.submitter === pickupButton;
    if (resuming && pickupState.source !== sourceInputs()) {
      clearPickup();
      setStatus(runStatus, 'The input changed. Start a new run.', true);
      return;
    }
    const selected = variants.find(item => item.run === event.submitter) ?? variants[0];
    const run = selected.run;
    const defaultModel = model.value.trim();
    const stages = (chain || factTest ? variants : [selected]).map(variant => ({
      variant,
      prompt: variant.instructions.value.trim(),
      selection: chooseModel(variant.roleModel, defaultModel),
    }));
    const input = notes.value.trim();
    const startingSource = sourceInputs();
    const apiKey = key?.value.trim();
    const pendingStages = resuming ? stages.slice(1) : stages;
    const missing = [
      [notes, input, 'Enter some input or load the sample.'],
      [notes, input.length <= notes.maxLength, `Shorten the input to ${notes.maxLength} characters.`],
      ...pendingStages.map(({ variant, prompt }) => [variant.instructions, prompt, 'Enter instructions for the model.']),
      ...pendingStages.map(({ selection }) => [selection.field, modelIdPattern.test(selection.id), 'Choose a model or enter its full OpenRouter ID.']),
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
      const value = name => factFields.get(name).value.trim();
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
    const focusOnRun = document.activeElement === run || document.activeElement === pickupButton;
    let step = 0;
    let handoff = input;
    if (resuming) ({ handoff, factInputs, expectations } = pickupState);
    const runRecord = beginRun(experiment, request.signal, experiment, resuming ? pickupState.runRecord : undefined);
    setRunActivity(experiment, 'running');
    clearPickup();
    if (comparisonStatus) setStatus(comparisonStatus, '');
    for (const { variant } of resuming ? stages.slice(1) : stages) {
      variant.snapshot = undefined;
      if (variant.result.dataset.resultState !== 'sample' && sourceText(variant.result)) {
        variant.result.dataset.resultState = 'previous';
        variant.meta.textContent = 'Previous result shown while the new call runs.';
      }
    }
    const buttons = variants.map(variant => variant.run).filter(Boolean);
    buttons.forEach(button => { button.disabled = true; });
    cancel.hidden = false;
    if (focusOnRun) cancel.focus();

    try {
      for (const { variant, prompt, selection: { id: modelId } } of stages) {
        step += 1;
        if (resuming && step === 1) continue;
        const { label, result, title, meta, copy: copyButton, copyStatus } = variant;
        const progress = resuming ? (factTest ? 'Picking up at the changed case…' : 'Picking up at step 2…') : factTest ? (step === 1 ? 'Running baseline…' : 'Running changed fact…')
          : chain ? `Running step ${step} of ${stages.length}…` : label ? `Running prompt ${label}…` : 'Waiting for OpenRouter…';
        setStatus(runStatus, progress);
        setStatus(copyStatus, '');
        const { content, reportedModel, reportedProvider, truncated, receipt } = await withCallDeadline(request, () => complete({
          input: factInputs?.[step - 1] ?? handoff, prompt, modelId, apiKey, signal: request.signal,
          experiment: experiment.id, step: label || step,
          includeUsage: true,
        }));

        result.dataset.resultState = truncated ? 'partial' : 'live';
        receipts.set(result, receipt);
        linkRunOutput(result, runRecord);
        renderResult(result, content);
        if (!chain && !factTest) title.textContent = label ? `Result ${label}` : 'Your result';
        meta.textContent = describeModel(modelId, reportedModel);
        copyButton.disabled = false;
        variant.handoff.disabled = false;
        if (comparisonStatus) {
          variant.snapshot = { input, requestedModel: modelId, reportedModel, reportedProvider, truncated, content };
          if (!factTest) reportComparison();
        }

        if ((chain || factTest) && step === 1) {
          const next = stages[1].variant;
          receipts.delete(next.result);
          linkRunOutput(next.result);
          next.result.dataset.resultState = 'empty';
          renderResult(next.result, '');
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
          if (handoff.length > limits.inputChars) {
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
          const caveat = baseline.requestedModel !== changed.requestedModel
            ? '\nThe two cases requested different models. Run both with the same model to isolate the fact change.'
            : routedDifferently
              ? '\nOpenRouter reported different models. Rerun with a specific model to isolate the fact change.'
              : baseline.reportedProvider && changed.reportedProvider && baseline.reportedProvider !== changed.reportedProvider
                ? '\nOpenRouter reported different providers for the two cases.'
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
        for (const { variant } of stages) {
          if (variant.result.dataset.resultState === 'previous') variant.meta.textContent = 'Previous result retained. The new call did not finish.';
        }
        if ((chain || factTest) && step === 2) {
          stages[1].variant.meta.textContent = factTest ? 'The changed case did not finish.' : 'Step 2 did not finish.';
          const remaining = factTest ? 'The baseline is kept. Pick a different model if you like, then pick up at the changed case.'
            : 'Step 1 is kept. Pick a different model for step 2 if you like, then pick up at step 2.';
          const recoverable = request.signal.reason !== keyClearedReason && error?.reason !== 'edit-request' &&
            startingSource === sourceInputs();
          const next = error?.reason === 'connection' ? ' Check your OpenRouter key or account before picking up.' : '';
          setStatus(runStatus, recoverable ? `${message}${next} ${remaining}` : message, isError);
          if (recoverable) {
            pickupState = { handoff, factInputs, expectations, source: startingSource, runRecord };
            pickupButton.hidden = false;
            dismissPickup.hidden = false;
            budget();
          }
        } else {
          setStatus(runStatus, message, isError);
        }
      };
      if (request.signal.aborted) {
        if (request.signal.reason === keyClearedReason) {
          showFailure(keyClearedReason.message, false);
          return;
        }
        const timedOut = request.signal.reason === timeoutReason;
        showFailure(timedOut ? `${timeoutReason.message} Try again.` : 'Run canceled.', timedOut);
        return;
      }
      showFailure(error instanceof CompletionError ? error.message : 'Could not read a response from OpenRouter. Check your connection and try again.');
    } finally {
      activeRequest = undefined;
      setRunActivity(experiment, pickupState ? 'ready to pick up' : undefined);
      buttons.forEach(button => { button.disabled = false; });
      if (document.activeElement === cancel) run.focus();
      cancel.hidden = true;
    }
  });
  return () => {
    clearPickup();
    activeRequest?.abort(keyClearedReason);
  };
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
  const pickup = part('pickup');
  const pickupModel = pickup.querySelector('[data-pickup-model]');
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
  const recordOutput = trace.closest('[data-handoff-record]');
  const sourceInputs = () => JSON.stringify([notes.value, minutes?.value]);
  const runBudget = part('run-budget');
  const modelRoles = spec.roleModels ? spec.roleModels.map(({ key }) => key) : Object.keys(spec.nodes);
  const roleLabel = role => spec.roleModels?.find(model => model.key === role)?.title ?? spec.nodes[role]?.title ?? role;
  function budget() {
    const picks = modelRoles.map(role => ({ label: roleLabel(role), id: chooseModel(modelFields.get(role), model.value.trim()).id }));
    makeRunStatus(runBudget, picks, `Up to ${experiment.dataset.baseCalls} base calls.`);
    if (active?.failed) {
      const roles = pickupSelections(pickupModel.value.trim());
      const stopped = (active.failed.steps ?? [active.failed]).map(({ title, role }) => `${title} uses ${roles.get(role).id}`);
      makeRunStatus(part('pickup-budget'), [...roles].map(([role, { id }]) => ({ label: roleLabel(role), id })),
        `Up to ${active.graph.remainingCalls()} remaining base calls.`, `Calls to retry: ${stopped.join('; ')}.`);
    }
  }
  for (const name of ['input', 'change', 'click', 'case-restored']) experiment.addEventListener(name, budget);
  for (const name of ['input', 'change']) model.addEventListener(name, budget);
  budget();

  experiment.addEventListener('case-restored', () => {
    if (active?.failed) finishRun();
    linkRunOutput(recordOutput);
    trace.replaceChildren(...sample.map(entry => entry.cloneNode(true)));
    formatWrittenResults(trace);
    traceTitle.textContent = sampleTitle;
    traceMeta.textContent = sampleMeta;
    setStatus(runStatus, '');
    setStatus(copyStatus, '');
  });
  function pickupSelections(replacement) {
    const failedRoles = new Set((active.failed.steps ?? [active.failed]).map(step => step.role));
    return new Map([...active.roleModels].map(([role, selection]) =>
      [role, replacement && failedRoles.has(role) ? { ...selection, id: replacement } : selection]));
  }

  function invalidatePickup() {
    if (!active?.failed) return;
    finishRun();
    setStatus(runStatus, 'Input changed. Start a new run when ready.');
  }
  experiment.addEventListener('setup-changed', () => {
    invalidatePickup();
    if (traceTitle.textContent === 'Run record') traceMeta.textContent = 'Previous run · run this setup to update it.';
  });
  experiment.addEventListener('input', event => {
    if (event.target === notes || event.target === minutes) invalidatePickup();
  });

  function record(title, content, respondingModel, requestedModel, kind, receipt) {
    const model = requestedModel ? describeModel(requestedModel, respondingModel) : '';
    appendRunRecord(trace, title, content, model, kind, receipt);
  }

  function finishRun() {
    setRunActivity(experiment);
    choices.hidden = true;
    pickup.hidden = true;
    run.disabled = false;
    if (cancel === document.activeElement || choices.contains(document.activeElement) || pickup.contains(document.activeElement)) run.focus();
    cancel.hidden = true;
    active = undefined;
  }

  function stopRun(message) {
    if (!active) return;
    if (active.failed) {
      finishRun();
      return;
    }
    active.controller.abort(message);
    if (active.paused) {
      record('Stopped at checkpoint', String(message));
      setStatus(runStatus, String(message));
      finishRun();
    }
  }

  async function advance(invoke) {
    setRunActivity(experiment, 'running');
    try {
      const { result, paused } = await invoke();
      active.controller.signal.throwIfAborted();
      if (paused) {
        record('Paused for your choice', choices.querySelector('legend').textContent.trim());
        active.paused = true;
        setRunActivity(experiment, 'waiting for your choice');
        choices.hidden = false;
        const preparation = orchestrated ? 'plan' : editableBrief ? 'profile' : 'prepare';
        makeRunStatus(part('approval-budget'), [...active.roleModels].filter(([role]) => role !== preparation)
          .map(([role, { id }]) => ({ label: roleLabel(role), id })),
          `Up to ${active.graph.remainingCalls()} remaining base calls.`);
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
      const reason = canceled ? signal.reason : error.message || 'An error stopped the graph.';
      const message = String(reason);
      if (!canceled) active.controller.abort(message);
      record('Graph stopped', message);
      setStatus(runStatus, message, !canceled || reason === timeoutReason);
      // Finished steps are checkpointed, so offer to rerun only the step that failed.
      const point = reason !== keyClearedReason && error?.reason !== 'edit-request' &&
        await active.graph?.pickupPoint().catch(() => null);
      if (point && !active.discardRecovery && active.source === sourceInputs()) {
        active.failed = point;
        setRunActivity(experiment, 'ready to pick up');
        const titles = (point.steps ?? [point]).map(({ title }) => `“${title}”`).join(', ');
        pickup.querySelector('[data-part="pickup-reason"]').textContent =
          `Calls to retry: ${titles}. Finished steps are kept.`;
        pickupModel.value = '';
        pickup.hidden = false;
        run.disabled = false;
        cancel.hidden = true;
        budget();
        pickup.querySelector('[data-pickup="go"]').focus();
      }
    } finally {
      if (!active.paused && !active.failed) finishRun();
    }
  }

  part('load-sample').addEventListener('click', () => {
    const edited = notes.value !== notes.defaultValue || (minutes && minutes.value !== minutes.defaultValue);
    if (!mayReplaceSetup(experiment, runStatus, edited ? 'Replace your input with the sample?' : '')) return;
    notes.value = notes.defaultValue;
    if (minutes) minutes.value = minutes.defaultValue;
    invalidatePickup();
    experiment.dispatchEvent(new Event('setup-changed'));
    notes.focus();
  });

  part('copy-trace').addEventListener('click', () => {
    copy(runRecordText(trace), copyStatus, 'Run record copied.', 'Select the run record text and copy it.');
  });

  part('experiment-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (active && !active.failed) return;
    const input = notes.value.trim();
    const defaultModel = model.value.trim();
    const roleModels = new Map(modelRoles.map(role => [role, chooseModel(modelFields.get(role), defaultModel)]));
    const invalidModel = [...roleModels.values()].find(selection => !modelIdPattern.test(selection.id));
    const apiKey = key?.value.trim();
    const minuteBudget = minutes?.valueAsNumber;
    const missing = [
      [notes, input, 'Enter some input or load the sample.'],
      [notes, input.length <= notes.maxLength, `Shorten the input to ${notes.maxLength} characters.`],
      [minutes, !minutes || (Number.isInteger(minuteBudget) && minuteBudget >= 1 && minuteBudget <= 720), 'Enter a whole number from 1 to 720.'],
      [invalidModel?.field, !invalidModel, 'Choose a model or enter its full OpenRouter ID.'],
      [key, local || apiKey, 'Enter your OpenRouter key to run the graph.'],
    ].find(([, valid]) => !valid);
    if (missing) {
      const [field, , message] = missing;
      revealField(experiment, field);
      setStatus(runStatus, message, true);
      return;
    }

    if (active) finishRun();
    const controller = new AbortController();
    const current = { controller, paused: false, apiKey, roleModels, source: sourceInputs() };
    active = current;
    current.runRecord = beginRun(experiment, controller.signal, recordOutput);
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
          // A pick-up swaps in a new controller, key, and model selection, so read them from the run each call.
          const modelId = current.roleModels.get(node).id;
          const { controller: attempt } = current;
          const result = await withCallDeadline(attempt, () => complete({
            input: nodeInput, prompt, modelId, apiKey: current.apiKey, signal: attempt.signal, experiment: experiment.id, step: node,
            includeUsage: true,
          }));
          return { ...result, requestedModel: modelId };
        },
      });
      return active.graph.start(input, minuteBudget);
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
    if (active.source !== sourceInputs()) {
      stopRun('The input changed. Start a new graph to continue.');
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

  pickup.addEventListener('click', async event => {
    const action = event.target.closest('[data-pickup]')?.dataset.pickup;
    if (!action || !active?.failed) return;
    if (active.source !== sourceInputs()) {
      invalidatePickup();
      return;
    }
    if (action === 'stop') {
      setStatus(runStatus, 'Left as it is. Run the graph to start over.');
      finishRun();
      run.focus();
      return;
    }
    const chosen = pickupModel.value.trim();
    const apiKey = key?.value.trim();
    if (chosen && !modelIdPattern.test(chosen)) {
      setStatus(runStatus, 'Choose a model or enter its full OpenRouter ID.', true);
      pickupModel.focus();
      return;
    }
    if (!local && !apiKey) {
      revealField(experiment, key);
      setStatus(runStatus, 'Enter your OpenRouter key to pick up the run.', true);
      return;
    }
    const { failed } = active;
    active.roleModels = pickupSelections(chosen);
    active.apiKey = apiKey;
    active.controller = new AbortController();
    beginRun(experiment, active.controller.signal, recordOutput, active.runRecord);
    active.failed = undefined;
    pickup.hidden = true;
    run.disabled = true;
    cancel.hidden = false;
    cancel.focus();
    const titles = (failed.steps ?? [failed]).map(({ title }) => `“${title}”`).join(', ');
    record('Picked up', chosen ? `Retrying ${titles} with ${chosen}.` : `Retrying ${titles} with the same model picks.`);
    setStatus(runStatus, 'Picking up where it stopped…');
    await advance(() => active.graph.pickUp(active.controller.signal));
  });

  cancel.addEventListener('click', () => stopRun('Run canceled.'));
  return () => {
    if (active) active.discardRecovery = true;
    stopRun(keyClearedReason);
  };
}

const labUI = {
  chooseModel, copy, describeModel, experiments, getApiKey: () => key?.value.trim(),
  local, model, modelIdPattern, revealField, setStatus, makeRunStatus, refreshCallTrace: callTrace.refresh,
};
// Every workbench shares only its public address and anchor.
for (const experiment of experiments) {
  experiment.querySelector('[data-part="share"]').addEventListener('click', () => {
    const url = new URL(window.location.pathname, window.location.origin);
    url.hash = experiment.id;
    copy(url.href, experiment.querySelector('[data-part="share-status"]'), 'Example link copied.',
      `Copy this example link: ${url.href}`);
  });
}

const cancelRequests = experiments.map(experiment => {
  if (experiment.hasAttribute('data-lab')) {
    return setupLab(experiment, {
      ...labUI,
      complete: options => complete({ ...options, experiment: experiment.id }),
    });
  }
  return experiment.hasAttribute('data-graph') ? setupGraph(experiment) : setupExperiment(experiment);
});

document.getElementById('clear-key')?.addEventListener('click', () => {
  key.value = '';
  cancelRequests.forEach(cancel => cancel());
  callTrace.clear();
  key.focus();
  setStatus(connectionStatus, 'Key cleared.');
});

window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  callTrace.clear();
  if (!key) return;
  key.value = '';
  cancelRequests.forEach(cancel => cancel());
});

function selectExperiment(experiment) {
  for (const panel of experiments) panel.hidden = panel !== experiment;
  if (!initializedPanels.has(experiment)) {
    initializedPanels.add(experiment);
    experiment.querySelectorAll('[data-model-picker]').forEach(setupModelPicker);
    formatWrittenResults(experiment);
  }
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

for (const experiment of experiments) for (const example of experiment.querySelectorAll('[data-example]')) {
  const name = example.dataset.example === 'canary' ? 'canary' : 'beer example';
  const button = example.querySelector('[data-load-example]');
  button.hidden = false;
  button.addEventListener('click', () => {
    const status = example.querySelector('[data-example-status]');
    const notes = experiment.querySelector('[data-part="notes"]');
    const minutes = experiment.querySelector('[data-part="minutes"]');
    const fields = [...experiment.querySelectorAll('[data-case-field]')];
    const editableFields = fields.filter(field => field.dataset.caseField !== 'provider');
    const edited = [notes, minutes, ...editableFields].some(field => field && field.value !== field.defaultValue);
    const confirmation = edited ? `Replace the current input and answer fields with the ${name}?` : '';
    if (!mayReplaceSetup(experiment, status, confirmation)) return;

    const { fields: values, minutes: budget } = JSON.parse(example.querySelector('[data-example-setup]').value);
    notes.value = example.querySelector('[data-example-input]').textContent;
    if (minutes && budget) minutes.value = budget;
    for (const field of editableFields) {
      field.value = values[field.dataset.caseField] ?? field.defaultValue;
    }
    experiment.dispatchEvent(new Event('setup-changed'));
    experiment.dispatchEvent(new Event('example-loaded'));
    setStatus(status, `${name[0].toUpperCase()}${name.slice(1)} loaded. Review the input and model picks before running.`);
    notes.focus();
  });
}

function linkedExperiment() {
  return experiments.find(panel => `#${panel.id}` === window.location.hash);
}

const initialExperiment = linkedExperiment();
selectExperiment(initialExperiment ?? experiments[0]);

const search = document.getElementById('catalog-search');
const shelves = [...document.querySelectorAll('[data-catalog-shelf]')].map(section => ({
  section,
  cards: [...section.querySelectorAll('li')].map(card => ({
    card,
    text: `${section.querySelector('h3').textContent} ${card.textContent}`.toLocaleLowerCase(),
  })),
}));
const featured = document.querySelector('[data-catalog-featured]');
const searchStatus = document.getElementById('catalog-search-status');
search.parentElement.hidden = false;
search.addEventListener('input', () => {
  const query = search.value.trim().toLocaleLowerCase();
  const terms = query.split(/\s+/);
  let matches = 0;
  for (const { section, cards } of shelves) {
    let visible = 0;
    for (const { card, text } of cards) {
      card.hidden = !terms.every(term => text.includes(term));
      if (!card.hidden) visible += 1;
    }
    section.hidden = !visible;
    matches += visible;
  }
  featured.hidden = Boolean(query);
  setStatus(searchStatus, query ? `${matches} ${matches === 1 ? 'experiment' : 'experiments'} found.` : '');
});

window.addEventListener('hashchange', () => {
  const target = linkedExperiment();
  if (!target) {
    if (!window.location.hash) selectExperiment(experiments[0]);
    return;
  }
  focusExperiment(target);
});

if (initialExperiment) initialExperiment.scrollIntoView();

// A More menu closes on a click elsewhere, after it hands off to a dialog, or on Escape.
document.addEventListener('click', event => {
  for (const menu of document.querySelectorAll('details.more[open]')) {
    if (!menu.contains(event.target) || event.target.closest('[data-handoff]')) menu.open = false;
  }
});
document.addEventListener('keydown', event => {
  const menu = event.key === 'Escape' && event.target.closest?.('details.more[open]');
  if (!menu) return;
  menu.open = false;
  menu.querySelector('summary').focus();
});
