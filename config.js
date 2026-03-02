// Configuration for Tracker
//
// City selection:
// Enable (uncomment) the cities you want to check. The script will search for routes between the active cities.

module.exports = {
  cities: [
    // --- AT (Austria) ---
    // 61,  // Graz
    // 66,  // Innsbruck-Wiesing
    // 72,  // Linz
    // 70,  // Salzburg
    // 23,  // Vienna
    // 62,  // Vienna South

    // --- BE (Belgium) ---
    67,  // Antwerp
    63,  // Brussels

    // --- CA (Canada) ---
    // 101, // Calgary
    // 100, // Vancouver

    // --- CH (Switzerland) ---
    // 77,  // Bern
    // 81,  // Lucerne
    // 75,  // Zurich (Wetzikon)

    // --- DE-NORTH (Germany North) ---
    // 92,  // Braunschweig
    // 41,  // Bremen
    // 105, // Flensburg
    // 3,   // Hamburg
    // 43,  // Hamburg airport
    // 7,   // Hanover
    // 54,  // Kiel
    // 52,  // Lübeck

    // --- DE-EAST (Germany East) ---
    // 6,   // Berlin
    // 27,  // Chemnitz
    // 42,  // Dresden
    // 46,  // Erfurt
    // 8,   // Leipzig

    // --- DE-WEST (Germany West) ---
    // 80,  // Aachen
    // 33,  // Berlin-Schönefeld
    // 48,  // Bielefeld
    // 26,  // Bochum
    // 79,  // Duisburg
    // 2,   // Frankfurt
    // 49,  // Kassel
    // 34,  // Cologne-Bonn
    // 4,   // Cologne-Düsseldorf
    // 37,  // Mainz
    // 25,  // Marburg
    // 93,  // Mönchengladbach
    // 28,  // Münster-Senden
    // 32,  // Trier

    // --- DE-SOUTH (Germany South) ---
    // 51,  // Augsburg
    // 10,  // Freiburg-Basel (Germany)
    // 11,  // Konstanz (Aach)
    // 90,  // Lindau-Wangen
    // 31,  // Murnau
    // 1,   // Munich
    // 18,  // Nuremberg
    // 45,  // Regensburg
    // 5,   // Stuttgart
    // 35,  // Stuttgart-Esslingen
    // 78,  // Ulm
    // 82,  // Würzburg

    // --- DE (Germany Other) ---
    // 106, // Darmstadt
    // 44,  // Heidelberg
    // 53,  // Karlsruhe
    // 50,  // LMC Caravan

    // --- ES (Spain) ---
    17,  // Barcelona
    40,  // Bilbao
    20,  // Madrid
    21,  // Malaga
    39,  // Seville
    38,  // Valencia

    // --- FR-NORTH (France North) ---
    // 29,  // Geneva-Pays de Gex (France)
    // 89,  // Lille
    // 14,  // Nantes
    12,  // Paris South (Orly)
    36,  // Paris airport CDG
    // 47,  // Strasbourg

    // --- FR-SOUTH (France South) ---
    16,  // Aix-Marseille
    13,  // Bordeaux
    15,  // Lyon
    88,  // Nice
    30,  // Toulouse

    // --- GB (United Kingdom) ---
    // 91,  // Bristol
    // 58,  // Edinburgh
    // 57,  // London
    // 94,  // Manchester

    // --- HR (Croatia) ---
    // 97,  // Split

    // --- IE (Ireland) ---
    // 98,  // Dublin

    // --- IT-NORTH (Italy North) ---
    // 69,  // Bergamo
    // 55,  // Milan
    // 71,  // Milan South
    // 60,  // Turin
    // 68,  // Venice

    // --- IT-SOUTH (Italy South) ---
    // 64,  // Bologna
    // 59,  // Florence
    // 56,  // Rome airport Fiumicino

    // --- NL (Netherlands) ---
    // 22,  // Amsterdam
    // 65,  // Rotterdam

    // --- NO (Norway) ---
    // 102, // Bergen
    // 103, // Oslo

    // --- PT (Portugal) ---
    83,  // Faro
    19,  // Lisbon
    84,  // Porto

    // --- SE (Sweden) ---
    // 76,  // Gothenburg
    // 74,  // Malmo
    // 73,  // Stockholm

    // --- US (United States) ---
    // 112, // Dallas
    // 107, // Denver
    // 96,  // Elkhart
    // 87,  // Las Vegas
    // 85,  // Los Angeles
    // 111, // Miami
    // 113, // New York
    // 108, // Phoenix
    // 104, // Pt Roberts (near Vancouver)
    // 109, // Salt Lake City
    // 86,  // San Francisco
    // 110, // Seattle
    // 95,  // Thor Industries
    // 99,  // Winnebago Industries
  ],

  // Technical settings:
  settings: {
    maxRetries: 3,    // Number of attempts for a failed API call
    delayMs: 2000     // Delay in ms between each check (to avoid rate limits)
  }
};