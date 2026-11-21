import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const serviceKey =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default;
const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Must match public.login_email() in the database and loginEmail() in lib/supabase.ts.
const loginEmail = (username: string) => `${username.trim().toLowerCase()}@users.taskronize.com`;
const USERNAME_RE = /^[A-Za-z0-9._-]{2,40}$/;
const PROFILE_FIELDS = [
  'name', 'email', 'user_type', 'permissions', 'team_member_id',
  'linked_income_stream_id', 'linked_income_stream_ids', 'status',
] as const;

type AppUser = { id: number; username: string; user_type: string; status: string; auth_id: string | null; permissions: Record<string, string> | null };

const hasAccess = (u: AppUser, key: string) => ['full', 'edit-hidden'].includes(u.permissions?.[key] ?? '');
const canManageUsers = (u: AppUser) => u.user_type === 'admin' || hasAccess(u, 'users') || hasAccess(u, 'team');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Not signed in' }, 401);
  const { data: authData, error: authErr } = await admin.auth.getUser(jwt);
  if (authErr || !authData?.user) return json({ error: 'Not signed in' }, 401);

  const { data: caller } = await admin.from('users').select('*').eq('auth_id', authData.user.id).eq('status', 'active').maybeSingle<AppUser>();
  if (!caller || !canManageUsers(caller)) return json({ error: 'You do not have permission to manage users' }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Invalid request' }, 400); }

  if (body.action === 'create') {
    const username = String(body.username ?? '').trim();
    const password = String(body.password ?? '');
    if (!USERNAME_RE.test(username)) return json({ error: 'Username may only contain letters, numbers, dots, dashes and underscores (2-40 characters)' }, 400);
    if (password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

    const profile: Record<string, unknown> = {};
    for (const f of PROFILE_FIELDS) if (body.profile?.[f] !== undefined) profile[f] = body.profile[f];
    if (profile.user_type === 'admin' && caller.user_type !== 'admin') return json({ error: 'Only admins can create admin users' }, 403);

    const { data: dupes } = await admin.from('users').select('id').ilike('username', username.replace(/[\\%_]/g, '\\$&'));
    if (dupes && dupes.length > 0) return json({ error: 'That username is already taken' }, 409);

    const { data: created, error: createErr } = await admin.auth.admin.createUser({ email: loginEmail(username), password, email_confirm: true });
    if (createErr || !created?.user) return json({ error: createErr?.message ?? 'Could not create login' }, 400);

    const { data: row, error: insertErr } = await admin.from('users')
      .insert({ status: 'active', ...profile, username, password_hash: null, auth_id: created.user.id })
      .select().single();
    if (insertErr) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: insertErr.message }, 400);
    }
    return json({ user: row });
  }

  if (body.action === 'sync_login') {
    const password = body.password ? String(body.password) : '';
    if (password && password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

    const { data: target } = await admin.from('users').select('*').eq('id', Number(body.user_id)).maybeSingle<AppUser>();
    if (!target) return json({ error: 'User not found' }, 404);
    if (target.user_type === 'admin' && caller.user_type !== 'admin') return json({ error: 'Only admins can change an admin login' }, 403);
    if (!USERNAME_RE.test(target.username)) return json({ error: 'Username may only contain letters, numbers, dots, dashes and underscores' }, 400);

    if (target.auth_id) {
      const { error } = await admin.auth.admin.updateUserById(target.auth_id, {
        email: loginEmail(target.username), email_confirm: true, ...(password ? { password } : {}),
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (!password) return json({ ok: true, note: 'User has no login yet; set a password to create one' });
    const { data: created, error: createErr } = await admin.auth.admin.createUser({ email: loginEmail(target.username), password, email_confirm: true });
    if (createErr || !created?.user) return json({ error: createErr?.message ?? 'Could not create login' }, 400);
    const { error: linkErr } = await admin.from('users').update({ auth_id: created.user.id }).eq('id', target.id);
    if (linkErr) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: linkErr.message }, 400);
    }
    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
});
