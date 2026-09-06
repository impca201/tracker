// roadsurfer-api.js — thin client for the Roadsurfer Rally API.
//
// Three endpoints, all derived from the single API_BASE_URL secret
// (which points at .../rally/timeframes/):
//   - stations list   (X-Requested-Alias: rally.startStations) — every
//     station Roadsurfer currently has, with its live numeric ID and name.
//   - station routes  (X-Requested-Alias: rally.fetchRoutes)   — for one
//     station, the numeric IDs of every destination it can actually be
//     one-wayed to right now.
//   - timeframes       (X-Requested-Alias: rally.timeframes)    — for one
//     origin-destination pair, the available date windows.
//
// Station IDs are not stable long-term (Roadsurfer has been observed to
// retire a station and reassign its old numeric ID to a different city).
// So nothing in this codebase hardcodes an ID: config.js names cities by
// their English display name, and run() resolves those names against a
// freshly fetched station list at the start of every run.

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function deriveBaseUrls(timeframesUrl) {
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
// `name`/`countryName` are the English display names.
async function fetchStationList() {
  const stationsUrl = deriveBaseUrls(process.env.API_BASE_URL);
  const data = await getJson(stationsUrl, 'rally.startStations');
  if (!Array.isArray(data)) {
    throw new Error('Unexpected station list response shape (expected an array).');
  }
  return data.map(s => ({
    id: s.id,
    name: (s.translations && s.translations.en && s.translations.en.name) || `Station ${s.id}`,
    country: (Array.isArray(s.country_codes) && s.country_codes[0]) || '??',
    countryName: (s.country_translations && s.country_translations.en && s.country_translations.en.name) || ''
  }));
}

// Returns the numeric IDs of every destination station currently reachable
// one-way from `stationId`, or [] if the station has no rally routes.
async function fetchStationReturns(stationId) {
  const stationsUrl = deriveBaseUrls(process.env.API_BASE_URL);
  const data = await getJson(`${stationsUrl}/${stationId}`, 'rally.fetchRoutes');
  const returns = data && data.returns;
  return Array.isArray(returns) ? returns : [];
}

module.exports = { fetchStationList, fetchStationReturns };
