const marker = '{{fact}}';
const checkLabels = ['Baseline decision', 'Changed decision', 'Invariant in both answers'];

export function sameFactScenario(saved, current) {
  const keys = ['notes', 'fact:baseline', 'fact:changed', 'fact:baseline-decision',
    'fact:changed-decision', 'fact:invariant'];
  return keys.every(key => saved[key] === current[key]);
}

export function compareFactChecks(saved, current) {
  const improved = checkLabels.filter((_, index) => !saved[index] && current[index]);
  const regressed = checkLabels.filter((_, index) => saved[index] && !current[index]);
  if (!improved.length && !regressed.length) return 'All three check outcomes match the saved run.';
  return [
    improved.length && `Improved · ${improved.join(', ')}`,
    regressed.length && `Regressed · ${regressed.join(', ')}`,
  ].filter(Boolean).join('\n');
}

export function prepareFactInputs(scenario, baseline, changed) {
  const parts = scenario.split(marker);
  if (parts.length !== 2) throw new Error('Put exactly one {{fact}} marker in the shared scenario.');
  if (!baseline.trim() || !changed.trim()) throw new Error('Enter both versions of the fact.');
  if (baseline.trim() === changed.trim()) throw new Error('Give the two versions different facts.');
  return [baseline, changed].map(fact => parts.join(fact.trim()));
}

function parseFactResult(text) {
  try {
    const value = JSON.parse(text.trim().replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/gi, ''));
    if (typeof value?.decision === 'string' && value.decision.trim() &&
        typeof value?.invariant === 'string' && value.invariant.trim()) return value;
  } catch {
    // A malformed response cannot be checked.
  }
  return null;
}

const normalizedDecision = value => value.trim().toLowerCase().replace(/\s+/g, ' ');
// Identifiers in an invariant can be case-sensitive, so only spacing is forgiven.
const normalizedInvariant = value => value.trim().replace(/\s+/g, ' ');

export function checkFactPair(expectations, baseline, changed) {
  if (baseline.truncated || changed.truncated) {
    return { verdict: 'Incomplete', text: 'At least one answer reached the output limit. The pair could not be checked.' };
  }
  const left = parseFactResult(baseline.content);
  const right = parseFactResult(changed.content);
  if (!left || !right) {
    return { verdict: 'Incomplete', text: 'Both answers need JSON with a decision and an invariant before the checks can run.' };
  }
  const checks = [
    normalizedDecision(left.decision) === normalizedDecision(expectations.baseline),
    normalizedDecision(right.decision) === normalizedDecision(expectations.changed),
    [left, right].every(answer => normalizedInvariant(answer.invariant) === normalizedInvariant(expectations.invariant)),
  ];
  const passed = checks.filter(Boolean).length;
  const text = checks.map((pass, index) => `${checkLabels[index]} · ${pass ? 'Pass' : 'Fail'}`).join('\n');
  return { verdict: `${passed} of ${checks.length} checks passed`, text, checks };
}
