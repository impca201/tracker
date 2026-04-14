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
      arguments: {
        flyFrom,
        flyTo,
        departureDate,
        adults: 1
      }
    });

    const raw = result?.content?.[0]?.text;
    if (!raw) {
      console.log(`    [Kiwi MCP] Lege response voor ${flyFrom}->${flyTo} op ${departureDate}`);
      return null;
    }

    console.log(`    [Kiwi MCP raw] ${raw.slice(0, 400)}`);

    // Extract price: €123 or EUR 123
    const priceMatch = raw.match(/[€]\s*(\d+(?:[.,]\d+)?)|EUR\s*(\d+(?:[.,]\d+)?)/i);
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

async function getFlightsForRoute(origins, destinationIata, pickupDate, dropoffDate, departureWindow, returnWindow) {
  try {
    const outboundDate = addDays(pickupDate, -(departureWindow.daysBefore || 0));
    const inboundDate  = addDays(dropoffDate, returnWindow.daysAfter || 0);

    console.log(`    [Flights] Outbound: ${origins.join('/')} → ${destinationIata} op ${outboundDate}`);
    console.log(`    [Flights] Inbound:  ${destinationIata} → ${origins.join('/')} op ${inboundDate}`);

    const outboundResults = await Promise.all(
      origins.map(origin =>
        callKiwiMcp(origin, destinationIata, outboundDate)
          .catch(e => { console.error(`    [Flights] outbound error (${origin}): ${e.message}`); return null; })
      )
    );

    const inboundResults = await Promise.all(
      origins.map(origin =>
        callKiwiMcp(destinationIata, origin, inboundDate)
          .catch(e => { console.error(`    [Flights] inbound error (${origin}): ${e.message}`); return null; })
      )
    );

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
