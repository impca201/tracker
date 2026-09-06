// Diagnostic/maintenance script: fetches the live Roadsurfer Rally station
// list and prints it as `id: englishName (countryCode)` so it can be diffed
// against stations.json / config.js by hand or by check-station-drift.js.
//
// Derives the stations endpoint from the existing API_BASE_URL secret
// (which points at .../rally/timeframes/) rather than needing a new secret.
//
// Usage: node scripts/fetch-live-stations.js
const timeframesUrl = process.env.API_BASE_URL;
if (!timeframesUrl) {
  console.error('[Error] API_BASE_URL is not set.');
  process.exit(1);
}

const stationsUrl = timeframesUrl.replace(/rally\/timeframes\/?$/, 'rally/stations');
if (stationsUrl === timeframesUrl) {
  console.error(`[Error] Could not derive stations URL from API_BASE_URL (${timeframesUrl}). Expected it to end with "rally/timeframes/".`);
  process.exit(1);
}

async function main() {
  console.log(`Fetching station list from: ${stationsUrl}`);
  const res = await fetch(stationsUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'X-Requested-Alias': 'rally.startStations'
    }
  });

  if (!res.ok) {
    console.error(`[Error] HTTP ${res.status} fetching station list.`);
    process.exit(1);
  }

  const data = await res.json();
  if (!Array.isArray(data)) {
    console.error('[Error] Unexpected response shape (expected an array).');
    console.log(JSON.stringify(data).slice(0, 2000));
    process.exit(1);
  }

  console.log(`Total stations: ${data.length}`);
  console.log('---STATIONS-JSON-START---');
  // Print full structured JSON (id, english name, country code) for reliable parsing from logs.
  const clean = data
    .map(s => ({
      id: s.id,
      name: (s.translations && s.translations.en && s.translations.en.name) || '',
      country: (Array.isArray(s.country_codes) && s.country_codes[0]) || ''
    }))
    .sort((a, b) => a.id - b.id);
  console.log(JSON.stringify(clean));
  console.log('---STATIONS-JSON-END---');
}

main().catch(e => {
  console.error('[Error]', e.message);
  process.exit(1);
});
