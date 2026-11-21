# Adiosbox

Ryan's AI playground. Thirty-four experiments run from one workbench, including eight two-step chains and eleven LangGraph experiments. Every experiment has a share link and a written sample visitors can inspect without a key. LangGraph runs in the browser and records the nodes that ran, alongside their outputs. Checkpoint experiments wait for your choice before they send another request. A reload ends the in-memory checkpoint. A chain sends up to two sequential requests and shows each output. Step 2 receives the original input and the actual text from step 1. In Prompt control group, Run A and Run B send one request each, and the results stay side by side. For a fairer comparison, choose a specific model, keep the input fixed, and repeat the pair to check whether differences hold.

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
python3 scripts/playground.py
```

Open [the local playground](http://127.0.0.1:1313/#experiments), pick a model, and run an example. The launcher redirects `localhost:1313` to `127.0.0.1:1313`. It builds on startup and reads the key once, so restart it after editing either the site or `.env`. Press Ctrl+C to stop. The launcher listens only on loopback and sends the key to OpenRouter from the local Python process. Keep `.env` private. Git ignores it and Hugo publishes only generated site files.

For an auto-reloading preview of the public visitor experience, use `hugo server --disableLiveReload` and open [the visitor preview](http://localhost:1313/#experiments). Stop the local launcher first so the port is free. Hugo reads the catalog and workbenches from YAML files in [data/experiments](data/experiments). Each experiment's unique `slug` is its share-link anchor. To check the site build, run `hugo --panicOnWarning`.

## Keep a case

**Change one fact** runs two versions of a shared scenario and checks the answers against decisions and an invariant you supply. In the local launcher, **Save case** keeps any experiment’s inputs, model selections, and editable prompts in your browser. Open **Saved cases** to reopen or back up cases. See [The Missing Manual](docs/the-missing-manual.md).

## Comparison lab

The [Comparison lab](http://127.0.0.1:1313/#comparison-lab) adds fork repair, evidence tracing, blind model ratings, paired stop tests, reviewer comparisons, and a cold restart drill. The local launcher can request OpenRouter usage details for the reviewer comparison. Restart an already running launcher after updating the Python file to enable that request option.

## OpenRouter in hosted builds

GitHub Pages and Cloudflare Pages show a visitor key field. A run sends the visitor's key and the two text fields straight to OpenRouter. The visitor can reuse the key until the page is reloaded or the key is cleared. The site uses no persistent browser storage for keys, notes, or results.

The model picker uses the public OpenRouter catalog and accepts a full model ID by paste. It defaults to the [OpenRouter free model router](https://openrouter.ai/openrouter/free), subject to availability and rate limits. A share link includes only the page address and experiment anchor.

## GitHub Pages staging

Keep the source in `ryan258/adiosbox`. In the repository, set **Settings → Pages → Source** to **GitHub Actions**. After the workflow is on `main`, use **Actions → Publish GitHub Pages staging → Run workflow** to publish. To stage a separate branch, allow that branch in the repository’s `github-pages` environment and select it when running the workflow.

The staging build uses the Pages URL reported by GitHub, including the repository path, and marks the page `noindex`. Treat the staging URL and repository as public. The workflow runs on request, so ordinary pushes do not refresh the staging site. [GitHub Pages setup](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

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
