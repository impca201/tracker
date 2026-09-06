const fs = require('fs');
const nodemailer = require('nodemailer');
const config = require('./config');
const { fetchStationList, fetchStationReturns } = require('./roadsurfer-api');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Hard limit for a single run. A hung network handle must never keep the job
// alive until the GitHub Actions timeout, because that skips the history commit.
const WATCHDOG_MINUTES = 25;

// Populated at the start of run() from the live station list. Cities are
// configured by name (see config.js) precisely because Roadsurfer's numeric
// station IDs have been observed to shift over time, so nothing here is
// hardcoded — every run resolves names against whatever the API currently
// reports.
let stationsById = new Map();

function saveHistory(historySet) {
  fs.writeFileSync('history.json', JSON.stringify([...historySet].sort(), null, 2));
}

// Used only for the small number of failures fatal enough to exit before
// the normal end-of-run email logic runs (currently: can't even fetch the
// live station list). Without this, a persistent failure here would exit
// silently — no email, nothing but a GitHub Actions log nobody checks
// routinely, which is exactly the kind of quiet failure this tracker
// exists to avoid.
async function sendFatalErrorEmail(message) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
  });
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_TO,
      subject: '⚠️ Camper Tracker: run aborted',
      html: `<p>Hi!</p><p>The tracker run stopped before it could check any routes:</p><p style="font-family:monospace;">${message}</p>`
    });
  } finally {
    transporter.close();
  }
}

function getStationById(id) {
  return stationsById.get(Number(id)) || { name: `Station ${id}`, country: '??', countryName: '' };
}

function formatDate(dateString) {
  const d = new Date(dateString);
  return `${d.getUTCDate().toString().padStart(2, '0')}-${(d.getUTCMonth() + 1).toString().padStart(2, '0')}-${d.getUTCFullYear()}`;
}

function formatRouteLabel(routeId) {
  if (!routeId) return 'General error';
  const [fromId, toId] = routeId.split('-').map(Number);
  const from = getStationById(fromId);
  const to = getStationById(toId);
  return `${from.name} (${from.country}) -> ${to.name} (${to.country})`;
}

async function fetchQuiet(url, routeId, errors, retries = config.settings.maxRetries || 3) {
  for (let i = 0; i < retries; i++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "x-requested-alias": "rally.timeframes",
          "Accept": "application/json"
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          const msg = `Unexpected content-type "${contentType}" for route ${routeId}`;
          errors.push({ routeId, status: res.status, message: msg });
          return null;
        }
        return await res.json();
      } else {
        let msg = `API status ${res.status} for ${url}`;
        if (res.status === 429) {
          msg = `Rate limit (429) hit at route ${routeId}. The remaining routes will be skipped.`;
          errors.push({ routeId, status: res.status, message: msg });
          return { rateLimited: true };
        }
        if (i === retries - 1) {
          errors.push({ routeId, status: res.status, message: msg });
          return null;
        }
      }
    } catch (e) {
      clearTimeout(timeoutId);
      const isTimeout = e.name === 'AbortError';
      const msg = isTimeout ? `Timeout (10s) while fetching API` : `Error while fetching API: ${e.message}`;
      if (i === retries - 1) {
        errors.push({ routeId, status: null, message: msg });
        return null;
      }
    }

    await sleep(2000 * (i + 1));
  }
  return null;
}

// Resolves a route endpoint (a region key, or a literal city name) to the
// live station(s) it currently refers to. Anything that doesn't match a
// known region key is treated as a single city name. A name that doesn't
// match any live station is reported as an error (rather than silently
// dropped) — that's the tracker's early-warning system for a station
// having been renamed or removed on Roadsurfer's side.
function resolveEndpoint(entry, byName, errors) {
  const names = config.regions[entry] ? config.regions[entry] : [entry];
  const ids = [];
  for (const name of names) {
    const station = byName.get(String(name).toLowerCase());
    if (!station) {
      const msg = `Configured city "${name}" not found in the live station list (renamed or removed?).`;
      console.warn(`[Warning] ${msg}`);
      errors.push({ routeId: null, status: null, message: msg });
      continue;
    }
    ids.push(station.id);
  }
  return ids;
}

async function run() {
  const requiredEnvs = ['API_BASE_URL', 'EMAIL_USER', 'EMAIL_PASS', 'EMAIL_TO', 'BOOKING_URL'];
  const missingEnvs = requiredEnvs.filter(env => !process.env[env]);
  if (missingEnvs.length > 0) {
    console.error(`[Critical error] Missing required environment variables: ${missingEnvs.join(', ')}`);
    process.exit(1);
  }

  console.log('Tracker started...');

  const errors = [];

  // --- Fetch the live station list and resolve configured routes against it ---
  let liveStations;
  try {
    liveStations = await fetchStationList();
  } catch (e) {
    const msg = `Could not fetch the live station list: ${e.message}`;
    console.error(`[Critical error] ${msg}`);
    try {
      await sendFatalErrorEmail(msg);
    } catch (mailErr) {
      console.error('[Error] Could not send the fatal-error email either:', mailErr.message);
    }
    process.exit(1);
  }
  stationsById = new Map(liveStations.map(s => [s.id, s]));
  const byName = new Map(liveStations.map(s => [s.name.toLowerCase(), s]));
  console.log(`Loaded ${liveStations.length} live stations.`);

  const routePairs = Array.isArray(config.routes) ? config.routes : [];
  const resolvedPairs = [];
  for (const [from, to] of routePairs) {
    const fromIds = resolveEndpoint(from, byName, errors);
    const toIds = resolveEndpoint(to, byName, errors);
    if (fromIds.length === 0 || toIds.length === 0) {
      console.warn(`[Warning] Route "${from}" -> "${to}" has no resolvable cities on one side — skipping.`);
      continue;
    }
    resolvedPairs.push({ fromIds, toIds });
  }

  const delayTime = (typeof config.settings.delayMs === 'number') ? config.settings.delayMs : 2000;

  // Each configured origin station's live `returns` list (see
  // roadsurfer-api.js) narrows down which of its configured destinations
  // are actually worth spending a timeframes call on. One detail fetch per
  // unique origin, done once up front here, replaces what would otherwise
  // be a full cross-product of timeframes checks.
  //
  // A station whose detail fetch fails is NOT narrowed — every one of its
  // configured destinations is still checked. Failing open like this means
  // a flaky detail fetch can only cost some extra timeframes calls, never
  // silently hide a route the way trusting bad data would.
  const originIds = new Set();
  for (const { fromIds } of resolvedPairs) fromIds.forEach(id => originIds.add(id));

  const returnsById = new Map(); // stationId -> Set<destinationId>; absent = fetch failed, don't narrow
  const originIdList = [...originIds];
  for (let i = 0; i < originIdList.length; i++) {
    const id = originIdList[i];
    try {
      const returns = await fetchStationReturns(id);
      returnsById.set(id, new Set(returns));
    } catch (e) {
      const station = getStationById(id);
      const msg = `Could not fetch the live returns list for "${station.name}" (${id}): ${e.message}. Checking all its configured destinations instead of narrowing by returns.`;
      console.warn(`[Warning] ${msg}`);
      // Not pushed to `errors`/flagged critical: the fail-open fallback
      // above means this never hides a route, just costs a few extra
      // timeframes calls for this one origin. Alarming the recipient with
      // an "API problems" email for a benign, self-healing efficiency
      // blip would just be noise — it's logged here for anyone reading
      // the run log, nothing more.
    }
    if (delayTime > 0 && i < originIdList.length - 1) await sleep(delayTime);
  }

  const routesToCheck = [];
  const addedRoutes = new Set();
  for (const { fromIds, toIds } of resolvedPairs) {
    for (const fromId of fromIds) {
      const reachable = returnsById.get(fromId);
      for (const toId of toIds) {
        if (fromId === toId) continue;
        if (reachable && !reachable.has(toId)) continue;
        const routeKey = `${fromId}-${toId}`;
        if (!addedRoutes.has(routeKey)) {
          addedRoutes.add(routeKey);
          routesToCheck.push(routeKey);
        }
      }
    }
  }

  // --- History: read ---
  let historyArray = [];
  if (fs.existsSync('history.json')) {
    try {
      const raw = fs.readFileSync('history.json', 'utf8');
      const parsed = JSON.parse(raw);
      historyArray = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('[Warning] Could not parse history.json, starting fresh:', e.message);
      historyArray = [];
    }
  }
  console.log(`Loaded ${historyArray.length} entries from history.`);

  // Cleanup: remove entries older than 7 days
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const cutoffDate = new Date(today);
  cutoffDate.setUTCDate(today.getUTCDate() - 7);

  historyArray = historyArray.filter(key => {
    const datePart = key.split('_')[1];
    if (!datePart) return false;
    const d = new Date(datePart);
    return !isNaN(d.getTime()) && d >= cutoffDate;
  });

  const historySet = new Set(historyArray);

  // Shuffle routes
  for (let i = routesToCheck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [routesToCheck[i], routesToCheck[j]] = [routesToCheck[j], routesToCheck[i]];
  }

  console.log(`Checking ${routesToCheck.length} combinations.`);

  const found = [];

  let checkedCount = 0;
  for (const routeId of routesToCheck) {
    checkedCount++;
    const [fromId, toId] = routeId.split('-').map(Number);
    const stationFrom = getStationById(fromId);
    const stationTo = getStationById(toId);
    console.log(`🔎 [${checkedCount}/${routesToCheck.length}] ${stationFrom.name} -> ${stationTo.name}`);

    const url = `${process.env.API_BASE_URL}${routeId}`;
    const data = await fetchQuiet(url, routeId, errors, config.settings.maxRetries || 3);

    if (data && data.rateLimited) {
      console.log('Scraping aborted due to rate limit (429). Proceeding to send results gathered so far.');
      break;
    }

    if (delayTime > 0) await sleep(delayTime);

    if (Array.isArray(data) && data.length > 0) {
      // Log the raw payload whenever a route returns data: it makes a real
      // mismatch (unexpected date format, already-recorded window, etc.)
      // visible in the run logs instead of looking identical to a
      // genuinely empty result.
      console.log(`   ↳ API returned ${data.length} timeframe(s) for ${stationFrom.name} -> ${stationTo.name}: ${JSON.stringify(data)}`);
      for (const timeframe of data) {
        if (!timeframe.startDate || !timeframe.endDate) {
          console.log(`   ⚠️ Skipped timeframe with missing startDate/endDate: ${JSON.stringify(timeframe)}`);
          continue;
        }
        const uniqueKey = `${routeId}_${timeframe.startDate}`;
        if (!historySet.has(uniqueKey) && !found.find(f => f.uniqueKey === uniqueKey)) {
          console.log(`✅ New route found: ${stationFrom.name} -> ${stationTo.name}`);
          found.push({ fromId, toId, startDate: timeframe.startDate, endDate: timeframe.endDate, uniqueKey });
        } else {
          console.log(`   ↳ Timeframe ${timeframe.startDate} -> ${timeframe.endDate} already in history, skipping.`);
        }
      }
    }
  }

  const criticalErrors = errors.filter(e => e.status !== 429);
  const hadErrors = criticalErrors.length > 0;

  if (found.length === 0 && !hadErrors) {
    saveHistory(historySet);
    console.log('No new routes found and no critical API errors. No email sent.');
    return;
  }

  const blocks = [];
  if (found.length > 0) {
    const grouped = new Map();
    for (const r of found) {
      const stationFrom = getStationById(r.fromId);
      const stationTo = getStationById(r.toId);
      const title = stationTo.countryName || stationTo.country;
      if (!grouped.has(title)) grouped.set(title, []);
      grouped.get(title).push({ ...r, stationFrom, stationTo });
    }

    for (const [groupTitle, items] of Array.from(grouped.entries()).sort()) {
      const lines = items.map(r => (
        `<div style="margin-bottom:20px; padding:12px 16px; background:#fff; border:1px solid #e0e0e0; border-radius:6px;">` +
        `<p style="margin:0 0 2px;">` +
          `<strong>🚐 ${r.stationFrom.name} (${r.stationFrom.country}) → ${r.stationTo.name} (${r.stationTo.country})</strong>` +
          ` <a href="${process.env.BOOKING_URL}" style="font-size:0.85em; color:#007BFF; margin-left:8px;">View on website →</a>` +
        `</p>` +
        `<p style="margin:0 0 8px; color:#555;">📅 ${formatDate(r.startDate)} to ${formatDate(r.endDate)}</p>` +
        `</div>`
      ));
      blocks.push(`<h3 style="margin:20px 0 8px; border-bottom:2px solid #eee; padding-bottom:4px;">${groupTitle}</h3>${lines.join('')}`);
    }
  }

  let errorBlock = '';
  if (hadErrors) {
    const lines = criticalErrors.map(e => {
      const route = formatRouteLabel(e.routeId);
      const status = e.status !== null ? ` (status: ${e.status})` : '';
      return `• ${route}${status}: ${e.message}`;
    });
    errorBlock =
      `<h3 style="margin:24px 0 8px; color:#c0392b;">⚠️ Warning: problems fetching from the API</h3>` +
      `<p>Not all routes could be successfully fetched. Details:</p>` +
      `<p style="font-family:monospace;">${lines.join('<br>')}</p>`;
  }

  let subject;
  if (found.length > 0 && !hadErrors) subject = `🚐 ${found.length} routes available!`;
  else if (found.length > 0 && hadErrors) subject = `🚐 ${found.length} routes (with warnings)`;
  else subject = `⚠️ Camper Tracker: API problems`;

  let body = '';
  if (found.length > 0) {
    body += `<p>Hi!</p><p>New routes have just become available:</p>${blocks.join('')}`;
    body += `<p style="margin-top:20px;">👉 <a href="${process.env.BOOKING_URL}" style="color:#007BFF; font-weight:bold;">Book quickly here on the website!</a></p>`;
  } else {
    body += `<p>Hi!</p><p>No new routes could be found this time, but error(s) occurred while fetching data.</p>`;
  }
  if (hadErrors) body += errorBlock;

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
  });

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_TO,
      subject,
      html: body
    });
    console.log('Email sent successfully!');
    // Only update history after successful mail send
    for (const r of found) historySet.add(r.uniqueKey);
  } catch (e) {
    console.error('[Error] Mail failed:', e.message);
  } finally {
    transporter.close();
  }

  saveHistory(historySet);
}

// Force the process down shortly after the work is done. Open SMTP or MCP
// sockets can otherwise keep the event loop alive indefinitely; the delay gives
// stdout time to flush, and unref() means we never delay a clean exit.
function exitSoon(code) {
  process.exitCode = code;
  const timer = setTimeout(() => process.exit(code), 5000);
  timer.unref();
}

// Fires only if the run itself hangs. Unref'd, so it never keeps the process up.
const watchdog = setTimeout(() => {
  console.error(`[Critical error] Watchdog: run exceeded ${WATCHDOG_MINUTES} minutes, forcing exit.`);
  process.exit(1);
}, WATCHDOG_MINUTES * 60 * 1000);
watchdog.unref();

run().then(() => {
  clearTimeout(watchdog);
  exitSoon(0);
}).catch(err => {
  clearTimeout(watchdog);
  console.error('[Critical error] Unexpected error in the application:', err);
  exitSoon(1);
});
