// roadsurfer-api.js — thin client for the Roadsurfer Rally API.
//
// Two endpoints, both derived from the single API_BASE_URL secret (which
// points at .../rally/timeframes/):
//   - stations list (X-Requested-Alias: rally.startStations) — every
//     station Roadsurfer currently has, with its live numeric ID and
//     display name.
//   - per-station detail (X-Requested-Alias: rally.fetchRoutes) — for one
//     station, its live `returns` list: the destination station IDs it's
//     currently one-way-reachable to.
//
// Station IDs are not stable long-term (Roadsurfer has been observed to
// retire a station and reassign its old numeric ID to a different city).
// So nothing in this codebase hardcodes an ID: config.js names cities by
// their display name, and run() resolves those names against a freshly
// fetched station list at the start of every run.
//
// The stations-list response also carries a `returns` field bundled into
// each entry, which looks like the same data as the per-station detail
// call above — it isn't. A direct comparison found a station whose bundled
// `returns` was empty while its timeframes endpoint still reported a live,
// bookable offer to a destination not listed; the per-station detail call
// for that same station, checked separately, did include it. So only the
// per-station detail endpoint's `returns` is trusted here; the bundled
// field on the list response is ignored.

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function deriveStationsUrl(timeframesUrl) {
  const stationsUrl = timeframesUrl.replace(/rally\/timeframes\/?$/, 'rally/stations');
  if (stationsUrl === timeframesUrl) {
    throw new Error(`Could not derive the stations URL from API_BASE_URL (${timeframesUrl}). Expected it to end with "rally/timeframes/".`);
  }
  return stationsUrl;
}

async function getJson(url, alias, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/plain, */*',
        'X-Requested-Alias': alias
      },
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

// Returns every current Rally station as { id, name, country, countryName }.
async function fetchStationList() {
  const stationsUrl = deriveStationsUrl(process.env.API_BASE_URL);
  const data = await getJson(stationsUrl, 'rally.startStations');
  if (!Array.isArray(data)) {
    throw new Error('Unexpected station list response shape (expected an array).');
  }
  return data.map(s => ({
    id: s.id,
    name: s.name || `Station ${s.id}`,
    country: (s.city && s.city.country) || '??',
    countryName: (s.city && s.city.country_name) || ''
  }));
}

// Returns the live list of destination station IDs a station is currently
// one-way-reachable to (its `returns` field from the per-station detail
// endpoint — see the header comment for why this endpoint, not the list
// response's bundled field, is the one to trust).
async function fetchStationReturns(id) {
  const stationsUrl = deriveStationsUrl(process.env.API_BASE_URL);
  const data = await getJson(`${stationsUrl}/${id}`, 'rally.fetchRoutes');
  if (!data || !Array.isArray(data.returns)) {
    throw new Error(`Unexpected station detail response shape for station ${id} (expected a "returns" array).`);
  }
  return data.returns.map(Number);
}

module.exports = { fetchStationList, fetchStationReturns };
