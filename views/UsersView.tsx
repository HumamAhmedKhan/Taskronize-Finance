
import React, { useState, useEffect, useContext } from 'react';
import { supabase, db } from '../lib/supabase';
import { User, PagePermissions, PermissionLevel, IncomeStream } from '../types';
import { AuthContext } from '../App';
import { Plus, Shield, User as UserIcon, Check, Edit2, ShieldAlert, X, Eye, EyeOff } from 'lucide-react';

const UsersView: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [incomeStreams, setIncomeStreams] = useState<IncomeStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [formData, setFormData] = useState<Partial<User>>({
    name: '',
    username: '',
    password_hash: '',
    user_type: 'team_member',
    linked_income_stream_id: null,
    linked_income_stream_ids: [],
    permissions: {
      dashboard: 'full',
      revenue: 'none',
      payments: 'none',
      expenses: 'none',
      projects: 'none',
      projectManagement: 'none',
      incomeStreams: 'none',
      team: 'none',
      users: 'none',
      monthlyClosing: 'none',
      backup: 'none',
      aiAdvisor: 'none',
      withdrawals: 'none',
      pmBulkEdit: 'none',
      pmManageStatuses: 'none'
    }
  });

  const [revealedPasswords, setRevealedPasswords] = useState<Set<number>>(new Set());
  const [resetPassword, setResetPassword] = useState('');

  const auth = useContext(AuthContext);

  const loadData = async () => {
    setLoading(true);
    try {
      const [usersData, streamsData] = await Promise.all([
        db.get<User>('users'),
        db.get<IncomeStream>('income_streams')
      ]);
      setUsers(usersData || []);
      setIncomeStreams(streamsData || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const dataToSave = { ...formData };
      if (!dataToSave.permissions) {
        dataToSave.permissions = {
          dashboard: 'full',
          revenue: 'none',
          payments: 'none',
          expenses: 'none',
          projects: 'none',
          projectManagement: 'none',
          incomeStreams: 'none',
          team: 'none',
          users: 'none',
          monthlyClosing: 'none',
          backup: 'none',
          aiAdvisor: 'none',
          withdrawals: 'none'
        };
      }

      if (dataToSave.id) {
        if (resetPassword) {
          dataToSave.password_hash = resetPassword;
        }
        const updatedUser = await db.update<User>('users', dataToSave.id, dataToSave);
        setUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));
      } else {
        await db.insert('users', dataToSave);
        await loadData();
      }
      setShowModal(false);
      setResetPassword('');
      setToast({ message: 'User updated. They may need to log out and back in to see changes.', type: 'success' });
      setTimeout(() => setToast(null), 4000);
    } catch (err: any) {
      console.error('Save user error:', err);
      setToast({ message: `Error saving user: ${err?.message || JSON.stringify(err)}`, type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
  };

  const updatePermission = (page: keyof PagePermissions, level: PermissionLevel) => {
    setFormData(prev => ({
      ...prev,
      permissions: {
        ...(prev.permissions || {
          dashboard: 'full',
          revenue: 'none',
          payments: 'none',
          expenses: 'none',
          projects: 'none',
          projectManagement: 'none',
          incomeStreams: 'none',
          team: 'none',
          users: 'none',
          monthlyClosing: 'none',
          backup: 'none',
          aiAdvisor: 'none',
          withdrawals: 'none'
        }),
        [page]: level
      }
    }));
  };

  const PermissionBadge = ({ level }: { level: PermissionLevel }) => {
    switch (level) {
      case 'full': return <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-md text-[10px] font-bold uppercase">Full Access</span>;
      case 'edit-hidden': return <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-md text-[10px] font-bold uppercase">Edit Only</span>;
      default: return <span className="px-2 py-0.5 bg-slate-100 text-slate-400 rounded-md text-[10px] font-bold uppercase">No Access</span>;
    }
  };

  // Helper to ensure all possible permission keys are rendered even if missing in existing user objects
  const permissionKeys: (keyof PagePermissions)[] = [
    'dashboard', 'aiAdvisor', 'revenue', 'projects', 'projectManagement', 'payments',
    'expenses', 'incomeStreams', 'team', 'users', 'monthlyClosing', 'backup', 'withdrawals'
  ];

  const pmFeatureKeys: (keyof PagePermissions)[] = ['pmBulkEdit', 'pmManageStatuses'];

  const pmFeatureLabels: Record<string, string> = {
    pmBulkEdit: 'Bulk Edit Projects',
    pmManageStatuses: 'Manage Statuses',
  };

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-6 right-6 z-[9999] px-5 py-3 rounded-xl shadow-xl text-sm font-semibold transition-all ${toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.message}
        </div>
      )}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">System Users</h2>
          <p className="text-slate-500">Manage multi-user access and fine-grained permissions.</p>
        </div>
        <button 
          onClick={() => {
            setFormData({
              name: '', username: '', user_type: 'team_member', linked_income_stream_ids: [], permissions: {
                dashboard: 'full', revenue: 'none', payments: 'none', expenses: 'none',
                projects: 'none', projectManagement: 'none', incomeStreams: 'none', team: 'none', users: 'none',
                monthlyClosing: 'none', backup: 'none', aiAdvisor: 'none', withdrawals: 'none'
              }
            });
            setResetPassword('');
            setShowModal(true);
          }}
          className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2.5 rounded-xl font-bold hover:bg-slate-800 transition-all"
        >
          <Plus size={20} />
          <span>Invite User</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          <div className="col-span-full text-center py-20 text-slate-400">Loading users...</div>
        ) : users.map((user) => (
          <div key={user.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400">
                  <UserIcon size={24} />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setFormData(user); setResetPassword(''); setShowModal(true); }} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><Edit2 size={16} /></button>
                </div>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <h4 className="font-bold text-slate-800">{user.name}</h4>
                {user.user_type === 'admin' && <span className="px-2 py-0.5 bg-slate-800 text-white rounded-md text-[10px] font-bold uppercase tracking-wider">Admin</span>}
                {user.user_type === 'partner' && <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-md text-[10px] font-bold uppercase tracking-wider">Partner</span>}
                {user.user_type === 'team_member' && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-md text-[10px] font-bold uppercase tracking-wider">Team Member</span>}
              </div>
              <p className="text-slate-500 text-sm">@{user.username}</p>
              <div className="flex items-center gap-2 mt-1 mb-4">
                <span className="text-slate-400 text-xs font-medium">Password:</span>
                {user.password_hash?.startsWith('$2a$') || user.password_hash?.startsWith('$2b$') ? (
                  <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md font-medium">Hashed — reset to reveal</span>
                ) : revealedPasswords.has(user.id) ? (
                  <span className="text-slate-700 font-mono text-xs">{user.password_hash}</span>
                ) : (
                  <span className="text-slate-400 font-mono text-xs tracking-widest">••••••••</span>
                )}
                {!user.password_hash?.startsWith('$2a$') && !user.password_hash?.startsWith('$2b$') && (
                  <button
                    onClick={() => setRevealedPasswords(prev => {
                      const next = new Set(prev);
                      next.has(user.id) ? next.delete(user.id) : next.add(user.id);
                      return next;
                    })}
                    className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {revealedPasswords.has(user.id) ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                )}
              </div>
              
              <div className="space-y-2 mt-4 pt-4 border-t border-slate-50">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-400 uppercase font-bold tracking-tight">Dashboard Access</span>
                  <PermissionBadge level={user.permissions?.dashboard || 'none'} />
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {permissionKeys
                    .filter(key => user.permissions && user.permissions[key] !== 'none')
                    .map((page) => (
                      <span key={page} className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[10px] font-medium capitalize">{page.replace(/([A-Z])/g, ' $1')}</span>
                    ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Shield className="text-blue-600" size={20} />
                <h3 className="font-bold text-slate-800">Manage User Permissions</h3>
              </div>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-slate-200 rounded-lg"><X size={20} /></button>
            </div>
            <form onSubmit={handleSave} className="flex flex-col h-[80vh] overflow-hidden">
              <div className="p-6 flex-1 overflow-y-auto space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Full Name</label>
                    <input type="text" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-4 py-2 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Username</label>
                    <input type="text" required value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} className="w-full px-4 py-2 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                    {formData.id ? 'Reset Password' : 'Initial Password'}
                    {formData.id && <span className="ml-1 text-slate-400 normal-case font-normal text-[11px]">(leave blank to keep current)</span>}
                  </label>
                  <input
                    type="text"
                    required={!formData.id}
                    value={formData.id ? resetPassword : (formData.password_hash || '')}
                    onChange={e => formData.id ? setResetPassword(e.target.value) : setFormData({...formData, password_hash: e.target.value})}
                    className="w-full px-4 py-2 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20"
                    placeholder={formData.id ? 'New password (optional)...' : 'Set temporary password'}
                  />
                </div>

                {auth?.user?.user_type === 'admin' && formData.id && (
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Current Password</label>
                    <div className="w-full px-4 py-2 border border-slate-200 rounded-xl bg-slate-50 text-slate-600 font-mono text-sm">
                      {formData.password_hash?.startsWith('$2a$') || formData.password_hash?.startsWith('$2b$')
                        ? '(set before plaintext storage — reset to set a readable one)'
                        : (formData.password_hash || '(not set)')}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">User Type</label>
                  <select 
                    value={formData.user_type || 'team_member'} 
                    onChange={e => {
                      const newType = e.target.value as 'admin' | 'team_member' | 'partner';
                      setFormData({
                        ...formData,
                        user_type: newType,
                        linked_income_stream_id: newType === 'partner' ? formData.linked_income_stream_id : null,
                        linked_income_stream_ids: newType === 'partner' ? (formData.linked_income_stream_ids || []) : []
                      });
                    }}
                    className="w-full px-4 py-2 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 bg-white"
                  >
                    <option value="admin">Admin</option>
                    <option value="team_member">Team Member</option>
                    <option value="partner">Partner</option>
                  </select>
                </div>

                {formData.user_type === 'partner' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Linked Income Streams</label>
                    <div className="space-y-2 border rounded-xl p-3">
                      {incomeStreams.map(stream => (
                        <label key={stream.id} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={(formData.linked_income_stream_ids || []).includes(stream.id)}
                            onChange={e => {
                              const current = formData.linked_income_stream_ids || [];
                              setFormData({
                                ...formData,
                                linked_income_stream_ids: e.target.checked
                                  ? [...current, stream.id]
                                  : current.filter(id => id !== stream.id)
                              });
                            }}
                          />
                          <span className="text-sm font-medium text-slate-700">{stream.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <ShieldAlert size={18} className="text-amber-500" />
                    Access Matrix
                  </h4>
                  <div className="space-y-3">
                    {permissionKeys.map((page) => (
                      <div key={page} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-slate-50 rounded-xl gap-3">
                        <span className="font-bold text-slate-700 capitalize text-sm">{page.replace(/([A-Z])/g, ' $1')}</span>
                        <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                          {(['full', 'edit-hidden', 'none'] as PermissionLevel[]).map((level) => (
                            <button
                              key={level}
                              type="button"
                              onClick={() => updatePermission(page, level)}
                              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all whitespace-nowrap ${
                                (formData.permissions?.[page] || 'none') === level
                                  ? level === 'full' ? 'bg-green-600 text-white shadow-sm' :
                                    level === 'edit-hidden' ? 'bg-amber-600 text-white shadow-sm' :
                                    'bg-slate-700 text-white shadow-sm'
                                  : 'bg-white border border-slate-200 text-slate-400 hover:bg-slate-50'
                              }`}
                            >
                              {level === 'full' ? 'Full' : level === 'edit-hidden' ? 'Edit Only' : 'Block'}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Project Management feature permissions */}
                  <div className="mt-5">
                    <h4 className="font-bold text-slate-700 text-sm mb-3 flex items-center gap-2">
                      <Shield size={14} className="text-blue-500" />
                      Project Management Features
                    </h4>
                    <div className="space-y-2">
                      {pmFeatureKeys.map((key) => (
                        <div key={key} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-blue-50/50 border border-blue-100 rounded-xl gap-3">
                          <span className="font-bold text-slate-700 text-sm">{pmFeatureLabels[key]}</span>
                          <div className="flex gap-1.5">
                            {(['full', 'none'] as PermissionLevel[]).map((level) => (
                              <button
                                key={level}
                                type="button"
                                onClick={() => updatePermission(key, level)}
                                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all whitespace-nowrap ${
                                  (formData.permissions?.[key] || 'none') === level
                                    ? level === 'full' ? 'bg-green-600 text-white shadow-sm' : 'bg-slate-700 text-white shadow-sm'
                                    : 'bg-white border border-slate-200 text-slate-400 hover:bg-slate-50'
                                }`}
                              >
                                {level === 'full' ? 'Allowed' : 'Blocked'}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3 shrink-0">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-3 px-4 rounded-xl border border-slate-200 text-slate-600 font-bold">Cancel</button>
                <button type="submit" className="flex-1 py-3 px-4 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 shadow-xl transition-all">
                  {formData.id ? 'Update Permissions' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default UsersView;
