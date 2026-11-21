import { Annotation, END, START, MemorySaver, StateGraph } from '@langchain/langgraph/web';

const State = Annotation.Root({
  input: Annotation(),
  minutes: Annotation(),
  first: Annotation(),
  leftOutput: Annotation(),
  rightOutput: Annotation(),
  draftOutput: Annotation(),
  reviewDecision: Annotation(),
  passes: Annotation(),
  decision: Annotation(),
  final: Annotation(),
  stopped: Annotation(),
  roleProposal: Annotation(),
  approvedBrief: Annotation(),
  specialistRecords: Annotation(),
  specialistBrief: Annotation(),
  specialistDraft: Annotation(),
});

export const requestLimits = { route: 2, revise: 4, ledger: 2, fork: 3, checkpoint: 2, evidence: 2, adaptive: 3, orchestrated: 5, 'orchestrated-subgraphs': 8 };

function parseRecord(text) {
  return JSON.parse(text.replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/gi, '').trim());
}

function readDecision(text, routes) {
  try {
    const { route, reason } = parseRecord(text);
    if (routes.includes(route) && typeof reason === 'string' && reason.trim()) {
      return { route, reason: reason.trim() };
    }
  } catch {
    // A malformed control message follows the safe stop route.
  }
  return { route: 'stop', reason: 'The model did not return a valid routing decision.' };
}

function readLedger(text, minutes) {
  try {
    const { items } = parseRecord(text);
    if (!Array.isArray(items) || items.length === 0 || items.length > 12 ||
        items.some(item => typeof item?.task !== 'string' || !item.task.trim() ||
          !Number.isSafeInteger(item.minutes) || item.minutes < 1)) {
      return { issue: 'Each of 1–12 tasks must have a name and a positive whole-minute duration.' };
    }
    const total = items.reduce((sum, item) => sum + item.minutes, 0);
    if (total > minutes) return { issue: `The tasks total ${total} minutes and the budget is ${minutes}.` };
    const lines = items.map(({ task, minutes: duration }) => `${duration} min · ${task}`);
    return { plan: `${lines.join('\n')}\n\n${total} of ${minutes} minutes assigned. ${minutes - total} minutes unallocated.` };
  } catch {
    return { issue: 'The model did not return a valid task ledger.' };
  }
}

function readClaims(text) {
  let claims;
  try {
    claims = parseRecord(text)?.claims;
  } catch {
    throw new Error('The model did not return a JSON claim list.');
  }
  if (!Array.isArray(claims) || claims.length < 1 || claims.length > 8 || claims.some(claim =>
    !claim || ['claim', 'source', 'quote'].some(field => typeof claim[field] !== 'string' || !claim[field].trim()))) {
    throw new Error('Each claim needs a statement, source label, and quotation.');
  }
  return claims;
}

function sourceBlocks(input) {
  const excerpts = new Map();
  const labels = [...input.matchAll(/^\[([a-zA-Z0-9_-]+)\][ \t]*/gm)];
  for (const [index, label] of labels.entries()) {
    if (excerpts.has(label[1])) throw new Error(`Source label ${label[1]} appears more than once.`);
    const start = label.index + label[0].length;
    excerpts.set(label[1], input.slice(start, labels[index + 1]?.index).trim());
  }
  if (!excerpts.size) throw new Error("Start each source excerpt with a label such as [A].");
  return excerpts;
}

function auditClaimTrail(input, ledger, rewritten) {
  const excerpts = sourceBlocks(input);
  const intermediate = readClaims(ledger);
  return readClaims(rewritten).map(({ claim, source, quote }) => {
    if (!excerpts.get(source)?.includes(quote)) {
      return { claim, source, quote, status: 'Quote missing from the named source' };
    }
    const carried = intermediate.some(item => item.source === source && item.quote === quote);
    return {
      claim, source, quote,
      status: carried ? 'Exact quote carried through'
        : 'Exact quote introduced in the rewrite',
    };
  });
}

function cleanAgentBrief(value) {
  const brief = {};
  for (const [field, limit] of [['role', 100], ['deliverable', 240], ['approach', 900]]) {
    if (typeof value?.[field] !== 'string' || !value[field].trim() || value[field].length > limit) {
      throw new Error(`Enter a ${field} of at most ${limit} characters.`);
    }
    brief[field] = value[field].trim();
  }
  const checks = value.checks;
  if (!Array.isArray(checks) || checks.length < 1 || checks.length > 4 ||
      checks.some(check => typeof check !== 'string' || !check.trim() || check.length > 200)) {
    throw new Error('Enter one to four success checks, with at most 200 characters per line.');
  }
  return { ...brief, checks: checks.map(check => check.trim()) };
}

function cleanStages(stages) {
  if (!Array.isArray(stages) || stages.length < 2 || stages.length > 3 ||
      stages.some(stage => typeof stage !== 'string' || !stage.trim() || stage.length > 240 || /[\r\n]/.test(stage))) {
    throw new Error('Enter two or three specialist jobs, one per line, up to 240 characters each.');
  }
  return stages.map(stage => stage.trim());
}

function cleanSpecialistBrief(value) {
  if (typeof value?.approach !== 'string' || value.approach.length > 280 ||
      !Array.isArray(value.checks) || value.checks.length > 3 ||
      value.checks.some(check => typeof check !== 'string' || check.length > 120)) {
    throw new Error('Invalid specialist brief.');
  }
  const { role, approach, checks } = cleanAgentBrief({ ...value, deliverable: 'Handoff' });
  return { role, approach, checks };
}

function readSpecialistResult(text) {
  const value = parseRecord(text);
  if (typeof value?.handoff !== 'string' || !value.handoff.trim() || value.handoff.length > 600) {
    throw new Error('Invalid specialist handoff.');
  }
  return { ...cleanSpecialistBrief(value), handoff: value.handoff.trim() };
}

function readAgentProposal(text, orchestrated = false) {
  const value = parseRecord(text);
  const brief = cleanAgentBrief(value);
  const question = value.question ?? '';
  if (typeof question !== 'string' || question.length > 240) throw new Error('Invalid question.');
  return {
    ...brief, question: question.trim(),
    ...(orchestrated && { stages: cleanStages(value.stages) }),
  };
}

function briefText({ role, deliverable, approach, checks, question, clarification, stages }) {
  return [
    role, `Deliverable · ${deliverable}`, `Approach · ${approach}`,
    'Success checks', ...checks.map(check => `• ${check}`),
    ...(stages ? ['Specialist jobs', ...stages.map((job, index) => `${index + 1}. ${job}`)] : []),
    question && `Question · ${question}`, clarification && `Context · ${clarification}`,
  ].filter(Boolean).join('\n');
}

export function createExperimentGraph(spec, { complete, record, signal }) {
  const graph = new StateGraph(State);
  const subgraphs = spec.mode === 'orchestrated-subgraphs';
  const orchestrated = spec.mode === 'orchestrated' || subgraphs;
  let calls = 0;

  async function runNode(name, data, { modelRole = name, label } = {}) {
    signal.throwIfAborted();
    if (calls >= requestLimits[spec.mode]) throw new Error('The model request limit was reached.');
    const node = spec.nodes[name];
    const input = typeof data === 'string' ? data : JSON.stringify(data);
    if (input.length > 8000) throw new Error('A handoff exceeded the input limit. Try with shorter source material.');
    calls += 1;
    const response = await complete({ prompt: node.prompt, input, node: modelRole });
    signal.throwIfAborted();
    record(label || node.title, response.content, response.reportedModel, response.requestedModel);
    if (response.truncated) throw new Error('A node hit its output limit. The partial result is available in the run record.');
    return response.content;
  }

  function source(state) {
    return { originalInput: state.input };
  }

  if (spec.mode === 'route') {
    graph.addNode('classify', async state => {
      const result = await runNode('classify', state.input);
      const decision = readDecision(result, ['proceed', 'alternate', 'stop']);
      record('Route selected', `${spec.routes[decision.route]}\n${decision.reason}`);
      return { decision };
    });
    graph.addNode('proceed', async state => ({
      final: await runNode('proceed', { ...source(state), decision: state.decision }),
    }));
    graph.addNode('alternate', async state => ({
      final: await runNode('alternate', { ...source(state), decision: state.decision }),
    }));
    graph.addNode('stop', state => ({ stopped: state.decision.reason }));
    graph.addEdge(START, 'classify');
    graph.addConditionalEdges('classify', state => state.decision.route, ['proceed', 'alternate', 'stop']);
    for (const node of ['proceed', 'alternate', 'stop']) graph.addEdge(node, END);
  }

  if (spec.mode === 'fork') {
    graph.addNode('left', async state => ({ leftOutput: await runNode('left', state.input) }));
    graph.addNode('right', async state => ({ rightOutput: await runNode('right', state.input) }));
    graph.addNode('merge', async state => ({
      final: await runNode('merge', { ...source(state), left: state.leftOutput, right: state.rightOutput }),
    }));
    graph.addConditionalEdges(START, state => state.leftOutput && state.rightOutput
      ? 'merge' : ['left', 'right'], ['merge', 'left', 'right']);
    graph.addEdge(['left', 'right'], 'merge').addEdge('merge', END);
  }

  if (spec.mode === 'revise' || spec.mode === 'ledger') {
    const ledger = spec.mode === 'ledger';
    graph.addNode('draft', async state => ({
      draftOutput: await runNode('draft', {
        ...source(state), minutes: state.minutes, priorDraft: state.draftOutput, priorReview: state.reviewDecision,
      }),
      passes: (state.passes ?? 0) + 1,
    }));
    graph.addNode('review', async state => {
      let review;
      if (ledger) {
        const checked = readLedger(state.draftOutput, state.minutes);
        review = checked.issue
          ? { route: 'revise', reason: checked.issue }
          : { route: 'proceed', reason: 'Task durations pass the arithmetic checks.' };
        record('Check the minutes', review.reason);
        if (checked.plan) {
          record('Checked plan', checked.plan);
          return { reviewDecision: review, final: checked.plan };
        }
      } else {
        const verdict = await runNode('review', { ...source(state), draft: state.draftOutput });
        review = readDecision(verdict, ['proceed', 'revise', 'stop']);
        const verdictLabel = { proceed: 'Accept', revise: 'Revise', stop: 'Stop' }[review.route];
        record('Review decision', [verdictLabel, review.reason].join('\n'));
      }
      if (review.route === 'proceed') return { reviewDecision: review, final: state.draftOutput };
      if (review.route === 'stop' || state.passes >= 2) return { reviewDecision: review, stopped: review.reason };
      return { reviewDecision: review };
    });
    graph.addConditionalEdges(START, state => state.draftOutput ? 'review' : 'draft', ['review', 'draft']);
    graph.addEdge('draft', 'review');
    graph.addConditionalEdges('review', state => state.final || state.stopped ? END : 'draft', [END, 'draft']);
  }

  if (spec.mode === 'evidence') {
    graph.addNode('extract', async state => {
      sourceBlocks(state.input);
      return { first: await runNode('extract', state.input) };
    });
    graph.addNode('rewrite', async state => ({
      draftOutput: await runNode('rewrite', { ...source(state), ledger: state.first }),
    }));
    graph.addNode('check', state => ({
      final: auditClaimTrail(state.input, state.first, state.draftOutput),
    }));
    graph.addEdge(START, 'extract').addEdge('extract', 'rewrite').addEdge('rewrite', 'check').addEdge('check', END);
  }

  if (spec.mode === 'checkpoint') {
    graph.addNode('prepare', async state => ({ first: await runNode('prepare', state.input) }));
    graph.addNode('finish', async state => {
      const chosen = spec.options.find(option => option.id === state.decision);
      if (!chosen) throw new Error('Select one of the listed choices.');
      record('Your choice', chosen.label);
      return { final: await runNode('finish', {
        ...source(state), assessment: state.first, choice: chosen.instruction,
      }) };
    });
    graph.addEdge(START, 'prepare').addEdge('prepare', 'finish').addEdge('finish', END);
  }

  if (spec.mode === 'adaptive') {
    graph.addNode('profile', async state => {
      const response = await runNode('profile', state.input);
      try {
        const roleProposal = readAgentProposal(response);
        record('Proposed assignment', briefText(roleProposal));
        return { roleProposal };
      } catch {
        return { stopped: 'The model did not return a usable assignment. Try a more specific task or another model.' };
      }
    });
    graph.addNode('execute', async state => {
      const approvedBrief = state.approvedBrief;
      if (!approvedBrief) throw new Error('Review the assignment before doing the task.');
      record('Approved assignment', briefText(approvedBrief));
      const draftOutput = await runNode('execute', { ...source(state), approvedBrief });
      return { draftOutput };
    });
    graph.addNode('review', async state => {
      await runNode('review', { ...source(state), approvedBrief: state.approvedBrief, draft: state.draftOutput });
      return { final: state.draftOutput };
    });
    graph.addEdge(START, 'profile');
    graph.addConditionalEdges('profile', state => state.roleProposal ? 'execute' : END, ['execute', END]);
    graph.addEdge('execute', 'review').addEdge('review', END);
  }

  function specialistJob(state) {
    const index = state.specialistRecords.length;
    const previous = state.specialistRecords.at(-1);
    const { stages, ...approvedBrief } = state.approvedBrief;
    return {
      number: index + 1,
      input: {
        ...source(state), approvedBrief, job: stages[index],
        previous: previous ? { role: previous.role, handoff: previous.handoff } : null,
      },
    };
  }

  function recordHandoff(state, output) {
    const number = state.specialistRecords.length + 1;
    record(`Specialist ${number} · ${output.role}`,
      [`Approach · ${output.approach}`, ...output.checks.map(check => `• ${check}`), '', output.handoff].join('\n'));
    return { specialistRecords: [...state.specialistRecords, output] };
  }

  if (orchestrated) {
    graph.addNode('plan', async state => {
      const response = await runNode('plan', state.input);
      try {
        const roleProposal = readAgentProposal(response, true);
        record('Proposed orchestrator and chain', briefText(roleProposal));
        return { roleProposal };
      } catch {
        return { stopped: 'The model did not return a usable chain. Try a more specific task or another model.' };
      }
    });
    graph.addNode('launch', state => {
      if (!state.approvedBrief) throw new Error('Review the chain before starting it.');
      record('Approved orchestrator and chain', briefText(state.approvedBrief));
      return { specialistRecords: [] };
    });
    if (subgraphs) {
      const specialist = new StateGraph(State)
        .addNode('shape_role', async state => {
          const { number, input } = specialistJob(state);
          const response = await runNode('shape', input, {
            modelRole: `specialist-${number}`, label: `Specialist ${number} · Design the role`,
          });
          try {
            return { specialistBrief: cleanSpecialistBrief(parseRecord(response)) };
          } catch {
            throw new Error(`Specialist ${number} did not return a usable brief. Completed work is in the run record.`);
          }
        })
        .addNode('do_work', async state => {
          const { number, input } = specialistJob(state);
          const specialistDraft = await runNode('work', { ...input, specialistBrief: state.specialistBrief }, {
            modelRole: `specialist-${number}`, label: `Specialist ${number} · Work in the ${state.specialistBrief.role} role`,
          });
          return { specialistDraft };
        })
        .addNode('check_handoff', state => {
          const { number } = specialistJob(state);
          signal.throwIfAborted();
          if (!state.specialistDraft.trim() || state.specialistDraft.length > 750) {
            throw new Error(`Specialist ${number} returned an empty or oversized handoff. Completed work is in the run record.`);
          }
          record('Specialist ' + number + ' · Handoff check',
            'The handoff has text and fits the 750-character limit. It can pass to the next node.');
          return recordHandoff(state, { ...state.specialistBrief, handoff: state.specialistDraft });
        })
        .addEdge(START, 'shape_role')
        .addEdge('shape_role', 'do_work')
        .addEdge('do_work', 'check_handoff')
        .addEdge('check_handoff', END)
        .compile({ checkpointer: false });

      graph.addNode('specialist', specialist);
    } else {
      graph.addNode('specialist', async state => {
        const { number, input } = specialistJob(state);
        const response = await runNode('specialist', input, {
          modelRole: `specialist-${number}`, label: `Specialist ${number} · Model response`,
        });
        let output;
        try {
          output = readSpecialistResult(response);
        } catch {
          throw new Error(`Specialist ${number} did not return a usable handoff. Completed work is in the run record.`);
        }
        return recordHandoff(state, output);
      });
    }
    graph.addNode('assemble', async state => ({
      final: await runNode('assemble', {
        ...source(state), approvedBrief: state.approvedBrief,
        handoffs: state.specialistRecords.map(({ role, handoff }) => ({ role, handoff })),
      }),
    }));
    graph.addEdge(START, 'plan');
    graph.addConditionalEdges('plan', state => state.roleProposal ? 'launch' : END, ['launch', END]);
    graph.addEdge('launch', 'specialist');
    graph.addConditionalEdges('specialist', state => state.specialistRecords.length < state.approvedBrief.stages.length
      ? 'specialist' : 'assemble', ['specialist', 'assemble']);
    graph.addEdge('assemble', END);
  }

  const resumeNode = orchestrated ? 'launch' : { checkpoint: 'finish', adaptive: 'execute' }[spec.mode];
  const compiled = graph.compile(resumeNode
    ? { checkpointer: new MemorySaver(), interruptBefore: [resumeNode] }
    : {});
  const config = { recursionLimit: 12, signal, configurable: { thread_id: 'experiment' } };

  return {
    async start(input, minutes, retained) {
      const state = { input, minutes };
      if (spec.mode === 'fork' && retained?.left && retained?.right) {
        state.leftOutput = retained.left;
        state.rightOutput = retained.right;
      } else if (spec.mode === 'revise' && retained?.draft) {
        state.draftOutput = retained.draft;
        state.passes = 1;
      }
      const result = await compiled.invoke(state, config);
      const paused = Boolean(resumeNode && (await compiled.getState(config)).next.includes(resumeNode));
      return { paused, result };
    },
    async resume(choice) {
      signal.throwIfAborted();
      if (spec.mode === 'adaptive' || orchestrated) {
        const snapshot = await compiled.getState(config);
        if (!snapshot.next.includes(resumeNode)) throw new Error('There is no assignment waiting for approval.');
        const brief = cleanAgentBrief(choice);
        const clarification = typeof choice.clarification === 'string' ? choice.clarification.trim() : '';
        if (clarification.length > 600) throw new Error('Keep extra context under 600 characters.');
        if (snapshot.values.roleProposal.question && !clarification) {
          throw new Error('Answer the clarifying question or state what is still unknown.');
        }
        const approvedBrief = {
          ...brief, clarification,
          ...(orchestrated && { stages: cleanStages(choice.stages) }),
        };
        await compiled.updateState(config, { approvedBrief }, orchestrated ? 'plan' : 'profile');
      } else {
        await compiled.updateState(config, { decision: choice }, 'prepare');
      }
      return compiled.invoke(null, config);
    },
  };
}
