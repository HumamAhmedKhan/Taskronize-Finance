import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17.7.0';

const serviceKey =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default;
const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
const stripe = stripeKey ? new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() }) : null;
const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!stripe || !webhookSecret) return new Response('Stripe webhook is not configured', { status: 503 });

  const signature = req.headers.get('Stripe-Signature');
  if (!signature) return new Response('Missing signature', { status: 400 });
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret, undefined, cryptoProvider);
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }

  if (event.type === 'invoice.paid' || event.type === 'invoice.voided') {
    const remote = event.data.object as Stripe.Invoice;
    const { data: inv } = await db.from('invoices').select('id, status').eq('stripe_invoice_id', remote.id).maybeSingle();
    if (!inv) return new Response('Not a CRM invoice', { status: 200 });

    if (event.type === 'invoice.paid') {
      const paidAt = remote.status_transitions?.paid_at ? new Date(remote.status_transitions.paid_at * 1000).toISOString() : null;
      const { error } = await db.rpc('record_invoice_payment', { p_invoice_id: inv.id, p_paid_at: paidAt });
      if (error) return new Response(`Could not record payment: ${error.message}`, { status: 500 });
    } else if (inv.status !== 'paid') {
      await db.from('invoices').update({ status: 'void' }).eq('id', inv.id);
    }
  }
  return new Response('ok', { status: 200 });
});
