
import React, { useState, useEffect, useMemo } from 'react';
import { supabase, db } from '../lib/supabase';
import {
  Revenue, IncomeStream, Expense, ProductionPayment,
  TeamMember, Project, ProjectAllocation
} from '../types';
import { extractPaidIds } from '../utils/calculations';
import {
  ChevronDown, ChevronRight, AlertTriangle, CheckCircle2,
  Loader2, Download
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface ProductionProjectDetail {
  alloc: ProjectAllocation;
  project: Project | undefined;
  hasRevenueLink: boolean;
  isSettledAlloc: boolean;
}

interface ProductionMemberRow {
  member: TeamMember;
  total: number;
  projects: ProductionProjectDetail[];
}

interface CommissionLine {
  name: string;
  amount: number;
  percent: number;
  base: string; // 'net' | 'gross' | 'remaining'
}

interface PartnerSettlementRow {
  name: string;
  owed: number;
  isSettled: boolean;
}

interface StreamCardData {
  stream: IncomeStream;
  gross: number;
  platformFees: number;
  net: number;
  isYHType: boolean;
  commissionLines: CommissionLine[];
  connects: number;
  connectsOwnerShare: number;
  productionTotal: number;
  productionOwnerShare: number;
  productionByMember: ProductionMemberRow[];
  yhRemaining?: number;
  yhFinalPot?: number;
  partnerSettlement: PartnerSettlementRow[];
  ownerTake: number;
}

// ── Core Computation ──────────────────────────────────────────────────────────

function computeStreamCard(
  stream: IncomeStream,
  streamRevs: Revenue[],
  expenses: Expense[],
  allPayments: ProductionPayment[],
  allocations: ProjectAllocation[],
  projects: Project[],
  projectRevenueLinks: any[],
  members: TeamMember[],
  mStart: string,
  mEnd: string
): StreamCardData {
  const gross = streamRevs.reduce((s, r) => s + Number(r.total_sale), 0);
  const platformFees = streamRevs.reduce((s, r) => {
    const pct = Number(r.platform_fee_percent ?? stream.platform_fee_percent ?? 0);
    return s + Number(r.total_sale) * pct / 100;
  }, 0);
  const net = gross - platformFees;

  // Connects for this stream this month
  const connects = expenses
    .filter(e =>
      (e.category === 'Variable: Connects' || e.category === 'Connects') &&
      Number(e.income_stream_id) === stream.id &&
      e.date >= mStart && e.date <= mEnd
    )
    .reduce((s, e) => s + Number(e.amount), 0);

  // Production: allocations for projects linked to this stream's revenues
  const revenueIds = new Set(streamRevs.map(r => r.id));
  const linkedProjectIds = new Set<number>(
    projectRevenueLinks
      .filter(link => revenueIds.has(Number(link.revenue_id)))
      .map(link => Number(link.project_id))
  );
  const productionAllocs = allocations.filter(a => linkedProjectIds.has(a.project_id));
  const productionExpenses = expenses.filter(e =>
    (e.is_production || e.category === 'Production Costs') &&
    Number(e.income_stream_id) === stream.id &&
    e.date >= mStart && e.date <= mEnd
  );
  const productionTotal =
    productionAllocs.reduce((s, a) => s + Number(a.amount), 0) +
    productionExpenses.reduce((s, e) => s + Number(e.amount), 0);

  // Detect YH-type: has at least one remaining-based commission
  const isYHType = (stream.commission_structure || []).some(
    (c: any) => c.calculationBase === 'remaining'
  );

  const connectsOwnerShare = isYHType ? connects / 3 : connects;
  const productionOwnerShare = isYHType ? productionTotal / 3 : productionTotal;

  const sortedStructure = [...(stream.commission_structure || [])].sort(
    (a: any, b: any) => (a.order ?? 0) - (b.order ?? 0)
  );

  const commissionLines: CommissionLine[] = [];
  let ownerTake = 0;
  let yhRemaining: number | undefined;
  let yhFinalPot: number | undefined;

  if (isYHType) {
    let remaining = net;

    // Net-based commissions first
    sortedStructure
      .filter((c: any) => c.calculationBase === 'net')
      .forEach((rule: any) => {
        const amount = net * Number(rule.value) / 100;
        commissionLines.push({ name: rule.name, amount, percent: Number(rule.value), base: 'net' });
        remaining -= amount;
      });

    // Deduct owner's shares of connects and production
    remaining -= connectsOwnerShare;
    remaining -= productionOwnerShare;
    yhRemaining = remaining;

    // Remaining-based commissions
    let firstRemDone = false;
    sortedStructure
      .filter((c: any) => c.calculationBase === 'remaining')
      .forEach((rule: any) => {
        const amount = remaining * Number(rule.value) / 100;
        commissionLines.push({ name: rule.name, amount, percent: Number(rule.value), base: 'remaining' });
        remaining -= amount;
        if (!firstRemDone) {
          yhFinalPot = remaining; // after Hasham (first remaining) = final pot
          firstRemDone = true;
        }
      });

    ownerTake = remaining;
  } else {
    // Standard waterfall: sum gross commissions per partner
    let totalComms = 0;
    sortedStructure.forEach((rule: any) => {
      let ruleTotal = 0;
      streamRevs.forEach(rev => {
        const pct = Number(rev.platform_fee_percent ?? stream.platform_fee_percent ?? 0);
        const revNet = Number(rev.total_sale) * (1 - pct / 100);
        const base =
          rule.calculationBase === 'gross' ? Number(rev.total_sale) :
          rule.calculationBase === 'net'   ? revNet :
          0;
        ruleTotal += rule.type === 'percentage'
          ? base * Number(rule.value) / 100
          : Number(rule.value);
      });
      if (ruleTotal > 0) {
        commissionLines.push({
          name: rule.name, amount: ruleTotal,
          percent: Number(rule.value), base: rule.calculationBase
        });
        totalComms += ruleTotal;
      }
    });
    ownerTake = net - totalComms - connectsOwnerShare - productionOwnerShare;
  }

  // Production details per team member
  const productionByMember: ProductionMemberRow[] = members
    .map(m => {
      const memberAllocs = productionAllocs.filter(a => a.team_member_id === m.id);
      if (memberAllocs.length === 0) return null;
      const projectDetails: ProductionProjectDetail[] = memberAllocs.map(a => {
        const project = projects.find(p => p.id === a.project_id);
        const hasRevenueLink = projectRevenueLinks.some(
          link => Number(link.project_id) === a.project_id
        );
        const isSettledAlloc = allPayments.some(p => {
          const ids = extractPaidIds(p);
          return ids.includes(`ALLOC_${a.id}`);
        });
        return { alloc: a, project, hasRevenueLink, isSettledAlloc };
      });
      return {
        member: m,
        total: memberAllocs.reduce((s, a) => s + Number(a.amount), 0),
        projects: projectDetails
      };
    })
    .filter(Boolean) as ProductionMemberRow[];

  // Partner settlement status for this month
  const monthPayments = allPayments.filter(p => p.date >= mStart && p.date <= mEnd);
  const partnerSettlement: PartnerSettlementRow[] = commissionLines
    .map(c => {
      const member = members.find(m => m.name === c.name);
      if (!member) return null;
      const isSettled = monthPayments.some(
        p => Number(p.recipient_id) === member.id && p.payment_type === 'partner'
      );
      return { name: c.name, owed: c.amount, isSettled };
    })
    .filter(Boolean) as PartnerSettlementRow[];

  return {
    stream, gross, platformFees, net,
    isYHType, commissionLines,
    connects, connectsOwnerShare,
    productionTotal, productionOwnerShare, productionByMember,
    yhRemaining, yhFinalPot,
    partnerSettlement, ownerTake
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

const fmt = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(v);

const ProductionDropdown: React.FC<{
  productionByMember: ProductionMemberRow[];
  ownerShare: number;
  note: string;
}> = ({ productionByMember, ownerShare, note }) => {
  const [open, setOpen] = useState(false);
  const [expandedMember, setExpandedMember] = useState<number | null>(null);

  return (
    <div className="border-t border-slate-50">
      <div className="flex items-center justify-between py-2.5">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>Production</span>
          <span className="text-xs text-slate-400 font-normal">({note})</span>
        </button>
        <span className="text-rose-500 font-bold text-sm">−{fmt(ownerShare)}</span>
      </div>

      {open && (
        <div className="ml-4 space-y-2 pb-3">
          {productionByMember.length === 0 ? (
            <p className="text-xs text-slate-400 italic py-1">No allocations found.</p>
          ) : (
            productionByMember.map(row => (
              <div key={row.member.id} className="bg-slate-50 rounded-xl p-3">
                <button
                  className="flex items-center justify-between w-full"
                  onClick={() =>
                    setExpandedMember(expandedMember === row.member.id ? null : row.member.id)
                  }
                >
                  <span className="text-xs font-bold text-slate-700">{row.member.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-600 font-semibold">{fmt(row.total)}</span>
                    {expandedMember === row.member.id
                      ? <ChevronDown size={12} />
                      : <ChevronRight size={12} />
                    }
                  </div>
                </button>

                {expandedMember === row.member.id && (
                  <div className="mt-2 space-y-2 border-t border-slate-100 pt-2">
                    {row.projects.map(pd => (
                      <div key={pd.alloc.id} className="space-y-0.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-500">
                            {pd.project?.project_name || 'Unknown Project'}
                          </span>
                          <span className="text-xs font-semibold text-slate-700">
                            {fmt(Number(pd.alloc.amount))}
                          </span>
                        </div>
                        {pd.isSettledAlloc && !pd.hasRevenueLink && (
                          <div className="flex items-center gap-1 text-rose-500 text-[10px] font-medium">
                            <AlertTriangle size={10} />
                            <span>Settled but revenue unlinked</span>
                          </div>
                        )}
                        {!pd.hasRevenueLink && !pd.isSettledAlloc && (
                          <div className="flex items-center gap-1 text-amber-500 text-[10px] font-medium">
                            <AlertTriangle size={10} />
                            <span>Revenue not logged</span>
                          </div>
                        )}
                        {!pd.isSettledAlloc && (
                          <div className="flex items-center gap-1 text-slate-400 text-[10px]">
                            <AlertTriangle size={10} />
                            <span>Not yet settled</span>
                          </div>
                        )}
                        {pd.isSettledAlloc && pd.hasRevenueLink && (
                          <div className="flex items-center gap-1 text-emerald-500 text-[10px]">
                            <CheckCircle2 size={10} />
                            <span>Settled</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

const UnsettledBadge: React.FC<{ name: string; amount: number }> = ({ name, amount }) => (
  <div className="flex items-center gap-1 text-amber-600 text-[10px] font-medium mt-0.5 ml-1">
    <AlertTriangle size={10} />
    <span>{name} not yet settled — {fmt(amount)} owed</span>
  </div>
);

const StreamCard: React.FC<{ data: StreamCardData }> = ({ data }) => {
  const {
    stream, gross, platformFees, net,
    isYHType, commissionLines,
    connects, connectsOwnerShare,
    productionByMember, productionOwnerShare,
    yhRemaining, yhFinalPot,
    partnerSettlement, ownerTake
  } = data;

  const netComms = commissionLines.filter(c => c.base === 'net');
  const grossComms = commissionLines.filter(c => c.base === 'gross');
  const remComms = commissionLines.filter(c => c.base === 'remaining');

  const getSettlement = (name: string) =>
    partnerSettlement.find(ps => ps.name === name);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h3 className="font-black text-slate-800 text-base">{stream.name}</h3>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
            {stream.platform}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-slate-400 uppercase font-bold mb-0.5">Your take</p>
          <p className={`text-xl font-black ${ownerTake >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
            {fmt(ownerTake)}
          </p>
        </div>
      </div>

      {/* Waterfall */}
      <div className="px-6 py-4 divide-y divide-slate-50">

        {/* Gross */}
        <div className="flex justify-between items-center py-2">
          <span className="text-sm text-slate-500">Gross Revenue</span>
          <span className="font-bold text-slate-800">{fmt(gross)}</span>
        </div>

        {/* Platform fee */}
        {platformFees > 0 && (
          <div className="flex justify-between items-center py-2">
            <span className="text-sm text-slate-500">
              Platform fee ({stream.platform_fee_percent}%)
            </span>
            <span className="text-rose-500 font-bold">−{fmt(platformFees)}</span>
          </div>
        )}

        {/* Net */}
        <div className="flex justify-between items-center py-2.5">
          <span className="text-sm font-bold text-slate-700">Net</span>
          <span className="font-black text-slate-800">{fmt(net)}</span>
        </div>

        {/* Net-based commissions */}
        {netComms.map(c => {
          const s = getSettlement(c.name);
          return (
            <div key={c.name} className="py-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500">
                  {c.name}{' '}
                  <span className="text-slate-400 text-xs">({c.percent}% of net)</span>
                </span>
                <span className="text-rose-500 font-bold">−{fmt(c.amount)}</span>
              </div>
              {s && !s.isSettled && <UnsettledBadge name={c.name} amount={c.amount} />}
            </div>
          );
        })}

        {/* Gross-based commissions (non-YH) */}
        {!isYHType && grossComms.map(c => {
          const s = getSettlement(c.name);
          return (
            <div key={c.name} className="py-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500">
                  {c.name}{' '}
                  <span className="text-slate-400 text-xs">({c.percent}% of gross)</span>
                </span>
                <span className="text-rose-500 font-bold">−{fmt(c.amount)}</span>
              </div>
              {s && !s.isSettled && <UnsettledBadge name={c.name} amount={c.amount} />}
            </div>
          );
        })}

        {/* Connects */}
        {connects > 0 && (
          <div className="flex justify-between items-center py-2">
            <span className="text-sm text-slate-500">
              Connects{' '}
              <span className="text-slate-400 text-xs">
                {isYHType ? '(÷3 your share)' : '(your cost)'}
              </span>
            </span>
            <span className="text-rose-500 font-bold">−{fmt(connectsOwnerShare)}</span>
          </div>
        )}

        {/* Production collapsible */}
        {(productionByMember.length > 0 || productionOwnerShare > 0) && (
          <ProductionDropdown
            productionByMember={productionByMember}
            ownerShare={productionOwnerShare}
            note={isYHType ? '÷3 your share' : 'your cost'}
          />
        )}

        {/* YH only: = Remaining subtotal */}
        {isYHType && yhRemaining !== undefined && (
          <div className="flex justify-between items-center py-2.5 !border-t-2 border-slate-200">
            <span className="text-sm font-bold text-slate-700">= Remaining</span>
            <span className="font-black text-slate-800">{fmt(yhRemaining)}</span>
          </div>
        )}

        {/* YH only: remaining-based commissions (Hasham, Mirjan) */}
        {isYHType && remComms.map((c, idx) => {
          const s = getSettlement(c.name);
          return (
            <React.Fragment key={c.name}>
              <div className="py-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-500">
                    {c.name}{' '}
                    <span className="text-slate-400 text-xs">({c.percent}% of remaining)</span>
                  </span>
                  <span className="text-rose-500 font-bold">−{fmt(c.amount)}</span>
                </div>
                {s && !s.isSettled && <UnsettledBadge name={c.name} amount={c.amount} />}
              </div>
              {/* Show "= Final pot" after first remaining commission (Hasham) */}
              {idx === 0 && yhFinalPot !== undefined && (
                <div className="flex justify-between items-center py-2 px-3 bg-slate-50 rounded-lg my-1">
                  <span className="text-xs font-bold text-slate-600">= Final pot (split 50/50)</span>
                  <span className="text-sm font-black text-slate-700">{fmt(yhFinalPot)}</span>
                </div>
              )}
            </React.Fragment>
          );
        })}

        {/* Owner take */}
        <div className={`flex justify-between items-center py-3 px-4 rounded-xl mt-1 !border-t-0 ${
          ownerTake >= 0 ? 'bg-emerald-50' : 'bg-rose-50'
        }`}>
          <span className="font-black text-slate-700 text-sm">
            Your Take{isYHType ? ' (50%)' : ''}
          </span>
          <span className={`text-xl font-black ${ownerTake >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
            {fmt(ownerTake)}
          </span>
        </div>
      </div>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────────────

const MonthlyClosingView: React.FC = () => {
  const TARGET = 3000;

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const [data, setData] = useState<{
    revenues: Revenue[];
    streams: IncomeStream[];
    expenses: Expense[];
    allPayments: ProductionPayment[];
    projects: Project[];
    allocations: ProjectAllocation[];
    members: TeamMember[];
    projectRevenueLinks: any[];
  }>({
    revenues: [], streams: [], expenses: [], allPayments: [],
    projects: [], allocations: [], members: [], projectRevenueLinks: []
  });
  const [loading, setLoading] = useState(true);

  const monthOptions = useMemo(() => {
    const options = [];
    const date = new Date();
    for (let i = 0; i < 24; i++) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      options.push({
        value: `${year}-${month}`,
        label: date.toLocaleString('default', { month: 'short', year: 'numeric' })
      });
      date.setMonth(date.getMonth() - 1);
    }
    return options;
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [year, month] = selectedMonth.split('-');
      const start = `${selectedMonth}-01`;
      const end = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0];

      const [revs, streams, exps, pymts, projs, allocs, members, links] = await Promise.all([
        supabase.from('revenues').select('*').gte('date', start).lte('date', end),
        db.get<IncomeStream>('income_streams'),
        db.get<Expense>('expenses'),
        db.get<ProductionPayment>('production_payments'), // all time — for alloc settlement checks
        db.get<Project>('projects'),
        db.get<ProjectAllocation>('project_allocations'),
        db.get<TeamMember>('team_members'),
        supabase.from('project_revenue_links').select('*')
      ]);

      setData({
        revenues: revs.data || [],
        streams,
        expenses: exps,
        allPayments: pymts,
        projects: projs,
        allocations: allocs,
        members,
        projectRevenueLinks: links.data || []
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [selectedMonth]);

  const streamData = useMemo(() => {
    const { revenues, streams, expenses, allPayments, allocations, projects, projectRevenueLinks, members } = data;
    const [year, month] = selectedMonth.split('-');
    const mStart = `${selectedMonth}-01`;
    const mEnd = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0];

    return streams
      .map(stream => {
        const streamRevs = revenues.filter(r => Number(r.income_stream_id) === stream.id);
        if (streamRevs.length === 0) return null;
        return computeStreamCard(
          stream, streamRevs, expenses, allPayments,
          allocations, projects, projectRevenueLinks, members, mStart, mEnd
        );
      })
      .filter(Boolean) as StreamCardData[];
  }, [data, selectedMonth]);

  const totalGross = useMemo(() =>
    streamData.reduce((s, d) => s + d.gross, 0), [streamData]);

  const totalCosts = useMemo(() =>
    streamData.reduce((s, d) => {
      const comms = d.commissionLines.reduce((s2, c) => s2 + c.amount, 0);
      return s + d.platformFees + comms + d.connectsOwnerShare + d.productionOwnerShare;
    }, 0), [streamData]);

  const yourTakeTotal = useMemo(() =>
    streamData.reduce((s, d) => s + d.ownerTake, 0), [streamData]);

  if (loading) return (
    <div className="flex items-center justify-center py-40">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="animate-spin text-gray-400" size={40} />
        <p className="text-xs font-black text-gray-400 uppercase tracking-[0.4em]">
          Computing Income Statement...
        </p>
      </div>
    </div>
  );

  const progressPct = Math.min(100, (yourTakeTotal / TARGET) * 100);
  const deficit = TARGET - yourTakeTotal;

  return (
    <div className="space-y-8 pb-20">

      {/* Header + Month Selector */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-800">My Income Statement</h2>
          <p className="text-slate-500 text-sm mt-1">
            Owner's residual after all commissions, connects & production
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {monthOptions.slice(0, 4).map(opt => (
            <button
              key={opt.value}
              onClick={() => setSelectedMonth(opt.value)}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                selectedMonth === opt.value
                  ? 'bg-slate-900 text-white shadow'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-xl font-bold text-xs hover:bg-slate-50 transition-all"
          >
            <Download size={14} /> PDF
          </button>
        </div>
      </div>

      {/* 3 Summary Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
            Total Gross
          </p>
          <p className="text-3xl font-black text-slate-800">{fmt(totalGross)}</p>
          <p className="text-xs text-slate-400 mt-1">All streams combined</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
            Total Costs
          </p>
          <p className="text-3xl font-black text-rose-500">{fmt(totalCosts)}</p>
          <p className="text-xs text-slate-400 mt-1">Fees, commissions, production</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
            Your Take This Month
          </p>
          <p className={`text-3xl font-black ${yourTakeTotal >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
            {fmt(yourTakeTotal)}
          </p>
          <div className="mt-3">
            <div className="flex justify-between text-[10px] text-slate-400 mb-1">
              <span>Target: {fmt(TARGET)}</span>
              <span>{progressPct.toFixed(0)}%</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all duration-500 ${
                  progressPct >= 100 ? 'bg-emerald-500' : 'bg-blue-500'
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            {deficit > 0 ? (
              <p className="text-[10px] text-rose-500 font-bold mt-1">
                {fmt(deficit)} short of target
              </p>
            ) : (
              <p className="text-[10px] text-emerald-600 font-bold mt-1">
                {fmt(Math.abs(deficit))} above target ✓
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Stream Cards */}
      <div className="space-y-6">
        {streamData.length === 0 ? (
          <div className="text-center py-20 text-slate-400 bg-white rounded-2xl border border-slate-200">
            No revenue recorded for this month.
          </div>
        ) : (
          streamData.map(sd => <StreamCard key={sd.stream.id} data={sd} />)
        )}
      </div>

      {/* Bottom Summary Card */}
      {streamData.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-100">
            <h3 className="font-black text-slate-800">Monthly Summary</h3>
            <p className="text-xs text-slate-400 mt-0.5">Your take per stream</p>
          </div>
          <div className="p-6 space-y-3">
            {streamData.map(sd => (
              <div key={sd.stream.id} className="flex justify-between items-center text-sm">
                <span className="text-slate-600 font-medium">{sd.stream.name}</span>
                <span className={`font-bold ${sd.ownerTake >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {fmt(sd.ownerTake)}
                </span>
              </div>
            ))}
            <div className="border-t-2 border-slate-200 pt-3 flex justify-between items-center">
              <span className="font-black text-slate-800">Total Your Take</span>
              <span className={`text-2xl font-black ${yourTakeTotal >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                {fmt(yourTakeTotal)}
              </span>
            </div>

            <div className="mt-2 pt-2">
              <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                <span>Target {fmt(TARGET)}</span>
                <span>{progressPct.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-3">
                <div
                  className={`h-3 rounded-full transition-all duration-500 ${
                    progressPct >= 100 ? 'bg-emerald-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <p className={`text-sm font-bold mt-2 ${deficit > 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
                {deficit > 0
                  ? `${fmt(deficit)} deficit vs target`
                  : `${fmt(Math.abs(deficit))} surplus vs target`
                }
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MonthlyClosingView;
