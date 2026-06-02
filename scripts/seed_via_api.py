#!/usr/bin/env python3
"""
Seed PageVault DB via InsForge REST API using the service role key.
Uses SRK via /api/database/records (public endpoint, bypasses RLS).
UUIDs: all must have exactly 32 hex chars (8-4-4-4-12 groups).
"""
import urllib.request, urllib.error, json

SRK = open('/home/azureuser/workspace/PageVault/.env.local').read()
SRK = [l for l in SRK.split('\n') if l.startswith('INSFORGE_SERVICE_ROLE_KEY=')][0].split('=')[1].strip()
BASE = "https://wga6k9at.us-east.insforge.app/api/database/records"

def api(method, table, params="", body=None):
    url = f"{BASE}/{table}" + (f"?{params}" if params else "")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data,
        headers={"Authorization": f"Bearer {SRK}", "Content-Type": "application/json",
                 "Prefer": "return=representation"},
        method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}", "body": e.read().decode()[:300]}

def clear_table(table):
    result = api("DELETE", table)
    return result if isinstance(result, dict) and "error" in result else {"deleted": "ok"}

def insert_one(table, row):
    result = api("POST", table, body=row)
    if isinstance(result, list) and len(result) > 0:
        return result[0]
    return result

# ── Clear ─────────────────────────────────────────────────────────────────────
print("=== Clearing ===")
for tbl in ["ai_explanations", "snapshots", "snapshot_jobs"]:
    print(f"  {tbl}: {clear_table(tbl)}")

# ── Snapshot Jobs (9 rows) ────────────────────────────────────────────────────
# Each UUID has exactly 32 hex chars: 8-4-4-4-12 format.
# First char is always a-f to avoid UUID parse issues.
# Projects: 1=1111-1111, 2=2222-2222, 3=3333-3333
jobs = [
    # AWS Lambda page (1111-1111-0000-0000-000000000004): 2 jobs
    ("a0000001-1111-0000-0000-000000000001", "11111111-0000-0000-0000-000000000004", "2026-05-21T08:00:00.000Z", "2026-05-21T08:02:15.000Z"),
    ("a0000002-1111-0000-0000-000000000001", "11111111-0000-0000-0000-000000000004", "2026-05-29T08:00:00.000Z", "2026-05-29T08:02:05.000Z"),
    # AWS .com/ page (1111-1111-0000-0000-000000000001): 2 jobs
    ("a0000003-1111-0000-0000-000000000001", "11111111-0000-0000-0000-000000000001", "2026-05-21T08:00:00.000Z", "2026-05-21T08:01:45.000Z"),
    ("a0000004-1111-0000-0000-000000000001", "11111111-0000-0000-0000-000000000001", "2026-05-29T08:00:00.000Z", "2026-05-29T08:01:30.000Z"),
    # AWS EC2 page (1111-1111-0000-0000-000000000002): 1 job
    ("a0000005-1111-0000-0000-000000000001", "11111111-0000-0000-0000-000000000002", "2026-05-29T08:00:00.000Z", "2026-05-29T08:01:30.000Z"),
    # Apify storage page (2222-2222-0000-0000-000000000003): 2 jobs
    ("b0000006-2222-0000-0000-000000000001", "22222222-0000-0000-0000-000000000003", "2026-05-27T10:00:00.000Z", "2026-05-27T10:01:55.000Z"),
    ("b0000007-2222-0000-0000-000000000001", "22222222-0000-0000-0000-000000000003", "2026-05-29T10:00:00.000Z", "2026-05-29T10:02:10.000Z"),
    # Box security page (3333-3333-0000-0000-000000000002): 2 jobs
    ("c0000008-3333-0000-0000-000000000001", "33333333-0000-0000-0000-000000000002", "2026-05-26T09:00:00.000Z", "2026-05-26T09:01:40.000Z"),
    ("c0000009-3333-0000-0000-000000000001", "33333333-0000-0000-0000-000000000002", "2026-05-29T09:00:00.000Z", "2026-05-29T09:01:55.000Z"),
]

print("\n=== Snapshot Jobs (9 rows) ===")
for (jid, tpid, req_at, fin_at) in jobs:
    r = insert_one("snapshot_jobs", {
        "id": jid, "tracked_page_id": tpid, "trigger_type": "manual", "status": "succeeded",
        "apify_run_id": "run-pending", "requested_at": req_at, "finished_at": fin_at
    })
    ok = isinstance(r, dict) and "id" in r and "error" not in r
    print(f"  {'OK' if ok else 'FAIL'} {jid}: {r if not ok else 'inserted'}")

# ── Snapshots (9 rows) ───────────────────────────────────────────────────────
# Each snapshot links to a job_id from above.
# change_type: 'none' for stable pages, 'textual'/'structural' for changed ones.
snaps = [
    # AWS Lambda: 2 scans (May 21=no change, May 29=textual — ARM pricing)
    ("d0000001-1111-0000-0000-000000000001", "11111111-0000-0000-0000-000000000004", "a0000001-1111-0000-0000-000000000001", "2026-05-21T08:02:15.000Z", "https://aws.amazon.com/lambda/", "AWS Lambda - Serverless Computing Service", "none"),
    ("d0000002-1111-0000-0000-000000000001", "11111111-0000-0000-0000-000000000004", "a0000002-1111-0000-0000-000000000001", "2026-05-29T08:02:05.000Z", "https://aws.amazon.com/lambda/", "AWS Lambda - Serverless Computing Service", "textual"),
    # AWS .com/: 2 scans (both stable)
    ("d0000003-1111-0000-0000-000000000001", "11111111-0000-0000-0000-000000000001", "a0000003-1111-0000-0000-000000000001", "2026-05-21T08:01:45.000Z", "https://aws.amazon.com/", "Amazon Web Services (AWS) - Cloud Computing Services", "none"),
    ("d0000004-1111-0000-0000-000000000001", "11111111-0000-0000-0000-000000000001", "a0000004-1111-0000-0000-000000000001", "2026-05-29T08:01:30.000Z", "https://aws.amazon.com/", "Amazon Web Services (AWS) - Cloud Computing Services", "none"),
    # AWS EC2: 1 scan
    ("d0000005-1111-0000-0000-000000000001", "11111111-0000-0000-0000-000000000002", "a0000005-1111-0000-0000-000000000001", "2026-05-29T08:01:30.000Z", "https://aws.amazon.com/ec2/", "Amazon EC2 - Cloud Server & Compute", "none"),
    # Apify storage: 2 scans (May 27=no change, May 29=textual — storage tier)
    ("e0000006-2222-0000-0000-000000000001", "22222222-0000-0000-0000-000000000003", "b0000006-2222-0000-0000-000000000001", "2026-05-27T10:01:55.000Z", "https://apify.com/storage", "Cloud Storage for AI Scrapers | Apify", "none"),
    ("e0000007-2222-0000-0000-000000000001", "22222222-0000-0000-0000-000000000003", "b0000007-2222-0000-0000-000000000001", "2026-05-29T10:02:10.000Z", "https://apify.com/storage", "Cloud Storage for AI Scrapers | Apify", "textual"),
    # Box security: 2 scans (May 26=no change, May 29=structural — ISO cert)
    ("f0000008-3333-0000-0000-000000000001", "33333333-0000-0000-0000-000000000002", "c0000008-3333-0000-0000-000000000001", "2026-05-26T09:01:40.000Z", "https://www.box.com/security", "Box Security — Cloud Content Management", "none"),
    ("f0000009-3333-0000-0000-000000000001", "33333333-0000-0000-0000-000000000002", "c0000009-3333-0000-0000-000000000001", "2026-05-29T09:01:55.000Z", "https://www.box.com/security", "Box Security — Cloud Content Management", "structural"),
]

print("\n=== Snapshots (9 rows) ===")
for (sid, tpid, jid, obs, url, title, ctype) in snaps:
    r = insert_one("snapshots", {
        "id": sid, "tracked_page_id": tpid, "job_id": jid, "observed_at": obs,
        "final_url": url, "page_title": title, "http_status": 200,
        "markdown_hash": f"sha256:{sid[:8]}", "change_type": ctype
    })
    ok = isinstance(r, dict) and "id" in r and "error" not in r
    print(f"  {'OK' if ok else 'FAIL'} {sid}: {r if not ok else 'inserted'}")

# ── AI Explanations (3 rows) ─────────────────────────────────────────────────
# Each links a changed snapshot (textual/structural) to its previous baseline.
explanations = [
    # AWS Lambda ARM pricing text change (textual, high severity)
    ("a0000011-0000-0000-0000-000000000001", "d0000002-1111-0000-0000-000000000001", "d0000001-1111-0000-0000-000000000001", 0.93, "high",   "pricing",  "AWS Lambda ARM pricing reduced by 15%. x86 unchanged. Graviton push continues.", "ARM-based Lambda now ~35% cheaper in aggregate.", ["Update cost models", "Review ARM roadmap"]),
    # Apify storage tier doubling (textual, medium severity)
    ("a0000012-0000-0000-0000-000000000001", "e0000007-2222-0000-0000-000000000001", "e0000006-2222-0000-0000-000000000001", 0.89, "medium", "feature",  "Apify free storage doubled 2TB→5TB. Team plan 5TB→10TB.", "Responding to Bright Data / Scale SERP competitive pressure.", ["Update competitor docs"]),
    # Box ISO 27001 certification update (structural, low severity)
    ("a0000013-0000-0000-0000-000000000001", "f0000009-3333-0000-0000-000000000001", "f0000008-3333-0000-0000-000000000001", 0.87, "low",    "security", "Box updated ISO 27001 to 2022 version. Added 12 new AI data handling controls.", "Positioning for AI-era compliance requirements.", ["Update vendor security assessment"]),
]
outputs = [
    {"severity": "high",   "changeType": "pricing",  "summary": "AWS Lambda ARM pricing reduced by 15%. x86 unchanged. Graviton push continues.", "businessInterpretation": "ARM-based Lambda now ~35% cheaper in aggregate.", "recommendedActions": ["Update cost models", "Review ARM roadmap"]},
    {"severity": "medium", "changeType": "feature",  "summary": "Apify free storage doubled 2TB→5TB. Team plan 5TB→10TB.", "businessInterpretation": "Responding to Bright Data / Scale SERP pressure.", "recommendedActions": ["Update competitor docs"]},
    {"severity": "low",    "changeType": "security", "summary": "Box updated ISO 27001 to 2022 version. Added 12 new AI data handling controls.", "businessInterpretation": "Positioning for AI-era compliance.", "recommendedActions": ["Update vendor security assessment"]},
]

print("\n=== AI Explanations (3 rows) ===")
for (eid, sid, psid, conf, sev, ctype, summary, biz, actions), output in zip(explanations, outputs):
    r = insert_one("ai_explanations", {
        "id": eid, "snapshot_id": sid, "previous_snapshot_id": psid,
        "model": "gpt-4.1-mini", "prompt_version": "v2",
        "output_json": json.dumps(output), "confidence": conf
    })
    ok = isinstance(r, dict) and "id" in r and "error" not in r
    print(f"  {'OK' if ok else 'FAIL'} {eid}: {r if not ok else 'inserted'}")

# ── Final verification ────────────────────────────────────────────────────────
print("\n=== Final Verification ===")
for tbl in ["snapshot_jobs", "snapshots", "ai_explanations"]:
    rows = api("GET", tbl, "select=id&limit=20")
    count = len(rows) if isinstance(rows, list) else f"ERROR: {rows}"
    ids = [r["id"][:8] for r in rows] if isinstance(rows, list) else []
    print(f"  {tbl}: {count} rows — {ids}")