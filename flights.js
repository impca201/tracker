// flights.js — Kiwi.com MCP client
// Direct flights only, full flight info (times, duration, airline, price)

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');

const KIWI_MCP_URL = 'https://mcp.kiwi.com';

// FIX: Hard cap — reject any flight longer than 6 hours regardless of stop count
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
  const durationSeconds = flight.durationInSeconds || flight.totalDurationInSeconds || 0;
  // Reject anything over the max duration cap first
  if (durationSeconds > MAX_DIRECT_FLIGHT_SECONDS) return false;
  // Then check route segments
  if (flight.route && Array.isArray(flight.route)) return flight.route.length === 1;
  if (flight.totalDurationInSeconds !== undefined && flight.durationInSeconds !== undefined) {
    return flight.totalDurationInSeconds === flight.durationInSeconds;
  }
  return false;
}

function extractFlightInfo(flight, flyFrom, flyTo, departureDate) {
  const segment = Array.isArray(flight.route) ? flight.route[0] : null;
  const airlineCode = segment?.airline || flight.airlines?.[0] || flight.airline || '';
  const airlineName = segment?.airlineName || flight.airlineNames?.[0] || airlineCode || 'Unknown';
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
    flightDate: departureDate || null
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
    console.log(`    [Kiwi MCP] ${flyFrom}->${flyTo}: ${flights.length} flights total, ${directFlights.length} direct (under ${MAX_DIRECT_FLIGHT_SECONDS / 3600}h)`);

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
    const info = extractFlightInfo(best, flyFrom, flyTo, departureDate);
    console.log(`    [Kiwi MCP] Best direct: ${flyFrom}->${flyTo} €${info.price} (${info.airline}, ${info.departure}-${info.arrival}, ${info.duration})`);
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
