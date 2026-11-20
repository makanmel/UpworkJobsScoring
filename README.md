# Upwork Job Scorer (Chrome Extension, MV3)

Scores Upwork job cards in the search feed in real time and badges them with a hiring-probability estimate, based on empirical signals from the Upwork hiring study discussion.

## Install

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. Open `https://www.upwork.com/nx/search/jobs/` — badges appear on job cards.

## Files

- `manifest.json` — MV3, `storage`/`alarms`/`tabs` permissions, scoped to `upwork.com` + webhook hosts.
- `scorer.js` — pure scoring function (`window.UpworkScorer.scoreJob(job, cfg)`), weights and stop-words in `DEFAULT_CONFIG`.
- `parser.js` — DOM extraction per card (`window.UpworkJobParser.parseCard`), uses `data-test` attributes + text patterns (`$ spent`, `Proposals:`, `Fixed-price`).
- `content.js` — `MutationObserver`, 30-day dedup in `chrome.storage.local`, badge rendering, live re-score on config change, high-score alerts.
- `background.js` — service worker: alarm-based auto-refresh of Upwork tabs + webhook POST (ntfy/Telegram) for new high-score jobs.
- `options.html` / `options.js` — settings UI for all rule weights, thresholds, stop-word lists, auto-refresh interval and webhook URL/template.
- `styles.css` — badge + dimming styles.

## Scoring (0–10, baseline 5)

Positive: `+Fixed` (+2), `+Client $10k+` (+2), `+Short scope`, `+Verified`, `+Fresh proposals`, `+Client $1k+`.
Negative: `-Unverified`, `-No spend`, `-Seen before` (repost dedup), `-Flag: <stopword>`, `-Crowded`, `-Hourly`, `-Vague scope`.

Tiers: `good` ≥7 (green), `mid` 4–6 (yellow), `bad` <4 (red + card dimmed to 50%).

## Settings

Right-click the extension icon → **Options** (or `chrome://extensions` → Details → Extension options):

- **Weights** — every rule delta is editable; `alertMin` sets both the green-tier threshold and the webhook trigger score.
- **Stop-words / vague phrases** — one per line.
- **Auto-refresh** — reloads open `upwork.com/nx/*` tabs every N minutes (chrome alarms).
- **Webhook** — JSON POST fired once per new job scoring ≥ `alertMin`. Template placeholders: `{{title}}`, `{{score}}`, `{{url}}`, `{{reasons}}`.
  - ntfy: `https://ntfy.sh/your-topic` (default template works as-is).
  - Telegram: `https://api.telegram.org/bot<TOKEN>/sendMessage` with template `{"chat_id": "<id>", "text": "[{{score}}/10] {{title}}\n{{reasons}}\n{{url}}"}`.
  - Other hosts need their origin added to `host_permissions` in `manifest.json`.
