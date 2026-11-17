# Handoff

Context for anyone (person or AI) picking this up.

## Who and why

- Stan is a co-leader of **#WINNING** (`#PPCCR8VU`), Legendary League, about 3,355 war trophies. The leader is **Baki**.
- Clan rule: **1800 war medals a week**. Under 1800 risks a kick or demotion. Strong scorers get promoted.
- Goal: stop working out by hand who to kick, demote, or promote each week, and get chat messages ready to paste.
- The tool is **generic**: any clan can drop in its own RoyaleAPI CSVs. Nothing is hard-coded to #WINNING.
- Style Stan asked for: **short, plain words, no self-explaining text**, in the UI and in chat messages.

History: the first round was done with Gemini (transcript in `docs/gemini/conversation.txt`, its two app versions alongside). This repo replaces those apps.

## Clan Wars 2 maths

| Battle | Win | Loss |
|---|---|---|
| Duel (per game, needs 3+ decks left) | 250 | 100 |
| 1v1 / special | 200 | 100 |
| Boat attack | 125 | 75 |

- 4 battle days a week, 4 decks a day = 16 decks.
- Most medals in one day, by decks left today: 4 → 900, 3 → 700, 2 → 400 (no duel), 1 → 200, 0 → 0.
- Losing all 16 PvP games = 1600, so 1800 needs only 2 wins in 16.
- 1800 / 4 days = **450 a day**. A late joiner's target is 450 × full battle days left after the day they joined (joined day 1 → 1350, day 2 → 900, day 3 → 450, day 4 → excused).
- Live elimination: `medals + today's max + 900 × days after today < target` means they can't make it.
- Kicking someone with **0 decks used today** frees a battle slot (50 players a day max). Kicking someone who already played does not.
- Boat-only players: wins = (medals − 75 × boats) / 50. The same record in 1v1 = 200 × wins + 100 × losses.

## Pull (official API)

The app calls `https://proxy.royaleapi.dev/v1/clans/%23TAG` plus `/members`, `/currentriverrace` and `/riverracelog?limit=10`.
These need the user's own key from developer.clashroyale.com, allowed for IP 45.79.218.79 (RoyaleAPI's proxy; the proxy allows browser requests).
`apiToRows()` turns the replies into the same rows as the CSVs. Week key = `seasonId-(sectionIndex+1)`.
Battle day = `periodIndex % 7 - 2` when `periodType` is `warDay` or `colosseum`.

Hosted on Cloudflare Workers (`wrangler.jsonc`, `worker/index.js` serves `site/` as static assets; `worker/api.js`) or Pages (`functions/api/[[path]].js`). `worker/api.js` serves `/api/v1/clans/...`, adds the `CR_API_KEY` secret, and only allows clan endpoints (optionally only the clans in `ALLOWED_CLANS`).
`/api/status` says whether the site has a key and which clans are allowed. If it has a key, the page hides key setup, prefills a single allowed clan and pulls on open. A personal key in the browser still takes priority.

Live at `https://crtrack.stane203.workers.dev` (Workers Builds from this repo; `CR_API_KEY` secret and `ALLOWED_CLANS=PPCCR8VU` set in the dashboard; `keep_vars` stops deploys wiping them).

## History (D1)

Database `crtrack-history` (id `513fad6e-908f-4a83-b3c4-b142df48b364`, Western Europe), bound as `DB`.
A cron every 15 minutes (`worker/history.js`, `snapshot()`) saves, for each clan in `TRACK_CLANS` or `ALLOWED_CLANS`:

| Table | What |
|---|---|
| `members` | current members, role, last online |
| `member_events` | `seen` (first sighting), `join`, `leave`, `role` (`member>elder`), with time |
| `wars`, `war_players` | every finished war, kept forever |
| `periods` | when each training / battle day was first seen (used to tell which battle day someone joined on) |
| `race_days` | each player's decks/medals per battle day (last value before the day reset) |
| `notes` | shared choices: `join`, `over` (manual change), `result` (saved results), `done` (action ticked), `rules` |
| `member_stats` | donations given/received, trophies, level, per war week |
| `race_standings` | every clan in the race and its medals, per battle day |
| `war_battles` | war battles from players' battle logs (duel / 1v1 / boat, games won and lost). 3 players per run in rotation, so each player's log is read about every 4 hours (the log holds their last 25 battles) |

## How long data lasts

- The official API only returns the last 10 wars, so anything older exists only because this database saved it. Wars are kept forever from 7 Sep 2026 (the first of the 10 imported).
- Storage: about 50–150 KB per war week, so the free plan's 500 MB database holds decades.
- Free-plan daily limits: 100,000 rows written (we use about 10–20,000 on battle days), 5 million rows read (each page load reads the clan's whole history, a few thousand rows a year), 100,000 Worker requests.
- Per run: 50 database queries and 50 outside requests (we use about 25 and 6), and 10 ms of CPU, which is why battle logs are read 3 players at a time.

Free plan limits per run: 50 queries and 10 ms CPU. Writes use one multi-row statement per table, with values inlined via `q()` (escapes quotes).
Seeded on 17 Nov 2026 with the 16 Nov roster (as `seen`) and Stan's 138-2 calls (join days, changes, results).
Writing notes needs the `EDIT_KEY` secret sent as `X-Edit-Key`. The page calls it the "leader code".

## Data (RoyaleAPI CSV exports)

Detected by column names, so file names don't matter.

| File | Key columns | Notes |
|---|---|---|
| Roster | `tag, name, role, lastSeen` | `lastSeen` like `20261116T123806.000Z`. "Now" = latest lastSeen in the file. |
| War log | `season_key, player_tag, player_fame, player_decks_used, player_boat_attacks` | One row per player per week they were in the clan (0/0 rows = in clan, didn't play). Main source. |
| War history | `s_<week>_fame`, `s_<week>_decks_used`, ... | Wide format, no boats, 0/0 can't be told apart from "not in clan". Fallback only. |
| Current race | `player_fame, player_decks_used, player_decks_used_today` | Live mode. Has no battle-day number, so the app guesses from the most decks used, and you can change it. |

**Always join by tag, not name.** There are two different "Luke"s in the history.

Join dates aren't in the API. RoyaleAPI's join/leave log only starts once `code: RoyaleAPI` is in the clan description (Stan added it on 16 Nov 2026). For now, NEW players (no earlier weeks) are flagged and the join day is set by hand.

## Decision order (week end)

1. Not in the last war → Excused
2. Join day set to Excused or Day 4 → Excused
3. Reached target (or late joiner who used every deck) → OK, or **Promote** if member, 6+ weeks, ≤1 miss, avg ≥2300, mostly not boats
4. Under target:
   1. Passed 5+ weeks in a row before this, and offline 3+ days → **Check** (check in, don't kick)
   2. Leader / co-leader → **Review**
   3. Elder → **Demote**
   4. 50%+ boats and 8+ decks → **Warn** (coach them off boats)
   5. New → **Kick**
   6. Missed the week before too → **Kick**
   7. Otherwise → **Warn** (1st miss)
5. A manual change in the **Change** column always wins.

## Week 138-2 (ended 16 Nov 2026): what was actually done

Done in game by Stan:

- **Kicked:** Manny1, ty, bestgirlclasher (YOUREawful, great ben, and CURRY LORD were already gone)
- **Demoted:** notorious mike (Elder, first miss in 10 weeks)
- **Promoted to Elder:** Luke, AzzA, Veiz, Marcus.B:), Spud, Ninja
- **Warned:** perc, boi in a jar, Mohammad nazari (boats); mattmk, Bob, Thomas king (near misses / first misses)
- **Check in:** Pirate Steve (co-leader, offline since 11 Nov, usually 2,500+)
- **Excused:** >FRXNCHY< (joined day 2, Stan promised in chat). brayyisaac joined day 3 and used 4/4 decks, so passed.
- Posted chat messages telling the boat users to switch to duels/1v1.

With brayyisaac set to Day 3 and >FRXNCHY< set to Excused, the app reproduces these calls (`node tests/check.mjs`). Differences:

- **Promote:** the app suggests Xreal and N444adt (7/7 weeks, avg 2,600+) instead of AzzA (avg 2,270) and Ninja (missed this week). Stan picked those two by hand.
- **Ninja** shows Warn (1st miss). Stan promoted him anyway, using the Change column.

## Not done yet / ideas

- Pull is tested against fake API replies only; it still needs a real-key test.
- The RoyaleAPI page links (`/clan/TAG`, `/war/log`, `/war/race`) are best guesses, because royaleapi.com blocks automated checks.
- **Join dates** from RoyaleAPI's join/leave log, once it has been running a week.
- **Track warnings across weeks** (now inferred from "missed the week before").
- The Clash Royale chat length limit is set to 250 as a guess. It can be changed in Rules.
