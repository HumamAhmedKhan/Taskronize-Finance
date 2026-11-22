import React, { useEffect, useMemo, useState } from 'react';
import { supabase, stripeInvoices } from '../lib/supabase';
import { Client, Invoice, InvoiceLine, ProjectInvoiceBalance } from '../types';
import Modal from '../components/Modal';
import {
  Plus, Search, Copy, ExternalLink, RefreshCw, XCircle, Check, ArrowLeft, Loader2, Edit2, FileText, Users,
} from 'lucide-react';

type InvoiceRow = Invoice & { clients: { name: string } | null; invoice_lines: InvoiceLine[] };
type Step = 'client' | 'projects' | 'review' | 'done';
type DraftLine = { description: string; amount: string };

const DAYS_UNTIL_DUE = 7;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
const formatDate = (d: string | null) => d ? new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const roundCents = (n: number) => Math.round(n * 100) / 100;

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const levenshtein = (a: string, b: string) => {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
};
// Ranks a client name against what was typed; tolerates small typos ("Aron" finds "Aaron").
const matchScore = (name: string, query: string) => {
  const n = normalize(name), q = normalize(query);
  if (!q) return 0;
  if (n.startsWith(q)) return 3;
  if (n.includes(q)) return 2;
  const tolerance = q.length <= 3 ? 0 : q.length <= 5 ? 1 : q.length <= 9 ? 2 : 3;
  const closeTo = (target: string) =>
    [q.length - 1, q.length, q.length + 1].some(k => k > 0 && levenshtein(target.slice(0, k), q) <= tolerance);
  return closeTo(n) || n.split(' ').some(closeTo) ? 1 : -1;
};

const statusStyles: Record<Invoice['status'], string> = {
  creating: 'bg-slate-100 text-slate-600',
  open: 'bg-amber-100 text-amber-700',
  paid: 'bg-emerald-100 text-emerald-700',
  void: 'bg-slate-100 text-slate-400 line-through',
  failed: 'bg-red-100 text-red-700',
};
const statusLabel: Record<Invoice['status'], string> = {
  creating: 'Creating', open: 'Awaiting payment', paid: 'Paid', void: 'Cancelled', failed: 'Failed',
};

const InvoicesView: React.FC = () => {
  const [tab, setTab] = useState<'invoices' | 'clients'>('invoices');
  const [clients, setClients] = useState<Client[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [projectCounts, setProjectCounts] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [busyInvoice, setBusyInvoice] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // New-invoice flow
  const [step, setStep] = useState<Step | null>(null);
  const [query, setQuery] = useState('');
  const [client, setClient] = useState<Client | null>(null);
  const [balances, setBalances] = useState<ProjectInvoiceBalance[]>([]);
  const [showDone, setShowDone] = useState(false);
  const doneCount = balances.filter(b => b.remaining <= 0).length;
  const visibleBalances = showDone ? balances : balances.filter(b => b.remaining > 0);
  const [selected, setSelected] = useState<Record<number, DraftLine>>({});
  const [email, setEmail] = useState('');
  const [mirjanInvolved, setMirjanInvolved] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [created, setCreated] = useState<Invoice | null>(null);

  // Clients tab
  const [clientSearch, setClientSearch] = useState('');
  const [editingClient, setEditingClient] = useState<Partial<Client> | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadData = async () => {
    setLoading(true);
    const [clientRes, invoiceRes, projectRes] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('invoices').select('*, clients(name), invoice_lines(*)').order('created_at', { ascending: false }),
      supabase.from('projects').select('client_id'),
    ]);
    setClients(clientRes.data || []);
    setInvoices((invoiceRes.data as InvoiceRow[]) || []);
    const counts: Record<number, number> = {};
    (projectRes.data || []).forEach((p: any) => { if (p.client_id) counts[p.client_id] = (counts[p.client_id] || 0) + 1; });
    setProjectCounts(counts);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const suggestions = useMemo(() => {
    if (!query.trim()) return clients.slice(0, 8);
    return clients
      .map(c => ({ c, score: matchScore(c.name, query) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name))
      .slice(0, 8)
      .map(x => x.c);
  }, [clients, query]);

  const startNewInvoice = () => {
    setStep('client'); setQuery(''); setClient(null); setBalances([]); setSelected({});
    setEmail(''); setMirjanInvolved(false); setCreateError(''); setCreated(null);
  };

  const draftLine = (b: ProjectInvoiceBalance): DraftLine => ({
    description: `${b.project_name} — Installment ${b.installments_so_far + 1}`,
    amount: b.remaining.toFixed(2),
  });

  const pickClient = async (c: Client, preselectIds: number[] = []) => {
    setClient(c);
    setEmail(c.email || '');
    setSelected({});
    setShowDone(false);
    const { data, error } = await supabase.rpc('project_invoice_balances', { p_client_id: c.id });
    if (error) { showToast(`Could not load projects: ${error.message}`, 'error'); return; }
    const loaded: ProjectInvoiceBalance[] = (data || []).map((b: any) => ({ ...b, project_value: Number(b.project_value), paid: Number(b.paid), open_invoiced: Number(b.open_invoiced), remaining: Number(b.remaining) }));
    setBalances(loaded);
    const preselected = loaded.filter(b => preselectIds.includes(b.project_id) && b.remaining > 0);
    if (preselected.length) {
      setSelected(Object.fromEntries(preselected.map(b => [b.project_id, draftLine(b)])));
      if (preselected.length < preselectIds.length) showToast(`${preselectIds.length - preselected.length} selected project(s) have nothing left to invoice and were skipped.`, 'error');
      setStep('review');
    } else {
      if (preselectIds.length) showToast('The selected projects have nothing left to invoice.', 'error');
      setStep('projects');
    }
  };

  // Opened from Projects → "Create invoice" with a selection.
  useEffect(() => {
    if (loading || !clients.length) return;
    let draft: { client_id: number; project_ids: number[] } | null = null;
    try {
      draft = JSON.parse(sessionStorage.getItem('invoiceDraft') || 'null');
      sessionStorage.removeItem('invoiceDraft');
    } catch {}
    const c = draft && clients.find(x => x.id === draft!.client_id);
    if (c && draft) {
      setTab('invoices'); setCreated(null); setCreateError(''); setMirjanInvolved(false);
      pickClient(c, draft.project_ids);
    }
  }, [loading, clients]);

  const toggleProject = (b: ProjectInvoiceBalance) => {
    setSelected(prev => {
      const next = { ...prev };
      if (next[b.project_id]) delete next[b.project_id];
      else next[b.project_id] = draftLine(b);
      return next;
    });
  };

  const selectedBalances = balances.filter(b => selected[b.project_id]);
  const lineErrors = useMemo(() => {
    const errs: Record<number, string> = {};
    selectedBalances.forEach(b => {
      const line = selected[b.project_id];
      const amount = Number(line.amount);
      if (!line.description.trim()) errs[b.project_id] = 'Add a description';
      else if (!(amount > 0)) errs[b.project_id] = 'Amount must be more than $0';
      else if (roundCents(amount) > roundCents(b.remaining)) errs[b.project_id] = `Only ${formatCurrency(b.remaining)} left to invoice`;
    });
    return errs;
  }, [selected, balances]);
  const total = selectedBalances.reduce((s, b) => s + (Number(selected[b.project_id].amount) || 0), 0);
  const emailValid = EMAIL_RE.test(email.trim());
  const canCreate = selectedBalances.length > 0 && Object.keys(lineErrors).length === 0 && emailValid && !creating;
  const dueDate = new Date(Date.now() + DAYS_UNTIL_DUE * 86400000).toISOString().slice(0, 10);

  const setLine = (projectId: number, patch: Partial<DraftLine>) =>
    setSelected(prev => ({ ...prev, [projectId]: { ...prev[projectId], ...patch } }));

  const createInvoice = async () => {
    if (!client || !canCreate) return;
    setCreating(true); setCreateError('');
    try {
      const { invoice } = await stripeInvoices({
        action: 'create',
        client_id: client.id,
        email: email.trim(),
        mirjan_involved: mirjanInvolved,
        lines: selectedBalances.map(b => ({
          project_id: b.project_id,
          description: selected[b.project_id].description.trim(),
          amount: roundCents(Number(selected[b.project_id].amount)),
        })),
      });
      setCreated(invoice);
      setStep('done');
      loadData();
    } catch (err: any) {
      setCreateError(err.message || 'Could not create the invoice');
      loadData();
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async (inv: Invoice) => {
    if (!inv.hosted_invoice_url) return;
    try {
      await navigator.clipboard.writeText(inv.hosted_invoice_url);
      setCopiedId(inv.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      window.prompt('Copy this payment link:', inv.hosted_invoice_url);
    }
  };

  const runInvoiceAction = async (inv: Invoice, action: 'refresh' | 'void') => {
    if (action === 'void' && !confirm('Cancel this invoice? The payment link will stop working.')) return;
    setBusyInvoice(inv.id);
    try {
      const { invoice } = await stripeInvoices({ action, invoice_id: inv.id });
      if (action === 'refresh') showToast(invoice?.status === 'paid' ? 'Paid — revenue entry recorded.' : `Status: ${statusLabel[invoice?.status as Invoice['status']] ?? 'unchanged'}`);
      else showToast('Invoice cancelled.');
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Something went wrong', 'error');
      await loadData();
    } finally {
      setBusyInvoice(null);
    }
  };

  const saveClient = async () => {
    if (!editingClient) return;
    const name = (editingClient.name || '').trim().replace(/\s+/g, ' ');
    const clientEmail = (editingClient.email || '').trim();
    if (!name) return showToast('Client name is required', 'error');
    if (clientEmail && !EMAIL_RE.test(clientEmail)) return showToast('That email address does not look right', 'error');
    const payload = { name, email: clientEmail || null, company: editingClient.company?.trim() || null, notes: editingClient.notes?.trim() || null };
    const { error } = editingClient.id
      ? await supabase.from('clients').update(payload).eq('id', editingClient.id)
      : await supabase.from('clients').insert(payload);
    if (error) {
      return showToast(error.code === '23505' ? 'A client with that name already exists' : `Could not save: ${error.message}`, 'error');
    }
    setEditingClient(null);
    await loadData();
    showToast('Client saved.');
  };

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients;
    return clients.filter(c => matchScore(c.name, clientSearch) > 0 || (c.email || '').toLowerCase().includes(clientSearch.toLowerCase()));
  }, [clients, clientSearch]);

  // ---------- New invoice flow ----------
  const renderNewInvoice = () => (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {step !== 'client' && step !== 'done' && (
            <button onClick={() => setStep(step === 'review' ? 'projects' : 'client')} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><ArrowLeft size={18} /></button>
          )}
          <h3 className="font-bold text-slate-800">
            {step === 'client' && 'New invoice — choose client'}
            {step === 'projects' && `New invoice — ${client?.name}`}
            {step === 'review' && 'Review invoice'}
            {step === 'done' && 'Payment link ready'}
          </h3>
        </div>
        <button onClick={() => setStep(null)} className="text-sm font-semibold text-slate-500 hover:text-slate-800">Close</button>
      </div>

      <div className="p-6">
        {step === 'client' && (
          <div className="max-w-xl space-y-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Type the client's name..." className="w-full pl-9 pr-4 py-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
            <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
              {suggestions.length === 0 && <p className="p-4 text-sm text-slate-500">No client matches. Add them on the Clients tab first.</p>}
              {suggestions.map(c => (
                <button key={c.id} onClick={() => pickClient(c)} className="w-full text-left px-4 py-3 hover:bg-blue-50 flex items-center justify-between">
                  <span>
                    <span className="block font-semibold text-slate-800">{c.name}</span>
                    <span className="block text-xs text-slate-500">{c.email || 'No email yet'}{c.company ? ` · ${c.company}` : ''}</span>
                  </span>
                  <span className="text-xs text-slate-400">{projectCounts[c.id] || 0} projects</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'projects' && (
          <div className="space-y-4">
            {balances.length === 0 ? (
              <p className="text-sm text-slate-600 bg-amber-50 border border-amber-100 rounded-xl p-4">
                {client?.name} has no projects in an income stream set up for Stripe invoicing. On the Income Streams page, edit the stream and tick “Invoice through Stripe”.
              </p>
            ) : visibleBalances.length === 0 ? (
              <p className="text-sm text-slate-600 bg-slate-50 border border-slate-100 rounded-xl p-4">
                Every project for {client?.name} is already paid or fully invoiced — nothing left to bill.
              </p>
            ) : (
              <div className="overflow-x-auto border border-slate-100 rounded-xl">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
                    <tr>
                      <th className="p-3 w-10"></th>
                      <th className="p-3 text-left">Project</th>
                      <th className="p-3 text-right">Value</th>
                      <th className="p-3 text-right">Paid</th>
                      <th className="p-3 text-right">Invoiced, unpaid</th>
                      <th className="p-3 text-right">Left to invoice</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleBalances.map(b => {
                      const done = b.remaining <= 0;
                      return (
                        <tr key={b.project_id} className={done ? 'text-slate-400' : 'hover:bg-slate-50 cursor-pointer'} onClick={() => !done && toggleProject(b)}>
                          <td className="p-3"><input type="checkbox" disabled={done} checked={!!selected[b.project_id]} onChange={() => toggleProject(b)} onClick={e => e.stopPropagation()} /></td>
                          <td className="p-3"><span className="font-semibold">{b.project_name}</span><span className="block text-xs text-slate-400">{b.stream_name}</span></td>
                          <td className="p-3 text-right">{formatCurrency(b.project_value)}</td>
                          <td className="p-3 text-right">{formatCurrency(b.paid)}</td>
                          <td className="p-3 text-right">{formatCurrency(b.open_invoiced)}</td>
                          <td className="p-3 text-right font-bold">{done ? 'Nothing left' : formatCurrency(b.remaining)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center justify-between gap-4">
              {doneCount > 0 ? (
                <button type="button" onClick={() => setShowDone(v => !v)} className="text-xs font-semibold text-slate-500 hover:text-slate-800">
                  {showDone ? 'Hide' : 'Show'} {doneCount} fully paid or already invoiced
                </button>
              ) : <span />}
              <button disabled={selectedBalances.length === 0} onClick={() => setStep('review')} className="px-5 py-2.5 bg-slate-900 text-white rounded-xl font-bold disabled:opacity-40">
                Continue with {selectedBalances.length} project{selectedBalances.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        )}

        {step === 'review' && client && (
          <div className="max-w-3xl space-y-6">
            <div className="border border-slate-200 rounded-2xl p-6 space-y-6">
              <div className="flex flex-col sm:flex-row justify-between gap-4">
                <div>
                  <p className="text-[11px] font-bold uppercase text-slate-400">Bill to</p>
                  <p className="font-bold text-slate-800">{client.name}</p>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="client@email.com" className={`mt-1 w-64 max-w-full px-3 py-1.5 border rounded-lg text-sm ${email && !emailValid ? 'border-red-300' : 'border-slate-200'}`} />
                  {!client.email && <p className="text-xs text-slate-500 mt-1">Saved to the client for next time.</p>}
                </div>
                <div className="sm:text-right text-sm">
                  <p className="text-[11px] font-bold uppercase text-slate-400">Due</p>
                  <p className="font-semibold text-slate-800">{formatDate(dueDate)} ({DAYS_UNTIL_DUE} days)</p>
                  <p className="text-xs text-slate-500">USD</p>
                </div>
              </div>

              <div className="space-y-4">
                {selectedBalances.map(b => {
                  const line = selected[b.project_id];
                  return (
                    <div key={b.project_id} className="border-t border-slate-100 pt-4 space-y-2">
                      <div className="flex flex-col sm:flex-row gap-3">
                        <input value={line.description} onChange={e => setLine(b.project_id, { description: e.target.value })} className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                        <div className="relative w-full sm:w-36">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                          <input type="number" step="0.01" min="0" value={line.amount} onChange={e => setLine(b.project_id, { amount: e.target.value })} className="w-full pl-6 pr-3 py-2 border border-slate-200 rounded-lg text-sm text-right font-semibold" />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-slate-500">{formatCurrency(b.remaining)} left of {formatCurrency(b.project_value)} —</span>
                        {[25, 50, 100].map(pct => (
                          <button key={pct} type="button" onClick={() => setLine(b.project_id, { amount: roundCents(b.remaining * pct / 100).toFixed(2) })} className="px-2 py-0.5 rounded-md border border-slate-200 hover:bg-slate-50 font-semibold text-slate-600">{pct}%</button>
                        ))}
                        {lineErrors[b.project_id] && <span className="text-red-600 font-semibold">{lineErrors[b.project_id]}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-slate-200 pt-4 flex justify-between items-center">
                <span className="font-bold text-slate-800">Total</span>
                <span className="text-2xl font-black text-slate-900">{formatCurrency(total)}</span>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={mirjanInvolved} onChange={e => setMirjanInvolved(e.target.checked)} />
              Mirjan involved <span className="text-slate-400">(copied to the revenue entries when paid)</span>
            </label>

            {createError && <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-xl p-3">{createError}</p>}

            <div className="flex justify-end">
              <button disabled={!canCreate} onClick={createInvoice} className="px-5 py-3 bg-blue-600 text-white rounded-xl font-bold disabled:opacity-40 flex items-center gap-2">
                {creating && <Loader2 size={16} className="animate-spin" />}
                Create payment link
              </button>
            </div>
          </div>
        )}

        {step === 'done' && created && (
          <div className="max-w-xl space-y-4">
            <p className="text-slate-700">Invoice <b>{created.stripe_invoice_number}</b> for <b>{formatCurrency(Number(created.total))}</b> is ready. Send this link to {client?.name}:</p>
            <div className="flex gap-2">
              <input readOnly value={created.hosted_invoice_url || ''} className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-50" onFocus={e => e.target.select()} />
              <button onClick={() => copyLink(created)} className="px-4 py-2 bg-slate-900 text-white rounded-lg font-bold flex items-center gap-2">
                {copiedId === created.id ? <Check size={16} /> : <Copy size={16} />} {copiedId === created.id ? 'Copied' : 'Copy'}
              </button>
            </div>
            <button onClick={startNewInvoice} className="text-sm font-semibold text-blue-600 hover:underline">Create another invoice</button>
          </div>
        )}
      </div>
    </div>
  );

  // ---------- Page ----------
  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-6 right-6 z-[9999] px-5 py-3 rounded-xl shadow-xl text-sm font-semibold ${toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>{toast.message}</div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Invoices</h2>
          <p className="text-slate-500">Bill clients through Stripe and copy the payment link.</p>
        </div>
        <div className="flex gap-2">
          <div className="flex bg-slate-100 rounded-xl p-1">
            <button onClick={() => setTab('invoices')} className={`px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${tab === 'invoices' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}><FileText size={14} /> Invoices</button>
            <button onClick={() => setTab('clients')} className={`px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 ${tab === 'clients' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}><Users size={14} /> Clients</button>
          </div>
          {tab === 'invoices'
            ? <button onClick={startNewInvoice} className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-xl font-bold"><Plus size={18} /> New invoice</button>
            : <button onClick={() => setEditingClient({ name: '', email: '', company: '', notes: '' })} className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-xl font-bold"><Plus size={18} /> Add client</button>}
        </div>
      </div>

      {tab === 'invoices' && (
        <>
          {step && renderNewInvoice()}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {loading ? (
              <p className="p-10 text-center text-slate-400">Loading invoices...</p>
            ) : invoices.length === 0 ? (
              <p className="p-10 text-center text-slate-500">No invoices yet. Click “New invoice” to create the first one.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {invoices.map(inv => (
                  <div key={inv.id} className="p-4 sm:px-6 flex flex-col lg:flex-row lg:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-800">{inv.clients?.name}</span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${statusStyles[inv.status]}`}>{statusLabel[inv.status]}</span>
                        {inv.stripe_invoice_number && <span className="text-xs text-slate-400">{inv.stripe_invoice_number}</span>}
                      </div>
                      <p className="text-xs text-slate-500 truncate">{inv.invoice_lines.map(l => l.description).join(' · ')}</p>
                      <p className="text-xs text-slate-400">
                        Created {formatDate(inv.created_at)}
                        {inv.status === 'open' && ` · due ${formatDate(inv.due_date)}`}
                        {inv.status === 'paid' && ` · paid ${formatDate(inv.paid_at)}`}
                      </p>
                      {inv.status === 'failed' && inv.error && <p className="text-xs text-red-600 mt-1">{inv.error}</p>}
                    </div>
                    <div className="text-lg font-black text-slate-900 lg:w-32 lg:text-right">{formatCurrency(Number(inv.total))}</div>
                    <div className="flex flex-wrap gap-2 lg:w-[22rem] lg:justify-end">
                      {inv.status === 'open' && inv.hosted_invoice_url && (
                        <>
                          <button onClick={() => copyLink(inv)} className="px-3 py-1.5 text-xs font-bold bg-slate-900 text-white rounded-lg flex items-center gap-1.5">
                            {copiedId === inv.id ? <Check size={14} /> : <Copy size={14} />} {copiedId === inv.id ? 'Copied' : 'Copy link'}
                          </button>
                          <a href={inv.hosted_invoice_url} target="_blank" rel="noreferrer" className="px-3 py-1.5 text-xs font-bold border border-slate-200 rounded-lg flex items-center gap-1.5 text-slate-600"><ExternalLink size={14} /> Open</a>
                        </>
                      )}
                      {(inv.status === 'open' || inv.status === 'creating') && (
                        <button disabled={busyInvoice === inv.id} onClick={() => runInvoiceAction(inv, 'refresh')} className="px-3 py-1.5 text-xs font-bold border border-slate-200 rounded-lg flex items-center gap-1.5 text-slate-600 disabled:opacity-50">
                          <RefreshCw size={14} className={busyInvoice === inv.id ? 'animate-spin' : ''} /> Check payment
                        </button>
                      )}
                      {(inv.status === 'open' || inv.status === 'creating' || inv.status === 'failed') && (
                        <button disabled={busyInvoice === inv.id} onClick={() => runInvoiceAction(inv, 'void')} className="px-3 py-1.5 text-xs font-bold border border-red-100 text-red-600 rounded-lg flex items-center gap-1.5 disabled:opacity-50">
                          <XCircle size={14} /> Cancel
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'clients' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <div className="relative max-w-sm">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={clientSearch} onChange={e => setClientSearch(e.target.value)} placeholder="Search clients..." className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl outline-none" />
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {filteredClients.map(c => (
              <div key={c.id} className="px-4 sm:px-6 py-3 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800">{c.name}{c.company ? <span className="text-slate-400 font-normal"> · {c.company}</span> : null}</p>
                  <p className={`text-xs ${c.email ? 'text-slate-500' : 'text-amber-600'}`}>{c.email || 'No email — needed for invoicing'}</p>
                </div>
                <span className="text-xs text-slate-400 whitespace-nowrap">{projectCounts[c.id] || 0} projects</span>
                <button onClick={() => setEditingClient(c)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Edit2 size={16} /></button>
              </div>
            ))}
            {!loading && filteredClients.length === 0 && <p className="p-8 text-center text-slate-500">No clients found.</p>}
          </div>
        </div>
      )}

      <Modal title={editingClient?.id ? 'Edit client' : 'Add client'} isOpen={!!editingClient} onClose={() => setEditingClient(null)} onSave={saveClient}>
        {editingClient && (
          <div className="space-y-4">
            {([
              ['name', 'Name', 'e.g. Aaron Friedman'],
              ['email', 'Email', 'client@company.com'],
              ['company', 'Company (optional)', ''],
              ['notes', 'Notes (optional)', ''],
            ] as const).map(([key, label, placeholder]) => (
              <div key={key}>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{label}</label>
                <input value={(editingClient as any)[key] || ''} onChange={e => setEditingClient({ ...editingClient, [key]: e.target.value })} placeholder={placeholder} className="w-full px-4 py-2 border rounded-xl" />
              </div>
            ))}
            {editingClient.id && <p className="text-xs text-slate-500">Renaming a client also updates the client name on all their projects.</p>}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default InvoicesView;
