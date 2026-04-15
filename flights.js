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
  // Fix #2: Corrected transport
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
        // Fix #4 extra safety net: request direct/non-stop flights from the API
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

    // Filter on direct flights
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

    // Cheapest direct flight
    const best = directFlights.sort((a, b) => a.price - b.price)[0];
    const info = extractFlightInfo(best, flyFrom, flyTo, departureDate);
    console.log(`    [Kiwi MCP] Beste directe: ${flyFrom}->${flyTo} €${info.price} (${info.airline}, ${info.departure}-${info.arrival})`);
    return info;
  } finally {
    await client.close();
  }
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function dateRange(startDateStr, endDateStr) {
  const dates = [];
  const current = new Date(startDateStr);
  const end = new Date(endDateStr);
  while (current <= end) {
    const dd = String(current.getUTCDate()).padStart(2, '0');
    const mm = String(current.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = current.getUTCFullYear();
    dates.push(`${dd}/${mm}/${yyyy}`);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Search outbound + return flights.
 * Outbound: origins → pickupIata (camper ophalen)
 * Inbound:  dropoffIata → origins (camper terugbrengen)
 */
async function getFlightsForRoute(origins, pickupIata, dropoffIata, pickupDate, dropoffDate, departureWindow, returnWindow) {
  try {
    // Fix #5: Build full date ranges instead of a single date
    const outboundStart = addDays(pickupDate, -(departureWindow?.daysBefore || 0));
    const outboundEnd   = addDays(pickupDate, 0);
    const inboundStart  = addDays(dropoffDate, 0);
    const inboundEnd    = addDays(dropoffDate, returnWindow?.daysAfter || 0);

    const outboundDates = dateRange(outboundStart, outboundEnd);
    const inboundDates  = dateRange(inboundStart, inboundEnd);

    console.log(`    [Flights] Outbound: ${origins.join('/')} → ${pickupIata} dates: ${outboundDates.join(', ')}`);
    console.log(`    [Flights] Inbound:  ${dropoffIata} → ${origins.join('/')} dates: ${inboundDates.join(', ')}`);

    // Fix #5: Time filters from config
    const outboundTimeFilter = departureWindow?.latestArrivalHour !== undefined
      ? { latestArrivalHour: departureWindow.latestArrivalHour }
      : null;
    const inboundTimeFilter = returnWindow?.earliestDepartureHour !== undefined
      ? { earliestDepartureHour: returnWindow.earliestDepartureHour }
      : null;

    // Fetch all outbound date/origin combos and pool results
    const outboundResults = (await Promise.all(
      origins.flatMap(origin =>
        outboundDates.map(date =>
          callKiwiMcp(origin, pickupIata, date, outboundTimeFilter)
            .catch(e => { console.error(`    [Flights] outbound error (${origin} ${date}): ${e.message}`); return null; })
        )
      )
    )).filter(Boolean);

    // Fetch all inbound date/origin combos and pool results
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
