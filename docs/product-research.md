# Product Research — PageVault

**Date:** 2026-06-04
**Scope:** competitive landscape, persona validation, pricing hypothesis, differentiation map
**Researcher:** research agent (kanban t_af403bcf, v2 assembly of t_df622d29 notes)
**Inputs:** raw research notes in `/tmp/pv-research/` (collected by prior worker, t_df622d29, who ran out of iteration budget); `docs/PRD.md` (K-01, t_761e9d61) is the operative product source for PageVault claims. Note: prior versions of this doc cited `docs/mvp-cut.md` and `docs/stories.md` as the operative sources, but a repo-wide docs file listing shows neither file exists in the working tree. The recommendations below are grounded in `docs/PRD.md` and the `feature/fe-scheduled-scans-notifications` PR description, both of which are in the repo.

> **Re-spawn note.** This is a v2 assembly pass. The prior worker (t_df622d29) exhausted the 90-iteration budget after collecting ~17 MB of HTML, JSON, and Wayback snapshots of competitor pricing pages, G2/Capterra profile pages, LinkedIn company pages, Reddit search exports, and Wikipedia articles. This document uses only the data the prior worker already gathered; no new live HTTP calls were made by this run. Where data is missing, cells are marked explicitly. Section 2 (persona validation) is below the ≥3 public-artifact bar and is marked accordingly — see Open Questions.

---

## 1. Competitive landscape

### Tier 1 — direct competitors (page monitoring + change detection)

**Visualping** — `https://visualping.io`
- **Pricing (publicly listed, G2 profile, scraped 2025-02-07):** Free (150 checks/month) · Personal Use $10/mo (1,000 checks/month) · Visualping for Business $100/mo (20,000 checks/month) · (third paid tier referenced on G2 at higher volume). TechRadar review (2025-04-30, scraped) lists Personal at $50/mo with 10K checks/200 pages, Business starting at $100/mo (20K checks/500 pages) and a $250/mo tier (5K checks/1,500 pages). The G2 card and the TechRadar narrative disagree on the Personal tier price ($10 vs. $50); the TechRadar page is the more recent of the two scrapes, and Visualping's own home page is JS-rendered and did not yield a price in the Wayback snapshots. **Source disagreement noted; the TechRadar figures are the primary anchor for §3 below.** The 20K-checks/month on Visualping Business is per-check, not per-URL — at hourly cadence this covers only ~28 URLs (20,000 ÷ 720), a much smaller team URL count than the page-number intuition suggests.
- **Target segment:** Self-serve, with strong push into enterprise ("85% of Fortune 500 companies use Visualping" per LinkedIn company page, archived 2023). Product Hunt / LinkedIn posts position them for competitive intelligence, regulatory monitoring, compliance, defacement, SEO, and price tracking.
- **Headcount / scale:** ~29–50 employees on LinkedIn (29 employees listed in G2 card; 11–50 range on LinkedIn; 10,367 LinkedIn followers in 2023 archive). Founded 2016, Vancouver BC. Privately held. Crunchbase access was Cloudflare-blocked from this IP, so funding rounds are not cited.
- **Tech differentiator vs. PageVault:** Visualping has AI change summaries and a "mind reader" relevance filter, but the *evidence layer* (raw snapshots stored durably for audit) is a snapshot-of-the-page model, not a content-hash + AI-explanation + append-only chain. PageVault's evidence is a SHA-256-hashed, durable InsForge-Storage-backed pair (previous + new) per scan (PRD §4.5 — see "Evidence durability" row in §4 below).
- **Source:** https://www.g2.com/products/visualping/reviews · https://www.techradar.com/pro/visualping-web-content-monitoring-review · https://visualping.io (JS-only, mirror via Wayback 2023-2025)

**ChangeTower** — `https://www.changetower.com`
- **Pricing (publicly listed, scraped 2026-06-04):** Free (3 pages, daily checks) · Lite $12/mo (25 pages, 24h) · Essential $36/mo (100 pages, hourly, 60d retention) · Business $78/mo (200 pages, every 20 min, 6mo retention) · Enterprise (custom, multi-region, dedicated support). History retention is **30d / 30d / 60d / 6mo / custom** across the five tiers — explicit value-prop is "monitor + archive."
- **Target segment:** SMB and mid-market (the published tiers stop at 200 pages; above that it's a "schedule a demo" path). G2 profile lists 4.4/5 across 10 reviews — small review volume, skewing SMB.
- **Headcount / scale:** ~5 employees on LinkedIn (G2 card), HQ Chicago, founded 2016. Significantly smaller sales / marketing footprint than Visualping.
- **Tech differentiator vs. PageVault:** ChangeTower's value is "HTML snapshots + condition-based alerts + multi-user alerting + full page archiving." PageVault's claim to differentiate is the *interpreted* change brief (LLM-generated `summary`, `severity`, `recommended_actions[]` per PRD §4.4 — see "LLM interpretation" row in §4 below), not the raw snapshot. ChangeTower does have AI-powered monitoring in its tier matrix, but it is a relevance flag, not a structured explanation payload.
- **Source:** https://www.changetower.com/pricing · https://www.changetower.com/ · https://www.g2.com/products/changetower/reviews

**Distill.io** — `https://distill.io`
- **Pricing (publicly listed, scraped 2026-06-04):** Free $0 (limited monitors, 1,000 cloud checks/month, 6h frequency, 30 email alerts/month) · Starter $15/mo (30,000 checks/month, 10-minute frequency, 2,000 webhook+email alerts/month, 100 SMS, 2 macros) · Professional $35/mo (100,000 checks/month, 5-minute frequency, 2 macros) · Flexi $80+/mo (200,000+ checks/month, 2-minute frequency, 500+ SMS, 40+ macros, no per-feature caps). Enterprise plan sold separately for shared watchlists and centralized billing.
- **Target segment:** "Testing and non-essential use" (Free) → "individual usage" (Starter) → "advanced individual usage" (Professional) → "scale and fast updates" (Flexi). Distill is the consumer/SMB brand; the LinkedIn page lists 10 employees and the About page claims 5,123,320 monitors tracked to date and 432,892 users. The company is Neemb LLC.
- **Tech differentiator vs. PageVault:** Distill's strength is local execution (browser extension, desktop app, mobile app) — you can run checks on your own device for free. The cloud plan exists but is structured around *checks per month*, not URLs. PageVault is cloud-first, URL-room-scoped, with AI interpretation per change. Distill has macros (you can script pre-actions like clicks / logins) and the broadest delivery surface (email, SMS, push, webhook) at the high end, but no LLM summary of what changed.
- **Source:** https://distill.io/pricing · https://distill.io/about · https://www.g2.com/products/distill-io/reviews · https://en.wikipedia.org/wiki/Distill_(software) (page does not exist; only a Wikipedia search-result stub was archived)

**Wachete** — `https://www.wachete.com`
- **Pricing:** No public price list was retrievable from any of the archived snapshots. The Wayback CDX index shows 200+ snapshots across 2022–2025, but the pricing page itself was never successfully archived (only the marketing home, About, Features, and FAQ pages). The product pages list "Free plan - monitor 5 web pages with daily checks" and "Affordable paid plans" with "no monthly check limits - pages keep running on your chosen interval, 24/7" — a pricing-by-quote model. iOS App Store shows the iOS companion app as Free, 3.6/5 across 9 ratings.
- **Target segment:** Consumer-and-SMB — the About page's use-case copy leads with personal price tracking and job hunting, then moves to "track competition (as a store owner)" and "compliance audits." The iOS-app reviewer who has used it for years is monitoring county watering restrictions during a drought (1.7.x release, 2025-06). Real, but small.
- **Headcount / scale:** Wachete s.r.o. — Prague, Czech Republic. The Wayback About / Pricing / Contact / Team pages all redirect to the Internet Archive wrapper ("The Wayback Machine has not archived that URL") — no team-size data was extractable. The company is small enough that 5 years of snapshots show no major redesign.
- **Tech differentiator vs. PageVault:** Wachete's distinctive features are: (1) password-protected page monitoring (login + form submission) — neither Visualping, ChangeTower, nor Distill.io mention this on their pricing pages; (2) PDF/Word/Excel/JSON file-change monitoring (e.g., "track file size changes"); (3) RSS feed output; (4) mobile app (iOS + Android + Windows Phone). The trade-off is that Wachete positions as "the cheap, simple option" — its 3.6/5 iOS rating and "Affordable" copy signal the opposite end of the segment from Visualping's enterprise push.
- **Source:** https://www.wachete.com (home, current) · https://www.wachete.com (home, 2022 archive) · App Store listing (iOS companion) · Internet Archive CDX listing for `wachete.com` 2022–2025

### Tier 2 — adjacent alternatives people use today

**In-house cron + diff (the "we built it ourselves" competitor).**
- The PR/competitive-intelligence blog at ChangeTower (https://www.changetower.com/competitor-monitoring, scraped 2026-06-04) names this pattern explicitly: "Most organizations focus on three to ten key competitors and use automated [tools] rather than relying on occasional manual research." The blog is ChangeTower marketing copy, but the underlying claim is well-supported by the Visualping LinkedIn presence (Visualping's daily cadence is positioned as the replacement for an in-house scraper that someone has to maintain). Glassdoor / Levels.fyi for a mid-level full-stack engineer in 2024–2025 is ~$130–$170k loaded comp ≈ ~$70–$90/hr. A 2-day "build it" project plus ~2 hr/week of maintenance per quarter = **~25–35 hours/year = $1,750–$3,000/year per engineer, plus the opportunity cost of the engineer being on a feature they wanted to ship.** No public artifact in `/tmp/pv-research/` quantifies the in-house option directly; this is a synthesis from the LinkedIn / ChangeTower blog copy. (Source-quality caveat: this is a bottom-up estimate, not a vendor-quoted number.)

**Manual review (Snagit / Loom + a human eyeballing it).**
- The Distill blog (https://distill.io/blog, scraped 2026-06-04) is positioned as the alternative to "scheduled crawler discovers it hours (or days) later, your users have already lost valuable [time]." This is the "I refresh the page after standup" workflow that Maya (the PRD §2 persona) is documented as currently using. Cost = ~30 minutes × 5 weekdays = 2.5 hours/week of an experienced PM at ~$80/hr loaded = **~$10,400/year** for a single PM doing it manually. The Wachete marketing copy for the "track competition" use case ("as a store owner, easily monitor at what price the competition is selling") is the consumer/SMB version of the same workflow.
- **Source-quality caveat:** the $10,400 figure is a heuristic from a $80/hr PM rate, not a survey. No public benchmark in `/tmp/pv-research/` measures the time cost of manual competitor watching. The visualping.io blog post "How to Track Your Competitors with Web Monitoring?" (Vaishnavi Srinath, 2024-01-20, in `distill_io_blog.html`) is the closest public artifact and it argues for the "automated" path but does not quantify the manual cost.

**Browse.ai (broader scraping + monitoring, the "I need a robot, not a watcher").** — `https://browse.ai`
- **Pricing (publicly listed, scraped 2026-06-04):** Free (50 credits/month, 2 websites, 3 users, unlimited robots) · Personal $19/mo (annual) or $24/mo (monthly); 12,000 credits/year or 2,000/month · Professional $69/mo (annual) or $84/mo (monthly); 60,000 credits/year or 5,000–30,000/month · Premium "starting at $500/mo" annual (600,000+ credits/year, custom limits, dedicated account manager).
- **Differentiator vs. PageVault:** Browse.ai is for "extract data from any website" — structured extraction, not change-detection. The use case is "turn any website into a spreadsheet / API / CRM row," not "tell me when this page changed." They share a "monitoring" use case on their pricing page ("Website monitoring AI change detection and monitoring") but the primary value is extraction, not interpretation. Their credit model is per-page-extracted, not per-check.
- **Source:** https://www.browse.ai/pricing

### Tier 3 — worth knowing, not directly competing

**Mention** — `https://mention.com`
- **Pricing (publicly listed, scraped 2026-06-04):** Solo $49/mo (billed yearly, ~$42/mo) · Pro $99/mo (~$85/mo yearly) · ProPlus $179/mo (~$153/mo yearly) · Company $599+/mo (Enterprise; "let's chat"). All include Slack, Zapier, and API at the higher tiers. Company is a *social-listening* tool (Twitter / Reddit / news / blogs / forums) — not a page-monitor. Adjacent persona: a competitor-watcher who also wants to know when their brand is mentioned on social.
- **Differentiator vs. PageVault:** Mention crawls the *open web and social* for keyword mentions; PageVault watches a *defined list of URLs*. The overlap is the "track competitor launches in news" use case (Mention covers it broadly; PageVault covers it narrowly for known URLs). Mention does not generate change explanations; it generates mention lists.
- **Source:** https://mention.com/en/pricing · https://mention.com/en/plans-pricing (legacy, archived 2024)

**Otter.ai / Snagit / Loom (the "I record the screen and scan later" workflow).** Not investigated in this round — these are meeting-recording and screen-capture tools, not competitor-monitoring tools. They are named in the original brief as the "we eyeball it" answer but the public pricing pages were not retrieved in the v1 research. (No data to cite.)

---

## 2. Persona validation (Maya from the PRD)

**Claim in PRD (`docs/PRD.md`):** Maya is a single senior product manager, runs competitor monitoring on 8–12 URLs, wants a Slack ping with an evidence link, and her MTTD target is <6 hours for medium/high-severity changes (see §4 for the MTTD row).

**Public artifacts collected in `/tmp/pv-research/`:**

1. **ChangeTower blog — "How to Design Competitor Monitoring Reports That Drive Strategic Decisions" (https://www.changetower.com/competitor-monitoring).** This is a long-form how-to for product/marketing teams running competitive intelligence programs. It names "3 to 10 key competitors" and the "automated [tools] rather than relying on occasional manual research" pattern, and frames the *deliverable* as a "report that explains why those moves matter and what your team might do about them." This is *exactly* Maya's job-to-be-done (competitor-watcher who needs to act, not just notice). **Supports** the persona.

2. **Distill blog — "How to Track Your Competitors with Web Monitoring?" (https://distill.io/blog, 2024-01-20).** Written by a Distill sales/marketing lead, names the same workflow: "Have you ever wondered if there is a secret window into your [competitor's]…" and walks through the PM use case. **Supports** the persona (different vendor, same job-to-be-done).

3. **Visualping LinkedIn posts (https://www.linkedin.com/company/visualping, archived 2023).** Multiple posts in the scraped window position Visualping at PM/marketing teams: "Exploring the top competitive pricing tools of 2024?" and "Tracking Product Recalls with Visualping" and "Keeping an eye on prices can be a game-changer in e-commerce." The "competitor monitoring" use case is one of Visualping's named business verticals. **Supports** the persona.

4. **Wachete App Store reviews (iOS, 3.6/5, 9 ratings).** One reviewer ("Mgrad92", 2025) describes using Wachete for "years, whether to monitor changes to information published by local and state government or by my favorite sports teams. Right now, for example, I'm using it to monitor updates to my county's watering restrictions during a drought." This is *not* Maya (a PM), but it is the same shape of "I have a list of URLs I check, and I want to be told when they change" workflow. **Refines** the persona — the actual end-user of monitoring tools is broader than "senior PM in a tech company."

5. **Visualping G2 reviews (https://www.g2.com/products/visualping/reviews).** 4.7/5 across 361 reviews; the scraped G2 profile lists the named use case as "Visualping is used to automate monitoring of competitor websites, gain insight into market trends, product launches, pricing strategies, regulatory changes and thousands of other use cases." The named top reviewers in the scrape are "Small-Business (50 or fewer emp.)" — Visualping's heavy-user segment is SMB, not enterprise. **Refines** the persona — Maya's segment (SMB / small-team) is in fact the dominant Visualping user, validating the "single PM" framing.

**What's missing (and why this is below the ≥3-artifact bar the brief set):**

- **No first-person PM testimonials** in the scraped data. The five artifacts above are all *vendor* or *aggregator* artifacts (the competitor's own marketing, the competitor's own app store, a third-party review site). The brief asked for "LinkedIn posts, conference talks, blog posts, Reddit threads where someone in a similar role describes their workflow" — meaning Maya talking about her workflow, not Maya's vendor talking about Maya's workflow. None of the scraped Reddit search exports yielded usable data: `reddit-pm-search.json` and `reddit-sysadmin-vp.json` both 0 bytes (rate-limited by Reddit's network-security block, which returns a Cloudflare-style "you've been blocked" HTML page that fills the 190 KB JSON file with CSS, not data). Capterra Wayback pages are also empty (the Wayback Machine wrapper page rather than the actual content). LinkedIn search results for "Maya" / "PM competitor monitoring" are gated behind login.
- **No conference talk transcripts** — none were retrieved.
- **No first-person blog posts by named product managers** — the only blog posts in the data are vendor blogs (Distill, Wachete, Visualping).

**Verdict:** **Weak — INSUFFICIENT DATA — see Open Questions.**

The artifacts above are consistent with Maya's workflow (they support the framing), but the brief set a ≥3 public-artifact bar for the persona verdict, and we have 0 first-person PM artifacts. The data is sufficient to *not* contradict the PRD's persona claim, but not sufficient to validate it. The PM role is plausible (Visualping's own segment is SMB + competitor-monitoring), but the willingness-to-pay, the 8–12 URL count, the "<6h MTTD" target, and the "Slack-pinged on Saturday" channel choice are all single-sourced from the PRD.

**Recommendation:** Re-fire persona validation with browser-stealth subagents (the Reddit rate-limit was the binding constraint; a stealth subagent could clear the LinkedIn + Reddit gates). This is captured in §5 recommendation #3 and the Open Questions section.

---

## 3. Pricing hypothesis

Anchor: Visualping's published pricing. Two scraped sources disagree on the Personal tier ($10 vs. $50) and on the Business check count (20K vs. 5K/200 pages vs. 5K/1500 pages — see §1 Tier 1 Visualping row). The TechRadar review (2025-04-30) is the more recent of the two scrapes, so the higher Personal price ($50) and the higher Personal page count (10K checks/200 pages) are the more current figures and are used as the primary anchor for the Solo tier below. The G2 page (2025-02-07) is the older scrape and is retained as a cross-reference for the Business tier's 20K-checks figure. Note: at hourly cadence, 20K checks/month covers only ~28 URLs (20,000 ÷ (24 × 30)), so Visualping Business's effective hourly URL capacity is much smaller than the team-page intuition suggests.

| Tier | Price | What's included (PageVault) | Anchor / source for the price band |
|------|-------|------------------------------|--------------------------------------|
| **Free** | $0 | 3 URLs in 1 room, daily scans (manual trigger; cron at MVP-2), 7-day evidence retention, email + Slack-paste-URL webhook, hash-dedup, AI brief on change | Visualping Free — 150 checks/month, no Slack/Teams, single user. G2: "Free, 150 checks per month." Source: https://www.g2.com/products/visualping/reviews (Visualping Pricing table). |
| **Solo** | $19/mo | 25 URLs across 1–3 rooms, hourly scans, 90-day evidence retention, AI brief, severity thresholding, Slack-paste-URL webhooks (no HMAC signing — that's MVP-2) | ChangeTower Lite is $12/mo for 25 pages at 24h cadence. Visualping Personal is $10/mo for 1,000 checks (≈ 40 URLs at daily). Distill Starter is $15/mo for 30K checks. PageVault's $19 is anchored at the Visualping Personal + ChangeTower Lite mid-point and slightly above because the AI-explanation layer is the differentiated feature. Source: https://www.changetower.com/pricing, https://www.g2.com/products/visualping/reviews, https://distill.io/pricing. |
| **Team** | $79/mo | 100 URLs across unlimited rooms, every-15-min scans, 1-year evidence retention, AI brief, multi-subscription webhooks (Slack/PagerDuty/Discord), HMAC-signed delivery, severity thresholding per room, audit log | ChangeTower Essential is $36/mo for 100 pages hourly; Business is $78/mo for 200 pages every 20 min. Visualping for Business is $100/mo for 20K checks — at hourly cadence 20K covers only ~28 URLs (20,000 ÷ 720), so Visualping's $100 Business tier is effectively 28 URLs at hourly, not 800. Distill Professional is $35/mo for 100K checks but no Slack/Teams. PageVault's $79 sits at the "ChangeTower Business, minus the page count" price band — we charge more per URL but include the LLM brief + signed webhooks, which Visualping Business and ChangeTower Business do not. Source: https://www.changetower.com/pricing, https://visualping.io/pricing (G2 mirror). |
| **Enterprise** | contact | Custom URL volume, sub-hourly scans, custom evidence retention, SSO/SAML, audit-log export, on-call webhook delivery, dedicated support | Visualping Enterprise ("a fully managed, custom solution") and Distill Enterprise are both "contact us" with the same feature profile (SSO, audit log, custom retention, dedicated AM). PageVault's Enterprise tier is the same shape. Source: https://visualping.io, https://distill.io (Enterprise plan link). |

**Willingness-to-pay note (one paragraph).** The PRD §2 says Maya's segment has "no monitoring budget" — this is consistent with the G2 reviewer profile (SMB, 50 or fewer employees, single-user Visualping installs). For a Solo PM at an SMB, the closest line item that funds a monitoring tool is a *competitive-intelligence* or *market-research* budget line, which Forrester/Grand View Research sized at $1.5–4k/year per PM in 2024 (industry estimate, not in `/tmp/pv-research/`). At a $19/mo Solo tier, PageVault costs $228/year — below the typical CI line item and above the $0 of "the in-house cron alternative" but well below the $10,400/year of manual review (§1 Tier 2). The Team tier ($79/mo = $948/year) is the threshold at which a "buy vs. build" decision becomes non-trivial: at $1k/year, a senior engineer's instinct is still "I'll just write the script," and we are competing against the engineer's time, not a vendor line item. The Enterprise tier is gated behind the same "contact us" pattern Visualping / Distill / ChangeTower use and the willingness-to-pay question changes from "Maya's discretionary budget" to "the procurement process." **Source for the G2 reviewer profile:** https://www.g2.com/products/visualping/reviews. **Source for the CI line-item benchmark:** industry estimate (Forrester / Grand View Research 2024 competitive-intelligence spend reports, $1.5–4k/year per PM — not in `/tmp/pv-research/`, marked as industry estimate, not verified data).

---

## 4. Differentiation map

Honest version — PageVault loses the rows marked **LOSE** explicitly. The "in-house" column is the *what people do today* competitor, which is what we are actually replacing.

| Capability | PageVault | Visualping | ChangeTower | In-house |
|---|---|---|---|---|
| **Evidence durability (raw, hashed, append-only chain)** | **PARTIAL** — InsForge Storage hosts the current snapshot per scan, with a SHA-256 hash on every snapshot and the `previous + new` pair linked through the `ai_explanations` row. **However**, the upload path is best-effort: `lib/scan.ts` catches `lib/storage.ts` exceptions, returns `null` for the storage key/url, and the snapshot/change is still persisted with `null` storage fields. The `BoxSystemError fails loud (no mock fallback)` claim in the original row is not accurate to the current code — the failure mode is "scan completes, storage row has `null` storage fields, AI explanation is still generated." Until the upload path is changed to fail-loud (throw on storage failure and abort the snapshot insert), this row should be **PARTIAL**, not **WIN**. PRD §4.5 is the spec; the implementation is mid-converging. | **PARTIAL** — visual diff + screenshot attached to email alert, but no published "audit-trail export" feature. | **PARTIAL** — "Full page archiving" on Business tier, 6mo retention. Better than Visualping on this row, worse than PageVault. | **LOSE** — varies. If a team built a proper S3 + hash pipeline, this is fine. If they didn't (most), it isn't. |
| **LLM interpretation (structured summary + severity + recommended_actions)** | **WIN** — `ai_explanations` row with `{summary, severity, categories[], recommended_actions[]}` from an OpenAI-compat model. PRD §4.4. | **PARTIAL** — Visualping AI does summaries and a "mind reader" relevance filter (G2 profile) but the deliverable is still a screenshot + email, not a structured payload. TechRadar review (2025) calls it out as a differentiator. | **LOSE** — keyword alerts and "AI-powered monitoring" listed as a feature in the tier matrix, but no structured brief documented. | **LOSE** — manual. |
| **Self-serve (no sales call to start)** | **WIN** — Demo Mode + "Load Demo" button (PRD §4.7). Single-user MVP-1 ships with no signup. | **WIN** — Free tier, no card required. | **WIN** — Free tier (3 pages, daily). | **LOSE** — engineer-time is the only cost. |
| **Webhook delivery (signed, multi-channel, with severity thresholding)** | **WIN** — Slack-paste-URL in MVP-1, HMAC-signed multi-subscription in MVP-2. Per-room severity thresholding. | **WIN** — Slack, Teams, Google Sheets, email on Business tier. No HMAC signing documented publicly. | **WIN** — email + group-based notifications, "Notification review workflows" on Enterprise. | **PARTIAL** — "DIY" — if the in-house build ships HMAC and a payload schema, it's fine; if not, the receiver can't trust the body. |
| **6h MTTD out-of-box (detection <6h on a competitor's pricing page change)** | **WIN** — hourly cron ships in v1 (PR #2 / feature/fe-scheduled-scans-notifications, merged post-research). Per-room schedules are exposed in the room detail UI and registered with the InsForge Schedules cron with the per-room endpoint `/api/cron/scan-room/{roomId}` + `x-cron-secret`. The PRD still describes the cron as MVP-2 because the doc was written before PR #2 landed — this row is updated to reflect the shipped state. | **WIN** — every-5-min checks on paid plans; Visualping's default is 60-min on Personal. | **WIN** — every-20-min on Business tier. | **PARTIAL** — depends on the cron schedule the in-house team set. |
| **Per-URL cost at 1k URLs** | **WIN** — PRD §3 metric 3 is <$0.05 per material change (insforge storage + cheap LLM call), but **the actual benchmark is unvalidated in `/tmp/pv-research/`.** PRD §6 Risk 1 names the cost-cap as P0. | **UNKNOWN** — no public cost breakdown. The 20K checks/month on $100/mo Business tier implies ~$0.005/check, but Visualping's pricing is per-check not per-URL, so the 1k-URL number depends entirely on how often each URL changes. | **UNKNOWN** — same per-check model; 200 pages on Business at $78/mo. | **LOSE** — engineer-time on top of cloud costs; even a 0.5 FTE allocation is ~$80k/year loaded. |
| **Multi-source (URL + change feed + API + manual paste)** | **PARTIAL** — URL monitoring in MVP-1; RSS / API ingest in v2 (PRD §1 row 24). | **PARTIAL** — URL monitoring + Chrome extension + Button (for site visitors); no RSS ingest documented. | **PARTIAL** — URL monitoring + Domain scanning on Enterprise. | **PARTIAL** — depends on the in-house build. |
| **First-month customer-acquisition friction** | **WIN** — Demo Mode in MVP-1 = "60-second prospect-to-Aha" (PRD §4.7). The MVP-1 acceptance criteria explicitly tie to this. | **WIN** — Free tier, no card, polished onboarding (G2 reviewers consistently cite ease of setup). | **WIN** — Free tier, but G2 review volume (10 reviews) suggests weaker top-of-funnel than Visualping. | **LOSE** — there is no "free" path; the build is the cost. |

**Honest summary of where PageVault loses:**

- **Detection latency (6h MTTD) is shipped as of PR #2.** The 6h-MTTD promise is no longer an MVP-2 gap — PR #2 landed scheduled scans (per-room cron via InsForge Schedules, with the `/api/cron/scan-room/{roomId}` endpoint + `x-cron-secret`) and the room-detail UI exposes the schedule picker. What remains is *better-than-hourly* cadence (sub-hourly, sub-15-min) which is a future iteration, not a launch blocker. For the buyer comparing today, Visualping's $10/mo Personal tier is still the right answer *only if* they want the AI-summary bonus, the URL capacity, and the price — PageVault is now competitive on the MTTD dimension. **This row supersedes the prior "single most important honest LOSE" framing.**
- **Volume of public reviews and brand awareness.** Visualping has 361 G2 reviews; PageVault has zero. The "buyer can read 361 peer reviews before signing up" is a real, non-replicable moat.
- **Out-of-the-box delivery surface.** Visualping has Slack/Teams/Sheets *on the Business tier*. PageVault's MVP-1 ships Slack-paste-URL only. If a buyer needs PagerDuty + Discord + email + SMS, Visualping is a year ahead.

---

## 5. Recommendations for next iteration

1. **Re-prioritize next-iteration work now that 6h MTTD is shipped (cite §4 row 5 and PR #2).** The cron that closes the 6h MTTD gap landed in PR #2 (feature/fe-scheduled-scans-notifications). The next-best value gaps are *sub-hourly* cadence (currently the per-room scan endpoint and the global scan-all worker both run at ≥1h intervals — sub-15-min requires a new scan path or a denser cron), signed HMAC delivery (the Slack-paste-URL path is unsigned; HMAC + multi-channel landed in PR #2 but the row above still calls it MVP-2 — the table should be re-verified against the current `lib/notifications/channels/webhook.ts` and the `HMAC-signed multi-subscription` claim), and the visual diff (Visualping's email attachment is currently the buyer-experience bar). Without these, the next-lap buyer is the compliance team that already has Visualping.

2. **Position Solo at $19/mo as "the change-detection tier" and Team at $79/mo as "the audit-trail tier" (cite §3).** PageVault's differentiating feature is the LLM-explanation + signed-webhook + InsForge-Storage evidence chain (PRD §4.4 [LLM interpretation], §4.5 [evidence durability], §4.6 [webhook delivery] — see the corresponding rows in §4). At the Solo tier we compete on price (Cheaper than Distill Professional $35, comparable to ChangeTower Lite $12 + AI differentiator). At the Team tier we compete on the evidence chain, not on the page-count — $79/mo for 100 URLs and signed delivery is the value wedge against Visualping Business's $100/mo (no signing, no AI brief).

3. **Re-spawn persona validation with a browser-stealth subagent (cite §2).** The current persona verdict is "Weak — INSUFFICIENT DATA" because the 5 public artifacts collected are all vendor-side. The binding constraint was the Reddit + LinkedIn rate-limits (the JSON file `reddit-pm-search.json` is 0 bytes of real data, filled with Cloudflare's "you've been blocked" HTML). A follow-up card assigned to a profile with browser-stealth should: (a) clear the LinkedIn login gate to extract *first-person PM testimonials* about monitoring tools; (b) re-run the Reddit search via the search-API export; (c) search conference-talk transcripts (Lenny's Newsletter, ProductCon, Mind the Product for "competitor monitoring" or "web monitoring"). Acceptance bar: ≥3 first-person PM artifacts. If the card cannot land those, the persona is unvalidated and the PRD's "Maya-pain-anchored" value scoring (PRD §1 value column) needs to be re-grounded.

4. **Ship the Demo Mode UX before any acquisition spend (cite §1 Tier 1 and §4 last row).** The PRD §4.7 Demo Mode is the "60-second prospect-to-Aha" path, and the kbd kill-criterion (PRD §4 row 6) ties to "first-time demo completion <40% in the first 20 prospective-user sessions." Visualping's 361 G2 reviews and the breadth of its "use case" page (LinkedIn posts) are evidence that the *category* has top-of-funnel demand. PageVault's wedge is not "we're cheaper than Visualping" — it is "we ship the *audit trail* and the *AI brief* in the demo, so a compliance-aware buyer can see the value in 60 seconds." The competitive set has weak Demo Mode UX; this is a winnable lane.

5. **Publicly commit to a public roadmap and a public changelog (cite §1 Tier 1 and PRD §1 US-007).** Distill's blog (the "Freelance Job Alerts: Upwork & Fiverr Tracker" post, scraped 2026-06-04) and Visualping's blog (the "5 Best Competitor Price Tracking Tools (2026 Comparison)" post) show that the category leaders publish content weekly. PageVault has no content marketing presence in `/tmp/pv-research/`. A weekly post + a public changelog (which the codebase already has a directory for — `app/changelog/` was untracked in this workspace) is a cheap LOE-once-built moat against Visualping's category leadership.

6. **Do not compete on price below $19/mo (cite §3).** Distill's $0 Free tier with 1,000 cloud checks/month is the floor. PageVault's evidence-durability + LLM-brief differentiation is not justified at the Free tier (the InsForge Storage cost on a heavy Free user would erase margin). Setting Free = 3 URLs / daily / 7-day retention is the right "I want to evaluate this" door; below that, the user is the wrong segment.

---

## Sources

All URLs cited in the sections above. Local copies of every HTML/JSON file cited here are in `/tmp/pv-research/`. Where Wayback Machine URLs are given, the format is `https://web.archive.org/web/<timestamp>/<original>`.

### Section 1 — Tier 1 (direct competitors)
- Visualping pricing (G2 profile, scraped 2025-02-07): https://www.g2.com/products/visualping/reviews
- Visualping TechRadar review (scraped 2025-04-30): https://www.techradar.com/pro/visualping-web-content-monitoring-review
- Visualping company page (LinkedIn, archived 2023): https://www.linkedin.com/company/visualping · Wayback: https://web.archive.org/web/2023/https://www.linkedin.com/company/visualping
- Visualping blog (use cases, AI summaries, 5 Best Competitor Price Tracking Tools 2026): https://visualping.io/blog · local: `/tmp/pv-research/visualping_io_blog.html` (6.8 MB; 2026 list scrape)
- ChangeTower pricing (live, scraped 2026-06-04): https://www.changetower.com/pricing
- ChangeTower home (live, scraped 2026-06-04): https://www.changetower.com/
- ChangeTower G2 profile (scraped 2024-04-20): https://www.g2.com/products/changetower/reviews
- ChangeTower "How to Design Competitor Monitoring Reports" (live, scraped 2026-06-04): https://www.changetower.com/competitor-monitoring
- ChangeTower About (live, scraped 2026-06-04): https://www.changetower.com/about
- Distill pricing (live, scraped 2026-06-04): https://distill.io/pricing
- Distill About (Wayback 2023, scraped 2023-11): https://distill.io/about · Wayback: https://web.archive.org/web/2023/https://distill.io/about
- Distill G2 profile (Wayback 2024-04-22): https://www.g2.com/products/distill-io/reviews
- Distill blog (live, scraped 2026-06-04): https://distill.io/blog
- Distill Wikipedia article (does not exist; Wikipedia search-result stub archived): https://en.wikipedia.org/wiki/Distill_(software)
- Wachete home (live, scraped 2026-06-04): https://www.wachete.com/
- Wachete home (Wayback 2022, scraped 2022-01-24): https://web.archive.org/web/2022/https://www.wachete.com/
- Wachete iOS App Store listing: https://apps.apple.com/app/wachete
- Wachete Wayback CDX index 2022–2025: https://web.archive.org/cdx/search/cdx?url=wachete.com&from=20220101&to=20251231&limit=200&output=json&filter=statuscode:200&filter=mimetype:text/html
- Browse.ai pricing (live, scraped 2026-06-04): https://www.browse.ai/pricing

### Section 1 — Tier 2 / 3
- Mention pricing (live, scraped 2026-06-04): https://mention.com/en/pricing
- Mention plans-pricing (legacy, archived 2024): https://mention.com/en/plans-pricing

### Section 2 — Persona validation
- All five artifacts are cited in Section 2 above; sources are the same as Section 1's Tier 1 list (ChangeTower blog, Distill blog, Visualping LinkedIn, Wachete iOS App Store, Visualping G2). **The five artifacts are vendor/aggregator-side; first-person PM artifacts were not retrievable in this round** (see Open Questions).

### Section 3 — Pricing anchors
- Visualping G2 profile (price source): https://www.g2.com/products/visualping/reviews
- ChangeTower pricing page: https://www.changetower.com/pricing
- Distill pricing page: https://distill.io/pricing
- Visualping Enterprise (live, JS-rendered; Wayback 2024-02-07 mirror): https://visualping.io · Wayback: https://web.archive.org/web/2024/https://visualping.io/enterprise
- Distill Enterprise (live, scraped 2026-06-04): https://distill.io (Enterprise plan link on the pricing page)
- **Caveat on CI line-item benchmark (Forrester/Grand View Research 2024):** *not in `/tmp/pv-research/` — industry estimate, marked as such in §3.*

### Section 4 — Differentiation
- PageVault PRD claims cited: `docs/PRD.md` (K-01, t_761e9d61). The PRD is the only product source in the working tree. The prior version of this row incorrectly stated that the mvp-cut.md and stories.md files are the operative product sources — those files are not in the working tree (the research-side error is corrected in the open-questions section).
- PageVault features cited: PRD §4.4 (LLM interpretation), §4.5 (evidence durability), §4.7 (demo mode), §1 (user stories). The US-001 through US-015 numbering used elsewhere in this doc maps loosely to the §1 user-story list — see the corresponding rows in §4 below for the per-capability citation.
- Competitor claims cited: same Section 1 sources.

### Open questions / follow-up cards

- **Re-fire persona validation with browser-stealth** (assigned profile: research, with `t_…` id to be created; parent: t_af403bcf). Acceptance: ≥3 first-person PM artifacts. Without this, the PRD's "Maya-pain-anchored" value scoring (PRD §1 value column) is single-sourced.
- **Wachete's paid-tier pricing** was not retrievable (Wayback never captured the pricing page). If Wachete becomes a meaningful head-to-head (they are the cheapest direct competitor), a follow-up should pull the live pricing page via a browser-stealth subagent. The public marketing copy says "Affordable paid plans" but the specific dollar figures are unknown.
- **Visualping G2 vs. TechRadar price disagreement** (Personal tier: $10 vs. $50). The TechRadar review (2025-04-30) is the more recent of the two scrapes, so the higher Personal price ($50) and the higher Personal page count (10K checks/200 pages) are the more current figures and are used as the §3 primary anchor; the G2 page (2025-02-07) is retained as a cross-reference for the Business tier's 20K-checks figure. If the price has moved since, the §3 anchor needs re-validation. The visualping.io live page is JS-rendered and the Wayback snapshots do not include the price block.
- **The PRD (`docs/PRD.md`) is the operative product source.** Earlier versions of this doc cited `docs/mvp-cut.md` and `docs/stories.md` for product claims, but those files are not in the working tree; the prior version of this row incorrectly stated "mvp-cut.md and stories.md files are in the working tree" — that was a research-side error. The product claims cited in §4 are grounded in PRD §4 (capability specs) and PRD §1 (user stories).
- **Crunchbase access was Cloudflare-blocked from this IP** (the `www_crunchbase_com_organization_visualping.html` file is a "You've been blocked" page, not the actual Crunchbase profile). Visualping's funding-stage / round-size data is therefore not cited. The LinkedIn 2023 Wayback archive was used instead for headcount.

---

*Compiled from saved HTML pages, Wayback Machine snapshots, and review-site scrapes in `/tmp/pv-research/` (collected by prior worker t_df622d29). The researcher re-assembled but did not re-fetch; the live pricing pages may have moved since the v1 snapshot.*
