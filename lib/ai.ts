// AI integration for PageVault
// Requests change analysis from an OpenAI-compatible LLM or returns deterministic mock analysis
import type {
  AnalyzeInput,
  ChangeAnalysisResult,
  ChangeType,
  EvidenceItem,
  PageType,
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

// Keywords that indicate higher severity
const PRICING_KEYWORDS = ['price', 'pricing', 'plan', 'cost', 'subscription', 'billing', 'charged', 'fee', 'tier', 'unlimited', 'projects', 'included'];
const SECURITY_KEYWORDS = ['security', 'ssO', 'auth', 'authentication', 'saml', 'oauth', 'enterprise', 'compliance'];
const LEGAL_KEYWORDS = ['terms', 'privacy', 'legal', 'gdpr', 'ccpa', 'cookie', 'policy'];

/**
 * Detect severity from text content when AI is unavailable.
 * Derives from keywords in before/after text.
 */
function deriveMockSeverity(before: string, after: string): Severity {
  const combined = (before + ' ' + after).toLowerCase();
  if (PRICING_KEYWORDS.some(k => combined.includes(k))) return 'high';
  if (SECURITY_KEYWORDS.some(k => combined.includes(k))) return 'medium';
  if (LEGAL_KEYWORDS.some(k => combined.includes(k))) return 'medium';
  return 'low';
}

/**
 * Detect change type from text content.
 */
function deriveMockChangeType(before: string, after: string): ChangeType {
  const combined = (before + ' ' + after).toLowerCase();
  if (PRICING_KEYWORDS.some(k => combined.includes(k))) return 'pricing';
  if (SECURITY_KEYWORDS.some(k => combined.includes(k))) return 'security';
  if (combined.includes('hire') || combined.includes('career') || combined.includes('job') || combined.includes('executive')) return 'hiring';
  if (combined.includes('position') || combined.includes('for small teams') || combined.includes('enterprises') || combined.includes('modern')) return 'positioning';
  return 'unknown';
}

/**
 * Build a deterministic mock analysis from before/after text.
 * Always returns ≥1 evidence item grounded in the provided text.
 */
function buildMockAnalysis(input: AnalyzeInput): ChangeAnalysisResult {
  const severity = deriveMockSeverity(input.previousText, input.currentText);
  const changeType = deriveMockChangeType(input.previousText, input.currentText);

  // Extract short text snippets for evidence
  const prevSentences = input.previousText.split(/[.\n]/).filter(s => s.trim().length > 0);
  const currSentences = input.currentText.split(/[.\n]/).filter(s => s.trim().length > 0);

  const evidence: EvidenceItem[] = [
    {
      before: prevSentences[0]?.trim() ?? input.previousText.slice(0, 100),
      after: currSentences[0]?.trim() ?? input.currentText.slice(0, 100),
      explanation: `The ${changeType} section shows content update between versions`,
    },
  ];

  // Build summary based on change type
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
    ? 'DemoCo appears to be moving upmarket, shifting from unlimited Starter to a 10-project limit while gating SSO and API access to higher tiers.'
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

/**
 * Analyze a page change using AI or return a deterministic mock.
 * Real mode: calls OpenAI-compatible Chat Completions API with JSON-only prompt.
 * Mock/fallback mode: returns deterministic mock when creds absent, call fails, or response is unparseable.
 * Never rejects - always resolves to a structurally valid ChangeAnalysisResult.
 */
export async function analyzePageChange(input: AnalyzeInput): Promise<ChangeAnalysisResult> {
  if (!hasAiCreds()) {
    return buildMockAnalysis(input);
  }

  try {
    const apiKey = process.env.OPENAI_API_KEY!;
    const baseUrl = process.env.OPENAI_BASE_URL ?? 'https://openai.com/v1';
    const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

    const response = await fetch(`${baseUrl}/chat/completions`, {
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

    if (!response.ok) {
      console.error(`AI API error: ${response.status} ${response.statusText}`);
      return buildMockAnalysis(input);
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return buildMockAnalysis(input);
    }

    // Parse the JSON response
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>;

      // Validate and extract required fields
      const severity = (parsed.severity as string) ?? 'low';
      const changeType = (parsed.change_type as string) ?? 'unknown';
      const summary = (parsed.summary as string) ?? 'Change detected';
      const businessInterpretation = (parsed.business_interpretation as string) ?? 'Business impact identified';
      const evidence = (parsed.evidence as EvidenceItem[]) ?? [];
      const recommendedActions = (parsed.recommended_actions as string[]) ?? [];

      // Ensure at least one evidence item
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
    } catch {
      console.error('Failed to parse AI response as JSON, using mock');
      return buildMockAnalysis(input);
    }
  } catch (error) {
    console.error('AI analysis failed, using mock:', error);
    return buildMockAnalysis(input);
  }
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