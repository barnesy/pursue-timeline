// Nuclear blast effect scaling. Uses simplified Glasstone-Dolan ("The Effects
// of Nuclear Weapons", 1977) scaling laws, the same formulas Alex Wellerstein's
// NUKEMAP uses for surface-burst / optimal-HOB approximations.
//
// All radii returned in METERS. Yield input in KILOTONS TNT equivalent.
//
// For a given yield W (kt), the cube-root scaling law says:
//   R(damage X)  ≈  C_X · W^(1/3)
// where C_X is an empirically-fit constant per damage threshold.
//
// These are first-order approximations. Real-world effects depend on burst
// height, terrain, atmospheric conditions, weapon design. They're suitable
// for the "feel the scale" visualization we want — NOT for actual targeting.

export type BlastEffects = {
  yieldKt: number;
  // Optimal height of burst (HOB) for maximizing the 5-psi blast radius.
  optimalHobM: number;
  // Concentric damage zones, ordered inner to outer.
  fireballM: number;       // everything vaporized
  severeBlastM: number;    // 20 psi — reinforced concrete destroyed
  moderateBlastM: number;  // 5 psi — most residential buildings collapse
  lightBlastM: number;     // 1 psi — windows shatter, light damage
  thermalBurnM: number;    // 3rd-degree burns to exposed skin
  ionizingRadM: number;    // 500 rem ionizing radiation (lethal dose)
};

// Constants in km, applied with W in kt and result × 1000 to get meters.
// Sourced from Glasstone & Dolan tables 5.140 and 12.65, then sanity-checked
// against NUKEMAP outputs for known yields (Hiroshima 15kt, Trinity 21kt,
// Bravo 15Mt).
const C = {
  // Fireball radius scales with W^0.4 (Glasstone Eq 2.124)
  fireballC: 0.07,
  fireballExp: 0.4,
  // Air blast radii scale with cube-root of yield
  severe20psi: 0.06,   // km / kt^(1/3)
  moderate5psi: 0.18,  // km / kt^(1/3) — this is the "iconic" radius
  light1psi: 0.45,     // km / kt^(1/3)
  // Thermal radiation scales with sqrt(W) since intensity falls off as 1/R^2
  thermal3rd: 0.40,    // km / kt^0.5 — 3rd degree burns
  // Ionizing radiation falls off faster (with air absorption); approx W^0.19
  ionizing500rem: 0.13,
  ionizingExp: 0.19,
  // Optimal HOB for 5-psi maximum (Glasstone fig 3.73)
  optimalHob5: 0.110,  // km / kt^(1/3)
};

export function computeBlastEffects(yieldKt: number): BlastEffects {
  const W = Math.max(0.001, yieldKt);
  const cbrt = Math.cbrt(W);
  return {
    yieldKt,
    optimalHobM: 1000 * C.optimalHob5 * cbrt,
    fireballM: 1000 * C.fireballC * Math.pow(W, C.fireballExp),
    severeBlastM: 1000 * C.severe20psi * cbrt,
    moderateBlastM: 1000 * C.moderate5psi * cbrt,
    lightBlastM: 1000 * C.light1psi * cbrt,
    thermalBurnM: 1000 * C.thermal3rd * Math.sqrt(W),
    ionizingRadM: 1000 * C.ionizing500rem * Math.pow(W, C.ionizingExp),
  };
}

// Categorize a test's deployment method into one of our diagram environments.
// The subtype string comes from the original SIPRI `type` field (now stored on
// Case.subtype). Examples: "UNDERGROUND SHAFT", "AIRDROP", "BARGE", etc.
export type DetonationEnv =
  | "atmospheric"     // airdrop, balloon, tower, atmospheric — air burst
  | "surface"         // surface (ground burst)
  | "underground"     // shaft, tunnel — contained underground
  | "underwater"      // underwater test
  | "barge"           // on water surface (still air burst-ish but over water)
  | "rocket"          // exoatmospheric / very high altitude
  | "incident";       // a documented accident — not a test
export function detonationEnv(subtype: string | undefined, type?: string): DetonationEnv {
  const s = (subtype || type || "").toUpperCase();
  if (s.includes("BROKEN ARROW") || s.includes("MILITARY ACCIDENT") || s.includes("CIVILIAN ACCIDENT") || s.includes("REACTOR ACCIDENT")) return "incident";
  if (s.includes("ROCKET") || s.includes("SPACE")) return "rocket";
  if (s.includes("UNDERWATER") || s === "UW") return "underwater";
  if (s.includes("BARGE")) return "barge";
  if (s.includes("SHAFT") || s.includes("TUNNEL") || s === "UG" || s.includes("UNDERGROUND")) return "underground";
  if (s.includes("SURFACE") || s.includes("CRATER")) return "surface";
  if (s.includes("AIRDROP") || s.includes("BALLOON") || s.includes("TOWER") || s.includes("ATMOSPH")) return "atmospheric";
  return "atmospheric"; // safe default
}

// Famous-yield comparisons help the abstract kilotons land emotionally.
export function compareYield(yieldKt: number): { label: string; ratio: number } | null {
  if (yieldKt <= 0) return null;
  const refs: Array<{ name: string; kt: number }> = [
    { name: "Hiroshima (Little Boy)", kt: 15 },
    { name: "Nagasaki (Fat Man)", kt: 21 },
    { name: "Castle Bravo (US)", kt: 15000 },
    { name: "Tsar Bomba (USSR)", kt: 50000 },
  ];
  // Find the closest reference (geometric mean distance)
  let best = refs[0];
  let bestDist = Infinity;
  for (const r of refs) {
    const d = Math.abs(Math.log(yieldKt / r.kt));
    if (d < bestDist) { best = r; bestDist = d; }
  }
  const ratio = yieldKt / best.kt;
  return { label: best.name, ratio };
}

// ---------------------------------------------------------------------------
// Blast-wave TIMING — for a physically honest, real-time animation.
//
// The shock front does not expand at a constant rate. In the near field it is
// a strong shock governed by the Sedov-Taylor point-blast solution:
//     R(t) = ξ · (E·t² / ρ)^(1/5)   ⇒   t(R) = √( ρ·R⁵ / (ξ⁵·E) )
// i.e. the front DECELERATES sharply (t ∝ R^2.5). Once the shock velocity
// decays to the local sound speed it transitions to an ordinary acoustic
// wave traveling at ~340 m/s, so beyond a crossover radius R* the arrival
// time becomes linear: t(R) = t(R*) + (R − R*)/c.
//
// Inputs: yield in kt; radii in meters; times in seconds. Only a fraction of
// the yield (~50%) couples into the blast wave — the rest is thermal/nuclear.
// These are first-order; good enough to make "the shock takes ~25 s to cross
// a city after a megaton burst" land truthfully.
const KT_TO_J = 4.184e12;        // joules per kiloton TNT
const BLAST_FRACTION = 0.5;       // share of yield going to air blast
const RHO_AIR = 1.225;            // kg/m³ at sea level
const SEDOV_XI = 1.033;           // Sedov constant for γ = 1.4
const SOUND_C = 340;              // m/s

function sedovConsts(yieldKt: number) {
  const E = Math.max(0.001, yieldKt) * KT_TO_J * BLAST_FRACTION;
  // t = K · R^2.5
  const K = Math.sqrt(RHO_AIR / (Math.pow(SEDOV_XI, 5) * E));
  // Crossover radius where the Sedov front velocity falls to the sound speed.
  // v_sedov(R) = 1/(2.5·K·R^1.5); set = c ⇒ R* = (1/(2.5·K·c))^(2/3).
  const Rstar = Math.pow(1 / (2.5 * K * SOUND_C), 2 / 3);
  const tStar = K * Math.pow(Rstar, 2.5);
  return { K, Rstar, tStar };
}

// Time (s) for the shock front to reach a given ground radius (m).
export function shockArrivalTime(radiusM: number, yieldKt: number): number {
  if (radiusM <= 0) return 0;
  const { K, Rstar, tStar } = sedovConsts(yieldKt);
  if (radiusM <= Rstar) return K * Math.pow(radiusM, 2.5);
  return tStar + (radiusM - Rstar) / SOUND_C;
}

// Inverse: radius (m) of the shock front at time t (s). Consistent with
// shockArrivalTime so a ring "locks in" exactly as the front crosses it.
export function shockFrontRadius(t: number, yieldKt: number): number {
  if (t <= 0) return 0;
  const { K, Rstar, tStar } = sedovConsts(yieldKt);
  if (t <= tStar) return Math.pow(t / K, 1 / 2.5);
  return Rstar + (t - tStar) * SOUND_C;
}

// Thermal radiation is delivered at the speed of light, so geographically the
// burn radius is reached instantly — but the energy is deposited over the
// thermal pulse, which lengthens with yield (Glasstone, time-to-2nd-maximum
// scaling ≈ W^0.44). We use the full pulse so the thermal ring ramps in over
// roughly the real pulse duration.
export function thermalPulseDuration(yieldKt: number): number {
  return Math.max(0.3, 0.5 * Math.pow(Math.max(0.001, yieldKt), 0.44));
}

// Rough time (s) for the fireball to reach its maximum radius before it
// detaches and rises. Scales weakly with yield; clamped to a watchable range.
export function fireballGrowTime(yieldKt: number): number {
  return Math.min(5, Math.max(0.2, 0.15 * Math.pow(Math.max(0.001, yieldKt), 0.4)));
}

export type UnitSystem = "metric" | "imperial";

// Convert meters to a humanized distance string with sensible precision.
// When units = "imperial", converts to feet/miles instead of m/km.
//   1 m  = 3.28084 ft
//   1 km = 0.621371 mi
export function fmtDistance(m: number, units: UnitSystem = "metric"): string {
  if (units === "imperial") {
    const ft = m * 3.28084;
    if (ft < 10) return `${ft.toFixed(1)} ft`;
    if (ft < 1000) return `${Math.round(ft)} ft`;
    const mi = m * 0.000621371;
    if (mi < 10) return `${mi.toFixed(2)} mi`;
    if (mi < 100) return `${mi.toFixed(1)} mi`;
    return `${Math.round(mi)} mi`;
  }
  if (m < 1) return `${Math.round(m * 100) / 100} m`;
  if (m < 100) return `${Math.round(m)} m`;
  if (m < 10_000) return `${(m / 1000).toFixed(m < 1000 ? 2 : 1)} km`;
  return `${Math.round(m / 1000)} km`;
}

// Familiar-size comparisons for a given radius. Hand-picked landmarks that
// span 4 orders of magnitude from a city block to a small country.
export function familiarSize(m: number): string | null {
  if (m < 50) return null;
  const refs: Array<{ name: string; m: number }> = [
    { name: "city block (NYC)", m: 80 },
    { name: "an aircraft carrier deck", m: 333 },
    { name: "the width of Central Park", m: 800 },
    { name: "Manhattan Island (width)", m: 3700 },
    { name: "Manhattan Island (length)", m: 21000 },
    { name: "Washington, DC (diameter)", m: 16000 },
    { name: "the San Francisco Peninsula", m: 50000 },
    { name: "Greater Los Angeles", m: 130000 },
    { name: "the length of New Jersey", m: 270000 },
    { name: "the length of California (north–south)", m: 1200000 },
  ];
  // Find closest by log-ratio
  let best = refs[0];
  let bestRatio = Infinity;
  for (const r of refs) {
    const ratio = Math.abs(Math.log(m / r.m));
    if (ratio < bestRatio) { best = r; bestRatio = ratio; }
  }
  const factor = m / best.m;
  if (factor >= 0.7 && factor <= 1.4) return `≈ ${best.name}`;
  if (factor > 1.4) return `≈ ${factor.toFixed(1)}× ${best.name}`;
  return `≈ ${(1 / factor).toFixed(1)}× smaller than ${best.name}`;
}
