/**
 * REELFEED collector — runs hourly via GitHub Actions.
 * Pulls RSS feeds + the Hugging Face API, tags model releases,
 * optionally writes AI digests (if ANTHROPIC_API_KEY is set),
 * merges with history and writes data/feed.json.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Parser = require("rss-parser");

const OUT = path.join(__dirname, "feed.json");
const MAX_ITEMS = 600;          // history kept on site
const PER_FEED = 20;            // newest items taken per source per run
const DIGEST_BATCH = 8;         // items per Claude call
const DIGEST_MAX_NEW = 40;      // max new items digested per run (cost control)

/* ================= SOURCES — edit freely ================= */
const FEEDS = [
  { name: "OpenAI",            url: "https://openai.com/news/rss.xml",                               cat: "news", lab: true },
  { name: "Google DeepMind",   url: "https://deepmind.google/blog/rss.xml",                          cat: "news", lab: true },
  { name: "Google AI",         url: "https://blog.google/technology/ai/rss/",                        cat: "news", lab: true },
  { name: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml",                          cat: "news", lab: true },
  { name: "Stability AI",      url: "https://stability.ai/news-updates?format=rss",                  cat: "news", lab: true },
  { name: "TechCrunch AI",     url: "https://techcrunch.com/category/artificial-intelligence/feed/", cat: "news" },
  { name: "The Verge AI",      url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", cat: "news" },
  { name: "VentureBeat AI",    url: "https://venturebeat.com/category/ai/feed/",                     cat: "news" },
  { name: "No Film School",    url: "https://nofilmschool.com/rss.xml",                              cat: "news" },
  { name: "ComfyUI Releases",  url: "https://github.com/comfyanonymous/ComfyUI/releases.atom",       cat: "news", lab: true },
  { name: "r/aivideo",         url: "https://www.reddit.com/r/aivideo/.rss",                         cat: "community" },
  { name: "r/StableDiffusion", url: "https://www.reddit.com/r/StableDiffusion/.rss",                 cat: "community" },
  { name: "r/midjourney",      url: "https://www.reddit.com/r/midjourney/.rss",                      cat: "community" },
  { name: "r/comfyui",         url: "https://www.reddit.com/r/comfyui/.rss",                         cat: "community" },
];

/* Hugging Face API — new & trending video/image models (no key needed) */
const HF_QUERIES = [
  { label: "text-to-video",  url: "https://huggingface.co/api/models?pipeline_tag=text-to-video&sort=createdAt&direction=-1&limit=10" },
  { label: "image-to-video", url: "https://huggingface.co/api/models?pipeline_tag=image-to-video&sort=createdAt&direction=-1&limit=10" },
  { label: "text-to-image",  url: "https://huggingface.co/api/models?pipeline_tag=text-to-image&sort=createdAt&direction=-1&limit=10" },
  { label: "trending video", url: "https://huggingface.co/api/models?pipeline_tag=text-to-video&sort=trendingScore&direction=-1&limit=10" },
  { label: "trending image", url: "https://huggingface.co/api/models?pipeline_tag=text-to-image&sort=trendingScore&direction=-1&limit=10" },
];

const MODEL_KEYWORDS = /\b(veo|sora|kling|runway|gen-\d|midjourney|flux|stable diffusion|sdxl|sd3|pika|luma|dream machine|imagen|firefly|seedance|hailuo|minimax|hunyuan|wan ?2|ltx|mochi|vidu|pixverse|higgsfield|ideogram|recraft|dall[·-]?e|gpt-image|nano banana|model release|new model|open[- ]?sourced? .{0,20}model|weights|checkpoint|text-to-video|text-to-image|image model|video model|diffusion model)\b/i;

/* ================= helpers ================= */
const hash = s => crypto.createHash("md5").update(s).digest("hex").slice(0, 12);
const strip = h => String(h || "").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();

function firstImage(item) {
  if (item.enclosure && /image/.test(item.enclosure.type || "")) return item.enclosure.url;
  const m = String(item.content || item["content:encoded"] || "").match(/<img[^>]+src="([^"]+)"/i);
  if (m) return m[1];
  if (item.itunes && item.itunes.image) return item.itunes.image;
  const mt = item["media:thumbnail"];
  if (mt && mt.$ && mt.$.url) return mt.$.url;
  return "";
}

function toItem(raw, feed) {
  const title = strip(raw.title);
  const excerpt = strip(raw.contentSnippet || raw.content || raw.summary || "").slice(0, 400);
  return {
    id: hash(raw.link || title),
    title,
    link: raw.link,
    date: new Date(raw.isoDate || raw.pubDate || Date.now()).toISOString(),
    source: feed.name,
    cat: feed.cat,
    isModel: MODEL_KEYWORDS.test(title) || (feed.lab && MODEL_KEYWORDS.test(excerpt)),
    thumb: firstImage(raw),
    excerpt,
  };
}

function hfToItem(m, label) {
  const id = m.modelId || m.id;
  return {
    id: hash("hf:" + id),
    title: id + (m.likes ? `  (♥ ${m.likes})` : ""),
    link: "https://huggingface.co/" + id,
    date: new Date(m.createdAt || Date.now()).toISOString(),
    source: "Hugging Face Models",
    cat: "news",
    isModel: true,
    thumb: "",
    excerpt: `New/trending ${label} model on Hugging Face. Downloads: ${m.downloads ?? "n/a"}, likes: ${m.likes ?? 0}. Tags: ${(m.tags || []).slice(0, 6).join(", ")}`,
    hf: { likes: m.likes || 0, downloads: m.downloads || 0, pipeline: label },
  };
}

/* ================= collectors ================= */
async function collectRSS() {
  const parser = new Parser({
    timeout: 20000,
    headers: { "User-Agent": "Mozilla/5.0 (ReelFeed aggregator)" },
    customFields: { item: [["media:thumbnail", "media:thumbnail"]] },
  });
  const out = [];
  for (const feed of FEEDS) {
    try {
      const f = await parser.parseURL(feed.url);
      out.push(...(f.items || []).slice(0, PER_FEED).map(i => toItem(i, feed)));
      console.log(`OK  ${feed.name}: ${(f.items || []).length} items`);
    } catch (e) {
      console.log(`ERR ${feed.name}: ${e.message}`);
    }
  }
  return out;
}

async function collectHF() {
  const out = [];
  for (const q of HF_QUERIES) {
    try {
      const r = await fetch(q.url, { headers: { "User-Agent": "ReelFeed aggregator" } });
      const models = await r.json();
      out.push(...models.map(m => hfToItem(m, q.label)));
      console.log(`OK  HF ${q.label}: ${models.length}`);
    } catch (e) {
      console.log(`ERR HF ${q.label}: ${e.message}`);
    }
  }
  return out;
}

/* ================= optional AI digests ================= */
async function addDigests(items) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { console.log("No ANTHROPIC_API_KEY — skipping AI digests."); return; }
  const todo = items.filter(i => !i.digest && i.cat === "news").slice(0, DIGEST_MAX_NEW);
  console.log(`Digesting ${todo.length} new items…`);
  for (let i = 0; i < todo.length; i += DIGEST_BATCH) {
    const batch = todo.slice(i, i + DIGEST_BATCH);
    const prompt =
      "You curate a hub about AI filmmaking and image generation. For each item below, return a JSON array of objects " +
      '{"id","summary","why","points","score"} — summary: 1-2 plain sentences of what happened; why: one sentence on why it matters ' +
      "to AI film/image creators; points: array of up to 3 short key facts; score: 1-10 how interesting this is for AI film/image " +
      "creators (10 = major model release). Respond with ONLY the JSON array.\n\n" +
      JSON.stringify(batch.map(b => ({ id: b.id, title: b.title, source: b.source, excerpt: b.excerpt })));
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 3000, messages: [{ role: "user", content: prompt }] }),
      });
      const j = await r.json();
      const text = j.content?.[0]?.text || "[]";
      const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
      for (const d of arr) {
        const it = items.find(x => x.id === d.id);
        if (it) { it.digest = { summary: d.summary, why: d.why, points: d.points || [] }; it.score = d.score; }
      }
    } catch (e) { console.log("Digest batch failed:", e.message); }
  }
}

/* ================= main ================= */
async function main() {
  let existing = { items: [] };
  try { existing = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch {}
  const seen = new Map(existing.items.map(i => [i.id, i]));

  const fresh = [...(await collectRSS()), ...(await collectHF())];
  let added = 0;
  for (const it of fresh) {
    if (seen.has(it.id)) {
      const old = seen.get(it.id);
      if (it.hf) old.hf = it.hf;                 // refresh HF like/download counts
    } else { seen.set(it.id, it); added++; }
  }

  const items = [...seen.values()]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, MAX_ITEMS);

  await addDigests(items);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), items }, null, 1));
  console.log(`Done. ${added} new items, ${items.length} total.`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { toItem, hfToItem, MODEL_KEYWORDS, FEEDS };
