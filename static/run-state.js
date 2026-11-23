export const receipts = new WeakMap();
// Abort reasons double as status messages; pick-up and recovery logic compare against these.
export const timeoutReason = 'OpenRouter took too long.';
export const keyClearedReason = 'Run canceled because the key was cleared.';

export async function withCallDeadline(controller, task, reason = timeoutReason) {
  controller.signal.throwIfAborted();
  const timer = setTimeout(() => controller.abort(reason), 60_000);
  try {
    return await task();
  } finally {
    clearTimeout(timer);
  }
}

// Lab modes that run a source graph, so their records and saved cases carry the graph revision.
export const graphLabModes = ['repair', 'evidence', 'stop', 'cost'];

const runsBySignal = new WeakMap();
const runsByOutput = new WeakMap();
const activity = new Map();

export function beginRun(experiment, signal, output, previous) {
  const sourceId = experiment.dataset.labGraph;
  const source = sourceId && document.getElementById(sourceId);
  const usesGraph = experiment.hasAttribute('data-graph') || source ||
    graphLabModes.includes(experiment.dataset.lab);
  const run = previous ?? {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    experiment: experiment.id,
    experimentRevision: experiment.dataset.caseRevision,
    sourceRevision: source?.dataset.caseRevision,
    graphRevision: usesGraph ? document.body.dataset.graphRevision : undefined,
    appRevision: globalThis.document?.body.dataset.appRevision,
    attempts: [],
  };
  if (signal) runsBySignal.set(signal, run);
  if (output) linkRunOutput(output, run);
  return run;
}

export function linkRunOutput(output, run) {
  if (run) runsByOutput.set(output, run);
  else runsByOutput.delete(output);
}

export function runForOutput(output) {
  return runsByOutput.get(output);
}

export function publicRunRecord(run) {
  return {
    ...run,
    attempts: run.attempts.filter(({ visibility }) => !visibility || visibility.revealed)
      .map(({ visibility, ...attempt }) => attempt),
  };
}

export function recordAttempt(signal, { step, modelId, request, visibility }) {
  const run = runsBySignal.get(signal);
  const attempt = { number: (run?.attempts.length ?? 0) + 1, step, requestedModel: modelId,
    startedAt: new Date().toISOString(), request, state: 'pending', visibility };
  run?.attempts.push(attempt);
  return {
    runId: run?.id,
    attemptNumber: attempt.number,
    update({ response, ...fields }) {
      Object.assign(attempt, { finishedAt: new Date().toISOString() }, fields);
    },
  };
}

export function isRunBusy(experiment) {
  const state = activity.get(experiment);
  return state === 'running' || state === 'waiting for your choice';
}

export function setRunActivity(experiment, state) {
  if (state) activity.set(experiment, state);
  else activity.delete(experiment);
  const status = document.getElementById('active-workbenches');
  status.replaceChildren();
  for (const [index, [panel, description]] of [...activity].entries()) {
    if (index) status.append(' · ');
    const link = document.createElement('a');
    link.href = '#' + panel.id;
    link.textContent = panel.querySelector('h2').textContent;
    status.append(link, ` (${description})`);
  }
  status.hidden = !activity.size;
}
