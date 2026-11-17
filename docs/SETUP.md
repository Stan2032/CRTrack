# Setup

Everything needed to set this up from nothing, or to fix one part. Work top to bottom.

1. [Clash Royale API key](#1-clash-royale-api-key)
2. [Cloudflare (the website)](#2-cloudflare-the-website)
3. [Leader codes](#3-leader-codes)
4. [Phone app and alerts](#4-phone-app-and-alerts)
5. [Discord bot](#5-discord-bot)
6. [Discord server: roles and channels](#6-discord-server-roles-and-channels)
7. [Turn the bot on in the server](#7-turn-the-bot-on-in-the-server)
8. [Tell the clan](#8-tell-the-clan)
9. [Troubleshooting](#9-troubleshooting)

The #WINNING site is **https://crtrack.stane203.workers.dev** (members' page: `/me`).

---

## 1. Clash Royale API key

1. Sign in at **developer.clashroyale.com** → My Account → **Create New Key**.
2. Allowed IP address: **`45.79.218.79`** (RoyaleAPI's proxy, which the site uses).
3. Copy the key. It goes into Cloudflare as a secret (next step). Never paste it into chat or the code.

## 2. Cloudflare (the website)

Free plan. One Worker serves the site, keeps the history and runs the bot.

1. Cloudflare → **Workers & Pages** → **Create** → **Import a repository** → `CRTrack`.
   Leave the defaults (build command empty, deploy command `npx wrangler deploy`). Branch: **`main`**.
   Every push to `main` redeploys within a minute or two.
2. Database: **Storage & Databases → D1** → create `crtrack-history`, then put its id in `wrangler.jsonc`
   (#WINNING's is already there: `513fad6e-908f-4a83-b3c4-b142df48b364`).
3. Open the Worker → **Settings → Variables and Secrets** → **Add** (use *Variables and Secrets*, not *Build* variables):

| Name | Type | Value |
|---|---|---|
| `CR_API_KEY` | **Secret** | the key from step 1 |
| `ALLOWED_CLANS` | Text | your clan tag without `#`, e.g. `PPCCR8VU` (only these clans can be used or tracked) |
| `EDIT_KEY` | **Secret** | the leader code (step 3) |
| `EDIT_KEYS` | **Secret**, optional | one code per leader: `Stan:xxxx,Baki:yyyy` (the log shows who changed what) |
| `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN` | **Secret** | from step 5 |
| `DISCORD_GUILD_ID` | Text | your Discord server's id (step 5) |

`wrangler.jsonc` has `keep_vars: true`, so deploys never wipe these. The schedule (every 15 minutes) is in
`wrangler.jsonc` too; nothing to set up.

Check: open `/api/status` on the site. It should say `"key":true,"history":true,"edit":true,"discord":true`.

## 3. Leader codes

- Choose a code (8+ characters) and save it as `EDIT_KEY` (Secret). Leaders type it once on the site:
  **Rules → Leader code → Use code**. It's remembered on that device.
- With the code, choices (join days, changes, ticks, rules) are shared with every leader. Without it, they stay on that device.
- Changing the secret in Cloudflare logs everyone out (they enter the new code).
- Pop-ups asking to save it as a password can be ignored (tap ⚙️ → **Never** for the site).

## 4. Phone app and alerts

On each leader's phone (Android Chrome, or iPhone Safari → Share → Add to Home Screen):

1. Open the site → at the top, **Install app** (iPhone: Share → Add to Home Screen, then open it from the home screen).
2. Enter the leader code (step 3), then at the top, next to **🔔 Get alerts**, tap **Turn on**.

Alerts: joins and leaves, war finished, battle day 4 "can't reach the target", decks unused in a day's last 4 hours,
data pulls failing.

## 5. Discord bot

At **discord.com/developers/applications** → **New Application** (e.g. "War Audit"):

1. **General Information**: copy **Application ID** → `DISCORD_APP_ID`, and **Public Key** → `DISCORD_PUBLIC_KEY`
   (both Cloudflare secrets). Optional: app icon `site/icons/discord-icon-1024.png`.
2. **Bot**: **Reset Token** → copy → `DISCORD_BOT_TOKEN` (secret). Leave *Public Bot* off.
   No privileged intents are needed (all three can stay off).
3. Save the Cloudflare secrets *before* the next step (Discord checks the site answers).
4. **General Information → Interactions Endpoint URL**: `https://crtrack.stane203.workers.dev/api/discord` → Save.
   It must save without an error.
5. **Server id**: in Discord, Settings → Advanced → **Developer Mode** on; long-press the server → **Copy Server ID** →
   Cloudflare Text variable `DISCORD_GUILD_ID` (commands then appear instantly, only in your server).
6. **OAuth2 → URL Generator**: scopes **`bot`** and **`applications.commands`**. Bot permissions:
   - Manage Roles, Manage Nicknames
   - View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Pin Messages

   Leave off Administrator, Kick/Ban, Manage Messages, Mention Everyone. Open the generated link → pick the server → Authorise.

## 6. Discord server: roles and channels

**Roles** (Server Settings → Roles), named exactly so the bot finds them:
`Leader`, `Co-Leader`, `Elder`, `Member`. Then drag **War Audit** (the bot's role) **above** Co-Leader, Elder and Member.
It can only give out roles below its own (it can't change the Leader role or the server owner, which Discord doesn't allow anyway).

**Who sees what**: newcomers have no clan role until they link, so only let `@everyone` see the link channel.

| Channel | `@everyone` | Clan roles | War Audit | Bot job (`/post-here`) |
|---|---|---|---|---|
| `#link-tag` | View ✅, Use Application Commands ✅, Send Messages ❌ | (nothing needed) | View, Send, Read History | **How to link** (then pin it) |
| `#📜-rules` | View ❌ | View ✅, Send ❌ | View, Send, Read History | **Rules** + **Clan stats board** (pin both) |
| `#⚔️-war` | View ❌ | View ✅ | View, Send, Read History | **War board + reminders**, **Summaries + results** |
| `#💬-general` | View ❌ | View ✅ | View, Send | **Welcomes + shout-outs** |
| `#leaders` (private) | View ❌ | Leader + Co-Leader only | View, Send, Read History | **Leaders only** (to-do list, absences) |

Any channel can do any job; one channel can hold several. If the bot can't post somewhere it says which permission is missing.

## 7. Turn the bot on in the server

1. Site → **Rules** → leader code → **Register Discord commands** → "Done: 18 commands in your server".
   (Do this again whenever new commands are added. If Discord shows commands twice, register again and reopen the app.)
2. In Discord, anywhere: **`/setup`**. It finds the four roles and shows what goes where.
3. **`/link #YOURTAG`** for yourself, then **`/sync`**.
4. In each channel from the table: **`/post-here`** → its job. Pin the How to link, Rules and Stats messages.
5. **`/setup`** again to check every job has a channel.
6. Optional: **`/todo`** in `#leaders` shows the list for the last war.

**Commands**

| Who | Command | What |
|---|---|---|
| Anyone | `/link #TAG`, `/unlink` | Link your Discord to your player; role and nickname follow the game |
| Anyone | `/me` | Your full war report (only you see it; `share` to post it) |
| Anyone | `/stats` | Clan stats |
| Anyone | `/season` | Season recap (latest, or `number`) |
| Anyone | `/scout` | The clans we're racing: their recent results vs ours |
| Anyone | `/away 3 holiday` | Away for 3 days: leaders see it, no automatic kick (`/away 0` = back) |
| Anyone | `/remind 3` | Private message 3 hours before reset if you have decks left (`/remind 0` = off) |
| Leaders | `/setup`, `/post-here`, `/sync` | Roles, channel jobs, update everyone's roles and nicknames |
| Leaders | `/links`, `/linkuser @who #TAG` | Who's linked; link someone else |
| Leaders | `/todo` | Post or refresh the after-war to-do list |
| Leaders | `/player #TAG`, `/check #TAG` | A member's record; someone applying to join |
| Leaders | `/digest on:True` | Weekly digest privately (last training day): warnings, close to Elder, slipping, away, not linked |
| Leaders | `/backup` | Post a backup file of the full history in the leaders' channel now |

"Leaders" means anyone with Manage Roles or Administrator in Discord.

**What the bot does by itself**

| When | What | Where |
|---|---|---|
| Every 15 min on battle days | War board (edited in place) | War |
| Last 4 hours of a battle day | Pings linked members with decks left | War |
| Reset, from each member's `/remind` | Private reminder | DMs |
| After each daily reset | Battle day summary (+/- % vs the day before) | Results |
| War ends | Result; shout-outs (top 3, streaks); to-do list + clan chat messages ~15 min later; stats board refresh | Results, Welcomes, Leaders, Rules |
| Someone joins / is promoted in game | Welcome / congrats; role and nickname updated | Welcomes |
| New race starts | Rival scouting: each clan's last 5 wars vs ours | War |
| Last training day | Leaders' weekly digest (DM to `/digest` leaders, else the leaders' channel) | DMs / Leaders |
| Last war of a season | Season recap | Results |
| Once a month (training day) | Backup file of the full history | Leaders |
| Rules saved on the site | Rules message rewritten | Rules |
| Ticks on the site or Discord | Each updates the other | Leaders |

## 8. Tell the clan

Clan chat (fits the 256-character limit):

> Join our Discord! Link with /link #YOURTAG to get your role. /me = your war report, /remind 3 = reminder before
> reset, /away = tell leaders you're away.

Clan description (128 characters): the site writes versions that fit, from your rules, under **Clan rules explained →
Clan description** (add your Discord link there). Copy one into Clan → Edit → Description.

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| Site says the key was refused | Key's allowed IP must be `45.79.218.79`; re-save `CR_API_KEY` |
| "Wrong leader code" | Check `EDIT_KEY` / `EDIT_KEYS` in Cloudflare (Secrets, not Build variables) |
| Interactions Endpoint URL won't save | Discord secrets missing or wrong in Cloudflare; wait a minute after saving them |
| Commands missing in Discord | Register Discord commands again; reopen the Discord app |
| Commands listed twice | Register again with `DISCORD_GUILD_ID` set (clears the old copy) |
| Roles don't change | Bot role must be above the clan roles; run `/setup` and check the roles listed; then `/sync` |
| "I can't post in #channel" | Add War Audit to that channel: View Channel, Send Messages, Read Message History |
| `/remind` says it can't DM | Long-press the server → Privacy Settings → Direct Messages on |
| No to-do list after a war | Run `/todo` in the leaders' channel |
| Old page after an update | Close and reopen the app (it updates itself) |

Developer notes (how it works, the maths, tests) are in [`HANDOFF.md`](HANDOFF.md).
