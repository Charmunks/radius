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
  source: "yelp";
  rating: number;
  reviewCount: number;
  price?: string;
  imageUrl?: string;
  yelpUrl: string;
  address: string;
}

export const CATEGORIES: Category[] = ["food", "tourism", "photo"];
