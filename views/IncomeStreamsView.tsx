
import React, { useState, useEffect, useContext } from 'react';
import { supabase, db } from '../lib/supabase';
import { IncomeStream, TeamMember } from '../types';
import { AuthContext } from '../App';
import SearchableSelect from '../components/SearchableSelect';
import Modal from '../components/Modal';
import { Plus, Database, Edit2, Trash2, X, ToggleLeft, ToggleRight, Layers, Trash } from 'lucide-react';

const IncomeStreamsView: React.FC = () => {
  const [streams, setStreams] = useState<IncomeStream[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState<Partial<IncomeStream>>({
    name: '',
    platform: '',
    platform_fee_percent: 0,
    commission_structure: [],
    is_active: true
  });

  const auth = useContext(AuthContext);

  const loadData = async () => {
    setLoading(true);
    try {
      const [streamData, teamData] = await Promise.all([
        db.get<IncomeStream>('income_streams'),
        db.get<TeamMember>('team_members')
      ]);
      setStreams(streamData || []);
      setTeamMembers(teamData || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSave = async () => {
    try {
      if (formData.id) {
        await db.update('income_streams', formData.id, formData);
      } else {
        await db.insert('income_streams', formData);
      }
      setShowModal(false);
      loadData();
    } catch (err) {
      alert('Error saving income stream');
    }
  };

  const addCommissionRule = () => {
    const rules = formData.commission_structure || [];
    setFormData({
      ...formData,
      commission_structure: [
        ...rules,
        { type: 'percentage', name: '', calculationBase: 'net', value: 0, deductConnects: false, deductProduction: false }
      ]
    });
  };

  const updateCommissionRule = (idx: number, field: string, val: any) => {
    const rules = [...(formData.commission_structure || [])];
    rules[idx] = { ...rules[idx], [field]: val };
    setFormData({ ...formData, commission_structure: rules });
  };

  const removeCommissionRule = (idx: number) => {
    const rules = (formData.commission_structure || []).filter((_, i) => i !== idx);
    setFormData({ ...formData, commission_structure: rules });
  };

  const handleToggleActive = async (id: number, currentStatus: boolean) => {
    try {
      await db.update('income_streams', id, { is_active: !currentStatus });
      loadData();
    } catch (err) {
      alert('Error updating status');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Income Streams</h2>
          <p className="text-slate-500">Configure platforms and automatic commission calculation rules.</p>
        </div>
        {auth?.canAccess('incomeStreams') && (
          <button 
            onClick={() => {
              setFormData({ name: '', platform: '', platform_fee_percent: 0, commission_structure: [], is_active: true });
              setShowModal(true);
            }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl transition-all shadow-lg shadow-blue-500/20 font-bold"
          >
            <Plus size={20} />
            <span>Create Stream</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {loading ? (
          <div className="col-span-full text-center py-20 text-slate-400">Loading platforms...</div>
        ) : streams.length === 0 ? (
          <div className="col-span-full py-20 bg-white rounded-2xl border border-dashed border-slate-300 text-center text-slate-400">No income streams configured.</div>
        ) : streams.map((stream) => (
          <div key={stream.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col group hover:border-blue-300 transition-all">
            <div className="p-6 flex-1">
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-blue-50 text-blue-600 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-all">
                  <Database size={24} />
                </div>
                <button onClick={() => handleToggleActive(stream.id, stream.is_active)} className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider transition-all ${stream.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                  {stream.is_active ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                  {stream.is_active ? 'Active' : 'Inactive'}
                </button>
              </div>
              <h3 className="text-xl font-bold text-slate-800">{stream.name}</h3>
              <p className="text-sm text-slate-500 mb-6">{stream.platform}</p>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Platform Fee</p>
                  <p className="text-lg font-black text-slate-900">{stream.platform_fee_percent}%</p>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Rules</p>
                  <p className="text-lg font-black text-slate-900">{stream.commission_structure?.length || 0}</p>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex gap-3">
              <button onClick={() => { setFormData(stream); setShowModal(true); }} className="flex-1 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-lg hover:border-blue-300 hover:text-blue-600 transition-all flex items-center justify-center gap-2">
                <Edit2 size={14} /> Edit Settings
              </button>
              <button onClick={() => { if(confirm('Delete stream?')) db.delete('income_streams', stream.id).then(loadData); }} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"><Trash2 size={16} /></button>
            </div>
          </div>
        ))}
      </div>

      <Modal title="Income Stream Configuration" isOpen={showModal} onClose={() => setShowModal(false)} onSave={handleSave} maxWidth="max-w-3xl">
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Stream Name</label>
              <input type="text" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-4 py-2 border rounded-xl" placeholder="e.g. Upwork Main" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Platform</label>
              <input type="text" required value={formData.platform} onChange={e => setFormData({...formData, platform: e.target.value})} className="w-full px-4 py-2 border rounded-xl" placeholder="e.g. Upwork" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Platform Service Fee (%)</label>
            <input type="number" step="0.01" required value={formData.platform_fee_percent} onChange={e => setFormData({...formData, platform_fee_percent: parseFloat(e.target.value)})} className="w-full px-4 py-2 border rounded-xl font-bold" />
          </div>

          <div className="space-y-4 pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <h4 className="font-black text-slate-400 text-[11px] uppercase tracking-widest flex items-center gap-2">Commission Rules</h4>
              <button type="button" onClick={addCommissionRule} className="text-xs font-bold text-blue-600 hover:underline transition-all">+ Add Rule</button>
            </div>
            <div className="space-y-4">
              {(formData.commission_structure || []).map((rule: any, idx: number) => (
                <div key={idx} className="bg-slate-50/50 p-6 rounded-[24px] border border-slate-100 relative group">
                  <button type="button" onClick={() => removeCommissionRule(idx)} className="absolute top-4 right-4 p-1 text-slate-300 hover:text-red-500 transition-colors"><X size={18} /></button>
                  <div className="grid grid-cols-4 gap-4 mb-4">
                    <div className="col-span-2">
                      <label className="text-[9px] text-slate-400 font-black uppercase tracking-widest mb-1 block">Team Member</label>
                      <SearchableSelect
                        options={teamMembers.map(tm => ({ value: tm.name, label: `${tm.name} (${tm.role})` }))}
                        value={rule.name}
                        onChange={name => updateCommissionRule(idx, 'name', name)}
                        placeholder="Select member"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-slate-400 font-black uppercase tracking-widest mb-1 block">Type</label>
                      <select value={rule.type} onChange={e => updateCommissionRule(idx, 'type', e.target.value)} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-xs bg-white font-bold outline-none">
                        <option value="percentage">%</option>
                        <option value="fixed">$</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[9px] text-slate-400 font-black uppercase tracking-widest mb-1 block">Base</label>
                      <select value={rule.calculationBase} onChange={e => updateCommissionRule(idx, 'calculationBase', e.target.value)} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-xs bg-white font-bold outline-none">
                        <option value="gross">Gross</option>
                        <option value="net">Net</option>
                        <option value="remaining">Rem.</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-4 items-end">
                    <div>
                      <label className="text-[9px] text-slate-400 font-black uppercase tracking-widest mb-1 block">Value</label>
                      <input type="number" step="0.01" required value={rule.value} onChange={e => updateCommissionRule(idx, 'value', parseFloat(e.target.value))} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-xs font-black bg-white outline-none" />
                    </div>
                    <div className="col-span-3 flex gap-6 pb-2 px-1">
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                        <input type="checkbox" checked={rule.deductConnects} onChange={e => updateCommissionRule(idx, 'deductConnects', e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" /> Deduct Connects
                      </label>
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                        <input type="checkbox" checked={rule.deductProduction} onChange={e => updateCommissionRule(idx, 'deductProduction', e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" /> Deduct Production
                      </label>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default IncomeStreamsView;
