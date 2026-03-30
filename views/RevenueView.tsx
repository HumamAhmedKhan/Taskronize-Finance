
import React, { useState, useEffect, useMemo } from 'react';
import { supabase, db } from '../lib/supabase';
import { Revenue, IncomeStream, Project, ProjectAllocation, Expense, ProductionPayment, User } from '../types';
import { calculateRevenueDetails } from '../utils/calculations';
import SearchableSelect from '../components/SearchableSelect';
import Table from '../components/Table';
import Modal from '../components/Modal';
import BulkImportModal from '../components/BulkImportModal';
import { Plus, Search, Upload, Info, Loader2, Edit2, Trash2, FileText, DollarSign, PieChart, Link, Unlink, Layers, Download } from 'lucide-react';

interface RevenueViewProps {
  globalStart: string;
  globalEnd: string;
  currentUser?: User | null;
}

type RevenueFormData = Omit<Revenue, 'id' | 'created_at' | 'income_stream_id'> & {
  id?: number;
  income_stream_id?: number;
};


const RevenueView: React.FC<RevenueViewProps> = ({ globalStart, globalEnd, currentUser }) => {
  const isPartner = currentUser?.user_type === 'partner';
  const partnerStreamIds = isPartner ? (currentUser?.linked_income_stream_ids || []) : null;
  const [revenues, setRevenues] = useState<Revenue[]>([]);
  const [streams, setStreams] = useState<IncomeStream[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [allocations, setAllocations] = useState<ProjectAllocation[]>([]);
  const [revenueLinks, setRevenueLinks] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [payments, setPayments] = useState<ProductionPayment[]>([]);

  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);
  
  const initialFormState: RevenueFormData = {
    date: new Date().toISOString().split('T')[0],
    client_name: '',
    project_description: '',
    total_sale: 0,
    platform_fee_percent: 0,
    mirjan_involved: false,
    income_stream_id: undefined
  };

  const [formData, setFormData] = useState<RevenueFormData>(initialFormState);

  const loadData = async () => {
    setLoading(true);
    try {
      const [revData, streamData, projData, allocData, linkData, expData, payData] = await Promise.all([
        supabase.from('revenues').select('*').gte('date', globalStart).lte('date', globalEnd).order('date', { ascending: false }),
        db.get<IncomeStream>('income_streams'),
        db.get<Project>('projects'),
        db.get<ProjectAllocation>('project_allocations'),
        supabase.from('project_revenue_links').select('*'),
        db.get<Expense>('expenses'),
        db.get<ProductionPayment>('production_payments')
      ]);
      const allRevenues = revData.data || [];
      const allStreams = streamData || [];
      setRevenues(partnerStreamIds ? allRevenues.filter(r => partnerStreamIds.includes(r.income_stream_id)) : allRevenues);
      setStreams(partnerStreamIds ? allStreams.filter(s => partnerStreamIds.includes(s.id)) : allStreams);
      setProjects(projData || []);
      setAllocations(allocData || []);
      setRevenueLinks(linkData.data || []);
      setExpenses(expData || []);
      setPayments(payData || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, [globalStart, globalEnd]);

  const filteredRevenues = useMemo(() => {
    return revenues.filter(r => 
      r.client_name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      (r.project_description || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [revenues, searchTerm]);

  const streamSummary = useMemo(() => {
    const summary: Record<number, { name: string, gross: number, net: number, count: number }> = {};
    
    revenues.forEach(r => {
      const stream = streams.find(s => s.id === r.income_stream_id);
      if (!stream) return;
      
      if (!summary[stream.id]) {
        summary[stream.id] = { name: stream.name, gross: 0, net: 0, count: 0 };
      }
      
      const feePct = (r.platform_fee_percent && r.platform_fee_percent > 0) ? r.platform_fee_percent : stream.platform_fee_percent;
      const fee = r.total_sale * (feePct / 100);
      const net = r.total_sale - fee;

      summary[stream.id].gross += r.total_sale;
      summary[stream.id].net += net;
      summary[stream.id].count += 1;
    });

    return Object.values(summary);
  }, [revenues, streams]);

  const handleSave = async () => {
    if (!formData.income_stream_id) return alert('Select an income stream');
    if (!formData.client_name.trim()) return alert('Client name is required');
    if (formData.total_sale < 0) return alert('Total sale cannot be negative');

    try {
      const payload = {
        date: formData.date,
        client_name: formData.client_name,
        project_description: formData.project_description || null,
        total_sale: formData.total_sale,
        platform_fee_percent: formData.platform_fee_percent || 0,
        mirjan_involved: formData.mirjan_involved,
        income_stream_id: formData.income_stream_id
      };

      if (formData.id) {
        await db.update<Revenue>('revenues', formData.id, payload);
      } else {
        await db.insert<Revenue>('revenues', payload);
      }
      setShowModal(false); 
      loadData();
    } catch (err) { 
      console.error(err);
      alert('Error saving revenue'); 
    }
  };

  const handleBulkImport = async (data: any[]) => {
    let currentStreams = streams || [];
    if (currentStreams.length === 0) {
      const fetched = await db.get<IncomeStream>('income_streams');
      currentStreams = fetched || [];
      setStreams(currentStreams);
    }

    if (currentStreams.length === 0) {
      throw new Error("No income streams configured. Please add one first.");
    }

    const payload = data.map(item => {
      let val = item.total_sale;
      if (typeof val === 'string') {
        val = parseFloat(val.replace(/[^0-9.-]+/g, ''));
      }

      const streamName = String(item.stream || '').toLowerCase();
      const matchedStreamId = currentStreams.find(s => s.name.toLowerCase().includes(streamName))?.id;
      const finalStreamId = matchedStreamId || currentStreams[0].id;
      const finalStreamObj = currentStreams.find(s => s.id === finalStreamId);

      return {
        date: item.date,
        client_name: item.client_name,
        project_description: item.project_description || '',
        total_sale: isNaN(val) ? 0 : val,
        platform_fee_percent: item.platform_fee_percent !== undefined ? item.platform_fee_percent : (finalStreamObj?.platform_fee_percent || 0),
        mirjan_involved: false,
        income_stream_id: finalStreamId
      };
    });

    const { error } = await supabase.from('revenues').insert(payload);
    if (error) throw error;
    await loadData();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Permanently delete this settlement record?')) return;
    try {
      await supabase.from('project_revenue_links').delete().eq('revenue_id', id);
      await db.delete('revenues', id);
      setSelectedIds(prev => prev.filter(selectedId => selectedId !== id));
      loadData();
    } catch (err) {
      alert('Delete failed. Record might be referenced in audit logs.');
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.length) return;
    if (!confirm(`Permanently delete ${selectedIds.length} selected records?`)) return;
    
    try {
      await supabase.from('project_revenue_links').delete().in('revenue_id', selectedIds);
      await supabase.from('revenues').delete().in('id', selectedIds);
      setSelectedIds([]);
      loadData();
    } catch (err) {
      console.error(err);
      alert('Bulk delete failed.');
    }
  };

  const handleExportSelected = () => {
    if (!selectedIds.length) return;
    const selectedData = revenues.filter(r => selectedIds.includes(r.id));
    
    const headers = ['Date', 'Client', 'Description', 'Income Stream', 'Gross Sale', 'Platform Fee %', 'Net Sale'];
    const csvRows = [headers.join(',')];
    
    selectedData.forEach(r => {
      const stream = streams.find(s => s.id === r.income_stream_id);
      const feePct = (r.platform_fee_percent && r.platform_fee_percent > 0) ? r.platform_fee_percent : (stream?.platform_fee_percent || 0);
      const fee = r.total_sale * (feePct / 100);
      const net = r.total_sale - fee;
      
      const row = [
        r.date,
        `"${r.client_name.replace(/"/g, '""')}"`,
        `"${(r.project_description || '').replace(/"/g, '""')}"`,
        `"${stream?.name || 'Unknown'}"`,
        r.total_sale,
        feePct,
        net
      ];
      csvRows.push(row.join(','));
    });
    
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `revenue_export_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const calculateProfit = (r: Revenue) => {
    const stream = streams.find(s => s.id === r.income_stream_id);
    if (!stream) return 0;

    // 1. Base details (Fee deduction)
    const details = calculateRevenueDetails(r, stream, expenses, payments, revenues, projects, allocations, revenueLinks);
    
    // 2. Sum of Partner Commissions (Mirjan + others defined in rules)
    const totalCommissions = Object.values(details.commissions).reduce((sum, val) => sum + val, 0);

    // 3. Linked Project Allocations (Developer Cost)
    const linkedProjectIds = revenueLinks.filter(l => Number(l.revenue_id) === Number(r.id)).map(l => l.project_id);
    const linkedAllocationsCost = allocations
      .filter(a => linkedProjectIds.includes(a.project_id))
      .reduce((sum, a) => sum + Number(a.amount), 0);

    return details.netAfterPlatform - totalCommissions - linkedAllocationsCost;
  };

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

  return (
    <div className="space-y-8 pb-32 animate-in fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-extrabold text-gray-900 mb-1 tracking-tight">Revenue Records</h2>
          <p className="text-gray-500 font-medium text-sm">Settlements filtered by current global date range.</p>
        </div>
        {!isPartner && (
          <div className="flex gap-3">
            <button onClick={() => setShowImportModal(true)} className="flex items-center gap-2 bg-indigo-50 text-indigo-600 px-5 py-2.5 rounded-xl font-bold text-xs hover:bg-indigo-100 transition-all">
              <FileText size={18} /> Bulk AI Import
            </button>
            <button
              onClick={() => { setFormData(initialFormState); setShowModal(true); }}
              className="flex items-center gap-2 bg-gray-900 text-white px-6 py-2.5 rounded-xl font-black text-sm shadow-lg active:scale-95 transition-all"
            >
              <Plus size={18} /> New Settlement
            </button>
          </div>
        )}
      </div>

      {/* Stream Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {streamSummary.map((stream, idx) => (
          <div key={idx} className="bg-white rounded-[24px] border border-gray-100 p-6 shadow-sm hover:shadow-md transition-all">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center font-black text-lg">
                  {stream.name.charAt(0)}
                </div>
                <div>
                  <h4 className="font-bold text-gray-900">{stream.name}</h4>
                  <p className="text-[10px] font-bold text-gray-400 uppercase">{stream.count} Settlements</p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500 font-medium">Total Paid</span>
                <span className="font-black text-gray-900">{formatCurrency(stream.gross)}</span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500 font-medium">Net (After Fees)</span>
                <span className="font-black text-emerald-600">{formatCurrency(stream.net)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-[32px] shadow-sm overflow-hidden">
        <div className="px-8 py-6 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gray-50/10">
          <div className="flex items-center gap-4 flex-1">
            <Search size={18} className="text-gray-400" />
            <input 
              type="text" 
              placeholder="Search by client or description..." 
              value={searchTerm} 
              onChange={e => setSearchTerm(e.target.value)} 
              className="flex-1 bg-transparent outline-none text-sm font-bold text-gray-700 placeholder:text-gray-300" 
            />
          </div>
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-3 animate-in fade-in slide-in-from-right-4">
              <span className="text-xs font-bold text-gray-500">{selectedIds.length} selected</span>
              <button onClick={handleExportSelected} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg text-xs font-bold hover:bg-emerald-100 transition-colors">
                <Download size={14} /> Export
              </button>
              <button onClick={handleBulkDelete} className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 text-rose-600 rounded-lg text-xs font-bold hover:bg-rose-100 transition-colors">
                <Trash2 size={14} /> Delete
              </button>
            </div>
          )}
        </div>
        <Table<Revenue>
          data={filteredRevenues}
          rowKey={(r) => String(r.id)}
          selectable={!isPartner}
          onSelectionChange={setSelectedIds}
          columns={[
            { header: 'DATE', render: (r) => <span className="text-xs font-bold text-gray-400">{r.date}</span> },
            { header: 'CLIENT / DETAILS', render: (r) => (
              <div>
                <span className="font-black text-gray-900 block text-sm">{r.client_name}</span>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tight">{r.project_description}</span>
              </div>
            )},
            { header: 'INCOME STREAM', render: (r) => {
              const stream = streams.find(s => s.id === r.income_stream_id);
              return stream ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-black uppercase">
                   {stream.name}
                </span>
              ) : <span className="text-xs text-gray-300">Unknown</span>;
            }},
            { header: 'LINK STATUS', render: (r) => {
              const isLinked = revenueLinks.some(link => Number(link.revenue_id) === Number(r.id));
              return isLinked ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-full text-[10px] font-black uppercase">
                   <Link size={12} /> Linked
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-gray-50 text-gray-400 border border-gray-100 rounded-full text-[10px] font-black uppercase">
                   <Unlink size={12} /> Unlinked
                </span>
              );
            }},
            { header: 'GROSS', render: (r) => <span className="font-black text-gray-900">{formatCurrency(r.total_sale)}</span>, className: 'text-right' },
            { header: 'NET (After Fee)', render: (r) => {
               const feePct = (r.platform_fee_percent && r.platform_fee_percent > 0) ? r.platform_fee_percent : (streams.find(s => s.id === r.income_stream_id)?.platform_fee_percent || 0);
               const fee = r.total_sale * (feePct / 100);
               return <span className="font-black text-gray-700">{formatCurrency(r.total_sale - fee)}</span>
            }, className: 'text-right' },
            ...(!isPartner ? [
              { header: 'AGENCY PROFIT', render: (r: Revenue) => {
                const profit = calculateProfit(r);
                return <span className={`font-black ${profit >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{formatCurrency(profit)}</span>;
              }, className: 'text-right' },
              { header: 'ACTIONS', render: (r: Revenue) => (
                <div className="flex justify-end gap-2">
                  <button onClick={() => { setFormData(r as RevenueFormData); setShowModal(true); }} className="p-2 text-gray-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"><Edit2 size={16} /></button>
                  <button onClick={() => handleDelete(r.id)} className="p-2 text-gray-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"><Trash2 size={16} /></button>
                </div>
              )}
            ] : [])
          ]}
        />
      </div>

      <Modal 
        title={formData.id ? 'Edit Revenue Settlement' : 'New Revenue Settlement'} 
        isOpen={showModal} 
        onClose={() => setShowModal(false)} 
        onSave={handleSave}
        saveLabel="Save Settlement"
        maxWidth="max-w-2xl"
      >
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</label>
              <input type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-xl text-sm font-bold shadow-sm outline-none focus:ring-2 focus:ring-indigo-100" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Income Stream</label>
              <SearchableSelect
                options={streams.map(s => ({ value: s.id, label: `${s.name} (${s.platform})` }))}
                value={formData.income_stream_id}
                onChange={id => {
                  const selectedStream = streams.find(s => s.id === id);
                  setFormData({
                    ...formData, 
                    income_stream_id: id,
                    // Auto-fill platform fee from the selected stream configuration
                    platform_fee_percent: selectedStream ? selectedStream.platform_fee_percent : 0
                  });
                }}
                placeholder="Select source..."
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Client Name</label>
            <input type="text" value={formData.client_name} onChange={e => setFormData({...formData, client_name: e.target.value})} className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-xl text-sm font-bold shadow-sm outline-none focus:ring-2 focus:ring-indigo-100" placeholder="e.g. Acme Corp" />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Description</label>
            <textarea value={formData.project_description || ''} onChange={e => setFormData({...formData, project_description: e.target.value})} className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-xl text-sm font-bold shadow-sm outline-none focus:ring-2 focus:ring-indigo-100 resize-none h-24" placeholder="Brief details about the work..." />
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Sale Amount ($)</label>
              <div className="relative">
                <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input type="number" step="0.01" value={formData.total_sale} onChange={e => setFormData({...formData, total_sale: parseFloat(e.target.value)})} className="w-full pl-10 pr-5 py-4 bg-slate-50 border border-slate-100 rounded-xl text-lg font-black text-gray-900 shadow-sm outline-none focus:ring-2 focus:ring-indigo-100" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Platform Fee (%)</label>
              <div className="relative">
                <PieChart className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                <input type="number" step="0.01" value={formData.platform_fee_percent || 0} onChange={e => setFormData({...formData, platform_fee_percent: parseFloat(e.target.value)})} className="w-full pl-10 pr-5 py-4 bg-slate-50 border border-slate-100 rounded-xl text-lg font-black text-rose-500 shadow-sm outline-none focus:ring-2 focus:ring-rose-100" />
              </div>
            </div>
          </div>
        </div>
      </Modal>

      <BulkImportModal isOpen={showImportModal} onClose={() => setShowImportModal(false)} onImport={handleBulkImport} type="revenue" schemaDescription="date, client_name, total_sale, project_description, platform_fee_percent, stream" />
    </div>
  );
};

export default RevenueView;
