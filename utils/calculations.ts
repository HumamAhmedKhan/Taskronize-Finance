
import { Revenue, IncomeStream, Expense, ProductionPayment, Project, ProjectAllocation } from '../types';

/**
 * Returns the total connects expenses for a given income stream within a date range.
 * Single canonical source — import this everywhere instead of inlining the filter.
 */
export function getConnectsMonthly(
  expenses: Expense[],
  incomeStreamId: number,
  mStart: string,
  mEnd: string
): number {
  return expenses
    .filter(e =>
      (e.category === 'Variable: Connects' || e.category === 'Connects') &&
      Number(e.income_stream_id) === Number(incomeStreamId) &&
      e.date >= mStart && e.date <= mEnd
    )
    .reduce((s, e) => s + Number(e.amount), 0);
}

export function calculateRevenueDetails(
  revenue: Revenue,
  stream: IncomeStream,
  expenses: Expense[],
  payments: ProductionPayment[],
  allRevenues: Revenue[] = [],
  projects: Project[] = [],
  projectAllocations: ProjectAllocation[] = [],
  projectRevenueLinks: any[] = [],
  globalStart?: string,
  globalEnd?: string
): Revenue & {
  platformFee: number;
  netAfterPlatform: number;
  commissions: Record<string, number>;
  grossCommissions: Record<string, number>;
  deductionsApplied: Record<string, { connects: number; production: number }>;
  profit: number;
} {
  const totalSale = Number(revenue.total_sale || 0);

  // LOGIC UPDATE: Use Revenue's specific fee if set/stored. 
  // If Revenue fee is 0 or null, fallback to the Stream's default fee configuration.
  const appliedFeePercent = (revenue.platform_fee_percent && revenue.platform_fee_percent > 0)
    ? Number(revenue.platform_fee_percent)
    : Number(stream?.platform_fee_percent || 0);

  const platformFee = (totalSale * appliedFeePercent) / 100;
  const netAfterPlatform = totalSale - platformFee;
  
  const commissions: Record<string, number> = {};
  const grossCommissions: Record<string, number> = {};
  const deductionsApplied: Record<string, { connects: number; production: number }> = {};
  
  if (!stream || !stream.commission_structure) {
    return { ...revenue, platformFee, netAfterPlatform, commissions, grossCommissions, deductionsApplied, profit: netAfterPlatform };
  }
  
  // Logic Fix: Prioritize Global Filter Dates if provided for accurate periodic reporting
  let mStart: string;
  let mEnd: string;

  if (globalStart && globalEnd) {
    mStart = globalStart;
    mEnd = globalEnd;
  } else {
    const revDate = new Date(revenue.date);
    mStart = new Date(revDate.getFullYear(), revDate.getMonth(), 1).toISOString().split('T')[0];
    mEnd = new Date(revDate.getFullYear(), revDate.getMonth() + 1, 0).toISOString().split('T')[0];
  }
  
  // Monthly manual overheads for the stream within the relevant date range
  const connectsMonthly = expenses
    .filter(e => (e.category === 'Variable: Connects' || e.category === 'Connects') && Number(e.income_stream_id) === Number(revenue.income_stream_id) && e.date >= mStart && e.date <= mEnd)
    .reduce((s, e) => s + Number(e.amount), 0);
    
  const prodManualMonthly = expenses
    .filter(e => (e.is_production || e.category === 'Production Costs') && Number(e.income_stream_id) === Number(revenue.income_stream_id) && e.date >= mStart && e.date <= mEnd)
    .reduce((s, e) => s + Number(e.amount), 0);

  // Add project allocations for projects linked to this revenue
  const linkedProjects = projects.filter(p => 
    projectRevenueLinks.some(link => 
      Number(link.revenue_id) === Number(revenue.id) && 
      Number(link.project_id) === p.id
    )
  );

  const projectAllocationCosts = projectAllocations
    .filter(alloc => linkedProjects.some(p => p.id === alloc.project_id))
    .reduce((s, a) => s + Number(a.amount), 0);

  const totalProdMonthly = prodManualMonthly + projectAllocationCosts;

  let remaining = netAfterPlatform;
  let adjustedNetBase = netAfterPlatform; // reduced by pool-level overhead_deduction entries
  const sortedStructure = [...(stream.commission_structure || [])].sort((a,b) => (a.order || 0) - (b.order || 0));

  sortedStructure.forEach(comm => {
    // Pool-level overhead deduction: reduces remaining (and adjustedNetBase for connects) before percentages
    if (comm.type === 'overhead_deduction') {
      const amount = comm.source === 'connects' ? connectsMonthly : totalProdMonthly;
      if (comm.source === 'connects') adjustedNetBase = Math.max(0, adjustedNetBase - amount);
      remaining = Math.max(0, remaining - amount);
      return;
    }

    let base = 0;
    if (comm.calculationBase === 'gross') base = totalSale;
    else if (comm.calculationBase === 'net') base = adjustedNetBase; // uses pool-adjusted net
    else base = remaining;

    // Store gross commission (before any deductions) for reference
    const grossComm = comm.type === 'percentage' ? (base * Number(comm.value) / 100) : Number(comm.value);
    grossCommissions[comm.name] = grossComm;

    // Gross commissions are sequential percentages — connects/production are deducted
    // separately at settlement time (via deductConnects/deductProduction flags in PaymentsView).
    const cDed = (comm.deductConnects && connectsMonthly > 0 && comm.type === 'percentage')
      ? connectsMonthly * Number(comm.value) / 100 : 0;
    const pDed = (comm.deductProduction && totalProdMonthly > 0 && comm.type === 'percentage')
      ? totalProdMonthly * Number(comm.value) / 100 : 0;

    const final = comm.type === 'percentage'
      ? base * Number(comm.value) / 100
      : grossComm;
    commissions[comm.name] = final;
    deductionsApplied[comm.name] = { connects: cDed, production: pDed };
    remaining -= final;
  });

  return { 
    ...revenue, 
    platformFee, 
    netAfterPlatform, 
    commissions, 
    grossCommissions,
    deductionsApplied,
    profit: Math.max(0, remaining)
  };
}

/** Reliably extracts paid IDs from a payment record.
 *  Checks the array column first, then falls back to PaidIDs:[...] embedded in notes.
 */
export function extractPaidIds(p: { paid_revenue_commission_ids?: any; notes?: string | null }): string[] {
  const ids = p.paid_revenue_commission_ids;
  if (Array.isArray(ids) && ids.length > 0) return ids.map(String);
  if (typeof ids === 'string' && ids.length > 0) {
    try { const parsed = JSON.parse(ids); if (Array.isArray(parsed)) return parsed.map(String); } catch {}
    if (ids.startsWith('{')) return ids.slice(1, -1).split(',').map(s => s.trim().replace(/^"|"$/g, ''));
  }
  if (p.notes) {
    const match = p.notes.match(/PaidIDs:(\[.*?\])/);
    if (match) { try { const parsed = JSON.parse(match[1]); if (Array.isArray(parsed)) return parsed.map(String); } catch {} }
  }
  return [];
}

