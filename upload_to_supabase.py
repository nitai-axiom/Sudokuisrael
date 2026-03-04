#!/usr/bin/env python3
"""
upload_to_supabase.py
Usage: python upload_to_supabase.py puzzles.json
Reads the JSON output from sudoku-generator and bulk-inserts into Supabase.
Requires: pip install supabase python-dotenv
"""

import json
import sys
import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
BATCH_SIZE = 50


def main():
    if len(sys.argv) < 2:
        print("Usage: python upload_to_supabase.py <puzzles.json>", file=sys.stderr)
        sys.exit(1)

    input_file = sys.argv[1]

    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env", file=sys.stderr)
        sys.exit(1)

    with open(input_file) as f:
        puzzles = json.load(f)

    if not isinstance(puzzles, list):
        print("ERROR: expected a JSON array at the top level", file=sys.stderr)
        sys.exit(1)

    print(f"Loaded {len(puzzles)} puzzles from {input_file}")

    supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    # Strip the generated_at field if you want Supabase's created_at to handle timestamps,
    # or keep it — the table schema uses created_at separately. We rename it here.
    rows = []
    for p in puzzles:
        rows.append({
            "puzzle":     p["puzzle"],
            "solution":   p["solution"],
            "difficulty": p["difficulty"],
            "techniques": p["techniques"],
            "givens":     p["givens"],
            # created_at is handled by Supabase default; generated_at is informational only
        })

    total = len(rows)
    uploaded = 0

    for i in range(0, total, BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        supabase.table("puzzles").insert(batch).execute()
        uploaded += len(batch)
        print(f"Uploaded {uploaded}/{total}")

    print("Done!")


if __name__ == "__main__":
    main()
