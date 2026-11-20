# Adiosbox

Ryan's AI playground. The first experiment turns rough notes or a voice transcript into an action list and one next step. The prompt is editable and the included sample result is written out for visitors to inspect without a key.

## Run locally

Use Hugo 0.168.0. From this folder, run:

```sh
hugo server --disableLiveReload
```

Open [the local playground](http://localhost:1313/#rough-notes). Hugo reads the experiment's title, prompt, and sample from [data/experiment.yaml](data/experiment.yaml). To check the site build, run `hugo --panicOnWarning`.

The page uses the [OpenRouter free model router](https://openrouter.ai/openrouter/free), subject to availability and rate limits. A run sends the API key and the two text fields straight to OpenRouter. The page keeps the key in the password field for repeat runs, with a Clear key button. Adiosbox uses no persistent browser storage for keys, notes, or results. A share link includes only the page address and experiment anchor.

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
| Build environment variable | `HUGO_VERSION=0.168.0` in Production and Preview |

The build uses `https://adiosbox.com/` for production and the current deployment URL for branch previews. [Pages headers](https://developers.cloudflare.com/pages/configuration/headers/) apply a content security policy and ask search engines to skip Pages-hosted aliases.

After the first Pages build, verify the sample and one consented live run over HTTPS. Add `adiosbox.com` under the Pages project's **Custom domains** after checking its current web DNS records. Keep a record of existing DNS and any previous site before cutover. Verify the domain, HTTPS, share link, and live-run behavior after it connects. [Pages Hugo guide](https://developers.cloudflare.com/pages/framework-guides/deploy-a-hugo-site/) · [Pages custom domain setup](https://developers.cloudflare.com/pages/configuration/custom-domains/)
