import React, { useState, useEffect, useContext } from 'react';
import { supabase, db } from '../lib/supabase';
import { TeamMember, User } from '../types';
import { AuthContext } from '../App';
import Modal from '../components/Modal';
import { Plus, User as UserIcon, Edit2, Trash2, Download, Shield, ShieldAlert } from 'lucide-react';
import bcrypt from 'bcryptjs';

const ROLES = ['Partner', 'Developer', 'Designer', 'Bidder', 'Other'];

const TeamView: React.FC = () => {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState<Partial<TeamMember>>({
    name: '',
    role: 'Developer',
    designation: '',
    slack_username: ''
  });
  
  // User creation state
  const [createUser, setCreateUser] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [userType, setUserType] = useState<'admin' | 'team_member' | 'partner'>('team_member');

  const auth = useContext(AuthContext);

  const loadData = async () => {
    setLoading(true);
    try {
      const [teamData, usersData] = await Promise.all([
        db.get<TeamMember>('team_members'),
        db.get<User>('users')
      ]);
      setMembers(teamData || []);
      setUsers(usersData || []);
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
      let memberId = formData.id;
      if (formData.id) {
        await db.update('team_members', formData.id, formData);
      } else {
        const newMember = await db.insert<TeamMember>('team_members', formData);
        memberId = newMember.id;
      }
      
      // Create user if requested
      if (createUser && username && password && memberId) {
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);
        
        let permissions: any = {
          dashboard: 'full',
          revenue: 'none',
          payments: 'none',
          expenses: 'none',
          projects: 'none',
          projectManagement: 'full',
          incomeStreams: 'none',
          team: 'none',
          users: 'none',
          monthlyClosing: 'none',
          backup: 'none',
          aiAdvisor: 'none'
        };

        if (userType === 'partner') {
          permissions = {
            dashboard: 'full',
            revenue: 'none',
            payments: 'none',
            expenses: 'none',
            projects: 'full',
            projectManagement: 'full',
            incomeStreams: 'none',
            team: 'none',
            users: 'none',
            monthlyClosing: 'none',
            backup: 'none',
            aiAdvisor: 'none'
          };
        } else if (userType === 'admin') {
          permissions = {
            dashboard: 'full',
            revenue: 'full',
            payments: 'full',
            expenses: 'full',
            projects: 'full',
            projectManagement: 'full',
            incomeStreams: 'full',
            team: 'full',
            users: 'full',
            monthlyClosing: 'full',
            backup: 'full',
            aiAdvisor: 'full'
          };
        }
        
        await db.insert<User>('users', {
          username,
          password_hash,
          name: formData.name || '',
          email: null,
          user_type: userType,
          team_member_id: memberId,
          status: 'active',
          permissions
        });
      }
      
      setShowModal(false);
      setCreateUser(false);
      setUsername('');
      setPassword('');
      setUserType('team_member');
      loadData();
    } catch (err) {
      alert('Error saving team member');
    }
  };

  const handleExport = () => {
    if (members.length === 0) return;
    const csvData = members.map(m => ({
      Name: m.name,
      Role: m.role,
      Designation: m.designation || ''
    }));
    const headers = Object.keys(csvData[0]);
    const csv = [headers.join(','), ...csvData.map(row => headers.map(h => `"${row[h as keyof typeof row]}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `team_members_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'Partner': return 'bg-purple-100 text-purple-700';
      case 'Developer': return 'bg-blue-100 text-blue-700';
      case 'Designer': return 'bg-green-100 text-green-700';
      case 'Bidder': return 'bg-orange-100 text-orange-700';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Team Directory</h2>
          <p className="text-slate-500">Manage partners, developers, and designers in the workspace.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className="flex items-center gap-2 bg-white border border-slate-200 text-slate-700 px-4 py-2 rounded-xl font-bold hover:bg-slate-50 transition-all">
            <Download size={18} /><span>Export CSV</span>
          </button>
          {auth?.canAccess('team') && (
            <button onClick={() => { 
              setFormData({ name: '', role: 'Developer', designation: '', slack_username: '' });
              setCreateUser(false);
              setUsername('');
              setPassword('');
              setShowModal(true); 
            }} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl transition-all shadow-lg shadow-blue-500/20 font-bold">
              <Plus size={20} /><span>Add Member</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          <div className="col-span-full text-center py-20 text-slate-400">Loading team...</div>
        ) : members.map((member) => {
          const linkedUser = users.find(u => u.team_member_id === member.id);
          return (
            <div key={member.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col group hover:border-blue-300 transition-all p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-300 group-hover:bg-blue-50 group-hover:text-blue-500 transition-colors"><UserIcon size={32} /></div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-slate-800 truncate">{member.name}</h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-black uppercase ${getRoleBadgeColor(member.role)}`}>{member.role}</span>
                  <p className="text-xs text-slate-500 mt-2">{member.designation || 'No designation'}</p>
                </div>
              </div>
              
              <div className="mt-2 mb-2 flex items-center gap-2">
                {linkedUser ? (
                  <>
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 text-green-600 rounded text-[10px] font-bold uppercase">
                      <Shield size={12} /> Has Login ({linkedUser.username})
                    </span>
                    {linkedUser.user_type === 'admin' && <span className="px-2 py-0.5 bg-slate-800 text-white rounded-md text-[10px] font-bold uppercase tracking-wider">Admin</span>}
                    {linkedUser.user_type === 'partner' && <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-md text-[10px] font-bold uppercase tracking-wider">Partner</span>}
                    {linkedUser.user_type === 'team_member' && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-md text-[10px] font-bold uppercase tracking-wider">Team Member</span>}
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 text-slate-500 rounded text-[10px] font-bold uppercase">
                    <ShieldAlert size={12} /> No Login
                  </span>
                )}
              </div>

              <div className="mt-auto pt-4 border-t border-slate-50 flex gap-2">
                <button onClick={() => { 
                  setFormData(member); 
                  setCreateUser(false);
                  setShowModal(true); 
                }} className="flex-1 py-2 text-xs font-bold text-slate-600 bg-slate-50 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition-all flex items-center justify-center gap-2"><Edit2 size={14} />Edit</button>
                <button onClick={() => { if(confirm('Remove member?')) db.delete('team_members', member.id).then(loadData); }} className="flex-1 py-2 text-xs font-bold text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all flex items-center justify-center gap-2"><Trash2 size={14} />Remove</button>
              </div>
            </div>
          );
        })}
      </div>

      <Modal title="Team Member Details" isOpen={showModal} onClose={() => setShowModal(false)} onSave={handleSave}>
        <div className="space-y-4">
          <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Full Name</label><input type="text" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-4 py-2 border rounded-xl" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Role</label><select value={formData.role} onChange={e => setFormData({...formData, role: e.target.value as any})} className="w-full px-4 py-2 border rounded-xl bg-white">{ROLES.map(role => <option key={role} value={role}>{role}</option>)}</select></div>
            <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Designation</label><input type="text" value={formData.designation || ''} onChange={e => setFormData({...formData, designation: e.target.value})} className="w-full px-4 py-2 border rounded-xl" /></div>
          </div>
          <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Slack Username</label><input type="text" value={formData.slack_username || ''} onChange={e => setFormData({...formData, slack_username: e.target.value})} className="w-full px-4 py-2 border rounded-xl" placeholder="@username" /></div>
          
          {!users.some(u => u.team_member_id === formData.id) && (
            <div className="mt-6 pt-6 border-t border-slate-100">
              <label className="flex items-center gap-2 cursor-pointer mb-4">
                <input 
                  type="checkbox" 
                  checked={createUser} 
                  onChange={e => setCreateUser(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-bold text-slate-700">Create User Account for Login</span>
              </label>
              
              {createUser && (
                <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Username</label>
                    <input 
                      type="text" 
                      required={createUser}
                      value={username} 
                      onChange={e => setUsername(e.target.value)} 
                      className="w-full px-4 py-2 border rounded-xl" 
                      placeholder="e.g. john.doe"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Password</label>
                    <input 
                      type="password" 
                      required={createUser}
                      value={password} 
                      onChange={e => setPassword(e.target.value)} 
                      className="w-full px-4 py-2 border rounded-xl" 
                      placeholder="••••••••"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">User Type</label>
                    <select 
                      value={userType} 
                      onChange={e => setUserType(e.target.value as 'admin' | 'team_member' | 'partner')}
                      className="w-full px-4 py-2 border rounded-xl bg-white"
                    >
                      <option value="admin">Admin</option>
                      <option value="team_member">Team Member</option>
                      <option value="partner">Partner</option>
                    </select>
                  </div>
                  <div className="col-span-2 text-xs text-slate-500">
                    This user will automatically be granted access to Project Management. You can adjust their permissions later in the Users tab.
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default TeamView;