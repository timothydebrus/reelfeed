# REELFEED — AI Film & Image Hub

A self-updating website covering AI filmmaking and image generation: model releases, news, community highlights and a resources directory. An automated pipeline runs every hour, pulls from ~20 sources (lab blogs, news sites, the Hugging Face API, Reddit), tags model releases, and publishes the result.

## What's in this folder

| File | What it does |
|---|---|
| `index.html` | The website. Shows the feed with an in-page reader panel. |
| `collect.js` | The collector. Pulls all sources, writes `feed.json`. |
| `.github/workflows/update.yml` | Tells GitHub to run the collector every hour, free. |
| `feed.json` | The feed data (starter data included; overwritten hourly once live). |

## Setup (about 15 minutes, no coding)

1. **Create a GitHub account** at github.com (free).
2. **Create a new repository**: click **+** → *New repository*. Name it e.g. `reelfeed`, keep it **Public**, click *Create*.
3. **Upload the files**: on the repo page click *uploading an existing file*, then drag in `index.html`, `collect.js`, `feed.json` and `README.md`. Commit.
4. **Add the workflow** (GitHub needs this one created in its own editor):
   *Add file → Create new file* → in the name box type exactly `.github/workflows/update.yml` → paste the contents of that file from this folder → *Commit*.
5. **Turn on the website**: *Settings → Pages* → under "Branch" choose `main` and `/ (root)` → *Save*. After a minute your site is live at `https://YOURNAME.github.io/reelfeed/`.
6. **First run**: *Actions* tab → "Update feed" → *Run workflow*. From then on it runs itself every hour.

### Custom domain (optional)
Buy a domain on Namecheap, then in *Settings → Pages → Custom domain* enter it and follow the DNS instructions shown (one CNAME record).

### Switch on AI summaries (optional, later)
1. Get an API key at console.anthropic.com (~£2–5/month at this volume).
2. In the repo: *Settings → Secrets and variables → Actions → New repository secret*.
   Name: `ANTHROPIC_API_KEY`, value: your key.
3. Next hourly run onwards, every article gets an AI-written "what happened / why it matters / key points" digest in the reader panel, plus an interestingness score (high scores get a ★ BIG badge).

## Customising

- **Add/remove sources**: edit the `FEEDS` list at the top of `collect.js` — one line per RSS feed.
- **Resources directory**: edit the `RESOURCES` list near the top of `index.html`.
- **Name/colours**: edit `index.html` (colours are the `--` variables at the top).

## Notes

- Full articles stay on the publishers' sites — the reader panel shows excerpts/our own summaries and links out. That keeps the site on the right side of copyright.
- If a source breaks, the pipeline skips it and carries on; check the Actions log to see which sources loaded.
