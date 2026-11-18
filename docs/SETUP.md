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

The #WINNING site is **https://crtrack.stane203.workers.dev** (members' page: `/mystats`).

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
   (both Cloudflare secrets). Optional: app icon `site/icons/discord-icon-1024.png`. Server icon (the clan badge, padded for Discord's circle crop): `site/icons/discord-server-icon.png`.
2. **Bot**: **Reset Token** → copy → `DISCORD_BOT_TOKEN` (secret). Leave *Public Bot* off.
   No privileged intents are needed (all three can stay off).
3. Save the Cloudflare secrets *before* the next step (Discord checks the site answers).
4. **General Information → Interactions Endpoint URL**: `https://crtrack.stane203.workers.dev/api/discord` → Save.
   It must save without an error.
5. **Server id**: in Discord, Settings → Advanced → **Developer Mode** on; long-press the server → **Copy Server ID** →
   Cloudflare Text variable `DISCORD_GUILD_ID` (commands then appear instantly, only in your server).
6. **OAuth2 → URL Generator**: scopes **`bot`** and **`applications.commands`**. Bot permissions:
   - Manage Roles, Manage Channels, Manage Nicknames
   - View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Pin Messages

   Leave off Administrator, Kick/Ban, Manage Messages, Mention Everyone. Open the generated link → pick the server → Authorise.

   *Bot already in the server without Manage Channels?* Server Settings → Roles → **War Audit** → turn on
   **Manage Channels** → Save. (You can turn it off again after step 7.)

## 6. Discord server: roles and channels

The bot builds the whole server itself (step 7). The only thing you do by hand: **drag War Audit to the top of the
role list** (Server Settings → Roles → drag → Save). Discord doesn't let a bot move itself.

| Category | Channel | Who sees it | Bot posts |
|---|---|---|---|
| 👋 Start here | `#🔗-link-tag` | Newcomers only (hidden once linked; `/link` only, no chat) | How to link (pinned) |
| | `#📜-rules` | Everyone, read-only | Rules (pinned, kept up to date) |
| 📊 Clan info | `#📊-clan-stats` | Everyone, read-only | Stats board (pinned, after every war) |
| | `#🏆-results` | Members, read-only | Battle day summaries, war results, season recaps |
| | `#🔭-rival-scouting` | Members, read-only | Who we're racing, each new war |
| ⚔️ Clan | `#⚔️-war` | Members, chat | War board, deck reminders |
| | `#💬-general` | Members, chat | Welcomes, promotion congrats, shout-outs |
| | `#🤖-bot-commands` | Members, chat | (for `/mystats`, `/stats`, …) |
| | `🔊 Clan voice` | Members | |
| 🛡️ Leaders | `#🛡️-leaders` | Leader + Co-Leader | To-do list, absences, digest, backups |
| | `#💭-leader-chat` | Leader + Co-Leader | |

Roles `Leader`, `Co-Leader`, `Elder`, `Member` (made if missing, coloured, listed separately). Anyone with Leader or
Co-Leader can use leader commands. Each channel also gets a short pinned note saying what appears there.

## 7. Turn the bot on in the server

1. Site → **Rules** → leader code → **Register Discord commands** → "Done: 20 commands in your server".
2. In Discord: **`/autosetup`** (or **`/autosetup fresh:True`** to start from nothing). It shows the plan and anything to
   fix first. Nothing changes yet.
3. **`/autosetup apply:True`** (add `fresh:True` for a clean start: everything is built new and **all the old
   channels are deleted** in the last step). Then tap **Continue ▶** after each step until it says done (3 steps, or 4
   with fresh).
4. **`/link #YOURTAG`**, then **`/sync`**.

Without `fresh`, it reuses channels it recognises (by name, or because they already have a job) and only adds what's
missing. Later: **`/setup`** shows what goes where; **`/refresh clean:True`** clears the bot's old posts and re-posts
everything.

**Commands**

| Who | Command | What |
|---|---|---|
| Anyone | `/link #TAG`, `/unlink` | Link your Discord to your player; role and nickname follow the game |
| Anyone | `/mystats` | Your full war report (only you see it; `share` to post it) |
| Anyone | `/stats` | Clan stats |
| Anyone | `/season` | Season recap (latest, or `number`) |
| Anyone | `/scout` | The clans we're racing: their recent results vs ours |
| Anyone | `/away 3 holiday` | Away for 3 days: leaders see it, no automatic kick (`/away 0` = back) |
| Anyone | `/remind 3` | Private message 3 hours before reset if you have decks left (`/remind 0` = off) |
| Leaders | `/autosetup` | Roles, channels, permissions and posts, all at once (`apply:True` to do it) |
| Leaders | `/setup`, `/post-here`, `/sync` | Roles, channel jobs, update everyone's roles and nicknames |
| Leaders | `/links`, `/linkuser @who #TAG` | Who's linked; link someone else |
| Leaders | `/todo` | Post or refresh the after-war to-do list |
| Leaders | `/player #TAG`, `/check #TAG` | A member's record; someone applying to join |
| Leaders | `/digest on:True` | Weekly digest privately (last training day): warnings, close to Elder, slipping, away, not linked |
| Leaders | `/refresh` (`clean:True`) | Re-post everything the bot keeps and pin it; `clean` first deletes the bot's old messages in its channels |
| Leaders | `/backup` | Post a backup file of the full history in the leaders' channel now |

"Leaders" means anyone with the Leader or Co-Leader role, or Manage Roles / Administrator in Discord.

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

> Join our Discord! Link with /link #YOURTAG to get your role. /mystats = your war report, /remind 3 = reminder before
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
