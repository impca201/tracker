// Configuration for Tracker
//
// City selection:
// Cities are grouped by region. All cities in a region are always active.
// Control which routes are searched via the `routes` array below.

module.exports = {
  regions: {

    // --- AT (Austria) ---
    AT: [
      61,  // Graz
      66,  // Innsbruck-Wiesing
      72,  // Linz
      70,  // Salzburg
      23,  // Vienna
      62,  // Vienna South
    ],

    // --- BE (Belgium) ---
    BE: [
      67,  // Antwerp
      63,  // Brussels
    ],

    // --- CA (Canada) ---
    CA: [
      101, // Calgary
      100, // Vancouver
    ],

    // --- CH (Switzerland) ---
    CH: [
      77,  // Bern
      81,  // Lucerne
      75,  // Zurich (Wetzikon)
    ],

    // --- DE-NORTH (Germany North) ---
    DE_NORTH: [
      92,  // Braunschweig
      41,  // Bremen
      105, // Flensburg
      3,   // Hamburg
      43,  // Hamburg airport
      7,   // Hanover
      54,  // Kiel
      52,  // Lübeck
    ],

    // --- DE-EAST (Germany East) ---
    DE_EAST: [
      6,   // Berlin
      27,  // Chemnitz
      42,  // Dresden
      46,  // Erfurt
      8,   // Leipzig
    ],

    // --- DE-WEST (Germany West) ---
    DE_WEST: [
      80,  // Aachen
      33,  // Berlin-Schönefeld
      48,  // Bielefeld
      26,  // Bochum
      79,  // Duisburg
      2,   // Frankfurt
      49,  // Kassel
      34,  // Cologne-Bonn
      4,   // Cologne-Düsseldorf
      37,  // Mainz
      25,  // Marburg
      93,  // Mönchengladbach
      28,  // Münster-Senden
      32,  // Trier
    ],

    // --- DE-SOUTH (Germany South) ---
    DE_SOUTH: [
      51,  // Augsburg
      10,  // Freiburg-Basel (Germany)
      11,  // Konstanz (Aach)
      90,  // Lindau-Wangen
      31,  // Murnau
      1,   // Munich
      // Nuremberg removed: its old ID (18) has been reassigned by the site
      // to Lisbon (see PT region below) — the site must have retired the
      // old Nuremberg station and reused its numeric ID. Re-add Nuremberg
      // here once its current, correct station ID is confirmed.
      45,  // Regensburg
      5,   // Stuttgart
      35,  // Stuttgart-Esslingen
      78,  // Ulm
      82,  // Würzburg
    ],

    // --- DE (Germany Other) ---
    DE_OTHER: [
      106, // Darmstadt
      44,  // Heidelberg
      53,  // Karlsruhe
      50,  // LMC Caravan
    ],

    // --- ES (Spain) ---
    ES: [
      17,  // Barcelona
      40,  // Bilbao
      20,  // Madrid
      21,  // Malaga
      39,  // Seville
      38,  // Valencia
    ],

    // --- FR-NORTH (France North) ---
    FR_NORTH: [
      29,  // Geneva-Pays de Gex (France)
      89,  // Lille
      14,  // Nantes
      12,  // Paris South (Orly)
      36,  // Paris airport CDG
      47,  // Strasbourg
    ],

    // --- FR-SOUTH (France South) ---
    FR_SOUTH: [
      16,  // Aix-Marseille
      13,  // Bordeaux
      15,  // Lyon
      88,  // Nice
      30,  // Toulouse
    ],

    // --- GB (United Kingdom) ---
    GB: [
      91,  // Bristol
      58,  // Edinburgh
      57,  // London
      94,  // Manchester
    ],

    // --- HR (Croatia) ---
    HR: [
      97,  // Split
    ],

    // --- IE (Ireland) ---
    IE: [
      98,  // Dublin
    ],

    // --- IT-NORTH (Italy North) ---
    IT_NORTH: [
      69,  // Bergamo
      55,  // Milan
      71,  // Milan South
      60,  // Turin
      68,  // Venice
    ],

    // --- IT-SOUTH (Italy South) ---
    IT_SOUTH: [
      64,  // Bologna
      59,  // Florence
      56,  // Rome airport Fiumicino
    ],

    // --- NL (Netherlands) ---
    NL: [
      22,  // Amsterdam
      65,  // Rotterdam
    ],

    // --- NO (Norway) ---
    NO: [
      102, // Bergen
      103, // Oslo
    ],

    // --- PT (Portugal) ---
    PT: [
      83,  // Faro
      18,  // Lisbon (was ID 19 — corrected, see stations.json)
      84,  // Porto
    ],

    // --- SE (Sweden) ---
    SE: [
      76,  // Gothenburg
      74,  // Malmo
      73,  // Stockholm
    ],

    // --- US (United States) ---
    US: [
      112, // Dallas
      107, // Denver
      96,  // Elkhart
      87,  // Las Vegas
      85,  // Los Angeles
      111, // Miami
      113, // New York
      108, // Phoenix
      104, // Pt Roberts (near Vancouver)
      109, // Salt Lake City
      86,  // San Francisco
      110, // Seattle
      95,  // Thor Industries
      99,  // Winnebago Industries
    ],

  },

  // Routes to search: each entry is [from, to].
  // Each side can be either:
  //   - a region key (string) → all active cities in that region, e.g. 'ES'
  //   - a city ID   (number)  → a single specific city,           e.g. 17
  // Same region on both sides = within-region routes (e.g. Spain → Spain).
  // Examples:
  //   ['BE', 'ES']   → all Belgian cities to all Spanish cities
  //   ['BE', 17]     → all Belgian cities to Barcelona only
  //   [67, 'PT']     → Antwerp only to all Portuguese cities
  //   [63, 20]       → Brussels to Madrid only
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

  // Flight search settings (Kiwi Tequila API)
  // Leave origins empty [] to disable flight search entirely.
  flights: {
    // IATA codes of your departure airports (city codes cover all airports in that city)
    // Examples: 'BRU' = Brussels-Zaventem, 'CRL' = Charleroi
    origins: ['BRU', 'CRL'],

    // Search window for the outbound flight (relative to camper pickup date)
    departureWindow: {
      daysBefore: 1,        // Also search the day before pickup
      latestArrivalHour: 16 // Only flights arriving by 16:00 on pickup day
    },

    // Search window for the return flight (relative to camper drop-off date)
    returnWindow: {
      daysAfter: 1,             // Also search the day after drop-off
      earliestDepartureHour: 12 // Only flights departing from 12:00 on drop-off day
    }
  },

  // Technical settings:
  settings: {
    maxRetries: 3,    // Number of attempts for a failed API call
    delayMs: 2000     // Delay in ms between each check (to avoid rate limits)
  }
};
