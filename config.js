// Configuration for Tracker
//
// City selection:
// Cities are grouped by region. All cities in a region are always active.
// Control which routes are searched via the `routes` array below.
//
// Cities are named, not numbered. Roadsurfer's own numeric station IDs
// have been observed to change over time (a retired station's ID gets
// reassigned to a different city later on), so the tracker resolves these
// English display names against a freshly fetched station list at the
// start of every run instead of hardcoding IDs. If a name below no longer
// matches any live station (renamed, or the station closed), the run logs
// a warning and includes it in the error email rather than silently
// tracking the wrong city — so a mismatch here surfaces on its own,
// nothing extra to check.

module.exports = {
  regions: {

    // --- AT (Austria) ---
    AT: [
      'Graz',
      'Innsbruck',
      'Linz',
      'Salzburg',
      'Vienna',
      'Vienna South',
    ],

    // --- BE (Belgium) ---
    BE: [
      'Antwerp',
      'Brussels',
    ],

    // --- CA (Canada) ---
    CA: [
      'Calgary',
      'Vancouver',
    ],

    // --- CH (Switzerland) ---
    CH: [
      'Bern',
      'Lucerne',
      'Zurich (Wetzikon)',
    ],

    // --- DE-NORTH (Germany North) ---
    DE_NORTH: [
      'Braunschweig',
      'Bremen',
      'Flensburg',
      'Hamburg',
      'Hamburg Airport',
      'Hanover',
      'Kiel',
      'Lübeck',
    ],

    // --- DE-EAST (Germany East) ---
    DE_EAST: [
      'Berlin',
      'Chemnitz',
      'Dresden',
      'Erfurt',
      'Leipzig',
    ],

    // --- DE-WEST (Germany West) ---
    DE_WEST: [
      'Aachen',
      'Berlin-Schönefeld',
      'Bielefeld',
      'Bochum',
      'Duisburg',
      'Frankfurt',
      'Kassel',
      'Cologne-Bonn',
      'Cologne-Dusseldorf',
      'Mainz',
      'Marburg',
      'Mönchengladbach',
      'Munster-Senden',
      'Trier',
    ],

    // --- DE-SOUTH (Germany South) ---
    DE_SOUTH: [
      'Augsburg',
      'Freiburg-Basel (Germany)',
      'Constance (Aach)',
      'Lindau-Wangen',
      'Murnau',
      'Munich',
      'Nuremberg',
      'Regensburg',
      'Stuttgart',
      'Stuttgart-Esslingen',
      'Ulm',
      'Würzburg',
    ],

    // --- DE (Germany Other) ---
    DE_OTHER: [
      'Darmstadt',
      'Heidelberg',
      'Karlsruhe',
      'LMC Caravan',
    ],

    // --- ES (Spain) ---
    ES: [
      'Barcelona',
      'Bilbao',
      'Madrid',
      'Malaga',
      'Seville',
      'Valencia',
    ],

    // --- FR-NORTH (France North) ---
    FR_NORTH: [
      'Geneva-Pays de Gex (France)',
      'Lille',
      'Nantes',
      'Paris South (Orly)',
      'Paris Airport CDG',
      'Strasbourg',
    ],

    // --- FR-SOUTH (France South) ---
    FR_SOUTH: [
      'Aix-Marseille',
      'Bordeaux',
      'Lyon',
      'Nice',
      'Toulouse',
    ],

    // --- GB (United Kingdom) ---
    GB: [
      'Bristol',
      'Edinburgh',
      'London',
      'Manchester',
    ],

    // --- HR (Croatia) ---
    HR: [
      'Split',
    ],

    // --- IE (Ireland) ---
    IE: [
      'Dublin',
    ],

    // --- IT-NORTH (Italy North) ---
    IT_NORTH: [
      'Bergamo',
      'Milan',
      'Turin',
      'Venice',
    ],

    // --- IT-SOUTH (Italy South) ---
    IT_SOUTH: [
      'Bologna',
      'Florence',
      'Rome Fiumicino Airport',
    ],

    // --- NL (Netherlands) ---
    NL: [
      'Amsterdam',
      'Rotterdam',
    ],

    // --- NO (Norway) ---
    NO: [
      'Bergen',
      'Oslo',
    ],

    // --- PT (Portugal) ---
    PT: [
      'Faro',
      'Lisbon',
      'Porto',
    ],

    // --- SE (Sweden) ---
    SE: [
      'Gothenburg',
      'Malmo',
      'Stockholm',
    ],

    // --- US (United States) ---
    US: [
      'Dallas',
      'Denver',
      'Elkhart',
      'Las Vegas',
      'Los Angeles',
      'Miami',
      'New York',
      'Phoenix',
      'Pt Roberts (near Vancouver)',
      'Salt Lake City',
      'San Francisco',
      'Seattle',
      'Thor Industries',
      'Winnebago Industries',
    ],

  },

  // Routes to search: each entry is [from, to].
  // Each side can be either:
  //   - a region key (string)      → all active cities in that region, e.g. 'ES'
  //   - a literal city name (string) → a single specific city, e.g. 'Barcelona'
  //     (must match a live station's English name exactly; anything that
  //     isn't a known region key is treated as a city name)
  // Same region on both sides = within-region routes (e.g. Spain → Spain).
  // Examples:
  //   ['BE', 'ES']          → all Belgian cities to all Spanish cities
  //   ['BE', 'Barcelona']   → all Belgian cities to Barcelona only
  //   ['Antwerp', 'PT']     → Antwerp only to all Portuguese cities
  //   ['Brussels', 'Madrid'] → Brussels to Madrid only
  routes: [
    ['BE',       'ES'      ],  // Belgium      → Spain
    ['BE',       'PT'      ],  // Belgium      → Portugal
    ['ES',       'BE'      ],  // Spain        → Belgium
    ['PT',       'BE'      ],  // Portugal     → Belgium
    ['FR_SOUTH', 'ES'      ],  // South France → Spain
    ['FR_SOUTH', 'PT'      ],  // South France → Portugal
    ['ES',       'FR_SOUTH'],  // Spain        → South France
    ['PT',       'FR_SOUTH'],  // Portugal     → South France
    ['ES',       'PT'      ],  // Spain        → Portugal
    ['PT',       'ES'      ],  // Portugal     → Spain
    ['ES',       'ES'      ],  // Spain        → Spain
    ['PT',       'PT'      ],  // Portugal     → Portugal
  ],

  // Technical settings:
  settings: {
    maxRetries: 3,    // Number of attempts for a failed API call
    delayMs: 2000     // Delay in ms between each check (to avoid rate limits)
  }
};
