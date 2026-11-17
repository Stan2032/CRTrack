# Clan War Audit

One HTML file. Works for any Clash Royale clan. Runs on your device, with no account and no server.

## Use

Open `site/index.html` in a browser (or your hosted link), type the clan tag, then either:

- **Pull**: gets everything automatically. One-time setup: make a free key at
  [developer.clashroyale.com](https://developer.clashroyale.com) with allowed IP `45.79.218.79`
  ([RoyaleAPI proxy](https://docs.royaleapi.com/proxy.html)), then paste it under *Pull setup*.
  The key stays in your browser.
- **CSVs**: use the Members / War log / Race links to open RoyaleAPI, download the CSVs, and drop them in.

Then work down the page:

1. **Get data**
2. **Actions**: grouped Kick → Demote → Warn → Check in → Review → Promote. Set *Joined* for NEW players who joined mid-war. Use the right-hand menu to override any result.
   **Week end** checks the last finished war. **Live** shows, during battle days, who can't reach the target any more.
3. **Chat**: copy the messages into clan chat.

Opening the page with `#CLANTAG` on the end pulls straight away. Choices are saved in your browser for each clan.

## Share it (Cloudflare Workers, free)

Gives you a link like `https://crtrack.<you>.workers.dev/#PPCCR8VU` that anyone can open. Nobody else needs a key.

1. Cloudflare → **Workers & Pages** → **Create** → **Import a repository** → `CRTrack`.
2. Leave the defaults (build command empty, deploy command `npx wrangler deploy`). Deploy.
3. Open the Worker → **Settings → Variables and Secrets** → **Add**:
   - `CR_API_KEY` (type **Secret**): your key from developer.clashroyale.com, allowed IP `45.79.218.79`
   - `ALLOWED_CLANS` (type Text, optional): e.g. `PPCCR8VU`, so the link only works for your clan
4. Open the `workers.dev` link and send it.

Only `site/` is published. Samples and notes stay private. Every push redeploys.
To limit who can open the page, turn on **Cloudflare Access** for the Worker and allow only your emails.

Join days and overrides are saved in each person's own browser, not shared.

## Rules (defaults, change them in Rules)

| | |
|---|---|
| Target | 1800 medals a week |
| Late joiner | 450 per battle day left after joining, or used every deck |
| Elder under | Demote |
| Member under, 1st miss | Warn |
| Member under, 2nd miss in a row or new | Kick |
| Mostly boats (50%+, 8+ decks) | Warn |
| Passed 5+ weeks in a row, now offline 3+ days | Check in |
| Leader / co-leader under | Review |
| Promote | Member, 6+ weeks, 1 miss max, avg 2300+ |

## Files

- `site/index.html`: the app
- `worker/`, `wrangler.jsonc`: the Cloudflare Worker (serves `site/`, adds the key for Pull)
- `functions/api/`: the same for Cloudflare Pages, if used instead
- `samples/`: real exports from #WINNING, week 138-2
- `tests/`: `node tests/check.mjs` and `node tests/function.mjs`
- `docs/HANDOFF.md`: background, maths, and decisions so far
- `docs/gemini/`: the earlier Gemini work, kept for reference
