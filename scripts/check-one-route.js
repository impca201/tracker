// Manual debug helper: check a single route two ways —
//   1. the per-station detail endpoint (rally.fetchRoutes), matching
//      4mazon/roadsurfer-van-rally's approach exactly
//   2. the timeframes endpoint directly (the real bookability signal)
// to see whether they agree. Usage:
//   API_BASE_URL=... node scripts/check-one-route.js <fromId> <toId>
const { fetchStationList } = require('../roadsurfer-api');

const [fromId, toId] = process.argv.slice(2).map(Number);
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function stationsUrl() {
  return process.env.API_BASE_URL.replace(/rally\/timeframes\/?$/, 'rally/stations');
}

async function main() {
  const stations = await fetchStationList();
  const from = stations.find(s => s.id === fromId);
  const to = stations.find(s => s.id === toId);
  console.log(`From: ${from ? from.name : '?'} (${fromId})`);
  console.log(`To: ${to ? to.name : '?'} (${toId})`);

  const detailUrl = `${stationsUrl()}/${fromId}`;
  console.log(`\nFetching per-station detail (rally.fetchRoutes): ${detailUrl}`);
  const detailRes = await fetch(detailUrl, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json, text/plain, */*', 'X-Requested-Alias': 'rally.fetchRoutes' }
  });
  console.log(`HTTP status: ${detailRes.status}`);
  const detail = await detailRes.json();
  console.log(`one_way: ${detail.one_way}`);
  console.log(`returns: ${JSON.stringify(detail.returns)}`);
  console.log(`returns includes ${toId}? ${Array.isArray(detail.returns) && detail.returns.includes(toId)}`);

  const tfUrl = `${process.env.API_BASE_URL}${fromId}-${toId}`;
  console.log(`\nFetching timeframes directly: ${tfUrl}`);
  const tfRes = await fetch(tfUrl, {
    headers: { 'User-Agent': USER_AGENT, 'x-requested-alias': 'rally.timeframes', 'Accept': 'application/json' }
  });
  console.log(`HTTP status: ${tfRes.status}`);
  console.log(`Body: ${await tfRes.text()}`);
}

main().catch(e => {
  console.error('[Error]', e.message);
  process.exit(1);
});
