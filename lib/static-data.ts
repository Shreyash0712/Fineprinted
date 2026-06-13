import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ClauseCategory,
  ClauseSeverity,
  ClauseStance,
  Grade,
} from "./types";

/**
 * Static data layer. Published service data is exported to data/*.json by
 * scripts/export-static.ts (run in GitHub Actions after a publish) and
 * committed to the repo. Vercel redeploys on the commit, and the public
 * pages below read these files at BUILD time — so browsing the site costs
 * zero database calls.
 */

const DATA_DIR = path.join(process.cwd(), "data");

export interface ServiceIndexEntry {
  id: string;
  name: string;
  root_domain: string;
  status: "active";
  current_score: number;
  current_grade: Grade;
  created_at: string;
  updated_at: string;
}

export interface ServicesIndex {
  generated_at: string | null;
  stats: {
    services: number;
    flagged_clauses: number;
    changes_published: number;
  };
  services: ServiceIndexEntry[];
}

export interface StaticClause {
  document_name: string;
  category: ClauseCategory;
  stance: ClauseStance;
  severity: ClauseSeverity;
  points: number;
  label: string;
  summary: string;
  excerpt: string;
  confidence: number;
}

export interface StaticHistoryEvent {
  id: string;
  date: string;
  document_name: string;
  points: number;
  summary: string | null;
  added: number;
  modified: number;
  removed: number;
}

export interface StaticDocument {
  name: string | null;
  url: string | null;
}

/** One “at a glance” takeaway, e.g. “You give up your right to sue.” (−30) */
export interface SummaryLine {
  text: string;
  points: number;
}

export interface ServiceDetail {
  id: string;
  name: string;
  root_domain: string;
  grade: Grade;
  score: number;
  generated_at: string;
  last_published_at: string | null;
  summary: {
    good: SummaryLine[];
    bad: SummaryLine[];
  };
  documents: StaticDocument[];
  clauses: StaticClause[];
  history: StaticHistoryEvent[];
}

const EMPTY_INDEX: ServicesIndex = {
  generated_at: null,
  stats: { services: 0, flagged_clauses: 0, changes_published: 0 },
  services: [],
};

export async function loadServicesIndex(): Promise<ServicesIndex> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, "services.json"), "utf8");
    return JSON.parse(raw) as ServicesIndex;
  } catch {
    // Missing/unreadable file (fresh clone before the first export) — the
    // site renders an empty directory rather than failing the build.
    return EMPTY_INDEX;
  }
}

export async function loadServiceDetail(domain: string): Promise<ServiceDetail | null> {
  // Domains become file names — keep the lookup strictly inside data/services.
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(domain) || domain.includes("..")) return null;
  try {
    const raw = await fs.readFile(
      path.join(DATA_DIR, "services", `${domain}.json`),
      "utf8"
    );
    return JSON.parse(raw) as ServiceDetail;
  } catch {
    return null;
  }
}
