export type Category = "food" | "tourism" | "photo";

export interface Place {
  id: string;
  name: string;
  category: Category;
  lat: number;
  lng: number;
  neighborhood: string;
  blurb: string;
  tip?: string;
  minutes: number;
  // Yelp-only fields; curated places leave these unset.
  source?: "yelp" | "curated";
  rating?: number;
  reviewCount?: number;
  price?: string;
  imageUrl?: string;
  yelpUrl?: string;
  address?: string;
}

export const CATEGORIES: Category[] = ["food", "tourism", "photo"];

export const places: Place[] = [
  // food
  { id: "ben-chili", name: "Ben's Chili Bowl", category: "food", lat: 38.9170, lng: -77.0289, neighborhood: "U Street", blurb: "DC institution since 1958, famous for half-smokes.", tip: "Get the chili half-smoke with cheese fries.", minutes: 45 },
  { id: "union-market", name: "Union Market", category: "food", lat: 38.9087, lng: -76.9987, neighborhood: "NoMa / Union Market", blurb: "Indoor food hall packed with local vendors.", tip: "Grab a bite from a few stalls and share.", minutes: 60 },
  { id: "eastern-market", name: "Eastern Market", category: "food", lat: 38.8849, lng: -76.9960, neighborhood: "Capitol Hill", blurb: "Historic market hall with produce, bakeries and weekend stalls.", tip: "Try the blueberry buckwheat pancakes at Market Lunch.", minutes: 60 },
  { id: "georgetown-cupcake", name: "Georgetown Cupcake", category: "food", lat: 38.9055, lng: -77.0627, neighborhood: "Georgetown", blurb: "Famously photogenic cupcakes on M Street.", tip: "Pick the red velvet and stroll the canal.", minutes: 20 },
  { id: "wharf", name: "The Wharf", category: "food", lat: 38.8783, lng: -77.0225, neighborhood: "Southwest Waterfront", blurb: "Waterfront dining and the Maine Avenue Fish Market.", tip: "Buy fresh seafood at the fish market stalls.", minutes: 75 },
  { id: "daikaya", name: "Daikaya Ramen", category: "food", lat: 38.8996, lng: -77.0225, neighborhood: "Chinatown", blurb: "Sapporo-style ramen in Penn Quarter.", tip: "Go for miso ramen on a chilly day.", minutes: 45 },
  { id: "kramerbooks", name: "Kramerbooks & Afterwords Cafe", category: "food", lat: 38.9104, lng: -77.0434, neighborhood: "Dupont Circle", blurb: "A bookstore with a cafe and late-night dessert.", tip: "Browse the shelves before ordering brunch.", minutes: 60 },
  { id: "compass-coffee", name: "Compass Coffee (Shaw)", category: "food", lat: 38.9123, lng: -77.0220, neighborhood: "Shaw", blurb: "DC-born roaster with a laid-back neighborhood vibe.", tip: "Order a cortado and people-watch.", minutes: 25 },
  // tourism
  { id: "lincoln", name: "Lincoln Memorial", category: "tourism", lat: 38.8893, lng: -77.0502, neighborhood: "National Mall", blurb: "Iconic memorial at the west end of the Mall.", tip: "Visit at dusk when it is lit up and quieter.", minutes: 40 },
  { id: "washington-monument", name: "Washington Monument", category: "tourism", lat: 38.8895, lng: -77.0353, neighborhood: "National Mall", blurb: "555-foot obelisk with views across the city.", tip: "Reserve elevator tickets ahead of time.", minutes: 45 },
  { id: "air-space", name: "National Air and Space Museum", category: "tourism", lat: 38.8882, lng: -77.0199, neighborhood: "National Mall", blurb: "The Wright Flyer, Apollo 11 capsule and more. Free entry.", tip: "Book a free timed pass online.", minutes: 120 },
  { id: "capitol", name: "U.S. Capitol", category: "tourism", lat: 38.8899, lng: -77.0091, neighborhood: "Capitol Hill", blurb: "Home of Congress with free guided tours.", tip: "Book a tour through the Visitor Center.", minutes: 90 },
  { id: "natural-history", name: "Smithsonian Natural History Museum", category: "tourism", lat: 38.8913, lng: -77.0261, neighborhood: "National Mall", blurb: "Hope Diamond, dinosaurs and a giant elephant.", tip: "Head to the Hall of Gems first.", minutes: 120 },
  { id: "national-archives", name: "National Archives", category: "tourism", lat: 38.8928, lng: -77.0230, neighborhood: "Penn Quarter", blurb: "See the Declaration of Independence and Constitution.", tip: "Go early to skip the line.", minutes: 60 },
  { id: "national-zoo", name: "Smithsonian National Zoo", category: "tourism", lat: 38.9296, lng: -77.0498, neighborhood: "Woodley Park", blurb: "Free zoo with giant pandas and a hilly walk.", tip: "Start at the top and walk down.", minutes: 150 },
  { id: "arlington", name: "Arlington National Cemetery", category: "tourism", lat: 38.8783, lng: -77.0685, neighborhood: "Arlington (across the river)", blurb: "Changing of the Guard at the Tomb of the Unknown Soldier.", tip: "Take the Metro to Arlington Cemetery station.", minutes: 120 },
  // photo ops
  { id: "tidal-basin", name: "Tidal Basin & Jefferson Memorial", category: "photo", lat: 38.8814, lng: -77.0365, neighborhood: "Tidal Basin", blurb: "Cherry blossoms and a classic reflection shot.", tip: "Shoot the memorial from the northwest shore at sunrise.", minutes: 45 },
  { id: "reflecting-pool", name: "Lincoln Reflecting Pool", category: "photo", lat: 38.8893, lng: -77.0420, neighborhood: "National Mall", blurb: "Long mirror pool framing the Washington Monument.", tip: "Calm mornings give the best reflections.", minutes: 30 },
  { id: "georgetown-canal", name: "C&O Canal at Georgetown", category: "photo", lat: 38.9050, lng: -77.0600, neighborhood: "Georgetown", blurb: "Historic canal and colorful rowhouses.", tip: "Look for the bridge arches over the towpath.", minutes: 30 },
  { id: "kennedy-center", name: "Kennedy Center Terrace", category: "photo", lat: 38.8960, lng: -77.0555, neighborhood: "Foggy Bottom", blurb: "Terrace view of the Potomac and Roosevelt Island.", tip: "Go at golden hour for river light.", minutes: 25 },
  { id: "line-hotel-mural", name: "Adams Morgan Murals", category: "photo", lat: 38.9215, lng: -77.0425, neighborhood: "Adams Morgan", blurb: "Street art and bright building murals along 18th St.", tip: "Walk the side alleys for hidden pieces.", minutes: 40 },
  { id: "library-congress", name: "Library of Congress Main Reading Room View", category: "photo", lat: 38.8887, lng: -77.0047, neighborhood: "Capitol Hill", blurb: "Ornate Thomas Jefferson Building interiors.", tip: "Look down from the viewing gallery for the symmetry shot.", minutes: 45 },
  { id: "dumbarton-oaks", name: "Dumbarton Oaks Gardens", category: "photo", lat: 38.9136, lng: -77.0555, neighborhood: "Georgetown", blurb: "Terraced gardens with fountains and pergolas.", tip: "Spring blooms are the highlight.", minutes: 60 },
  { id: "old-post-office", name: "Old Post Office Tower View", category: "photo", lat: 38.8946, lng: -77.0282, neighborhood: "Federal Triangle", blurb: "Free clock tower views over the Mall.", tip: "Take the elevator to the observation deck.", minutes: 30 },
  { id: "rose-garden", name: "Meridian Hill Park", category: "photo", lat: 38.9205, lng: -77.0348, neighborhood: "Columbia Heights", blurb: "Cascading fountain and formal terraces.", tip: "Catch the sunset over the lower terrace.", minutes: 30 },
];
