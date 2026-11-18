# Handoff

Everything someone (person or AI) needs to pick this up. Last updated 17 Nov 2026.

## What it is

A Clash Royale clan war audit for **#WINNING** (`#PPCCR8VU`), built so any clan can use it.
Stan (co-leader) and Baki (leader) use it after each war to see who to kick, demote, warn,
check on or promote, with clan chat messages ready to paste, and during battle days to see who
still needs to play.

- **Leaders' page:** https://crtrack.stane203.workers.dev (opens and loads the clan by itself)
- **Members' page:** https://crtrack.stane203.workers.dev/me (each member enters their own tag; own numbers only)
- **Discord bot:** slash commands and pings, run by the same Worker (set up per the steps below)

Style Stan asked for: **short, plain words**, no self-explaining text; UI follows Nielsen &
Molich's heuristics (see `docs/UI-GUIDE.md`). Nothing is hard-coded to #WINNING.

## Files

| Path | What |
|---|---|
| `site/index.html`, `site/app.js` | Leaders' page |
| `site/me.html`, `site/me.js` | Members' page |
| `site/logic.js` | Decisions: building players from data, `judgeEnd` / `judgeLive`, chat messages, rule limits (`RULE_SPEC`) |
| `site/stats.js` | Forecasts, reliability, play times, battle types, race projection, forecast accuracy, seasons |
| `site/ui.js` | Shared by both pages: escaping, UK dates, charts (`spark`, `bars`), `rulesExplained` |
| `site/sw.js`, `site/manifest.webmanifest`, `site/icons/` | Installable app, offline page, phone notifications |
| `worker/index.js` | Worker entry: `/api/*`, static files, the 15-minute schedule |
| `worker/api.js` | All `/api` routes |
| `worker/history.js` | Snapshots into D1, alerts, history and member reads, shared notes |
| `worker/push.js` | Web Push (VAPID keys made on first use, kept in D1) |
| `worker/discord.js` | Discord bot |
| `worker/extras.js` | Season recap, rival scouting, weekly digest, monthly backup |
| `worker/cards.js` | `/mystats` report and the clan stats board |
| `worker/leaders.js` | The page's after-war decisions worked out in the Worker (for the weekly digest) |
| `worker/gen.mjs` | Copies `site/logic.js` and `site/stats.js` into Worker modules (`*.gen.js`, generated: don't edit) |
| `tests/` | `check` (decisions), `function` (API), `history` (snapshots, alerts, notes), `stats`, `discord`, `ui` (both pages in a browser) |
| `samples/` | Real RoyaleAPI exports from 16 Nov 2026 (used by tests) |
| `docs/gemini/` | The earlier Gemini work this replaced |

Run all tests: `for t in check function history stats discord leaders extras; do node --no-warnings tests/$t.mjs; done; node tests/ui.mjs`
(the GitHub workflow runs them too, plus a Wrangler dry-run build; it was verified step by step in a clean clone. GitHub refuses to start the job on account grounds, see SETUP.md §10).

## Setup

Step by step (Cloudflare, secrets, leader codes, phone alerts, Discord app, server roles and channel permissions,
commands, troubleshooting): **[`SETUP.md`](SETUP.md)**. Worker `crtrack`, deployed by Workers Builds from `main`
(`wrangler.jsonc`: `keep_vars: true`, build runs `node worker/gen.mjs`). D1 `crtrack-history`
(`513fad6e-908f-4a83-b3c4-b142df48b364`, Western Europe).

## Data and the schedule

The official API (via `proxy.royaleapi.dev`) gives members, the current race, and the **last 10 wars only**.
Everything older exists only because the database saved it (from 7 Sep 2026, kept forever).

Cron every 15 minutes (`snapshotAll` → `snapshot`). Battle days: every run. Training days: only the hour
after the daily reset (~09:43 UTC) and every 12 hours (`shouldRun`). "Request updated data" on the page
pulls at once (anyone, 5-minute limit per clan, counted from the last request even if it failed).

| Table | What |
|---|---|
| `members` | current members, role, last online |
| `member_events` | `seen`, `join`, `leave`, `role` (`member>elder`), with time |
| `wars`, `war_players` | every finished war (`wars.fame` is race progress, not total medals) |
| `periods` | when each training/battle day was first seen (to tell which day someone joined) |
| `race_days` | each player's medals and decks per battle day (last snapshot before the reset) |
| `race_events` | a row each time a player's deck count rises (when they play, to 15 min) |
| `race_standings` | every clan in the race, per battle day |
| `war_battles` | war battles from battle logs (3 players per run in rotation). Checked: rebuilds iccyman2511's 138-2 exactly (2,850 / 16 decks) |
| `member_stats` | donations, trophies, level per war week |
| `notes` | shared choices: `join`, `over`, `result` (saved automatically), `done` (ticked), `rules` (only changed rules) |
| `note_log` | who changed what |
| `push_subs`, `alerts`, `kv` | phone alert subscriptions, sent alerts, server keys, rate limits, Discord config |
| `discord_links` | Discord user ↔ player tag, per server |

Free-plan limits per run: 50 database queries, 50 outside requests, 10 ms CPU. Writes use one multi-row
statement per table with values escaped by `q()`. The page loads the last 26 wars (`?all=1` for backups).

## Decisions after a war (`judgeEnd`)

Defaults; all in Rules, corrected to sensible ranges (`RULE_SPEC`, `sanitizeRules`).

1. Not in the war, or excused / joined day 4 → **Excused**. Left during the war → **Left the clan**.
2. Reached the target (1800; late joiners 450 × battle days left after joining, or used every deck) → **Passed**,
   or **Promote** if Member, 6+ wars, ≤1 miss, average 2,200+, not mostly boats.
3. Under the target:
   1. Reached it 3+ wars in a row before and offline 3+ days → **Check on them**
   2. Leader / co-leader → **Leaders decide**
   3. Elder → **First & only warning**; demote on a second miss in a row or while warned
   4. While on a posted first & only warning (until 3 wars in a row at target) → **Kick**
   5. Mostly boats (50%+, 8+ decks) → **Warning + boat tip**; still under on boats after that → **Kick**
   6. New with unknown join day → **Leaders decide**; new → **Kick**
   7. Back after leaving → **Leaders decide**; second miss in a row → **Kick**; otherwise **First & only warning**
4. A leader's change always wins. A promotion or demotion seen in game after a war counts as that war's action.
5. Kicks, demotions and promotions tick themselves from the game; warnings and check-ins are ticked by hand
   (they happen in clan chat, which the API doesn't include). A warning only counts once ticked (posted).

Battle days (`judgeLive`): most medals possible today by decks left (4→900, 3→700, 2→400, 1→200), plus 900 per day after.

## Stats (`site/stats.js`)

- **Forecast:** Monte Carlo (2,000 runs, seeded) from the player's own habits: share of decks played, medals per deck and its spread; new players use the clan's. Bands: Likely ≥80%, At risk ≥20%, Unlikely.
- **Forecast accuracy:** reruns past battle-day forecasts with only what was known then; Brier score vs guessing the usual pass rate.
- **Reliability (0–100):** 40% wars at target, 30% decks used, 20% medals vs target (1.5× = full), 10% recent trend.
- **Race projection:** each clan's pace so far carried to day 4 (the roughest estimate here).
- **Best battle type:** medals per deck from duel 250/100, 1v1 200/100, boats 125/75 (needs 5+ games in two types).

## Alerts and Discord

Phone alerts (installed app, leaders with the code): joins/leaves (with open spots), war finished (placing, how many
reached the target, who didn't), battle day 4 can't-reach (per-player targets), decks still unused in a day's last
4 hours, data pulls failing. Pushes carry no data; the phone fetches `/api/alerts/latest?clan=` and shows unseen ones.

Discord (`worker/discord.js`, `worker/leaders.js`). Commands:
- Anyone: `/link #TAG`, `/unlink`, `/mystats` (full report in cards: this war with forecast and place in the clan, last 10 wars
  as bars, consistency breakdown, streak, battle types, play times; `share` to post publicly), `/clan stats` (clan stats board),
  `/away days reason` (absence: saved as a shared `away` note; under target while
  away during a war → **Leaders decide** instead of kick/warn, shown on the page), `/remind hours` (private message when a
  battle day has that long left and they still have decks; checked on turn-on; once per day; max 8 per run).
- Leaders (Manage Roles): `/linkuser`, `/links`, `/setup` (shows what goes where; finds roles named Member / Elder /
  Co-Leader / Leader), `/setup sync`, `/setup channel` (run **in** a channel to give it a job),
  `/player #TAG` (reliability, recent wars, away, warning), `/check #TAG` (someone applying: public stats, recent war
  battles, any time already spent in this clan).

Channel jobs (`/setup channel`): **war** (live war board with text bars, refreshed every pull; "under 4 hours" pings),
**results** (battle day summary with +/- % after each reset; war result), **joins** (welcomes, promotion congrats,
after-war shout-outs: top 3 and every 5 wars in a row at target), **leaders** (absences, digest, backups),
**rules**, **how to link** and the **clan stats board** (messages kept up to date by editing; stats after every war:
last 8 wars as bars, pass-rate trend, most reliable, streaks, most improved, battle types, busiest hours, joins/leaves,
top donors). Reports are in `worker/cards.js`. Config in kv `discord:{guild}` =
`{clan, channels: {war, results, joins, leaders}, roles}`.

**Also** (`worker/extras.js`): season recap when a war ends and the race has moved to a new season (and `/clan season`);
rival scouting once per race from each rival's last 5 wars (`/clan scout`); the leaders' weekly digest on the last training
day (queued, then sent in a run of its own; DM to `/digest` leaders, else the leaders' channel); a monthly backup file
(gzipped full history, posted as an attachment, in a run of its own on a training day; `/leader backup`). Heavy jobs each get
their own 15-minute run: stats boards after a war, then digest, then backup.

**Who to act on after a war** is on the website only (Stan, 18 Nov: the Discord to-do list was unnecessary). `worker/leaders.js`
still works out the page's decisions in the Worker (copied from `site/logic.js` by `worker/gen.mjs`) for the weekly digest.

Discord app and server setup: [`SETUP.md`](SETUP.md#5-discord-bot).

## Measured facts

- Clan chat keeps **256 characters** (pasted a numbered ruler); messages split to fit.
- Clan description keeps **128 characters**. The game's font draws `=` like `:` and `>` like `)`.
- Names can carry colour codes (`<c4>Baki`): `cleanName` strips them. **Always match players by tag**, not name (two different "Luke"s).

## What happened in war 138-2 (seeded into the database)

Kicked Manny1, ty, bestgirlclasher; demoted notorious mike; promoted Luke, AzzA, Veiz, Marcus.B:), Spud, Ninja
(then Daddy, !AR1!, RufcHarvey on 17 Nov); warned perc, boi in a jar, Mohammad nazari, mattmk, Bob, Thomas king
(posted); check-in for Pirate Steve; >FRXNCHY< excused, brayyisaac joined day 3 and passed.

## Decisions made with Stan (17 Nov audit)

Site open to anyone with the link; returning players → leaders decide; promotion average 2,200; check-ins after 3 wars;
boat rule 50% / 8 decks; opens on Last war while it has to-dos; `main` branch; warnings last until 3 wars in a row at target;
members see only their own numbers; Jev (TypeSafe) not used yet. Its one good use here would be reading chat
screenshots for absence messages, if wanted.

## Open

- First real battle day (Thu 19 Nov): check snapshots, race data, battle-log coverage (raise `BATTLELOGS_PER_RUN` to 5 if patchy).
- GitHub Actions: jobs fail in 1 s with no log (account/billing setting on GitHub, not the tests). Workflow verified locally.
- Older RoyaleAPI exports (before 7 Sep 2026) can be imported if Stan has them.
- The members' page shows anyone's numbers to whoever types their tag (same data RoyaleAPI shows publicly).

## Added 18 Nov (optional extras)

- **Tag proof** (`/link`): the bot picks 2 cards the player owns that aren't in their current deck; they put both in
  their selected deck; **Done: check it** reads `currentDeck` from the game API. (The profile's favourite card can't be
  set by players, so it isn't used.) `/leader link` skips proof.
  **Changed 18 Nov:** the check reads the battle log (one battle with both cards since the proof started), not
  `currentDeck`, which showed a deck iccyman2511 had not played while his battle log already had the right battle. A proven owner takes over a tag someone else linked.
- **Waiting room tidy-up**: `discord_guests` records when someone got the Not in clan role; on quiet training-day runs
  (once a day) a heads-up in #not-in-clan at `tidyDays - 1`, removal at `tidyDays` (default 7, `/setup tidy`). Leaders
  and anyone who linked meanwhile are left alone.
- **War report DM** (`/warreport`): after each war, in the stats-board run, up to 20 per run (rest on later runs).
- **Forecast accuracy** (site, Clan stats): "right X% of the time", by band and battle day (`calibrate` in stats.js).
  Not on Discord: rerunning thousands of simulations would exceed the Worker's CPU limit.
- **Import older wars** (`/api/import`, site Rules): RoyaleAPI War log / War history CSVs; only untracked weeks;
  imported wars have `ended_at = ''` (sort before tracked ones, no invented dates).

## Added 18 Nov (from looking at other clan bots: CWStats, Canadian War Bot, ClashBot, TrophyCoach, RoyaleAPI)

- **Ping times**: the one battle-day ping used to go out in the last 4 hours (~05:45 UK for a 09:43 reset). Now an
  evening ping (cfg.pingHour UK, or `busiestHour`: the start of the clan's busiest 3 hours, 12:00–23:00, from
  race_events; 19:00 until there's data) and a last call `cfg.lastCall` hours before reset (default 2). `/setup pings`.
  Leaders' phone alerts follow the same times. `battleDayPings` in discord.js.
- **`/apply #TAG`** (CWStats-style): card in #leaders with recruitCard, war readiness and the clan's trophy requirement,
  Accept / Decline buttons (`apply|yes|user|tag`); applicant told by DM, else in #not-in-clan. One open application per
  person; re-apply after a day.
- **War readiness** (RoyaleAPI's recruit advice): game level = API level + 16 − maxLevel; the best 32 cards (4 war decks,
  no repeats): average and how many at 14+. Checked on real members (all maxed at the top; Bob 14.3 with 19/32 at 14+).
- **Projected finish** on the war board (CWStats' /race): `projectRace` from stats.js, shown from half a battle day in.
