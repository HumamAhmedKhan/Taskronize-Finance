import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { TeamMember } from '../types';
import Modal from '../components/Modal';
import { Plus, Zap, Edit2, Trash2, ToggleLeft, ToggleRight, FlaskConical, X } from 'lucide-react';

interface AutomationCondition {
  field: string;
  operator: string;
  value: string;
}

interface AutomationTrigger {
  event: string;
  conditions: AutomationCondition[];
}

interface AutomationAction {
  type: string;
  // send_slack_message
  webhook_url?: string;
  channel?: string;
  message?: string;
  // change_assignee
  assignee_id?: string;
  // change_status
  status?: string;
  // create_subtask
  subtask_title?: string;
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
    actions?: AutomationAction[];
    extra_triggers?: AutomationTrigger[];
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
  { value: 'change_assignee', label: 'Change assignee' },
  { value: 'change_status', label: 'Change status' },
  { value: 'create_subtask', label: 'Create subtask' },
];

const DYNAMIC_FIELDS = [
  { chip: '{project_name}', label: 'Project Name' },
  { chip: '{status}', label: 'Status' },
  { chip: '{due_date}', label: 'Due Date' },
  { chip: '{assignee}', label: 'Assignee' },
  { chip: '{assignee_slack}', label: '@Slack Username' },
];

const DEFAULT_WEBHOOK = import.meta.env.VITE_SLACK_WEBHOOK_URL || '';

const emptyTrigger = (): AutomationTrigger => ({ event: 'status_changed', conditions: [] });
const emptyAction = (): AutomationAction => ({ type: 'send_slack_message', webhook_url: DEFAULT_WEBHOOK, channel: '', message: '' });

const emptyForm = () => ({
  name: '',
  is_active: true,
  triggers: [emptyTrigger()] as AutomationTrigger[],
  actions: [emptyAction()] as AutomationAction[],
});

// Condition value for due_date_overdue is stored as total minutes.
const totalMinsToDisplay = (totalMins: number) => ({
  days: Math.floor(totalMins / (24 * 60)),
  hours: Math.floor((totalMins % (24 * 60)) / 60),
  minutes: totalMins % 60,
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
    const cfg = a.action_config || {};

    // Reconstruct triggers array
    const primaryTrigger: AutomationTrigger = {
      event: a.trigger_event || 'status_changed',
      conditions: a.trigger_conditions || [],
    };
    const triggers: AutomationTrigger[] = [primaryTrigger, ...(cfg.extra_triggers || [])];

    // Reconstruct actions array — support legacy single-action format
    let actions: AutomationAction[];
    if (cfg.actions && cfg.actions.length > 0) {
      actions = cfg.actions;
    } else {
      actions = [{
        type: a.action_type || 'send_slack_message',
        webhook_url: cfg.webhook_url || DEFAULT_WEBHOOK,
        channel: cfg.channel || '',
        message: cfg.message || '',
      }];
    }

    setFormData({ name: a.name, is_active: a.is_active, triggers, actions });
    setTestStatus('idle');
    setTestError('');
    setShowModal(true);
  };

  // ─── Trigger helpers ──────────────────────────────────────────────────────

  const updateTriggerEvent = (tIdx: number, event: string) => {
    setFormData(f => ({
      ...f,
      triggers: f.triggers.map((t, i) => i === tIdx ? { event, conditions: [] } : t),
    }));
  };

  const addTrigger = () => setFormData(f => ({ ...f, triggers: [...f.triggers, emptyTrigger()] }));

  const removeTrigger = (tIdx: number) =>
    setFormData(f => ({ ...f, triggers: f.triggers.filter((_, i) => i !== tIdx) }));

  const addCondition = (tIdx: number) =>
    setFormData(f => ({
      ...f,
      triggers: f.triggers.map((t, i) =>
        i === tIdx ? { ...t, conditions: [...t.conditions, { field: 'status_to', operator: 'is', value: '' }] } : t
      ),
    }));

  const updateCondition = (tIdx: number, cIdx: number, key: string, val: string) =>
    setFormData(f => ({
      ...f,
      triggers: f.triggers.map((t, i) =>
        i === tIdx
          ? { ...t, conditions: t.conditions.map((c, j) => j === cIdx ? { ...c, [key]: val } : c) }
          : t
      ),
    }));

  const removeCondition = (tIdx: number, cIdx: number) =>
    setFormData(f => ({
      ...f,
      triggers: f.triggers.map((t, i) =>
        i === tIdx ? { ...t, conditions: t.conditions.filter((_, j) => j !== cIdx) } : t
      ),
    }));

  // ─── Action helpers ───────────────────────────────────────────────────────

  const addAction = () => setFormData(f => ({ ...f, actions: [...f.actions, emptyAction()] }));

  const removeAction = (aIdx: number) =>
    setFormData(f => ({ ...f, actions: f.actions.filter((_, i) => i !== aIdx) }));

  const updateAction = (aIdx: number, patch: Partial<AutomationAction>) =>
    setFormData(f => ({
      ...f,
      actions: f.actions.map((a, i) => i === aIdx ? { ...a, ...patch } : a),
    }));

  const changeActionType = (aIdx: number, type: string) => {
    const base: AutomationAction = { type };
    if (type === 'send_slack_message') {
      base.webhook_url = DEFAULT_WEBHOOK;
      base.channel = '';
      base.message = '';
    }
    setFormData(f => ({ ...f, actions: f.actions.map((a, i) => i === aIdx ? base : a) }));
  };

  const insertChip = (aIdx: number, chip: string) => {
    const el = document.querySelector<HTMLTextAreaElement>(`[data-msg-idx="${aIdx}"]`);
    const current = formData.actions[aIdx]?.message || '';
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const newVal = current.slice(0, start) + chip + current.slice(end);
    updateAction(aIdx, { message: newVal });
    setTimeout(() => { el?.focus(); el?.setSelectionRange(start + chip.length, start + chip.length); }, 0);
  };

  // ─── Test (only fires first Slack action) ─────────────────────────────────

  const handleTest = async () => {
    const slackAction = formData.actions.find(a => a.type === 'send_slack_message');
    if (!slackAction) {
      setTestStatus('error');
      setTestError('No Slack message action configured.');
      return;
    }
    const webhookUrl = slackAction.webhook_url || DEFAULT_WEBHOOK;
    if (!webhookUrl) {
      setTestStatus('error');
      setTestError('No webhook URL configured.');
      return;
    }
    const message = (slackAction.message || 'Test message from Taskronize Automations.')
      .replace(/{project_name}/g, 'Test Project')
      .replace(/{status}/g, 'Kickoff')
      .replace(/{due_date}/g, 'Today')
      .replace(/{assignee}/g, 'Test User')
      .replace(/{assignee_slack}/g, '@testuser');
    setTestStatus('loading');
    setTestError('');
    try {
      const { data, error } = await supabase.functions.invoke('send-slack', {
        body: { webhook_url: webhookUrl, message, channel: slackAction.channel || undefined },
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

  // ─── Save ─────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!formData.name.trim()) return alert('Please enter an automation name.');
    if (formData.triggers.length === 0) return alert('Please add at least one trigger.');
    if (formData.actions.length === 0) return alert('Please add at least one action.');

    const [primaryTrigger, ...extraTriggers] = formData.triggers;
    const payload = {
      name: formData.name.trim(),
      is_active: formData.is_active,
      trigger_event: primaryTrigger.event,
      trigger_conditions: primaryTrigger.conditions,
      action_type: formData.actions[0].type,
      action_config: {
        // Legacy compat fields from first Slack action
        ...(formData.actions[0].type === 'send_slack_message' ? {
          webhook_url: formData.actions[0].webhook_url,
          channel: formData.actions[0].channel,
          message: formData.actions[0].message,
        } : {}),
        actions: formData.actions,
        extra_triggers: extraTriggers.length > 0 ? extraTriggers : undefined,
      },
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

  const getSummary = (a: Automation) => {
    const cfg = a.action_config || {};
    const trigger = TRIGGER_EVENTS.find(t => t.value === a.trigger_event)?.label || a.trigger_event;
    const extraCount = (cfg.extra_triggers || []).length;
    const triggerStr = extraCount > 0 ? `${trigger} (+${extraCount} more)` : trigger;
    const actions: AutomationAction[] = cfg.actions?.length ? cfg.actions : [{ type: a.action_type }];
    const actionStr = actions.map(ac => ACTION_TYPES.find(t => t.value === ac.type)?.label || ac.type).join(', ');
    return `When "${triggerStr}" → ${actionStr}`;
  };

  const conditionsSupported = (event: string) =>
    ['status_changed', 'due_date_overdue', 'assignee_added'].includes(event);

  // ─── Render ───────────────────────────────────────────────────────────────

  const renderCondition = (trigger: AutomationTrigger, tIdx: number, cond: AutomationCondition, cIdx: number) => (
    <div key={cIdx} className="flex flex-wrap items-center gap-2 bg-white p-2.5 rounded-lg border border-slate-200">
      {trigger.event === 'status_changed' && (
        <>
          <select
            value={cond.field}
            onChange={e => updateCondition(tIdx, cIdx, 'field', e.target.value)}
            className="px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white text-xs font-medium outline-none"
          >
            <option value="status_from">From status</option>
            <option value="status_to">To status</option>
          </select>
          <select
            value={cond.value}
            onChange={e => updateCondition(tIdx, cIdx, 'value', e.target.value)}
            className="px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white text-xs font-medium outline-none"
          >
            <option value="">Any</option>
            {statuses.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </>
      )}
      {trigger.event === 'due_date_overdue' && (() => {
        // value stored as total minutes
        const totalMins = parseInt(cond.value) || 0;
        const { days, hours, minutes } = totalMinsToDisplay(totalMins);
        const setTotalMins = (d: number, h: number, m: number) =>
          updateCondition(tIdx, cIdx, 'value', String(d * 24 * 60 + h * 60 + m));
        return (
          <>
            <span className="text-xs text-slate-500 font-medium shrink-0">Overdue by</span>
            <input
              type="number" min="0"
              value={days}
              onChange={e => setTotalMins(parseInt(e.target.value) || 0, hours, minutes)}
              className="w-14 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-medium outline-none"
              placeholder="0"
            />
            <span className="text-xs text-slate-500 font-medium shrink-0">d</span>
            <input
              type="number" min="0" max="23"
              value={hours}
              onChange={e => setTotalMins(days, Math.min(23, parseInt(e.target.value) || 0), minutes)}
              className="w-14 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-medium outline-none"
              placeholder="0"
            />
            <span className="text-xs text-slate-500 font-medium shrink-0">h</span>
            <input
              type="number" min="0" max="59"
              value={minutes}
              onChange={e => setTotalMins(days, hours, Math.min(59, parseInt(e.target.value) || 0))}
              className="w-14 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-medium outline-none"
              placeholder="0"
            />
            <span className="text-xs text-slate-500 font-medium shrink-0">m</span>
          </>
        );
      })()}
      {trigger.event === 'assignee_added' && (
        <select
          value={cond.value}
          onChange={e => updateCondition(tIdx, cIdx, 'value', e.target.value)}
          className="flex-1 px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white text-xs font-medium outline-none"
        >
          <option value="">Any assignee</option>
          {teamMembers.map(m => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
        </select>
      )}
      <button onClick={() => removeCondition(tIdx, cIdx)} className="ml-auto text-slate-400 hover:text-red-500 transition-colors shrink-0">
        <X size={13} />
      </button>
    </div>
  );

  const renderTriggerCard = (trigger: AutomationTrigger, tIdx: number) => (
    <div key={tIdx} className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/50">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 shrink-0">
          {tIdx === 0 ? 'When' : 'Or when'}
        </span>
        <select
          value={trigger.event}
          onChange={e => updateTriggerEvent(tIdx, e.target.value)}
          className="flex-1 px-3 py-2 border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-blue-500/20 text-sm font-medium"
        >
          {TRIGGER_EVENTS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        {formData.triggers.length > 1 && (
          <button onClick={() => removeTrigger(tIdx)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all shrink-0">
            <X size={15} />
          </button>
        )}
      </div>

      {conditionsSupported(trigger.event) && (
        <div className="space-y-1.5 pl-2">
          {trigger.conditions.map((cond, cIdx) => renderCondition(trigger, tIdx, cond, cIdx))}
          <button
            type="button"
            onClick={() => addCondition(tIdx)}
            className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
          >
            <Plus size={12} /> Add condition
          </button>
        </div>
      )}
    </div>
  );

  const renderActionCard = (action: AutomationAction, aIdx: number) => (
    <div key={aIdx} className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/50">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 shrink-0">
          {aIdx === 0 ? 'Then' : 'And'}
        </span>
        <select
          value={action.type}
          onChange={e => changeActionType(aIdx, e.target.value)}
          className="flex-1 px-3 py-2 border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-blue-500/20 text-sm font-medium"
        >
          {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
        {formData.actions.length > 1 && (
          <button onClick={() => removeAction(aIdx)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all shrink-0">
            <X size={15} />
          </button>
        )}
      </div>

      {action.type === 'send_slack_message' && (
        <div className="space-y-2.5 pl-2">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Webhook URL</label>
            <input
              type="text"
              value={action.webhook_url || ''}
              onChange={e => updateAction(aIdx, { webhook_url: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-xs"
              placeholder="https://hooks.slack.com/services/..."
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Channel</label>
            <input
              type="text"
              value={action.channel || ''}
              onChange={e => updateAction(aIdx, { channel: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-xs"
              placeholder="#general"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Message</label>
            <textarea
              data-msg-idx={aIdx}
              value={action.message || ''}
              onChange={e => updateAction(aIdx, { message: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-xs resize-none h-20"
              placeholder="e.g. {project_name} moved to {status} — {assignee_slack}"
            />
            <div className="flex flex-wrap gap-1 mt-1.5">
              {DYNAMIC_FIELDS.map(f => (
                <button
                  key={f.chip}
                  type="button"
                  onClick={() => insertChip(aIdx, f.chip)}
                  className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-[10px] font-bold hover:bg-blue-100 transition-colors"
                  title={f.label}
                >
                  {f.chip}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {action.type === 'change_assignee' && (
        <div className="pl-2">
          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Assign to</label>
          <select
            value={action.assignee_id || ''}
            onChange={e => updateAction(aIdx, { assignee_id: e.target.value })}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-blue-500/20 text-sm font-medium"
          >
            <option value="">Select team member…</option>
            {teamMembers.map(m => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
          </select>
        </div>
      )}

      {action.type === 'change_status' && (
        <div className="pl-2">
          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Set status to</label>
          <select
            value={action.status || ''}
            onChange={e => updateAction(aIdx, { status: e.target.value })}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white outline-none focus:ring-2 focus:ring-blue-500/20 text-sm font-medium"
          >
            <option value="">Select status…</option>
            {statuses.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </div>
      )}

      {action.type === 'create_subtask' && (
        <div className="pl-2">
          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Subtask title</label>
          <input
            type="text"
            value={action.subtask_title || ''}
            onChange={e => updateAction(aIdx, { subtask_title: e.target.value })}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500/20 text-sm"
            placeholder="e.g. Follow up with client"
          />
        </div>
      )}
    </div>
  );

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
        maxWidth="max-w-2xl"
        footerExtra={
          <div className="flex items-center gap-3">
            {testStatus === 'success' && <span className="text-xs font-bold text-emerald-600">Test message sent!</span>}
            {testStatus === 'error' && <span className="text-xs font-bold text-red-500">{testError || 'Test failed.'}</span>}
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

          {/* Triggers */}
          <div className="space-y-2">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest pb-1 border-b border-slate-100">Triggers</h4>
            {formData.triggers.map((trigger, tIdx) => renderTriggerCard(trigger, tIdx))}
            <button
              type="button"
              onClick={addTrigger}
              className="w-full py-2 border border-dashed border-slate-300 rounded-xl text-xs font-bold text-slate-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 transition-all flex items-center justify-center gap-1.5"
            >
              <Plus size={13} /> Add trigger
            </button>
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest pb-1 border-b border-slate-100">Actions</h4>
            {formData.actions.map((action, aIdx) => renderActionCard(action, aIdx))}
            <button
              type="button"
              onClick={addAction}
              className="w-full py-2 border border-dashed border-slate-300 rounded-xl text-xs font-bold text-slate-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 transition-all flex items-center justify-center gap-1.5"
            >
              <Plus size={13} /> Add action
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default AutomationsView;
