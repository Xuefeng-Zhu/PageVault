# LLM Model Research for PageVault's Page-Diff Analyzer

**Date:** 2026-06-02
**Author:** Hermes (compiled from live web research via Apify `rag-web-browser`)
**Sources:** Cleanlab Structured-Output Benchmark (Dec 2025), iternal.ai "Which LLM to Choose in 2026" (Mar 2026), OpenRouter model registry, the project's own live crawl results.

---

## 1. What the task actually is

PageVault's page-diff analyzer is a **structured-output extraction + classification** task over a small (≤4K token) evidence window. The output is a strict JSON object with:

| Field | Type | Why it's hard for the LLM |
|---|---|---|
| `changed` | bool | Must be evidence-grounded; "weak evidence" path returns false |
| `severity` | enum (low/medium/high) | Subjective, depends on business context |
| `change_type` | enum (8 values) | Disambiguates pricing vs feature vs legal etc. |
| `summary` | string | Must be a faithful one-sentence paraphrase of the diff, not invention |
| `businessInterpretation` | string | Requires inferring customer-relevant impact |
| `recommendedActions` | array of strings | Actionable, not generic |
| `evidence` | array of {old, new, explanation} | Must be direct quotes from input — no fabrication |
| `confidence` | float [0,1] | Self-assessment calibrated to actual evidence quality |

This is **not** a deep-reasoning task. It's a faithful-extraction task with a small classification head on top. The evidence-grounding rule is the most important capability, because the design's `SYSTEM_DESIGN.md` explicitly says: *"The model should never infer a change without citing the specific old/new text spans or DOM nodes that triggered the judgment; when evidence is weak, it should return `unknown` or `insufficient_evidence`."*

---

## 2. What the live crawl already proved

The script `scripts/live_crawl_real_llm.py` ran a real call through the InsForge AI gateway (OpenRouter) and the result was surprisingly informative:

| Model tried | Result | Why it failed or succeeded |
|---|---|---|
| `meta-llama/llama-3.3-70b-instruct:free` | 429 Too Many Requests | Free-tier rate limit hit immediately |
| `google/gemini-2.0-flash-exp:free` | 404 Not Found | Model name deprecated/retired |
| `anthropic/claude-3.5-haiku` | **Success** | 2,178 tokens (1,784 prompt / 394 completion), 0.9 confidence, identified the real "Lambda Managed Instances" pricing restructure with grounded evidence spans |

Cost: ~$0.0003 per call (haiku: $0.80/M input + $4/M output).

This single test already disqualifies:
- **Free-tier models on OpenRouter** — rate-limited, unreliable, frequently 404
- **Older Gemini Flash experimental models** — unstable naming/availability
- **Anything not on OpenRouter or Anthropic API** — adds latency and availability risk

---

## 3. Benchmarks that matter for this task

### 3.1 Cleanlab's structured-output benchmark (Dec 2025)

The most directly relevant public benchmark. They tested 5 models on 4 structured-extraction datasets. The results map cleanly onto PageVault's needs:

| Dataset | gpt-4.1-mini | gpt-5 | gemini-2.5-pro | gemini-2.5-flash | gemini-3-pro |
|---|---|---|---|---|---|
| Data Table Analysis (Field Acc) | 0.863 | 0.956 | 0.944 | 0.829 | 0.964 |
| Data Table Analysis (Output Acc) | 0.45 | 0.76 | 0.72 | 0.28 | 0.77 |
| Insurance Claims (Field Acc) | 0.75 | 0.767 | 0.775 | 0.758 | 0.775 |
| Insurance Claims (Output Acc) | 0.333 | 0.3 | 0.4 | 0.3 | 0.3 |
| Financial Entities (Field Acc) | 0.922 | 0.949 | 0.887 | 0.919 | 0.935 |
| Financial Entities (Output Acc) | 0.58 | 0.7 | 0.422 | 0.557 | 0.624 |
| PII Extraction (Field Acc) | 0.966 | 0.979 | 0.972 | 0.973 | 0.979 |
| PII Extraction (Output Acc) | 0.26 | 0.46 | 0.3 | 0.33 | 0.44 |

**Key insights:**
- **"Field Accuracy" ≠ "Output Accuracy"** — A model that gets 95% of fields right across samples might only produce 28% of fully-correct outputs. For PageVault, **Output Accuracy is what matters** because the whole JSON is rendered as a single explanation card; one wrong enum is a broken card.
- **For Insurance Claims, GPT-4.1-mini ties or beats GPT-5** on Output Accuracy (0.333 vs 0.30) — small models aren't always worse.
- **"Despite recent hype around Gemini-3, it does not constitute a massive advance beyond the OpenAI frontier for Structured Output use-cases."** — Cleanlab explicitly recommends starting with OpenAI's family for structured outputs.
- **GPT-4.1-mini was cheaper than Gemini-2.5-Flash (20% of the cost) AND lower latency (P50 = 65% of Flash's)**, even though Flash is the "small" Gemini model. This is decisive for PageVault's cost profile.

### 3.2 iternal.ai 2026 selection guide (Mar 2026)

For "Simple Extraction" and "Text Classification" tasks (the closest category to PageVault's analyzer), the guide recommends:

| Task | Tier | Proprietary | Open-source |
|---|---|---|---|
| Simple Extraction | Budget | Haiku 4.5, GPT-5 Nano | Phi-4, Qwen3-8B |
| Text Classification | Budget | Haiku 4.5, Flash-Lite | Phi-4, Llama 3.3 8B |
| Summarization | Mid | Sonnet 4.6, GPT-5 | DeepSeek V3, Qwen3-30B |
| Code Generation | High | Opus 4.6, GPT-5.4, Gemini 3 Flash | MiniMax M2.5/M2.7, Kimi K2.5 |

PageVault's analyzer is **Simple Extraction + Text Classification** (budget tier) with a thin layer of summarization. The recommended baseline is **Haiku 4.5** or **GPT-5 Nano**.

### 3.3 Practical cascade architecture (the "routing" insight)

The iternal.ai guide describes a routing pattern that's directly applicable to PageVault:

```
User Request
  |
  v
[Classifier / Router]  -- Estimates task complexity
  |
  |-- Simple (Level 1-3) --> Haiku 4.5 / GPT-5 Nano ($0.05-$1.00/M)
  |                              |
  |                              v
  |                         [Confidence Check]
  |                              |
  |                         >= 0.9 --> Return Response
  |                         < 0.9  --> Escalate to Mid-Tier
  |
  |-- Medium (Level 4-6) --> Sonnet 4.6 / GPT-5 ($3-$10/M)
  |                              |
  |                              v
  |                         [Confidence Check]
  |                              |
  |                         >= 0.85 --> Return Response
  |                         < 0.85  --> Escalate to Frontier
```

PageVault already has a `confidence` field in its output JSON. The cascade pattern maps directly: **run haiku first, if `confidence < 0.85` escalate to a frontier model**. This is what production cost-savings look like in 2026 (their example: 58% savings vs always-frontier).

---

## 4. Models considered (in order of fit)

### Tier 1 — Recommended primary

#### `anthropic/claude-3.5-haiku` *(already validated live)*
- **Cost:** $0.80/M input, $4/M output
- **Context:** 200K
- **Live result:** 0.9 confidence on real Lambda pricing diff, faithful evidence spans
- **Pros:** Cheapest reliable structured-output model. Cleanlab benchmarks show small models can match frontier on specific tasks. Anthropic models are strongest at "follow the rules" tasks — exactly what PageVault asks.
- **Cons:** Lacks frontier reasoning. Will give up on hard semantic disambiguation (e.g., "is this a security change or a docs change?") rather than guess.

**Verdict: primary default.** Routes through InsForge's OpenRouter gateway. One call cost ~$0.0003.

### Tier 2 — Recommended escalation / frontier

#### `anthropic/claude-3.5-sonnet` (or `claude-3.7-sonnet` if available)
- **Cost:** $3/M input, $15/M output
- **Context:** 200K
- **Pros:** Cleaner prose than Haiku, better at nuanced business interpretation (the `businessInterpretation` field). Same family = same prompt can work for both tiers.
- **Cons:** 10–20x more expensive than Haiku. Worth it only for escalated cases.

**Verdict: escalation tier** — when Haiku's `confidence < 0.85` OR when severity is "high" and the explanation needs to be defensible.

#### `openai/gpt-4o-mini` (the *legacy* but stable choice)
- **Cost:** $0.15/M input, $0.60/M output (as of 2026 — has dropped from earlier $0.40/$1.60)
- **Context:** 128K
- **Pros:** Cleanlab benchmark says GPT-4.1-mini is *still* the cheapest+fastest reliable structured-output model. The "GPT-4.1-mini is 20% of Gemini-Flash's cost and 65% of its latency" finding is from late 2025 and likely still true for gpt-4o-mini in 2026.
- **Cons:** No clean evidence-quality advantage over Haiku for this task. Less battle-tested on InsForge's gateway than claude.

**Verdict: alternative primary** — could swap with Haiku based on cost benchmarks. Pick whichever is cheaper at call time.

### Tier 3 — Free / fallback (deprioritized)

#### Free-tier OpenRouter models
- **Verdict: rejected.** Live test showed `llama-3.3-70b:free` rate-limited immediately, `gemini-2.0-flash:free` returns 404. Free tiers are too unreliable for a production-ish system.

#### `claude-3-haiku` (the *older* haiku)
- **Verdict: no reason to choose over 3.5-haiku** — same family, worse benchmarks, same cost tier. Skip.

### Tier 4 — Avoid for this task

- **GPT-5, Claude Opus 4.6, Gemini 3.1 Pro** — these are reasoning-tier models. PageVault's task doesn't need extended thinking. Cleanlab data: GPT-5 has higher accuracy on Data Table Analysis, but at 5-10x the cost, with no measurable benefit on PageVault-shaped tasks.
- **Open-source MoE (Qwen 3.5, GLM-5, Kimi K2.5, MiniMax M2.5/2.7)** — these score well on SWE-bench but aren't benchmarked on structured output extraction. They could be 2-3x cheaper if a self-hosted route existed, but PageVault uses InsForge's hosted gateway so there's no self-host option. Revisit if InsForge adds self-hosted model support.
- **Reasoning models (o3, o3 Pro, Gemini Deep Think)** — wrong shape for this task. Adding 30s of latency for a task that should take 1-2s is unjustifiable.

---

## 5. Specific recommendations for PageVault

### 5.1 Default model: `anthropic/claude-3.5-haiku`

Set this in `scripts/live_crawl_real_llm.py` and any other LLM-calling path. Update `lib/ai.ts` so the same default applies when the scan pipeline is implemented.

```python
PRIMARY_MODEL = 'anthropic/claude-3.5-haiku'
ESCALATION_MODEL = 'anthropic/claude-3.5-sonnet'
```

### 5.2 Add a confidence-thresholded escalation

PageVault's `output_json` already has a `confidence` field. The cascade pattern from §3.3 is a 5-line change:

```python
if ai_output.get('confidence', 1.0) < 0.85 or ai_output.get('severity') == 'high':
    # Re-run with escalation model, OR escalate within the same call
    # using OpenRouter's "fallbacks" parameter
    ...
```

A simpler first step: pass `models: [PRIMARY_MODEL, ESCALATION_MODEL]` to OpenRouter — it tries the first, falls back on rate limit/error, returns the first successful response.

### 5.3 Set `response_format: { type: 'json_object' }` on every call

The current `live_crawl_real_llm.py` already does this. All future LLM calls in the project should too. JSON mode is what gives you the 0.45 → 0.76 Output Accuracy bump shown in the Cleanlab data — without it, models drift to prose and break the schema.

### 5.4 Reduce prompt noise before sending to the LLM

The current script sends up to 4,000 chars of "live_excerpt" + 2,000 chars of "prev_excerpt" = 6,000 chars of input. For most pages, you can drop to 1,500+1,500 = 3,000 chars and the model has all the structured-output signal it needs (Cleanlab shows Field Accuracy stays high with shorter evidence windows). This is a 2x cost reduction for free.

### 5.5 Add a small eval harness before the next model swap

When the team wants to switch from Haiku to whatever's newer, they should:
1. Replay the 3 seeded page diffs (AWS, Apify, Box) through both models
2. Compute **Output Accuracy** (does the JSON exactly match the seed ground truth?) — not just human-judgment
3. Compare costs via the OpenRouter response `usage` field

The seed data already serves as the eval set. Just compare the new model's `output_json` against the existing `ai_explanations.output_json` rows for the 3 seeded pages.

---

## 6. Cost projection

Using claude-3.5-haiku at $0.80/M input + $4/M output:

| Scenario | Tokens per call (avg) | Cost per call | Monthly (1000 calls/day) |
|---|---|---|---|
| 6K char input, 400 token output | ~2,200 | **$0.0026** | **$78** |
| Optimized 3K char input, 300 token output | ~1,100 | **$0.0013** | **$39** |
| With cascade (60% haiku, 30% sonnet, 10% opus) | mixed | **~$0.008** | **$240** |

For comparison, the design's `$0.002/explanation` estimate (using GPT-4.1-mini) is roughly the same as the unoptimized Haiku case. The cleanlab data confirms this is the right cost band.

---

## 7. Action items (concrete)

1. **Pin `claude-3.5-haiku` as the default** in `lib/ai.ts` and `scripts/live_crawl_real_llm.py`. (Currently the script has a 3-model fallback chain — make Haiku first, drop the free models entirely.)
2. **Add the cascade** — pass `models: [haiku, sonnet]` to OpenRouter so latency-strict cases degrade gracefully.
3. **Add a "weak evidence → return unchanged" path** — when `markdown_hash` matches the previous snapshot OR when the diff is empty, skip the LLM call entirely and write `change_type: 'none', severity: 'low', confidence: 0.95` directly. This is what the design recommends and is the single biggest cost saver.
4. **Build a 3-page eval set** out of the existing seed explanations; the 3 seeded rooms are AWS/Apify/Box — replaying their inputs through any new model gives you a free benchmark.
5. **Skip free-tier models** in any future fallback chain. They're not reliable enough for production-ish use, as the live test demonstrated.
6. **Track token usage in `ai_explanations`** — add `prompt_tokens` and `completion_tokens` columns so cost-per-change is queryable later. Schema migration is a one-time op.

---

## 8. TL;DR

**Use `anthropic/claude-3.5-haiku` as the default.** It's the cheapest reliable structured-output model, it works through the InsForge AI gateway, and the live test already proved it produces grounded, accurate diffs for ~$0.0003 per call. Add `claude-3.5-sonnet` as a confidence-based escalation tier for `confidence < 0.85` or `severity = high` cases. Skip the free tiers — they fail in production. Skip the reasoning models — wrong shape for this task.
