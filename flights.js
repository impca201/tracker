// flights.js — Kiwi.com MCP client
// Calls the official Kiwi MCP server at https://mcp.kiwi.com using the MCP SDK.
// No API key needed. Realtime prices via the search-flight tool.
// Always resolves — never throws. On error, returns a flightError string.

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const KIWI_MCP_URL = 'https://mcp.kiwi.com';

/**
 * Create a fresh MCP client, connect, call search-flight, disconnect.
 * @param {object} args  - Arguments for the search-flight tool
 * @returns {object|null} Parsed first result or null
 */
async function callKiwiMcp(args) {
  const client = new Client(
    { name: 'camper-tracker', version: '1.0.0' },
    { capabilities: {} }
  );

  const transport = new StreamableHTTPClientTransport(
    new URL(KIWI_MCP_URL)
  );

  await client.connect(transport);

  try {
    const result = await client.callTool({
      name: 'search-flight',
      arguments: args
    });

    // Result content is an array of content blocks; first is text with JSON or markdown
    const raw = result?.content?.[0]?.text;
    if (!raw) return null;

    // Try to extract the cheapest flight from the returned text
    // The server returns a markdown table or JSON-like structure
    // We look for the first price in euros (e.g. €123 or EUR 123)
    const priceMatch = raw.match(/[€$]\s*(\d+(?:[.,]\d+)?)|EUR\s*(\d+(?:[.,]\d+)?)/i);
    const price = priceMatch
      ? parseFloat((priceMatch[1] || priceMatch[2]).replace(',', '.'))
      : null;

    // Extract booking link (shortened kiwi link)
    const linkMatch = raw.match(/https?:\/\/(?:www\.)?(?:kiwi\.com|go\.kiwi\.com|kiw\.i)[^\s)>"']+/);
    const link = linkMatch ? linkMatch[0] : `https://www.kiwi.com`;

    return price ? { price, link, raw } : null;
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
 * Look up outbound + return flights for a found camper route.
 * Always resolves — never throws. On error, returns a flightError string.
 *
 * @param {string[]} origins          - Departure airport IATA codes
 * @param {string}   destinationIata  - IATA code of the camper pickup city
 * @param {string}   pickupDate       - Camper pickup date (YYYY-MM-DD)
 * @param {string}   dropoffDate      - Camper drop-off date (YYYY-MM-DD)
 * @param {object}   departureWindow  - { daysBefore }
 * @param {object}   returnWindow     - { daysAfter }
 * @returns {{ outbound, inbound, flightError }}
 */
async function getFlightsForRoute(origins, destinationIata, pickupDate, dropoffDate, departureWindow, returnWindow) {
  try {
    const outboundDate = addDays(pickupDate, -departureWindow.daysBefore);
    const inboundDate  = addDays(dropoffDate, returnWindow.daysAfter);

    // Run outbound and inbound searches in parallel
    const [outboundRaw, inboundRaw] = await Promise.all([
      callKiwiMcp({
        trip_type: 'one-way',
        origin: origins[0],
        destination: destinationIata,
        dates: outboundDate,
        flexibility: departureWindow.daysBefore,
        passengers: { adults: 1 }
      }),
      callKiwiMcp({
        trip_type: 'one-way',
        origin: destinationIata,
        destination: origins[0],
        dates: inboundDate,
        flexibility: returnWindow.daysAfter,
        passengers: { adults: 1 }
      })
    ]);

    const outbound = outboundRaw
      ? { price: outboundRaw.price, origin: origins[0], destination: destinationIata, link: outboundRaw.link }
      : null;

    const inbound = inboundRaw
      ? { price: inboundRaw.price, origin: destinationIata, destination: origins[0], link: inboundRaw.link }
      : null;

    return { outbound, inbound, flightError: null };
  } catch (e) {
    console.error(`[Flights] Kiwi MCP error: ${e.message}`);
    return { outbound: null, inbound: null, flightError: e.message };
  }
}

module.exports = { getFlightsForRoute };
