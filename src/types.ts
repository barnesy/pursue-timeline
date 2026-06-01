import type { DatasetId } from "./datasets";

export type Case = {
  // Which corpus this record belongs to. Drives color, filter chips, and
  // whether the record renders on the map view.
  dataset: DatasetId;
  // Optional lat/lng populated for datasets that have point geometry directly
  // (Phase 2 nuclear data has these in the source CSV). Falsy means "use the
  // string-based geocoder in locations.ts".
  lat?: number;
  lng?: number;
  // Nuclear yield in kilotons of TNT equivalent. Populated for nuclear-test
  // and nuclear-incident records when known. yieldKt is the central/lower
  // estimate; yieldKtUpper is the upper bound if the yield is a range.
  yieldKt?: number;
  yieldKtUpper?: number;
  // Burst altitude in meters relative to ground, signed.
  //   positive = above ground (airdrop, balloon, tower height)
  //   zero     = surface
  //   negative = underground (shaft / tunnel depth)
  // Populated for nuclear-test records when known. Nuclear incidents leave
  // this undefined since "altitude" for a reactor meltdown isn't meaningful.
  altitudeM?: number;
  // Existing fields below — UAP cases.json shape, still authoritative for now.
  id: string;
  title: string;
  agency: string;
  incidentDate: string | null;
  incidentDateRaw: string;
  incidentLocation: string;
  releaseDate: string;
  // Primary type for the MEDIA filter chip row — one of PDF / VID / IMG / AUD.
  // For non-UAP datasets we collapse to "PDF" since the source-of-record is
  // always a Wikipedia article or government doc.
  type: string;
  // Original detailed type from the source dataset (e.g. "UNDERGROUND SHAFT"
  // for a nuclear test, "BROKEN ARROW" for an incident). Surfaced in the
  // detail panel but NOT in the MEDIA filter row to keep that row clean.
  subtype?: string;
  redacted: boolean;
  description: string;
  sourceUrl: string;
  videoTitle: string;
  dvidsVideoId: string;
  imageUrl: string;
  imageAlt: string;
  /** Key figures extracted from the source document's entity metadata
   * (STARGATE only). Populated at load time from stargate-people.json. */
  people?: string[];
  /** Author(s) of a published work (publication dataset), kept structured so
   * initialed names ("J. B. Rhine") resolve cleanly in the entity registry. */
  author?: string;
};
