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

function formatFlightRow(flight, label) {
  if (!flight) {
    return `<tr>
      <td style="padding:6px 10px; color:#888;"><strong>${label}</strong></td>
      <td colspan="5" style="padding:6px 10px; color:#aaa; font-style:italic;">Geen rechtstreekse vlucht gevonden</td>
    </tr>`;
  }
  const dateStr = flight.flightDate ? `<br><span style="font-size:0.85em; font-weight:normal;">${flight.flightDate}</span>` : '';
  const flightNoStr = flight.flightNo ? ` <span style="color:#888; font-size:0.85em;">(${flight.flightNo})</span>` : '';
  return `<tr style="background:#f9f9f9;">
    <td style="padding:6px 10px;"><strong>${label}</strong>${dateStr}</td>
    <td style="padding:6px 10px;">${flight.from} → ${flight.to}</td>
    <td style="padding:6px 10px;">${flight.departure} – ${flight.arrival} <span style="color:#888; font-size:0.85em;">(${flight.duration})</span></td>
    <td style="padding:6px 10px;">${flight.airline}${flightNoStr}</td>
    <td style="padding:6px 10px; font-weight:bold; color:#27ae60;">€${flight.price}</td>
    <td style="padding:6px 10px;"><a href="${flight.link}" style="color:#007BFF; white-space:nowrap;">Boek vlucht →</a></td>
  </tr>`;
}

function formatFlightBlock(outbound, inbound, flightError) {
  if (flightError) {
    return `<p style="color:#c0392b; font-size:0.9em; margin:4px 0;">⚠️ Vluchtprijzen konden niet worden opgehaald: ${flightError}</p>`;
  }

  const totalPrice = (outbound?.price || 0) + (inbound?.price || 0);
  const totalStr = (outbound && inbound)
    ? `<tr style="border-top:2px solid #ddd;">
        <td colspan="4" style="padding:6px 10px; text-align:right; color:#555;"><em>Totaal heen + terug:</em></td>
        <td style="padding:6px 10px; font-weight:bold; color:#27ae60; font-size:1.05em;">€${totalPrice}</td>
        <td></td>
      </tr>`
    : '';

  return `
  <table style="border-collapse:collapse; width:100%; margin:8px 0; font-size:0.9em; border:1px solid #e0e0e0; border-radius:4px; overflow:hidden;">
    <thead>
      <tr style="background:#f0f0f0;">
        <th style="padding:6px 10px; text-align:left;">Richting</th>
        <th style="padding:6px 10px; text-align:left;">Route</th>
        <th style="padding:6px 10px; text-align:left;">Tijden</th>
        <th style="padding:6px 10px; text-align:left;">Maatschappij</th>
        <th style="padding:6px 10px; text-align:left;">Prijs</th>
        <th style="padding:6px 10px; text-align:left;"></th>
      </tr>
    </thead>
    <tbody>
      ${formatFlightRow(outbound, '✈️ Heen')}
      ${formatFlightRow(inbound, '✈️ Terug')}
      ${totalStr}
    </tbody>
  </table>
  <p style="color:#888; font-size:0.8em; margin:2px 0 0;">ℹ️ Goedkoopste rechtstreekse vluchten via Kiwi.com — controleer beschikbaarheid voor boeking.</p>`;
}

async function run() {
  // Fix #3: Validate required environment variables
  const requiredEnvs = ['API_BASE_URL', 'EMAIL_USER', 'EMAIL_PASS', 'EMAIL_TO', 'BOOKING_URL'];
  const missingEnvs = requiredEnvs.filter(env => !process.env[env]);
  if (missingEnvs.length > 0) {
    console.error(`[Critical error] Missing required environment variables: ${missingEnvs.join(', ')}`);
    process.exit(1);
  }

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

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const cutoffDate = new Date(today);
  cutoffDate.setDate(today.getDate() - 7);

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
        if (useFlights && r.stationFrom.iata && r.stationTo.iata) {
          // Fix #1: Correct direction — outbound to pickup (stationFrom), inbound from dropoff (stationTo)
          console.log(`  ✈️  Fetching flights for ${r.stationFrom.name} → ${r.stationTo.name} (pickup: ${r.stationFrom.iata}, dropoff: ${r.stationTo.iata})`);
          const flightResult = await getFlightsForRoute(
            config.flights.origins,
            r.stationFrom.iata,   // Outbound destination (pickup)
            r.stationTo.iata,     // Inbound origin (dropoff)
            r.startDate,
            r.endDate,
            config.flights.departureWindow,
            config.flights.returnWindow
          );
          flightHtml = formatFlightBlock(flightResult.outbound, flightResult.inbound, flightResult.flightError);
        }
        lines.push(
          `<div style="margin-bottom:20px; padding:12px 16px; background:#fff; border:1px solid #e0e0e0; border-radius:6px;">` +
          `<p style="margin:0 0 4px;"><strong>🚐 ${r.stationFrom.name} (${r.stationFrom.country}) → ${r.stationTo.name} (${r.stationTo.country})</strong></p>` +
          `<p style="margin:0 0 8px; color:#555;">📅 ${formatDate(r.startDate)} tot ${formatDate(r.endDate)}</p>` +
          (flightHtml || '<p style="color:#aaa; font-style:italic;">Geen vluchtinfo beschikbaar.</p>') +
          `</div>`
        );
      }
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
