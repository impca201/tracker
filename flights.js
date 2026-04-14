// flights.js — Kiwi.com MCP client
// Calls the official Kiwi MCP server at https://mcp.kiwi.com using the MCP SDK.
// No API key needed. Realtime prices.
// Always resolves — never throws. On error, returns a flightError string.

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const KIWI_MCP_URL = 'https://mcp.kiwi.com';

/**
 * Call the Kiwi MCP search-flight tool.
 * Returns { price, link } or null.
 */
async function callKiwiMcp(args) {
  const client = new Client(
    { name: 'camper-tracker', version: '1.0.0' },
    { capabilities: {} }
  );
  const transport = new StreamableHTTPClientTransport(new URL(KIWI_MCP_URL));
  await client.connect(transport);

  try {
    const result = await client.callTool({ name: 'search-flight', arguments: args });
    const raw = result?.content?.[0]?.text;
    if (!raw) return null;

    console.log(`    [Kiwi MCP raw] ${raw.slice(0, 300)}`);

    // Extract price: €123 or EUR 123
    const priceMatch = raw.match(/[€\u20ac]\s*(\d+(?:[.,]\d+)?)|EUR\s*(\d+(?:[.,]\d+)?)/i);
    const price = priceMatch
      ? parseFloat((priceMatch[1] || priceMatch[2]).replace(',', '.'))
      : null;

    // Extract booking link
    const linkMatch = raw.match(/https?:\/\/[^\s)>"']*kiwi\.com[^\s)>"']*/i);
    const link = linkMatch ? linkMatch[0] : 'https://www.kiwi.com';

    return price ? { price, link } : null;
  } finally {
    await client.close();
  }
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Search outbound + return flights for all configured origins.
 * Takes the cheapest result across all origin airports.
 * Always resolves — never throws.
 *
 * @param {string[]} origins         - IATA codes of departure airports e.g. ['BRU','CRL']
 * @param {string}   destinationIata - IATA code of camper pickup city
 * @param {string}   pickupDate      - YYYY-MM-DD
 * @param {string}   dropoffDate     - YYYY-MM-DD
 * @param {object}   departureWindow - { daysBefore }
 * @param {object}   returnWindow    - { daysAfter }
 * @returns {{ outbound, inbound, flightError }}
 */
async function getFlightsForRoute(origins, destinationIata, pickupDate, dropoffDate, departureWindow, returnWindow) {
  try {
    const outboundDate = addDays(pickupDate, -(departureWindow.daysBefore || 0));
    const inboundDate  = addDays(dropoffDate, returnWindow.daysAfter || 0);

    // Search all origins in parallel, pick the cheapest
    const outboundResults = await Promise.all(
      origins.map(origin => callKiwiMcp({
        trip_type: 'one-way',
        origin,
        destination: destinationIata,
        dates: outboundDate,
        flexibility: departureWindow.daysBefore || 0,
        passengers: { adults: 1 }
      }).catch(() => null))
    );

    const inboundResults = await Promise.all(
      origins.map(origin => callKiwiMcp({
        trip_type: 'one-way',
        origin: destinationIata,
        destination: origin,
        dates: inboundDate,
        flexibility: returnWindow.daysAfter || 0,
        passengers: { adults: 1 }
      }).catch(() => null))
    );

    // Pick cheapest across all origins
    const bestOutbound = outboundResults
      .map((r, i) => r ? { ...r, origin: origins[i], destination: destinationIata } : null)
      .filter(Boolean)
      .sort((a, b) => a.price - b.price)[0] || null;

    const bestInbound = inboundResults
      .map((r, i) => r ? { ...r, origin: destinationIata, destination: origins[i] } : null)
      .filter(Boolean)
      .sort((a, b) => a.price - b.price)[0] || null;

    return { outbound: bestOutbound, inbound: bestInbound, flightError: null };
  } catch (e) {
    console.error(`[Flights] Kiwi MCP error: ${e.message}`);
    return { outbound: null, inbound: null, flightError: e.message };
  }
}

module.exports = { getFlightsForRoute };
