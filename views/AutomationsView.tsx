import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { TeamMember } from '../types';
import Modal from '../components/Modal';
import { Plus, Zap, Edit2, Trash2, ToggleLeft, ToggleRight, FlaskConical } from 'lucide-react';

interface AutomationCondition {
  field: string;
  operator: string;
  value: string;
}

interface Automation {
  id: number;
  name: string;
  is_active: boolean;
  trigger_event: string;
  trigger_conditions: AutomationCondition[];
  action_type: string;
  action_config: {
    webhook_url?: string;
    channel?: string;
    message?: string;
  };
  last_triggered_at: string | null;
  created_at: string;
}

const TRIGGER_EVENTS = [
  { value: 'status_changed', label: 'Status changes' },
  { value: 'due_date_overdue', label: 'Due date is overdue' },
  { value: 'assignee_added', label: 'Assignee added' },
  { value: 'comment_added', label: 'Comment added' },
  { value: 'project_created', label: 'Project created' },
];

const ACTION_TYPES = [
  { value: 'send_slack_message', label: 'Send Slack message' },
];

const DYNAMIC_FIELDS = [
  { chip: '{project_name}', label: 'Project Name' },
  { chip: '{status}', label: 'Status' },
  { chip: '{due_date}', label: 'Due Date' },
  { chip: '{assignee}', label: 'Assignee' },
  { chip: '{assignee_slack}', label: '@Slack Username' },
];

const DEFAULT_WEBHOOK = import.meta.env.VITE_SLACK_WEBHOOK_URL || '';

const emptyForm = () => ({
  name: '',
  is_active: true,
  trigger_event: 'status_changed',
  trigger_conditions: [] as AutomationCondition[],
  action_type: 'send_slack_message',
  action_config: { webhook_url: DEFAULT_WEBHOOK, channel: '', message: '' },
});

const AutomationsView: React.FC = () => {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [statuses, setStatuses] = useState<{ id: string; name: string }[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState(emptyForm());
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState('');
  const messageRef = useRef<HTMLTextAreaElement>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [autoRes, statusRes, teamRes] = await Promise.all([
        supabase.from('automations').select('*').order('created_at', { ascending: false }),
        supabase.from('project_statuses').select('*').order('created_at', { ascending: true }),
        supabase.from('team_members').select('*').order('name', { ascending: true }),
      ]);
      setAutomations(autoRes.data || []);
      setStatuses(statusRes.data || []);
      setTeamMembers(teamRes.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const openNew = () => {
    setEditingId(null);
    setFormData(emptyForm());
    setTestStatus('idle');
    setTestError('');
    setShowModal(true);
  };

  const openEdit = (a: Automation) => {
    setEditingId(a.id);
    setFormData({
      name: a.name,
      is_active: a.is_active,
      trigger_event: a.trigger_event,
      trigger_conditions: a.trigger_conditions || [],
      action_type: a.action_type,
      action_config: { webhook_url: DEFAULT_WEBHOOK, channel: '', message: '', ...(a.action_config || {}) },
    });
    setTestStatus('idle');
    setTestError('');
    setShowModal(true);
  };

  const handleTest = async () => {
    const cfg = formData.action_config;
    const webhookUrl = cfg.webhook_url || DEFAULT_WEBHOOK;
    if (!webhookUrl) {
      setTestStatus('error');
      setTestError('No webhook URL configured.');
      return;
    }
    const message = (cfg.message || 'Test message from Taskronize Automations.')
      .replace(/{project_name}/g, 'Test Project')
      .replace(/{status}/g, 'Kickoff')
      .replace(/{due_date}/g, 'Today')
      .replace(/{assignee}/g, 'Test User')
      .replace(/{assignee_slack}/g, '@testuser');
    setTestStatus('loading');
    setTestError('');
    try {
      const { data, error } = await supabase.functions.invoke('send-slack', {
        body: { webhook_url: webhookUrl, message, channel: cfg.channel || undefined },
        headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      });
      if (error) throw new Error(error.message);
      if (data && !data.ok) throw new Error(`Slack returned: ${data.response}`);
      setTestStatus('success');
    } catch (err: any) {
      setTestStatus('error');
      setTestError(err?.message || 'Unknown error');
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim()) return alert('Please enter an automation name.');
    const payload = {
      name: formData.name.trim(),
      is_active: formData.is_active,
      trigger_event: formData.trigger_event,
      trigger_conditions: formData.trigger_conditions,
      action_type: formData.action_type,
      action_config: formData.action_config,
    };
    try {
      if (editingId) {
        const { error } = await supabase.from('automations').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('automations').insert(payload);
        if (error) throw error;
      }
      setShowModal(false);
      loadData();
    } catch (err: any) {
      alert(`Error saving automation: ${err?.message || JSON.stringify(err)}`);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this automation?')) return;
    await supabase.from('automations').delete().eq('id', id);
    setAutomations(prev => prev.filter(a => a.id !== id));
  };

  const handleToggle = async (a: Automation) => {
    const { error } = await supabase.from('automations').update({ is_active: !a.is_active }).eq('id', a.id);
    if (!error) setAutomations(prev => prev.map(x => x.id === a.id ? { ...x, is_active: !x.is_active } : x));
  };

  const insertChip = (chip: string) => {
    const el = messageRef.current;
    const current = formData.action_config.message || '';
    if (!el) {
      setFormData(f => ({ ...f, action_config: { ...f.action_config, message: current + chip } }));
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    const newVal = current.slice(0, start) + chip + current.slice(end);
    setFormData(f => ({ ...f, action_config: { ...f.action_config, message: newVal } }));
    setTimeout(() => { el.focus(); el.setSelectionRange(start + chip.length, start + chip.length); }, 0);
  };

  const addCondition = () => {
    setFormData(f => ({
      ...f,
      trigger_conditions: [...f.trigger_conditions, { field: 'status_to', operator: 'is', value: '' }]
    }));
  };

  const updateCondition = (idx: number, key: string, val: string) => {
    setFormData(f => ({
      ...f,
      trigger_conditions: f.trigger_conditions.map((c, i) => i === idx ? { ...c, [key]: val } : c)
    }));
  };

  const removeCondition = (idx: number) => {
    setFormData(f => ({ ...f, trigger_conditions: f.trigger_conditions.filter((_, i) => i !== idx) }));
  };

  const getSummary = (a: Automation) => {
    const trigger = TRIGGER_EVENTS.find(t => t.value === a.trigger_event)?.label || a.trigger_event;
    const action = ACTION_TYPES.find(t => t.value === a.action_type)?.label || a.action_type;
    const channel = a.action_config?.channel ? ` to ${a.action_config.channel}` : '';
    return `When "${trigger}"${channel} → ${action}`;
  };

  const formSummary = () => {
    const trigger = TRIGGER_EVENTS.find(t => t.value === formData.trigger_event)?.label || formData.trigger_event;
    const action = ACTION_TYPES.find(t => t.value === formData.action_type)?.label || formData.action_type;
    return `When "${trigger}" → ${action}`;
  };

  const conditionsSupported = ['status_changed', 'due_date_overdue', 'assignee_added'].includes(formData.trigger_event);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Automations</h2>
          <p className="text-slate-500">Automate notifications and actions based on project events.</p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 rounded-xl font-bold hover:bg-slate-800 transition-all"
        >
          <Plus size={18} /> New Automation
        </button>
      </div>

      {loading ? (
        <div className="py-20 text-center text-slate-400">Loading automations...</div>
      ) : automations.length === 0 ? (
        <div className="py-20 text-center bg-white rounded-2xl border border-slate-200 shadow-sm">
          <Zap size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="font-bold text-slate-600">No automations yet</p>
          <p className="text-sm text-slate-400 mt-1">Create your first automation to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {automations.map(a => (
            <div key={a.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-center gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${a.is_active ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>
                <Zap size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-800">{a.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">{getSummary(a)}</p>
                {a.last_triggered_at && (
                  <p className="text-[10px] text-slate-400 mt-1">Last triggered: {new Date(a.last_triggered_at).toLocaleString()}</p>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button onClick={() => handleToggle(a)} className="flex items-center gap-1.5 text-xs font-bold transition-colors">
                  {a.is_active
                    ? <><ToggleRight size={24} className="text-blue-600" /><span className="text-blue-600">Active</span></>
                    : <><ToggleLeft size={24} className="text-slate-400" /><span className="text-slate-400">Inactive</span></>}
                </button>
                <button onClick={() => openEdit(a)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"><Edit2 size={16} /></button>
                <button onClick={() => handleDelete(a.id)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        title={editingId ? 'Edit Automation' : 'New Automation'}
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSave={handleSave}
        saveLabel="Save Automation"
        maxWidth="max-w-4xl"
        footerExtra={
          <div className="flex items-center gap-3">
            {testStatus === 'success' && (
              <span className="text-xs font-bold text-emerald-600">Test message sent!</span>
            )}
            {testStatus === 'error' && (
              <span className="text-xs font-bold text-red-500">{testError || 'Test failed.'}</span>
            )}
            <button
              onClick={handleTest}
              disabled={testStatus === 'loading'}
              className="flex items-center gap-2 px-5 py-2.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-xl font-bold transition-all text-sm disabled:opacity-50"
            >
              <FlaskConical size={15} />
              {testStatus === 'loading' ? 'Sending...' : 'Test'}
            </button>
          </div>
        }
      >
        <div className="space-y-5">
          {/* Name */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Automation Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-sm font-medium"
              placeholder="e.g. Notify team when status changes to Development"
            />
          </div>

          {/* Two-column layout */}
          <div className="grid grid-cols-2 gap-6">
            {/* LEFT: Trigger */}
            <div className="space-y-4">
              <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Trigger</h4>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Trigger Event</label>
                <select
                  value={formData.trigger_event}
                  onChange={e => setFormData(f => ({ ...f, trigger_event: e.target.value, trigger_conditions: [] }))}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500/20 text-sm font-medium"
                >
                  {TRIGGER_EVENTS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>

              {/* Conditions */}
              {conditionsSupported && (
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-500 uppercase">Conditions</label>

                  {formData.trigger_conditions.map((cond, idx) => (
                    <div key={idx} className="flex items-center gap-2 bg-slate-50 p-3 rounded-xl border border-slate-100">
                      {formData.trigger_event === 'status_changed' && (
                        <>
                          <select
                            value={cond.field}
                            onChange={e => updateCondition(idx, 'field', e.target.value)}
                            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg bg-white text-xs font-medium outline-none"
                          >
                            <option value="status_from">From status</option>
                            <option value="status_to">To status</option>
                          </select>
                          <select
                            value={cond.value}
                            onChange={e => updateCondition(idx, 'value', e.target.value)}
                            className="flex-1 px-3 py-2 border border-slate-200 rounded-lg bg-white text-xs font-medium outline-none"
                          >
                            <option value="">Any</option>
                            {statuses.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                          </select>
                        </>
                      )}
                      {formData.trigger_event === 'due_date_overdue' && (
                        <>
                          <span className="text-xs text-slate-500 font-medium shrink-0">Overdue by</span>
                          <input
                            type="number"
                            min="0"
                            value={Math.floor((parseInt(cond.value) || 0) / 24)}
                            onChange={e => {
                              const days = parseInt(e.target.value) || 0;
                              const hours = (parseInt(cond.value) || 0) % 24;
                              updateCondition(idx, 'value', String(days * 24 + hours));
                            }}
                            className="w-16 px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium outline-none"
                            placeholder="0"
                          />
                          <span className="text-xs text-slate-500 font-medium shrink-0">days</span>
                          <input
                            type="number"
                            min="0"
                            max="23"
                            value={(parseInt(cond.value) || 0) % 24}
                            onChange={e => {
                              const hours = Math.min(23, parseInt(e.target.value) || 0);
                              const days = Math.floor((parseInt(cond.value) || 0) / 24);
                              updateCondition(idx, 'value', String(days * 24 + hours));
                            }}
                            className="w-16 px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium outline-none"
                            placeholder="0"
                          />
                          <span className="text-xs text-slate-500 font-medium shrink-0">hrs</span>
                        </>
                      )}
                      {formData.trigger_event === 'assignee_added' && (
                        <select
                          value={cond.value}
                          onChange={e => updateCondition(idx, 'value', e.target.value)}
                          className="flex-1 px-3 py-2 border border-slate-200 rounded-lg bg-white text-xs font-medium outline-none"
                        >
                          <option value="">Any assignee</option>
                          {teamMembers.map(m => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
                        </select>
                      )}
                      <button onClick={() => removeCondition(idx)} className="text-slate-400 hover:text-red-500 transition-colors shrink-0">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={addCondition}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 mt-1"
                  >
                    <Plus size={13} /> Add condition
                  </button>
                </div>
              )}
            </div>

            {/* RIGHT: Action */}
            <div className="space-y-4">
              <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Action</h4>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Action Type</label>
                <select
                  value={formData.action_type}
                  onChange={e => setFormData(f => ({ ...f, action_type: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-blue-500/20 text-sm font-medium"
                >
                  {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Slack Webhook URL</label>
                <input
                  type="text"
                  value={formData.action_config.webhook_url || ''}
                  onChange={e => setFormData(f => ({ ...f, action_config: { ...f.action_config, webhook_url: e.target.value } }))}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-sm"
                  placeholder="https://hooks.slack.com/services/..."
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Channel</label>
                <input
                  type="text"
                  value={formData.action_config.channel || ''}
                  onChange={e => setFormData(f => ({ ...f, action_config: { ...f.action_config, channel: e.target.value } }))}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-sm"
                  placeholder="#general"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Message</label>
                <textarea
                  ref={messageRef}
                  value={formData.action_config.message || ''}
                  onChange={e => setFormData(f => ({ ...f, action_config: { ...f.action_config, message: e.target.value } }))}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 text-sm resize-none h-24"
                  placeholder="e.g. {project_name} moved to {status} — assigned to {assignee_slack}"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {DYNAMIC_FIELDS.map(f => (
                    <button
                      key={f.chip}
                      type="button"
                      onClick={() => insertChip(f.chip)}
                      className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-[10px] font-bold hover:bg-blue-100 transition-colors"
                      title={f.label}
                    >
                      {f.chip}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Summary bar */}
          <div className="px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl flex items-center gap-2 text-xs font-medium text-slate-600">
            <Zap size={14} className="text-blue-500 shrink-0" />
            {formSummary()}
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default AutomationsView;
