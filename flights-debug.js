// flights-debug.js — Standalone debug script voor Kiwi MCP flights
// Gebruik via GitHub Actions workflow 'Flights Debug' of lokaal met env vars

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');

const flyFrom  = process.env.FLY_FROM       || 'BRU';
const flyTo    = process.env.FLY_TO         || 'BCN';
const dateISO  = process.env.DEPARTURE_DATE || '2026-05-01';
const showAll  = process.env.SHOW_ALL !== 'false';
const maxStops = parseInt(process.env.MAX_STOPOVERS ?? '0', 10);

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
  if (Array.isArray(flight.layovers)) return flight.layovers.length === 0;
  if (Array.isArray(flight.route))    return flight.route.length === 1;
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

function printFlight(f, index) {
  const dur     = f.durationInSeconds || f.totalDurationInSeconds || 0;
  const layovers = Array.isArray(f.layovers) ? f.layovers.length : '?';
  const dep     = f.departure?.local || '?';
  const arr     = f.arrival?.local   || '?';
  const direct  = isDirectFlight(f);
  const flag    = direct ? '✓ DIRECT' : `✗ FILTER`;
  const reasons = [];
  if (dur > MAX_DIRECT_FLIGHT_SECONDS) reasons.push(`duur ${formatDuration(dur)} > 6h cap`);
  if (Array.isArray(f.layovers) && f.layovers.length > 0) reasons.push(`${f.layovers.length} layover(s)`);

  console.log(`  [${index + 1}] €${f.price} | ${dep.slice(11,16)} → ${arr.slice(11,16)} | ${formatDuration(dur)} | layovers:${layovers} | ${flag}${reasons.length ? ' ↳ ' + reasons.join(' + ') : ''}`);

  // Dump layover detail indien aanwezig
  if (Array.isArray(f.layovers) && f.layovers.length > 0) {
    f.layovers.forEach((l, i) => console.log(`       layover[${i}]: ${JSON.stringify(l)}`));
  }
}

async function run() {
  const kiwiDate = toKiwiDate(dateISO);

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log(`║  FLIGHTS DEBUG: ${flyFrom} → ${flyTo}`);
  console.log(`║  Datum:          ${kiwiDate}  (ISO: ${dateISO})`);
  console.log(`║  max_stopovers:  ${maxStops}`);
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const { error, flights } = await callKiwiMcp(kiwiDate);

  if (error) { console.log(`✗ Fout: ${error}`); return; }
  if (flights.length === 0) { console.log('✗ Geen vluchten teruggekeerd.'); return; }

  // Veldnamen overzicht
  const allKeys = [...new Set(flights.flatMap(f => Object.keys(f)))].sort();
  console.log('Top-level velden:', allKeys.join(', '));

  // layovers structuur op eerste vlucht met layovers
  const withLayover = flights.find(f => Array.isArray(f.layovers) && f.layovers.length > 0);
  if (withLayover) {
    console.log('\nVoorbeeld layover object:');
    console.log(JSON.stringify(withLayover.layovers[0], null, 2));
  } else {
    console.log('ℹ️  Geen enkele vlucht heeft layovers → alle vluchten zijn direct (layovers=[]).');
  }

  const direct   = flights.filter(isDirectFlight);
  const filtered = flights.filter(f => !isDirectFlight(f));

  console.log(`\nTotaal: ${flights.length} | Direct: ${direct.length} | Gefilterd: ${filtered.length}\n`);

  if (showAll) {
    console.log('-- Alle vluchten (gesorteerd op prijs) --');
    [...flights].sort((a, b) => a.price - b.price).forEach((f, i) => printFlight(f, i));
  } else {
    const best = direct.sort((a, b) => a.price - b.price)[0];
    if (best) { console.log('-- Beste directe vlucht --'); printFlight(best, 0); }
    else console.log('✗ Geen directe vluchten na filter.');
  }

  const kiwiUrl = `https://www.kiwi.com/en/search/results/${flyFrom.toLowerCase()}/${flyTo.toLowerCase()}/${dateISO}`;
  console.log(`\n→ Vergelijk op Kiwi.com: ${kiwiUrl}`);
  console.log('\n══════════════════════════════════════════════════════\n');
}

run().catch(e => {
  console.error('[flights-debug] Fatale fout:', e.message);
  process.exit(1);
});
