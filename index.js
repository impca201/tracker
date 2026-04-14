const fs = require('fs');
const nodemailer = require('nodemailer');
const config = require('./config');
const { stations, countryNames } = require('./stations.json');
const { getFlightsForRoute } = require('./flights');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getStationById(id) {
  return stations[Number(id)] || { name: `Station ${id}`, country: '??' };
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

function flightsEnabled() {
  const f = config.flights;
  return f && Array.isArray(f.origins) && f.origins.length > 0;
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
          console.warn(`[Warning] ${msg}`);
          errors.push({ routeId, status: res.status, message: msg });
          return null;
        }
        return await res.json();
      } else {
        let msg = `API status ${res.status} for ${url}`;
        if (res.status === 429) {
          msg = `Rate limit (429) hit at route ${routeId}. The remaining routes will be skipped.`;
          console.warn(`[Warning] ${msg}`);
          errors.push({ routeId, status: res.status, message: msg });
          return { rateLimited: true };
        }
        console.warn(`[Warning] Attempt ${i + 1} failed: ${msg}`);
        if (i === retries - 1) {
          errors.push({ routeId, status: res.status, message: msg });
          return null;
        }
      }
    } catch (e) {
      clearTimeout(timeoutId);
      const isTimeout = e.name === 'AbortError';
      const msg = isTimeout ? `Timeout (10s) while fetching API` : `Error while fetching API: ${e.message}`;
      console.error(`[Error] Attempt ${i + 1} failed: ${msg}`);
      if (i === retries - 1) {
        errors.push({ routeId, status: null, message: msg });
        return null;
      }
    }

    await sleep(2000 * (i + 1));
  }
  return null;
}

function formatFlightBlock(outbound, inbound, flightError) {
  if (flightError) {
    return `<p style="color:#c0392b; font-size:0.9em;">⚠️ Vluchtprijzen konden niet worden opgehaald: ${flightError}</p>`;
  }
  const lines = [];
  if (outbound) {
    lines.push(`✈️ <strong>Heen</strong>: ${outbound.origin} → ${outbound.destination} &mdash; <strong>€${outbound.price}</strong> &nbsp;<a href="${outbound.link}" style="color:#007BFF;">bekijk vlucht</a>`);
  } else {
    lines.push(`✈️ <strong>Heen</strong>: geen vlucht gevonden`);
  }
  if (inbound) {
    lines.push(`✈️ <strong>Terug</strong>: ${inbound.origin} → ${inbound.destination} &mdash; <strong>€${inbound.price}</strong> &nbsp;<a href="${inbound.link}" style="color:#007BFF;">bekijk vlucht</a>`);
  } else {
    lines.push(`✈️ <strong>Terug</strong>: geen vlucht gevonden`);
  }
  lines.push(`<em style="color:#888; font-size:0.85em;">ℹ️ Vluchtprijzen via Kiwi.com — controleer beschikbaarheid voor boeking.</em>`);
  return `<p style="margin:4px 0 0;">${lines.join('<br>')}</p>`;
}

async function run() {
  console.log('Tracker started...');
  const configured = Array.isArray(config.cities) ? config.cities : [];
  const selectedCityIds = new Set(configured.filter(id => typeof id === 'number' && stations[id]));

  if (selectedCityIds.size === 0) {
    console.log('No cities selected in config.js. The script is stopping.');
    return;
  }

  const useFlights = flightsEnabled();
  if (useFlights) {
    console.log(`Flight search enabled. Origins: ${config.flights.origins.join(', ')}`);
  } else {
    console.log('Flight search disabled (no origins configured).');
  }

  let history = [];
  try {
    if (fs.existsSync('history.json')) {
      history = JSON.parse(fs.readFileSync('history.json', 'utf8'));
      if (!Array.isArray(history)) history = [];
    }
  } catch (err) {
    console.error('Error reading history.json, starting with a clean slate.', err);
    history = [];
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const cutoffDate = new Date(today);
  cutoffDate.setDate(today.getDate() - 7);
  history = history.filter(entry => {
    const parts = entry.split('_');
    if (parts.length > 1) {
      const startDate = new Date(parts[1]);
      if (startDate < cutoffDate) return false;
    }
    return true;
  });

  const historySet = new Set(history);
  const selectedArray = Array.from(selectedCityIds);
  const routesToCheck = [];
  for (let i = 0; i < selectedArray.length; i++) {
    for (let j = 0; j < selectedArray.length; j++) {
      if (i === j) continue;
      routesToCheck.push(`${selectedArray[i]}-${selectedArray[j]}`);
    }
  }

  for (let i = routesToCheck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [routesToCheck[i], routesToCheck[j]] = [routesToCheck[j], routesToCheck[i]];
  }

  console.log(`Checking ${routesToCheck.length} combinations.`);

  const delayTime = (typeof config.settings.delayMs === 'number') ? config.settings.delayMs : 2000;
  const found = [];
  const errors = [];

  let checkedCount = 0;
  for (const routeId of routesToCheck) {
    checkedCount++;
    const [fromId, toId] = routeId.split('-').map(Number);
    const stationFrom = getStationById(fromId);
    const stationTo = getStationById(toId);
    console.log(`🔎 [${checkedCount}/${routesToCheck.length}] ${stationFrom.name} (${stationFrom.country}) -> ${stationTo.name} (${stationTo.country})`);

    const url = `${process.env.API_BASE_URL}${routeId}`;
    const data = await fetchQuiet(url, routeId, errors, config.settings.maxRetries || 3);

    if (data && data.rateLimited) {
      console.log('Scraping aborted due to rate limit (429). Proceeding to send results gathered so far.');
      break;
    }

    if (delayTime > 0) await sleep(delayTime);

    if (Array.isArray(data) && data.length > 0) {
      for (const timeframe of data) {
        if (!timeframe.startDate || !timeframe.endDate) continue;
        const uniqueKey = `${routeId}_${timeframe.startDate}`;
        if (!historySet.has(uniqueKey) && !found.find(f => f.uniqueKey === uniqueKey)) {
          console.log(`✅ New route found: ${stationFrom.name} -> ${stationTo.name}`);
          found.push({ fromId, toId, startDate: timeframe.startDate, endDate: timeframe.endDate, uniqueKey });
        }
      }
    }
  }

  const criticalErrors = errors.filter(e => e.status !== 429);
  const hadErrors = criticalErrors.length > 0;

  if (found.length === 0 && !hadErrors) {
    fs.writeFileSync('history.json', JSON.stringify([...historySet].sort(), null, 2));
    console.log('No new routes found and no critical API errors. No email sent.');
    return;
  }

  const blocks = [];
  if (found.length > 0) {
    const grouped = new Map();
    for (const r of found) {
      const stationFrom = getStationById(r.fromId);
      const stationTo = getStationById(r.toId);
      const title = countryNames[stationTo.country] || stationTo.country;
      if (!grouped.has(title)) grouped.set(title, []);
      grouped.get(title).push({ ...r, stationFrom, stationTo });
    }

    for (const [groupTitle, items] of Array.from(grouped.entries()).sort()) {
      const lines = [];
      for (const r of items) {
        let flightHtml = '';
        // Beide steden moeten een IATA code hebben voor vluchten
        if (useFlights && r.stationTo.iata && r.stationFrom.iata) {
          console.log(`  ✈️  Fetching flights for ${r.stationFrom.name} → ${r.stationTo.name} (pickup: ${r.stationTo.iata}, dropoff: ${r.stationFrom.iata})`);
          const flightResult = await getFlightsForRoute(
            config.flights.origins,
            r.stationTo.iata,    // pickup: heen naar hier
            r.stationFrom.iata,  // dropoff: terug vanuit hier
            r.startDate,
            r.endDate,
            config.flights.departureWindow,
            config.flights.returnWindow
          );
          flightHtml = formatFlightBlock(flightResult.outbound, flightResult.inbound, flightResult.flightError);
        }
        lines.push(
          `<div style="margin-bottom:16px;">` +
          `<strong>🚐 ${r.stationFrom.name} (${r.stationFrom.country}) -> ${r.stationTo.name} (${r.stationTo.country})</strong><br>` +
          `📅 ${formatDate(r.startDate)} to ${formatDate(r.endDate)}` +
          (flightHtml ? `<br>${flightHtml}` : '') +
          `</div>`
        );
      }
      blocks.push(`<h3 style="margin: 16px 0 8px;">${groupTitle}</h3>${lines.join('')}`);
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
      `<h3 style="margin: 24px 0 8px; color: #c0392b;">⚠️ Warning: problems fetching from the API</h3>` +
      `<p>Not all routes could be successfully fetched. Details:</p>` +
      `<p style="font-family: monospace;">${lines.join('<br>')}</p>`;
  }

  let subject;
  if (found.length > 0 && !hadErrors) subject = `🚐 ${found.length} routes available!`;
  else if (found.length > 0 && hadErrors) subject = `🚐 ${found.length} routes (with warnings)`;
  else subject = `⚠️ Camper Tracker: API problems`;

  let body = '';
  if (found.length > 0) {
    body += `<p>Hi!</p><p>New routes have just become available:</p>${blocks.join('')}`;
    body += `<p>👉 <a href="${process.env.BOOKING_URL}" style="color: #007BFF; font-weight: bold; text-decoration: none;">Book quickly here on the website!</a></p>`;
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
    for (const r of found) historySet.add(r.uniqueKey);
  } catch (e) {
    console.error('[Error] Mail failed:', e.message);
  }

  fs.writeFileSync('history.json', JSON.stringify([...historySet].sort(), null, 2));
}

run().catch(err => {
  console.error('[Critical error] Unexpected error in the application:', err);
  process.exit(1);
});
