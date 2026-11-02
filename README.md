# Snowline

Which Sierra resort is worth the drive from the Bay right now. Static PWA, no build.

## Deploy (Netlify, auto on push)
1. Netlify → Add new site → Import from Git → pick this repo. Build command: none. Publish directory: `.`
   (Or, to keep an existing site's URL: Site configuration → Build & deploy → Link repository.)
2. iPhone: open the site in Safari → Share → Add to Home Screen.

Every push to `main` redeploys the same URL. The installed app picks up the new version the next time you bring it to the front.

## Test
    node scripts/e2e.mjs     # Playwright + Chromium, iPhone size, all feeds mocked

## Shipping a change
Bump `CACHE` in `sw.js`.
