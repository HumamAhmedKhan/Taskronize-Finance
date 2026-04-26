
import React, { useState, useEffect, useMemo } from 'react';
import { supabase, db, checkSettledAllocations } from '../lib/supabase';
import { Project, IncomeStream, TeamMember, ProjectAllocation, Revenue } from '../types';
import { extractPaidIds } from '../utils/calculations';
import SearchableSelect from '../components/SearchableSelect';
import Table from '../components/Table';
import Modal from '../components/Modal';
import BulkImportModal from '../components/BulkImportModal';
import { 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  CheckCircle2, 
  Clock, 
  Layers,
  X as CloseIcon,
  MinusCircle,
  Lock,
  FileText,
  AlertCircle,
  PieChart,
  FolderOpen
} from 'lucide-react';

interface ProjectsViewProps {
  globalStart: string;
  globalEnd: string;
  currentUser: User;
}

const ProjectsView: React.FC<ProjectsViewProps> = ({ globalStart, globalEnd, currentUser }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [streams, setStreams] = useState<IncomeStream[]>([]);
  const [revenues, setRevenues] = useState<Revenue[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [allocations, setAllocations] = useState<ProjectAllocation[]>([]);
  const [allLinks, setAllLinks] = useState<{ project_id: number; revenue_id: number }[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [paymentRows, setPaymentRows] = useState<any[]>([]);
  const [otherPayments, setOtherPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  
  const initialForm: Partial<Project> = {
    date: new Date().toISOString().split('T')[0],
    project_name: '',
    client_name: '',
    income_stream_id: undefined,
    project_description: '',
    project_value: 0
  };
  
  const [formData, setFormData] = useState<Partial<Project>>(initialForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formAllocations, setFormAllocations] = useState<Partial<ProjectAllocation>[]>([]);
  const [formLinks, setFormLinks] = useState<number[]>([]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [projData, streamData, revData, linksData, teamData, allocData, payData, payRowsData, otherPayData] = await Promise.all([
        supabase.from('projects').select('*').gte('date', globalStart).lte('date', globalEnd).order('date', { ascending: false }).order('created_at', { ascending: false }),
        db.get<IncomeStream>('income_streams'),
        db.get<Revenue>('revenues'),
        supabase.from('project_revenue_links').select('project_id, revenue_id'),
        db.get<TeamMember>('team_members'),
        db.get<ProjectAllocation>('project_allocations'),
        db.get<any>('production_payments'),
        db.get<any>('payment_project_rows'),
        supabase.from('other_payments').select('*')
      ]);
      
      let filteredProjects = projData.data || [];
      if (currentUser.user_type === 'partner') {
        const partnerStreamIds = currentUser.linked_income_stream_ids || [];
        filteredProjects = partnerStreamIds.length > 0
          ? filteredProjects.filter(p => !p.income_stream_id || partnerStreamIds.includes(p.income_stream_id))
          : filteredProjects;
      }

      const parsedProjects = filteredProjects.map(p => {
        let desc = p.project_description;
        if (desc && desc.startsWith('{')) {
          try {
            const parsed = JSON.parse(desc);
            desc = parsed.text !== undefined ? parsed.text : desc;
          } catch (e) {}
        }
        return { ...p, project_description: desc, _raw_description: p.project_description };
      });
      
      setProjects(parsedProjects);
      setStreams(streamData || []);
      setRevenues(revData);
      setAllLinks(linksData.data || []);
      setTeamMembers(teamData);
      setAllocations(allocData);
      setPayments(payData || []);
      setPaymentRows(payRowsData || []);
      setOtherPayments(otherPayData.data || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, [globalStart, globalEnd]);

  const handleEdit = async (p: Project) => {
    setEditingId(p.id);
    setFormData(p);
    const { data: freshAllocs } = await supabase
      .from('project_allocations')
      .select('*')
      .eq('project_id', p.id);
    setFormAllocations(freshAllocs || []);
    setFormLinks(allLinks.filter(l => l.project_id === p.id).map(l => l.revenue_id));
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.project_name || !formData.project_value) return alert('Fill required fields');
    
    try {
      let projectId: number;
      
      // Preserve JSON structure if it exists
      let finalDescription = formData.project_description;
      if (editingId) {
        const originalProject = projects.find(p => p.id === editingId);
        if (originalProject && (originalProject as any)._raw_description?.startsWith('{')) {
          try {
            const parsed = JSON.parse((originalProject as any)._raw_description);
            parsed.text = formData.project_description;
            finalDescription = JSON.stringify(parsed);
          } catch (e) {}
        }
      }

      const payload = { ...formData, project_description: finalDescription };
      delete (payload as any)._raw_description;

      if (formData.id) {
        await db.update('projects', formData.id, payload as any);
        projectId = formData.id;

        // ALLOCATIONS — insert new + update existing FIRST, then delete removed
        const validAllocs = formAllocations.filter(a => a.team_member_id && a.team_member_id > 0 && a.amount && a.amount > 0);
        const allocsToUpdate = validAllocs.filter(a => a.id);
        const allocsToInsert = validAllocs.filter(a => !a.id);

        // keptIds = ALL form allocs with IDs (including amount=0 assignees from PM view)
        // Declared here so we can add newly inserted IDs before the delete step
        const keptIds = new Set<number>(formAllocations.filter(a => a.id).map(a => a.id as number));

        for (const alloc of allocsToUpdate) {
          const { error } = await supabase.from('project_allocations').update({
            team_member_id: alloc.team_member_id,
            amount: alloc.amount,
            role: alloc.role || 'Production'
          }).eq('id', alloc.id!);
          if (error) throw error;
        }

        if (allocsToInsert.length > 0) {
          const { data: inserted, error } = await supabase.from('project_allocations').insert(
            allocsToInsert.map(a => ({ project_id: projectId, team_member_id: a.team_member_id, amount: a.amount, role: a.role || 'Production' }))
          ).select('id');
          if (error) throw error;
          // Add new IDs so the delete step below doesn't remove them
          (inserted || []).forEach((a: any) => keptIds.add(a.id));
        }

        // Only delete allocations explicitly removed from the form
        const { data: currentAllocs } = await supabase.from('project_allocations').select('id').eq('project_id', projectId);
        const toDeleteAllocIds = (currentAllocs || []).filter(a => !keptIds.has(a.id)).map(a => a.id);
        if (toDeleteAllocIds.length > 0) {
          await checkSettledAllocations(toDeleteAllocIds);
          await supabase.from('project_allocations').delete().in('id', toDeleteAllocIds);
        }

        // REVENUE LINKS — re-fetch fresh from DB to avoid stale allLinks state
        const { data: freshLinks } = await supabase.from('project_revenue_links').select('revenue_id').eq('project_id', projectId);
        const existingRevIds = new Set((freshLinks || []).map((l: any) => l.revenue_id));
        const newRevIds = formLinks.filter(rid => !existingRevIds.has(rid));
        const removedRevIds = [...existingRevIds].filter(rid => !formLinks.includes(rid));

        if (newRevIds.length > 0) {
          const { error } = await supabase.from('project_revenue_links').insert(
            newRevIds.map(rid => ({ project_id: projectId, revenue_id: rid }))
          );
          if (error) throw error;
        }

        if (removedRevIds.length > 0) {
          await supabase.from('project_revenue_links').delete().eq('project_id', projectId).in('revenue_id', removedRevIds);
        }
      } else {
        const newProj = await db.insert<Project>('projects', { ...payload, folders_creating: true });
        projectId = newProj.id;

        if (formAllocations.length > 0) {
          const allocPayload = formAllocations
            .filter(a => a.team_member_id && a.team_member_id > 0 && a.amount && a.amount > 0)
            .map(a => ({ project_id: projectId, team_member_id: a.team_member_id, amount: a.amount, role: a.role || 'Production' }));
          if (allocPayload.length > 0) {
            const { error: allocError } = await supabase.from('project_allocations').insert(allocPayload);
            if (allocError) throw allocError;
          }
        }

        if (formLinks.length > 0) {
          const linkPayload = formLinks.map(rid => ({ project_id: projectId, revenue_id: rid }));
          const { error: linkError } = await supabase.from('project_revenue_links').insert(linkPayload);
          if (linkError) throw linkError;
        }
      }

      setShowModal(false);
      setEditingId(null);
      await loadData();
    } catch (err: any) {
      console.error('Save Error:', err);
      alert(`Persistence error: ${err.message || 'Check database connectivity.'}`);
    }
  };

  const handleDeleteProject = async (id: number) => {
    if (!confirm('Are you sure you want to delete this project? All allocations and revenue links will also be removed.')) return;
    try {
      // Guard: block deletion if any allocation is already settled in a payment
      const { data: allocs } = await supabase.from('project_allocations').select('id').eq('project_id', id);
      await checkSettledAllocations((allocs || []).map((a: any) => a.id));
      await Promise.all([
        supabase.from('project_allocations').delete().eq('project_id', id),
        supabase.from('project_revenue_links').delete().eq('project_id', id)
      ]);
      await db.delete('projects', id);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Delete failed.');
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
      throw new Error("No income streams found in the database. Please create an Income Stream first (e.g., 'Upwork').");
    }

    const payload = data.map(item => {
      let val = item.project_value;
      if (typeof val === 'string') {
        val = parseFloat(val.replace(/[^0-9.-]+/g, ''));
      }
      
      const streamName = String(item.stream || '').toLowerCase();
      const matchedStreamId = currentStreams.find(s => s.name.toLowerCase().includes(streamName))?.id;
      const finalStreamId = matchedStreamId || currentStreams[0].id;

      return {
        date: item.date,
        project_name: item.project_name,
        client_name: item.client_name,
        project_value: isNaN(val) ? 0 : val,
        project_description: item.project_description || '',
        income_stream_id: finalStreamId,
        folders_creating: true
      };
    });

    const { error } = await supabase.from('projects').insert(payload);
    if (error) throw error;
    await loadData();
  };

  const settledAllocIds = useMemo((): Set<number> => {
    const ids = new Set<number>();
    payments.forEach(p => {
      extractPaidIds(p).forEach(id => {
        if (typeof id === 'string' && id.startsWith('ALLOC_')) {
          const num = parseInt(id.slice(6));
          if (!isNaN(num)) ids.add(num);
        }
      });
    });
    return ids;
  }, [payments]);

  const pipelineStats = useMemo(() => {
    const totalValue = projects.reduce((sum, p) => sum + Number(p.project_value || 0), 0);
    const realizedValue = projects.reduce((sum, p) => {
      const linkedRevIds = allLinks.filter(l => l.project_id === p.id).map(l => l.revenue_id);
      const linkedVal = revenues.filter(r => linkedRevIds.includes(r.id)).reduce((s, r) => s + Number(r.total_sale), 0);
      return sum + Math.min(linkedVal, Number(p.project_value)); // Cap at project value
    }, 0);
    const realizationRate = totalValue > 0 ? (realizedValue / totalValue) * 100 : 0;
    const settledCount = projects.filter(p => {
        const linkedRevIds = allLinks.filter(l => l.project_id === p.id).map(l => l.revenue_id);
        const linkedVal = revenues.filter(r => linkedRevIds.includes(r.id)).reduce((s, r) => s + Number(r.total_sale), 0);
        return linkedVal >= Number(p.project_value) * 0.99; // 1% tolerance
    }).length;
    return { totalValue, realizedValue, realizationRate, settledCount };
  }, [projects, allLinks, revenues]);

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

  const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
  
  const getAvatarColor = (name: string) => {
    const colors = [
      'bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-green-500', 
      'bg-emerald-500', 'bg-teal-500', 'bg-cyan-500', 'bg-sky-500', 
      'bg-blue-500', 'bg-indigo-500', 'bg-violet-500', 'bg-purple-500', 
      'bg-fuchsia-500', 'bg-pink-500', 'bg-rose-500'
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  // Helper for modal logic
  const currentLinkedTotal = useMemo(() => {
    return formLinks.reduce((sum, rid) => {
      const r = revenues.find(rv => rv.id === rid);
      return sum + (r ? Number(r.total_sale) : 0);
    }, 0);
  }, [formLinks, revenues]);

  return (
    <div className="space-y-8 pb-32 animate-in fade-in">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm flex justify-between items-center relative overflow-hidden">
          <div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Total Pipeline Value</p>
            <h3 className="text-3xl font-black text-gray-900 tracking-tighter">{formatCurrency(pipelineStats.totalValue)}</h3>
            <p className="text-[10px] font-bold text-gray-500 mt-2 uppercase">{projects.length} PROJECTS ACTIVE</p>
          </div>
          <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-200"><Layers size={32} /></div>
        </div>
        <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm flex justify-between items-center relative overflow-hidden">
          <div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Realized Revenue</p>
            <h3 className="text-3xl font-black text-emerald-600 tracking-tighter">{formatCurrency(pipelineStats.realizedValue)}</h3>
            <p className="text-[10px] font-bold text-emerald-500 mt-2 uppercase">{pipelineStats.settledCount} PROJECTS SETTLED</p>
          </div>
          <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-500/20"><CheckCircle2 size={32} /></div>
        </div>
        <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm flex justify-between items-center relative overflow-hidden">
          <div>
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Realization Rate</p>
            <h3 className="text-3xl font-black text-orange-600 tracking-tighter">{pipelineStats.realizationRate.toFixed(1)}%</h3>
            <p className="text-[10px] font-bold text-orange-500 mt-2 uppercase">OVERALL EFFICIENCY</p>
          </div>
          <div className="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center text-orange-500/20"><Clock size={32} /></div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-[32px] shadow-sm overflow-hidden">
        <header className="px-8 py-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/10">
          <div className="relative w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" size={16} />
            <input type="text" placeholder="Filter projects..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-xs font-bold focus:ring-2 focus:ring-gray-100 transition-all outline-none" />
          </div>
          <div className="flex gap-3">
            {(!currentUser || currentUser.user_type === 'admin') && (
              <button onClick={() => setShowImportModal(true)} className="flex items-center gap-2 bg-indigo-50 text-indigo-600 px-5 py-2.5 rounded-xl font-bold text-xs hover:bg-indigo-100 transition-all">
                <FileText size={16} /> Bulk AI Import
              </button>
            )}
            {(!currentUser || currentUser.user_type === 'admin' || currentUser.user_type === 'partner') && (
              <button onClick={() => { setFormData(initialForm); setFormAllocations([]); setFormLinks([]); setEditingId(null); setShowModal(true); }} className="flex items-center gap-2 bg-gray-900 text-white px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-lg active:scale-95 transition-all">
                <Plus size={16} /> New Project
              </button>
            )}
          </div>
        </header>
        <Table<Project>
          data={projects.filter(p => p.project_name.toLowerCase().includes(searchTerm.toLowerCase()) || p.client_name.toLowerCase().includes(searchTerm.toLowerCase()))}
          rowKey={(p) => String(p.id)}
          columns={[
            { header: 'DATE', render: (p) => <span className="text-xs font-bold text-gray-400">{p.date}</span> },
            { header: 'PROJECT NAME', render: (p) => <span className="font-black text-gray-900 text-sm">{p.project_name}</span> },
            { header: 'CLIENT', render: (p) => <span className="text-xs font-bold text-gray-500">{p.client_name}</span> },
            { header: 'REVENUE STREAM', render: (p) => {
              const stream = streams.find(s => s.id === p.income_stream_id);
              return <span className="text-xs font-bold text-gray-500">{stream ? stream.name : '-'}</span>;
            }},
            { header: 'PROJECT VALUE', render: (p) => <span className="font-black text-gray-900">{formatCurrency(p.project_value)}</span> },
            ...(true ? [
              { 
                header: 'ASSIGNED PRODUCTION', 
                render: (p: Project) => {
                  const projAllocations = allocations.filter(a => a.project_id === p.id);
                  return (
                    <div className="flex -space-x-2 overflow-hidden items-center">
                      {projAllocations.map((a, idx) => {
                        const member = teamMembers.find(m => m.id === a.team_member_id);
                        if (!member) return null;
                        return (
                          <div 
                            key={`${p.id}-${a.id}-${idx}`} 
                            title={`${member.name} - ${formatCurrency(a.amount)}`}
                            className={`inline-flex items-center justify-center w-8 h-8 rounded-full ring-2 ring-white text-[10px] font-black text-white cursor-help shadow-sm transition-transform hover:scale-110 hover:z-10 ${getAvatarColor(member.name)}`}
                          >
                             {getInitials(member.name)}
                          </div>
                        )
                      })}
                      {projAllocations.length === 0 && <span className="text-gray-300 text-xs italic font-medium px-2">Unassigned</span>}
                    </div>
                  )
                }
              },
              { 
                header: 'PRODUCTION COST', 
                render: (p: Project) => {
                  const cost = allocations
                    .filter(a => a.project_id === p.id)
                    .reduce((sum, a) => sum + Number(a.amount), 0);
                  return <span className="font-bold text-gray-700">{formatCurrency(cost)}</span>
                } 
              }
            ] : []),
            { header: 'STATUS', render: (p) => {
              const linkedRevIds = allLinks.filter(l => l.project_id === p.id).map(l => l.revenue_id);
              const linkedVal = revenues.filter(r => linkedRevIds.includes(r.id)).reduce((s, r) => s + Number(r.total_sale), 0);
              const percent = p.project_value > 0 ? (linkedVal / p.project_value) * 100 : 0;
              const isFull = linkedVal >= p.project_value * 0.99; // 1% tolerance for float logic

              if (isFull) {
                return (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-black uppercase border border-emerald-100">
                    <CheckCircle2 size={12} /> Fully Settled
                  </span>
                );
              } else if (linkedVal > 0) {
                return (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-[10px] font-black uppercase border border-blue-100">
                    <PieChart size={12} /> Partial ({percent.toFixed(0)}%)
                  </span>
                );
              } else {
                return (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-gray-50 text-gray-400 rounded-full text-[10px] font-black uppercase border border-gray-100">
                    Pending
                  </span>
                );
              }
            }},
            { header: 'ACTIONS', render: (p) => (
              <div className="flex gap-2 items-center">
                {p.drive_folder_url && (
                  <a href={p.drive_folder_url} target="_blank" rel="noopener noreferrer" title="Open Drive Folder" className="p-2.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all">
                    <FolderOpen size={18} />
                  </a>
                )}
                <button onClick={() => handleEdit(p)} className="p-2.5 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-all"><Edit2 size={18} /></button>
                {currentUser?.user_type === 'admin' && (
                  <button onClick={() => handleDeleteProject(p.id)} className="p-2.5 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"><Trash2 size={18} /></button>
                )}
              </div>
            )}
          ]}
        />
      </div>

      <Modal
        title={formData.id ? 'Edit Project' : 'Record New Project'}
        isOpen={showModal}
        onClose={() => { setShowModal(false); setEditingId(null); setFormAllocations([]); }}
        onSave={handleSave} 
        saveLabel="Save"
        maxWidth="max-w-2xl"
      >
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Project Name</label>
            <input 
              type="text" 
              value={formData.project_name} 
              onChange={e => setFormData({...formData, project_name: e.target.value})} 
              className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-xl text-sm font-bold shadow-sm outline-none" 
              placeholder="Enter project name..."
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Description (Optional)</label>
            <textarea 
              value={formData.project_description || ''} 
              onChange={e => setFormData({...formData, project_description: e.target.value})} 
              className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-xl text-sm font-bold shadow-sm outline-none h-24 resize-none" 
              placeholder="Enter details..."
            />
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Client</label>
              <input type="text" value={formData.client_name} onChange={e => setFormData({...formData, client_name: e.target.value})} className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-xl text-sm font-bold" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Revenue Stream</label>
              <select 
                value={formData.income_stream_id || ''} 
                onChange={e => setFormData({...formData, income_stream_id: e.target.value ? parseInt(e.target.value) : null})}
                className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-xl text-sm font-bold outline-none"
              >
                <option value="">Select Stream</option>
                {streams.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Value ($)</label>
              <input type="number" value={formData.project_value} onChange={e => setFormData({...formData, project_value: parseFloat(e.target.value)})} className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-xl text-sm font-black" />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</label>
              <input type="date" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-xl text-sm font-bold" />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
               <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Linked Revenue</label>
               <span className={`text-[10px] font-black uppercase ${currentLinkedTotal >= (formData.project_value || 0) ? 'text-emerald-500' : 'text-slate-400'}`}>
                 {formatCurrency(currentLinkedTotal)} / {formatCurrency(formData.project_value || 0)} Covered
               </span>
            </div>
            
            {/* Progress Bar for Link Coverage */}
            <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
               <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${Math.min(100, (currentLinkedTotal / (formData.project_value || 1)) * 100)}%` }}></div>
            </div>

            <div className="space-y-2">
              {formLinks.map(rid => {
                const rev = revenues.find(r => r.id === rid);
                return rev ? (
                  <div key={rid} className="flex items-center justify-between p-3 bg-emerald-50 rounded-xl border border-emerald-100 animate-in slide-in-from-left-2">
                    <span className="text-xs font-black text-emerald-900">{rev.client_name} ({formatCurrency(rev.total_sale)})</span>
                    <button onClick={() => setFormLinks(formLinks.filter(id => id !== rid))} className="text-rose-400 hover:text-rose-600 transition-colors"><CloseIcon size={16} /></button>
                  </div>
                ) : null;
              })}

              {currentLinkedTotal < (formData.project_value || 0) ? (
                <SearchableSelect 
                  options={revenues
                    .filter(r => !formLinks.includes(r.id))
                    .map(r => ({ value: r.id, label: `${r.client_name} - ${formatCurrency(r.total_sale)} - ${r.date}` }))
                  }
                  value={null}
                  onChange={rid => rid && setFormLinks([...formLinks, rid])}
                  placeholder="Select revenue record to link..."
                />
              ) : (
                <div className="p-3 bg-gray-50 border border-gray-100 rounded-xl flex items-center gap-2 text-xs font-bold text-gray-500">
                  <CheckCircle2 size={16} className="text-emerald-500" />
                  Project value fully covered. No further revenue can be linked.
                </div>
              )}
            </div>
          </div>

          {currentUser.user_type !== 'partner' && (
            <div className="space-y-4 pt-4 border-t border-gray-50">
              <div className="flex justify-between items-center">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Production Allocations</h4>
                <button 
                  type="button" 
                  onClick={() => setFormAllocations([...formAllocations, { team_member_id: 0, amount: 0, role: 'Production' }])} 
                  className="text-[10px] font-black text-indigo-600 uppercase tracking-widest hover:text-indigo-800"
                >
                  + Add Allocation
                </button>
              </div>
              <div className="space-y-3">
                {formAllocations.map((alloc, idx) => {
                  const isSettled = !!(alloc.id && settledAllocIds.has(alloc.id));
                  return (
                  <div key={idx} className="space-y-1">
                  {isSettled && (
                    <p className="text-[10px] font-bold text-amber-600 flex items-center gap-1 px-1">
                      <AlertCircle size={11} /> Already settled — to adjust, use a Deduction on the Payments page.
                    </p>
                  )}
                  <div className="flex items-center gap-3 animate-in slide-in-from-left-2">
                    <div className="flex-1">
                      <SearchableSelect
                        options={teamMembers.map(m => ({ value: m.id, label: m.name }))}
                        value={alloc.team_member_id}
                        onChange={val => {
                          if (isSettled) return;
                          const newAllocs = [...formAllocations];
                          newAllocs[idx] = { ...newAllocs[idx], team_member_id: val };
                          setFormAllocations(newAllocs);
                        }}
                        disabled={isSettled}
                      />
                    </div>
                    <div className="w-24">
                      <input type="number" placeholder="Amt" value={alloc.amount || ''} readOnly={isSettled} onChange={e => {
                        if (isSettled) return;
                        const newAllocs = [...formAllocations];
                        newAllocs[idx] = { ...newAllocs[idx], amount: parseFloat(e.target.value) };
                        setFormAllocations(newAllocs);
                      }} className={`w-full px-4 py-2 rounded-lg text-xs font-black outline-none ${isSettled ? 'bg-green-50 border border-green-100 text-green-700 cursor-not-allowed' : 'bg-slate-50 border border-slate-100'}`} />
                    </div>
                    {isSettled ? (
                      <div className="flex items-center gap-1 text-[10px] font-bold text-green-600 whitespace-nowrap">
                        <Lock size={13} /> Settled
                      </div>
                    ) : (
                      <button onClick={() => setFormAllocations(formAllocations.filter((_, i) => i !== idx))} className="text-rose-300 hover:text-rose-500 transition-colors"><MinusCircle size={20} /></button>
                    )}
                  </div>
                  </div>
                  );
                })}
                {formAllocations.length === 0 && <p className="text-center text-xs text-slate-300 italic">No allocations recorded.</p>}
              </div>
            </div>
          )}

          {currentUser.user_type === 'partner' && formData.income_stream_id && (
            <div className="space-y-4 pt-4 border-t border-gray-50">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Partner Financial Summary</h4>
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-3">
                {(() => {
                  const stream = streams.find(s => s.id === formData.income_stream_id);
                  const partnerMember = teamMembers.find(m => m.id === currentUser.team_member_id);
                  const rule = stream?.commission_structure?.find((r: any) => r.name === partnerMember?.name);

                  if (!rule) return <p className="text-xs text-slate-500">No commission rule found for your account on this stream.</p>;

                  const grossCommission = (formData.project_value || 0) * (rule.value / 100);

                  // Production cost deduction only — connects deduction removed (no per-project connects cost field)
                  const totalProductionCost = formAllocations.reduce((sum, a) => sum + Number(a.amount || 0), 0);
                  const productionDeduction = rule.deductProduction ? totalProductionCost : 0;

                  const netCommission = grossCommission - productionDeduction;

                  // Amount paid to partner for this specific project
                  const partnerPayments = payments.filter(p => p.recipient_id === partnerMember?.id);
                  const partnerPaymentIds = partnerPayments.map(p => p.id);
                  const amountPaid = paymentRows
                    .filter(pr => pr.project_id === formData.id && partnerPaymentIds.includes(pr.payment_id))
                    .reduce((sum, pr) => sum + Number(pr.amount || 0), 0);

                  const pendingBalance = netCommission - amountPaid;

                  return (
                    <>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Gross Commission ({rule.value}%)</span>
                        <span className="font-bold text-slate-900">{formatCurrency(grossCommission)}</span>
                      </div>
                      {rule.deductProduction && productionDeduction > 0 && (
                        <div className="flex justify-between text-xs text-rose-500">
                          <span>Production Cost Deduction</span>
                          <span>- {formatCurrency(productionDeduction)}</span>
                        </div>
                      )}
                      <div className="pt-2 border-t border-slate-200 flex justify-between text-sm font-black">
                        <span className="text-slate-700">Net Commission</span>
                        <span className="text-emerald-600">{formatCurrency(netCommission)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Amount Paid</span>
                        <span className="font-bold text-slate-900">{formatCurrency(amountPaid)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Pending Balance</span>
                        <span className={`font-bold ${pendingBalance > 0 ? 'text-amber-600' : 'text-slate-900'}`}>{formatCurrency(pendingBalance)}</span>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Team Breakdown */}
              {formAllocations.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Team Breakdown</h4>
                  <div className="rounded-xl border border-slate-100 overflow-hidden">
                    {/* Header row */}
                    <div className="grid grid-cols-3 px-4 py-2 bg-slate-50 border-b border-slate-100">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Member</span>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Allocated</span>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Paid</span>
                    </div>

                    {(() => {
                      const visibleAllocs = formAllocations.filter(a => Number(a.amount || 0) > 0);
                      return visibleAllocs.map((alloc, idx) => {
                      const member = teamMembers.find(m => m.id === alloc.team_member_id);
                      if (!member) return null;

                      const memberPaymentIds = payments
                        .filter(p => p.recipient_id === member.id)
                        .map(p => p.id);
                      const paidAmount = paymentRows
                        .filter(pr => pr.project_id === formData.id && memberPaymentIds.includes(pr.payment_id))
                        .reduce((sum, pr) => sum + Number(pr.amount || 0), 0);

                      const allocated = Number(alloc.amount || 0);
                      const fullyPaid = allocated > 0 && paidAmount >= allocated;

                      return (
                        <div key={idx} className={`grid grid-cols-3 px-4 py-3 items-center bg-white ${idx < visibleAllocs.length - 1 ? 'border-b border-slate-50' : ''}`}>
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-black shrink-0 ${getAvatarColor(member.name)}`}>
                              {getInitials(member.name)}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-slate-800 leading-none truncate">{member.name}</p>
                              <p className="text-[10px] text-slate-400 mt-0.5">{alloc.role || member.role}</p>
                            </div>
                          </div>
                          <span className="text-xs font-bold text-slate-700 text-right">{formatCurrency(allocated)}</span>
                          <div className="flex items-center justify-end gap-1.5">
                            <span className={`text-xs font-bold ${fullyPaid ? 'text-emerald-600' : paidAmount > 0 ? 'text-amber-600' : 'text-slate-500'}`}>
                              {formatCurrency(paidAmount)}
                            </span>
                            {fullyPaid
                              ? <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full whitespace-nowrap">✓ PAID</span>
                              : <span className="text-[9px] font-black text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full whitespace-nowrap">⏳ DUE</span>
                            }
                          </div>
                        </div>
                      );
                      });
                    })()}

                    {/* Totals row — only shown when >1 member */}
                    {(() => {
                      const visibleAllocs = formAllocations.filter(a => Number(a.amount || 0) > 0);
                      return visibleAllocs.length > 1 && (() => {
                      const totalAllocated = visibleAllocs.reduce((sum, a) => sum + Number(a.amount || 0), 0);
                      const totalPaid = visibleAllocs.reduce((sum, alloc) => {
                        const member = teamMembers.find(m => m.id === alloc.team_member_id);
                        if (!member) return sum;
                        const memberPaymentIds = payments.filter(p => p.recipient_id === member.id).map(p => p.id);
                        return sum + paymentRows
                          .filter(pr => pr.project_id === formData.id && memberPaymentIds.includes(pr.payment_id))
                          .reduce((s, pr) => s + Number(pr.amount || 0), 0);
                      }, 0);
                      return (
                        <div className="grid grid-cols-3 px-4 py-2.5 bg-slate-50 border-t border-slate-200">
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Total</span>
                          <span className="text-xs font-black text-slate-800 text-right">{formatCurrency(totalAllocated)}</span>
                          <span className="text-xs font-black text-slate-800 text-right">{formatCurrency(totalPaid)}</span>
                        </div>
                      );
                    })();
                    })()}
                  </div>
                </div>
              )}

              {/* Other Payments — non-project-specific payments to team members on this project */}
              {(() => {
                const memberIds = new Set(formAllocations.map(a => a.team_member_id));
                const relevant = otherPayments.filter(op => op.recipient_id != null && memberIds.has(op.recipient_id) && op.is_paid === true);
                if (relevant.length === 0) return null;
                return (
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Other Payments</h4>
                    <div className="rounded-xl border border-slate-100 overflow-hidden">
                      <div className="grid grid-cols-3 px-4 py-2 bg-slate-50 border-b border-slate-100">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Member</span>
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Description</span>
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Amount</span>
                      </div>
                      {relevant.map((op, idx) => {
                        const member = teamMembers.find(m => m.id === op.recipient_id);
                        return (
                          <div key={op.id} className={`grid grid-cols-3 px-4 py-3 items-center bg-white ${idx < relevant.length - 1 ? 'border-b border-slate-50' : ''}`}>
                            <div className="flex items-center gap-2 min-w-0">
                              {member && (
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-black shrink-0 ${getAvatarColor(member.name)}`}>
                                  {getInitials(member.name)}
                                </div>
                              )}
                              <p className="text-xs font-semibold text-slate-800 leading-none truncate">{op.recipient_name || member?.name}</p>
                            </div>
                            <span className="text-xs text-slate-500 truncate">{op.description}</span>
                            <span className="text-xs font-bold text-slate-700 text-right">{formatCurrency(Number(op.amount || 0))}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </Modal>

      <BulkImportModal isOpen={showImportModal} onClose={() => setShowImportModal(false)} onImport={handleBulkImport} type="project" schemaDescription="date, project_name, client_name, project_value, project_description" />
    </div>
  );
};

export default ProjectsView;
