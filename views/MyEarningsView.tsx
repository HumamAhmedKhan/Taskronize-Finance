import React, { useState, useEffect } from 'react';
import { db, supabase } from '../lib/supabase';
import { Project, ProjectAllocation, IncomeStream, Revenue, TeamMember, User, Expense } from '../types';
import { DollarSign, Clock, CheckCircle2, Receipt } from 'lucide-react';
import Table from '../components/Table';

interface MyEarningsViewProps {
  currentUser: User;
  globalStart: string;
  globalEnd: string;
}

const MyEarningsView: React.FC<MyEarningsViewProps> = ({ currentUser, globalStart, globalEnd }) => {
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [allocations, setAllocations] = useState<ProjectAllocation[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [incomeStreams, setIncomeStreams] = useState<IncomeStream[]>([]);
  const [revenues, setRevenues] = useState<Revenue[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [projectRevenueLinks, setProjectRevenueLinks] = useState<any[]>([]);
  const [teamMember, setTeamMember] = useState<TeamMember | null>(null);
  const [timeframe, setTimeframe] = useState<'month' | 'all'>('month');

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [projData, allocData, payData, streamData, revData, teamData, expData, prlData] = await Promise.all([
          db.get<Project>('projects'),
          db.get<ProjectAllocation>('project_allocations'),
          db.get<any>('production_payments'),
          db.get<IncomeStream>('income_streams'),
          db.get<Revenue>('revenues'),
          db.get<TeamMember>('team_members'),
          db.get<Expense>('expenses'),
          supabase.from('project_revenue_links').select('*')
        ]);

        setProjects(projData || []);
        setAllocations(allocData || []);
        setPayments(payData || []);
        setIncomeStreams(streamData || []);
        setRevenues(revData || []);
        setExpenses(expData || []);
        setProjectRevenueLinks(prlData.data || []);

        const tm = (teamData || []).find((t: TeamMember) => t.id === currentUser.team_member_id);
        setTeamMember(tm || null);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [currentUser.id]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.max(0, amount));
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Loading earnings...</div>;
  }

  if (!teamMember && currentUser.user_type !== 'partner') {
    return <div className="p-8 text-center text-slate-500">No team member profile found.</div>;
  }

  // ─── TEAM MEMBER VIEW ────────────────────────────────────────────────────────
  if (currentUser.user_type === 'team_member') {
    const myAllocations = allocations.filter(a => a.team_member_id === teamMember?.id);
    const myPayments = payments.filter(p => p.recipient_id === teamMember?.id);

    const currentMonthAllocations = myAllocations.filter(a => {
      const p = projects.find(proj => proj.id === a.project_id);
      if (!p) return false;
      return p.date >= globalStart && p.date <= globalEnd;
    });
    const currentMonthPayments = myPayments.filter(p => p.date >= globalStart && p.date <= globalEnd);

    const totalAllocatedThisMonth = currentMonthAllocations.reduce((sum, a) => sum + Number(a.amount || 0), 0);
    const totalPaidThisMonth = currentMonthPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const totalAllocatedAllTime = myAllocations.reduce((sum, a) => sum + Number(a.amount || 0), 0);
    const totalPaidAllTime = myPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const pendingBalance = totalAllocatedAllTime - totalPaidAllTime;

    const tableData = currentMonthAllocations.map(alloc => {
      const project = projects.find(p => p.id === alloc.project_id);
      const isPaid = myPayments.some(p =>
        p.paid_revenue_commission_ids?.includes(`ALLOC_${alloc.id}`) ||
        p.notes?.includes(`Alloc: ${alloc.id}`)
      );
      const amountPaid = isPaid ? Number(alloc.amount || 0) : 0;
      return {
        id: alloc.id,
        project_name: project?.project_name || 'Unknown Project',
        date: project?.date || '',
        allocation: Number(alloc.amount || 0),
        paid: amountPaid,
        pending: Number(alloc.amount || 0) - amountPaid
      };
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return (
      <div className="space-y-6 max-w-7xl mx-auto w-full font-manrope">
        <header className="mb-8">
          <h1 className="text-3xl font-black text-slate-900 tracking-tight mb-2">My Earnings</h1>
          <p className="text-slate-500 font-medium">Track your project allocations and payments.</p>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600"><DollarSign size={20} /></div>
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Allocated (Selected Period)</h3>
            </div>
            <div className="text-3xl font-black text-slate-900">{formatCurrency(totalAllocatedThisMonth)}</div>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600"><CheckCircle2 size={20} /></div>
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Paid (Selected Period)</h3>
            </div>
            <div className="text-3xl font-black text-slate-900">{formatCurrency(totalPaidThisMonth)}</div>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600"><Clock size={20} /></div>
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Pending Balance</h3>
            </div>
            <div className="text-3xl font-black text-slate-900">{formatCurrency(pendingBalance)}</div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-200">
            <h3 className="text-lg font-bold text-slate-900">Allocation Details</h3>
          </div>
          <Table
            data={tableData}
            rowKey={(row) => row.id}
            columns={[
              { header: 'PROJECT', render: (row) => <span className="font-bold text-slate-900">{row.project_name}</span> },
              { header: 'DATE', render: (row) => <span className="text-slate-500">{row.date ? new Date(row.date).toLocaleDateString() : '—'}</span> },
              { header: 'ALLOCATION', render: (row) => <span className="font-bold text-slate-700">{formatCurrency(row.allocation)}</span> },
              { header: 'PAID', render: (row) => <span className="text-emerald-600 font-bold">{formatCurrency(row.paid)}</span> },
              { header: 'PENDING', render: (row) => <span className={`font-bold ${row.pending > 0 ? 'text-amber-600' : 'text-slate-500'}`}>{formatCurrency(row.pending)}</span> }
            ]}
          />
        </div>
      </div>
    );
  }

  // ─── PARTNER VIEW ─────────────────────────────────────────────────────────────
  if (currentUser.user_type === 'partner') {
    const streamIds = currentUser.linked_income_stream_ids || [];

    if (!streamIds.length) {
      return <div className="p-8 text-center text-slate-500">No linked income streams found for your partner account.</div>;
    }

    const partnerName = teamMember?.name || currentUser.name || '';

    // All payments made to this partner (for payment history + paid tracking)
    const partnerPayments = payments
      .filter(p => p.recipient_id === teamMember?.id)
      .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Revenues in the partner's streams, filtered by timeframe
    let filteredRevenues = revenues.filter(r => streamIds.includes(r.income_stream_id));
    if (timeframe === 'month') {
      filteredRevenues = filteredRevenues.filter(r => r.date >= globalStart && r.date <= globalEnd);
    }

    // ── Connects deduction: calculated ONCE per stream, not per revenue row ──
    let totalConnectsDeduction = 0;
    streamIds.forEach(streamId => {
      const stream = incomeStreams.find(s => s.id === streamId);
      if (!stream) return;
      const rule = stream.commission_structure?.find((r: any) => r.name === partnerName);
      if (!rule || !rule.deductConnects || rule.type !== 'percentage') return;

      const connectsCost = expenses
        .filter(e =>
          (e.category === 'Variable: Connects' || e.category === 'Connects') &&
          Number(e.income_stream_id) === Number(streamId) &&
          (timeframe === 'all' || (e.date >= globalStart && e.date <= globalEnd))
        )
        .reduce((s, e) => s + Number(e.amount), 0);

      totalConnectsDeduction += connectsCost * (Number(rule.value) / 100);
    });

    // ── Total paid: sum directly from production_payments records (source of truth) ──
    const filteredPayments = timeframe === 'month'
      ? partnerPayments.filter((p: any) => p.date >= globalStart && p.date <= globalEnd)
      : partnerPayments;
    const totalPaid = filteredPayments
      .reduce((s: number, p: any) => s + Number(p.total_amount || 0), 0);

    // ── Per-row calculations (production deduction only, no connects) ──
    let totalGross = 0;
    let totalProductionDeduction = 0;
    let totalNet = 0;

    // Sort revenues oldest-first so the earliest installment carries the production deduction
    const revenuesSortedAsc = [...filteredRevenues].sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Track which project IDs have already had their production cost deducted
    const chargedProjectIds = new Set<number>();

    const tableData = revenuesSortedAsc.map(rev => {
      const stream = incomeStreams.find(s => s.id === rev.income_stream_id);
      if (!stream) return null;

      const rule = stream.commission_structure?.find((r: any) => r.name === partnerName);
      if (!rule) return null;

      // Gross commission
      const totalSale = Number(rev.total_sale || 0);
      const appliedFeePercent = (rev.platform_fee_percent && rev.platform_fee_percent > 0)
        ? Number(rev.platform_fee_percent)
        : Number(stream.platform_fee_percent || 0);
      const netAfterPlatform = totalSale - (totalSale * appliedFeePercent) / 100;

      let base = 0;
      if (rule.calculationBase === 'gross') base = totalSale;
      else base = netAfterPlatform;

      const grossCommission = rule.type === 'percentage'
        ? (base * Number(rule.value) / 100)
        : Number(rule.value);

      if (grossCommission <= 0) return null;

      // Production deduction: only for projects not yet charged
      const linkedProjectIds = projectRevenueLinks
        .filter(link => Number(link.revenue_id) === Number(rev.id))
        .map(link => Number(link.project_id));

      // Only charge production cost once per project — skip if already charged
      const uncharged = linkedProjectIds.filter(pid => !chargedProjectIds.has(pid));

      const projectAllocationCosts = allocations
        .filter(a => uncharged.includes(a.project_id))
        .reduce((s, a) => s + Number(a.amount), 0);

      const productionDeduction = (rule.deductProduction && projectAllocationCosts > 0 && rule.type === 'percentage')
        ? projectAllocationCosts * (Number(rule.value) / 100)
        : 0;

      // Mark these projects as charged so subsequent rows skip them
      uncharged.forEach(pid => chargedProjectIds.add(pid));

      const netCommission = Math.max(0, grossCommission - productionDeduction);

      // Payment tracking
      const key = `${rev.id}-${partnerName}`;
      const isPaid = filteredPayments.some((p: any) => p.paid_revenue_commission_ids?.includes(key));
      const amountPaid = isPaid ? netCommission : 0;
      const pending = Math.max(0, netCommission - amountPaid);

      // Project name from links
      const linkedProject = projects.find(p => linkedProjectIds.includes(p.id));

      totalGross += grossCommission;
      totalProductionDeduction += productionDeduction;
      totalNet += netCommission;

      return {
        id: rev.id,
        date: rev.date,
        projectName: linkedProject?.project_name || '—',
        streamName: stream.name,
        revenueAmount: totalSale,
        grossCommission,
        productionDeduction,
        netCommission,
        amountPaid,
        pending
      };
    }).filter(Boolean).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Pending balance = net earnings - connects deduction - amount already paid
    const pendingBalance = Math.max(0, totalNet - totalConnectsDeduction - totalPaid);

    return (
      <div className="space-y-6 max-w-7xl mx-auto w-full font-manrope">
        {/* Header */}
        <header className="mb-8 flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight mb-2">Partner Earnings</h1>
            <p className="text-slate-500 font-medium">Track your commissions, deductions, and payments.</p>
          </div>
          <div className="flex bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setTimeframe('month')}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${timeframe === 'month' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              This Month
            </button>
            <button
              onClick={() => setTimeframe('all')}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${timeframe === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              All Time
            </button>
          </div>
        </header>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-2">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Gross Commission</h3>
            <div className="text-xl font-black text-slate-900">{formatCurrency(totalGross)}</div>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Prod. Deductions</h3>
            <div className="text-xl font-black text-rose-500">
              {totalProductionDeduction > 0 ? `-${formatCurrency(totalProductionDeduction)}` : '—'}
            </div>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-l-orange-300">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Connects (Monthly)</h3>
            <div className="text-xl font-black text-orange-500">
              {totalConnectsDeduction > 0 ? `-${formatCurrency(totalConnectsDeduction)}` : '—'}
            </div>
          </div>
          <div className="bg-slate-900 p-5 rounded-2xl shadow-sm">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Net Commission</h3>
            <div className="text-xl font-black text-white">{formatCurrency(totalNet)}</div>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Total Paid</h3>
            <div className="text-xl font-black text-emerald-600">{formatCurrency(totalPaid)}</div>
          </div>
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-l-amber-400">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Pending Balance</h3>
            <div className={`text-xl font-black ${pendingBalance > 0 ? 'text-amber-600' : 'text-slate-500'}`}>
              {formatCurrency(pendingBalance)}
            </div>
          </div>
        </div>

        {/* Connects deduction explainer */}
        {totalConnectsDeduction > 0 && (
          <div className="flex items-start gap-3 bg-orange-50 border border-orange-100 rounded-xl px-4 py-3 text-sm text-orange-700">
            <span className="mt-0.5 shrink-0">ⓘ</span>
            <span>
              A <strong>{formatCurrency(totalConnectsDeduction)}</strong> connects deduction is applied as a monthly shared cost
              {timeframe === 'month' ? ' for this period' : ' across the selected period'}.
              It is subtracted from your pending balance once, not per project.
            </span>
          </div>
        )}

        {/* Project Breakdown table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-200">
            <h3 className="text-lg font-bold text-slate-900">Project Breakdown</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Date</th>
                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Project Name</th>
                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Revenue Stream</th>
                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Revenue</th>
                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Gross</th>
                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Prod. Ded.</th>
                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Net</th>
                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Paid</th>
                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Pending</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(tableData as any[]).map(row => (
                  <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4 text-sm text-slate-500 whitespace-nowrap">
                      {new Date(row.date).toLocaleDateString()}
                    </td>
                    <td className="p-4">
                      <span className="font-semibold text-slate-800">{row.projectName}</span>
                    </td>
                    <td className="p-4">
                      <span className="text-sm text-slate-500">{row.streamName}</span>
                    </td>
                    <td className="p-4 font-medium text-slate-700">{formatCurrency(row.revenueAmount)}</td>
                    <td className="p-4 font-bold text-slate-900">{formatCurrency(row.grossCommission)}</td>
                    <td className="p-4 text-sm">
                      {row.productionDeduction > 0
                        ? <span className="text-rose-500">-{formatCurrency(row.productionDeduction)}</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="p-4 font-black text-slate-900">{formatCurrency(row.netCommission)}</td>
                    <td className="p-4 font-bold text-emerald-600">{formatCurrency(row.amountPaid)}</td>
                    <td className="p-4 font-bold text-amber-600">{formatCurrency(row.pending)}</td>
                  </tr>
                ))}
                {tableData.length === 0 && (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-slate-500">No revenue found for this period.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Payment History table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-200 flex items-center gap-3">
            <Receipt size={18} className="text-slate-400" />
            <h3 className="text-lg font-bold text-slate-900">Payment History</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Date</th>
                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Amount Paid</th>
                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Note</th>
                  <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Recorded By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {partnerPayments.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-slate-500">No payments recorded yet.</td>
                  </tr>
                ) : partnerPayments.map((p: any) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4 text-sm text-slate-500 whitespace-nowrap">
                      {new Date(p.date).toLocaleDateString()}
                    </td>
                    <td className="p-4 font-bold text-emerald-600">{formatCurrency(Number(p.total_amount || 0))}</td>
                    <td className="p-4 text-sm text-slate-600">{p.notes || '—'}</td>
                    <td className="p-4 text-sm text-slate-500">{p.recorded_by || p.admin_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default MyEarningsView;
