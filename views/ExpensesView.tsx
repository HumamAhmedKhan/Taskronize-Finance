
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

  return (
    <div className="space-y-12 pb-32 animate-in fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div><h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">Expense Tracker</h2><p className="text-gray-500 font-medium text-sm">Synchronized with range {globalStart} — {globalEnd}</p></div>
        <div className="flex gap-3">
          <button onClick={() => setShowImportModal(true)} className="flex items-center gap-2 bg-indigo-50 text-indigo-600 px-5 py-2.5 rounded-xl font-bold text-xs hover:bg-indigo-100 transition-all">
            <FileText size={18} /> Bulk AI Import
          </button>
          <button onClick={() => { setRecData({ name: '', amount: 0, category: 'Fixed: Operational Quota', day_of_month: 1, is_active: true }); setShowRecModal(true); }} className="flex items-center gap-2 bg-gray-50 text-gray-400 px-5 py-2.5 rounded-xl font-bold text-xs hover:bg-gray-100 transition-all border border-gray-100"><Repeat size={16} /> Recurring Plan</button>
          <button onClick={() => { setFormData(initialFormState); setShowModal(true); }} className="flex items-center gap-2 bg-gray-900 text-white px-6 py-2.5 rounded-xl font-black text-sm shadow-lg"><Plus size={18} /> New Expense</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
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

      <Modal title="Manual Expense Item" isOpen={showModal} onClose={() => setShowModal(false)} onSave={handleSaveExp}>
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
