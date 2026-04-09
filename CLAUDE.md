# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Behaviour Rules
- Do NOT make changes until 95% confidence. Ask follow-up questions first.
- Always give exact code snippets or targeted edits — never full file replacements unless asked.
- `npm run build` is the only TypeScript error check. No tests exist.
- Do NOT use optimistic updates for Supabase writes unless explicitly told to.
- When you discover a workaround or repeated failure, add a one-line bullet (under 15 words) to ## Learnings.
- Do not push the code changes to the Git until you are asked to push them.

## Commands
```bash
npm run dev      # Dev server → localhost:3000
npm run build    # Production build + type-check
```

## Deploy
Vercel → `crm.taskronize.com` (DNS via Name.com). No backend — browser talks directly to Supabase.

## Stack
React 19 + TypeScript + Vite + Supabase. No Redux/Zustand — each view holds its own state.

## Data Layer (`lib/supabase.ts`)
- `supabase` — raw client for filtered queries
- `db` — thin wrapper: `get<T>`, `insert<T>`, `update<T>`, `delete` — always selects `*`

## Auth & Permissions
- `AuthContext` provides `canAccess(page)` — see `App.tsx`
- User types: `admin` (bypasses all checks), `team_member`, `partner`
- Page keys: `dashboard`, `revenue`, `payments`, `expenses`, `projects`, `projectManagement`, `incomeStreams`, `team`, `users`, `monthlyClosing`, `backup`, `aiAdvisor`, `automations`
- Feature keys: `pmBulkEdit`, `pmManageStatuses`
- **Adding a new permission key:** (1) add to `PagePermissions` in `types.ts` (2) add `key: 'none'` to all 4 defaults in `UsersView.tsx` (3) add to feature keys array + labels in `UsersView.tsx`

## Global Date Filter
`App.tsx` holds `startDate`/`endDate` → passed as `globalStart`/`globalEnd` to all views. Views filter via `useMemo` — do NOT re-query on date change, except `PaymentsView` which re-fetches.

## Payment & Earnings Logic (`utils/calculations.ts`)
- `calculateRevenueDetails()` — net revenue, partner commissions, deductions
- `extractPaidIds()` — checks `paid_revenue_commission_ids` text[] first, then falls back to `PaidIDs:[...]` in notes
- ID formats: `${revenue.id}-${member.name}` (partner), `ALLOC_${allocation.id}` (project allocation)
- ⚠️ ID format mismatch = items reappear as pending after settlement

## Key Supabase Tables
| Table | Purpose |
|---|---|
| `users` | Auth + permissions JSON |
| `team_members` | People — role: Partner/Developer/Designer/Bidder/Other |
| `revenues` | Revenue entries linked to income streams |
| `income_streams` | Platform configs with `commission_structure` JSON |
| `projects` | Core project data + Drive/brief doc IDs + JSONB: subtasks, activities, tags, checklist |
| `project_allocations` | Amount owed to team member per project |
| `project_revenue_links` | Many-to-many: projects ↔ revenues |
| `production_payments` | Settled payments; `paid_revenue_commission_ids` is `text[]` |
| `other_payments` | Bonuses, advances, refunds, deductions |
| `expenses` | Fixed/variable; `is_production` + `category` for deduction logic |

## Projects Table Key Columns
Drive: `drive_folder_url`, `drive_client_folder_url`
Docs: `pcb_doc_id`, `project_brief_doc_id`, `sensitive_doc_id`, `dev_brief_doc_id`
Flags: `brief_generated` (bool), `folders_creating` (bool)

**DB-only columns** (exist in Supabase but not yet in `types.ts` — add before using in code):
`sales_brief_folder_id`, `working_files_folder_id`, `brief_generated_at` (timestamptz), `last_modified_at` (timestamptz)

## ProjectManagementView (~3200 lines)
- JSONB columns managed as arrays in React state
- `ganttZoom`: `'day' | 'week' | 'month' | 'today'`
- `ganttExpanded: Set<number>` — Gantt rows showing subtasks
- `briefGenerating: Set<number>` — in-flight Generate Brief requests
- Generate Brief: POST to `https://hook.us2.make.com/lsd7rvtt6h3kr598ntwtzda5vojtbt8l` → re-fetch project row from Supabase (do NOT optimistic update)
- Subtasks have `start_date`, `due_date`, `assignee_id` in JSONB array

## File Map
```
App.tsx                        # Auth, routing, global date state, AuthContext
types.ts                       # All shared types + PagePermissions
lib/supabase.ts                # Supabase client + db helpers
utils/calculations.ts          # Commission + payment logic (critical)
views/
  ProjectManagementView.tsx    # Heavy ~3200 lines, Gantt, briefs
  PaymentsView.tsx             # Re-fetches Supabase on date change
  MyEarningsView.tsx           # Partner/team earnings
  RevenueView.tsx
  ExpensesView.tsx
  TeamView.tsx
  UsersView.tsx                # User accounts + Access Matrix modal
```

## Current Work
- [ ] Last task:
- [ ] Next task:
- [ ] Blocked on:

## Learnings
<!-- Max 10 bullets. Remove oldest when adding new. Under 15 words each. -->
- Do not optimistic-update brief_generated; re-fetch from Supabase after webhook call.
- Load statuses via ref before loadData; parallel useEffects cause race conditions on mount.
- Overdue timer cleanup must reset scheduledOverdue ref or timers are never rescheduled.
- reportData deductions must be subtracted not added; PDF amounts inflate otherwise.
- Use indexOf('-') not split('-') for keys containing member names (hyphens break it).
