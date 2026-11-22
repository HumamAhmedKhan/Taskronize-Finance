import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17.7.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const serviceKey =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default;
const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
const stripe = stripeKey ? new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() }) : null;

const DAYS_UNTIL_DUE = 7;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const toCents = (amount: number) => Math.round(amount * 100);

type AppUser = { id: number; user_type: string; permissions: Record<string, string> | null };
const canInvoice = (u: AppUser) =>
  u.user_type === 'admin' || ['full', 'edit-hidden'].includes(u.permissions?.invoices ?? '');

async function syncFromStripe(invoiceId: number) {
  const { data: inv } = await db.from('invoices').select('*').eq('id', invoiceId).maybeSingle();
  if (!inv?.stripe_invoice_id || !stripe) return inv;
  const remote = await stripe.invoices.retrieve(inv.stripe_invoice_id);
  if (remote.status === 'paid') {
    const paidAt = remote.status_transitions?.paid_at ? new Date(remote.status_transitions.paid_at * 1000).toISOString() : null;
    await db.rpc('record_invoice_payment', { p_invoice_id: inv.id, p_paid_at: paidAt });
  } else if (remote.status === 'void' && inv.status !== 'void') {
    await db.from('invoices').update({ status: 'void' }).eq('id', inv.id);
  }
  const { data: fresh } = await db.from('invoices').select('*').eq('id', invoiceId).maybeSingle();
  return fresh;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Not signed in' }, 401);
  const { data: authData, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !authData?.user) return json({ error: 'Not signed in' }, 401);
  const { data: caller } = await db.from('users').select('id, user_type, permissions')
    .eq('auth_id', authData.user.id).eq('status', 'active').maybeSingle<AppUser>();
  if (!caller || !canInvoice(caller)) return json({ error: 'You do not have permission to create invoices' }, 403);

  if (!stripe) return json({ error: 'Stripe is not connected yet (STRIPE_SECRET_KEY is missing in Supabase secrets).' }, 503);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }

  try {
    if (body.action === 'create') return await createInvoice(body, caller);
    if (body.action === 'refresh') return json({ invoice: await syncFromStripe(Number(body.invoice_id)) });
    if (body.action === 'void') return await voidInvoice(Number(body.invoice_id));
    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    const message = e instanceof Stripe.errors.StripeError ? `Stripe: ${e.message}` : (e as Error).message;
    return json({ error: message }, 400);
  }
});

async function createInvoice(body: any, caller: AppUser) {
  const clientId = Number(body.client_id);
  const lines: { project_id: number; description: string; amount: number }[] = Array.isArray(body.lines) ? body.lines : [];
  const email = String(body.email ?? '').trim();

  const { data: client } = await db.from('clients').select('*').eq('id', clientId).maybeSingle();
  if (!client) return json({ error: 'Client not found' }, 404);
  const clientEmail = email || client.email;
  if (!clientEmail || !EMAIL_RE.test(clientEmail)) return json({ error: 'A valid client email is required' }, 400);
  if (lines.length === 0 || lines.length > 50) return json({ error: 'Select between 1 and 50 projects' }, 400);

  const { data: balances, error: balErr } = await db.rpc('project_invoice_balances', { p_client_id: clientId });
  if (balErr) throw balErr;
  const byProject = new Map((balances ?? []).map((b: any) => [Number(b.project_id), b]));
  const seen = new Set<number>();
  for (const line of lines) {
    const bal: any = byProject.get(Number(line.project_id));
    const amount = Number(line.amount);
    const description = String(line.description ?? '').trim();
    if (!bal) return json({ error: 'A selected project does not belong to this client or its income stream is not set up for Stripe invoicing' }, 400);
    if (seen.has(Number(line.project_id))) return json({ error: 'A project was selected twice' }, 400);
    seen.add(Number(line.project_id));
    if (!description || description.length > 500) return json({ error: `Add a description for ${bal.project_name}` }, 400);
    if (!(amount > 0)) return json({ error: `Amount for ${bal.project_name} must be more than 0` }, 400);
    if (toCents(amount) > toCents(Number(bal.remaining))) {
      return json({ error: `${bal.project_name}: $${amount.toFixed(2)} is more than the $${Number(bal.remaining).toFixed(2)} left to invoice` }, 400);
    }
  }
  const streams = new Set(lines.map((l) => Number((byProject.get(Number(l.project_id)) as any).income_stream_id)));
  if (streams.size > 1) return json({ error: 'All projects on one invoice must be in the same income stream' }, 400);
  const totalCents = lines.reduce((s, l) => s + toCents(Number(l.amount)), 0);

  if (email && email !== client.email) await db.from('clients').update({ email }).eq('id', client.id);

  const dueDate = new Date(Date.now() + DAYS_UNTIL_DUE * 86400000).toISOString().slice(0, 10);
  const { data: inv, error: invErr } = await db.from('invoices').insert({
    client_id: client.id, status: 'creating', total: totalCents / 100, due_date: dueDate,
    mirjan_involved: !!body.mirjan_involved, created_by: caller.id,
  }).select().single();
  if (invErr) throw invErr;
  const { error: lineErr } = await db.from('invoice_lines').insert(lines.map((l) => ({
    invoice_id: inv.id, project_id: Number(l.project_id), description: String(l.description).trim(), amount: toCents(Number(l.amount)) / 100,
  })));
  if (lineErr) {
    await db.from('invoices').update({ status: 'failed', error: lineErr.message }).eq('id', inv.id);
    throw lineErr;
  }

  try {
    let customerId: string = client.stripe_customer_id;
    if (customerId) {
      await stripe!.customers.update(customerId, { name: client.name, email: clientEmail });
    } else {
      const customer = await stripe!.customers.create(
        { name: client.name, email: clientEmail, metadata: { crm_client_id: String(client.id) } },
        { idempotencyKey: `crm-client-${client.id}` },
      );
      customerId = customer.id;
      await db.from('clients').update({ stripe_customer_id: customerId }).eq('id', client.id);
    }

    const draft = await stripe!.invoices.create({
      customer: customerId,
      collection_method: 'send_invoice',
      days_until_due: DAYS_UNTIL_DUE,
      currency: 'usd',
      auto_advance: false,
      pending_invoice_items_behavior: 'exclude',
      metadata: { crm_invoice_id: String(inv.id) },
    }, { idempotencyKey: `crm-invoice-${inv.id}` });
    await db.from('invoices').update({ stripe_invoice_id: draft.id }).eq('id', inv.id);

    for (const [i, l] of lines.entries()) {
      await stripe!.invoiceItems.create({
        customer: customerId,
        invoice: draft.id,
        amount: toCents(Number(l.amount)),
        currency: 'usd',
        description: String(l.description).trim(),
        metadata: { crm_invoice_id: String(inv.id), crm_project_id: String(l.project_id) },
      }, { idempotencyKey: `crm-invoice-${inv.id}-line-${i}` });
    }

    const final = await stripe!.invoices.finalizeInvoice(draft.id, { auto_advance: false });
    if (final.amount_due !== totalCents) throw new Error(`Stripe total ${final.amount_due / 100} does not match ${totalCents / 100}`);
    const { data: done } = await db.from('invoices').update({
      status: 'open', hosted_invoice_url: final.hosted_invoice_url, stripe_invoice_number: final.number,
      due_date: final.due_date ? new Date(final.due_date * 1000).toISOString().slice(0, 10) : dueDate,
    }).eq('id', inv.id).select().single();
    return json({ invoice: done });
  } catch (e) {
    const message = e instanceof Stripe.errors.StripeError ? `Stripe: ${e.message}` : (e as Error).message;
    await db.from('invoices').update({ status: 'failed', error: message }).eq('id', inv.id);
    return json({ error: message }, 400);
  }
}

async function voidInvoice(invoiceId: number) {
  const { data: inv } = await db.from('invoices').select('*').eq('id', invoiceId).maybeSingle();
  if (!inv) return json({ error: 'Invoice not found' }, 404);
  if (inv.status === 'paid') return json({ error: 'This invoice is already paid and cannot be cancelled' }, 400);
  if (inv.status === 'void') return json({ invoice: inv });
  if (inv.stripe_invoice_id) {
    const remote = await stripe!.invoices.retrieve(inv.stripe_invoice_id);
    if (remote.status === 'paid') return json({ invoice: await syncFromStripe(inv.id), error: 'The client already paid this invoice' }, 409);
    if (remote.status === 'open' || remote.status === 'uncollectible') await stripe!.invoices.voidInvoice(inv.stripe_invoice_id);
    else if (remote.status === 'draft') await stripe!.invoices.del(inv.stripe_invoice_id);
  }
  const { data: done } = await db.from('invoices').update({ status: 'void' }).eq('id', inv.id).select().single();
  return json({ invoice: done });
}
