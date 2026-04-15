// flights.js — Kiwi.com MCP client
// Directe vluchten only, volledige vluchtinfo (tijden, duur, airline, prijs)

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
// Fix #2: Use SSEClientTransport — StreamableHTTPClientTransport does not exist in @modelcontextprotocol/sdk v1.0.0
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');

const KIWI_MCP_URL = 'https://mcp.kiwi.com';

function formatLocalTime(isoString) {
  if (!isoString) return '?';
  // "2026-04-19T08:05:00.000" -> "08:05"
  return isoString.slice(11, 16);
}

function formatDuration(seconds) {
  if (!seconds) return '?';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}u${m > 0 ? m + 'm' : ''}`;
}

// Fix #4: Strictly typed — avoids undefined === undefined false positive
function isDirectFlight(flight) {
  if (flight.route && Array.isArray(flight.route)) return flight.route.length === 1;
  if (flight.totalDurationInSeconds !== undefined && flight.durationInSeconds !== undefined) {
    return flight.totalDurationInSeconds === flight.durationInSeconds;
  }
  return false;
}

// Fix #6 & #7: Fallback to IATA code for airline name; accept departureDate and attach flightDate
function extractFlightInfo(flight, flyFrom, flyTo, departureDate) {
  const segment = Array.isArray(flight.route) ? flight.route[0] : null;
  // Fix #6: Graceful airline fallback — use IATA code if full name isn't mapped
  const airlineCode = segment?.airline || flight.airlines?.[0] || flight.airline || '';
  const airlineName = segment?.airlineName || flight.airlineNames?.[0] || airlineCode || 'Onbekend';
  const flightNo = segment?.flight_no || segment?.flightNo || flight.flightNo || null;

  const depTime = formatLocalTime(flight.departure?.local || segment?.local_departure || segment?.localDeparture);
  const arrTime = formatLocalTime(flight.arrival?.local || segment?.local_arrival || segment?.localArrival);
  const duration = formatDuration(flight.durationInSeconds || flight.totalDurationInSeconds);

  return {
    price: flight.price,
    airline: airlineName,
    flightNo: flightNo,
    departure: depTime,
    arrival: arrTime,
    duration: duration,
    from: flight.flyFrom || flyFrom,
    to: flight.flyTo || flyTo,
    link: flight.deepLink || flight.bookingLink || `https://www.kiwi.com/deep?from=${flyFrom}&to=${flyTo}`,
    flightDate: departureDate || null  // Fix #7: Attach the searched date for display in email
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
      console.log(`    [Kiwi MCP] Lege response voor ${flyFrom}->${flyTo} op ${departureDate}`);
      return null;
    }

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log(`    [Kiwi MCP raw fields] ${flyFrom}->${flyTo}:`, JSON.stringify(Object.keys(parsed[0])));
        if (parsed[0].route) console.log(`    [Kiwi MCP route[0] fields]:`, JSON.stringify(Object.keys(parsed[0].route[0] || {})));
      }
    } catch {}

    let flights;
    try {
      flights = JSON.parse(raw);
    } catch {
      console.log(`    [Kiwi MCP] Kon JSON niet parsen: ${raw.slice(0, 200)}`);
      return null;
    }

    if (!Array.isArray(flights) || flights.length === 0) return null;

    let directFlights = flights.filter(isDirectFlight);
    console.log(`    [Kiwi MCP] ${flyFrom}->${flyTo}: ${flights.length} vluchten, ${directFlights.length} rechtstreeks`);

    // Fix #5: Apply time filters if provided
    if (timeFilter) {
      if (timeFilter.latestArrivalHour !== undefined) {
        directFlights = directFlights.filter(flight => {
          const segment = Array.isArray(flight.route) ? flight.route[0] : null;
          const arrLocal = flight.arrival?.local || segment?.local_arrival || segment?.localArrival;
          if (!arrLocal) return true;
          const arrHour = parseInt(arrLocal.slice(11, 13), 10);
          return arrHour <= timeFilter.latestArrivalHour;
        });
      }
      if (timeFilter.earliestDepartureHour !== undefined) {
        directFlights = directFlights.filter(flight => {
          const segment = Array.isArray(flight.route) ? flight.route[0] : null;
          const depLocal = flight.departure?.local || segment?.local_departure || segment?.localDeparture;
          if (!depLocal) return true;
          const depHour = parseInt(depLocal.slice(11, 13), 10);
          return depHour >= timeFilter.earliestDepartureHour;
        });
      }
    }

    if (directFlights.length === 0) return null;

    const best = directFlights.sort((a, b) => a.price - b.price)[0];
    // Pass departureDate as display string (already DD/MM/YYYY from caller)
    const info = extractFlightInfo(best, flyFrom, flyTo, departureDate);
    console.log(`    [Kiwi MCP] Beste directe: ${flyFrom}->${flyTo} €${info.price} (${info.airline}, ${info.departure}-${info.arrival})`);
    return info;
  } finally {
    await client.close();
  }
}

// Returns a YYYY-MM-DD string (safe for new Date() parsing)
function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10); // always YYYY-MM-DD
}

// Accepts and returns YYYY-MM-DD strings internally
function dateRange(startDateStr, endDateStr) {
  const dates = [];
  const current = new Date(startDateStr);
  const end = new Date(endDateStr);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10)); // YYYY-MM-DD
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

// Format YYYY-MM-DD -> DD/MM/YYYY for Kiwi API and display
function toKiwiDate(isoDate) {
  const [yyyy, mm, dd] = isoDate.split('-');
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Search outbound + return flights.
 * Outbound: origins → pickupIata (camper ophalen)
 * Inbound:  dropoffIata → origins (camper terugbrengen)
 */
async function getFlightsForRoute(origins, pickupIata, dropoffIata, pickupDate, dropoffDate, departureWindow, returnWindow) {
  try {
    // All date arithmetic in YYYY-MM-DD
    const outboundStart = addDays(pickupDate, -(departureWindow?.daysBefore || 0));
    const outboundEnd   = addDays(pickupDate, 0);
    const inboundStart  = addDays(dropoffDate, 0);
    const inboundEnd    = addDays(dropoffDate, returnWindow?.daysAfter || 0);

    // dateRange returns YYYY-MM-DD array; convert to DD/MM/YYYY only for Kiwi API
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
