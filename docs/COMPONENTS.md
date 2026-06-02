# Component Reference

> **Last updated:** 2026-06-02 · view this against commit `3b0f2ca` for accuracy.
> **Source of truth:** [`components/`](../components/). This doc is a
> reference; for design rationale see
> [`app/globals.css`](../app/globals.css) and the live mocks.

## Tree

```
components/
├── dashboard/                    Domain components (used in /dashboard/*)
│   ├── AIInsightCard.tsx         Editorial AI summary card
│   ├── AppShell.tsx              Sidebar + TopBar + content
│   ├── DiffViewer.tsx            Before/After diff with evidence list
│   ├── NotificationList.tsx      CRUD UI for webhook subscriptions
│   ├── SchedulePicker.tsx        Cron schedule editor
│   ├── SeverityBadge.tsx         severity → styled badge
│   ├── Sidebar.tsx               Persistent nav
│   ├── StatCard.tsx              Single-metric card
│   ├── Stepper.tsx               Multi-step indicator
│   └── TopBar.tsx                Header bar with search, run-scan, user menu
├── providers/                    React context providers
│   └── SessionProvider.tsx       NextAuth session wrapper
└── ui/                           Primitives — every screen composes these
    ├── Badge.tsx
    ├── Button.tsx
    ├── Card.tsx
    ├── Input.tsx                 (also exports Textarea)
    ├── Primitives.tsx            (Checkbox, EmptyState, Tabs, SectionHeader,
    │                              Spinner, Progress, Toggle, Tooltip, VisuallyHidden)
    ├── Select.tsx
    └── Toast.tsx
```

---

## Dashboard components

### `<AppShell>`

**File:** `components/dashboard/AppShell.tsx`

The frame for every dashboard page: a left sidebar (workspace + nav) and
a top bar (search, run scan, user menu). The children render in the
main content area.

```tsx
import { AppShell } from '@/components/dashboard/AppShell';

<AppShell>
  <h1>Page content here</h1>
</AppShell>
```

**Props:** `{ children: ReactNode }`.

**Used by:** `app/dashboard/layout.tsx`.

---

### `<Sidebar>`

**File:** `components/dashboard/Sidebar.tsx`

Persistent left nav. Reads `usePathname()` to highlight the active item.
Renders workspace links (Overview, Memory Rooms, Changes, Reports) and
system links (Activity Log, Settings) plus a vault-capacity indicator.

**Props:** none.

**Used by:** `<AppShell>`.

---

### `<TopBar>`

**File:** `components/dashboard/TopBar.tsx`

Header bar: a search box (`⌘K` shortcut), the "Run Scan" button, the
notifications bell, and the user menu (sign out). Calls `useSession()`
from `next-auth/react`.

**Props:**
```ts
interface TopBarProps {
  onRunScan?: () => Promise<void>;
  scanning?: boolean;
  title?: string;
}
```

**Used by:** `<AppShell>`.

---

### `<StatCard>`

**File:** `components/dashboard/StatCard.tsx`

A single-metric card. Renders the label, value, optional trend
(up/down/neutral), and an optional caption underneath.

```tsx
import { StatCard } from '@/components/dashboard/StatCard';
import { Globe } from 'lucide-react';

<StatCard
  label="URLs watched"
  value={12}
  icon={Globe}
  trend="up"
  trendValue="+3 new"
  caption="last 7d"
/>
```

**Props:**
```ts
interface StatCardProps {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  icon?: LucideIcon;
  caption?: string;
  unit?: string;
}
```

**Used by:** `app/dashboard/page.tsx`, `app/dashboard/rooms/[roomId]/page.tsx`.

---

### `<SeverityBadge>`

**File:** `components/dashboard/SeverityBadge.tsx`

Maps `severity` → a `<Badge>` with the right color. The **inverse** of
`<Badge variant="...">` — use this when you have a `severity` value and
want a color-coded pill without thinking about which color goes with
which severity.

```tsx
import { SeverityBadge } from '@/components/dashboard/SeverityBadge';

<SeverityBadge severity="high" />             // "● High" in ember
<SeverityBadge severity="medium" withLabel={false} />  // just the dot
```

**Props:**
```ts
interface SeverityBadgeProps {
  severity: 'high' | 'medium' | 'low';
  withLabel?: boolean;  // default true
}
```

**Used by:** every screen that lists changes (overview, room detail,
activity feed, change detail).

---

### `<DiffViewer>`

**File:** `components/dashboard/DiffViewer.tsx`

Renders a list of before/after evidence pairs with a brief explanation
under each. Toggles between "Side-by-side" and "Unified" view.

```tsx
import { DiffViewer } from '@/components/dashboard/DiffViewer';

<DiffViewer evidence={[
  { before: '$24.00', after: '$26.88', explanation: '12% list-price increase' },
  { before: '5 SKUs', after: '3 SKUs', explanation: 'restructured business tier' },
]} />
```

**Props:**
```ts
interface DiffViewerProps {
  evidence: {
    before: string;
    after: string;
    explanation?: string;
  }[];
}
```

**Used by:** `app/dashboard/changes/[changeId]/page.tsx`.

---

### `<AIInsightCard>`

**File:** `components/dashboard/AIInsightCard.tsx`

A card for surfacing LLM-generated insights on a dashboard surface.
Used when you want a more "magazine-spread" treatment than the inline
`.ai-brief` editorial section in `app/dashboard/page.tsx`.

**Props:**
```ts
interface AIInsightCardProps {
  title: string;
  subtitle?: string;
  insights: string[];
  confidence: number;
  icon?: 'brain' | 'trending' | 'alert' | 'sparkles';
  children?: ReactNode;
  stamp?: string;
}
```

**Used by:** room detail (informational sub-card), change detail
(secondary insights section).

---

### `<SchedulePicker>`

**File:** `components/dashboard/SchedulePicker.tsx`

Cron schedule editor. Exposes a `SchedulePreset` enum and the
`SchedulePicker` component.

```tsx
import { SchedulePicker, SchedulePreset } from '@/components/dashboard/SchedulePicker';

<SchedulePicker
  roomId={room.id}
  initial={SchedulePreset.Every6Hours}
/>
```

**Exports:**
- `SchedulePicker` — the form
- `SchedulePreset` — `Every15Minutes | Every30Minutes | EveryHour | Every6Hours | Daily | Weekly | Custom`

**Used by:** room detail page.

---

### `<NotificationList>`

**File:** `components/dashboard/NotificationList.tsx`

CRUD UI for webhook subscriptions on a room. Lists existing
subscriptions with threshold, last-sent time, failure status; has an
"Add new" form (URL + optional HMAC secret + threshold); has a "Test"
button per subscription and a "Delete" button with confirm. Disables
subscriptions with `consecutiveFailures >= 10`.

**Exports:**
- `NotificationList` — the list + add form
- `NotificationSubscriptionView` — the read-only view used in modals

**Props for `NotificationList`:** `{ roomId: string }`.

**Used by:** room detail page.

---

### `<Stepper>`

**File:** `components/dashboard/Stepper.tsx`

Multi-step indicator. Used in the new-room flow.

**Props:**
```ts
interface StepperProps {
  steps: { id: number; label: string; description?: string; code?: string }[];
  currentStep: number;
}
```

**Used by:** `app/dashboard/rooms/new/page.tsx`.

---

## UI primitives

### `<Badge>`

**File:** `components/ui/Badge.tsx`

The base badge primitive. Five variants: `signal` (teal), `ember`
(red), `ink` (black), `paper` (cream), `outline` (border only). Two
sizes: `sm`, `md`. Optional `dot` prop renders a leading colored dot.

```tsx
import { Badge } from '@/components/ui/Badge';

<Badge variant="signal" dot>Live</Badge>
<Badge variant="ember" size="sm">Critical</Badge>
<Badge variant="paper">Pricing</Badge>
```

**Props:**
```ts
interface BadgeProps {
  children: ReactNode;
  variant?: 'signal' | 'ember' | 'ink' | 'paper' | 'outline';
  size?: 'sm' | 'md';
  dot?: boolean;
  className?: string;
}
```

> **Color semantics:** `ember` = warning/severity, `signal` = active/AI,
> `ink` = neutral/strong, `paper` = soft/categorical. Don't use `ember`
> for "active" or `signal` for "danger".

---

### `<Button>`

**File:** `components/ui/Button.tsx`

The base button. Six variants: `primary` (solid ink), `secondary`
(outline), `ghost` (no border), `outline` (thin border), `danger` (red
fill), `link` (no chrome). Three sizes: `sm`, `md`, `lg`. Supports an
icon, a trailing icon, and a `loading` state that shows a spinner.

```tsx
import { Button } from '@/components/ui/Button';
import { Plus } from 'lucide-react';

<Button icon={<Plus className="w-4 h-4" />}>New room</Button>
<Button variant="secondary" loading={scanning}>Run scan</Button>
<Button variant="ghost" size="sm">Cancel</Button>
```

**Props:** extends `ButtonHTMLAttributes<HTMLButtonElement>` plus:
```ts
{
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'link';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;        // leading
  iconRight?: ReactNode;   // trailing
  loading?: boolean;
}
```

---

### `<Card>`, `<CardHeader>`, `<CardTitle>`, `<CardSubtitle>`

**File:** `components/ui/Card.tsx`

The base container. Five padding sizes and seven tone variants. The
compound components (`CardHeader` / `CardTitle` / `CardSubtitle`) are
optional — you can use `<Card>` standalone with any children.

```tsx
import { Card, CardHeader, CardTitle, CardSubtitle } from '@/components/ui/Card';

<Card tone="raised" padding="lg">
  <CardHeader>
    <CardTitle>Morning brief</CardTitle>
    <CardSubtitle>Auto-generated · 02:00 UTC</CardSubtitle>
  </CardHeader>
  <p>Body content here.</p>
</Card>
```

**Props for `Card`:**
```ts
interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: 'paper' | 'surface' | 'raised' | 'sunken' | 'ink' | 'signal' | 'ember';
  padding?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  children?: ReactNode;
}
```

> **When to use Card vs. raw HTML:** use `<Card>` for any container that
> has a border, padding, and a defined background. Reach for raw
> `<div>` only when you need custom internals (e.g. `<article
> className="ai-brief">` in `app/dashboard/page.tsx`).

---

### `<Input>`, `<Textarea>`

**File:** `components/ui/Input.tsx`

Labeled form input with optional hint, error, left/right adornments,
and a `labelMeta` (e.g. `"01 / 02"` for the doc-style step indicator).

```tsx
import { Input, Textarea } from '@/components/ui/Input';

<Input
  label="Room name"
  hint="What should we call this room?"
  required
  labelMeta="01 / 02"
  error={errors.name}
  value={name}
  onChange={(e) => setName(e.target.value)}
/>

<Textarea
  label="Notes"
  rows={3}
/>
```

**Props (both):**
```ts
interface BaseProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  leftAdornment?: ReactNode;
  rightAdornment?: ReactNode;
  labelMeta?: string;
  // plus the standard <input>/<textarea> HTML attributes
}
```

---

### `<Select>`

**File:** `components/ui/Select.tsx`

Labeled native `<select>` with the same adornment/meta props as
`<Input>`.

```tsx
import { Select } from '@/components/ui/Select';

<Select label="Page type" value={pageType} onChange={...}>
  <option value="pricing">Pricing</option>
  <option value="docs">Documentation</option>
  <option value="changelog">Changelog</option>
</Select>
```

---

### `<SectionHeader>`, `<EmptyState>`, `<Spinner>`, `<Progress>`, `<Tabs>`, `<Toggle>`, `<Checkbox>`, `<Tooltip>`, `<VisuallyHidden>`

**File:** `components/ui/Primitives.tsx`

A grab-bag of small primitives. Most are documented inline in the
source; here are the most-used:

```tsx
import {
  SectionHeader, EmptyState, Spinner, Progress, Tabs, Toggle, Checkbox,
} from '@/components/ui/Primitives';

// Section header with Roman numeral + label + meta + optional right-aligned action
<SectionHeader
  number="I"
  label="Vital signs"
  meta={`As of ${time}`}
  action={<Link href="...">View all</Link>}
/>

// Empty state with icon + title + description + CTA
<EmptyState
  icon={<Radar />}
  title="No rooms filed yet"
  description="Open your first memory room to start watching URLs."
  action={<Button>Open first room</Button>}
/>

// Spinner (sm, md, lg)
<Spinner size="sm" />

// Progress bar (0-100, ink or signal tone)
<Progress value={66} tone="ink" />

// Tab strip
<Tabs
  tabs={[{ id: 'all', label: 'All changes' }, { id: 'high', label: 'Critical' }]}
  activeId={tab}
  onChange={setTab}
/>
```

---

### `<ToastProvider>`, `useToast()`, `showToast()`

**File:** `components/ui/Toast.tsx`

Imperative toast notifications. Wrap your app in `<ToastProvider>`
(already done in `app/layout.tsx`) and call `showToast(...)` from
anywhere.

```tsx
import { showToast } from '@/components/ui/Toast';

// In an event handler
showToast({ type: 'success', message: 'Scan complete' });
showToast({ type: 'error', message: 'Failed to save room' });
showToast({ type: 'info', message: 'New change detected' });
```

`type` is `'success' | 'error' | 'info'`. Toasts auto-dismiss after
~5s. Stacking: up to 3 visible at once, older ones drop off the bottom.

---

## Providers

### `<SessionProvider>`

**File:** `components/providers/SessionProvider.tsx`

NextAuth's `SessionProvider` wrapper. Mounted in `app/layout.tsx` so
that `useSession()` works in every component.

---

## `lib/` (non-React, but commonly imported)

These are not components but they're imported by many pages. Quick map:

| File | Purpose | Common import |
|---|---|---|
| `lib/auth.ts` | NextAuth config (credentials provider, callbacks) | `import { authOptions } from '@/lib/auth'` |
| `lib/apiAuth.ts` | `requireSession()` for API route handlers | `import { requireSession } from '@/lib/apiAuth'` |
| `lib/cron-auth.ts` | `requireCronSecret(request)` for cron routes | `import { requireCronSecret } from '@/lib/cron-auth'` |
| `lib/env.ts` | `getInsforgeClient()`, `getInsforgeBaseUrl()`, `hasApifyCreds()`, `hasAiCreds()` | `import { getInsforgeClient } from '@/lib/env'` |
| `lib/insforge.ts` | All DB operations on the InsForge tables | `import { createRoom, getRoom, listRoomsWithStats } from '@/lib/insforge'` |
| `lib/scan.ts` | `runScan(room)` — the scan orchestration entry point | `import { runScan } from '@/lib/scan'` |
| `lib/diff.ts` | `hashContent(text)`, `hasMeaningfulChange(prev, curr)`, `extractSimpleDiff(...)` | `import { hashContent } from '@/lib/diff'` |
| `lib/validation.ts` | `validateRoomField`, `validateUrlBatch`, `normalizeCategory`, `normalizePageType` | `import { validateUrlBatch } from '@/lib/validation'` |
| `lib/notifications.ts` | `enqueueNotification()`, `drainOutbox()` (used by cron) | rarely imported outside the cron worker |
| `lib/box.ts` | InsForge Storage helpers (currently a thin wrapper) | rarely imported |
| `lib/ai.ts` | LLM helper used by `lib/scan.ts` (legacy, see warning) | ⚠️ **don't import** — use `lib/scan.ts:callLlm` |
| `lib/apify.ts` | Apify helper (dead code) | ⚠️ **don't import** — `lib/scan.ts:crawlOne` has its own |
