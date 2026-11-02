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
const RESORT_COUNT = 11;
function meteo(){
  const hours = [], t0 = new Date(Date.now() - 7*864e5); t0.setUTCMinutes(0,0,0);
  for(let i=0;i<24*9;i++) hours.push(new Date(t0.getTime()+i*3600e3-8*3600e3).toISOString().slice(0,13)+':00');
  const days = [...new Set(hours.map(h=>h.slice(0,10)))];
  return Array.from({length:RESORT_COUNT}, (_,i)=>({
    utc_offset_seconds:-28800,
    hourly_units:{snowfall:'inch',snow_depth:'ft',precipitation:'inch',freezing_level_height:'m'},
    daily_units:{snowfall_sum:'inch'},
    hourly:{time:hours, snowfall:hours.map((_,k)=>k>140?0.05*(i%4):0), snow_depth:hours.map(()=>0.5+i*0.2),
      // resort 0 (Palisades) gets rain at the base: precip with a high freezing level
      precipitation:hours.map(()=>i===0?0.05:0), freezing_level_height:hours.map(()=>3000)},
    daily:{time:days, snowfall_sum:days.map((_,k)=>k>4?(i%4)*0.8:0)}
  }));
}
const STATIONS = [
  {stationTriplet:'784:CA:SNTL',name:'Squaw Valley G.C.',latitude:39.19,longitude:-120.27,elevation:8010},
  {stationTriplet:'518:CA:SNTL',name:'Heavenly Valley',latitude:38.92,longitude:-119.92,elevation:8540},
  {stationTriplet:'652:NV:SNTL',name:'Mt Rose Ski Area',latitude:39.32,longitude:-119.89,elevation:8800},
];
function stationData(){
  const dates=[]; for(let k=6;k>=0;k--) dates.push(new Date(Date.now()-k*864e5).toISOString().slice(0,10));
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
      return J(meteo());
    }
    if(u.includes('/table/')) return J({code:'Ok', durations:[[0,12000,12300,11400,11100,12900,12600,14400,15000,12300,11700]]});
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
async function test(name, fn, {mode='ok', width=390, height=844, dark=true}={}){
  const ctx = await browser.newContext({ viewport:{width,height}, colorScheme: dark?'dark':'light', serviceWorkers:'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try{
    await mockFeeds(page, mode);
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

// ---------- data shown ----------
await test('every resort shows a condition badge and confidence chip', async page => {
  const n = await page.$$eval('.row[data-id]', rows => rows.filter(r => r.querySelector('.cond') && r.querySelector('.conf')).length);
  assert(n === 11, `only ${n}/11 resorts have both badges`);
});
await test('station-backed resort explains its confidence; others say model only', async page => {
  await page.click('.row[data-id="pal"]');
  const d = await page.textContent('.detail');
  assert(/Squaw Valley G\.C\./.test(d) && /on the ground/.test(d), 'Palisades detail should show the measured station');
  assert(/confidence|conf\./i.test(d), 'confidence explanation missing');
  const kir = await page.textContent('.row[data-id="kir"] .conf');
  assert(/Model only/.test(kir), 'Kirkwood has no station in the mock, should say Model only: ' + kir);
});
await test('rain-at-base flag appears when the snow level is above the lodge', async page => {
  assert(await page.$('.row[data-id="pal"] .rain'), 'Palisades should be flagged');
});
await test('chain control from Caltrans shows on I-80 resorts', async page => {
  assert(/R2/.test(await page.textContent('.row[data-id="sug"] .c-drive')), 'Sugar Bowl (I-80) should show R2');
});
await test('live links open the resort site and snow report', async page => {
  await page.click('.row[data-id="hev"]');
  const hrefs = await page.$$eval('.detail .links a', as => as.map(a => a.href));
  assert(hrefs.some(h => h.includes('skiheavenly.com')) && hrefs.some(h => /snow%20report|snow\+report/.test(h)), hrefs.join(' '));
});

// ---------- sorting ----------
await test('phone sort: price low to high, then flip', async page => {
  await page.selectOption('#msort', 'price');
  if(!/Low/.test(await page.textContent('#mdir'))) await page.click('#mdir');
  // default pass is Ikon: on-pass resorts cost $0 and come first, then the cheapest day ticket (Boreal $119)
  const order = await page.$$eval('.row[data-id]', rs => rs.map(r => r.dataset.id));
  assert(['mam','pal','sat'].includes(order[0]), 'an Ikon resort should be first, got ' + order[0]);
  assert(order[3] === 'bor', 'cheapest day ticket (Boreal) should follow the 3 Ikon resorts, got ' + order.join(','));
  await page.click('#mdir');
  const top = await page.getAttribute('.row[data-id]', 'data-id');
  assert(top !== 'bor', 'flipping direction should change the order');
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
