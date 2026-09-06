// Manual debug helper: prints the live Rally station list.
// Usage: API_BASE_URL=... node scripts/fetch-live-stations.js
const { fetchStationList } = require('../roadsurfer-api');

fetchStationList()
  .then(stations => {
    console.log(`Total stations: ${stations.length}`);
    for (const s of stations.sort((a, b) => a.id - b.id)) {
      console.log(`${s.id}: ${s.name} (${s.country})`);
    }
  })
  .catch(e => {
    console.error('[Error]', e.message);
    process.exit(1);
  });
