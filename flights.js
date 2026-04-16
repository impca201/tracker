// flights.js — Kiwi.com MCP client
// Direct flights only, full flight info (times, duration, price)
//
// MCP response structure:
// { flyFrom, flyTo, cityFrom, cityTo, departure: { utc, local }, arrival: { utc, local },
//   durationInSeconds, totalDurationInSeconds, price, deepLink, currency, layovers }
// NOTE: No route/airline/flightNo fields in MCP response.

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');

const KIWI_MCP_URL = 'https://mcp.kiwi.com';

// Hard cap: reject flights longer than this regardless of layovers field
const MAX_DIRECT_FLIGHT_SECONDS = 6 * 3600;

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
  if (dur > MAX_DIRECT_FLIGHT_SECONDS) return false;
  // layovers array: empty = direct, null/undefined = unknown (treat as direct if duration ok)
  const layovers = flight.layovers ?? [];
  if (Array.isArray(layovers)) return layovers.length === 0;
  // Fallback: route array
  if (Array.isArray(flight.route)) return flight.route.length === 1;
  return true;
}

function extractFlightInfo(flight, flyFrom, flyTo, departureDate) {
  const depTime  = formatLocalTime(flight.departure?.local);
  const arrTime  = formatLocalTime(flight.arrival?.local);
  const duration = formatDuration(flight.durationInSeconds || flight.totalDurationInSeconds);
  const layovers = flight.layovers ?? [];
  const stops    = Array.isArray(layovers) ? layovers.length : 0;

  return {
    price:      flight.price,
    stops:      stops,
    departure:  depTime,
    arrival:    arrTime,
    duration:   duration,
    from:       flight.flyFrom  || flyFrom,
    to:         flight.flyTo    || flyTo,
    cityFrom:   flight.cityFrom || null,
    cityTo:     flight.cityTo   || null,
    link:       flight.deepLink || `https://www.kiwi.com/en/search/results/${flyFrom}/${flyTo}`,
    flightDate: departureDate   || null
  };
}

// applyTimeFilter only when the flight date matches the "key" date (pickup or dropoff day itself)
// For D-1 and D+1 dates, no time restriction applies.
async function callKiwiMcp(flyFrom, flyTo, departureDate, timeFilter, isKeyDate) {
  const client = new Client(
    { name: 'camper-tracker', version: '1.0.0' },
    { capabilities: {} }
  );
  const transport = new SSEClientTransport(new URL(KIWI_MCP_URL));
  await client.connect(transport);

  try {
    const result = await client.callTool({
      name: 'search-flight',
      arguments: { flyFrom, flyTo, departureDate, adults: 1, max_stopovers: 0 }
    });

    const raw = result?.content?.[0]?.text;
    if (!raw) return null;

    let flights;
    try {
      flights = JSON.parse(raw);
    } catch {
      return null;
    }

    if (!Array.isArray(flights) || flights.length === 0) return null;

    let directFlights = flights.filter(isDirectFlight);

    // Time filter only applies on the key date (pickup/dropoff day itself), not on D-1 or D+1
    if (isKeyDate && timeFilter) {
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
    return extractFlightInfo(best, flyFrom, flyTo, departureDate);
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

async function getFlightsForRoute(origins, pickupIata, dropoffIata, pickupDate, dropoffDate, departureWindow, returnWindow) {
  try {
    const outboundKeyDate = pickupDate;  // the day itself: time filter applies
    const inboundKeyDate  = dropoffDate; // the day itself: time filter applies

    const outboundStart = addDays(pickupDate, -(departureWindow?.daysBefore || 0));
    const outboundEnd   = addDays(pickupDate, 0);
    const inboundStart  = addDays(dropoffDate, 0);
    const inboundEnd    = addDays(dropoffDate, returnWindow?.daysAfter || 0);

    const outboundDates = dateRange(outboundStart, outboundEnd);
    const inboundDates  = dateRange(inboundStart, inboundEnd);

    const outboundTimeFilter = departureWindow?.latestArrivalHour !== undefined
      ? { latestArrivalHour: departureWindow.latestArrivalHour }
      : null;
    const inboundTimeFilter = returnWindow?.earliestDepartureHour !== undefined
      ? { earliestDepartureHour: returnWindow.earliestDepartureHour }
      : null;

    const outboundResults = (await Promise.all(
      origins.flatMap(origin =>
        outboundDates.map(date => {
          const isKeyDate = (date === outboundKeyDate);
          return callKiwiMcp(origin, pickupIata, toKiwiDate(date), outboundTimeFilter, isKeyDate)
            .catch(() => null);
        })
      )
    )).filter(Boolean);

    const inboundResults = (await Promise.all(
      origins.flatMap(origin =>
        inboundDates.map(date => {
          const isKeyDate = (date === inboundKeyDate);
          return callKiwiMcp(dropoffIata, origin, toKiwiDate(date), inboundTimeFilter, isKeyDate)
            .catch(() => null);
        })
      )
    )).filter(Boolean);

    const bestOutbound = outboundResults.sort((a, b) => a.price - b.price)[0] || null;
    const bestInbound  = inboundResults.sort((a, b) => a.price - b.price)[0] || null;

    return { outbound: bestOutbound, inbound: bestInbound, flightError: null };
  } catch (e) {
    return { outbound: null, inbound: null, flightError: e.message };
  }
}

module.exports = { getFlightsForRoute };
