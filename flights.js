// flights.js — Kiwi.com MCP client
// Direct flights only, full flight info (times, duration, price)
//
// MCP response structure (confirmed via debug):
// { flyFrom, flyTo, cityFrom, cityTo, departure: { utc, local }, arrival: { utc, local },
//   durationInSeconds, totalDurationInSeconds, price, deepLink, currency, layovers }
// NOTE: No route/airline/flightNo fields in MCP response.

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');

const KIWI_MCP_URL = 'https://mcp.kiwi.com';

// Hard cap: reject flights longer than this regardless of layovers field
const MAX_DIRECT_FLIGHT_SECONDS = 6 * 3600; // 21600

function formatLocalTime(isoString) {
  if (!isoString) return '?';
  return isoString.slice(11, 16);
}

function formatDuration(seconds) {
  if (!seconds) return '?';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h${m > 0 ? m + 'm' : ''}`;
}

function isDirectFlight(flight) {
  const dur = flight.durationInSeconds || flight.totalDurationInSeconds || 0;
  // Hard duration cap first
  if (dur > MAX_DIRECT_FLIGHT_SECONDS) return false;
  // Use layovers array if present (confirmed field in MCP response)
  if (Array.isArray(flight.layovers)) return flight.layovers.length === 0;
  // Fallback: route array (not present in current MCP but kept for resilience)
  if (Array.isArray(flight.route)) return flight.route.length === 1;
  // Last resort: equal durations means no stopover added time
  if (flight.totalDurationInSeconds !== undefined && flight.durationInSeconds !== undefined) {
    return flight.totalDurationInSeconds === flight.durationInSeconds;
  }
  return false;
}

function extractFlightInfo(flight, flyFrom, flyTo, departureDate) {
  // MCP does not return airline/flightNo — omit rather than show 'Unknown'
  const depTime  = formatLocalTime(flight.departure?.local);
  const arrTime  = formatLocalTime(flight.arrival?.local);
  const duration = formatDuration(flight.durationInSeconds || flight.totalDurationInSeconds);
  const stops    = Array.isArray(flight.layovers) ? flight.layovers.length : null;

  return {
    price:       flight.price,
    airline:     null,   // not provided by Kiwi MCP
    flightNo:    null,   // not provided by Kiwi MCP
    stops:       stops,
    departure:   depTime,
    arrival:     arrTime,
    duration:    duration,
    from:        flight.flyFrom  || flyFrom,
    to:          flight.flyTo    || flyTo,
    cityFrom:    flight.cityFrom || null,
    cityTo:      flight.cityTo   || null,
    link:        flight.deepLink || `https://www.kiwi.com/en/search/results/${flyFrom}/${flyTo}`,
    flightDate:  departureDate   || null
  };
}

async function callKiwiMcp(flyFrom, flyTo, departureDate, timeFilter) {
  const client = new Client(
    { name: 'camper-tracker', version: '1.0.0' },
    { capabilities: {} }
  );
  const transport = new SSEClientTransport(new URL(KIWI_MCP_URL));
  await client.connect(transport);

  try {
    const result = await client.callTool({
      name: 'search-flight',
      arguments: {
        flyFrom,
        flyTo,
        departureDate,
        adults: 1,
        max_stopovers: 0
      }
    });

    const raw = result?.content?.[0]?.text;
    if (!raw) {
      console.log(`    [Kiwi MCP] Empty response for ${flyFrom}->${flyTo} on ${departureDate}`);
      return null;
    }

    let flights;
    try {
      flights = JSON.parse(raw);
    } catch {
      console.log(`    [Kiwi MCP] Could not parse JSON: ${raw.slice(0, 200)}`);
      return null;
    }

    if (!Array.isArray(flights) || flights.length === 0) return null;

    let directFlights = flights.filter(isDirectFlight);
    console.log(`    [Kiwi MCP] ${flyFrom}->${flyTo}: ${flights.length} flights total, ${directFlights.length} direct (layovers=0, under ${MAX_DIRECT_FLIGHT_SECONDS / 3600}h)`);

    if (timeFilter) {
      if (timeFilter.latestArrivalHour !== undefined) {
        directFlights = directFlights.filter(flight => {
          const arrLocal = flight.arrival?.local;
          if (!arrLocal) return true;
          return parseInt(arrLocal.slice(11, 13), 10) <= timeFilter.latestArrivalHour;
        });
      }
      if (timeFilter.earliestDepartureHour !== undefined) {
        directFlights = directFlights.filter(flight => {
          const depLocal = flight.departure?.local;
          if (!depLocal) return true;
          return parseInt(depLocal.slice(11, 13), 10) >= timeFilter.earliestDepartureHour;
        });
      }
    }

    if (directFlights.length === 0) return null;

    const best = directFlights.sort((a, b) => a.price - b.price)[0];
    const info = extractFlightInfo(best, flyFrom, flyTo, departureDate);
    console.log(`    [Kiwi MCP] Best direct: ${flyFrom}->${flyTo} €${info.price} (${info.departure}-${info.arrival}, ${info.duration})`);
    return info;
  } finally {
    await client.close();
  }
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateRange(startDateStr, endDateStr) {
  const dates = [];
  const current = new Date(startDateStr);
  const end = new Date(endDateStr);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function toKiwiDate(isoDate) {
  const [yyyy, mm, dd] = isoDate.split('-');
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Search outbound + return flights.
 * Outbound: origins → pickupIata (pick up camper)
 * Inbound:  dropoffIata → origins (drop off camper)
 */
async function getFlightsForRoute(origins, pickupIata, dropoffIata, pickupDate, dropoffDate, departureWindow, returnWindow) {
  try {
    const outboundStart = addDays(pickupDate, -(departureWindow?.daysBefore || 0));
    const outboundEnd   = addDays(pickupDate, 0);
    const inboundStart  = addDays(dropoffDate, 0);
    const inboundEnd    = addDays(dropoffDate, returnWindow?.daysAfter || 0);

    const outboundDates = dateRange(outboundStart, outboundEnd).map(toKiwiDate);
    const inboundDates  = dateRange(inboundStart, inboundEnd).map(toKiwiDate);

    console.log(`    [Flights] Outbound: ${origins.join('/')} → ${pickupIata} dates: ${outboundDates.join(', ')}`);
    console.log(`    [Flights] Inbound:  ${dropoffIata} → ${origins.join('/')} dates: ${inboundDates.join(', ')}`);

    const outboundTimeFilter = departureWindow?.latestArrivalHour !== undefined
      ? { latestArrivalHour: departureWindow.latestArrivalHour }
      : null;
    const inboundTimeFilter = returnWindow?.earliestDepartureHour !== undefined
      ? { earliestDepartureHour: returnWindow.earliestDepartureHour }
      : null;

    const outboundResults = (await Promise.all(
      origins.flatMap(origin =>
        outboundDates.map(date =>
          callKiwiMcp(origin, pickupIata, date, outboundTimeFilter)
            .catch(e => { console.error(`    [Flights] outbound error (${origin} ${date}): ${e.message}`); return null; })
        )
      )
    )).filter(Boolean);

    const inboundResults = (await Promise.all(
      origins.flatMap(origin =>
        inboundDates.map(date =>
          callKiwiMcp(dropoffIata, origin, date, inboundTimeFilter)
            .catch(e => { console.error(`    [Flights] inbound error (${origin} ${date}): ${e.message}`); return null; })
        )
      )
    )).filter(Boolean);

    const bestOutbound = outboundResults.sort((a, b) => a.price - b.price)[0] || null;
    const bestInbound  = inboundResults.sort((a, b) => a.price - b.price)[0] || null;

    return { outbound: bestOutbound, inbound: bestInbound, flightError: null };
  } catch (e) {
    console.error(`[Flights] Kiwi MCP error: ${e.message}`);
    return { outbound: null, inbound: null, flightError: e.message };
  }
}

module.exports = { getFlightsForRoute };
