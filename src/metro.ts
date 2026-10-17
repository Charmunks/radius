export interface Line {
  name: string;
  color: string;
  // Ordered along the track; ends[0] is the terminus on the low-index side.
  ends: [string, string];
  stations: string[];
}

export const lines: Line[] = [
  {
    name: "Red", color: "#bf0d3e", ends: ["Shady Grove", "Glenmont"],
    stations: ["Shady Grove", "Rockville", "Twinbrook", "White Flint", "Grosvenor-Strathmore", "Medical Center", "Bethesda", "Friendship Heights", "Tenleytown-AU", "Van Ness-UDC", "Cleveland Park", "Woodley Park-Zoo", "Dupont Circle", "Farragut North", "Metro Center", "Gallery Place-Chinatown", "Judiciary Square", "Union Station", "NoMa-Gallaudet U", "Rhode Island Ave-Brentwood", "Brookland-CUA", "Fort Totten", "Takoma", "Silver Spring", "Forest Glen", "Wheaton", "Glenmont"],
  },
  {
    name: "Orange", color: "#ed8b00", ends: ["Vienna", "New Carrollton"],
    stations: ["Vienna", "Dunn Loring", "West Falls Church", "East Falls Church", "Ballston-MU", "Virginia Square-GMU", "Clarendon", "Court House", "Rosslyn", "Foggy Bottom-GWU", "Farragut West", "McPherson Square", "Metro Center", "Federal Triangle", "Smithsonian", "L'Enfant Plaza", "Federal Center SW", "Capitol South", "Eastern Market", "Potomac Avenue", "Stadium-Armory", "Minnesota Avenue", "Deanwood", "Cheverly", "Landover", "New Carrollton"],
  },
  {
    name: "Blue", color: "#009cde", ends: ["Franconia-Springfield", "Largo Town Center"],
    stations: ["Franconia-Springfield", "Van Dorn Street", "King St-Old Town", "Braddock Road", "Reagan National Airport", "Crystal City", "Pentagon City", "Pentagon", "Arlington Cemetery", "Rosslyn", "Foggy Bottom-GWU", "Farragut West", "McPherson Square", "Metro Center", "Federal Triangle", "Smithsonian", "L'Enfant Plaza", "Federal Center SW", "Capitol South", "Eastern Market", "Potomac Avenue", "Stadium-Armory", "Benning Road", "Capitol Heights", "Addison Road", "Morgan Boulevard", "Largo Town Center"],
  },
  {
    name: "Green", color: "#00b140", ends: ["Branch Avenue", "Greenbelt"],
    stations: ["Branch Avenue", "Suitland", "Naylor Road", "Southern Avenue", "Congress Heights", "Anacostia", "Navy Yard-Ballpark", "Waterfront", "L'Enfant Plaza", "Archives-Navy Memorial", "Gallery Place-Chinatown", "Mt Vernon Sq", "Shaw-Howard U", "U Street", "Columbia Heights", "Georgia Ave-Petworth", "Fort Totten", "West Hyattsville", "Prince George's Plaza", "College Park-U of Md", "Greenbelt"],
  },
];

// Stations a rider can start or end at, with coordinates.
export const stations: Record<string, [number, number]> = {
  "Rosslyn": [38.8960, -77.0731],
  "Arlington Cemetery": [38.8843, -77.0630],
  "Foggy Bottom-GWU": [38.9005, -77.0502],
  "Farragut West": [38.9014, -77.0412],
  "McPherson Square": [38.9019, -77.0337],
  "Metro Center": [38.8983, -77.0280],
  "Federal Triangle": [38.8935, -77.0282],
  "Smithsonian": [38.8878, -77.0282],
  "L'Enfant Plaza": [38.8849, -77.0282],
  "Capitol South": [38.8850, -77.0050],
  "Eastern Market": [38.8841, -76.9958],
  "Dupont Circle": [38.9096, -77.0434],
  "Farragut North": [38.9033, -77.0397],
  "Gallery Place-Chinatown": [38.8984, -77.0219],
  "Archives-Navy Memorial": [38.8934, -77.0219],
  "Union Station": [38.8974, -77.0070],
  "NoMa-Gallaudet U": [38.9070, -77.0036],
  "Woodley Park-Zoo": [38.9249, -77.0524],
  "Mt Vernon Sq": [38.9057, -77.0220],
  "Shaw-Howard U": [38.9129, -77.0220],
  "U Street": [38.9170, -77.0287],
  "Columbia Heights": [38.9285, -77.0326],
  "Waterfront": [38.8763, -77.0172],
  "Navy Yard-Ballpark": [38.8765, -77.0050],
  "Fort Totten": [38.9519, -77.0022],
};

export const tips = [
  "Stand on the right side of escalators and walk on the left.",
  "Let people get off the train before you get on.",
  "Check the sign above the platform to confirm it's your train.",
  "Hold on to your card until you've tapped out of the station.",
  "Trains run less often at night and on weekends, so check the platform board for the next one.",
  "If you're lost, ask a station manager. They wear a vest and stand near the faregates.",
];
