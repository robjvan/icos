# Multi-Platform Sweeps

"What are people saying about X" / "research X across the web" is not one
`web_search`. Fan out across source types, collect in parallel, then synthesise
with every claim attributed to the platform it came from:

| Source type | Route | What it adds |
|---|---|---|
| Open web | `web_search` → `web_extract` | official docs, articles, announcements |
| Community discussion | `reddit-reading` (`search`, `thread`) | real user experience, complaints, workarounds |
| Blogs / releases / changelogs | `rss-feeds` (`read`, `discover`) | dated primary posts, version history |
| Video | `youtube-content` | walkthroughs, demos, talks |
| Code | `terminal` with `gh search repos` / `gh search issues` | implementations, open bugs |
| X/Twitter | `xurl` (needs API access) | announcements, developer chatter |

The `reddit-reading` and `rss-feeds` skills ship with ICOS
(`skills/social-media/reddit-reading`, `skills/research/rss-feeds`).

Register every URL from every route in the ledger as it arrives (step ②). Keep
opinion and measurement apart: a Reddit thread is evidence that users *report*
something, not that it is true; pair it with a primary source or label it as
sentiment. Report per-platform coverage gaps ("Reddit search returned nothing
newer than March") rather than silently narrowing to what worked.
