# UI guide

The rules this app's screens and wording follow, and where each comes from.

## Sources

- Nielsen, J. & Molich, R. (1990). *Heuristic evaluation of user interfaces.* CHI '90, 249–256. https://doi.org/10.1145/97243.97281 (Table 1: nine heuristics)
- Molich, R. & Nielsen, J. (1990). *Improving a human-computer dialogue.* Communications of the ACM 33(3), 338–348.
- Nielsen, J. (1994/2005). *10 usability heuristics*, as summarised in NPTEL HCI notes M4L4.
- GOV.UK: plain English is mandatory; use consistent labels. https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-language/

## How they apply here

| Heuristic | What it means here |
|---|---|
| **Speak the user's language** / match the real world | Use the game's words: *war*, *battle day*, *medals*, *decks*, *Elder*. "Last war" / "This war", not "Week end" / "Live". "Can't reach 1800", not "Out" or "Can't make it". |
| **Minimise memory load** / recognition over recall | The battle day is detected, not picked. Tap a name to see their weeks, decks by day, join date and last online. The "Change" menu shows the suggestion ("Suggested: Kick"). |
| **Be consistent** | Each status has one name and one colour everywhere: chips, group headings, the Change menu, chat titles. |
| **Provide feedback** / visibility of status | Done ticks; kicks, demotions and promotions tick themselves when the game shows them. Done rows fade and sink to the bottom of their group. |
| **Provide feedback** (status line) | The status line says when data loaded, "Saved for everyone" or "Saved on this device", and how far back history goes. Training days say so, rather than showing an empty or wrong list. |
| **Simple and natural dialogue** / minimalist design | One sentence summary ("To do: 6 first & only warnings, 1 check-in · 6 done") instead of coloured chips. Each player is two short lines: name and tick, then facts in words ("1450 medals · 9/16 decks") with no column labels. Menus live in the panel under the name. |
| **Simple and natural dialogue** (layout) | Steps in the order they're used: Clan → Who to act on → Chat messages. Rarely used things (Clan log, Rules) are folded. Passed and Excused groups are folded. No explanations unless needed to act. |
| **Clearly marked exits** / user control | Any suggestion can be changed and changed back ("Suggested: …"). Reset rules. |
| **Prevent errors** | Clan tag is checked (O→0). Saving shared data needs the leader code. Other clans are blocked on the hosted site. |
| **Good error messages** | Say what to do: "Check the clan tag", "Enter the leader code to save", "This site only works for its own clan." |
| **Shortcuts** | Opening the link loads the clan straight away. `#CLANTAG` in the link picks the clan. |

## Words

| Status | Shown as |
|---|---|
| Kick | Kick |
| Demote | Demote |
| Warn | First & only warning |
| Check | Check on them |
| Review | Leaders decide |
| Promote | Promote to Elder |
| OK | Passed |
| Excused | Excused |
| Out | Can't reach 1800 |
| Need | Still needs medals |
| Safe | Reached 1800 |

## Display options (Aa button)

Each option rests on a standard or established guidance, and is saved on that device only. "Auto" follows the
phone's own setting.

| Option | Choices | Basis |
|---|---|---|
| Layout | Cards · Compact · Table | Cards suit reviewing one record at a time, lists suit fast scanning, tables suit comparing records ([Smart Interface Design Patterns](https://smart-interface-design-patterns.com/articles/cards-vs-lists-vs-tables-vs-data-grids/); [uxdesign.cc](https://uxdesign.cc/how-to-design-data-tables-for-phones-7ed6b04da10)) |
| Order within each group | Suggested · Most medals · Name | Recognition over recall: find a name, or see the strongest first |
| Theme | Auto · Light · Dark | `prefers-color-scheme`, with a manual override ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Using_for_accessibility)) |
| Contrast | Auto · High | `prefers-contrast` ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-contrast)); WCAG 1.4.3/1.4.6 contrast |
| Text size | Normal · Large · Larger | WCAG 1.4.4 Resize Text: enlarged without loss of content |
| Colours | Standard · Colour-blind safe | WCAG 1.4.1 Use of Color; Okabe & Ito's colour-blind-safe palette (blue / vermillion / reddish purple) |
| Motion | Auto · Reduce | `prefers-reduced-motion` ([MDN](https://developer.mozilla.org/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)); WCAG 2.3.3 |

