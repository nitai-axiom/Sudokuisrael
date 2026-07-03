import { test } from "node:test";
import assert from "node:assert/strict";
import { toRow, batches, buildRequest, loadAll } from "../load-supabase.mjs";

test("toRow maps fields and preserves nulls", () => {
  assert.deepEqual(
    toRow({ id: 9, source_id: 3, puzzle: "p", solution: "s", difficulty: "hard", techniques: ["x"], givens: 24, fun_score: null, er_rating: 4.2, generated_at: "z" }),
    { puzzle: "p", solution: "s", difficulty: "hard", techniques: ["x"], givens: 24, fun_score: null, er_rating: 4.2 },
  );
});

test("batches splits into chunks with a short tail", () => {
  const b = batches([1, 2, 3, 4, 5], 2);
  assert.deepEqual(b, [[1, 2], [3, 4], [5]]);
});

test("buildRequest targets puzzles with ignore-duplicates upsert", () => {
  const { url, headers, body } = buildRequest("https://x.supabase.co", "KEY", [{ puzzle: "p" }]);
  assert.equal(url, "https://x.supabase.co/rest/v1/puzzles?on_conflict=puzzle");
  assert.equal(headers.apikey, "KEY");
  assert.equal(headers.Authorization, "Bearer KEY");
  assert.match(headers.Prefer, /resolution=ignore-duplicates/);
  assert.equal(body, JSON.stringify([{ puzzle: "p" }]));
});

test("loadAll posts every batch and counts rows sent", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(JSON.parse(opts.body).length);
    return { ok: true, status: 201, text: async () => "" };
  };
  const data = Array.from({ length: 5 }, (_, i) => ({ puzzle: `p${i}`, solution: "s", difficulty: "easy", techniques: [], givens: 25, fun_score: 1, er_rating: null }));
  const res = await loadAll({ url: "https://x.supabase.co", key: "K", data, fetchImpl, batchSize: 2 });
  assert.equal(res.sent, 5);
  assert.deepEqual(calls, [2, 2, 1]);
});

test("loadAll throws on a non-ok response", async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, text: async () => "bad" });
  await assert.rejects(
    loadAll({ url: "u", key: "K", data: [{ puzzle: "p" }], fetchImpl, batchSize: 1 }),
    /400/,
  );
});
