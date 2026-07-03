#!/usr/bin/env node
// load-supabase.mjs — stream every puzzle in sudoku_150000.json into the live
// Supabase `puzzles` table via PostgREST. Insert + ignore duplicates (unique
// key = puzzle), so it is idempotent and re-runnable. position/publish_date/
// is_active are left to column defaults; seed.sql stamps the daily positions.
//
// Requires a SERVICE-ROLE key (bypasses RLS). Run AFTER truncating the table:
//   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/load-supabase.mjs
//
// No dependencies: uses global fetch (Node >= 18).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../sudoku_150000.json");
const BATCH_SIZE = 500;

export function toRow(p) {
  return {
    puzzle: p.puzzle,
    solution: p.solution,
    difficulty: p.difficulty,
    techniques: p.techniques ?? [],
    givens: p.givens ?? null,
    fun_score: p.fun_score ?? null,
    er_rating: p.er_rating ?? null,
  };
}

export function batches(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function buildRequest(baseUrl, serviceKey, rows) {
  return {
    url: `${baseUrl}/rest/v1/puzzles?on_conflict=puzzle`,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  };
}

export async function loadAll({ url, key, data, fetchImpl = fetch, batchSize = BATCH_SIZE }) {
  let sent = 0;
  for (const chunk of batches(data, batchSize)) {
    const req = buildRequest(url, key, chunk);
    const res = await fetchImpl(req.url, { method: "POST", headers: req.headers, body: req.body });
    if (!res.ok) throw new Error(`Load failed: ${res.status} ${await res.text()}`);
    sent += chunk.length;
    console.log(`Uploaded ${sent}/${data.length}`);
  }
  return { sent };
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("ERROR: set SUPABASE_URL and SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(SRC, "utf8")).map(toRow);
  const { sent } = await loadAll({ url, key, data });
  console.log(`Done — ${sent} puzzles loaded.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
