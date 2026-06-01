// "Investigations" — named, saved snapshots of a Cases working set, persisted
// to localStorage and shareable via URL hash. Turns one-off exploration into a
// reproducible artifact: save the current collection under a title, reload it
// later, or share a link that hydrates the exact same set on someone else's
// machine. Mirrors collection.ts (external store + useSyncExternalStore).
//
// Zero backend: sharing is a compact URL hash (#inv=<base64(title|id,id,...)>),
// saving is localStorage. No server, no account.

import { useSyncExternalStore } from "react";

const KEY = "offnominal.investigations.v1";

export type Investigation = {
  id: string;          // local id (timestamp-ish, assigned at save)
  title: string;
  caseIds: string[];
  savedAt: string;     // ISO date string (stamped by caller — avoids Date.now in shared code)
};

function load(): Investigation[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => x && typeof x.title === "string" && Array.isArray(x.caseIds)) : [];
  } catch {
    return [];
  }
}

let items: Investigation[] = load();
const subs = new Set<() => void>();

function commit(next: Investigation[]) {
  items = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* ignore quota / private mode */
  }
  subs.forEach((f) => f());
}

export const investigationsStore = {
  subscribe(f: () => void) {
    subs.add(f);
    return () => { subs.delete(f); };
  },
  snapshot(): Investigation[] {
    return items;
  },
  save(inv: Investigation) {
    // upsert by id
    const idx = items.findIndex((x) => x.id === inv.id);
    if (idx >= 0) commit(items.map((x) => (x.id === inv.id ? inv : x)));
    else commit([inv, ...items]);
  },
  remove(id: string) {
    commit(items.filter((x) => x.id !== id));
  },
};

export function useInvestigations(): Investigation[] {
  return useSyncExternalStore(investigationsStore.subscribe, investigationsStore.snapshot, investigationsStore.snapshot);
}

// ── URL-hash sharing ────────────────────────────────────────────────────────
// Encode {title, caseIds} into a URL-safe base64 hash. Compact and offline.

export function encodeInvestigation(title: string, caseIds: string[]): string {
  const payload = `${title.replace(/\|/g, " ")}|${caseIds.join(",")}`;
  // btoa over UTF-8-safe bytes
  const b64 = typeof btoa !== "undefined" ? btoa(unescape(encodeURIComponent(payload))) : "";
  return `inv=${b64}`;
}

export function decodeInvestigation(hash: string): { title: string; caseIds: string[] } | null {
  const m = hash.match(/inv=([^&]+)/);
  if (!m) return null;
  try {
    const decoded = decodeURIComponent(escape(atob(m[1])));
    const sep = decoded.indexOf("|");
    if (sep < 0) return null;
    const title = decoded.slice(0, sep);
    const caseIds = decoded.slice(sep + 1).split(",").filter(Boolean);
    return { title, caseIds };
  } catch {
    return null;
  }
}

/** Read a shared investigation from the current location hash, if present. */
export function readSharedFromHash(): { title: string; caseIds: string[] } | null {
  if (typeof location === "undefined" || !location.hash) return null;
  return decodeInvestigation(location.hash.replace(/^#/, ""));
}
