// Hand-curated lookup for the unique location strings in cases.json.
// Lat/lng values are approximate centroids — these are public-domain government
// reports where exact coordinates are rarely given. AOR strings (CENTCOM, etc.)
// are placed roughly at the center of that command's area of responsibility.
//
// `offWorld: true` cases (Moon, LEO, Cislunar Space) are not plotted on the
// globe; they're counted in a sidebar badge instead.

export type GeoEntry = {
  lat: number;
  lng: number;
  display: string;
  offWorld?: boolean;
};

export const LOCATIONS: Record<string, GeoEntry> = {
  // US Combatant Commands — placed at centroid of AOR
  CENTCOM: { lat: 29.0, lng: 47.0, display: "CENTCOM (Middle East AOR)" },
  NORTHCOM: { lat: 39.0, lng: -100.0, display: "NORTHCOM (N. America AOR)" },
  AFRICOM: { lat: 5.0, lng: 22.0, display: "AFRICOM (Africa AOR)" },
  EUCOM: { lat: 50.0, lng: 15.0, display: "EUCOM (Europe AOR)" },
  "Indo-PACOM": { lat: 0.0, lng: 130.0, display: "INDOPACOM (Indo-Pacific AOR)" },
  INDOPACOM: { lat: 0.0, lng: 130.0, display: "INDOPACOM (Indo-Pacific AOR)" },

  // US regions
  "Western United States": { lat: 37.0, lng: -115.0, display: "Western US" },
  "United States": { lat: 38.0, lng: -97.0, display: "United States" },
  "Southeastern United States": { lat: 33.0, lng: -85.0, display: "Southeastern US" },
  "Southern United States": { lat: 32.0, lng: -90.0, display: "Southern US" },
  "Midwestern United States": { lat: 40.0, lng: -90.0, display: "Midwestern US" },
  "North America": { lat: 48.0, lng: -100.0, display: "North America" },
  "Pacific Time Zone": { lat: 37.0, lng: -120.0, display: "US Pacific Time Zone" },

  // US states / cities
  "New Mexico": { lat: 34.5, lng: -106.0, display: "New Mexico" },
  Texas: { lat: 31.0, lng: -100.0, display: "Texas" },
  "Detroit, MI": { lat: 42.33, lng: -83.05, display: "Detroit, MI" },
  Georgia: { lat: 32.8, lng: -83.5, display: "Georgia (US)" },

  // Middle East
  "Arabian Gulf": { lat: 26.5, lng: 51.5, display: "Arabian (Persian) Gulf" },
  "Arabian Sea": { lat: 15.0, lng: 65.0, display: "Arabian Sea" },
  "Gulf of Oman": { lat: 24.5, lng: 58.0, display: "Gulf of Oman" },
  "Gulf of Aden": { lat: 12.0, lng: 48.0, display: "Gulf of Aden" },
  "Strait of Hormuz": { lat: 26.5, lng: 56.25, display: "Strait of Hormuz" },
  "Middle East": { lat: 30.0, lng: 45.0, display: "Middle East" },
  Syria: { lat: 35.0, lng: 38.0, display: "Syria" },
  Iraq: { lat: 33.0, lng: 44.0, display: "Iraq" },
  Iran: { lat: 32.0, lng: 53.0, display: "Iran" },
  "United Arab Emirates": { lat: 23.5, lng: 54.0, display: "United Arab Emirates" },
  Djibouti: { lat: 11.5, lng: 43.0, display: "Djibouti" },

  // Europe
  Germany: { lat: 51.0, lng: 10.0, display: "Germany" },
  Greece: { lat: 39.0, lng: 22.0, display: "Greece" },
  Netherlands: { lat: 52.0, lng: 5.0, display: "Netherlands" },
  "Mediterranean Sea": { lat: 35.0, lng: 18.0, display: "Mediterranean Sea" },
  "Aegean Sea": { lat: 39.0, lng: 25.0, display: "Aegean Sea" },

  // Asia / former USSR
  USSR: { lat: 60.0, lng: 80.0, display: "USSR" },
  Kazakhstan: { lat: 48.0, lng: 68.0, display: "Kazakhstan" },
  Azerbaijan: { lat: 40.0, lng: 47.5, display: "Azerbaijan" },
  Turkmenistan: { lat: 39.0, lng: 59.0, display: "Turkmenistan" },
  Japan: { lat: 36.0, lng: 138.0, display: "Japan" },
  "East China Sea": { lat: 30.0, lng: 125.0, display: "East China Sea" },
  "Yellow Sea": { lat: 36.0, lng: 123.5, display: "Yellow Sea" },

  // Oceans
  "Pacific Ocean": { lat: 0.0, lng: -150.0, display: "Pacific Ocean" },
  "North Atlantic Ocean": { lat: 40.0, lng: -40.0, display: "North Atlantic" },

  // Other
  Mexico: { lat: 23.0, lng: -102.0, display: "Mexico" },
  "Papua New Guinea": { lat: -6.0, lng: 145.0, display: "Papua New Guinea" },

  // Off-world — not plotted, counted in badge
  Moon: { lat: 0, lng: 0, display: "Moon", offWorld: true },
  "Low Earth Orbit": { lat: 0, lng: 0, display: "Low Earth Orbit", offWorld: true },
  "Cislunar Space": { lat: 0, lng: 0, display: "Cislunar Space", offWorld: true },
};

export function geocode(loc: string): GeoEntry | null {
  if (!loc) return null;
  const trimmed = loc.trim();
  if (!trimmed || trimmed === "N/A") return null;
  return LOCATIONS[trimmed] ?? null;
}
