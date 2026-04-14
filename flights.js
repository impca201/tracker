// flights.js — Travelpayouts (Aviasales) Data API integration
// Looks up the cheapest flight for a given route and date window.
// Returns null (with a flightError) if the API is unavailable — the main job continues regardless.
//
// API docs: https://support.travelpayouts.com/hc/en-us/articles/203956163
// Register: https://travelpayouts.com → Programmes → Data API
// GitHub Secret needed: TRAVELPAYOUTS_TOKEN

const BASE = 'https://api.travelpayouts.com';

function toYearMonth(dateStr) {
  // Returns "YYYY-MM" from "YYYY-MM-DD"
  return dateStr.slice(0, 7);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Search for the cheapest one-way flight using the /v1/prices/cheap endpoint.
 * Prices come from Travelpayouts cache (last 48h searches).
 *
 * @param {string[]} fromCodes   - Origin IATA codes (city codes preferred)
 * @param {string}   toCode      - Destination city IATA code
 * @param {string}   dateFrom    - Earliest departure date (YYYY-MM-DD)
 * @param {string}   dateTo      - Latest departure date  (YYYY-MM-DD)
 * @returns {{ price, origin, destination, departure_at, link }|null}
 */
async function searchFlight(fromCodes, toCode, dateFrom, dateTo) {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token) throw new Error('TRAVELPAYOUTS_TOKEN secret is not set.');

  // The /v1/prices/cheap endpoint filters by month; pick the month of dateFrom.
  const departMonth = toYearMonth(dateFrom);

  // Try each origin code and return the cheapest result found
  let best = null;

  for (const origin of fromCodes) {
    const params = new URLSearchParams({
      origin,
      destination: toCode,
      depart_date: departMonth,
      one_way: 'true',
      currency: 'eur',
      token
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(`${BASE}/v1/prices/cheap?${params}`, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!res.ok) throw new Error(`Travelpayouts API status ${res.status}`);

      const json = await res.json();
      if (!json.success || !json.data || !json.data[toCode]) continue;

      // data[toCode] is an object keyed by sequence number { "0": {...}, "1": {...} }
      const tickets = Object.values(json.data[toCode]);

      // Filter to tickets within our date window and pick cheapest
      const inWindow = tickets.filter(t => {
        if (!t.departure_at) return false;
        const dep = t.departure_at.slice(0, 10);
        return dep >= dateFrom && dep <= dateTo;
      });

      const candidate = inWindow.sort((a, b) => a.price - b.price)[0] || null;
      if (candidate && (!best || candidate.price < best.price)) {
        best = {
          price: candidate.price,
          origin,
          destination: toCode,
          departure_at: candidate.departure_at,
          link: `https://www.kiwi.com/en/search/results/${origin}/${toCode}/${departMonth.replace('-', '')}/no-return`
        };
      }
    } catch (e) {
      clearTimeout(timeoutId);
      throw e;
    }
  }

  return best;
}

/**
 * Look up outbound + return flights for a found camper route.
 * Always resolves — never throws. On API error, returns a flightError string.
 *
 * @param {string[]} origins          - Departure airport IATA codes from config.flights.origins
 * @param {string}   destinationIata  - IATA code of the camper pickup city
 * @param {string}   pickupDate       - Camper pickup date (YYYY-MM-DD)
 * @param {string}   dropoffDate      - Camper drop-off date (YYYY-MM-DD)
 * @param {object}   departureWindow  - { daysBefore, latestArrivalHour }
 * @param {object}   returnWindow     - { daysAfter, earliestDepartureHour }
 * @returns {{ outbound, inbound, flightError }}
 */
async function getFlightsForRoute(origins, destinationIata, pickupDate, dropoffDate, departureWindow, returnWindow) {
  try {
    const outboundDateFrom = addDays(pickupDate, -departureWindow.daysBefore);
    const outboundDateTo   = pickupDate;

    const inboundDateFrom  = dropoffDate;
    const inboundDateTo    = addDays(dropoffDate, returnWindow.daysAfter);

    const [outbound, inbound] = await Promise.all([
      searchFlight(origins, destinationIata, outboundDateFrom, outboundDateTo),
      searchFlight([destinationIata], origins[0], inboundDateFrom, inboundDateTo)
    ]);

    return { outbound, inbound, flightError: null };
  } catch (e) {
    console.error(`[Flights] Error fetching flights: ${e.message}`);
    return { outbound: null, inbound: null, flightError: e.message };
  }
}

module.exports = { getFlightsForRoute };
