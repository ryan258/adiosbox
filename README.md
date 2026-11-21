# Adiosbox

Ryan's AI playground has 43 experiments on seven shelves. Try a single prompt, compare two prompts or facts, run a two-step chain, or follow a branching LangGraph run. Every experiment has a share link and a written sample you can read without a key. Beside each Run button you can see the model picks and base call budget. Free models can send up to two additional automatic retries per run.

Start with [The Missing Manual](docs/the-missing-manual.md) for a walkthrough or [101 Ways to Use Adiosbox](docs/101-ways-to-use-this-project-for-fun-and-profit.md) for ideas.

## Run locally

Use Hugo 0.168.0, Python 3, and Node.js 22. Install the pinned browser dependency once from this folder:

```sh
npm ci --ignore-scripts
```

Create a private `.env` if you don't have one:

```sh
(umask 077 && touch .env)
```

Put your key on the `OPENROUTER_API_KEY=` line in `.env`, then start the playground:

```sh
npm start
```

`npm start` runs `python3 scripts/playground.py`.

Open [the local playground](http://127.0.0.1:1313/#experiments), pick a model, and run an example. The launcher redirects `localhost:1313` to `127.0.0.1:1313`. It builds on startup and reads the key once, so restart it after editing either the site or `.env`. Press Ctrl+C to stop. The launcher listens only on loopback and sends the key to OpenRouter from the local Python process. Keep `.env` private. Git ignores it and Hugo publishes only generated site files.

For the public visitor preview, use `hugo server --disableLiveReload` and open [the visitor preview](http://localhost:1313/#experiments). Hugo rebuilds after edits. Refresh the page to see them. Stop the local launcher first so the port is free. Hugo validates the catalog from [data/experiments](data/experiments) at build time. Each experiment's unique `slug` is its share-link anchor. Run `npm run check` for the strict Hugo build, rendered sample checks, and tests. The test suite uses Python 3 for the launcher request contract and rendered HTML checks.

## Keep a case

In the local launcher, **Save case** keeps inputs, model picks, and prompt edits in your browser. Open **Saved cases** to restore or back up a setup. When you edit an open case, you can update it or save a copy. Enable draft recovery there to keep the most recently edited workbench setup between sessions. The graph checkpoint and approved brief live in the tab. Export the results you want to keep, along with their request and outcome details.

## Comparison lab

The comparison lab covers fork repair, evidence tracing, blind model ratings, paired stop tests, reviewer comparisons, and a cold restart drill. Usage totals describe the replies that reported usage. The request details in a result export show which model and endpoint the app requested and what OpenRouter reported.

## Prompting techniques

Five lab workbenches test one prompting technique each: boundary examples, fact placement, dependency-first scheduling, a three-vote ballot, and schema-enforced JSON. Each has several sample cases and shows its full prompt under **Peek at the prompt**. Code grades every reply against an answer key you can edit. A blank model field uses the main model. For a controlled comparison, choose one specific model so every call goes to the same model.

## Call trace

**Call trace** in the page header shows up to 20 recent requests and responses as JSON, including prompts, replies, retries, and completion outcomes. Blind comparison calls appear after reveal. The key is redacted. The trace lives in page memory and clears with **Clear**, **Clear trace**, or when you leave the page.

## OpenRouter in hosted builds

GitHub Pages and Cloudflare Pages show a visitor key field. A run sends the visitor's key and the two text fields straight to OpenRouter. The visitor can reuse the key until the page is reloaded or the key is cleared. The site uses no persistent browser storage for keys, notes, or results.

The model picker uses the public OpenRouter catalog and accepts a full model ID by paste. It defaults to the [OpenRouter free model router](https://openrouter.ai/openrouter/free), subject to availability and rate limits. A share link includes only the page address and experiment anchor.

## GitHub Pages staging

Keep the source in `ryan258/adiosbox`. In the repository, set **Settings → Pages → Source** to **GitHub Actions**. After the workflow is on `main`, use **Actions → Publish GitHub Pages staging → Run workflow** to publish. To stage a separate branch, allow that branch in the repository’s `github-pages` environment and select it when running the workflow.

The staging build uses the Pages URL reported by GitHub, including the repository path, and marks the page `noindex`. Treat the staging URL and repository as public. **Verify Adiosbox** builds and runs checks for pull requests and pushes to `main`. Staging publication uses the separate manual workflow. [GitHub Pages setup](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

Record the tested commit SHA and URL. Check a deep link and its written sample without a key. In the browser, check the catalog and run controls with the keyboard at a narrow viewport and at increased zoom. On loopback, save, update, export, and import a case. Turn draft recovery on, edit an input, reload, and restore it. Check the hosted CSP and robots directives over HTTPS. If live calls are authorized, try one specific-model single run and one provider-pinned schema comparison. Check the displayed call counts, requested model, reported result, and available usage.

## Cloudflare Pages

Use the existing `adiosbox.com` Cloudflare zone. When release is authorized, connect the source repository in Workers & Pages, then configure these settings.

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Build command | `sh scripts/build-pages.sh` |
| Build output directory | `public` |
| Build environment variables | `HUGO_VERSION=0.168.0` and `SKIP_DEPENDENCY_INSTALL=1` in Production and Preview |

The build installs locked npm dependencies and uses Node from `.node-version`. It uses `https://adiosbox.com/` for production and the current deployment URL for branch previews. [Pages headers](https://developers.cloudflare.com/pages/configuration/headers/) apply a content security policy and ask search engines to skip Pages-hosted aliases.

After the first Pages build, verify the sample and one consented live run over HTTPS. Add `adiosbox.com` under the Pages project's **Custom domains** after checking its current web DNS records. Keep a record of existing DNS and any previous site before cutover. Verify the domain, HTTPS, share link, and live-run behavior after it connects. [Pages Hugo guide](https://developers.cloudflare.com/pages/framework-guides/deploy-a-hugo-site/) · [Pages custom domain setup](https://developers.cloudflare.com/pages/configuration/custom-domains/)
