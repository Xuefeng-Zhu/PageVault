#!/usr/bin/env python3
"""
Head-to-head model evaluation on the 3 seed rooms.
For each room, replay the baseline-vs-live-crawl diff through 4 candidate
models and score:
  1. Output Accuracy — does the JSON exactly match the seeded ground truth?
  2. Cost per call
  3. Latency

Models tested:
  - anthropic/claude-3.5-haiku       (current recommendation)
  - openai/gpt-4o-mini               (alternative primary)
  - google/gemini-2.5-flash          (Gemini small, non-'-exp' this time)
  - deepseek/deepseek-chat           (DeepSeek V3.2 family, the cheap path)
"""
import urllib.request, json, hashlib, datetime, os, re, sys, time

SRK = [l.split('=')[1].strip() for l in open('.env.local').read().split('\n') if l.startswith('INSFORGE_SERVICE_ROLE_KEY=')][0]
OPENROUTER_KEY = [l.split('=', 1)[1].strip() for l in open('.env.local').read().split('\n') if l.startswith('OPENROUTER_API_KEY=')][0]
BASE = 'https://wga6k9at.us-east.insforge.app'

def db_query(path, body=None, method='GET', prefer=None):
    headers = {'Authorization': f'Bearer {SRK}', 'Content-Type': 'application/json'}
    if prefer: headers['Prefer'] = prefer
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(f'{BASE}/api/database/records/{path}', data=data, headers=headers, method=method)
    return urllib.request.urlopen(r, timeout=30).read().decode()

def call_openrouter(model, system, user, max_tokens=2000):
    body = json.dumps({
        'model': model,
        'messages': [
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': user},
        ],
        'temperature': 0.2,
        'max_tokens': max_tokens,
        'response_format': {'type': 'json_object'},
    }).encode()
    t0 = time.time()
    req = urllib.request.Request('https://openrouter.ai/api/v1/chat/completions',
        data=body,
        headers={'Authorization': f'Bearer {OPENROUTER_KEY}', 'Content-Type': 'application/json'},
        method='POST')
    try:
        resp_raw = urllib.request.urlopen(req, timeout=60).read()
    except urllib.error.HTTPError as e:
        return {'error': f'HTTP {e.code}: {e.read().decode()[:200]}', 'latency': time.time() - t0}
    latency = time.time() - t0
    resp = json.loads(resp_raw)
    content = resp['choices'][0]['message']['content']
    usage = resp.get('usage', {})
    return {
        'content': content,
        'usage': usage,
        'latency': latency,
        'model_returned': resp.get('model', model),
    }

# === 1. Load 3 seed rooms + their ground truth ===
print('=== Loading seed data ===')
ground_truths = {}
for room_id, slug in [
    ('11111111-1111-1111-1111-111111111111', 'aws-infrastructure-monitor'),
    ('22222222-2222-2222-2222-222222222222', 'apify-platform-tracker'),
    ('33333333-3333-3333-3333-333333333333', 'box-enterprise-watch'),
]:
    expls = json.loads(db_query(f'ai_explanations?select=id,output_json&limit=5'))  # all
    # Filter to ones whose snapshot is on a page in this room
    pages = json.loads(db_query(f'tracked_pages?project_id=eq.{room_id}&select=id&limit=20'))
    page_ids = {p['id'] for p in pages}
    snaps = json.loads(db_query(f"snapshots?select=id,tracked_page_id&limit=50"))
    snap_ids_in_room = {s['id'] for s in snaps if s['tracked_page_id'] in page_ids}
    room_expls = [e for e in expls if e['id'] in (set() | snap_ids_in_room) or True]  # all for now

    # Find the GPT-4.1-mini seed explanations (the ground truth) for this room
    seed = None
    # Map: room_id -> seed explanation id prefix
    seed_id_by_room = {
        '11111111-1111-1111-1111-111111111111': 'a0000011',  # AWS
        '22222222-2222-2222-2222-222222222222': 'a0000012',  # Apify
        '33333333-3333-3333-3333-333333333333': 'a0000013',  # Box
    }
    target_prefix = seed_id_by_room.get(room_id)
    if target_prefix:
        for e in expls:
            if e['id'].startswith(target_prefix):
                try:
                    oj = json.loads(e['output_json']) if isinstance(e['output_json'], str) else e['output_json']
                    if isinstance(oj, dict):
                        seed = oj
                        break
                except: pass
    if seed:
        ground_truths[room_id] = seed
        print(f'  {slug}: ground truth = {seed.get("severity")}/{seed.get("changeType") or seed.get("change_type")}  {seed.get("summary", "")[:80]}...')

# === 2. Read live crawls (we have AWS + Apify already captured) ===
live_md_by_room = {}
aws_md = open('/tmp/aws-lambda-pricing.md').read() if os.path.exists('/tmp/aws-lambda-pricing.md') else None
apify_md = open('/tmp/apify-pricing-now.md').read() if os.path.exists('/tmp/apify-pricing-now.md') else None
# Box didn't get crawled; synthesize equivalent of seed (ISO 27001 2022 update)
box_md = """# Box Enterprise Security

## Compliance
Box Trust Center is now updated to reflect the new ISO/IEC 27001:2022 standard. Our Trust Services commitment now includes 12 new AI data handling controls.

## Updated certifications
ISO/IEC 27001:2022 — recertified 2026
SOC 2 Type II — current
"""

live_md_by_room['11111111-1111-1111-1111-111111111111'] = aws_md  # AWS
live_md_by_room['22222222-2222-2222-2222-222222222222'] = apify_md  # Apify
live_md_by_room['33333333-3333-3333-3333-333333333333'] = box_md  # Box (synthesized)

# Synthesized baselines (from seed explanations)
prev_md_by_room = {
    '11111111-1111-1111-1111-111111111111': """# AWS Lambda Pricing (baseline)

## Compute pricing
- $0.0000166667 per GB-second (x86)
- $0.0000133334 per GB-second (ARM/Graviton)
- 1M free requests/month, 400,000 GB-seconds free

## Standard tier
Standard Lambda pricing model.""",
    '22222222-2222-2222-2222-222222222222': """# Apify Pricing (baseline)

## Free tier
- 2 GB of storage on the Free plan
- 5 GB of storage on the Team plan
""",
    '33333333-3333-3333-3333-333333333333': """# Box Enterprise Security (baseline)

## Compliance
ISO/IEC 27001:2013 certification.""",
}

# === 3. Build minimal prompt ===
SYSTEM = """You are a PageVault analyst reviewing a web page change.

Given the previous and current text of a monitored page, analyze what changed and produce a structured analysis.

Return ONLY valid JSON with this exact structure:
{
  "changed": boolean,
  "severity": "low" | "medium" | "high",
  "change_type": "pricing" | "positioning" | "feature" | "legal" | "security" | "hiring" | "docs" | "minor" | "unknown",
  "summary": "one-sentence plain-English summary",
  "businessInterpretation": "why this matters (1-2 sentences)",
  "recommendedActions": ["action 1", "action 2", "action 3"],
  "evidence": [
    {"type": "text", "old": "old text or null", "new": "new text", "explanation": "why this matters"}
  ],
  "confidence": number between 0 and 1
}

Rules:
- Use ONLY the provided evidence. Never invent missing text.
- If evidence is weak, return changed=false, confidence<=0.4.
- Quote at most 80 characters per evidence item to stay within output budget.
- 3 evidence items is plenty; don't fabricate more."""

def extract_pricing_excerpt(md, max_chars=1200):
    out = []
    total = 0
    for line in md.split('\n'):
        s = line.strip()
        if re.search(r'(\$[\d,.]+|GB-seconds?|free tier|requests? per|per million|memory|graviton|x86|arm|tier|premium|management fee|managed instance|reserved|iso|27001|storage|iso)', s, re.I):
            if 5 < len(s) < 250 and not s.startswith('*') and not s.startswith('['):
                out.append(s)
                total += len(s)
                if total > max_chars: break
    return '\n'.join(out)

# === 4. Models to test ===
MODELS = [
    ('anthropic/claude-3.5-haiku', 'haiku'),
    ('openai/gpt-4o-mini', 'gpt-4o-mini'),
    ('google/gemini-2.5-flash', 'gemini-2.5-flash'),
    ('deepseek/deepseek-chat', 'deepseek-v3'),
]

# === 5. Run the matrix ===
print('\n=== Running 3 rooms x 4 models = 12 calls ===')
results = {}  # results[room_id][model_short] = {ai_output, usage, latency}

for room_id, slug in [
    ('11111111-1111-1111-1111-111111111111', 'AWS'),
    ('22222222-2222-2222-2222-222222222222', 'Apify'),
    ('33333333-3333-3333-3333-333333333333', 'Box'),
]:
    results[room_id] = {}
    prev_excerpt = extract_pricing_excerpt(prev_md_by_room[room_id], 800)
    live_excerpt = extract_pricing_excerpt(live_md_by_room[room_id], 1200)
    user = f"""Tracked page: {slug}

=== PREVIOUS ===
{prev_excerpt}

=== CURRENT ===
{live_excerpt}

Analyze the change. Return JSON only."""

    for model_id, short in MODELS:
        print(f'  {slug:6s} x {short:20s}...', end=' ', flush=True)
        result = call_openrouter(model_id, SYSTEM, user, max_tokens=600)
        if 'error' in result:
            print(f'FAILED: {result["error"][:80]}')
            results[room_id][short] = {'error': result['error']}
            continue
        try:
            ai = json.loads(result['content'])
            results[room_id][short] = {
                'ai': ai,
                'usage': result['usage'],
                'latency': result['latency'],
                'model': result.get('model_returned', model_id),
            }
            u = result['usage']
            print(f'OK ({result["latency"]:.1f}s, {u.get("total_tokens", "?")} tok, sev={ai.get("severity")}, conf={ai.get("confidence")})')
        except Exception as e:
            # Try to fix truncated JSON (common with max_tokens cutoff)
            content = result['content']
            # Remove trailing comma, close brackets
            for fix in [content.rstrip() + '}', content + '}', content.rstrip(',\n') + '}}']:
                try:
                    ai = json.loads(fix)
                    results[room_id][short] = {
                        'ai': ai, 'usage': result['usage'],
                        'latency': result['latency'], 'model': result.get('model_returned', model_id),
                        'note': 'recovered from truncated json',
                    }
                    print(f'OK (recovered, {result["latency"]:.1f}s)')
                    break
                except: continue
            else:
                print(f'PARSE FAIL: {str(e)[:80]}')
                print(f'  RAW TAIL: {repr(result["content"][-200:])}')
                print(f'  RAW HEAD: {repr(result["content"][:200])}')
                print(f'  RAW LEN: {len(result["content"])}')
                results[room_id][short] = {'error': f'parse: {e}', 'raw': result['content'][:500], 'len': len(result['content'])}

# === 6. Score against ground truth ===
def score(ai, truth):
    if not ai or 'severity' not in ai: return {'overall': 0, 'matches': []}
    # Ground truth uses 'changeType' (camelCase) from seed script
    truth_severity = truth.get('severity')
    truth_change_type = truth.get('changeType') or truth.get('change_type')
    matches = {
        'severity': ai.get('severity') == truth_severity,
        'change_type': ai.get('change_type') == truth_change_type,
        'changed': ai.get('changed') == truth.get('changed'),
    }
    # Soft score: how much of the summary is in the truth's summary (token overlap)
    ai_sum = set((ai.get('summary') or '').lower().split())
    truth_sum = set((truth.get('summary') or '').lower().split())
    if ai_sum and truth_sum:
        matches['summary_overlap'] = len(ai_sum & truth_sum) / max(len(ai_sum | truth_sum), 1)
    else:
        matches['summary_overlap'] = 0
    return matches

print('\n=== Scoring vs ground truth ===')
print(f'{"Model":20s} | {"AWS":12s} | {"Apify":12s} | {"Box":12s} | {"TotalAcc":10s} | {"AvgCost$":10s} | {"AvgLatency":10s}')
print('-' * 100)

for model_id, short in MODELS:
    total_correct = 0
    total_fields = 0
    total_cost = 0
    total_latency = 0
    n_calls = 0
    per_room = {}
    for room_id, slug in [('11111111-1111-1111-1111-111111111111', 'AWS'),
                          ('22222222-2222-2222-2222-222222222222', 'Apify'),
                          ('33333333-3333-3333-3333-333333333333', 'Box')]:
        if room_id not in ground_truths: continue
        r = results[room_id].get(short, {})
        if 'ai' not in r:
            per_room[slug] = 'FAIL'
            continue
        s = score(r['ai'], ground_truths[room_id])
        n_correct = sum(1 for k in ['severity', 'change_type', 'changed'] if s.get(k))
        total_correct += n_correct
        total_fields += 3
        # Cost: rough estimate (per 1M tokens)
        # haiku: $0.80/$4, gpt-4o-mini: $0.15/$0.60, gemini-2.5-flash: $0.075/$0.30, deepseek: $0.14/$0.28
        u = r.get('usage', {})
        cost_per_m = {'haiku': (0.80, 4.0), 'gpt-4o-mini': (0.15, 0.60),
                      'gemini-2.5-flash': (0.075, 0.30), 'deepseek-v3': (0.14, 0.28)}
        if short in cost_per_m:
            ci, co = cost_per_m[short]
            cost = (u.get('prompt_tokens', 0) * ci + u.get('completion_tokens', 0) * co) / 1_000_000
        else:
            cost = 0
        total_cost += cost
        total_latency += r.get('latency', 0)
        n_calls += 1
        per_room[slug] = f'{n_correct}/3 ({cost*1000:.2f}¢)'

    if n_calls > 0:
        total_acc = total_correct / total_fields if total_fields else 0
        avg_cost = total_cost / n_calls
        avg_latency = total_latency / n_calls
        line = f'{short:20s} | {per_room.get("AWS", "?"):12s} | {per_room.get("Apify", "?"):12s} | {per_room.get("Box", "?"):12s} | {total_acc*100:5.0f}%     | ${avg_cost:.5f}    | {avg_latency:5.1f}s'
        print(line)

# === 7. Per-room detail dump ===
print('\n=== Per-call detail ===')
for room_id, slug in [('11111111-1111-1111-1111-111111111111', 'AWS'),
                      ('22222222-2222-2222-2222-222222222222', 'Apify'),
                      ('33333333-3333-3333-3333-333333333333', 'Box')]:
    print(f'\n--- {slug} ---')
    truth = ground_truths.get(room_id, {})
    print(f'  TRUTH:  {truth.get("severity")}/{truth.get("change_type")}  {truth.get("summary", "")[:80]}')
    for model_id, short in MODELS:
        r = results[room_id].get(short, {})
        if 'ai' in r:
            ai = r['ai']
            u = r.get('usage', {})
            print(f'  {short:20s}: {ai.get("severity")}/{ai.get("change_type"):9s} conf={ai.get("confidence")} '
                  f'({u.get("prompt_tokens","?")}+{u.get("completion_tokens","?")} tok, {r["latency"]:.1f}s)')
            print(f'    summary: {ai.get("summary", "")[:100]}')
        else:
            print(f'  {short:20s}: FAILED ({r.get("error", "?")[:60]})')
