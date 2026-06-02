// AI integration for PageVault.
//
// Behavior:
//   - Missing OPENAI_API_KEY  → throw a clear setup error (the LLM is what
//                               makes the change analysis valuable).
//   - Real call fails (network, 4xx/5xx, malformed JSON) → throw the underlying
//     error. We do NOT return a synthetic analysis on real-call failure; that
//     would silently pass off a fake interpretation as a real one.
//
// If you need a fixture for local UI development, set `__dev__FALLBACK__=1` —
// when the real call fails, the analyzer returns a small synthetic analysis
// built from the input text. This is a developer escape hatch only.
import type {
  AnalyzeInput,
  ChangeAnalysisResult,
  ChangeType,
  EvidenceItem,
  Severity,
} from '@/types';
import { hasAiCreds } from './env';

// Analyst prompt for JSON-only output
const ANALYST_PROMPT = `You are a PageVault analyst reviewing a web page change.

Given the previous and current text of a monitored page, analyze what changed and produce a structured analysis.

Return ONLY valid JSON with this exact structure:
{
  "severity": "low" | "medium" | "high",
  "change_type": "pricing" | "positioning" | "feature" | "legal" | "security" | "hiring" | "docs" | "minor" | "unknown",
  "summary": "brief description of what changed",
  "business_interpretation": "why this matters for competitive intelligence",
  "evidence": [
    {"before": "text from previous version", "after": "text from current version", "explanation": "what this change means"}
  ],
  "recommended_actions": ["action 1", "action 2", "action 3"]
}

Rules:
- severity: "low" for formatting/word changes only; "medium" or "high" for pricing, security, legal, or feature changes
- change_type: classify based on what changed most
- evidence: at least 1 item, each grounded in the provided text
- recommended_actions: 1-5 actionable items based on the change`;

// ─── Dev fallback heuristic (used only with __dev__FALLBACK__=1) ─────────────

const PRICING_KEYWORDS = ['price', 'pricing', 'plan', 'cost', 'subscription', 'billing', 'charged', 'fee', 'tier', 'unlimited', 'projects', 'included'];
const SECURITY_KEYWORDS = ['security', 'sso', 'auth', 'authentication', 'saml', 'oauth', 'enterprise', 'compliance'];
const LEGAL_KEYWORDS = ['terms', 'privacy', 'legal', 'gdpr', 'ccpa', 'cookie', 'policy'];

function deriveFallbackSeverity(before: string, after: string): Severity {
  const combined = (before + ' ' + after).toLowerCase();
  if (PRICING_KEYWORDS.some(k => combined.includes(k))) return 'high';
  if (SECURITY_KEYWORDS.some(k => combined.includes(k))) return 'medium';
  if (LEGAL_KEYWORDS.some(k => combined.includes(k))) return 'medium';
  return 'low';
}

function deriveFallbackChangeType(before: string, after: string): ChangeType {
  const combined = (before + ' ' + after).toLowerCase();
  if (PRICING_KEYWORDS.some(k => combined.includes(k))) return 'pricing';
  if (SECURITY_KEYWORDS.some(k => combined.includes(k))) return 'security';
  if (combined.includes('hire') || combined.includes('career') || combined.includes('job') || combined.includes('executive')) return 'hiring';
  if (combined.includes('position') || combined.includes('for small teams') || combined.includes('enterprises') || combined.includes('modern')) return 'positioning';
  return 'unknown';
}

/**
 * Build a synthetic analysis from before/after text. Used ONLY when the dev
 * escape hatch is on and a real LLM call fails.
 */
function buildFallbackAnalysis(input: AnalyzeInput): ChangeAnalysisResult {
  const severity = deriveFallbackSeverity(input.previousText, input.currentText);
  const changeType = deriveFallbackChangeType(input.previousText, input.currentText);

  const prevSentences = input.previousText.split(/[.\n]/).filter(s => s.trim().length > 0);
  const currSentences = input.currentText.split(/[.\n]/).filter(s => s.trim().length > 0);

  const evidence: EvidenceItem[] = [
    {
      before: prevSentences[0]?.trim() ?? input.previousText.slice(0, 100),
      after: currSentences[0]?.trim() ?? input.currentText.slice(0, 100),
      explanation: `The ${changeType} section shows content update between versions`,
    },
  ];

  const summaryMap: Record<ChangeType, string> = {
    pricing: 'Pricing plan changed - project limits and feature availability modified',
    security: 'Security features updated - SSO and authentication options changed',
    positioning: 'Market positioning updated - target audience description changed',
    feature: 'Feature set changed',
    legal: 'Legal/policy content updated',
    hiring: 'Hiring content changed',
    docs: 'Documentation updated',
    minor: 'Minor content update',
    unknown: 'Content changed',
  };

  const summary = summaryMap[changeType] ?? 'Content changed';
  const businessInterpretation = changeType === 'pricing'
    ? 'Vendor appears to be moving upmarket, shifting from unlimited Starter to a 10-project limit while gating SSO and API access to higher tiers.'
    : changeType === 'security'
    ? 'Security offering change detected - SSO moved to Enterprise tier suggests pricing restructuring.'
    : changeType === 'positioning'
    ? 'Market positioning shift detected - moving from "small teams" to "modern enterprises" indicates target market change.'
    : `A ${changeType} change was detected on the ${input.pageType} page.`;

  return {
    severity,
    changeType,
    summary,
    businessInterpretation,
    evidence,
    recommendedActions: [
      'Update the competitive battlecard',
      'Review vendor renewal risk',
      'Ask whether existing customers are grandfathered',
      'Monitor future pricing changes',
    ],
  };
}

function devFallbackEnabled(): boolean {
  return process.env.__dev__FALLBACK__ === '1';
}

// Normalize severity to valid enum values
function normalizeSeverity(value: string): Severity {
  if (value === 'medium' || value === 'high') return value as Severity;
  return 'low';
}

// Normalize change type to valid enum values
function normalizeChangeType(value: string): ChangeType {
  const validTypes: ChangeType[] = ['pricing', 'positioning', 'feature', 'legal', 'security', 'hiring', 'docs', 'minor', 'unknown'];
  if (validTypes.includes(value as ChangeType)) return value as ChangeType;
  return 'unknown';
}

/**
 * Analyze a page change using an OpenAI-compatible LLM.
 *
 * Throws if credentials are missing or the API call fails (or returns
 * unparseable JSON). The dev escape hatch `__dev__FALLBACK__=1` returns a
 * synthetic analysis on real-call failure; this is for local UI work and is
 * never the default.
 */
export async function analyzePageChange(input: AnalyzeInput): Promise<ChangeAnalysisResult> {
  if (!hasAiCreds()) {
    throw new Error(
      'AI credentials are not configured. Set OPENAI_API_KEY in your environment ' +
      'to analyze page changes. (OPENAI_BASE_URL and OPENAI_MODEL are optional overrides.)'
    );
  }

  const apiKey = process.env.OPENAI_API_KEY!;
  const baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: ANALYST_PROMPT },
          {
            role: 'user',
            content: `Previous snapshot text:\n${input.previousText}\n\nCurrent snapshot text:\n${input.currentText}`,
          },
        ],
        temperature: 0.3,
      }),
    });
  } catch (networkErr) {
    if (devFallbackEnabled()) {
      console.warn('[ai] real call failed, dev fallback engaged:', networkErr);
      return buildFallbackAnalysis(input);
    }
    throw new Error(
      `AI request failed: ${networkErr instanceof Error ? networkErr.message : 'network error'}`
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (devFallbackEnabled()) {
      console.warn(`[ai] ${response.status} ${response.statusText} — dev fallback engaged`);
      return buildFallbackAnalysis(input);
    }
    throw new Error(
      `AI API error: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`
    );
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    if (devFallbackEnabled()) {
      console.warn('[ai] empty response — dev fallback engaged');
      return buildFallbackAnalysis(input);
    }
    throw new Error('AI API returned an empty response');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    if (devFallbackEnabled()) {
      console.warn('[ai] unparseable JSON, dev fallback engaged');
      return buildFallbackAnalysis(input);
    }
    throw new Error('AI response was not valid JSON');
  }

  const severity = (parsed.severity as string) ?? 'low';
  const changeType = (parsed.change_type as string) ?? 'unknown';
  const summary = (parsed.summary as string) ?? 'Change detected';
  const businessInterpretation = (parsed.business_interpretation as string) ?? 'Business impact identified';
  let evidence: EvidenceItem[] = Array.isArray(parsed.evidence) ? (parsed.evidence as EvidenceItem[]) : [];
  const recommendedActions = Array.isArray(parsed.recommended_actions) ? (parsed.recommended_actions as string[]) : [];

  if (evidence.length === 0) {
    evidence.push({
      before: input.previousText.slice(0, 100),
      after: input.currentText.slice(0, 100),
      explanation: 'Content changed between versions',
    });
  }

  return {
    severity: normalizeSeverity(severity),
    changeType: normalizeChangeType(changeType),
    summary,
    businessInterpretation,
    evidence,
    recommendedActions,
  };
}
