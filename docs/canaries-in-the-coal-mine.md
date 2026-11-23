# Canaries in the coal mine

A scored canary tests one capability on a fixed case. It trips when three complete replies from the same reported model match the key. Treat a trip as a signal to try a fresh case. Use evidence from the actual task to decide whether to start a supervised pilot.

The canaries live on the **Canaries in the coal mine** shelf. The table links open the local launcher. Hosted readers can find the same titles in the site catalog. The [Missing Manual](the-missing-manual.md#canaries-in-the-coal-mine) covers the mechanics.

## A canary on every workbench

Besides the shelf, every experiment has a **Canary** panel next to its beer example: a hard case aimed at where that technique breaks. Examples include a leap-year date for **Change one fact**, a weekday that doesn’t match its date for **The one-question gate**, and a schedule with zero slack for **Solve the dependencies first**. Each one shows a **Pass check** you can verify in the result and a line on **Why it’s hard today**. The cases live in [data/canary_examples.yaml](../data/canary_examples.yaml), and the build requires one for every experiment.

Most workbench canaries are read by a person, not graded by code. The pass check says exactly what to look for. Where a workbench grades its own output (schedule checks, ballots, placement, boundary, and schema reviews), the canary uses that grader and the answer fields loaded with the example. Log workbench canaries in the same table, with the experiment as the canary name.

## What each canary stands for

| Canary | Capability | Possible supervised follow-up |
| --- | --- | --- |
| [The unfamiliar puzzle](http://127.0.0.1:1313/#canary-unfamiliar-puzzle) | Solving the problem in front of it instead of recalling a famous one | Planning and scheduling problems that resemble familiar ones but aren't the same |
| [The long ledger](http://127.0.0.1:1313/#canary-the-long-ledger) | Exact state across a long sequence | Reconcile a sample of real ledgers against a calculator and the source records |
| [Say unknown](http://127.0.0.1:1313/#canary-say-unknown) | Calibration: answering when it can and abstaining when it can't | Grade answerable and unanswerable questions from a real support queue before sending replies |
| [The friendly con](http://127.0.0.1:1313/#canary-the-friendly-con) | Following policy under social pressure and injected instructions | Simulate capped front-desk decisions against documented authority and review every proposed action |
| [New-rule grids](http://127.0.0.1:1313/#canary-new-rule-grids) | Inferring a new rule from a few examples | Learning a house procedure from three worked examples instead of a written spec |

Use the follow-up to measure mistakes, review time, and the cases that still need a person.

## How to run one

1. **Pick a specific model ID.** Missing model identity, model or reported provider changes, and incomplete replies make the run inconclusive. The answer count remains visible.
2. **Run every case on the canary.** The cases differ on purpose. **Say unknown** includes an answerable case so that a model that always abstains can't trip it.
3. **Download the run record** before leaving. The download carries the grader revision, case ID, requested and reported model details, and attempts.
4. **Log the result** in the table at the end of this file: date, model and provider, case ID, revisions, verdict, and passes out of three.

Run the full shelf when a new frontier model or a major version ships. Between releases, one run a quarter catches quiet provider updates. That's 13 cases at 3 calls each, so 39 base calls per sweep. Any automatic free-model retries are additional.

## How to read a verdict

| You see | It means | Do this |
| --- | --- | --- |
| **Inconclusive** | The conditions or replies were incomplete or inconsistent. | Check the listed reason before rerunning. |
| **Not yet**, 0 of 3 | The model missed all three on this case. | Keep it as the baseline. |
| **Not yet**, 1 or 2 of 3 | The model can do it some of the time. This is where a capability starts to emerge. | Note it. Rerun on the next release. |
| **Tripped** once | It might be reliable, or it might be luck. | Run it again on another day. |
| **Tripped** on two separate runs | The model repeated the result on this case. | Try a fresh variant and collect evidence on a sample of the real work. |
| Tripped before, misses now | A regression, a different provider, or a changed model behind the same name | Check the reported model in the run record before you trust that skill again. |

Three replies make a smoke test. The table assumes independent attempts with the same underlying success rate.

| True success rate | Trips one run (3 of 3) | Trips two runs (6 of 6) |
| ---: | ---: | ---: |
| 80% | 51% | 26% |
| 95% | 86% | 74% |
| 99% | 97% | 94% |

A model that's right 80% of the time trips half of its single runs, which is why a single trip isn't enough to act on. It can still pass two runs about one time in four. Use fresh cases and real-task results to estimate how often the workflow needs intervention.

## Watching for a capability to emerge

Capabilities usually arrive in stages: never, then sometimes, then usually, then reliably. The log shows that progression if you keep it the same way every time.

- **Watch the miss count fall.** A canary moving from 0 of 3 to 2 of 3 across releases is the early warning. Plan the pilot before it trips.
- **Compare model tiers.** When a small, cheap model trips a canary that a frontier model tripped a year earlier, the capability has become cheap. That's often when delegating it starts to pay off.
- **Keep the conditions fixed.** Same prompt, same cases, and no tools. If you change the prompt, start a new row in the log so the change can't look like progress.

## Keeping canaries honest

- **Assume the published cases will leak.** The site is public, so the cases and keys may end up in training data. A canary that suddenly trips at 3 of 3 with no gradual climb deserves suspicion. Write a fresh variant with a new key and run that. Record the fresh variant separately so repeat performance on a published case stays visible.
- **Compute every key with code.** Use search for puzzles, a replay for ledgers, and the rule's own function for grids. Never use a model's answer as the key. That would mean measuring models against a model.
- **Retire canaries that keep tripping and add harder ones.** Once a canary has tripped across several releases and model tiers, it has done its job. Raise the bar in the same area: a longer ledger, a two-rule grid, a con spread across several messages. Leave the old canary on the shelf as a regression check.
- **Keep each canary narrow.** One capability, one answer key, and a JSON `answer` field. Anything that needs a human to judge "good" belongs on another shelf.

## Making fresh cases

[scripts/canary-keys.py](../scripts/canary-keys.py) computes numerical and grid keys and checks the stated facts behind the policy and abstention keys. It uses only the Python standard library. Each command prints a case, or a key you can paste into a new `cases:` entry.

```bash
python3 scripts/canary-keys.py check
```

```bash
python3 scripts/canary-keys.py bridge 1,3,4,6,9 --forbid 1,5
```

```bash
python3 scripts/canary-keys.py jugs 5,8,13 --target 4
```

```bash
python3 scripts/canary-keys.py ledger --seed 42 --entries 160
```

```bash
python3 scripts/canary-keys.py grid gravity --seed 42
```

- `check` exercises the generators. `npm run check` also verifies the input and key pairs rendered from the shipped catalog, including the two additional examples on each scored canary workbench.
- `bridge` takes each person's crossing time. `--forbid` takes two 1-based positions that refuse to cross together, and you can repeat it.
- `jugs` takes the jug sizes and a target amount. It counts fill, empty, and pour as one step each.
- `ledger` prints a register log, its key, and the character count. A case can be up to 3,000 characters.
- `grid` takes the `gravity` or `rays` rule and prints three examples, a test grid, and its key.

A new seed gives a fresh variant with the same difficulty. That's the quickest way to check whether a sudden trip is real. For a new rule or puzzle type, add the solver or fixture rule, then give the case a stable ID and the computed answer.

## Canaries worth adding next

These skills come from the gaps in [Agent companies: where they stand](agent-companies-reality.md):

- **Pressure across several turns.** The friendly con repeated over several messages. Real shop agents gave way gradually, not on the first ask.
- **Asking the deciding question.** A brief with one missing fact, where the answer is the question that resolves it. Grade it with the cue check the boundary technique uses.
- **Keeping a secret.** A record holds a private field and the customer asks for it politely. Benchmarks found near-zero confidentiality awareness.
- **Long-horizon consistency.** The same ledger split across a handoff, where a second call has to continue from the first call's state.

## Log

| Date | Model and provider | Canary / case ID | Experiment and grader revisions | Verdict | Passes |
| --- | --- | --- | --- | --- | ---: |
| | | | | | |
