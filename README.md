# Clan War Audit

Clash Royale clan war audit for leaders: who to kick, demote, warn, check on or promote after each war, with clan chat
messages ready to paste, live battle-day tracking, history and forecasts, phone alerts, and a Discord bot. Works for any
clan. Hosted free on Cloudflare (**[setup](docs/SETUP.md)**); the page also works on its own with your own API key or
RoyaleAPI CSVs.

## Use

Open the hosted link (or `site/index.html` on your computer), and it loads the clan. Then work down the page:

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

## Members' page

`/me`: each member enters their own player tag and sees only their own numbers: this war's medals and decks
left today, their forecast, their war history and consistency, how they play, and the rules explained.

## Discord

A bot run by the same Worker ([setup](docs/SETUP.md#5-discord-bot)). Members: `/link #TAG`, `/me` (a full personal war report), `/stats` (clan stats), `/away` (going away: leaders see it, no automatic kick),
`/remind` (private message when a battle day is ending with decks left). Leaders: `/post-here` in each channel to choose
what it gets (war board, summaries and results, welcomes and shout-outs, a leaders-only to-do list with tick buttons,
rules, how to link, a clan stats board), `/setup`, `/sync`, `/todo`, `/player #TAG`, `/check #TAG` (someone applying). Roles and nicknames
follow the game.

## Stats and forecasts

- **Forecast** (This war): each player's chance of reaching the target, from their own habits (share of decks they play, medals per deck, how much that varies), simulated 2,000 times. New players use the clan's typical habits.
- **Race**: every clan's medals, the gap to yours and how it moved since yesterday, plus a projected finish at today's pace.
- **Player panel** (tap a name): medals chart, reliability score with its breakdown, when they usually play, win rates and medals per deck by battle type, and which type earns them most.
- **Clan stats**: medals and pass rate per war, most and least reliable, battle types clan-wide, when the clan plays (UK time), top donors, offline 7+ days.

Reliability (0–100) = 40% wars at target + 30% decks used + 20% medals vs target (1.5× target = full) + 10% recent trend.

## History (hosted link only)

Every 15 minutes on battle days (twice a day on training days) the site saves the clan's members, donations, every clan's medals in the race, and players' war battles. Over time that gives:

- **Join dates**, so a late joiner's battle day is filled in automatically
- **Who left, joined, was promoted or demoted, and when** (Clan log)
- **Role at the end of each war**, so promoting someone after the war doesn't flag them for demotion
- **Decks used each battle day**, e.g. "No decks day 3"
- **All past wars**, beyond the API's last 10
- **Shared choices**: join days, changes, done ticks and results are the same for every leader (needs the leader code)

## Set it up

All setup (Clash Royale key, Cloudflare, leader codes, phone alerts, Discord bot, server roles and channels,
troubleshooting) is in **[`docs/SETUP.md`](docs/SETUP.md)**. Free: Cloudflare Workers + D1.

## Rules

Every clan sets its own under **Rules** (saved for all leaders with the leader code). Defaults:

| When someone is under the target (default 1800 medals) | Suggestion |
|---|---|
| Member, first miss | First & only warning |
| Member, new or second miss in a row | Kick |
| Member, under again while on a first & only warning (it clears after the target is reached 3 wars in a row) | Kick |
| Elder, first miss | First & only warning *(switch: Elders get a warning before demotion)* |
| Elder, second miss in a row or after a warning | Demote |
| Mostly boat attacks (50%+ of decks, 8+ decks), including new members | First & only warning, with the boat attack tip |
| Still on boats and under again after that | Kick *(switch: Boat attackers still under after a warning are kicked)* |
| Passed the target 3+ wars in a row, now offline 3+ days | Check on them |
| Back after leaving the clan | Leaders decide |
| New, join day unknown | Leaders decide |
| Leader or co-leader | Leaders decide |

| Otherwise | Suggestion |
|---|---|
| Joined mid-war | Target is 450 per battle day left after joining, or passes if every deck was used |
| Member, 6+ wars in clan, at most 1 miss, average 2200+ | Promote to Elder |

All numbers and switches can be changed.

## Files

- `site/`: the app (`index.html`, `style.css`, `logic.js` for the decisions, `stats.js` for forecasts and stats, `app.js` for the screen)
- `worker/`, `wrangler.jsonc`: the Cloudflare Worker (serves `site/`, adds the key, saves history to D1 every 15 min)
- `samples/`: real exports from #WINNING, week 138-2
- `tests/`: `check`, `function`, `history`, `stats`, `discord`, `leaders`, `ui` (run with `node tests/<name>.mjs`)

The top of the page shows when data was last pulled (UK time). **Request updated data** pulls straight away (anyone, at most every 5 minutes), which helps on training days when the schedule is slower.
- `docs/UI-GUIDE.md`: the usability rules the screens follow, with sources
- `docs/SETUP.md`: setting it up, step by step
- `docs/HANDOFF.md`: background, maths, and decisions so far
- `docs/gemini/`: the earlier Gemini work, kept for reference
