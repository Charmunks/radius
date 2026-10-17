export type Category = "food" | "tourism" | "photo";

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

export const CATEGORIES: Category[] = ["food", "tourism", "photo"];
