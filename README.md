# Clan War Audit

One HTML file. Works for any Clash Royale clan. Runs on your device, with no account and no server.

## Use

Open the hosted link (or `site/index.html`), and it loads the clan. Then work down the page:

1. **Clan**: type a tag and tap *Load clan* (automatic on the hosted link).
2. **Who to act on**
   - **Recommended**: numbered steps in order (in-game actions first, then what to post). Tap the circle when a step is done; in-game steps tick themselves. *Copy* copies that step's clan chat message.
   - **Last war**: who to kick, demote, warn, check on, or promote.
   - **This war**: during battle days, who can't reach 1800 any more and who still needs medals.
   - Each player: name, then medals and decks, then the reason. Dots show their recent wars (green = reached 1800).
   - Kicks, demotions and promotions tick themselves once the game shows them. First & only warnings and check-ins have **Mark done** (they happen in clan chat, which the game's data doesn't include). People who've left are hidden unless you tick *Show … who left the clan*.
   - Tap a name for their history and to change the suggestion or join day.
   - Pick an earlier war to see what was decided and done. Results are remembered automatically.
3. **Clan chat messages**: copy and paste.

Folded at the bottom: **Clan log** (joins, leaves, promotions) and **Rules**.

Without the hosted link: use your own key from developer.clashroyale.com (allowed IP `45.79.218.79`),
or download CSVs from RoyaleAPI and drop them in (*Other ways*).

## History (hosted link only)

Every 15 minutes on battle days (twice a day on training days) the site saves the clan's members, donations, every clan's medals in the race, and players' war battles. Over time that gives:

- **Join dates**, so a late joiner's battle day is filled in automatically
- **Who left, joined, was promoted or demoted, and when** (Clan log)
- **Role at the end of each war**, so promoting someone after the war doesn't flag them for demotion
- **Decks used each battle day**, e.g. "No decks day 3"
- **All past wars**, beyond the API's last 10
- **Shared choices**: join days, changes, done ticks and results are the same for every leader (needs the leader code)

## Share it (Cloudflare Workers, free)

Gives you a link like `https://crtrack.<you>.workers.dev/#PPCCR8VU` that anyone can open. Nobody else needs a key.

1. Cloudflare → **Workers & Pages** → **Create** → **Import a repository** → `CRTrack`.
2. Leave the defaults (build command empty, deploy command `npx wrangler deploy`). Deploy.
3. Open the Worker → **Settings → Variables and Secrets** → **Add**:
   - `CR_API_KEY` (type **Secret**): your key from developer.clashroyale.com, allowed IP `45.79.218.79`
   - `ALLOWED_CLANS` (type Text, optional): e.g. `PPCCR8VU`, so the link only works for your clan
   - `EDIT_KEY` (type **Secret**): a leader code you choose. Needed to save choices for everyone.
4. Open the `workers.dev` link and send it. With a key on the site, the page hides key setup, fills in the clan (if `ALLOWED_CLANS` has one) and pulls on open.

Only `site/` is published. Samples and notes stay private. Every push redeploys.
To limit who can open the page, turn on **Cloudflare Access** for the Worker and allow only your emails.

Join days and overrides are saved in each person's own browser, not shared.

## Rules

Every clan sets its own under **Rules** (saved for all leaders with the leader code). Defaults:

| When someone is under the target (default 1800 medals) | Suggestion |
|---|---|
| Member, first miss | First & only warning |
| Member, new or second miss in a row | Kick |
| Member, under again after a first & only warning | Kick |
| Elder, first miss | First & only warning *(switch: Elders get a warning before demotion)* |
| Elder, second miss in a row or after a warning | Demote |
| Mostly boat attacks (50%+ of decks, 8+ decks), including new members | First & only warning, with the boat attack tip |
| Still on boats and under again after that | Kick *(switch: Boat attackers still under after a warning are kicked)* |
| Passed the target 5+ wars in a row, now offline 3+ days | Check on them |
| Leader or co-leader | Leaders decide |

| Otherwise | Suggestion |
|---|---|
| Joined mid-war | Target is 450 per battle day left after joining, or passes if every deck was used |
| Member, 6+ wars in clan, at most 1 miss, average 2300+ | Promote to Elder |

All numbers and switches can be changed.

## Files

- `site/index.html`: the app
- `worker/`, `wrangler.jsonc`: the Cloudflare Worker (serves `site/`, adds the key, saves history to D1 every 15 min)
- `functions/api/`: the same for Cloudflare Pages, if used instead
- `samples/`: real exports from #WINNING, week 138-2
- `tests/`: `node tests/check.mjs`, `node tests/function.mjs`, `node tests/history.mjs`

The top of the page shows when data was last pulled (UK time). **Request updated data** pulls straight away (anyone, at most every 5 minutes), which helps on training days when the schedule is slower.
- `docs/UI-GUIDE.md`: the usability rules the screens follow, with sources
- `docs/HANDOFF.md`: background, maths, and decisions so far
- `docs/gemini/`: the earlier Gemini work, kept for reference
