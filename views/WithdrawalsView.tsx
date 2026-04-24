
import React, { useState, useEffect, useMemo } from 'react';
import { supabase, db } from '../lib/supabase';
import { IncomeStream, Revenue, ProductionPayment, LocalBankExpense, RecurringExpense } from '../types';
import {
  Plus, Trash2, Eye, X, Landmark, ArrowRight, DollarSign,
  Building2, AlertCircle, ChevronDown, Check, Loader2
} from 'lucide-react';

interface Bank {
  id: number;
  name: string;
  type: 'us' | 'local';
  account_number: string | null;
  currency: string;
  balance: number;
  created_at: string;
}

interface SettlementItem {
  id: number;
  recipient_name: string;
  usd_amount: number;
  pkr_rate: number;
  pkr_amount: number;
  type: 'partner' | 'team';
}

interface Withdrawal {
  id: number;
  from_type: 'platform' | 'bank';
  from_id: string;
  to_type: 'bank';
  to_id: number;
  usd_amount: number;
  local_amount: number | null;
  exchange_rate: number | null;
  fee_type: 'percentage' | 'fixed' | null;
  fee_value: number;
  fee_amount: number;
  net_amount: number | null;
  status: 'pending' | 'completed' | 'cancelled';
  settlement_ids: (number | SettlementItem)[];
  date: string;
  created_at: string;
}

const fmt = (n: number, decimals = 2) =>
  n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

const fmtPKR = (n: number) =>
  n.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

function normalizeIds(raw: any): (number | SettlementItem)[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}
function extractSettlementIds(ids: any): number[] {
  return normalizeIds(ids).map(s => (typeof s === 'number' ? s : s.id));
}
function extractSettlementItems(ids: any): SettlementItem[] {
  return normalizeIds(ids).filter((s): s is SettlementItem => typeof s !== 'number');
}
function totalPkrOut(ids: any): number {
  return extractSettlementItems(ids).reduce((sum, s) => sum + s.pkr_amount, 0);
}

// Deterministic color palette from platform name string
const PLATFORM_PALETTES = [
  { border: '#6366f1', bg: '#eef2ff', text: '#4f46e5' },
  { border: '#0ea5e9', bg: '#f0f9ff', text: '#0284c7' },
  { border: '#10b981', bg: '#ecfdf5', text: '#059669' },
  { border: '#f59e0b', bg: '#fffbeb', text: '#d97706' },
  { border: '#ef4444', bg: '#fef2f2', text: '#dc2626' },
  { border: '#8b5cf6', bg: '#f5f3ff', text: '#7c3aed' },
  { border: '#ec4899', bg: '#fdf2f8', text: '#db2777' },
  { border: '#14b8a6', bg: '#f0fdfa', text: '#0d9488' },
];

function platformColor(name: string) {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h) ^ name.charCodeAt(i);
  return PLATFORM_PALETTES[Math.abs(h) % PLATFORM_PALETTES.length];
}

const WithdrawalsView: React.FC = () => {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [incomeStreams, setIncomeStreams] = useState<IncomeStream[]>([]);
  const [revenues, setRevenues] = useState<Revenue[]>([]);
  const [payments, setPayments] = useState<ProductionPayment[]>([]);
  const [loading, setLoading] = useState(true);

  // Withdraw modal state
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [wForm, setWForm] = useState({
    from_type: '' as 'platform' | 'bank' | '',
    from_id: '',
    to_id: '' as string,
    usd_amount: '',
    exchange_rate: '',
    fee_type: 'fixed' as 'percentage' | 'fixed',
    fee_value: '',
    date: new Date().toISOString().split('T')[0],
    settlement_ids: [] as number[],
  });
  const [wLoading, setWLoading] = useState(false);

  // Add bank modal
  const [showAddBank, setShowAddBank] = useState(false);
  const [bankForm, setBankForm] = useState({ name: '', type: 'us' as 'us' | 'local', account_number: '' });
  const [bankLoading, setBankLoading] = useState(false);

  // Detail modal
  const [detailWithdrawal, setDetailWithdrawal] = useState<Withdrawal | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  // Local bank expenses
  const [localBankExpenses, setLocalBankExpenses] = useState<LocalBankExpense[]>([]);
  const [recurringPlans, setRecurringPlans] = useState<RecurringExpense[]>([]);
  const [lbeForm, setLbeForm] = useState({
    source: 'manual' as 'recurring' | 'manual',
    recurring_expense_id: '',
    description: '',
    pkr_amount: '',
    bank_id: '',
  });
  const [lbeLoading, setLbeLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [streamsData, revsData, paymentsData] = await Promise.all([
        db.get<IncomeStream>('income_streams'),
        db.get<Revenue>('revenues'),
        db.get<ProductionPayment>('production_payments'),
      ]);
      setIncomeStreams(streamsData || []);
      setRevenues(revsData || []);
      setPayments(paymentsData || []);
    } catch (err) {
      console.error('Error loading core data:', err);
    }

    // Load new tables separately so a missing table/RLS error doesn't zero out revenue data
    try {
      const banksData = await db.get<Bank>('banks');
      setBanks(banksData || []);
    } catch (err) {
      console.error('Error loading banks (table may not exist):', err);
    }

    try {
      const withdrawalsData = await db.get<Withdrawal>('withdrawals');
      setWithdrawals(withdrawalsData || []);
    } catch (err) {
      console.error('Error loading withdrawals (table may not exist):', err);
    }

    try {
      const [lbeData, recPlansData] = await Promise.all([
        supabase.from('local_bank_expenses').select('*').order('date', { ascending: false }),
        supabase.from('recurring_expenses').select('*').eq('is_active', true),
      ]);
      setLocalBankExpenses(lbeData.data || []);
      setRecurringPlans(recPlansData.data || []);
    } catch (err) {
      console.error('Error loading local bank expenses:', err);
    }

    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  // Platform balance = sum(net revenues for stream) - sum(non-cancelled withdrawals.usd_amount from that platform)
  const platformBalances = useMemo(() => {
    return incomeStreams.map(stream => {
      const streamRevs = revenues.filter(r => Number(r.income_stream_id) === stream.id);
      const netRevenue = streamRevs.reduce((s, r) => {
        const fee = Number(r.platform_fee_percent ?? stream.platform_fee_percent ?? 0);
        return s + Number(r.total_sale) * (1 - fee / 100);
      }, 0);
      const withdrawn = withdrawals
        .filter(w => w.from_type === 'platform' && w.from_id === String(stream.id) && w.status !== 'cancelled')
        .reduce((s, w) => s + Number(w.usd_amount), 0);
      return { stream, balance: netRevenue - withdrawn };
    });
  }, [incomeStreams, revenues, withdrawals]);

  const usBanks = useMemo(() => banks.filter(b => b.type === 'us'), [banks]);
  const localBanks = useMemo(() => banks.filter(b => b.type === 'local'), [banks]);

  // Derived fee amount
  const derivedFee = useMemo(() => {
    const amt = parseFloat(wForm.usd_amount) || 0;
    const val = parseFloat(wForm.fee_value) || 0;
    if (wForm.fee_type === 'percentage') return amt * val / 100;
    return val;
  }, [wForm.usd_amount, wForm.fee_value, wForm.fee_type]);

  const derivedNet = useMemo(() => {
    const amt = parseFloat(wForm.usd_amount) || 0;
    return Math.max(0, amt - derivedFee);
  }, [wForm.usd_amount, derivedFee]);

  const derivedLocal = useMemo(() => {
    const rate = parseFloat(wForm.exchange_rate) || 0;
    return derivedNet * rate;
  }, [derivedNet, wForm.exchange_rate]);

  // Available payments for settlement tags (US bank → local bank only)
  const availablePayments = useMemo(() => {
    const settledIds = new Set(
      withdrawals
        .filter(w => w.status !== 'cancelled')
        .flatMap(w => extractSettlementIds(w.settlement_ids || []))
    );
    return payments.filter(p => !settledIds.has(p.id));
  }, [payments, withdrawals]);

  // Live PKR breakdown for withdrawal modal
  const pkrSummary = useMemo(() => {
    if (wForm.from_type !== 'bank' || wForm.settlement_ids.length === 0) return null;
    const rate = parseFloat(wForm.exchange_rate) || 0;
    let pkrToPartners = 0;
    let pkrToTeam = 0;
    wForm.settlement_ids.forEach(id => {
      const p = payments.find(pm => pm.id === id);
      if (!p) return;
      const isPartner = p.payment_type === 'partner';
      const pkrRate = isPartner ? rate : 275;
      if (isPartner) pkrToPartners += p.total_amount * pkrRate;
      else pkrToTeam += p.total_amount * pkrRate;
    });
    const totalOut = pkrToPartners + pkrToTeam;
    const pkrAddedToBank = derivedLocal - totalOut;
    return { pkrToPartners, pkrToTeam, totalOut, pkrAddedToBank, rate };
  }, [wForm.from_type, wForm.settlement_ids, wForm.exchange_rate, payments, derivedLocal]);

  // From dropdown options grouped
  const fromOptions = useMemo(() => {
    const platforms = platformBalances.filter(pb => pb.balance > 0.005).map(pb => ({
      type: 'platform' as const,
      id: String(pb.stream.id),
      label: pb.stream.name,
      balance: pb.balance,
      currency: 'USD',
    }));
    const usBankOpts = usBanks.map(b => ({
      type: 'bank' as const,
      id: String(b.id),
      label: b.name,
      balance: b.balance,
      currency: 'USD',
    }));
    return [...platforms, ...usBankOpts];
  }, [platformBalances, usBanks]);

  // To dropdown options based on From selection
  const toOptions = useMemo(() => {
    if (wForm.from_type === 'platform') {
      return usBanks.map(b => ({ id: String(b.id), label: b.name, type: 'us' }));
    }
    if (wForm.from_type === 'bank') {
      return localBanks.map(b => ({ id: String(b.id), label: b.name, type: 'local' }));
    }
    return [];
  }, [wForm.from_type, usBanks, localBanks]);

  const selectedFrom = fromOptions.find(o => o.type === wForm.from_type && o.id === wForm.from_id);
  const isToLocal = wForm.from_type === 'bank';

  const openWithdrawModal = () => {
    setWForm({
      from_type: '', from_id: '', to_id: '',
      usd_amount: '', exchange_rate: '', fee_type: 'fixed', fee_value: '',
      date: new Date().toISOString().split('T')[0],
      settlement_ids: [],
    });
    setShowWithdrawModal(true);
  };

  const handleFromChange = (opt: typeof fromOptions[0] | undefined) => {
    if (!opt) {
      setWForm(f => ({ ...f, from_type: '', from_id: '', to_id: '' }));
      return;
    }
    setWForm(f => ({ ...f, from_type: opt.type, from_id: opt.id, to_id: '' }));
  };

  const validateWithdraw = () => {
    if (!wForm.from_type || !wForm.from_id) return 'Select a source.';
    if (!wForm.to_id) return 'Select a destination.';
    const amt = parseFloat(wForm.usd_amount);
    if (!amt || amt <= 0) return 'Enter a valid USD amount.';
    if (selectedFrom && amt > selectedFrom.balance + 0.001) return `Amount exceeds available balance ($${fmt(selectedFrom.balance)}).`;
    if (isToLocal && !parseFloat(wForm.exchange_rate)) return 'Enter exchange rate.';
    return null;
  };

  const handleWithdraw = async () => {
    const err = validateWithdraw();
    if (err) { alert(err); return; }
    setWLoading(true);
    try {
      const usdAmount = parseFloat(wForm.usd_amount);
      const feeAmount = derivedFee;
      const netAmount = derivedNet;
      const localAmount = isToLocal ? derivedLocal : null;
      const exchangeRate = isToLocal ? parseFloat(wForm.exchange_rate) : null;
      const toId = parseInt(wForm.to_id);

      // Build rich settlement objects when US bank → local bank
      let settlementPayload: (number | SettlementItem)[] = wForm.settlement_ids;
      let totalPkrPaidOut = 0;
      if (isToLocal && wForm.settlement_ids.length > 0 && exchangeRate) {
        const items: SettlementItem[] = wForm.settlement_ids.map(id => {
          const p = payments.find(pm => pm.id === id);
          const isPartner = p?.payment_type === 'partner';
          const pkrRate = isPartner ? exchangeRate : 275;
          const pkrAmount = (p?.total_amount ?? 0) * pkrRate;
          totalPkrPaidOut += pkrAmount;
          return {
            id,
            recipient_name: p?.recipient_name ?? `Payment #${id}`,
            usd_amount: p?.total_amount ?? 0,
            pkr_rate: pkrRate,
            pkr_amount: pkrAmount,
            type: isPartner ? 'partner' : 'team',
          };
        });
        settlementPayload = items;
      }

      const netPkrRemaining = isToLocal ? (localAmount ?? 0) - totalPkrPaidOut : null;

      const newWithdrawal = {
        from_type: wForm.from_type,
        from_id: wForm.from_id,
        to_type: 'bank',
        to_id: toId,
        usd_amount: usdAmount,
        local_amount: localAmount,
        exchange_rate: exchangeRate,
        fee_type: parseFloat(wForm.fee_value) > 0 ? wForm.fee_type : null,
        fee_value: parseFloat(wForm.fee_value) || 0,
        fee_amount: feeAmount,
        net_amount: netAmount,
        status: 'completed',
        settlement_ids: settlementPayload,
        date: wForm.date,
      };

      const srcBank = wForm.from_type === 'bank' ? banks.find(b => b.id === parseInt(wForm.from_id)) : null;
      const dstDelta = isToLocal ? (netPkrRemaining ?? localAmount ?? 0) : netAmount;

      const { error: rpcErr } = await supabase.rpc('process_withdrawal', {
        p_from_type:      newWithdrawal.from_type,
        p_from_id:        newWithdrawal.from_id,
        p_to_type:        newWithdrawal.to_type,
        p_to_id:          newWithdrawal.to_id,
        p_usd_amount:     newWithdrawal.usd_amount,
        p_local_amount:   newWithdrawal.local_amount,
        p_exchange_rate:  newWithdrawal.exchange_rate,
        p_fee_type:       newWithdrawal.fee_type,
        p_fee_value:      newWithdrawal.fee_value,
        p_fee_amount:     newWithdrawal.fee_amount,
        p_net_amount:     newWithdrawal.net_amount,
        p_status:         newWithdrawal.status,
        p_settlement_ids: JSON.stringify(newWithdrawal.settlement_ids),
        p_date:           newWithdrawal.date,
        p_src_bank_id:    srcBank?.id ?? null,
        p_src_delta:      srcBank ? -usdAmount : 0,
        p_dst_delta:      dstDelta,
      });
      if (rpcErr) throw rpcErr;

      setShowWithdrawModal(false);
      await loadData();
    } catch (err: any) {
      console.error(err);
      alert(`Error: ${err?.message || JSON.stringify(err)}`);
    } finally {
      setWLoading(false);
    }
  };

  const handleAddBank = async () => {
    if (!bankForm.name.trim()) { alert('Bank name is required.'); return; }
    setBankLoading(true);
    try {
      const { error } = await supabase.from('banks').insert([{
        name: bankForm.name.trim(),
        type: bankForm.type,
        account_number: bankForm.account_number.trim() || null,
        currency: bankForm.type === 'us' ? 'USD' : 'PKR',
        balance: 0,
      }]);
      if (error) throw error;
      setBankForm({ name: '', type: 'us', account_number: '' });
      setShowAddBank(false);
      await loadData();
    } catch (err: any) {
      console.error('Add bank error:', err);
      alert(`Error saving bank: ${err?.message || JSON.stringify(err)}`);
    } finally {
      setBankLoading(false);
    }
  };

  const handleDeleteBank = async (bank: Bank) => {
    const hasPending = withdrawals.some(
      w => (w.to_id === bank.id || (w.from_type === 'bank' && w.from_id === String(bank.id))) && w.status === 'pending'
    );
    if (hasPending) { alert('Cannot delete: bank has pending transactions.'); return; }
    if (Math.abs(bank.balance) > 0.01) { alert('Cannot delete: bank has a non-zero balance.'); return; }
    if (!confirm(`Delete bank "${bank.name}"?`)) return;
    await supabase.from('banks').delete().eq('id', bank.id);
    await loadData();
  };

  const handleCancelWithdrawal = async (w: Withdrawal) => {
    if (!confirm('Cancel this withdrawal? Balances will be restored.')) return;
    setCancelLoading(true);
    try {
      const srcBank = w.from_type === 'bank' ? banks.find(b => b.id === parseInt(w.from_id)) : null;
      const destBank = banks.find(b => b.id === w.to_id);
      const isLocal = destBank?.type === 'local';
      const pkrPaidOut = totalPkrOut(w.settlement_ids || []);
      const removeAmount = isLocal ? (w.local_amount ?? 0) - pkrPaidOut : (w.net_amount ?? 0);

      const { error: rpcErr } = await supabase.rpc('cancel_withdrawal', {
        p_withdrawal_id: w.id,
        p_src_bank_id:   srcBank?.id ?? null,
        p_src_delta:     srcBank ? w.usd_amount : 0,
        p_dst_delta:     -removeAmount,
      });
      if (rpcErr) throw rpcErr;

      setDetailWithdrawal(null);
      await loadData();
    } catch (err: any) {
      alert(`Error: ${err?.message}`);
    } finally {
      setCancelLoading(false);
    }
  };

  const handleSourceChange = (src: 'recurring' | 'manual') => {
    setLbeForm({ source: src, recurring_expense_id: '', description: '', pkr_amount: '', bank_id: lbeForm.bank_id });
  };

  const handleRecurringSelect = (recId: string) => {
    const plan = recurringPlans.find(r => r.id === parseInt(recId));
    setLbeForm(f => ({
      ...f,
      recurring_expense_id: recId,
      description: plan ? plan.name : f.description,
      pkr_amount: plan ? String(Math.round(plan.amount * 275)) : f.pkr_amount,
    }));
  };

  const handleRecordLocalExpense = async () => {
    const bankId = parseInt(lbeForm.bank_id);
    const pkrAmount = parseFloat(lbeForm.pkr_amount);
    if (!bankId || !pkrAmount || pkrAmount <= 0 || !lbeForm.description.trim()) {
      alert('Please fill all required fields.');
      return;
    }
    const bank = banks.find(b => b.id === bankId);
    if (!bank) { alert('Bank not found.'); return; }
    setLbeLoading(true);
    try {
      const { error: insertErr } = await supabase.from('local_bank_expenses').insert({
        bank_id: bankId,
        source: lbeForm.source,
        recurring_expense_id: lbeForm.source === 'recurring' && lbeForm.recurring_expense_id
          ? parseInt(lbeForm.recurring_expense_id)
          : null,
        description: lbeForm.description,
        pkr_amount: pkrAmount,
        date: new Date().toISOString().split('T')[0],
      });
      if (insertErr) throw insertErr;

      const { error: bankErr } = await supabase
        .from('banks')
        .update({ balance: bank.balance - pkrAmount })
        .eq('id', bankId);
      if (bankErr) throw bankErr;

      if (lbeForm.source === 'recurring' && lbeForm.recurring_expense_id) {
        const { error: recErr } = await supabase
          .from('recurring_expenses')
          .update({ paid_at: new Date().toISOString() })
          .eq('id', parseInt(lbeForm.recurring_expense_id));
        if (recErr) throw recErr;
      }

      setLbeForm({ source: 'manual', recurring_expense_id: '', description: '', pkr_amount: '', bank_id: '' });
      await loadData();
    } catch (err: any) {
      alert(`Error: ${err?.message || JSON.stringify(err)}`);
    } finally {
      setLbeLoading(false);
    }
  };

  const isMarkedPaidThisMonth = (lbe: LocalBankExpense): boolean => {
    if (lbe.source !== 'recurring' || !lbe.recurring_expense_id) return false;
    const plan = recurringPlans.find(r => r.id === lbe.recurring_expense_id);
    if (!plan?.paid_at) return false;
    const paidAt = new Date(plan.paid_at);
    const now = new Date();
    return paidAt.getMonth() === now.getMonth() && paidAt.getFullYear() === now.getFullYear();
  };

  const getFromLabel = (w: Withdrawal) => {
    if (w.from_type === 'platform') {
      const s = incomeStreams.find(s => s.id === parseInt(w.from_id));
      return s?.name ?? `Stream ${w.from_id}`;
    }
    const b = banks.find(b => b.id === parseInt(w.from_id));
    return b?.name ?? `Bank ${w.from_id}`;
  };

  const getToLabel = (w: Withdrawal) => {
    const b = banks.find(b => b.id === w.to_id);
    return b?.name ?? `Bank ${w.to_id}`;
  };

  const statusBadge = (status: Withdrawal['status']) => {
    if (status === 'completed') return <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-md text-[10px] font-bold uppercase">Completed</span>;
    if (status === 'pending') return <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-md text-[10px] font-bold uppercase">Pending</span>;
    return <span className="px-2 py-0.5 bg-slate-100 text-slate-400 rounded-md text-[10px] font-bold uppercase">Cancelled</span>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-slate-400" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-16">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Withdrawals</h2>
          <p className="text-slate-500">Manage platform withdrawals and bank balances.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowAddBank(true)}
            className="flex items-center gap-2 border border-slate-300 text-slate-700 px-4 py-2.5 rounded-xl font-bold hover:bg-slate-50 transition-all"
          >
            <Plus size={18} />
            Add Bank
          </button>
          <button
            onClick={openWithdrawModal}
            className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 rounded-xl font-bold hover:bg-slate-800 transition-all"
          >
            <ArrowRight size={18} />
            New Withdrawal
          </button>
        </div>
      </div>

      {/* Platform Balances */}
      {platformBalances.some(pb => pb.balance > 0) && (
        <section>
          <h3 className="text-sm font-semibold text-slate-500 mb-3">Platform Balances</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {platformBalances.filter(pb => pb.balance > 0).map(({ stream, balance }) => {
              const col = platformColor(stream.platform || stream.name);
              const healthDot = balance > 500
                ? { background: 'var(--color-success, #22c55e)' }
                : { background: 'var(--color-warning, #f59e0b)' };
              return (
                <div
                  key={stream.id}
                  className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 overflow-hidden"
                  style={{ borderLeft: `4px solid ${col.border}` }}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span
                        className="inline-block px-2 py-0.5 rounded text-[10px] font-bold mb-1.5"
                        style={{ background: col.bg, color: col.text }}
                      >
                        {stream.platform || 'Platform'}
                      </span>
                      <p className="text-base font-bold text-slate-800">{stream.name}</p>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="w-2 h-2 rounded-full" style={healthDot} />
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: col.bg }}>
                        <DollarSign size={16} style={{ color: col.text }} />
                      </div>
                    </div>
                  </div>
                  <p className="text-2xl font-black mt-3 text-slate-900">${fmt(balance)}</p>
                  <p className="text-xs text-slate-400 mt-1">Available USD</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* US Banks */}
      <section>
        <h3 className="text-sm font-semibold text-slate-500 mb-3">US Bank Accounts <span className="text-slate-400 font-normal">(USD)</span></h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {usBanks.map(bank => (
            <div
              key={bank.id}
              className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100"
              style={{ borderLeft: '4px solid var(--color-us-bank, #3b82f6)' }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-base font-bold text-slate-800">{bank.name}</p>
                  {bank.account_number && <p className="text-xs text-slate-400 mt-0.5">···{bank.account_number.slice(-4)}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center">
                    <Building2 size={18} className="text-blue-500" />
                  </div>
                  <button onClick={() => handleDeleteBank(bank)} className="text-slate-300 hover:text-red-500 transition-colors">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <p className="text-2xl font-black mt-3 text-slate-900">${fmt(bank.balance)}</p>
              <p className="text-xs text-slate-400 mt-1">USD Balance</p>
            </div>
          ))}
          {usBanks.length === 0 && (
            <div className="col-span-3 flex flex-col items-center justify-center py-12 text-slate-400">
              <Building2 size={28} className="mb-2 opacity-30" />
              <p className="text-sm">No US bank accounts added yet.</p>
              <p className="text-xs mt-1">Click <span className="font-semibold">Add Bank</span> to get started.</p>
            </div>
          )}
        </div>
      </section>

      {/* Divider */}
      <div className="border-t border-dashed border-slate-200" />

      {/* Local Banks */}
      <section>
        <h3 className="text-sm font-semibold text-slate-500 mb-3">Local Bank Accounts <span className="text-slate-400 font-normal">(PKR)</span></h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {localBanks.map(bank => {
            const lastW = [...withdrawals]
              .filter(w => w.to_id === bank.id && w.status !== 'cancelled' && w.local_amount != null)
              .sort((a, b) => b.date.localeCompare(a.date))[0];
            const lastPkrIn = lastW ? (lastW.local_amount ?? 0) - totalPkrOut(lastW.settlement_ids || []) : null;
            const lastPkrOut = lastW ? totalPkrOut(lastW.settlement_ids || []) : null;
            return (
              <div
                key={bank.id}
                className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100"
                style={{ borderLeft: '4px solid var(--color-local-bank, #22c55e)' }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-base font-bold text-slate-800">{bank.name}</p>
                    {bank.account_number && <p className="text-xs text-slate-400 mt-0.5">···{bank.account_number.slice(-4)}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 bg-green-50 rounded-xl flex items-center justify-center">
                      <Landmark size={18} className="text-green-500" />
                    </div>
                    <button onClick={() => handleDeleteBank(bank)} className="text-slate-300 hover:text-red-500 transition-colors">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <p className="text-2xl font-black mt-3 text-slate-900">PKR {fmtPKR(bank.balance)}</p>
                {lastW && lastPkrIn !== null && lastPkrOut !== null ? (
                  <p className="text-xs text-slate-400 mt-1">
                    Last: <span className="text-emerald-600 font-medium">PKR {fmtPKR(lastPkrIn)} in</span>
                    {lastPkrOut > 0 && <> · <span className="text-red-400 font-medium">PKR {fmtPKR(lastPkrOut)} out</span></>}
                  </p>
                ) : (
                  <p className="text-xs text-slate-400 mt-1">PKR Balance</p>
                )}
              </div>
            );
          })}
          {localBanks.length === 0 && (
            <div className="col-span-3 flex flex-col items-center justify-center py-12 text-slate-400">
              <Landmark size={28} className="mb-2 opacity-30" />
              <p className="text-sm">No local bank accounts added yet.</p>
              <p className="text-xs mt-1">Click <span className="font-semibold">Add Bank</span> to get started.</p>
            </div>
          )}
        </div>
      </section>

      {/* Divider */}
      <div className="border-t border-dashed border-slate-200" />

      {/* Local Bank Expenses */}
      <section>
        <h3 className="text-sm font-semibold text-slate-500 mb-3">Local Bank Expenses</h3>

        {/* Form bar */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 mb-4">
          {/* Row 1: Source toggle */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => handleSourceChange('recurring')}
              className={`rounded-xl py-2 px-4 text-sm font-bold transition-colors ${
                lbeForm.source === 'recurring'
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              Recurring
            </button>
            <button
              onClick={() => handleSourceChange('manual')}
              className={`rounded-xl py-2 px-4 text-sm font-bold transition-colors ${
                lbeForm.source === 'manual'
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              Manual
            </button>
          </div>

          {/* Row 2: Fields */}
          <div className="flex flex-wrap gap-3">
            {lbeForm.source === 'recurring' ? (
              <>
                <select
                  value={lbeForm.recurring_expense_id}
                  onChange={e => handleRecurringSelect(e.target.value)}
                  className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  <option value="">Select subscription...</option>
                  {recurringPlans.map(plan => (
                    <option key={plan.id} value={String(plan.id)}>
                      {plan.name} — ${plan.amount}/month
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  value={lbeForm.pkr_amount}
                  readOnly
                  className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  placeholder="PKR amount"
                />
              </>
            ) : (
              <input
                type="number"
                value={lbeForm.pkr_amount}
                onChange={e => setLbeForm(f => ({ ...f, pkr_amount: e.target.value }))}
                className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
                placeholder="PKR amount"
              />
            )}
            <input
              type="text"
              placeholder="Note..."
              value={lbeForm.description}
              onChange={e => setLbeForm(f => ({ ...f, description: e.target.value }))}
              className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
            <select
              value={lbeForm.bank_id}
              onChange={e => setLbeForm(f => ({ ...f, bank_id: e.target.value }))}
              className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="">Select bank...</option>
              {localBanks.map(bank => (
                <option key={bank.id} value={String(bank.id)}>
                  {bank.name}
                </option>
              ))}
            </select>
            <button
              onClick={handleRecordLocalExpense}
              disabled={lbeLoading}
              className="bg-slate-900 text-white px-4 py-2.5 rounded-xl font-bold text-sm hover:bg-slate-800 transition-all disabled:opacity-60 flex items-center gap-2"
            >
              {lbeLoading ? <Loader2 size={16} className="animate-spin" /> : null}
              Record & Deduct
            </button>
          </div>
        </div>

        {/* Log table */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          {localBankExpenses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <p className="text-sm">No local bank expenses recorded yet.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50/60 border-b border-slate-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">Description</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">Type</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400">PKR Amount</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400">USD Equiv</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">Bank</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400">Status</th>
                </tr>
              </thead>
              <tbody>
                {localBankExpenses.map((lbe, idx) => (
                  <tr
                    key={lbe.id}
                    className={`border-b border-slate-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}
                  >
                    <td className="px-4 py-3 text-xs text-slate-500">{lbe.date}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{lbe.description}</td>
                    <td className="px-4 py-3">
                      {lbe.source === 'recurring' ? (
                        <span className="px-2 py-0.5 bg-violet-100 text-violet-700 rounded text-[10px] font-bold uppercase">
                          Recurring
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-bold uppercase">
                          Manual
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-red-500">
                      −PKR {fmtPKR(lbe.pkr_amount)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500 text-sm">
                      ${fmt(lbe.usd_equivalent)}
                    </td>
                    <td className="px-4 py-3 text-slate-800">
                      {banks.find(b => b.id === lbe.bank_id)?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      {isMarkedPaidThisMonth(lbe) ? (
                        <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-bold">
                          ✓ Marked paid
                        </span>
                      ) : lbe.source === 'recurring' ? (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-bold">
                          Paid (prior)
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Transaction History */}
      <section>
        <h3 className="text-sm font-semibold text-slate-500 mb-3">Transaction History</h3>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          {withdrawals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <ArrowRight size={28} className="mb-2 opacity-30" />
              <p className="text-sm">No transactions yet.</p>
              <p className="text-xs mt-1">Process a withdrawal to see it here.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60">
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-400">Date</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-400">From</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-400">To</th>
                  <th className="px-5 py-3.5 text-right text-xs font-semibold text-slate-400">USD Amount</th>
                  <th className="px-5 py-3.5 text-right text-xs font-semibold text-slate-400">Net USD</th>
                  <th className="px-5 py-3.5 text-right text-xs font-semibold text-slate-400">Local</th>
                  <th className="px-5 py-3.5 text-center text-xs font-semibold text-slate-400">Status</th>
                  <th className="px-5 py-3.5" />
                </tr>
              </thead>
              <tbody>
                {[...withdrawals].sort((a, b) => b.date.localeCompare(a.date)).map((w, idx) => (
                  <tr
                    key={w.id}
                    className={`border-b border-slate-50 hover:bg-blue-50/30 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}
                  >
                    <td className="px-5 py-3.5 text-slate-600 whitespace-nowrap">{w.date}</td>
                    <td className="px-5 py-3.5 font-medium text-slate-800">{getFromLabel(w)}</td>
                    <td className="px-5 py-3.5 text-slate-600">{getToLabel(w)}</td>
                    <td className="px-5 py-3.5 text-right font-bold text-slate-800">${fmt(w.usd_amount)}</td>
                    <td className="px-5 py-3.5 text-right text-slate-600">${fmt(w.net_amount ?? w.usd_amount)}</td>
                    <td className="px-5 py-3.5 text-right text-slate-500">
                      {w.local_amount != null ? `PKR ${fmtPKR(w.local_amount)}` : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-center">{statusBadge(w.status)}</td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => setDetailWithdrawal(w)}
                        className="text-slate-400 hover:text-blue-500 transition-colors"
                      >
                        <Eye size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ── Withdraw Modal ── */}
      {showWithdrawModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" style={{ maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-800">New Withdrawal</h3>
              <button onClick={() => setShowWithdrawModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-5" style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
              {/* From */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">From</label>
                <div className="relative">
                  <select
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-800 appearance-none focus:outline-none focus:ring-2 focus:ring-slate-900"
                    value={wForm.from_type && wForm.from_id ? `${wForm.from_type}:${wForm.from_id}` : ''}
                    onChange={e => {
                      const val = e.target.value;
                      if (!val) { handleFromChange(undefined); return; }
                      const [type, id] = val.split(':');
                      const opt = fromOptions.find(o => o.type === type && o.id === id);
                      handleFromChange(opt);
                    }}
                  >
                    <option value="">Select source...</option>
                    <optgroup label="Platforms">
                      {platformBalances.filter(pb => pb.balance > 0.005).map(pb => (
                        <option key={`platform:${pb.stream.id}`} value={`platform:${pb.stream.id}`}>
                          {pb.stream.name} — ${fmt(pb.balance)}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="US Banks">
                      {usBanks.map(b => (
                        <option key={`bank:${b.id}`} value={`bank:${b.id}`}>
                          {b.name} — ${fmt(b.balance)}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                  <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
                {selectedFrom && (
                  <p className="text-xs text-slate-400 mt-1">Available: <span className="font-bold text-slate-600">${fmt(selectedFrom.balance)}</span></p>
                )}
              </div>

              {/* To */}
              {(wForm.from_type === 'platform' || wForm.from_type === 'bank') && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">
                    To {wForm.from_type === 'platform' ? '(US Bank)' : '(Local Bank)'}
                  </label>
                  <div className="relative">
                    <select
                      className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-800 appearance-none focus:outline-none focus:ring-2 focus:ring-slate-900"
                      value={wForm.to_id}
                      onChange={e => setWForm(f => ({ ...f, to_id: e.target.value }))}
                    >
                      <option value="">Select destination...</option>
                      {toOptions.map(o => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </select>
                    <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  </div>
                  {toOptions.length === 0 && (
                    <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                      <AlertCircle size={12} /> No {wForm.from_type === 'platform' ? 'US bank' : 'local bank'} accounts added yet.
                    </p>
                  )}
                </div>
              )}

              {/* Date */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Date</label>
                <input
                  type="date"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  value={wForm.date}
                  onChange={e => setWForm(f => ({ ...f, date: e.target.value }))}
                />
              </div>

              {/* USD Amount */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">USD Amount</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  value={wForm.usd_amount}
                  onChange={e => setWForm(f => ({ ...f, usd_amount: e.target.value }))}
                />
              </div>

              {/* Fee */}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Fee</label>
                <div className="flex gap-2">
                  <div className="flex border border-slate-200 rounded-xl overflow-hidden text-xs font-bold">
                    <button
                      type="button"
                      onClick={() => setWForm(f => ({ ...f, fee_type: 'fixed' }))}
                      className={`px-3 py-2 transition-colors ${wForm.fee_type === 'fixed' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                      $
                    </button>
                    <button
                      type="button"
                      onClick={() => setWForm(f => ({ ...f, fee_type: 'percentage' }))}
                      className={`px-3 py-2 transition-colors ${wForm.fee_type === 'percentage' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                    >
                      %
                    </button>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder={wForm.fee_type === 'percentage' ? '0%' : '0.00'}
                    className="flex-1 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    value={wForm.fee_value}
                    onChange={e => setWForm(f => ({ ...f, fee_value: e.target.value }))}
                  />
                </div>
                {derivedFee > 0 && (
                  <p className="text-xs text-slate-400 mt-1">
                    Fee: <span className="font-bold text-red-500">−${fmt(derivedFee)}</span>
                    {' '}→ Net received: <span className="font-bold text-emerald-600">${fmt(derivedNet)}</span>
                  </p>
                )}
              </div>

              {/* Exchange Rate (local only) */}
              {isToLocal && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Exchange Rate (USD → PKR)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="e.g. 278.50"
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    value={wForm.exchange_rate}
                    onChange={e => setWForm(f => ({ ...f, exchange_rate: e.target.value }))}
                  />
                  {derivedLocal > 0 && (
                    <p className="text-xs text-slate-400 mt-1">
                      You receive: <span className="font-bold text-emerald-600">PKR {fmtPKR(derivedLocal)}</span>
                    </p>
                  )}
                </div>
              )}

              {/* Settlement Tags (US bank → local bank only) */}
              {isToLocal && availablePayments.length > 0 && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">
                    Mark Payments as Settled (optional)
                  </label>
                  <div className="space-y-2 border border-slate-200 rounded-xl p-3" style={{ maxHeight: '240px', overflowY: 'auto' }}>
                    {availablePayments.map(p => {
                      const selected = wForm.settlement_ids.includes(p.id);
                      const isPartner = p.payment_type === 'partner';
                      const rate = parseFloat(wForm.exchange_rate) || 0;
                      const pkrAmt = p.total_amount * (isPartner ? rate : 275);
                      return (
                        <label key={p.id} className="flex items-start gap-3 cursor-pointer group">
                          <div
                            className={`mt-0.5 w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                              selected ? 'bg-slate-900 border-slate-900' : 'border-slate-300 group-hover:border-slate-500'
                            }`}
                            onClick={() => setWForm(f => ({
                              ...f,
                              settlement_ids: selected
                                ? f.settlement_ids.filter(id => id !== p.id)
                                : [...f.settlement_ids, p.id]
                            }))}
                          >
                            {selected && <Check size={10} className="text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-sm text-slate-700">
                              {p.date} — {p.recipient_name} — ${fmt(p.total_amount)}
                            </span>
                            {rate > 0 && (
                              <span className="block text-xs text-violet-500 mt-0.5">
                                {isPartner ? 'Partner' : 'Team'} · PKR {fmtPKR(pkrAmt)} ({isPartner ? `${fmtPKR(rate)}` : '275'} PKR/USD)
                              </span>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  {/* Live PKR summary */}
                  {pkrSummary && wForm.settlement_ids.length > 0 && (
                    <div className="mt-3 bg-violet-50 rounded-xl p-3 text-xs space-y-1">
                      {pkrSummary.pkrToPartners > 0 && (
                        <div className="flex justify-between text-slate-600">
                          <span>PKR to partners <span className="text-slate-400">({fmtPKR(pkrSummary.rate)} PKR/USD)</span>:</span>
                          <span className="font-semibold">PKR {fmtPKR(pkrSummary.pkrToPartners)}</span>
                        </div>
                      )}
                      {pkrSummary.pkrToTeam > 0 && (
                        <div className="flex justify-between text-slate-600">
                          <span>PKR to team <span className="text-slate-400">(275 PKR/USD)</span>:</span>
                          <span className="font-semibold">PKR {fmtPKR(pkrSummary.pkrToTeam)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-red-500 border-t border-violet-100 pt-1">
                        <span>Total PKR paid out:</span>
                        <span className="font-bold">PKR {fmtPKR(pkrSummary.totalOut)}</span>
                      </div>
                      <div className="flex justify-between text-emerald-600 font-bold">
                        <span>PKR added to bank:</span>
                        <span>PKR {fmtPKR(pkrSummary.pkrAddedToBank)}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Summary */}
              {parseFloat(wForm.usd_amount) > 0 && (
                <div className="bg-slate-50 rounded-xl p-4 text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Gross withdrawn:</span>
                    <span className="font-bold">${fmt(parseFloat(wForm.usd_amount) || 0)}</span>
                  </div>
                  {derivedFee > 0 && (
                    <div className="flex justify-between text-red-500">
                      <span>Fee:</span>
                      <span>−${fmt(derivedFee)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-slate-200 pt-1 mt-1">
                    <span className="text-slate-500">Net received:</span>
                    <span className="font-bold text-emerald-600">${fmt(derivedNet)}</span>
                  </div>
                  {isToLocal && derivedLocal > 0 && (
                    <div className="flex justify-between text-violet-600">
                      <span>In PKR:</span>
                      <span className="font-bold">PKR {fmtPKR(derivedLocal)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div style={{ flexShrink: 0 }} className="border-t border-slate-100 p-6">
              <button
                onClick={handleWithdraw}
                disabled={wLoading}
                className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold hover:bg-slate-800 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {wLoading ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                Process Withdrawal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Bank Modal ── */}
      {showAddBank && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-800">Add Bank Account</h3>
              <button onClick={() => setShowAddBank(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Type</label>
                <div className="flex gap-2">
                  {(['us', 'local'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setBankForm(f => ({ ...f, type: t }))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold border transition-colors ${
                        bankForm.type === t
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {t === 'us' ? 'US Bank (USD)' : 'Local Bank (PKR)'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Bank Name</label>
                <input
                  type="text"
                  placeholder="e.g. Wise, Meezan Bank"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  value={bankForm.name}
                  onChange={e => setBankForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Account Number (optional)</label>
                <input
                  type="text"
                  placeholder="Last 4 digits or full number"
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  value={bankForm.account_number}
                  onChange={e => setBankForm(f => ({ ...f, account_number: e.target.value }))}
                />
              </div>
              <button
                onClick={handleAddBank}
                disabled={bankLoading}
                className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold hover:bg-slate-800 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {bankLoading ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                Add Bank
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail Modal ── */}
      {detailWithdrawal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" style={{ maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div className="flex items-center justify-between p-6 border-b border-slate-100" style={{ flexShrink: 0 }}>
              <h3 className="text-lg font-bold text-slate-800">Transaction Detail</h3>
              <button onClick={() => setDetailWithdrawal(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4" style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-slate-400 uppercase font-bold">Date</p>
                  <p className="font-medium text-slate-800 mt-0.5">{detailWithdrawal.date}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase font-bold">Status</p>
                  <div className="mt-0.5">{statusBadge(detailWithdrawal.status)}</div>
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase font-bold">From</p>
                  <p className="font-medium text-slate-800 mt-0.5">{getFromLabel(detailWithdrawal)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase font-bold">To</p>
                  <p className="font-medium text-slate-800 mt-0.5">{getToLabel(detailWithdrawal)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase font-bold">USD Amount</p>
                  <p className="font-bold text-slate-800 mt-0.5">${fmt(detailWithdrawal.usd_amount)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase font-bold">Fee</p>
                  <p className="font-medium text-red-500 mt-0.5">
                    {detailWithdrawal.fee_amount > 0
                      ? `−$${fmt(detailWithdrawal.fee_amount)}${detailWithdrawal.fee_type === 'percentage' ? ` (${detailWithdrawal.fee_value}%)` : ''}`
                      : 'None'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase font-bold">Net (USD)</p>
                  <p className="font-bold text-emerald-600 mt-0.5">${fmt(detailWithdrawal.net_amount ?? detailWithdrawal.usd_amount)}</p>
                </div>
                {detailWithdrawal.exchange_rate != null && (
                  <div>
                    <p className="text-xs text-slate-400 uppercase font-bold">Rate</p>
                    <p className="font-medium text-slate-800 mt-0.5">{detailWithdrawal.exchange_rate} PKR/USD</p>
                  </div>
                )}
                {detailWithdrawal.local_amount != null && (
                  <div className="col-span-2">
                    <p className="text-xs text-slate-400 uppercase font-bold">Received (PKR)</p>
                    <p className="font-bold text-violet-600 mt-0.5">PKR {fmtPKR(detailWithdrawal.local_amount)}</p>
                  </div>
                )}
              </div>

              {/* Settlements */}
              {normalizeIds(detailWithdrawal.settlement_ids).length > 0 && (() => {
                const items = extractSettlementItems(detailWithdrawal.settlement_ids);
                const plainIds = extractSettlementIds(detailWithdrawal.settlement_ids);
                const pkrOut = totalPkrOut(detailWithdrawal.settlement_ids);
                const pkrReceived = detailWithdrawal.local_amount ?? 0;
                const pkrAddedToBank = pkrReceived - pkrOut;
                return (
                  <div>
                    <p className="text-xs text-slate-400 uppercase font-bold mb-2">Settlements Covered</p>
                    <div className="space-y-1.5" style={{ maxHeight: '240px', overflowY: 'auto' }}>
                      {items.length > 0 ? items.map(item => (
                        <div key={item.id} className="bg-slate-50 rounded-lg px-3 py-2 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-700 font-medium">{item.recipient_name}</span>
                            <span className="font-bold text-slate-800">${fmt(item.usd_amount)}</span>
                          </div>
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="text-xs text-slate-400">
                              {item.type === 'partner' ? 'Partner' : 'Team'} · {fmtPKR(item.pkr_rate)} PKR/USD
                            </span>
                            <span className="text-xs font-semibold text-violet-600">PKR {fmtPKR(item.pkr_amount)}</span>
                          </div>
                        </div>
                      )) : plainIds.map(pid => {
                        const p = payments.find(pm => pm.id === pid);
                        return (
                          <div key={pid} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-sm">
                            <span className="text-slate-700">{p ? `${p.date} — ${p.recipient_name}` : `Payment #${pid}`}</span>
                            <span className="font-bold text-slate-800">{p ? `$${fmt(p.total_amount)}` : ''}</span>
                          </div>
                        );
                      })}
                    </div>
                    {items.length > 0 && (
                      <div className="mt-3 space-y-1 text-sm">
                        <div className="flex justify-between text-slate-500">
                          <span>Total PKR paid out:</span>
                          <span className="font-semibold text-red-500">PKR {fmtPKR(pkrOut)}</span>
                        </div>
                        <div className="flex justify-between text-slate-500">
                          <span>PKR received:</span>
                          <span className="font-semibold">PKR {fmtPKR(pkrReceived)}</span>
                        </div>
                        <div className="flex justify-between border-t border-slate-100 pt-1 font-bold">
                          <span className="text-slate-700">PKR added to bank:</span>
                          <span className="text-emerald-600">PKR {fmtPKR(pkrAddedToBank)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {detailWithdrawal.status !== 'cancelled' && (
              <div className="p-6 border-t border-slate-100" style={{ flexShrink: 0 }}>
                <button
                  onClick={() => handleCancelWithdrawal(detailWithdrawal)}
                  disabled={cancelLoading}
                  className="w-full border border-red-200 text-red-600 py-3 rounded-xl font-bold hover:bg-red-50 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {cancelLoading ? <Loader2 size={18} className="animate-spin" /> : <X size={18} />}
                  Cancel & Restore Balances
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default WithdrawalsView;
