export type Category = "food" | "coffee" | "nightlife" | "parks" | "museums" | "tourism" | "photo" | "shopping" | "music";

export interface Place {
  id: string;
  name: string;
  category: Category;
  lat: number;
  lng: number;
  neighborhood: string;
  blurb: string;
  minutes: number;
  source: "foursquare";
  website?: string;
  imageUrl?: string; // from the place's own website
  foursquareUrl: string;
  address: string;
}

// In the order the interest chips appear.
export const CATEGORY_LABELS: Record<Category, string> = {
  food: "Food",
  coffee: "Coffee",
  nightlife: "Bars & nightlife",
  parks: "Parks",
  museums: "Museums",
  tourism: "Landmarks",
  photo: "Photo ops",
  shopping: "Shopping",
  music: "Live music",
};

export const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[];

export const isCategory = (c: unknown): c is Category => CATEGORIES.includes(c as Category);
