# The Missing Manual for Adiosbox

Adiosbox is a workbench for rough notes, draft claims, decisions, rules, and plans. Pick an experiment that gives you something you can inspect, such as a source-backed sentence, a boundary test, or the first action someone could safely take.

This manual covers the 43 experiments in the current checkout. A hosted copy reflects the version last deployed.

## Start with one run

1. Open the [local catalog](http://127.0.0.1:1313/#experiments). It groups the experiments onto seven shelves by what you’re trying to do, and each card says roughly how many calls it uses. **New here?** offers three first picks. You could also start with **Rough notes to next steps** for a quick win or **Evidence audit** if you want to see how the workbench handles uncertainty.
2. Read the prefilled input and the worked example. The sample gives you a concrete idea of what the experiment asks for. You can read the whole catalog without an API key.
3. Pick a model under **Your setup**. The **Model** field searches by name or ID, and you can paste a full OpenRouter ID. **Use free router** returns to the default. Selecting a paid model can use your OpenRouter credits when you run it.
4. Use the sample or paste your own input. Select **Run it**, **Run both steps**, or **Run the graph**, depending on the workbench. A graph lists its maximum call count beside the run button. On a free model, a run can also send up to two automatic retries.
5. Find one line you could verify or act on. If it introduces a new fact, check it against the input before using it. Open **More** beside a result, a graph or lab step, or a run record to download it as a web page or as Markdown before you rerun or refresh. **Download both results** saves a paired run. HTML opens offline in a browser. Markdown is editable in a text editor.

**Call trace** in the page header shows the exact JSON for the last 20 OpenRouter requests and responses on this page, prompts and replies included. The key is redacted. Use **Copy JSON** when you want to see why a call failed or what a model actually received. The trace clears when you clear the key, select **Clear trace**, or leave the page.

You can keep one tab open and move among experiments. The main model selection follows you. A workbench can override it for specific prompts, steps, or graph roles. **Copy link** shares the workbench address, including its anchor. The person who opens it sees the built-in sample.

## Run locally with a saved key

Install the pinned dependencies once from the repository folder. The project uses Hugo 0.168.0, Node.js 22, and Python 3. See the [project README](../README.md) for setup and hosting details.

```sh
npm ci --ignore-scripts
```

Add `OPENROUTER_API_KEY=YOUR_KEY` to a private `.env` file in the repository root. The launcher reads the key at startup. Keep the file private and use a dedicated OpenRouter key if you want to track or cap playground spending.

```sh
npm start
```

`npm start` runs `python3 scripts/playground.py`. Open the [local playground](http://127.0.0.1:1313/). The launcher keeps your key in the local Python process and sends it to OpenRouter when you run an experiment. With the hosted visitor form, the browser sends the visitor’s own key and prompt directly to OpenRouter. The model catalog lookup uses the public model list without sending a key. Review anything sensitive in the input before you run it, including pasted source excerpts and handoff notes.

The launcher builds a snapshot at startup. After a source edit or a key change, stop it with **Ctrl+C** and run the launcher again. Refresh the page to see the new build. Copy any draft or result you want to keep before a refresh. For the hosted visitor flow, enter a key once under **Your setup** and select **Clear** when you’re done.

## Choose the workbench that fits the question

### Single runs and a paired comparison

Start here when you have a specific input and want one artifact back. Open **Peek at the prompt** to see what the model was asked to do.

| Experiment | Bring | Check before using the result |
| --- | --- | --- |
| [Competing explanations](http://127.0.0.1:1313/#competing-explanations) | An observed change and your leading explanation | The proposed check could favor one explanation over another. Look for predictions that differ. |
| [Evidence audit](http://127.0.0.1:1313/#evidence-audit) | One claim with labeled source excerpts | Quotes match the excerpts. Counts, rates, timing, and causation get separate treatment. |
| [Break the metric](http://127.0.0.1:1313/#break-the-metric) | A goal and the number you plan to track | The examples show a real cost to people or the work. The companion measure would catch at least one failure. |
| [Rough notes to next steps](http://127.0.0.1:1313/#rough-notes) | A messy note or voice transcript | Owners and dates come from the notes. The suggested first action is small and concrete. |
| [Prompt control group](http://127.0.0.1:1313/#prompt-control-group) | One input and two prompts with a deliberate difference | Both results used the same input and, when reported, the same responding model. Repeat to see if the difference holds. |
| [Rubric reversal](http://127.0.0.1:1313/#rubric-reversal) | Two options, a decision, and any hard constraints | Each priority explains its own winner. Either ranking can stay the same if the facts support it. |
| [Handoff fire drill](http://127.0.0.1:1313/#handoff-fire-drill) | The exact note someone will receive | The first action can be taken with what the note names. Add a source link or permission detail where they would otherwise have to guess. |
| [Change one fact](http://127.0.0.1:1313/#change-one-fact) | A scenario with one replaceable fact and a decision you can check | Both decisions match your expectations and the chosen detail survives both runs. |
| [Rule under pressure](http://127.0.0.1:1313/#rule-under-pressure) | A proposed rule, its purpose, and an ordinary case | Replay the ordinary case and both edge cases against the rewrite. Check who still needs to make a judgment. |

**Prompt control group** sends one request per button. Run A and B separately. For a clean comparison, change one instruction and hold the input and model selection fixed. Open **Pick a model for each prompt** to run A and B on different OpenRouter models. Keep the prompts identical if you are comparing models, or keep the model fixed if you are comparing prompts. The workbench flags different inputs, model selections, or reported responding models. Even with a matched pair, model responses can vary from run to run.

### Two-step chains

Use a chain when producing a good answer takes two different kinds of work. Step 2 receives both your original input and the actual text produced by step 1. You can edit both prompts before running and inspect or copy both outputs afterward. Open **Pick a model for each step** to choose a model for each step. A blank field uses the main model. A chain sends up to two sequential requests. If the first result reaches its output limit, the chain stops there. If step 2 fails, the intermediate result stays available.

| Experiment | First step | Second step |
| --- | --- | --- |
| [Pre-mortem with tripwires](http://127.0.0.1:1313/#pre-mortem-tripwires) | Map plausible failure paths | Turn early signs into checks with a time, trigger, owner, and response. |
| [Constraint switch](http://127.0.0.1:1313/#constraint-switch) | Identify outcomes a workflow needs to preserve | Redesign for one new constraint and say what gets saved at each stopping point. |
| [Disagreement compiler](http://127.0.0.1:1313/#disagreement-compiler) | Reconstruct each side’s strongest stated case | Separate a factual crux from a value trade-off and suggest a reversible next step. |
| [Undo plan](http://127.0.0.1:1313/#undo-plan) | Map commitments and dependencies | Design a trial, a stop condition, and a way to recover records and resume the previous process. |
| [Examples to acceptance tests](http://127.0.0.1:1313/#examples-to-acceptance-tests) | Infer candidate rules and find an unsettled boundary | Write Given/When/Then cases. Mark outcomes that still need a decision. |
| [Transfer without the jargon](http://127.0.0.1:1313/#transfer-without-the-jargon) | Describe why a technique works | Design a small trial in another domain and name a result that would count against the transfer. |
| [Practice the interruption](http://127.0.0.1:1313/#practice-the-interruption) | Find where a reasonable listener would interrupt | Rehearse the interruption, a candid answer, and the sentence that returns to the decision. |
| [Salvage and recombine](http://127.0.0.1:1313/#salvage-and-recombine) | Inventory reusable parts and the facts you still need | Assemble a small draft with source labels and placeholders where details are missing. |

When a chain gives a weak answer, start with the intermediate result. If it lost a hard constraint, fix the input or first prompt. If the intermediate result is sound and the next step treats a hypothesis as fact, tighten the second prompt.

### LangGraph experiments

Use a graph when the next action depends on what happens during the run. Open **How this graph thinks** to read its node prompts. Open **Pick a model for each role** to choose which OpenRouter model handles each model node. Leave a role blank to inherit the main model. The graph keeps the selections it started with through any pause or retry within that run. The **Run record** shows completed nodes, their outputs, model information, and the decisions the graph recorded. Parallel branches can appear in either completion order. A checkpoint waits in the current tab for your choice. Select **Stop here** to end at the checkpoint, or make a choice to spend one more request. Copy the record before refreshing if you want to keep it.

| Experiment | How it decides what happens next | Max requests |
| --- | --- | ---: |
| [Claim release gate](http://127.0.0.1:1313/#claim-release-gate) | The model picks keep, narrow, or hold. A missing or invalid routing decision stops the graph. | 2 |
| [The one-question gate](http://127.0.0.1:1313/#the-one-question-gate) | A usable brief goes to drafting. A material gap goes to a single question. A brief with no usable goal stops. | 2 |
| [Teachback loop](http://127.0.0.1:1313/#teachback-loop) | A simulated learner reviews the explanation. One revision is allowed, followed by one more review. | 4 |
| [Make the minutes add up](http://127.0.0.1:1313/#minutes-have-to-add-up) | Code checks whole-minute estimates and adds them. A malformed or over-budget plan gets one correction. | 2 |
| [The invisible queue](http://127.0.0.1:1313/#the-invisible-queue) | Two parallel readings look at access and operations. A third node proposes a way to count an event that’s missing from the reports. | 3 |
| [The regression you’d miss](http://127.0.0.1:1313/#the-regression-you-would-miss) | One branch looks for gains and one for existing behaviors worth preserving. The merge writes a check for each. | 3 |
| [Choose what to protect](http://127.0.0.1:1313/#choose-what-to-protect) | The graph assesses the trade-off and pauses. Your choice tells the planning node which interest to protect first. | 2 |
| [Release or rehearse](http://127.0.0.1:1313/#release-or-rehearse) | The graph assesses readiness and pauses. Choose conditional release checks or a rehearsal that would close an evidence gap. | 2 |
| [Shapeshifting agent](http://127.0.0.1:1313/#shapeshifting-agent) | A model proposes a role, approach, and success checks. Edit the assignment at the checkpoint, then get a draft and a separate review against those checks. | 3 |
| [Shapeshifting orchestrator](http://127.0.0.1:1313/#shapeshifting-orchestrator) | An orchestrator proposes its own role and two or three ordered jobs. Each specialist adapts to its job and the previous handoff, then the orchestrator assembles and checks the result. | 5 |
| [LangGraph shapeshifting chain](http://127.0.0.1:1313/#langgraph-shapeshifting-chain) | Each specialist runs as a nested graph that designs a role, does the job, and checks the handoff before the next job starts. | 8 |

### Tree of Thought experiments

These graphs search before they commit. Three branches attempt the task in parallel, each from a different angle. A prune node compares them against your input and keeps one. Two child nodes then develop the survivor in parallel, and a finish node picks between them and writes the deliverable. The **Search decision** entry names the kept branch, the pruned ones, and the reason.

| Experiment | What the three branches try | Max requests |
| --- | --- | ---: |
| [The Last Ferry Before Dawn](http://127.0.0.1:1313/#the-last-ferry-before-dawn) | Deadline-first, access-first, and capacity-first boarding policies | 7 |
| [The Museum of the Missing Hour](http://127.0.0.1:1313/#the-museum-of-the-missing-hour) | A clock mechanism, a recording mix-up, and an observation mix-up | 7 |
| [The Long-Lost Broadcast](http://127.0.0.1:1313/#the-long-lost-broadcast) | Live, replay, and two-different-events timelines | 7 |
| [The Festival With One Pair of Hands](http://127.0.0.1:1313/#the-festival-with-one-pair-of-hands) | A minimal premiere, an editorial showcase, and extra verification | 7 |

If the prune node returns stop or malformed routing data, the graph ends after four requests and records why. Check the arithmetic in the final card yourself. The samples were checked by hand, but a live model can still miscount.

Read the record according to who made the judgment. A model routing reason is a claim you can check. A code check can verify that minutes add up, while the estimates still need your judgment. A simulated teachback can surface a confusing explanation. A real learner can show whether it works for the intended audience.

### Shape an agent for a task

Give [Shapeshifting agent](http://127.0.0.1:1313/#shapeshifting-agent) the task, the material to work from, and the audience. Select **Propose an agent**. Edit the proposed role, deliverable, approach, and success checks. A useful check names something you can point to in the answer, such as one exact quote or a table that accounts for every item in a source list.

If the agent asks a question, answer it or explain what is still unknown. Select **Use this assignment** to produce the draft and review, or **Stop here** to keep the proposal. **Pick a model for each role** lets you choose different models to design the role, do the work, and review it. The review gives you a second model judgment you can check against the source and the approved assignment.

### Shape a chain of agents

Open [Shapeshifting orchestrator](http://127.0.0.1:1313/#shapeshifting-orchestrator) when a task needs several different kinds of work. **Propose a chain** makes one request. Edit the orchestrator’s role, the final deliverable, and two or three ordered specialist jobs at the checkpoint. Name the handoff you want from each job so the next specialist has something specific to work with.

**Run this chain** starts the approved plan. Each specialist receives the original task and the previous handoff, chooses a role, and produces a result for the next stage. The final orchestrator gets all handoffs in order and checks the assembled artifact against the criteria you approved. The run record shows each actual role and handoff. Under **Pick a model for each role**, you can give the planner, each specialist slot, and final assembler different model IDs. A two-specialist run uses four requests total. A three-specialist run uses five.

The [LangGraph shapeshifting chain](http://127.0.0.1:1313/#langgraph-shapeshifting-chain) has the same approval workflow. Inside each specialist subgraph, one node proposes a role and another does the work in that role. A code node checks that the handoff has text and fits its length limit. The record shows these steps individually. A full run uses six requests for two specialists or eight for three.

## Change one fact and save the case

Start with the cancellation example in **Change one fact**. The shared scenario has one `{{fact}}` marker. The baseline says **24 hours** and should get full credit. The changed case says **23 hours and 59 minutes** and should get no credit. Both answers should keep `Mina | R184`. The prompt tells the model which decision wording and invariant to return. The expectation fields stay in the workbench for code to check afterward.

1. Write the shared scenario and mark the one fact that varies. Enter both fact values.
2. Enter the two decisions you expect and one piece of information that should be identical in both answers.
3. Choose a specific model and select **Run both versions**. Compare the answers and the three checks. If a router used two different responding models, the workbench flags that difference.
4. Select **Save case** in the local workbench to keep the setup. Give it a name you’ll recognize later, such as “Cancellation exactly at the cutoff.”

The local **Saved cases** panel reopens the input, editable prompts, main model, role models, and any fact-test expectations. A saved graph records the revision it came from. After a revision changes, the workbench flags the difference before you rerun the current graph. Saving an unchanged setup after a completed fact test also keeps its three check outcomes. Reopen the case and rerun it with the same scenario and expectations to see which checks improved or regressed. Copy the full model outputs separately if you want them alongside the saved checks.

Cases live in this browser on this device. Use **Export cases** to make a JSON backup and **Import cases** to bring it back. Exported files contain the inputs and can include whatever private material you included in a case.

## Comparison lab

Use these workbenches to vary one part of a run and see what happens downstream. Most of them sit on the **Put the AI on trial** shelf. Each workbench shows a written sample before it makes any requests.

| Experiment | What to try | Requests |
| --- | --- | ---: |
| [Repair one graph step](http://127.0.0.1:1313/#repair-one-graph-step) | Build the original fork. Correct either finding and rerun the merge. Compare the original and revised merges in the same record. The edited run uses the original input, the other finding, and the original merge model selection. | Up to 3, then 1 per repair |
| [Follow the claim](http://127.0.0.1:1313/#follow-the-claim) | Paste labeled excerpts. Look for quotes that survived from extraction to rewrite, appeared for the first time in the rewrite, or could not be found in the named excerpt. Read the quote in context to judge the claim. | Up to 2 |
| [Blind model comparison](http://127.0.0.1:1313/#blind-model-comparison) | Choose two models and write your scoring criteria first. Give each answer a score from 0 to 5. Optionally swap the positions and rate again, then reveal the models and the scores attached to each answer. | Up to 2 |
| [Know when to stop](http://127.0.0.1:1313/#know-when-to-stop) | Run the One-question gate with a deciding fact and then with the fact missing. Use a comma-separated list for the words a useful question should contain. Compare the graph’s actual routes and the question it asks. | Up to 4 |
| [What does the better model buy?](http://127.0.0.1:1313/#what-does-the-better-model-buy) | Pick one writer and two reviewers. Each reviewer starts from the same generated first draft. Compare which issues they found, how many revisions followed, elapsed time, and the tokens and cost reported by OpenRouter. | Up to 7 |
| [Cold restart](http://127.0.0.1:1313/#cold-restart) | Write a handoff and three expected phrases. Save the case locally. Open it from **Saved cases** in a fresh tab or after a reload, then recover the next action, source, and open decision from the handoff. Check paraphrases by reading the expected meaning. | 0 |

Keep the exact input fixed when you compare reviewers or repair a graph.

## Prompting techniques

Each of these workbenches isolates one prompting technique and grades the replies in code against an answer key you can edit. Pick a sample case from **Sample case** and select **Use this case**. Open **Peek at the prompt** to read the exact prompt and any example sets. Leave the model field blank to use the main model. For a controlled comparison, choose one specific model. The free router can switch models between calls, and the record says when that happened.

| Experiment | What changes between calls | Code checks | Requests |
| --- | --- | --- | ---: |
| [Teach by the Boundary](http://127.0.0.1:1313/#teach-by-the-boundary) | Two ordinary examples, or two that straddle the decision | Decision, and whether the question names the deciding phrase | 2 |
| [Bury the Deciding Fact](http://127.0.0.1:1313/#bury-the-deciding-fact) | The decisive excerpt sits in the middle of the packet, then at the end | Label and cited source ID | 2 |
| [Solve the Dependencies First](http://127.0.0.1:1313/#solve-the-dependencies-first) | One-pass scheduling, then a dependency map followed by scheduling | Deadline, prerequisites, and shared resources | 3 |
| [Three Answers, One Ballot](http://127.0.0.1:1313/#three-answers-one-ballot) | One answer, then a majority of three | First answer and majority against the key, plus reported usage | 3 |
| [Can the Graph Read the Reply?](http://127.0.0.1:1313/#can-the-graph-read-the-reply) | The Teachback reviewer prompt alone, then with an enforced JSON schema | Usable route and reason, exact two-field JSON, expected route | 2 |

**Can the Graph Read the Reply?** pins both calls to one OpenRouter provider so the only difference is the schema. Enter the provider slug and choose a specific model that supports structured output. Its preselected reviewer is a paid model. Replace it before running if you want to avoid charges. A requested router may choose different responding models, so inspect the model labels in the record. The reported totals include the responses that supply usage data. Where part of the usage is missing, the record shows the coverage.

## Combine experiments

Open **More** beside a result and select **Use in another experiment**. Under a graph or lab step, **More** offers **Use this step in another experiment**, and the run record’s **More** offers **Use the whole record in another experiment**. Choose the next workbench and edit the text you want to carry forward. The next experiment opens with that text in its input so you can review it before running.

If the destination already has a draft, **Add to the existing input** is selected by default. That lets you bring over two results, such as both sides of a prompt comparison. If the pair is too long for the destination, the dialog asks you to shorten it before transferring. A fresh workbench starts with the transferred text in place of the sample.

Try **Evidence audit → Claim release gate**. Start by pasting your claim and excerpts into the gate. Run the audit and use its output in the gate. Keep **Add to the existing input** selected so the gate still has your original evidence alongside the audit’s findings.

## Three ways to use the box on real work

**Find the smallest useful next action.** Dictate what happened and run **Rough notes to next steps**. Pick one action from the output. If someone else needs to pick up the work, put your handoff through **Handoff fire drill**. The saved result can be as short as a source link, the next safe action, and the decision still open.

**Test a change before it becomes expensive to undo.** Use **The regression you’d miss** to identify a task someone must still be able to do after a change. Take that check into **Release or rehearse** and choose a rehearsal when you still need evidence. Write down what the person should be able to find, do, or recover and what would make you stop.

**Keep facts intact as you edit.** Give **Evidence audit** the claim and only the relevant, labeled excerpts. Check the exact sentence you plan to use. If you want to see whether a stricter instruction helps, use **Prompt control group** with the same input and change only the instruction about source evidence. Save one example where the prompt helped and one where it broke.

## When a run goes sideways

| What you see | What to do |
| --- | --- |
| The local catalog is missing experiments you just added | Restart the local launcher so Hugo can rebuild the snapshot. Refresh your tab. |
| The visitor form appears when you expected your saved key | Open the URL printed by `python3 scripts/playground.py`. The plain Hugo preview uses the visitor form. |
| A key is rejected | Locally, update `.env` and restart the launcher. On the hosted site, reopen **OpenRouter connection** and check the key you entered. |
| Model suggestions are unavailable | Paste a full model ID or select **Use free router**. |
| The model is rate-limited, unavailable, or returns an empty reply | A free model (the free router or any `:free` ID) retries rate limits, provider outages, dropped connections, and empty replies automatically. A run gets at most two retries in total, on top of the request counts listed for each workbench, and the run’s timeout covers the waits. Each attempt appears in **Call trace**, where `state` is the HTTP result and `outcome` says how the completion ended. A rejected key, a refusal, a malformed reply, or an answer cut off at its token limit stops at once. A paid model never retries on its own. Free models, including the free router, and both NVIDIA Nemotron 3.5 Super VL IDs send a 1,024-token reasoning cap and allow a 4,096-token reply. Without the cap, a reasoning model can spend the whole budget thinking and return nothing. A free model pinned to a provider keeps the standard 2,048-token ceiling. If a reply still runs out of room, choose another model. Review the model selection before retrying a paid request. |
| A graph or chain step fails partway through | Finished steps are kept. A graph shows **Pick up where it stopped**: choose a different model for the rest of the run, or leave it blank to try the same one, then select **Pick up from here**. Only the unfinished steps run again. A chain or fact test shows **Pick up at step 2**, which reruns step 2 with step 1’s result and the current step 2 prompt and model. Editing the input or step 1 clears the pick-up. |
| A graph stops after a routing decision | Read the raw node output and the recorded reason. A missing fact may be the result you needed. If the model returned malformed control data, try a specific model and a shorter input. |
| A handoff exceeds the input limit | Keep the decisive excerpts, constraints, or examples. Shortening the original material makes room for the intermediate result. |
| A run fails and the message quotes OpenRouter, such as a model not found | The model ID may have been retired. Choose another model or select **Use free router**. **Call trace** shows the full response. |
| A result ends mid-sentence | Copy any usable partial output. Ask for a shorter result where you can edit the prompt, or reduce the input and rerun. |

## Add an experiment

The catalog comes from [the experiment YAML files](../data/experiments/). Give a new entry a unique, stable `slug`. Its anchor is part of its share link. Start with an ordinary case and a result a reader can check by hand.

- **One run or A/B.** Use [Rough notes](../data/experiments/rough-notes.yaml) or [Prompt control group](../data/experiments/prompt-control-group.yaml) as the closest example. In an A/B sample, change one instruction so someone can see what they’re testing.
- **Two steps.** Use [Constraint switch](../data/experiments/constraint-switch.yaml). Make the intermediate artifact worth reading on its own. The second prompt receives JSON fields `originalInput` and `stepOne`.
- **Tree of Thought.** Use `graph.mode: tree` with node keys `branchA`, `branchB`, `branchC`, `prune`, `childA`, `childB`, and `finish`, plus `maxRequests: 7`. The prune prompt must return JSON with `route` set to a branch key or `stop`. [The Last Ferry Before Dawn](../data/experiments/the-last-ferry-before-dawn.yaml) is the closest example.
- **Prompting technique.** Use `lab.mode: prompt` with a `technique` the [prompt experiment module](../static/prompt-experiments.js) grades: `boundary`, `placement`, `dependencies`, `ballot`, or `schema`. Give it a `comparison` role, the answer-key `fields` (mark a field `optional: true` if it can be blank), and two or more `cases` with an `input` and field values. The first case fills the workbench.
- **Graph.** Pick a mode already defined in the [LangGraph runtime](../assets/graph-runtime.js). Match the node keys to an existing experiment in that mode and keep the displayed request limit aligned with the runtime. For a new route or stop decision, check both the ordinary case and the failure case before relying on it.

Give each new entry a `shelf:` from [data/shelves.yaml](../data/shelves.yaml). Results lay themselves out from their structure: bold section labels become cards, `Label · text` lines become labeled cards, `Supported —` lines get verdict badges, pipe rows become a table, a JSON object becomes labeled fields, a `Name: line` exchange becomes a dialogue, and Given/When/Then tests get their keywords marked. Name the sections in the prompt so live replies match the sample. An optional `layout:` block sets the emphasis: `lead`, `pin`, `takeaway`, `spread` (a section's bullets as side-by-side cards), `checklist`, `group` (sections with a shared prefix in a row), `grid`, `winners`, `columns`, `fields`, `headline`, and `tones` (good, warn, ask, act, decide). Anything the layout doesn't recognize falls back to formatted Markdown.

Write the sample output yourself and check every number, quote, and implied outcome. Run `npm run check` after editing the catalog. It builds the site and confirms that each graph's displayed request limit matches the runtime. In the local playground, open the new anchor and try the shortest ordinary case you can reproduce. A useful graph also deserves a case that exercises its stop, correction, or checkpoint path.
