
import React, { useState, useEffect, useMemo } from 'react';
import { supabase, db } from '../lib/supabase';
import { 
  Revenue, IncomeStream, Expense, ProductionPayment, 
  TeamMember, Project, ProjectAllocation, OtherPayment, RecurringExpense
} from '../types';
import { calculateRevenueDetails } from '../utils/calculations';
import { 
  Calendar, Download, Loader2, TrendingUp, TrendingDown, 
  Users, Activity, Briefcase, Wallet, PieChart, Info, 
  ArrowRight, ShieldCheck, UserCheck, Layers, ReceiptText, Repeat, CreditCard
} from 'lucide-react';

const MonthlyClosingView: React.FC = () => {
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const [data, setData] = useState<{
    revenues: Revenue[];
    streams: IncomeStream[];
    expenses: Expense[];
    payments: ProductionPayment[];
    projects: Project[];
    allocations: ProjectAllocation[];
    members: TeamMember[];
    otherPayments: OtherPayment[];
    recurringExpenses: RecurringExpense[];
  }>({
    revenues: [],
    streams: [],
    expenses: [],
    payments: [],
    projects: [],
    allocations: [],
    members: [],
    otherPayments: [],
    recurringExpenses: []
  });

  const [loading, setLoading] = useState(true);

  const monthOptions = useMemo(() => {
    const options = [];
    const date = new Date();
    for (let i = 0; i < 24; i++) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const label = date.toLocaleString('default', { month: 'long', year: 'numeric' });
      options.push({ value: `${year}-${month}`, label });
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

      const [revs, streams, exps, pymts, projs, allocs, members, others, recurring] = await Promise.all([
        supabase.from('revenues').select('*').gte('date', start).lte('date', end),
        db.get<IncomeStream>('income_streams'),
        supabase.from('expenses').select('*').gte('date', start).lte('date', end),
        supabase.from('production_payments').select('*').gte('date', start).lte('date', end),
        db.get<Project>('projects'),
        db.get<ProjectAllocation>('project_allocations'),
        db.get<TeamMember>('team_members'),
        supabase.from('other_payments').select('*').gte('date', start).lte('date', end),
        supabase.from('recurring_expenses').select('*').eq('is_active', true)
      ]);

      setData({
        revenues: revs.data || [],
        streams: streams,
        expenses: exps.data || [],
        payments: pymts.data || [],
        projects: projs,
        allocations: allocs,
        members: members,
        otherPayments: others.data || [],
        recurringExpenses: recurring.data || []
      });
    } catch (err) {
      console.error('Error fetching audit data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedMonth]);

  const audit = useMemo(() => {
    const { revenues, streams, expenses, payments, members, projects, allocations, otherPayments, recurringExpenses } = data;

    // Fix: Re-calculate start and end dates based on selectedMonth for filtering logic in calculateRevenueDetails
    const [year, month] = selectedMonth.split('-');
    const mStart = `${selectedMonth}-01`;
    const mEnd = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0];

    const grossVolume = revenues.reduce((sum, r) => sum + Number(r.total_sale || 0), 0);
    
    // Per-Stream Breakdown details
    const streamBreakdown: Record<number, any> = {};
    const partnerLedger: Record<number, { owed: number; paid: number; name: string; role: string }> = {};

    members.forEach(m => {
      partnerLedger[m.id] = { owed: 0, paid: 0, name: m.name, role: m.role };
    });

    revenues.forEach(rev => {
      const stream = streams.find(s => s.id === rev.income_stream_id);
      if (!stream) return;

      if (!streamBreakdown[stream.id]) {
        streamBreakdown[stream.id] = {
          name: stream.name,
          platform: stream.platform,
          count: 0,
          gross: 0,
          fees: 0,
          partnerSharesTotal: 0,
          connectsDeduction: 0,
          productionDeduction: 0,
          partnerDetails: {} as Record<string, number>
        };
      }

      // Fix: Pass mStart and mEnd (month boundaries) to calculateRevenueDetails
      const details = calculateRevenueDetails(rev, stream, expenses, payments, revenues, projects, allocations, [], mStart, mEnd);
      const fees = (Number(rev.total_sale) * Number(rev.platform_fee_percent || 0)) / 100;
      
      streamBreakdown[stream.id].count += 1;
      streamBreakdown[stream.id].gross += Number(rev.total_sale);
      streamBreakdown[stream.id].fees += fees;

      Object.entries(details.commissions).forEach(([name, amount]) => {
        const partner = members.find(m => m.name === name && m.role === 'Partner');
        if (partner) {
          streamBreakdown[stream.id].partnerSharesTotal += amount;
          streamBreakdown[stream.id].partnerDetails[name] = (streamBreakdown[stream.id].partnerDetails[name] || 0) + amount;
          partnerLedger[partner.id].owed += amount;
        }
      });

      Object.values(details.deductionsApplied).forEach(d => {
        streamBreakdown[stream.id].connectsDeduction += d.connects;
        streamBreakdown[stream.id].productionDeduction += d.production;
      });
    });

    // Outflow Calculations for Retained Net Profit
    const totalFees = Object.values(streamBreakdown).reduce((sum, s) => sum + s.fees, 0);
    const totalPartnerDividendsAccrued = Object.values(partnerLedger).reduce((sum, p) => sum + p.owed, 0);
    const totalOpEx = expenses.filter(e => !e.is_production).reduce((sum, e) => sum + Number(e.amount), 0);
    const totalRecurring = recurringExpenses.reduce((sum, r) => sum + Number(r.amount), 0);
    
    const developerPaymentsBreakdown = payments
      .filter(p => p.payment_type === 'developer')
      .map(p => ({
        id: p.id,
        recipient: p.recipient_name,
        amount: Number(p.total_amount),
        date: p.date,
        method: p.payment_method
      }));
    
    const totalActualDevPaid = developerPaymentsBreakdown.reduce((sum, p) => sum + p.amount, 0);
    
    const adjustmentsPaidBreakdown = otherPayments
      .filter(o => o.is_paid)
      .map(o => ({
        id: o.id,
        recipient: o.recipient_name,
        amount: Number(o.amount),
        description: o.description,
        category: o.category,
        date: o.date
      }));

    const totalOtherPaid = adjustmentsPaidBreakdown.reduce((sum, o) => sum + o.amount, 0);

    payments.forEach(p => {
      if (p.payment_type === 'partner' && p.recipient_id && partnerLedger[p.recipient_id]) {
        partnerLedger[p.recipient_id].paid += Number(p.total_amount);
      }
    });

    const totalOutflow = totalFees + totalOpEx + totalRecurring + totalActualDevPaid + totalPartnerDividendsAccrued + totalOtherPaid;
    const finalProfit = grossVolume - totalOutflow;

    const expensesByCategory = expenses.filter(e => !e.is_production).reduce((acc: any, e) => {
      acc[e.category] = (acc[e.category] || 0) + Number(e.amount);
      return acc;
    }, {});

    return {
      grossVolume,
      totalFees,
      totalPartnerDividendsAccrued,
      totalOpEx,
      totalRecurring,
      totalActualDevPaid,
      totalOtherPaid,
      totalOutflow,
      finalProfit,
      streamBreakdown: Object.values(streamBreakdown),
      partnerLedger: Object.values(partnerLedger).filter(p => p.owed > 0 || p.paid > 0),
      developerPaymentsBreakdown,
      adjustmentsPaidBreakdown,
      expensesByCategory,
      recurringExpensesBreakdown: recurringExpenses
    };
  }, [data, selectedMonth]);

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { 
    style: 'currency', currency: 'USD', minimumFractionDigits: 2 
  }).format(val);

  if (loading) return (
    <div className="flex items-center justify-center py-40">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="animate-spin text-gray-400" size={40} />
        <p className="text-xs font-black text-gray-400 uppercase tracking-[0.4em]">Auditing System Ledger...</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-12 animate-in fade-in duration-700 pb-20">
      
      {/* 1. Health Audit Hero */}
      <div className="bg-[#0f172a] rounded-[48px] p-12 md:p-16 relative overflow-hidden shadow-2xl">
        <div className="relative z-10 flex flex-col lg:flex-row justify-between items-center gap-12">
          <div className="space-y-6 text-center lg:text-left">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-900/40 text-blue-400 rounded-full text-[10px] font-black uppercase tracking-[0.2em]">
              <ShieldCheck size={14} /> System Health Audit
            </div>
            <h1 className="text-5xl md:text-7xl font-black text-white tracking-tighter">
              Business Health Audit
            </h1>
            <p className="text-slate-400 text-lg font-medium max-w-xl leading-relaxed">
              Bird's-eye reconciliation of {data.revenues.length} milestones. Zero aggregation audit of every dollar processed this period.
            </p>
          </div>

          <div className="bg-slate-800/40 backdrop-blur-md rounded-[40px] border border-white/5 p-10 min-w-[360px] text-center lg:text-right">
             <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Final Retained Net Profit</div>
             <div className={`text-6xl md:text-7xl font-black tracking-tighter ${audit.finalProfit >= 0 ? 'text-[#10b981]' : 'text-rose-500'}`}>
               {formatCurrency(audit.finalProfit)}
             </div>
             <div className="mt-6 flex items-center justify-center lg:justify-end gap-3">
                <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${audit.finalProfit >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                  {audit.finalProfit >= 0 ? 'Profitable' : 'Loss Position'}
                </span>
             </div>
          </div>
        </div>
        <div className="absolute right-[-10%] top-[-10%] w-[500px] h-[500px] bg-blue-500/5 rounded-full blur-[120px]"></div>
      </div>

      {/* Audit Controls */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-6 no-print">
        <div className="flex items-center gap-3 bg-white border border-gray-100 p-2 rounded-[24px] shadow-sm">
           {monthOptions.slice(0, 4).map((opt) => (
             <button 
                key={opt.value}
                onClick={() => setSelectedMonth(opt.value)}
                className={`px-6 py-3 rounded-[18px] text-[10px] font-black uppercase tracking-widest transition-all ${
                  selectedMonth === opt.value ? 'bg-gray-900 text-white shadow-lg' : 'text-gray-400 hover:bg-gray-50'
                }`}
             >
               {new Date(opt.value + '-01').toLocaleDateString('default', { month: 'short', year: 'numeric' })}
             </button>
           ))}
        </div>
        
        <button 
          onClick={() => window.print()}
          className="flex items-center gap-3 bg-white border border-gray-100 text-gray-900 px-8 py-4 rounded-[24px] font-black text-[11px] uppercase tracking-widest hover:bg-gray-50 transition-all shadow-sm active:scale-95"
        >
          <Download size={18} /> Download Audit PDF
        </button>
      </div>

      {/* 2. Primary KPI Pillars */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPICard title="Gross Volume" value={audit.grossVolume} icon={<Activity />} color="emerald" sub="Total Inflow" />
        <KPICard title="Total Outflow" value={audit.totalOutflow} icon={<TrendingDown />} color="rose" sub="All Deductions" />
        <KPICard title="Fixed Burn" value={audit.totalRecurring} icon={<Repeat />} color="purple" sub="Recurring Costs" />
        <KPICard title="Payables" value={audit.totalPartnerDividendsAccrued} icon={<Users />} color="amber" sub="Partner Dividends" />
      </div>

      {/* 3. Stream & Partner Detail (Revenue Breakdown) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        
        {/* Stream Contribution Audit */}
        <div className="space-y-8">
          <div className="flex items-center gap-4 px-2">
            <div className="w-1.5 h-6 bg-blue-600 rounded-full"></div>
            <h3 className="text-2xl font-black text-gray-900 tracking-tight">Revenue Breakdown by Stream</h3>
          </div>
          
          <div className="space-y-6">
            {audit.streamBreakdown.map((stream, idx) => (
              <div key={idx} className="bg-white rounded-[40px] border border-gray-100 p-10 shadow-sm relative overflow-hidden group">
                <div className="flex items-center justify-between mb-8">
                   <div className="flex items-center gap-5">
                     <div className="w-16 h-16 bg-gray-50 rounded-[24px] flex items-center justify-center font-black text-gray-900 text-2xl border border-gray-100 group-hover:bg-gray-900 group-hover:text-white transition-all">
                       {stream.name.charAt(0)}
                     </div>
                     <div>
                       <h4 className="font-black text-xl text-gray-900">{stream.name}</h4>
                       <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{stream.count} Recorded Milestones</p>
                     </div>
                   </div>
                   <div className="text-right">
                     <span className="text-[10px] font-black text-gray-400 uppercase block mb-1">Gross</span>
                     <span className="text-3xl font-black text-gray-900">{formatCurrency(stream.gross)}</span>
                   </div>
                </div>

                <div className="space-y-6 pt-8 border-t border-gray-100">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-gray-500">Platform Service Fees</span>
                    <span className="text-xs font-bold text-rose-500">-{formatCurrency(stream.fees)}</span>
                  </div>
                  
                  {/* Detailed Partner Breakdown */}
                  <div className="bg-gray-50/50 rounded-[32px] p-8 space-y-4 border border-gray-50">
                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2">Partner Dividend Breakdown</p>
                    {Object.entries(stream.partnerDetails).map(([name, amount]: any) => (
                      <div key={name} className="flex justify-between items-center">
                        <span className="text-xs font-bold text-gray-500">• {name} Dividend Share</span>
                        <span className="text-xs font-bold text-gray-900">-{formatCurrency(amount)}</span>
                      </div>
                    ))}
                  </div>

                  {/* Deduction Analysis */}
                  <div className="flex justify-between items-center text-[10px] italic">
                    <span className="text-gray-400 font-medium">Connects & Production Overheads (Prorated)</span>
                    <span className="text-gray-400 font-bold">-{formatCurrency(stream.connectsDeduction + stream.productionDeduction)}</span>
                  </div>

                  <div className="pt-6 flex justify-between items-end border-t border-gray-50">
                    <div className="space-y-1">
                      <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest block">Stream Contribution</span>
                      <p className="text-[9px] text-gray-400 font-medium">Net profit impact from this platform</p>
                    </div>
                    <span className="text-2xl font-black text-blue-600 tracking-tighter">
                      {formatCurrency(stream.gross - stream.fees - stream.partnerSharesTotal)}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Ledger: Payables & Operating Burn */}
        <div className="space-y-12">
          
          {/* Partner Ledger */}
          <div className="space-y-8">
            <div className="flex items-center gap-4 px-2">
              <div className="w-1.5 h-6 bg-teal-500 rounded-full"></div>
              <h3 className="text-2xl font-black text-gray-900 tracking-tight">Partner Reconciliation Ledger</h3>
            </div>
            <div className="bg-white rounded-[40px] border border-gray-100 overflow-hidden shadow-sm">
              <table className="w-full text-left">
                <thead className="bg-gray-50/50 text-[9px] font-black text-gray-400 uppercase tracking-[0.3em] border-b border-gray-100">
                  <tr><th className="px-10 py-6">Partner</th><th className="px-8 py-6 text-center">Owed</th><th className="px-8 py-6 text-center">Settled</th><th className="px-10 py-6 text-right">Balance</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {audit.partnerLedger.map((p, idx) => (
                    <tr key={idx} className="hover:bg-gray-50/20 transition-all">
                      <td className="px-10 py-10">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center font-black text-sm uppercase">{p.name.charAt(0)}</div>
                          <div><p className="font-black text-gray-900 text-sm">{p.name}</p><p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{p.role}</p></div>
                        </div>
                      </td>
                      <td className="px-8 py-10 text-center font-black text-gray-900 text-sm">{formatCurrency(p.owed)}</td>
                      <td className="px-8 py-10 text-center font-black text-rose-500 text-sm">-{formatCurrency(p.paid)}</td>
                      <td className="px-10 py-10 text-right"><span className={`inline-block px-5 py-2 rounded-full text-xs font-black ${p.owed - p.paid > 0 ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'}`}>{formatCurrency(p.owed - p.paid)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Granular Operational Expenses Breakdown */}
          <div className="space-y-8">
            <div className="flex items-center gap-4 px-2">
              <div className="w-1.5 h-6 bg-rose-500 rounded-full"></div>
              <h3 className="text-2xl font-black text-gray-900 tracking-tight">Operational Burn Breakdown</h3>
            </div>
            <div className="bg-white rounded-[40px] border border-gray-100 p-10 shadow-sm space-y-10">
              
              {/* Individual Recurring Items */}
              <div className="space-y-6">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em]">Recurring Subscriptions</p>
                {audit.recurringExpensesBreakdown.map((r) => (
                  <div key={r.id} className="flex justify-between items-center p-6 bg-gray-50/50 rounded-[24px] border border-gray-50">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-violet-500 shadow-sm"><Repeat size={18} /></div>
                      <div><p className="text-sm font-black text-gray-900">{r.name}</p><p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">{r.category} • Day {r.day_of_month}</p></div>
                    </div>
                    <span className="font-black text-rose-500 text-base">-{formatCurrency(r.amount)}</span>
                  </div>
                ))}
              </div>

              {/* Individual Manual Expenses */}
              <div className="space-y-6 pt-10 border-t border-gray-100">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em]">One-off Operational Costs</p>
                {data.expenses.filter(e => !e.is_production).map((e) => (
                  <div key={e.id} className="flex justify-between items-center p-6 bg-white border border-gray-50 rounded-[24px] hover:border-gray-200 transition-all">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center text-gray-400"><CreditCard size={18} /></div>
                      <div><p className="text-sm font-black text-gray-900">{e.description}</p><p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">{e.date} • {e.category}</p></div>
                    </div>
                    <span className="font-black text-rose-500 text-base">-{formatCurrency(e.amount)}</span>
                  </div>
                ))}
              </div>

              <div className="pt-8 border-t border-gray-100 flex justify-between items-center">
                <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.4em]">Total Operational Outflow</span>
                <span className="text-3xl font-black text-rose-500 tracking-tighter">{formatCurrency(audit.totalOpEx + audit.totalRecurring)}</span>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* 4. Settlements & Adjustments (Granular Listing) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
         
         <div className="space-y-8">
           <div className="flex items-center gap-4 px-2"><div className="w-1.5 h-6 bg-indigo-600 rounded-full"></div><h3 className="text-2xl font-black text-gray-900 tracking-tight">Production Settlements</h3></div>
           <div className="bg-white rounded-[40px] border border-gray-100 overflow-hidden shadow-sm">
             <div className="p-8 border-b border-gray-50 bg-gray-50/30"><p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em]">Individual Developer Logs</p></div>
             {audit.developerPaymentsBreakdown.length === 0 ? <div className="p-16 text-center text-gray-400 italic font-medium">No settlements logged.</div> : (
               <div className="divide-y divide-gray-50">
                 {audit.developerPaymentsBreakdown.map((p) => (
                   <div key={p.id} className="p-8 flex items-center justify-between hover:bg-gray-50/50 transition-all">
                     <div className="flex items-center gap-4"><div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center font-black text-xs uppercase"><UserCheck size={18} /></div><div><p className="font-black text-gray-900 text-sm">{p.recipient}</p><p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">{p.date} • {p.method}</p></div></div>
                     <span className="font-black text-rose-500 text-base">-{formatCurrency(p.amount)}</span>
                   </div>
                 ))}
                 <div className="p-8 bg-gray-50/30 flex justify-between items-center"><span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Aggregate Production Settlement</span><span className="text-2xl font-black text-rose-500">{formatCurrency(audit.totalActualDevPaid)}</span></div>
               </div>
             )}
           </div>
         </div>

         <div className="space-y-8">
           <div className="flex items-center gap-4 px-2"><div className="w-1.5 h-6 bg-purple-600 rounded-full"></div><h3 className="text-2xl font-black text-gray-900 tracking-tight">Adjustment Integrity Logs</h3></div>
           <div className="bg-white rounded-[40px] border border-gray-100 overflow-hidden shadow-sm">
             <div className="p-8 border-b border-gray-50 bg-gray-50/30"><p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.3em]">Bonus & Adjustment Ledger</p></div>
             {audit.adjustmentsPaidBreakdown.length === 0 ? <div className="p-16 text-center text-gray-400 italic font-medium">No ad-hoc adjustments.</div> : (
               <div className="divide-y divide-gray-50">
                 {audit.adjustmentsPaidBreakdown.map((o) => (
                   <div key={o.id} className="p-8 flex items-center justify-between hover:bg-gray-50/50 transition-all">
                     <div className="flex items-center gap-4"><div className="w-10 h-10 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center font-black text-xs uppercase"><Layers size={18} /></div><div><p className="font-black text-gray-900 text-sm">{o.recipient}</p><p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider">{o.date} • {o.category}</p></div></div>
                     <div className="text-right"><span className="font-black text-rose-500 block text-base">-{formatCurrency(o.amount)}</span><p className="text-[8px] text-gray-400 font-medium truncate max-w-[140px]">{o.description}</p></div>
                   </div>
                 ))}
                 <div className="p-8 bg-gray-50/30 flex justify-between items-center"><span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Aggregate Manual Adjustments</span><span className="text-2xl font-black text-rose-500">{formatCurrency(audit.totalOtherPaid)}</span></div>
               </div>
             )}
           </div>
         </div>

      </div>

      <div className="bg-[#f8fafc] rounded-[48px] p-12 text-center border border-slate-100">
        <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.5em] mb-6">Audit Integrity Record</p>
        <div className="flex flex-wrap justify-center gap-4">
          <AuditTag label={`Outflow Ratio: ${((audit.totalOutflow / audit.grossVolume) * 100).toFixed(1)}%`} color="rose" />
          <AuditTag label={`Month Efficiency: ${((audit.finalProfit / audit.grossVolume) * 100).toFixed(1)}%`} color="emerald" />
          <AuditTag label={`Active Platforms: ${audit.streamBreakdown.length}`} color="blue" />
          <AuditTag label={`Audit Period: ${selectedMonth}`} color="slate" />
        </div>
      </div>

    </div>
  );
};

const KPICard = ({ title, value, icon, color, sub }: any) => {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-600',
    rose: 'bg-rose-50 text-rose-600',
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
    purple: 'bg-violet-50 text-violet-600'
  };
  return (
    <div className="bg-white rounded-[32px] border border-gray-100 p-8 shadow-sm group hover:shadow-xl transition-all">
      <div className={`w-14 h-14 rounded-[22px] flex items-center justify-center mb-6 transition-transform group-hover:scale-110 ${colors[color]}`}>
        {React.cloneElement(icon, { size: 28 })}
      </div>
      <h4 className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-1">{title}</h4>
      <p className={`text-3xl font-black tracking-tighter ${color === 'rose' ? 'text-rose-500' : 'text-gray-900'}`}>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)}</p>
      {sub && <p className="text-[10px] font-black text-gray-400 uppercase mt-2 tracking-tight opacity-70">{sub}</p>}
    </div>
  );
};

const AuditTag = ({ label, color }: { label: string, color: string }) => {
  const colors: Record<string, string> = {
    slate: 'bg-white border-slate-200 text-slate-600',
    rose: 'bg-rose-50 border-rose-100 text-rose-600',
    emerald: 'bg-emerald-50 border-emerald-100 text-emerald-600',
    blue: 'bg-blue-50 border-blue-100 text-blue-600'
  };
  return (
    <span className={`px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border ${colors[color]}`}>
      {label}
    </span>
  );
};

export default MonthlyClosingView;
