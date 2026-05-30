// InsForge Edge Function: GET /functions/health
// Liveness check — no auth required
export default async function handler(req: Request): Promise<Response> {
  return Response.json(
    { status: 'ok', timestamp: new Date().toISOString() },
    { status: 200 }
  );
}
