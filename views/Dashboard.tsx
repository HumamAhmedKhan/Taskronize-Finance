
import React, { useState, useEffect, useMemo } from 'react';
import { supabase, db } from '../lib/supabase';
import { Revenue, IncomeStream, Expense, ProductionPayment, Project, ProjectAllocation, TeamMember, OtherPayment, RecurringExpense } from '../types';
import { calculateRevenueDetails } from '../utils/calculations';
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Layers, 
  CreditCard, 
  Repeat, 
  PiggyBank, 
  CheckCircle2, 
  AlertCircle,
  Clock,
  Wallet,
  ArrowDownRight,
  ArrowUpRight,
  Activity
} from 'lucide-react';

interface DashboardProps {
  startDate: string;
  endDate: string;
}

const Dashboard: React.FC<DashboardProps> = ({ startDate, endDate }) => {
  const [data, setData] = useState<{
    revenues: Revenue[]; streams: IncomeStream[]; expenses: Expense[]; payments: ProductionPayment[];
    projects: Project[]; allocations: ProjectAllocation[]; members: TeamMember[];
    otherPayments: OtherPayment[]; recurringExpenses: RecurringExpense[];
  }>({ revenues: [], streams: [], expenses: [], payments: [], projects: [], allocations: [], members: [], otherPayments: [], recurringExpenses: [] });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [revs, streams, exps, pymts, projs, allocs, members, others, recurring] = await Promise.all([
          supabase.from('revenues').select('*').gte('date', startDate).lte('date', endDate),
          db.get<IncomeStream>('income_streams'),
          supabase.from('expenses').select('*').gte('date', startDate).lte('date', endDate),
          supabase.from('production_payments').select('*').gte('date', startDate).lte('date', endDate),
          db.get<Project>('projects'),
          db.get<ProjectAllocation>('project_allocations'),
          db.get<TeamMember>('team_members'),
          supabase.from('other_payments').select('*').gte('date', startDate).lte('date', endDate),
          supabase.from('recurring_expenses').select('*').eq('is_active', true)
        ]);
        setData({ revenues: revs.data || [], streams, expenses: exps.data || [], payments: pymts.data || [], projects: projs, allocations: allocs, members, otherPayments: others.data || [], recurringExpenses: recurring.data || [] });
      } catch (err) { console.error(err); } finally { setLoading(false); }
    };
    fetchData();
  }, [startDate, endDate]);

  const stats = useMemo(() => {
    const { revenues, streams, expenses, payments, allocations, members, otherPayments, projects, recurringExpenses } = data;
    
    // Core Sums
    const totalGross = revenues.reduce((sum: number, r) => sum + Number(r.total_sale || 0), 0);
    const totalFees = revenues.reduce((sum: number, r) => sum + (Number(r.total_sale || 0) * Number(r.platform_fee_percent || 0) / 100), 0);
    const totalOpEx = expenses.filter(e => !e.is_production).reduce((sum: number, e) => sum + Number(e.amount || 0), 0);
    const totalRec = recurringExpenses.reduce((sum: number, r) => sum + Number(r.amount || 0), 0);
    const totalDev = payments.filter(p => p.payment_type === 'developer').reduce((sum: number, p) => sum + Number(p.total_amount || 0), 0);
    const totalOtherPaid = otherPayments.filter(o => o.is_paid).reduce((sum: number, o) => sum + Number(o.amount || 0), 0);
    const totalSavings = payments.filter(p => p.payment_type === 'savings').reduce((sum: number, p) => sum + Number(p.total_amount), 0);

    // Planned Production Cost: Sum of allocations for projects in the date range
    const plannedProductionCost = allocations.filter(a => {
        const proj = projects.find(p => p.id === a.project_id);
        return proj && proj.date >= startDate && proj.date <= endDate;
    }).reduce((sum: number, a) => sum + Number(a.amount), 0);

    // Partner Logic
    const partnerTotals: Record<string, number> = {};
    members.filter(m => m.role === 'Partner').forEach(p => partnerTotals[p.name] = 0);

    revenues.forEach(rev => {
      const stream = streams.find(s => s.id === rev.income_stream_id);
      if (!stream) return;
      const details = calculateRevenueDetails(rev, stream, expenses, payments, revenues, projects, allocations, [], startDate, endDate);
      Object.entries(details.commissions).forEach(([name, amount]) => {
        if (partnerTotals[name] !== undefined) partnerTotals[name] += Number(amount);
      });
    });

    const totalPartnerComms = Object.values(partnerTotals).reduce((sum: number, val: number) => sum + val, 0);
    
    // Profit Calculation
    const totalExpenses = totalFees + totalOpEx + totalRec + totalDev + totalPartnerComms + totalOtherPaid;
    const retainedProfit = totalGross - totalExpenses;

    return { 
        totalGross, 
        totalFees, 
        totalOpEx, 
        totalRec, 
        totalDev, 
        totalSavings, 
        partnerTotals, 
        retainedProfit, 
        plannedProductionCost, 
        totalOtherPaid 
    };
  }, [data, startDate, endDate]);

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-40 gap-4">
      <div className="w-12 h-12 border-4 border-gray-900 border-t-transparent rounded-full animate-spin"></div>
      <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.4em] animate-pulse">Processing Ledger...</p>
    </div>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-700 pb-20">
      
      {/* Hero Section: Net Profit */}
      <div className="bg-white rounded-[32px] p-12 text-center border border-gray-200 shadow-sm relative overflow-hidden">
        <div className="relative z-10">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Net Profit</p>
          <h1 className={`text-6xl md:text-8xl font-black tracking-tighter mb-8 ${stats.retainedProfit >= 0 ? 'text-[#047857]' : 'text-rose-600'}`}>
            {formatCurrency(stats.retainedProfit)}
          </h1>
          <div className="flex justify-center">
            <span className={`px-6 py-2 rounded-full text-xs font-black uppercase tracking-widest flex items-center gap-2 ${stats.retainedProfit >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
              <TrendingUp size={16} /> {stats.retainedProfit >= 0 ? 'Profitable' : 'Loss Position'}
            </span>
          </div>
        </div>
      </div>

      {/* Main Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
        <DashboardCard 
          title="Total Gross Revenue"
          value={stats.totalGross}
          icon={<DollarSign size={20} />}
          iconBg="bg-emerald-50 text-emerald-600"
          valueColor="text-gray-900"
        />

        <DashboardCard 
          title="Planned Production Cost"
          value={stats.plannedProductionCost}
          subtext="ALLOCATED IN PROJECTS"
          icon={<Clock size={20} />}
          iconBg="bg-indigo-50 text-indigo-600"
          valueColor="text-gray-900"
        />

        <DashboardCard 
          title="Actual Production Cost"
          value={stats.totalDev}
          subtext="REALIZED VIA SETTLEMENTS"
          icon={<Layers size={20} />}
          iconBg="bg-rose-50 text-rose-500"
          valueColor="text-rose-600"
        />

        <DashboardCard 
          title="Platform Service Fees"
          value={stats.totalFees}
          icon={<ArrowDownRight size={20} />}
          iconBg="bg-rose-50 text-rose-500"
          valueColor="text-rose-600"
        />

        <DashboardCard 
          title="Regular Expenses"
          value={stats.totalOpEx + stats.totalRec}
          icon={<CreditCard size={20} />}
          iconBg="bg-rose-50 text-rose-500"
          valueColor="text-rose-600"
        />

        <DashboardCard 
          title="Other Paid Items"
          value={stats.totalOtherPaid}
          subtext="BONUSES, ADVANCES, ETC."
          icon={<Wallet size={20} />}
          iconBg="bg-purple-50 text-purple-600"
          valueColor="text-rose-600"
        />

      </div>

      {/* Partner Breakdown Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {Object.entries(stats.partnerTotals).map(([name, amount]) => (
          <div key={name} className="bg-white rounded-[24px] border border-gray-200 p-8 flex justify-between items-center shadow-sm">
            <div>
               <p className="text-gray-500 font-bold text-sm mb-1">{name}</p>
               <h3 className="text-3xl font-black text-rose-600 tracking-tight">{formatCurrency(amount as number)}</h3>
            </div>
            <div className="w-12 h-12 bg-rose-50 text-rose-500 rounded-xl flex items-center justify-center">
              <ArrowUpRight size={24} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

interface DashboardCardProps {
  title: string;
  value: number;
  subtext?: string;
  icon: React.ReactNode;
  iconBg: string;
  valueColor: string;
}

const DashboardCard: React.FC<DashboardCardProps> = ({ title, value, subtext, icon, iconBg, valueColor }) => {
  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
  
  return (
    <div className="bg-white rounded-[24px] border border-gray-200 p-8 shadow-sm flex flex-col justify-between h-full">
      <div className="flex justify-between items-start mb-6">
        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <h3 className={`text-3xl font-black tracking-tight ${valueColor}`}>{formatCurrency(value)}</h3>
        </div>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${iconBg}`}>
          {icon}
        </div>
      </div>
      {subtext && (
        <div className="pt-4 border-t border-gray-50">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{subtext}</p>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
