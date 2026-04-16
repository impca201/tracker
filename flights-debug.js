// flights-debug.js — Standalone debug script voor Kiwi MCP flights
// Gebruik via GitHub Actions workflow 'Flights Debug' of lokaal met env vars

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');

const flyFrom     = process.env.FLY_FROM       || 'BRU';
const flyTo       = process.env.FLY_TO         || 'BCN';
const dateISO     = process.env.DEPARTURE_DATE || '2026-05-01';
const showAll     = process.env.SHOW_ALL !== 'false';
const maxStops    = parseInt(process.env.MAX_STOPOVERS ?? '0', 10);

const KIWI_MCP_URL = 'https://mcp.kiwi.com';
const MAX_DIRECT_FLIGHT_SECONDS = 6 * 3600;

function toKiwiDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
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
  if (flight.route && Array.isArray(flight.route)) return flight.route.length === 1;
  if (flight.totalDurationInSeconds !== undefined && flight.durationInSeconds !== undefined) {
    return flight.totalDurationInSeconds === flight.durationInSeconds;
  }
  return false;
}

async function callKiwiMcp(departureDate) {
  const client = new Client({ name: 'flights-debug', version: '1.0.0' }, { capabilities: {} });
  const transport = new SSEClientTransport(new URL(KIWI_MCP_URL));
  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: 'search-flight',
      arguments: { flyFrom, flyTo, departureDate, adults: 1, max_stopovers: maxStops }
    });
    const raw = result?.content?.[0]?.text;
    if (!raw) return { error: 'Lege response van MCP', flights: [] };
    try {
      const flights = JSON.parse(raw);
      return { error: null, flights: Array.isArray(flights) ? flights : [] };
    } catch {
      return { error: `JSON parse fout: ${raw.slice(0, 300)}`, flights: [] };
    }
  } finally {
    await client.close();
  }
}

function printFlight(f, index, tag = '') {
  const dur = f.durationInSeconds || f.totalDurationInSeconds || 0;
  const stops = f.route?.length ?? '?';
  const segment = Array.isArray(f.route) ? f.route[0] : null;
  const dep = f.departure?.local || segment?.local_departure || segment?.localDeparture || '?';
  const arr = f.arrival?.local || segment?.local_arrival || segment?.localArrival || '?';
  const airline = segment?.airlineName || f.airlineNames?.[0] || f.airlines?.[0] || segment?.airline || 'Unknown';
  const flightNo = segment?.flight_no || segment?.flightNo || f.flightNo || '';
  const directFlag = isDirectFlight(f) ? '✓ DIRECT' : `✗ FILTER (${stops} stops, ${formatDuration(dur)})`;
  console.log(`  [${index + 1}] ${tag}€${f.price} | ${airline} ${flightNo} | ${dep?.slice(11,16) || dep} → ${arr?.slice(11,16) || arr} | ${formatDuration(dur)} | stops:${stops} | ${directFlag}`);
  if (!isDirectFlight(f)) {
    const reason = [];
    if (dur > MAX_DIRECT_FLIGHT_SECONDS) reason.push(`duur ${formatDuration(dur)} > 6h cap`);
    if (f.route?.length > 1) reason.push(`${f.route.length} route-segmenten`);
    console.log(`        ↳ Gefilterd omdat: ${reason.join(' + ')}`);
  }
}

async function run() {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log(`║  FLIGHTS DEBUG: ${flyFrom} → ${flyTo}`);
  console.log(`║  Datum (ISO):   ${dateISO}`);
  console.log(`║  Datum (Kiwi):  ${toKiwiDate(dateISO)}`);
  console.log(`║  max_stopovers: ${maxStops}`);
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const datesToTest = [
    { label: 'DD/MM/YYYY (huidig formaat in code)', value: toKiwiDate(dateISO) },
    { label: 'YYYY-MM-DD (ISO formaat)',            value: dateISO }
  ];

  for (const { label, value } of datesToTest) {
    console.log(`\n━━━ API call met datum: "${value}" (${label}) ━━━`);
    const { error, flights } = await callKiwiMcp(value);

    if (error) {
      console.log(`  ✗ Fout: ${error}`);
      continue;
    }

    if (flights.length === 0) {
      console.log('  ✗ Geen vluchten teruggekeerd van MCP.');
      continue;
    }

    const direct = flights.filter(isDirectFlight);
    const filtered = flights.filter(f => !isDirectFlight(f));

    console.log(`  Totaal ontvangen: ${flights.length} vluchten`);
    console.log(`  Na filter (direct + <6h): ${direct.length} | Weggefilterd: ${filtered.length}\n`);

    if (showAll) {
      console.log('  -- Alle vluchten (gesorteerd op prijs) --');
      [...flights].sort((a, b) => a.price - b.price).forEach((f, i) => printFlight(f, i));
    } else {
      if (direct.length > 0) {
        const best = direct.sort((a, b) => a.price - b.price)[0];
        console.log('  -- Beste directe vlucht (= wat de tracker gebruikt) --');
        printFlight(best, 0);
      } else {
        console.log('  ✗ Geen directe vluchten gevonden na filter.');
      }
    }

    if (filtered.length > 0) {
      console.log(`\n  -- ${filtered.length} weggefilterde vluchten --`);
      filtered.sort((a, b) => a.price - b.price).forEach((f, i) => printFlight(f, i, ''));
    }

    // Kiwi.com vergelijkingslink
    const kiwiUrl = `https://www.kiwi.com/en/search/results/${flyFrom.toLowerCase()}/${flyTo.toLowerCase()}/${dateISO}`;
    console.log(`\n  → Vergelijk zelf op Kiwi.com: ${kiwiUrl}`);

    if (!showAll) break; // Bij showAll=false enkel 1e datumformaat nodig
  }

  console.log('\n══════════════════════════════════════════════════════\n');
}

run().catch(e => {
  console.error('[flights-debug] Fatale fout:', e.message);
  process.exit(1);
});
