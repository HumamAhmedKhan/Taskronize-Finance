
import React, { useState, useEffect, useMemo } from 'react';
import { supabase, db } from '../lib/supabase';
import { Expense, RecurringExpense, IncomeStream } from '../types';
import SearchableSelect from '../components/SearchableSelect';
import Table from '../components/Table';
import Modal from '../components/Modal';
import BulkImportModal from '../components/BulkImportModal';
import { Plus, Search, Upload, Info, Loader2, Edit2, Trash2, Repeat, CreditCard, Link2, FileText } from 'lucide-react';

interface ExpensesViewProps {
  globalStart: string;
  globalEnd: string;
}

const CATEGORIES = ['Fixed: Rent', 'Fixed: Operational Quota', 'Variable: Connects', 'Variable: Software Fees', 'Variable: Marketing', 'Variable: Other', 'Production Costs'];

const ExpensesView: React.FC<ExpensesViewProps> = ({ globalStart, globalEnd }) => {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [recurring, setRecurring] = useState<RecurringExpense[]>([]);
  const [streams, setStreams] = useState<IncomeStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [mobileTab, setMobileTab] = useState<'expenses' | 'subscriptions'>('expenses');
  const [showModal, setShowModal] = useState(false);
  const [showRecModal, setShowRecModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  
  const initialFormState: Partial<Expense> = { 
    date: new Date().toISOString().split('T')[0], 
    description: '', 
    amount: 0, 
    category: CATEGORIES[0],
    type: 'fixed',
    is_production: false,
    income_stream_id: null 
  };

  const [formData, setFormData] = useState<Partial<Expense>>(initialFormState);
  const [recData, setRecData] = useState<Partial<RecurringExpense>>({ 
    name: '', 
    amount: 0, 
    category: 'Fixed: Operational Quota', 
    day_of_month: 1, 
    is_active: true 
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const [expData, streamData, recData] = await Promise.all([
        supabase.from('expenses').select('*').gte('date', globalStart).lte('date', globalEnd).order('date', { ascending: false }),
        db.get<IncomeStream>('income_streams'),
        supabase.from('recurring_expenses').select('*')
      ]);
      setExpenses(expData.data || []);
      setStreams(streamData || []);
      setRecurring(recData.data || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, [globalStart, globalEnd]);

  const handleCategoryChange = (cat: string) => {
    const type = cat.startsWith('Fixed:') ? 'fixed' : 'variable';
    const is_production = cat === 'Production Costs';
    setFormData({ ...formData, category: cat, type, is_production });
  };

  const handleSaveExp = async () => {
    try {
      const finalData = {
        ...formData,
        type: formData.category?.startsWith('Fixed:') ? 'fixed' : 'variable',
        is_production: formData.category === 'Production Costs'
      };

      if (formData.id) await db.update('expenses', formData.id, finalData as any);
      else await db.insert('expenses', finalData as any);
      setShowModal(false); loadData();
    } catch (err) {
      alert('Failed to save expense.');
    }
  };

  const handleBulkImport = async (data: any[]) => {
    const payload = data.map(item => {
      // Sanitize currency
      let val = item.amount;
      if (typeof val === 'string') {
        val = parseFloat(val.replace(/[^0-9.-]+/g, ''));
      }

      // Stream matching
      const streamName = String(item.stream || '').toLowerCase();
      const matchedStreamId = streams.find(s => s.name.toLowerCase().includes(streamName))?.id || null;

      return {
        date: item.date,
        description: item.description,
        amount: isNaN(val) ? 0 : val,
        category: item.category || 'Variable: Other',
        type: (item.category || '').startsWith('Fixed:') ? 'fixed' : 'variable',
        is_production: item.category === 'Production Costs',
        income_stream_id: matchedStreamId
      };
    });

    const { error } = await supabase.from('expenses').insert(payload);
    if (error) throw error;
    await loadData();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this expense?')) return;
    try {
      await db.delete('expenses', id);
      loadData();
    } catch (err) {
      alert('Delete failed.');
    }
  };

  const handleSaveRec = async () => {
    if (recData.id) await supabase.from('recurring_expenses').update(recData).eq('id', recData.id);
    else await supabase.from('recurring_expenses').insert(recData);
    setShowRecModal(false); loadData();
  };

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

  // Mobile helpers
  const filteredExpenses = expenses.filter(e => e.description.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredRecurring = recurring.filter(r => r.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const spentTotal = filteredExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const activeRecurring = recurring.filter(r => r.is_active);
  const monthlyBurn = activeRecurring.reduce((sum, r) => sum + Number(r.amount), 0);
  const expenseTag = (e: Expense) => e.is_production
    ? { label: 'Production', cls: 'bg-orange-50 text-orange-700' }
    : e.type === 'fixed'
      ? { label: 'Fixed', cls: 'bg-gray-100 text-gray-700' }
      : { label: 'Variable', cls: 'bg-emerald-50 text-emerald-700' };
  const isPaidThisMonthRec = (r: RecurringExpense) => {
    const now = new Date();
    const paidAt = r.paid_at ? new Date(r.paid_at) : null;
    return paidAt !== null && paidAt.getMonth() === now.getMonth() && paidAt.getFullYear() === now.getFullYear();
  };
  const openNewRecurring = () => { setRecData({ name: '', amount: 0, category: 'Fixed: Operational Quota', day_of_month: 1, is_active: true }); setShowRecModal(true); };

  return (
    <div className="space-y-12 pb-32 animate-in fade-in">
      {/* ===== Mobile layout ===== */}
      <div className="md:hidden space-y-3 -mt-1">
        <div role="tablist" className="grid grid-cols-2 gap-1 p-1 bg-gray-100 rounded-xl">
          {([['expenses', 'Expenses'], ['subscriptions', 'Subscriptions']] as const).map(([key, label]) => (
            <button key={key} role="tab" aria-selected={mobileTab === key} onClick={() => setMobileTab(key)}
              className={`h-10 rounded-lg text-sm font-medium ${mobileTab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="bg-white rounded-xl border border-gray-200 px-3 py-2.5 min-w-0">
            <p className="text-xs text-gray-500">{mobileTab === 'expenses' ? 'Spent this period' : 'Monthly total'}</p>
            <p className="text-lg font-semibold text-gray-900 truncate">{formatCurrency(mobileTab === 'expenses' ? spentTotal : monthlyBurn)}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 px-3 py-2.5 min-w-0">
            <p className="text-xs text-gray-500">{mobileTab === 'expenses' ? 'Entries' : 'Active subscriptions'}</p>
            <p className="text-lg font-semibold text-gray-900">{mobileTab === 'expenses' ? filteredExpenses.length : activeRecurring.length}</p>
          </div>
        </div>

        <div className="flex gap-2">
          <label className="flex-1 flex items-center gap-2 h-11 px-3 rounded-xl bg-white border border-gray-200 text-gray-500">
            <Search size={18} />
            <span className="sr-only">{mobileTab === 'expenses' ? 'Search expenses' : 'Search subscriptions'}</span>
            <input type="search" placeholder={mobileTab === 'expenses' ? 'Search expenses' : 'Search subscriptions'} value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="flex-1 min-w-0 bg-transparent outline-none text-[15px] text-gray-900 placeholder:text-gray-400" />
          </label>
          {mobileTab === 'expenses' && (
            <button onClick={() => setShowImportModal(true)} aria-label="Bulk AI import" className="w-11 h-11 shrink-0 rounded-xl bg-white border border-gray-200 flex items-center justify-center text-indigo-600">
              <FileText size={18} />
            </button>
          )}
        </div>

        {mobileTab === 'expenses' ? (
          <ul className="space-y-2">
            {filteredExpenses.map(e => {
              const tag = expenseTag(e);
              const stream = e.income_stream_id ? streams.find(st => st.id === e.income_stream_id) : null;
              return (
                <li key={e.id}>
                  <button onClick={() => { setFormData(e); setShowModal(true); }} className="w-full text-left bg-white rounded-2xl border border-gray-200 px-4 py-3 flex items-center gap-3 active:bg-gray-50">
                    <span className="flex-1 min-w-0">
                      <span className="block text-[15px] font-semibold text-gray-900 truncate">{e.description}</span>
                      <span className="flex items-center gap-1.5 mt-1 text-xs text-gray-500 min-w-0">
                        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${tag.cls}`}>{tag.label}</span>
                        <span className="truncate">{[e.date, e.category.replace(/^(Fixed|Variable): /, ''), stream?.name].filter(Boolean).join(' · ')}</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-[15px] font-semibold text-gray-900">{formatCurrency(e.amount)}</span>
                  </button>
                </li>
              );
            })}
            {filteredExpenses.length === 0 && <li className="py-12 text-center text-sm text-gray-500">No expenses in this period.</li>}
          </ul>
        ) : (
          <ul className="space-y-2">
            {filteredRecurring.map(r => (
              <li key={r.id}>
                <button onClick={() => { setRecData(r); setShowRecModal(true); }} className="w-full text-left bg-white rounded-2xl border border-gray-200 px-4 py-3 flex items-center gap-3 active:bg-gray-50">
                  <span className="flex-1 min-w-0">
                    <span className="block text-[15px] font-semibold text-gray-900 truncate">{r.name}</span>
                    <span className="flex items-center gap-1.5 mt-1 text-xs text-gray-500 min-w-0">
                      {isPaidThisMonthRec(r)
                        ? <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700">Paid</span>
                        : <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-700">Monthly</span>}
                      <span className="truncate">Day {r.day_of_month} · {r.category.replace(/^(Fixed|Variable): /, '')}{!r.is_active ? ' · Paused' : ''}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-[15px] font-semibold text-gray-900">{formatCurrency(r.amount)}</span>
                </button>
              </li>
            ))}
            {filteredRecurring.length === 0 && <li className="py-12 text-center text-sm text-gray-500">No subscriptions yet.</li>}
          </ul>
        )}

        <button
          onClick={() => { if (mobileTab === 'expenses') { setFormData(initialFormState); setShowModal(true); } else { openNewRecurring(); } }}
          aria-label={mobileTab === 'expenses' ? 'New expense' : 'New subscription'}
          className="fixed right-4 bottom-24 z-30 w-14 h-14 rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 flex items-center justify-center"
        >
          <Plus size={24} />
        </button>
      </div>

      {/* ===== Desktop layout (unchanged) ===== */}
      <div className="hidden md:flex md:!mt-0 flex-col md:flex-row md:items-center justify-between gap-6">
        <div><h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">Expense Tracker</h2><p className="text-gray-500 font-medium text-sm">Synchronized with range {globalStart} — {globalEnd}</p></div>
        <div className="flex gap-3">
          <button onClick={() => setShowImportModal(true)} className="flex items-center gap-2 bg-indigo-50 text-indigo-600 px-5 py-2.5 rounded-xl font-bold text-xs hover:bg-indigo-100 transition-all">
            <FileText size={18} /> Bulk AI Import
          </button>
          <button onClick={() => { setRecData({ name: '', amount: 0, category: 'Fixed: Operational Quota', day_of_month: 1, is_active: true }); setShowRecModal(true); }} className="flex items-center gap-2 bg-gray-50 text-gray-400 px-5 py-2.5 rounded-xl font-bold text-xs hover:bg-gray-100 transition-all border border-gray-100"><Repeat size={16} /> Recurring Plan</button>
          <button onClick={() => { setFormData(initialFormState); setShowModal(true); }} className="flex items-center gap-2 bg-gray-900 text-white px-6 py-2.5 rounded-xl font-black text-sm shadow-lg"><Plus size={18} /> New Expense</button>
        </div>
      </div>

      <div className="hidden md:grid grid-cols-1 lg:grid-cols-3 gap-10">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white border border-gray-200 rounded-[32px] shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3"><Search size={16} className="text-gray-400" /><input type="text" placeholder="Search operational burn..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="flex-1 bg-transparent outline-none text-xs font-bold" /></div>
            <Table<Expense>
              data={expenses.filter(e => e.description.toLowerCase().includes(searchTerm.toLowerCase()))}
              rowKey={(e) => String(e.id)}
              columns={[
                { header: 'Date', render: (e) => <span className="text-xs font-bold text-gray-400">{e.date}</span> },
                { header: 'Description', render: (e) => <span className="font-black text-gray-900">{e.description}</span> },
                { header: 'Category', render: (e) => (
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">{e.category}</span>
                    {e.income_stream_id && (
                      <span className="text-[9px] font-black text-indigo-500 uppercase flex items-center gap-1">
                        <Link2 size={10} /> {streams.find(s => s.id === e.income_stream_id)?.name}
                      </span>
                    )}
                  </div>
                )},
                { header: 'Amount', render: (e) => <span className="font-black text-rose-500">{formatCurrency(e.amount)}</span>, className: 'text-right' },
                { header: 'Actions', render: (e) => <div className="flex justify-center gap-1"><button onClick={() => { setFormData(e); setShowModal(true); }} className="p-2 text-gray-300 hover:text-indigo-600"><Edit2 size={14} /></button><button onClick={() => handleDelete(e.id)} className="p-2 text-gray-300 hover:text-rose-600"><Trash2 size={14} /></button></div> }
              ]}
            />
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-gray-900 rounded-[32px] p-8 text-white shadow-xl">
            <div className="flex items-center gap-3 mb-6 text-indigo-400"><Repeat size={20} /><h3 className="font-black text-xs uppercase tracking-widest">Monthly Subscriptions</h3></div>
            <div className="space-y-5">
              {recurring.map(r => {
                const now = new Date();
                const paidAt = r.paid_at ? new Date(r.paid_at) : null;
                const isPaidThisMonth = paidAt !== null && paidAt.getMonth() === now.getMonth() && paidAt.getFullYear() === now.getFullYear();
                return (
                  <div key={r.id} className="flex justify-between items-center group">
                    <div><p className="text-sm font-black">{r.name}</p><p className="text-[9px] text-gray-400 font-bold uppercase">Day {r.day_of_month} • {r.category}</p></div>
                    <div className="flex items-center gap-4">
                      {isPaidThisMonth && <span className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-[9px] font-bold uppercase">Paid</span>}
                      <span className="text-sm font-black text-rose-400">{formatCurrency(r.amount)}</span>
                      <button onClick={() => { setRecData(r); setShowRecModal(true); }} className="opacity-0 group-hover:opacity-100 transition-all p-1.5 hover:bg-white/10 rounded-lg"><Edit2 size={12} /></button>
                    </div>
                  </div>
                );
              })}
              <div className="pt-5 border-t border-white/10 flex justify-between items-center"><span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Fixed Monthly Burn</span><span className="text-lg font-black text-rose-400">{formatCurrency(recurring.reduce((s, r) => s + r.amount, 0))}</span></div>
            </div>
          </div>
        </div>
      </div>

      <Modal title="Manual Expense Item" isOpen={showModal} onClose={() => setShowModal(false)} onSave={handleSaveExp}
        footerExtra={formData.id ? (
          <button onClick={() => { const id = formData.id as number; setShowModal(false); handleDelete(id); }} className="md:hidden mr-auto -order-1 text-sm font-medium text-rose-600">Delete</button>
        ) : undefined}>
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Date</label><input type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border-none rounded-2xl text-sm font-bold outline-none shadow-sm focus:ring-2 focus:ring-indigo-100 transition-all" /></div>
            <div><label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Category</label><select value={formData.category} onChange={e => handleCategoryChange(e.target.value)} className="w-full px-4 py-3 bg-gray-50 border-none rounded-2xl text-sm font-bold outline-none shadow-sm focus:ring-2 focus:ring-indigo-100 transition-all">{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
          </div>
          
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Link to Income Stream (Optional)</label>
            <SearchableSelect 
              options={streams.map(s => ({ value: s.id, label: `${s.name} (${s.platform})` }))} 
              value={formData.income_stream_id} 
              onChange={id => setFormData({...formData, income_stream_id: id})} 
              placeholder="Select stream to attribute variable costs..."
            />
          </div>

          <div><label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Description</label><input type="text" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border-none rounded-2xl text-sm font-bold outline-none shadow-sm focus:ring-2 focus:ring-indigo-100 transition-all" /></div>
          <div><label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Amount ($)</label><input type="number" step="0.01" value={formData.amount} onChange={e => setFormData({...formData, amount: parseFloat(e.target.value)})} className="w-full px-4 py-3 bg-gray-50 border-none rounded-2xl text-xl font-black outline-none shadow-sm focus:ring-2 focus:ring-indigo-100 transition-all" /></div>
        </div>
      </Modal>

      <Modal title="Recurring Cost Config" isOpen={showRecModal} onClose={() => setShowRecModal(false)} onSave={handleSaveRec}>
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Day of Month</label><input type="number" min="1" max="31" value={recData.day_of_month} onChange={e => setRecData({...recData, day_of_month: parseInt(e.target.value)})} className="w-full px-4 py-3 bg-gray-50 border-none rounded-2xl text-sm font-bold outline-none" /></div>
            <div><label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Category</label><select value={recData.category} onChange={e => setRecData({...recData, category: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border-none rounded-2xl text-sm font-bold outline-none">{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
          </div>
          <div><label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Subscription Name</label><input type="text" value={recData.name} onChange={e => setRecData({...recData, name: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border-none rounded-2xl text-sm font-bold outline-none" /></div>
          <div><label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Monthly Amount ($)</label><input type="number" step="0.01" value={recData.amount} onChange={e => setRecData({...recData, amount: parseFloat(e.target.value)})} className="w-full px-4 py-3 bg-gray-50 border-none rounded-2xl text-xl font-black outline-none" /></div>
        </div>
      </Modal>

      <BulkImportModal 
        isOpen={showImportModal} 
        onClose={() => setShowImportModal(false)}
        onImport={handleBulkImport}
        type="expense"
        schemaDescription="date (YYYY-MM-DD), description, amount (number), category (must be one of: ${CATEGORIES.join(', ')}), stream (string matching income stream name if variable)"
      />
    </div>
  );
};

export default ExpensesView;
