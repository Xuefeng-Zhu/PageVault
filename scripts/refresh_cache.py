#!/usr/bin/env python3
"""
Pre-compute rooms data from InsForge DB and cache to JSON.
Run via: python3 scripts/refresh_cache.py
"""
import subprocess, json, sys, os
from datetime import datetime

CLI = ['npx', '@insforge/cli', 'db', 'query']
PROJECT = '/home/azureuser/workspace/PageVault'

def run(sql):
    r = subprocess.run(CLI + [sql], capture_output=True, text=True, cwd=PROJECT)
    out = r.stdout.strip()
    if 'error' in out.lower() and 'row' not in out.lower():
        print(f'WARN: {sql[:60]} -> {out[:100]}')
    return out

def parse_table(text):
    """Parse CLI table output into list of dicts."""
    lines = [l for l in text.strip().split('\n') if l.strip() and '│' in l]
    if len(lines) < 2:
        return []
    headers = [h.strip() for h in lines[0].split('│')[1:-1]]
    rows = []
    for line in lines[2:]:
        parts = [p.strip() for p in line.split('│')[1:-1]]
        rows.append(dict(zip(headers, parts)))
    return rows

def null_to_none(val):
    if val is None or val.strip() in ('', 'NULL', 'null'):
        return None
    return val.strip()

def main():
    # Get all projects
    projects_text = run("SELECT id, name, box_root_folder_id, created_at FROM public.projects ORDER BY created_at DESC")
    projects = parse_table(projects_text)

    # Get all tracked pages
    pages_text = run("SELECT id, project_id, source_url, normalized_url, slug, active, created_at FROM public.tracked_pages")
    pages = parse_table(pages_text)

    # Get snapshot jobs
    jobs_text = run("SELECT id, tracked_page_id, status, requested_at, finished_at FROM public.snapshot_jobs WHERE status = 'succeeded' AND finished_at IS NOT NULL")
    jobs = parse_table(jobs_text)

    # Get snapshots
    snaps_text = run("SELECT id, tracked_page_id, observed_at, final_url, page_title, http_status FROM public.snapshots")
    snaps = parse_table(snaps_text)

    # Get AI explanations with output_json
    expl_text = run("SELECT id, snapshot_id, output_json, confidence, created_at FROM public.ai_explanations")
    expls = parse_table(expl_text)

    # Index pages by project
    pages_by_project = {}
    for p in pages:
        pid = null_to_none(p.get('project_id'))
        if pid:
            pages_by_project.setdefault(pid, []).append(p)

    # Index snapshots by page
    snaps_by_page = {}
    for s in snaps:
        tid = null_to_none(s.get('tracked_page_id'))
        if tid:
            snaps_by_page.setdefault(tid, []).append(s)

    # Latest job per page
    jobs_by_page = {}
    for j in jobs:
        tid = null_to_none(j.get('tracked_page_id'))
        if tid:
            jobs_by_page.setdefault(tid, []).append(j)
    for tid in jobs_by_page:
        jobs_by_page[tid].sort(key=lambda x: x.get('finished_at') or '', reverse=True)

    # Parse explanations
    parsed_expls = []
    for e in expls:
        output = null_to_none(e.get('output_json'))
        conf = e.get('confidence')
        try:
            conf = float(conf) if conf else 0.0
        except:
            conf = 0.0
        parsed = None
        severity = 'low'
        summary = None
        change_type = None
        if output:
            try:
                parsed = json.loads(output)
                severity = (parsed.get('severity') or 'low').lower()
                summary = parsed.get('summary')
                change_type = parsed.get('changeType')
            except:
                pass
        parsed_expls.append({
            'id': e.get('id'),
            'snapshot_id': null_to_none(e.get('snapshot_id')),
            'severity': severity,
            'summary': summary,
            'changeType': change_type,
            'confidence': conf,
        })

    # Build result
    result = []
    for proj in projects:
        pid = null_to_none(proj.get('id'))
        proj_pages = pages_by_project.get(pid, [])
        page_ids = set(null_to_none(p.get('id')) for p in proj_pages if null_to_none(p.get('id')))

        # Latest job across all pages
        latest_job = None
        for pg in proj_pages:
            tid = null_to_none(pg.get('id'))
            if tid and tid in jobs_by_page:
                j = jobs_by_page[tid][0]
                if latest_job is None or (j.get('finished_at') or '') > (latest_job.get('finished_at') or ''):
                    latest_job = j

        # Count explanations by severity per page
        high = medium = low = 0
        recent_changes = []
        for pg in proj_pages:
            tid = null_to_none(pg.get('id'))
            if not tid:
                continue
            pg_snaps = sorted(snaps_by_page.get(tid, []), key=lambda x: x.get('observed_at') or '', reverse=True)
            for snap in pg_snaps[:3]:
                snap_id = null_to_none(snap.get('id'))
                exp = next((x for x in parsed_expls if x['snapshot_id'] == snap_id), None)
                sev = exp['severity'] if exp else 'none'
                if sev == 'high':
                    high += 1
                elif sev == 'medium':
                    medium += 1
                elif sev == 'low':
                    low += 1
                if exp or sev != 'none':
                    recent_changes.append({
                        'id': snap_id,
                        'pageId': tid,
                        'pageUrl': null_to_none(snap.get('final_url')) or '',
                        'pageTitle': null_to_none(snap.get('page_title')) or '',
                        'observedAt': null_to_none(snap.get('observed_at')) or '',
                        'severity': sev if sev != 'none' else None,
                        'summary': exp['summary'] if exp else None,
                        'changeType': exp['changeType'] if exp else None,
                    })

        recent_changes.sort(key=lambda x: x.get('observedAt') or '', reverse=True)
        recent_changes = recent_changes[:5]

        result.append({
            'id': pid,
            'name': null_to_none(proj.get('name')) or '',
            'targetName': null_to_none(proj.get('name')) or '',
            'category': 'General',
            'boxFolderId': null_to_none(proj.get('box_root_folder_id')),
            'highCount': high,
            'mediumCount': medium,
            'lowCount': low,
            'lastScanAt': latest_job.get('finished_at') if latest_job else None,
            'activeUrls': sum(1 for p in proj_pages if str(p.get('active','')).lower() == 'true'),
            'trackedPages': [
                {
                    'id': null_to_none(p.get('id')),
                    'sourceUrl': null_to_none(p.get('source_url')) or '',
                    'normalizedUrl': null_to_none(p.get('normalized_url')) or '',
                    'slug': null_to_none(p.get('slug')) or '',
                    'active': str(p.get('active','')).lower() == 'true',
                    'createdAt': null_to_none(p.get('created_at')),
                }
                for p in proj_pages
            ],
            'recentChanges': recent_changes,
        })

    cache = {
        'generatedAt': datetime.utcnow().isoformat() + 'Z',
        'projects': result,
    }

    cache_path = '/home/azureuser/workspace/PageVault/.rooms_cache.json'
    with open(cache_path, 'w') as f:
        json.dump(cache, f, indent=2)
    print(f'Cached {len(result)} rooms to {cache_path}')

if __name__ == '__main__':
    main()
