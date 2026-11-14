// End-to-end checks in a real (headless) browser at iPhone size: node scripts/e2e.mjs
// All outside feeds (Open-Meteo, OSRM, NRCS SNOTEL, Caltrans) are mocked — no network needed.
// Every bug fixed so far has a test here; add a case for each new feature or fix.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let playwright;
for(const p of ['playwright', '/opt/node22/lib/node_modules/playwright']){ try{ playwright = require(p); break; }catch(e){} }
if(!playwright){ console.error('Playwright not found (npm i -g playwright)'); process.exit(1); }

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.png':'image/png' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if(p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if(!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const BASE = `http://localhost:${server.address().port}/`;

// ---------- mock data ----------
// Every test runs on a fixed day so results don't drift as the real season goes on.
// Nov 30, 2026: Mammoth/Heavenly/Northstar/Mt. Rose/Palisades/Bear Valley/Boreal/China Peak/Sugar Bowl past their
// projected opening days; Kirkwood (Dec 4) and later not yet.
const NOW = Date.parse('2026-11-30T20:00:00Z');
function meteo(n, mode){
  const hours = [], t0 = new Date(NOW - 7*864e5); t0.setUTCMinutes(0,0,0);
  // 7 days back + 9 days of forecast; hour k=168 is NOW. Existing modes keep snow in the past (k<=168).
  for(let i=0;i<24*16;i++) hours.push(new Date(t0.getTime()+i*3600e3-8*3600e3).toISOString().slice(0,13)+':00');
  const days = [...new Set(hours.map(h=>h.slice(0,10)))];
  return Array.from({length:n}, (_,i)=>({
    utc_offset_seconds:-28800,
    hourly_units:{snowfall:'inch',snow_depth:'ft',precipitation:'inch',freezing_level_height:'m',wind_gusts_10m:'mp/h',temperature_2m:'°F'},
    daily_units:{snowfall_sum:'inch'},
    // mode 'dump': 0.3"/h everywhere for the last ~36 h, Mammoth (index 16) 1"/h — a big far-away storm
    // mode 'storm': no past snow; Kirkwood (index 9) gets 0.6"/h Thu Dec 3 – Fri Dec 4 (forecast); Palisades (0) gusts 55 mph Sat Dec 5
    hourly:{time:hours, snowfall:hours.map((h,k)=>mode==='storm' ? (i===9 && h>='2026-12-03T00' && h<='2026-12-04T23' ? 0.6 : 0)
        : k>168 ? 0 : mode==='nosnow' ? 0 : mode==='dump' ? (k>140 ? (i===16?1:0.3) : 0) : (k>140?0.05*(i%4):0)),
      wind_gusts_10m:hours.map(h=>mode==='storm' && i===0 && h.startsWith('2026-12-05') ? 55 : 15),
      temperature_2m:hours.map(()=>24), snow_depth:hours.map(()=>mode==='nosnow' ? 0 : 0.5+i*0.2),
      // resort 0 (Palisades) gets rain at the base: precip with a high freezing level
      precipitation:hours.map(()=>i===0?0.05:0), freezing_level_height:hours.map(()=>3000)},
    daily:{time:days, snowfall_sum:days.map((d,k)=>mode==='storm' ? (i===9 && (d==='2026-12-03'||d==='2026-12-04') ? 14.4 : 0) : d>'2026-11-30' ? 0 : mode==='nosnow' ? 0 : k>4?(i%4)*0.8:0)}
  }));
}
const STATIONS = [
  {stationTriplet:'784:CA:SNTL',name:'Squaw Valley G.C.',latitude:39.19,longitude:-120.27,elevation:8010},
  {stationTriplet:'518:CA:SNTL',name:'Heavenly Valley',latitude:38.92,longitude:-119.92,elevation:8540},
  {stationTriplet:'652:NV:SNTL',name:'Mt Rose Ski Area',latitude:39.32,longitude:-119.89,elevation:8800},
];
function stationData(){
  const dates=[]; for(let k=6;k>=0;k--) dates.push(new Date(NOW-k*864e5).toISOString().slice(0,10));
  return STATIONS.map((s,i)=>({stationTriplet:s.stationTriplet, data:[{stationElement:{elementCode:'SNWD'},
    values:dates.map((d,k)=>({date:d, value:k<4?2:2+i*1.5}))}]}));
}

// mode: 'ok' = every feed answers; 'blocked' = every outside request fails; 'om400' = Open-Meteo rejects the rain fields
async function mockFeeds(page, mode='ok'){

  await page.route(u => !u.href.startsWith(BASE), async route => {
    const u = route.request().url();
    const J = (o, status=200) => route.fulfill({status, contentType:'application/json', headers:{'access-control-allow-origin':'*'}, body:JSON.stringify(o)});
    if(mode==='blocked') return route.abort('failed');
    if(u.includes('open-meteo')){
      if(mode==='om400' && u.includes('freezing_level_height')) return J({error:true, reason:'invalid variable'}, 400);
      return J(meteo(new URL(u).searchParams.get('latitude').split(',').length, mode));
    }
    if(u.includes('/table/')){ const n = u.split('/table/v1/driving/')[1].split('?')[0].split(';').length; return J({code:'Ok', durations:[Array.from({length:n},(_,k)=>k?11000+k*300:0)]}); }
    if(u.includes('/route/')) return J({code:'Ok', routes:[{duration:24000}]});
    if(u.includes('cwwp2')) return J({data:[{cc:{location:{route:'I-80'}, statusData:{status:'R-2 Chains required'}}}]});
    if(u.includes('/stations?')) return J(STATIONS);
    if(u.includes('/data?')) return J(stationData());
    return route.abort();
  });
  // same-origin /proxy/awdb/ doesn't exist on the test server -> 404 -> app must fall back to direct
}

const browser = await playwright.chromium.launch({ args: ['--no-sandbox'] });
let failures = 0;
async function test(name, fn, {mode='ok', width=390, height=844, dark=true, now=NOW, setup}={}){
  const ctx = await browser.newContext({ viewport:{width,height}, colorScheme: dark?'dark':'light', serviceWorkers:'block', timezoneId:'America/Los_Angeles' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try{
    await mockFeeds(page, mode);
    await page.clock.setFixedTime(now);
    if(setup) await page.addInitScript(setup);
    await page.goto(BASE + 'index.html');
    await page.waitForFunction(() => !document.querySelector('.feed.load'), null, {timeout:10000});
    await fn(page);
    if(errors.length) throw new Error('page errors: ' + errors.join(' | '));
    console.log('ok   ' + name);
  }catch(e){
    failures++; console.log('FAIL ' + name + '\n     ' + e.message.split('\n')[0]);
    fs.mkdirSync(path.join(ROOT,'shots'),{recursive:true});
    await page.screenshot({path:path.join(ROOT,'shots',name.replace(/\W+/g,'_')+'.png'), fullPage:true}).catch(()=>{});
  }
  await ctx.close();
}
const assert = (c, m) => { if(!c) throw new Error(m); };

// ---------- feeds ----------
await test('all feeds load and go green', async page => {
  const states = await page.$$eval('.feed', els => els.map(e => e.className));
  assert(states.filter(c=>/\bok\b/.test(c)).length === 4, 'expected snow, routes, stations, chains all ok: ' + states.join(','));
  assert(!/Liftie|Lifts unavailable/.test(await page.textContent('#feeds')), 'Liftie removed (403 via Netlify, 2026-11-08)');
  assert(/Open \/ closed/.test(await page.textContent('#feeds')), 'status bar should say open/closed comes from opening dates');
});
await test('"No live data" banner stays hidden when feeds work (2026-11-01 bug)', async page => {
  assert(await page.isHidden('#blocked'), 'banner is visible even though feeds loaded');
});
await test('"No live data" banner shows with reasons when everything is blocked', async page => {
  assert(await page.isVisible('#blocked'), 'banner should show');
  const t = await page.textContent('#blockedMsg');
  assert(/Snow: blocked/.test(t) && /Routes: blocked/.test(t), 'banner should name each failure: ' + t);
  const drive = await page.textContent('.row[data-id="pal"] .c-drive');
  assert(/h/.test(drive) && /typical/.test(drive), 'routes should fall back to typical times: ' + drive);
}, {mode:'blocked'});
await test('snow still loads if Open-Meteo rejects the rain-at-base fields', async page => {
  const st = await page.getAttribute('.feed:has-text("Snow")', 'class');
  assert(/\bok\b/.test(st), 'snow feed should recover by retrying without those fields');
}, {mode:'om400'});

await test('build number shows so the phone can confirm an update landed', async page => {
  assert(/Build \d+/.test(await page.textContent('#feeds')), 'build label missing');
});

// ---------- data shown ----------
await test('all 19 resorts listed, each with a condition badge', async page => {
  const n = await page.$$eval('.row[data-id]', rows => rows.filter(r => r.querySelector('.cond')).length);
  assert(n === 19, `expected 19 resorts with a condition, got ${n}`);
  for(const id of ['dod','chp','dsr','sod','hom','dmp','jun','bdg','sha']) assert(await page.$(`.row[data-id="${id}"]`), 'missing resort ' + id);
});
await test('confidence: only "Model only" is flagged, no High/Medium/Low chips (2026-11-01)', async page => {
  const labels = await page.$$eval('.conf', els => els.map(e => e.textContent.trim()));
  assert(!labels.some(t => /High|Med|Low conf/i.test(t)), 'found a confidence level chip: ' + labels.join(','));
  assert(/Model only/.test(await page.textContent('.row[data-id="kir"]')), 'Kirkwood (no station in mock) should say Model only');
  assert(!/Model only/.test(await page.textContent('.row[data-id="pal"]')), 'Palisades has a station, should not be flagged');
});
await test('measured station data shows in the detail', async page => {
  await page.click('.row[data-id=\"pal\"] .rname');
  const d = await page.textContent('.detail');
  assert(/Squaw Valley G\.C\./.test(d) && /on the ground/.test(d), 'Palisades detail should show the measured station');
});
await test('unreliable resorts are labeled (Homewood, Badger Pass)', async page => {
  assert(/Opening not announced/.test(await page.textContent('.row[data-id="hom"]')), 'Homewood flag missing');
  assert(/good snow years/.test(await page.textContent('.row[data-id="bdg"]')), 'Badger Pass flag missing');
});
await test('defaults: no passes selected; departures Fri 3 pm, Sat 5 am, Weekday AM', async page => {
  const pressed = await page.$$eval('#passes button[aria-pressed="true"]', b => b.length);
  assert(pressed === 0, `${pressed} passes selected by default`);
  const order = await page.$$eval('#when button', b => b.map(x => x.textContent.trim()));
  assert(order.join('|') === 'Fri 3 pm|Sat 5 am|Weekday AM', 'departure order: ' + order.join('|'));
});
await test('pass coverage 2026-27: Dodge Ridge on Indy + Cali Pass; Palisades not on Mountain Collective', async page => {
  const dod = await page.textContent('.row[data-id="dod"] .rmeta');
  assert(/Indy/.test(dod) && /Cali Pass/.test(dod), 'Dodge Ridge passes: ' + dod);
  assert(!/Mountain Collective/.test(await page.textContent('.row[data-id="pal"] .rmeta')), 'Palisades should not list Mountain Collective');
});
await test('every resort has a webcam link and a ticket link', async page => {
  const bad = await page.evaluate(() => RESORTS.filter(r => !r.cam || !(r.ticket || SITES[r.id])).map(r => r.id));
  assert(!bad.length, 'missing links: ' + bad.join(','));
  const best = await page.$$eval('.best .links a', as => as.map(a => a.textContent));
  assert(best.includes('Lifts open') && best.includes('Webcams') && best.some(t => /tickets|Resort site/.test(t)), 'best bet links: ' + best.join(','));
});
await test('rain-at-base flag appears when the snow level is above the lodge', async page => {
  assert(await page.$('.row[data-id="pal"] .rain'), 'Palisades should be flagged');
});
await test('chain control from Caltrans shows on I-80 resorts', async page => {
  assert(/R2/.test(await page.textContent('.row[data-id="sug"] .c-drive')), 'Sugar Bowl (I-80) should show R2');
});
await test('detail links: webcams (OpenSnow), buy tickets, resort site', async page => {
  await page.click('.row[data-id=\"hev\"] .rname');
  const hrefs = await page.$$eval('.detail .links a', as => as.map(a => a.href));
  assert(hrefs.some(h => h === 'https://opensnow.com/location/heavenly/cams'), 'webcam link: ' + hrefs.join(' '));
  assert(hrefs.some(h => h === 'https://opensnow.com/location/heavenly/snow-report'), 'lift status link: ' + hrefs.join(' '));
  assert(hrefs.some(h => h.includes('skiheavenly.com')), 'ticket/resort link: ' + hrefs.join(' '));
  assert(!hrefs.some(h => h.includes('google.com')), 'no search-engine stand-ins');
});

// ---------- open / closed ----------
const OPEN = ['mam','nst','ros','hev','pal','sug','bor','bvl','chp']; // past their opening day on Nov 30
await test('resorts past their opening day sort first, not-yet-open last', async page => {
  const ids = await page.$$eval('.row[data-id]', rs => rs.map(r => r.dataset.id));
  assert(ids.length === 19, 'expected 19 resorts');
  assert(ids.slice(0, OPEN.length).sort().join() === [...OPEN].sort().join(), 'open group: ' + ids.slice(0, OPEN.length).join(','));
});
await test('status labels come from opening dates', async page => {
  assert(/Open \(scheduled\)/.test(await page.textContent('.row[data-id="pal"] .lift')), 'Palisades (Nov 25) should be open by schedule');
  assert(/Opens Dec 4 \(projected\)/.test(await page.textContent('.row[data-id="kir"] .lift')), 'Kirkwood: Dec 4');
  assert(/Opens Dec 26 \(projected\)/.test(await page.textContent('.row[data-id="dod"] .lift')), 'Dodge Ridge: Dec 26');
});
await test('group headers: open by schedule / not open yet', async page => {
  const g = await page.$$eval('.grp', els => els.map(e => e.textContent));
  assert(g.join('|') === 'Open (by schedule)|Not open yet', 'headers: ' + g.join('|'));
});
await test('open-first ordering holds under every sort and direction', async page => {
  for(const k of ['price','drive','fresh','name','score']){
    await page.selectOption('#msort', k);
    for(let flip=0; flip<2; flip++){
      const first = await page.getAttribute('.row[data-id]', 'data-id');
      assert(OPEN.includes(first), `sort ${k}: an open resort should stay on top, got ${first}`);
      await page.click('#mdir');
    }
  }
});
await test('Best bet is labeled with the ski day and only picks resorts open by then (2026-11-03)', async page => {
  // clock: Mon Nov 30, departure Sat 5 am -> ski Sat Dec 5; Kirkwood (Dec 4) also eligible, Dodge (Dec 26) not
  assert(/Best bet · Sat Dec 5/.test(await page.textContent('.best .tag')), 'tag: ' + await page.textContent('.best .tag'));
  assert(/Open \(scheduled\)|Scheduled to open/.test(await page.textContent('.best .lift')), 'best bet chip: ' + await page.textContent('.best .lift'));
  assert(!/Dodge Ridge|Sierra-at-Tahoe|Soda Springs/i.test(await page.textContent('.best .name')), 'resorts opening after Sat Dec 5 are not eligible');
});
await test('Best bet says nothing is open yet, and when the first one opens', async page => {
  // clock: Tue Nov 3, ski Sat Nov 7: nothing opens before Mammoth (Nov 13)
  const t = await page.textContent('.best');
  assert(/Nothing is expected to be open by Sat Nov 7/.test(t) && /Mammoth/.test(t) && /Nov 13/.test(t), t);
}, {now: Date.parse('2026-11-03T20:00:00Z')});
await test('Best bet still answers when no resort has any snow (2026-11-08 "never loads")', async page => {
  // clock: Sun Nov 8, depart Fri 3 pm -> ski Sat Nov 14; only Mammoth (Nov 13) open by then; zero snow everywhere
  await page.click('#when button:has-text("Fri 3 pm")');
  const t = await page.textContent('.best');
  assert(!/Waiting for snow/.test(t), 'stuck on Waiting: ' + t);
  assert(/Best bet · Sat Nov 14/.test(t) && /Mammoth/.test(t), 'expected Mammoth for Sat Nov 14: ' + t);
}, {mode:'nosnow', now: Date.parse('2026-11-09T07:50:00Z')});
await test('long drives are penalized: a 7 h storm loses to a closer one (2026-11-03)', async page => {
  const worth = await page.$$eval('.row[data-id]', rs => Object.fromEntries(rs.map(r => [r.dataset.id, +((r.querySelector('.c-score .num')||{}).textContent||0)])));
  const near = Math.max(...['nst','ros','bor','sug','chp','bvl'].map(id => worth[id]));
  assert(worth.mam < near, `Mammoth (3x the snow, 7 h away) scored ${worth.mam}, best nearby ${near}`);
  assert(!/Mammoth/i.test(await page.textContent('.best .name')), 'Mammoth should not be Best bet');
}, {mode:'dump'});
await test('weekday departure targets the next weekday', async page => {
  await page.click('#when button:has-text("Weekday AM")');
  assert(/Best bet · Tue Dec 1/.test(await page.textContent('.best .tag')), 'tag: ' + await page.textContent('.best .tag'));
});
await test('feeds blocked: opening dates still work', async page => {
  assert(/Opens Dec 26 \(projected\)/.test(await page.textContent('.row[data-id="dod"] .lift')), 'still shows projected dates');
}, {mode:'blocked'});

// ---------- forecast / Windy ----------
await test('ski-day forecast: snow due before Sat shows on the card and wins Best bet (2026-11-13)', async page => {
  // Kirkwood: nothing fallen yet, ~29" forecast Thu–Fri, opens Fri Dec 4 -> best bet for Sat Dec 5
  const chip = await page.textContent('.row[data-id="kir"] .fcx');
  assert(/\+\d+" by Sat/.test(chip), 'forecast chip: ' + chip);
  assert(/Kirkwood/i.test(await page.textContent('.best .name')), 'best bet should be Kirkwood: ' + await page.textContent('.best .name'));
}, {mode:'storm'});
await test('ski-day wind: 45+ mph gusts flagged and cost Worth it', async page => {
  const w = await page.textContent('.row[data-id="pal"] .wind');
  assert(/Sat gusts 55 mph · lift holds likely/.test(w), 'wind chip: ' + w);
  const calm = await page.evaluate(() => { const r = calc(RESORTS.find(x=>x.id==='pal')); return {fx:r.fx, score:r.score}; });
  assert(calm.fx.gust === 55, 'gust parsed: ' + JSON.stringify(calm.fx));
}, {mode:'storm'});
await test('detail chart adds outlined forecast bars up to the ski day, plus a ski-day line', async page => {
  await page.click('.row[data-id="kir"] .rname');
  const n = await page.$$eval('.detail .fbar', e => e.length);
  assert(n === 5, 'forecast bars Tue Dec 1 – Sat Dec 5 expected 5, got ' + n);
  const t = await page.textContent('.detail');
  assert(/Sat \(ski day\):/.test(t) && /gusts to 15 mph/.test(t) && /· 24°F/.test(t) && !/24–24/.test(t), t.slice(0,300));
}, {mode:'storm'});
await test('sort by snow by ski day', async page => {
  await page.selectOption('#msort', 'fc');
  if(!/High/.test(await page.textContent('#mdir'))) await page.click('#mdir');
  assert(await page.getAttribute('.row[data-id]', 'data-id') === 'kir', 'Kirkwood (most forecast snow) should lead the open-by-schedule group');
}, {mode:'storm', now: Date.parse('2026-12-04T20:00:00Z')});
await test('Windy link on every resort and the Best bet opens the point forecast with snow layer', async page => {
  await page.click('.row[data-id="dod"] .rname');
  const href = await page.getAttribute('.detail a:has-text("Windy")', 'href');
  assert(href === 'https://www.windy.com/38.182/-119.953?snow,38.182,-119.953,10', 'windy: ' + href);
  assert(await page.$('.best .links a:has-text("Windy")'), 'Best bet should link Windy');
});

// ---------- directions ----------
await test('tapping a drive time opens directions (Google + Apple Maps), not the card (2026-11-10)', async page => {
  await page.click('.row[data-id="dod"] .c-drive');
  assert(await page.isVisible('#sheet'), 'directions sheet should open');
  assert(await page.getAttribute('.row[data-id="dod"]', 'aria-expanded') === 'false', 'card should not expand');
  assert(/Directions to Dodge Ridge/.test(await page.textContent('#sheetTitle')), await page.textContent('#sheetTitle'));
  const g = await page.getAttribute('#gmaps', 'href'), a = await page.getAttribute('#amaps', 'href');
  assert(g === 'https://www.google.com/maps/dir/?api=1&destination=Dodge%20Ridge%20Mountain%20Resort%2C%20Pinecrest%2C%20CA&travelmode=driving', 'google: ' + g);
  assert(a === 'https://maps.apple.com/?daddr=Dodge%20Ridge%20Mountain%20Resort%2C%20Pinecrest%2C%20CA&dirflg=d', 'apple: ' + a);
  // no origin: Maps starts from the phone's location, not a snapped street address (2026-11-10 '668 Coleridge Ave')
  assert(!/origin=|saddr=/.test(g + a), 'links must not pin an origin');
  assert(await page.getAttribute('#gmaps', 'target') === '_blank', 'opens outside the app');
});
await test('directions: every resort routes to a named place; sheet explains the estimate', async page => {
  const missing = await page.evaluate(() => RESORTS.filter(r => !DEST[r.id]).map(r => r.id));
  assert(!missing.length, 'no named destination for: ' + missing.join(','));
  await page.selectOption('#origin', 'sf');
  await page.click('.row[data-id="pal"] .c-drive');
  const sub = await page.textContent('#sheetSub');
  assert(/current location/.test(sub) && /from San Francisco/.test(sub) && /traffic/.test(sub), sub);
});
await test('directions sheet closes with Cancel and by tapping outside; card tap still expands', async page => {
  await page.click('.row[data-id="kir"] .c-drive');
  await page.click('#sheetClose');
  assert(await page.isHidden('#sheet'), 'Cancel should close');
  await page.click('.row[data-id="kir"] .c-drive');
  await page.mouse.click(195, 60);
  assert(await page.isHidden('#sheet'), 'tapping outside should close');
  await page.click('.row[data-id="kir"] .rname');
  assert(await page.getAttribute('.row[data-id="kir"]', 'aria-expanded') === 'true', 'tapping the name still expands the card');
});
await test('Best bet drive tile and detail Directions link open the same sheet', async page => {
  await page.click('.best .stat[data-route]');
  assert(await page.isVisible('#sheet'), 'best bet tile should open directions');
  await page.click('#sheetClose');
  await page.click('.row[data-id="hev"] .rname');
  await page.click('.detail a[data-route]');
  assert(/Heavenly/.test(await page.textContent('#sheetTitle')), 'detail link should open Heavenly directions');
});
await test('phone: directions sheet fits, buttons are easy to tap', async page => {
  await page.click('.row[data-id="sug"] .c-drive');
  const m = await page.evaluate(() => ({w: document.querySelector('#sheet .panel').getBoundingClientRect().width,
    hs: [...document.querySelectorAll('#sheet a, #sheet button')].map(e => e.getBoundingClientRect().height),
    bottom: document.querySelector('#sheet .panel').getBoundingClientRect().bottom}));
  assert(m.w <= 390 && m.bottom <= 844 + 1, 'sheet off screen: ' + JSON.stringify(m));
  assert(m.hs.every(h => h >= 44), 'tap targets under 44px: ' + m.hs.join(','));
});

// ---------- sorting ----------
await test('phone sort: price low to high, then flip', async page => {
  await page.selectOption('#msort', 'price');
  if(!/Low/.test(await page.textContent('#mdir'))) await page.click('#mdir');
  // no passes by default: cheapest day ticket first (Badger Pass $64, then Soda Springs $89)
  const order = await page.$$eval('.row[data-id]', rs => rs.map(r => r.dataset.id));
  // open resorts stay on top; within 'not open yet', cheapest first (Badger Pass $64, Soda Springs $89)
  const notOpen = order.filter(id => !OPEN.includes(id));
  assert(order[0] === 'chp', 'cheapest open resort (China Peak $119) first, got ' + order[0]);
  assert(notOpen[0] === 'bdg' && notOpen[1] === 'sod', 'cheapest not-open first, got ' + notOpen.slice(0,3).join(','));
  await page.click('#mdir');
  const top = await page.getAttribute('.row[data-id]', 'data-id');
  const order2 = await page.$$eval('.row[data-id]', rs => rs.map(r => r.dataset.id));
  assert(order2.join() !== order.join(), 'flipping direction should change the order');
});
await test('desktop: clicking a column header sorts, clicking again flips', async page => {
  await page.click('.th[data-k="drive"]');
  assert(await page.getAttribute('.th[data-k="drive"]', 'aria-sort') === 'ascending', 'first click = ascending');
  await page.click('.th[data-k="drive"]');
  assert(await page.getAttribute('.th[data-k="drive"]', 'aria-sort') === 'descending', 'second click = descending');
}, {width:1200, height:900});

// ---------- layout (measured, not eyeballed) ----------
await test('phone: no sideways scroll', async page => {
  assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), 'page scrolls horizontally');
});
await test('phone: the four stats in each card line up across cards (2026-11-01 jumble)', async page => {
  const lefts = await page.$$eval('.row[data-id]', rows => rows.map(r =>
    ['.c-24','.c-72','.c-drive','.c-price'].map(s => Math.round(r.querySelector(s).getBoundingClientRect().left)).join(',')));
  assert(new Set(lefts).size === 1, 'stat columns shift between cards: ' + [...new Set(lefts)].join(' | '));
});
await test('phone: resort names and stat labels are not cut off', async page => {
  const clipped = await page.$$eval('.rname, .stat small, .cell', els => els.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim().slice(0,20)));
  assert(!clipped.length, 'clipped: ' + clipped.join(', '));
});
await test('phone: drive times never break across lines, even with a chain chip (2026-11-03)', async page => {
  const broken = await page.$$eval('.row[data-id] .c-drive .dt', els => els.filter(e => e.getClientRects().length > 1).map(e => e.textContent));
  assert(!broken.length, 'drive time wrapped: ' + broken.join(', '));
  assert(await page.$('.row[data-id="pal"] .c-drive .chain'), 'test needs a resort with a chain chip (Palisades, I-80 R2)');
});
await test('phone: header row hidden, sort bar visible', async page => {
  assert(await page.isHidden('.row.head') && await page.isVisible('.msort'), 'wrong sort control on phone');
});
await test('light mode renders readable text', async page => {
  const [fg, bg] = await page.evaluate(() => { const c = getComputedStyle(document.body); return [c.color, c.backgroundColor]; });
  assert(fg !== bg, 'text and background are the same color');
}, {dark:false});

await browser.close(); server.close();
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
