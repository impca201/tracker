// One-off diagnostic: check a single route's timeframes directly, and show
// whether the origin station's `returns` list currently includes the
// destination. Usage: node scripts/check-one-route.js <fromId> <toId>
const { fetchStationList } = require('../roadsurfer-api');

const [fromId, toId] = process.argv.slice(2).map(Number);

async function main() {
  const stations = await fetchStationList();
  const from = stations.find(s => s.id === fromId);
  const to = stations.find(s => s.id === toId);
  console.log(`From: ${from ? from.name : '?'} (${fromId})`);
  console.log(`To: ${to ? to.name : '?'} (${toId})`);
  console.log(`${fromId} returns includes ${toId}? ${from ? from.returns.includes(toId) : 'n/a'}`);
  console.log(`${fromId} full returns list: ${from ? JSON.stringify(from.returns) : 'n/a'}`);

  const url = `${process.env.API_BASE_URL}${fromId}-${toId}`;
  console.log(`Fetching timeframes directly: ${url}`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'x-requested-alias': 'rally.timeframes',
      'Accept': 'application/json'
    }
  });
  console.log(`HTTP status: ${res.status}`);
  const text = await res.text();
  console.log(`Body: ${text.slice(0, 1000)}`);
}

main().catch(e => {
  console.error('[Error]', e.message);
  process.exit(1);
});
