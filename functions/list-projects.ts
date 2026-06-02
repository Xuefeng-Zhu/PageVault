// InsForge Edge Function: GET /functions/list-projects
// Returns all projects with tracked pages and change stats
// Uses direct SQL queries to bypass RLS

const INSFORGE_BASE = 'https://wga6k9at.us-east.insforge.app'
const ANON_KEY = 'ik_e3a65bb4148400ec7697ac2602884f38'

interface DbProject {
  id: string
  name: string
  owner_id: string
  box_root_folder_id: string | null
  created_at: string
}

interface DbTrackedPage {
  id: string
  project_id: string
  source_url: string
  normalized_url: string
  slug: string
  box_page_folder_id: string | null
  active: boolean
  created_at: string
}

interface DbSnapshotJob {
  id: string
  tracked_page_id: string
  trigger_type: string
  status: string
  apify_run_id: string | null
  apify_dataset_id: string | null
  requested_at: string
  finished_at: string | null
  error_message: string | null
}

interface DbSnapshot {
  id: string
  tracked_page_id: string
  job_id: string
  observed_at: string
  final_url: string | null
  canonical_url: string | null
  page_title: string | null
  http_status: number | null
  markdown_hash: string
  html_hash: string | null
}

interface DbAIExplanation {
  id: string
  snapshot_id: string
  previous_snapshot_id: string | null
  model: string
  confidence: number
  created_at: string
  output_json: string
}

// Run a direct SQL query via InsForge internal API
async function sqlQuery<T = Record<string, unknown>>(query: string, connection = 'default'): Promise<T[]> {
  const res = await fetch(`${INSFORGE_BASE}/api/database/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({ query, connection: 'default' }),
  })
  if (!res.ok) {
    const text = await res.text()
    console.error(`SQL query failed (${res.status}): ${text.slice(0, 300)}`)
    return []
  }
  const rawText = await res.text()
  let data: { rows?: T[]; error?: string }
  try {
    data = JSON.parse(rawText)
  } catch {
    console.error('sqlQuery: failed to parse JSON:', rawText.slice(0, 200))
    return []
  }
  if (data.error) {
    console.error('sqlQuery error:', data.error)
    return []
  }
  console.error('sqlQuery OK, rows:', JSON.stringify(data.rows ?? []).slice(0, 100))
  return data.rows ?? []
}

export default async function handler(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url)
    const userId = url.searchParams.get('userId')

    // Get all projects
    const debugInfo: Record<string, unknown> = {}
    
    // Test different connection values
    const testConns = ['default', 'insforge', 'postgres', 'primary', '']
    const connResults: Record<string, unknown> = {}
    for (const conn of testConns) {
      const r = await sqlQuery<{count: number}>(
        `SELECT count(*) as count FROM public.projects`, conn
      )
      connResults[conn] = r
    }
    debugInfo.connectionTests = connResults

    // Test raw fetch
    const testRes = await fetch(`${INSFORGE_BASE}/api/database/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify({ query: 'SELECT count(*) as cnt FROM public.projects', connection: 'default' }),
    })
    const testText = await testRes.text()
    debugInfo.rawFetchTest = { status: testRes.status, body: testText.slice(0, 300) }

    const projects = await sqlQuery<DbProject>(
      "SELECT * FROM public.projects ORDER BY created_at DESC"
    )
    debugInfo.projectsCount = projects.length

    return Response.json({ debug: debugInfo })

    const projectIds = projects.map(p => `'${p.id}'`).join(',')

    // Get all tracked pages for these projects
    const trackedPages = await sqlQuery<DbTrackedPage>(
      `SELECT * FROM public.tracked_pages WHERE project_id IN (${projectIds})`
    )

    // Get all completed snapshot jobs (latest per page)
    const snapshotJobs = await sqlQuery<DbSnapshotJob>(
      `SELECT DISTINCT ON (tracked_page_id) * FROM public.snapshot_jobs WHERE status = 'succeeded' AND finished_at IS NOT NULL ORDER BY tracked_page_id, finished_at DESC`
    )

    // Get all snapshots (latest per page)
    const snapshots = await sqlQuery<DbSnapshot>(
      `SELECT DISTINCT ON (tracked_page_id) * FROM public.snapshots ORDER BY tracked_page_id, observed_at DESC`
    )

    // Get all AI explanations with their output_json parsed
    const aiExplanationsRaw = await sqlQuery<DbAIExplanation>(
      `SELECT ae.* FROM public.ai_explanations ae JOIN public.snapshots s ON s.id = ae.snapshot_id JOIN public.tracked_pages tp ON tp.id = s.tracked_page_id WHERE tp.project_id IN (${projectIds})`
    )

    const aiExplanations = aiExplanationsRaw.map(e => {
      let parsed: Record<string, unknown> = {}
      try { parsed = JSON.parse(e.output_json) } catch {}
      return { ...e, parsed }
    })

    // Build result per project
    const result = projects.map(project => {
      const pages = trackedPages.filter(p => p.project_id === project.id)
      const pageIds = pages.map(p => `'${p.id}'`).join(',')
      const pageIdSet = new Set(pages.map(p => p.id))

      // Latest scan job for this project's pages
      const latestJob = snapshotJobs
        .filter(j => pageIdSet.has(j.tracked_page_id))
        .sort((a, b) => new Date(b.finished_at!).getTime() - new Date(a.finished_at!).getTime())[0] ?? null

      // Snapshots for these pages
      const projectSnapshots = snapshots.filter(s => pageIdSet.has(s.tracked_page_id))
      const projectSnapshotIds = new Set(projectSnapshots.map(s => s.id))

      // AI explanations for these snapshots
      const projectExplanations = aiExplanations.filter(e => projectSnapshotIds.has(e.snapshot_id))

      const highCount = projectExplanations.filter(e => {
        const sev = (e.parsed as any)?.severity ?? ''
        return sev === 'high' || sev === 'HIGH' || sev === 'critical'
      }).length

      const mediumCount = projectExplanations.filter(e => {
        const sev = (e.parsed as any)?.severity ?? ''
        return sev === 'medium' || sev === 'MEDIUM'
      }).length

      const lowCount = projectExplanations.filter(e => {
        const sev = (e.parsed as any)?.severity ?? ''
        return sev === 'low' || sev === 'LOW'
      }).length

      // Recent changes (snapshots with explanations)
      const recentChanges = projectSnapshots
        .sort((a, b) => new Date(b.observed_at).getTime() - new Date(a.observed_at).getTime())
        .slice(0, 5)
        .map(s => {
          const exp = projectExplanations.find(e => e.snapshot_id === s.id)
          const parsed = exp?.parsed as any ?? {}
          return {
            id: s.id,
            pageId: s.tracked_page_id,
            pageUrl: s.final_url ?? '',
            pageTitle: s.page_title ?? '',
            observedAt: s.observed_at,
            severity: parsed.severity ?? (exp ? 'low' : null),
            summary: parsed.summary ?? null,
            changeType: parsed.changeType ?? null,
          }
        })

      return {
        id: project.id,
        name: project.name,
        targetName: project.name,
        category: 'General',
        boxFolderId: project.box_root_folder_id,
        highCount,
        mediumCount,
        lowCount,
        lastScanAt: latestJob?.finished_at ?? null,
        activeUrls: pages.filter(p => p.active).length,
        trackedPages: pages.map(p => ({
          id: p.id,
          sourceUrl: p.source_url,
          normalizedUrl: p.normalized_url,
          slug: p.slug,
          active: p.active,
          createdAt: p.created_at,
        })),
        recentChanges,
      }
    })

    return Response.json({ projects: result })
  } catch (err) {
    console.error('list-projects error:', err)
    return Response.json(
      { error: 'Internal error', message: String(err) },
      { status: 500 }
    )
  }
}
