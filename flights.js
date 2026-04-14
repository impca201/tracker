// flights.js — Kiwi Tequila API integration
// Looks up the cheapest flight for a given route and date window.
// Returns null (with a flightError) if the API is unavailable — the main job continues regardless.

const TEQUILA_BASE = 'https://tequila-api.kiwi.com';

function toKiwiDate(date) {
  const d = new Date(date);
  return `${d.getUTCDate().toString().padStart(2, '0')}/${(d.getUTCMonth() + 1).toString().padStart(2, '0')}/${d.getUTCFullYear()}`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Search for the cheapest one-way flight.
 * @param {string[]} fromCodes  - Array of origin IATA codes (e.g. ['BRU','CRL'])
 * @param {string} toCode       - Destination city IATA code (e.g. 'MAD')
 * @param {string} dateFrom     - Earliest departure date (YYYY-MM-DD)
 * @param {string} dateTo       - Latest departure date (YYYY-MM-DD)
 * @param {number|null} maxArrivalHour  - Optional: only flights arriving by this hour (UTC)
 * @param {number|null} minDepartureHour - Optional: only flights departing from this hour (UTC)
 * @returns {{ price: number, origin: string, deep_link: string }|null}
 */
async function searchFlight(fromCodes, toCode, dateFrom, dateTo, maxArrivalHour = null, minDepartureHour = null) {
  const apiKey = process.env.KIWI_API_KEY;
  if (!apiKey) throw new Error('KIWI_API_KEY secret is not set.');

  const params = new URLSearchParams({
    fly_from: fromCodes.join(','),
    fly_to: toCode,
    date_from: toKiwiDate(dateFrom),
    date_to: toKiwiDate(dateTo),
    one_for_city: '1',
    curr: 'EUR',
    limit: '10',
    sort: 'price',
    asc: '1'
  });

  if (maxArrivalHour !== null) {
    params.set('arrival_time_to', `${String(maxArrivalHour).padStart(2, '0')}:00`);
  }
  if (minDepartureHour !== null) {
    params.set('dtime_from', `${String(minDepartureHour).padStart(2, '0')}:00`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`${TEQUILA_BASE}/v2/search?${params}`, {
      headers: { apikey: apiKey, 'Accept': 'application/json' },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Kiwi API returned status ${res.status}`);
    }

    const data = await res.json();
    if (!data.data || data.data.length === 0) return null;

    const best = data.data[0];
    return {
      price: best.price,
      origin: best.cityFrom,
      destination: best.cityTo,
      deep_link: best.deep_link
    };
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

/**
 * Look up outbound + return flights for a found camper route.
 * Always resolves — never throws. On API error, returns a flightError string.
 *
 * @param {string[]} origins       - Departure airport IATA codes from config.flights.origins
 * @param {string} destinationIata - IATA code of the camper pickup city
 * @param {string} pickupDate      - Camper pickup date (ISO string)
 * @param {string} dropoffDate     - Camper drop-off date (ISO string)
 * @param {object} departureWindow - { daysBefore, latestArrivalHour }
 * @param {object} returnWindow    - { daysAfter, earliestDepartureHour }
 * @returns {{ outbound, inbound, flightError }|null}
 */
async function getFlightsForRoute(origins, destinationIata, pickupDate, dropoffDate, departureWindow, returnWindow) {
  try {
    // Outbound: from home airports → destination
    const outboundDateFrom = addDays(pickupDate, -departureWindow.daysBefore);
    const outboundDateTo   = pickupDate;
    const outbound = await searchFlight(
      origins,
      destinationIata,
      outboundDateFrom,
      outboundDateTo,
      departureWindow.latestArrivalHour,
      null
    );

    // Return: from destination → home airports
    const inboundDateFrom = dropoffDate;
    const inboundDateTo   = addDays(dropoffDate, returnWindow.daysAfter);
    const inbound = await searchFlight(
      [destinationIata],
      origins.join(','),
      inboundDateFrom,
      inboundDateTo,
      null,
      returnWindow.earliestDepartureHour
    );

    return { outbound, inbound, flightError: null };
  } catch (e) {
    console.error(`[Flights] Error fetching flights: ${e.message}`);
    return { outbound: null, inbound: null, flightError: e.message };
  }
}

module.exports = { getFlightsForRoute };
