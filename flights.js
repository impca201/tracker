// flights.js — Kiwi.com MCP client
// Calls the official Kiwi MCP server at https://mcp.kiwi.com using the MCP SDK.
// No API key needed. Realtime prices.
// Always resolves — never throws. On error, returns a flightError string.

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const KIWI_MCP_URL = 'https://mcp.kiwi.com';

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

    let flights;
    try {
      flights = JSON.parse(raw);
    } catch {
      console.log(`    [Kiwi MCP] Kon JSON niet parsen: ${raw.slice(0, 200)}`);
      return null;
    }

    if (!Array.isArray(flights) || flights.length === 0) return null;

    const best = flights.sort((a, b) => a.price - b.price)[0];
    const price = best.price;
    const link = best.deepLink || best.bookingLink || `https://www.kiwi.com/deep?from=${flyFrom}&to=${flyTo}&departure=${departureDate}`;

    console.log(`    [Kiwi MCP] Beste vlucht: ${flyFrom}->${flyTo} €${price}`);
    return { price, link };
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
 *
 * @param {string[]} origins       - IATA codes van vertrekhavens e.g. ['BRU','CRL']
 * @param {string}   pickupIata    - IATA van de stad waar je de camper ophaalt
 * @param {string}   dropoffIata   - IATA van de stad waar je de camper terugbrengt
 * @param {string}   pickupDate    - YYYY-MM-DD
 * @param {string}   dropoffDate   - YYYY-MM-DD
 * @param {object}   departureWindow - { daysBefore }
 * @param {object}   returnWindow    - { daysAfter }
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
      .map((r, i) => r ? { ...r, origin: origins[i], destination: pickupIata } : null)
      .filter(Boolean)
      .sort((a, b) => a.price - b.price)[0] || null;

    const bestInbound = inboundResults
      .map((r, i) => r ? { ...r, origin: dropoffIata, destination: origins[i] } : null)
      .filter(Boolean)
      .sort((a, b) => a.price - b.price)[0] || null;

    return { outbound: bestOutbound, inbound: bestInbound, flightError: null };
  } catch (e) {
    console.error(`[Flights] Kiwi MCP error: ${e.message}`);
    return { outbound: null, inbound: null, flightError: e.message };
  }
}

module.exports = { getFlightsForRoute };
