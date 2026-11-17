# Clan War Audit

One HTML file. Works for any Clash Royale clan. Runs on your device, with no account and no server.

## Use

1. On [RoyaleAPI](https://royaleapi.com), open your clan and download the CSVs:
   - **Roster** (members, roles, last seen)
   - **War log** (each week: medals, decks, boat attacks)
   - **Current race**, for Live mode only
2. Open `index.html` in a browser and drop the files in.
3. **Week end**: who to kick, demote, warn, check on, and promote.
   **Live**: during battle days, who can no longer reach the target.
4. Set **Joined** for anyone marked NEW who joined mid-war.
5. **Chat** tab: copy the messages into clan chat.

Your choices (join days, changes, rules) are saved in your browser for each clan.

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

- `index.html`: the app
- `samples/`: real exports from #WINNING, week 138-2
- `tests/check.mjs`: `node tests/check.mjs` checks the logic against the samples
- `docs/HANDOFF.md`: background, maths, and decisions so far
- `docs/gemini/`: the earlier Gemini work, kept for reference
