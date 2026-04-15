// flights.js — Kiwi.com MCP client
// Directe vluchten only, volledige vluchtinfo (tijden, duur, airline, prijs)

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

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

function isDirectFlight(flight) {
  // Directe vlucht = route array heeft exact 1 segment
  // én totalDurationInSeconds === durationInSeconds (geen overstaptijd)
  if (Array.isArray(flight.route) && flight.route.length > 1) return false;
  if (Array.isArray(flight.route) && flight.route.length === 1) return true;
  // Fallback: als route niet beschikbaar, check duraties
  return flight.totalDurationInSeconds === flight.durationInSeconds;
}

function extractFlightInfo(flight, flyFrom, flyTo) {
  // Airline: uit route[0] of top-level
  const segment = Array.isArray(flight.route) ? flight.route[0] : null;
  const airline = segment?.airline || flight.airlines?.[0] || flight.airline || null;
  const airlineName = segment?.airlineName || flight.airlineNames?.[0] || airline || 'Onbekend';
  const flightNo = segment?.flight_no || segment?.flightNo || flight.flightNo || null;

  const depLocal = segment?.utc_departure
    ? null  // gebruik local van top-level als segment alleen UTC heeft
    : null;

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
    link: flight.deepLink || flight.bookingLink || `https://www.kiwi.com/deep?from=${flyFrom}&to=${flyTo}`
  };
}

async function callKiwiMcp(flyFrom, flyTo, departureDate) {
  const client = new Client(
    { name: 'camper-tracker', version: '1.0.0' },
    { capabilities: {} }
  );
  const transport = new StreamableHTTPClientTransport(new URL(KIWI_MCP_URL));
  await client.connect(transport);

  try {
    const result = await client.callTool({
      name: 'search-flight',
      arguments: { flyFrom, flyTo, departureDate, adults: 1 }
    });

    const raw = result?.content?.[0]?.text;
    if (!raw) {
      console.log(`    [Kiwi MCP] Lege response voor ${flyFrom}->${flyTo} op ${departureDate}`);
      return null;
    }

    // Log volledige raw response voor debugging (1e vlucht)
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

    // Filter op directe vluchten
    const directFlights = flights.filter(isDirectFlight);
    console.log(`    [Kiwi MCP] ${flyFrom}->${flyTo}: ${flights.length} vluchten, ${directFlights.length} rechtstreeks`);

    if (directFlights.length === 0) return null;

    // Goedkoopste directe vlucht
    const best = directFlights.sort((a, b) => a.price - b.price)[0];
    const info = extractFlightInfo(best, flyFrom, flyTo);
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

/**
 * Search outbound + return flights.
 * Outbound: origins → pickupIata (camper ophalen)
 * Inbound:  dropoffIata → origins (camper terugbrengen)
 */
async function getFlightsForRoute(origins, pickupIata, dropoffIata, pickupDate, dropoffDate, departureWindow, returnWindow) {
  try {
    const outboundDate = addDays(pickupDate, -(departureWindow.daysBefore || 0));
    const inboundDate  = addDays(dropoffDate, returnWindow.daysAfter || 0);

    console.log(`    [Flights] Outbound: ${origins.join('/')} → ${pickupIata} op ${outboundDate}`);
    console.log(`    [Flights] Inbound:  ${dropoffIata} → ${origins.join('/')} op ${inboundDate}`);

    const outboundResults = await Promise.all(
      origins.map(origin =>
        callKiwiMcp(origin, pickupIata, outboundDate)
          .catch(e => { console.error(`    [Flights] outbound error (${origin}): ${e.message}`); return null; })
      )
    );

    const inboundResults = await Promise.all(
      origins.map(origin =>
        callKiwiMcp(dropoffIata, origin, inboundDate)
          .catch(e => { console.error(`    [Flights] inbound error (${origin}): ${e.message}`); return null; })
      )
    );

    const bestOutbound = outboundResults
      .filter(Boolean)
      .sort((a, b) => a.price - b.price)[0] || null;

    const bestInbound = inboundResults
      .filter(Boolean)
      .sort((a, b) => a.price - b.price)[0] || null;

    return { outbound: bestOutbound, inbound: bestInbound, flightError: null };
  } catch (e) {
    console.error(`[Flights] Kiwi MCP error: ${e.message}`);
    return { outbound: null, inbound: null, flightError: e.message };
  }
}

module.exports = { getFlightsForRoute };
