# Snowline

Personal PWA: which Sierra ski resort is worth the drive from the Bay Area right now. Fresh snow, drive time, chain controls, ticket price and pass coverage for 19 resorts (Tahoe, Donner Summit, Carson/Ebbetts/Sonora passes, Yosemite, China Peak, Mammoth/June, Mt. Shasta). Thomas uses it on his iPhone home screen.

## Stack & files
- Single-file app: `index.html` (vanilla JS, no build step, no dependencies).
- `manifest.json`, icons, `sw.js` (network-first app shell; bump `CACHE` when shipping — the page reloads itself once when a new version takes over, and checks for updates every time the app comes back to the front).
- `_redirects`: `/proxy/awdb/*` → NRCS SNOTEL API, so station data is fetched server-side by Netlify (no CORS). The app falls back to calling the API directly when the proxy isn't there (local file, other hosts).
- `netlify.toml`: publish dir = repo root; `sw.js` and `index.html` served no-cache.
- `scripts/e2e.mjs`: browser regression suite (Playwright, 390×844, all feeds mocked, clock fixed at 2026-11-30 so open/closed results don't drift).
- Deploy: Netlify, auto-deploy on push to `main`. Same URL = same localStorage (passes, origin, sort survive).

## Data sources
| What | Source | Live? | Notes |
|---|---|---|---|
| 24h/72h snowfall, 7-day chart, modeled base | Open-Meteo forecast API at each resort's mid-mountain elevation | yes | Model, not measured. Retries without rain fields if the API rejects them. |
| Rain at base | Open-Meteo freezing level − 300 m vs `baseElev`, next 24h with precip | yes | Rule of thumb. |
| Measured snow depth (+ "Model only" flag when no station) | NRCS SNOTEL (`awdbRestApi/services/v1`), nearest station within 30 km | yes | Kirkwood, Bear Valley, Dodge Ridge, Mammoth usually have none → "Model only". CDEC stations would fill that gap. |
| Drive time | OSRM public router × departure factor + chain delay | yes | Traffic factor is a guess. Mammoth routed via Minden (Tioga closed in winter). |
| Open / closed | `opens` = 2026-27 announced/projected opening day (all 19); past it = "Open (scheduled)" | no | Not live. Liftie was tried (Build 11–12) but returns HTTP 403 to requests via the Netlify proxy and has no CORS, so it was removed (2026-11-08). Live counts: the Lifts open link. |
| Chain controls | Caltrans CWWP2 D3/D10 JSON | yes | Parser is defensive, format not fully verified. |
| Ticket prices | hardcoded `price`; `ps:"listed"` = OnTheSnow weekday adult 2026-27, else estimate | no | Weekends cost more. |
| Webcams / lift status / tickets | `cam` = OpenSnow slug: `/location/<slug>/cams` and `/snow-report` (lifts open in season + link to the resort's official terrain status); `ticket` deep link or `SITES` domain | — | Links out; cams can't be embedded reliably. |
| Pass coverage | hardcoded `passes` | no | 2026-27 lineups (verified 2026-11-01): Palisades is NOT on Mountain Collective; Indy = Bear Valley, Dodge Ridge, China Peak, Donner Ski Ranch, Mt. Shasta; Cali Pass = Bear Valley, Dodge Ridge, China Peak. Recheck each season. |

Feeds cache 30 min in localStorage; Refresh forces a reload. The status bar shows each feed's state and error text — never hide a failure.

## Rules (carried over from Kiu)
1. **Close the loop, prove it, keep the test.** Every feature or fix: trace each state (feed ok / blocked / rejected / partial, phone vs desktop, light vs dark) to an end the user can see. Add a case to `scripts/e2e.mjs` — write it, see it fail on the old code, then fix. Measure layout, don't eyeball it.
2. **Before pushing:** `node scripts/e2e.mjs` all passing; bump `CACHE` in `sw.js`.
3. Test at 390×844 first. iOS Safari is the target.
4. Honest data: label models as models, estimates as estimates, show where a number came from.
5. **Wrap-up** lists what changed, what to tap on the phone, and what tests covered vs. what only the real phone can confirm.

## User decisions
- 2026-11-03: Best bet = highest Worth it among resorts open by the ski day (Fri 3 pm / Sat 5 am → coming Saturday; Weekday AM → next weekday), ties (e.g. no snow anywhere) → shortest drive. If none: "Nothing is expected to be open by <day>. Earliest: X".
- 2026-11-03: long drives penalized in Worth it: ×1 up to 4 h, sliding to ×0.25 at 7 h+.
- 2026-11-03: open resorts sort to the top, not-yet-open to the bottom, under every sort.

## User decisions (2026-11-01)
- No High/Medium/Low confidence chips: a recommendation is assumed to be as good as its data. Only flag "Model only" (no station within 30 km) and unreliable openings (`flag`).
- Passes start unselected. Departure order: Fri 3 pm, Sat 5 am, Weekday AM.
- Tahoe Donner and Granlibakken left out (small beginner hills).

## Previously fixed bugs (don't regress — each has a test)
- "No live data" banner always visible: standalone page lacked `[hidden]{display:none!important}` and `.key{display:flex}` overrode `hidden`.
- Snow feed failing on a rejected variable (now retries with fewer fields).
- Phone list "jumbled": each row was its own grid with `auto` columns, so stats didn't line up. Phone cards now use fixed `repeat(4,1fr)` with grid areas.
- Worth-it column unreachable on phone → sort bar (`#msort`, `#mdir`) under 760px.
- Best-bet labels truncated ("DAY TIC…") → short labels.
- Best bet stuck on "Waiting for snow and route data…" when no resort had snow (all scores 0): readiness now = snow + route feeds answered, not score > 0.
- Drive time broke across lines ("3h / 52") next to a chain chip → `.dt` nowrap + a space before the chip so the chip wraps instead.

## Working style (user: Thomas)
Casual, direct. Concise numbered answers. Honest, evidence-based; push back when something won't work. Develops and tests from his iPhone only: push changes, he reopens the app. Don't ask him to download or drag files.
