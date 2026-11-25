# The ELI5 Handbook for Adiosbox

Adiosbox explained like you're five, then a little older. Read this first if the [Missing Manual](the-missing-manual.md) feels like too much at once.

## The one-sentence version

Adiosbox is a toy box of small AI experiments. Each toy shows you what it does before you play with it, and you only pay when you press **Run**.

## The big idea

Imagine a science fair. Every table has one experiment, a card that explains it, and a photo of what happened last time. You can read every card and look at every photo for free. If you want to try the experiment yourself, you bring your own batteries.

- **The tables** are experiments.
- **The card** is the description and the prompt you can peek at.
- **The photo** is the written sample: a real-looking result you can read without running anything.
- **The batteries** are your OpenRouter key. It pays for the AI model that does the work.

## The pieces, in kid words

| Word | What it means |
|---|---|
| **Model** | The AI brain that writes the answer. Some are free, some cost a little. |
| **OpenRouter** | The shop that lets you talk to many AI brains with one key. |
| **Key** | Your secret ticket for OpenRouter. Adiosbox keeps it on the page and forgets it when you reload. |
| **Prompt** | The instructions the brain gets. Open **Peek at the prompt** to read or change them. |
| **Input** | The stuff you give the brain to work on, like notes or a story. |
| **Call** | One question sent to a brain and one answer back. Each experiment says how many calls it can use. |
| **Shelf** | A group of experiments that do similar jobs, like "Check before you claim." |
| **Beer example** | A silly, friendly practice case for every experiment. Free to read. |
| **Canary** | A hard case built to trip the AI up. If the AI suddenly passes it, something got smarter. |
| **Brewery mishap** | A funny case where the brewery goes haywire, shaped like the beer example. Free to read. |

## What you can do

1. **Read.** Open any experiment and read its sample, beer example, canary, and brewery mishap. No key needed.
2. **Try.** Pick a model, load the sample or type your own input, and press **Run**.
3. **Compare.** Some experiments run two versions side by side. Highlights show lines that appear in only one answer.
4. **Chain.** Some experiments pass one answer into the next step, like a relay race.
5. **Branch.** Graph experiments split the work into paths, pick the best one, and sometimes stop to ask you before going on.
6. **Grade.** Lab experiments check the answer with code, using an answer key you can read and edit.
7. **Carry it forward.** **Use in another experiment** moves a result into a different experiment's input.
8. **Take it home.** Download a result as Markdown or HTML. The file includes the request that made it.

## The kinds of workbench

Think of these as four kinds of science-fair table.

- **Simple table.** One prompt, one answer. Some tables run prompt A and prompt B on the same input so you can see what one change does. Others run step 1, then step 2.
- **Graph table.** A little flowchart of AI helpers. One might sort the job, three might try different ideas, and one picks the winner. Some stop and wait for you to approve the plan.
- **Lab table.** A controlled test. It might hide which model wrote which answer until you score them, check quotes against the source, or run the same question three times and take a vote.
- **Canary table.** A lab table with a computed answer key. It only counts as "tripped" if the model gets it right three times in a row.

## When something breaks

AI services sometimes hiccup. Adiosbox tries to keep what already worked.

- **Free models** get up to two quiet retries per run.
- **Pick up** appears when a step fails partway through. It keeps the finished steps and only resends the broken ones, so you don't pay twice.
- **Cancel** stops a run. Clearing your key also stops every run on the page.
- **Call trace** in the header shows the last 20 questions and answers as raw data, with your key hidden.

If a run keeps failing, try a specific model instead of the free router, or shorten the input.

## Two ways to run it

**On the website.** You paste your key into the page. Your browser sends each question straight to OpenRouter. Nothing is saved: reload and the key, results, and notes are gone.

**On your own computer.** Run `npm start`. A small Python helper builds the site, keeps your key in a private `.env` file, and passes questions to OpenRouter for you. This mode adds **Save case**, **Saved cases**, and draft recovery, which keep setups in your browser so you can come back later. See the [README](../README.md#run-locally) for setup.

## Staying safe

- Your key never goes into a link, a saved case, a log, or the source code.
- A share link only points to the experiment, never to your input or results.
- AI answers are shown as plain text with light formatting. They can't run code on the page.
- Exports and copied traces can contain your inputs and prompts, so share them with care.

## How it works inside

For the slightly older five-year-old.

1. **Recipes.** Each experiment is a YAML file in [data/experiments](../data/experiments). Shelves live in [data/shelves.yaml](../data/shelves.yaml). Beer examples, canaries, and brewery mishaps live next to them.
2. **Baking.** Hugo reads the recipes and bakes one web page. Before baking, a checker makes sure every experiment has its samples, a valid shelf, and a call budget that matches its graph. A bad recipe stops the bake with a message.
3. **Rules in one place.** [assets/limits.json](../assets/limits.json) holds the shared limits: input and prompt length, token caps, and how many calls each graph may make. The page, the browser code, and the Python helper all read it.
4. **Browser code.** [assets/js/app.js](../assets/js/app.js) wires up every workbench. Hugo bundles it with its helper modules into one file. Graphs run on LangGraph in [assets/graph-runtime.js](../assets/graph-runtime.js), which loads the first time you run a graph.
5. **The local helper.** [scripts/playground.py](../scripts/playground.py) only listens on your own computer, only accepts the fields Adiosbox sends, and adds your key on the way out.
6. **The safety net.** `npm run check` bakes the site twice and runs the tests. It takes a few seconds.

## Add your own experiment

1. Copy an experiment YAML of the same kind and give it a new `slug`, `order`, and `shelf`.
2. Write the input, the prompt, and a sample result together.
3. Add a beer example, a canary, and a brewery mishap under the same slug.
4. Run `npm run check` and fix anything it names.

The [Missing Manual](the-missing-manual.md#add-an-experiment) has the full field list.

## Where to go next

- [Copy-and-paste examples](copy-paste-examples.md): a fresh, ready-to-paste input for every experiment.
- [The Missing Manual](the-missing-manual.md): the full walkthrough.
- [101 Ways to Use Adiosbox](101-ways-to-use-this-project-for-fun-and-profit.md): ideas for real work.
- [Canaries in the coal mine](canaries-in-the-coal-mine.md): how to run and log the hard cases.
- [Agent companies: where they stand](agent-companies-reality.md): the evidence behind the reality-check shelf.
