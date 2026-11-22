
import React, { useState, useEffect, useRef, createContext } from 'react';
import {
  LayoutDashboard,
  TrendingUp,
  Briefcase,
  CreditCard,
  Receipt,
  Database,
  Users,
  Settings,
  Calendar,
  LogOut,
  Menu,
  X,
  Plus,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Zap,
  Lock,
  Landmark,
  CheckSquare,
  ChevronDown,
  Bell,
  FileText
} from 'lucide-react';
import { User, PagePermissions, AppNotification } from './types';
import { supabase, loginEmail } from './lib/supabase';
import Login from './views/Login';
import Dashboard from './views/Dashboard';
import RevenueView from './views/RevenueView';
import ProjectsView from './views/ProjectsView';
import PaymentsView from './views/PaymentsView';
import ExpensesView from './views/ExpensesView';
import TeamView from './views/TeamView';
import UsersView from './views/UsersView';
import IncomeStreamsView from './views/IncomeStreamsView';
import MonthlyClosingView from './views/MonthlyClosingView';
import BackupView from './views/BackupView';
import AIAdvisorView from './views/AIAdvisorView';
import ProjectManagementView from './views/ProjectManagementView';
import MyEarningsView from './views/MyEarningsView';
import AutomationsView from './views/AutomationsView';
import WithdrawalsView from './views/WithdrawalsView';
import TasksView from './views/TasksView';
import InvoicesView from './views/InvoicesView';
import NotificationDropdown from './components/NotificationDropdown';
import { DateShortcuts } from './components/DateShortcuts';
import Modal from './components/Modal';
import OverdueTicker from './components/OverdueTicker';

interface AuthContextType {
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
  canAccess: (page: keyof PagePermissions) => boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [activeTab, setActiveTab] = useState<keyof PagePermissions>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  // Global Date State for consistent filtering across Dashboard & views
  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [showDateModal, setShowDateModal] = useState(false);
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [changePwForm, setChangePwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [changePwError, setChangePwError] = useState('');
  const [changePwLoading, setChangePwLoading] = useState(false);

  // Tasks tab state (controlled — lifted so notifications can navigate to specific tab)
  const [tasksActiveTab, setTasksActiveTab] = useState<'personal' | 'team'>('personal');

  // Notification state
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [notifAdminUserId, setNotifAdminUserId] = useState<number | null>(null);
  const [notifAllUsers, setNotifAllUsers] = useState<{ id: number; name: string }[]>([]);
  const [dropdownPos, setDropdownPos] = useState({ top: 80, left: 16 });
  const bellRef = useRef<HTMLButtonElement>(null);
  const mobileBellRef = useRef<HTMLButtonElement>(null);
  const [showMoreSheet, setShowMoreSheet] = useState(false);
  const notifDropdownRef = useRef<HTMLDivElement>(null);

  // Derive the first tab a user is allowed to see, used on login and page reload
  const getFirstAccessibleTab = (userData: User): keyof PagePermissions => {
    const dashPerm = userData.permissions?.['dashboard'];
    if (dashPerm && dashPerm !== 'none') return 'dashboard';
    const allTabs: (keyof PagePermissions)[] = ['tasks', 'revenue', 'projects', 'projectManagement', 'payments', 'expenses', 'incomeStreams', 'invoices', 'team', 'users', 'monthlyClosing', 'backup', 'myEarnings'];
    const firstTab = allTabs.find(tab => {
      if (tab === 'tasks') {
        if (userData.user_type === 'admin') return true;
        const level = userData.permissions?.[tab];
        return !!level && level !== 'none';
      }
      if (tab === 'myEarnings') return userData.user_type === 'partner' || userData.user_type === 'team_member';
      if (tab === 'revenue' && userData.user_type === 'partner') return true;
      const level = userData.permissions?.[tab];
      return level === 'full' || level === 'edit-hidden';
    });
    return firstTab ?? 'dashboard';
  };

  useEffect(() => {
    localStorage.removeItem('taskronize_user');
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        const { data } = await supabase.from('users').select('*')
          .eq('auth_id', session.user.id).eq('status', 'active').maybeSingle();
        if (data) {
          setUser(data);
          setActiveTab(getFirstAccessibleTab(data));
        } else {
          await supabase.auth.signOut();
        }
      }
      setAuthChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') setUser(null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const login = (userData: User) => {
    setUser(userData);
    setActiveTab(getFirstAccessibleTab(userData));
  };

  const logout = () => {
    supabase.auth.signOut().finally(() => setUser(null));
  };

  // Derived notification user id (admin can view other users' notifications)
  const notifUserId = (user?.user_type === 'admin' && notifAdminUserId) ? notifAdminUserId : (user?.id ?? 0);
  const unreadCount = notifications.filter(n => !n.is_read).length;

  const loadNotifications = async (uid: number) => {
    // Clean expired notifications
    await supabase.from('notifications').delete()
      .eq('user_id', uid)
      .lt('expires_at', new Date().toISOString());
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(50);
    setNotifications(data || []);
  };

  // Load notifications on mount and when admin switches viewed user
  useEffect(() => {
    if (!user) return;
    const uid = (user.user_type === 'admin' && notifAdminUserId) ? notifAdminUserId : user.id;
    loadNotifications(uid);
  }, [user?.id, notifAdminUserId]);

  // Load all users for admin dropdown
  useEffect(() => {
    if (user?.user_type !== 'admin') return;
    supabase.from('users').select('id, name').then(({ data }) => {
      setNotifAllUsers(data || []);
      setNotifAdminUserId(prev => prev ?? (user?.id ?? null));
    });
  }, [user?.id, user?.user_type]);

  // Close dropdown on click outside
  useEffect(() => {
    if (!showNotifDropdown) return;
    const handler = (e: MouseEvent) => {
      if (
        notifDropdownRef.current && !notifDropdownRef.current.contains(e.target as Node) &&
        !(bellRef.current && bellRef.current.contains(e.target as Node)) &&
        !(mobileBellRef.current && mobileBellRef.current.contains(e.target as Node))
      ) {
        setShowNotifDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showNotifDropdown]);

  const handleBellClick = (e?: React.MouseEvent<HTMLButtonElement>) => {
    const anchor = e?.currentTarget ?? bellRef.current;
    if (!showNotifDropdown && anchor) {
      const rect = anchor.getBoundingClientRect();
      // Keep the dropdown on screen on narrow (mobile) viewports
      const width = Math.min(380, window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setDropdownPos({ top: rect.bottom + 8, left });
      loadNotifications(notifUserId);
    }
    setShowNotifDropdown(prev => !prev);
  };

  const handleMarkAllRead = async () => {
    await supabase.from('notifications').update({ is_read: true })
      .eq('user_id', notifUserId).eq('is_read', false);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  };

  const handleMarkNotifRead = async (id: number) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  };

  const handleNotifClick = async (notif: AppNotification) => {
    if (!notif.is_read) await handleMarkNotifRead(notif.id);
    setShowNotifDropdown(false);
    if (notif.entity_type === 'team_task') {
      setActiveTab('tasks');
      setTasksActiveTab('team');
    } else if (notif.entity_type === 'personal_task') {
      setActiveTab('tasks');
      setTasksActiveTab('personal');
    } else if (notif.entity_type === 'project') {
      setActiveTab('projectManagement');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (changePwForm.newPassword !== changePwForm.confirmPassword) {
      setChangePwError('New passwords do not match.');
      return;
    }
    setChangePwLoading(true);
    setChangePwError('');
    try {
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: loginEmail(user!.username),
        password: changePwForm.currentPassword,
      });
      if (verifyError) {
        setChangePwError('Current password is incorrect.');
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ password: changePwForm.newPassword });
      if (updateError) throw updateError;
      setShowChangePasswordModal(false);
      setChangePwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      alert('Password changed successfully.');
    } catch (err: any) {
      setChangePwError(err.message || 'An error occurred.');
    } finally {
      setChangePwLoading(false);
    }
  };

  const canAccess = (page: keyof PagePermissions) => {
    if (user?.user_type === 'partner' && page === 'revenue') return true;
    if (!user || !user.permissions) return false;
    let level = user.permissions[page];
    if (level === undefined && page === 'projectManagement') {
      level = user.permissions['projects'];
    }
    return level === 'full' || level === 'edit-hidden';
  };

  const isTabVisible = (page: keyof PagePermissions) => {
    if (!user || !user.permissions) return false;
    if (page === 'dashboard') return !!user.permissions['dashboard'] && user.permissions['dashboard'] !== 'none';
    if (page === 'automations') return user.user_type === 'admin';
    if (page === 'withdrawals') return user.user_type === 'admin';
    if (page === 'myEarnings') return user.user_type === 'partner' || user.user_type === 'team_member';
    if (page === 'tasks') {
      if (user.user_type === 'admin') return true;
      return !!user.permissions['tasks'] && user.permissions['tasks'] !== 'none';
    }
    if (page === 'revenue' && user.user_type === 'partner') return true;
    let level = user.permissions[page];
    if (level === undefined && page === 'projectManagement') {
      level = user.permissions['projects'];
    }
    return level === 'full' || level === 'edit-hidden';
  };

  if (!authChecked) {
    return <div className="min-h-screen bg-slate-900" />;
  }

  if (!user) {
    return (
      <AuthContext.Provider value={{ user, login, logout, canAccess }}>
        <Login />
      </AuthContext.Provider>
    );
  }

  const navigation = [
    { id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard },
    { id: 'aiAdvisor', name: 'AI Advisor', icon: Sparkles },
    { id: 'revenue', name: 'Revenue', icon: TrendingUp },
    { id: 'projects', name: 'Projects', icon: Briefcase },
    { id: 'projectManagement', name: 'Project Mgmt', icon: Briefcase },
    { id: 'payments', name: 'Payments', icon: CreditCard },
    { id: 'invoices', name: 'Invoices', icon: FileText },
    { id: 'expenses', name: 'Expenses', icon: Receipt },
    { id: 'incomeStreams', name: 'Income Streams', icon: Database },
    { id: 'tasks', name: 'Tasks', icon: CheckSquare },
    { id: 'team', name: 'Team', icon: Users },
    { id: 'users', name: 'Users', icon: Settings },
    { id: 'monthlyClosing', name: 'Monthly Closing', icon: Calendar },
    { id: 'backup', name: 'Backup & Restore', icon: Database },
    ...(user?.user_type === 'admin' ? [{ id: 'automations', name: 'Automations', icon: Zap }] : []),
    ...(user?.user_type === 'admin' ? [{ id: 'withdrawals', name: 'Withdrawals', icon: Landmark }] : []),
    ...(user?.user_type === 'partner' || user?.user_type === 'team_member' ? [{ id: 'myEarnings', name: 'My Earnings', icon: DollarSign }] : [])
  ];

  // ---- Mobile navigation (data-driven: every item is filtered through isTabVisible) ----
  const visibleNav = navigation.filter(item => isTabVisible(item.id as keyof PagePermissions));
  const navById = (id: string) => visibleNav.find(item => item.id === id);
  const MOBILE_PRIMARY_IDS = ['dashboard', 'revenue', 'projects', 'payments'];
  // Preferred tabs first; if a user can't see some of them, fill the bar with their next visible pages
  const mobilePrimary = [
    ...MOBILE_PRIMARY_IDS.map(navById).filter(Boolean),
    ...visibleNav.filter(item => !MOBILE_PRIMARY_IDS.includes(item.id)),
  ].slice(0, 4) as typeof navigation;
  const isMoreActive = !mobilePrimary.some(item => item.id === activeTab);
  const MOBILE_MORE_GROUPS: { label: string; ids: string[] }[] = [
    { label: 'Main', ids: ['dashboard', 'revenue', 'projects', 'payments'] },
    { label: 'Money', ids: ['invoices', 'expenses', 'incomeStreams', 'monthlyClosing', 'withdrawals', 'myEarnings'] },
    { label: 'Work', ids: ['projectManagement', 'tasks', 'automations', 'aiAdvisor'] },
    { label: 'People & admin', ids: ['team', 'users', 'backup'] },
  ];
  const groupedIds = MOBILE_MORE_GROUPS.flatMap(g => g.ids);
  const mobileMoreGroups = [
    ...MOBILE_MORE_GROUPS.map(g => ({ label: g.label, items: g.ids.map(navById).filter(Boolean) as typeof navigation })),
    // Any page added to `navigation` later still shows up here automatically
    { label: 'Other', items: visibleNav.filter(item => !groupedIds.includes(item.id)) },
  ].filter(g => g.items.length > 0);
  const goToTab = (id: string) => { setActiveTab(id as keyof PagePermissions); setShowMoreSheet(false); };
  const activePageName = navigation.find(item => item.id === activeTab)?.name ?? 'Dashboard';
  const periodLabel = (() => {
    const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    if (!startDate || startDate <= '2020-01-01') return 'All time';
    if (startDate === monthStart && endDate === today) return 'This month';
    if (startDate === today && endDate === today) return 'Today';
    return `${fmt(startDate)} – ${endDate ? fmt(endDate) : 'Now'}`;
  })();

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard startDate={startDate} endDate={endDate} onNavigate={goToTab} canOpen={(id) => isTabVisible(id as keyof PagePermissions)} />;
      case 'aiAdvisor': return <AIAdvisorView />;
      case 'revenue': return <RevenueView globalStart={startDate} globalEnd={endDate} currentUser={user} />;
      case 'projects': return <ProjectsView globalStart={startDate} globalEnd={endDate} currentUser={user} />;
      case 'projectManagement': return <ProjectManagementView globalStart={startDate} globalEnd={endDate} currentUser={user} />;
      case 'payments': return <PaymentsView globalStart={startDate} globalEnd={endDate} currentUser={user} />;
      case 'expenses': return <ExpensesView globalStart={startDate} globalEnd={endDate} />;
      case 'team': return <TeamView />;
      case 'users': return <UsersView />;
      case 'incomeStreams': return <IncomeStreamsView />;
      case 'monthlyClosing': return <MonthlyClosingView />;
      case 'backup': return <BackupView />;
      case 'automations': return <AutomationsView />;
      case 'withdrawals': return <WithdrawalsView />;
      case 'myEarnings': return <MyEarningsView currentUser={user} globalStart={startDate} globalEnd={endDate} />;
      case 'tasks': return <TasksView currentUser={user} activeTab={tasksActiveTab} onTabChange={setTasksActiveTab} />;
      case 'invoices': return <InvoicesView />;
      default: return <Dashboard startDate={startDate} endDate={endDate} />;
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, canAccess }}>
      <div className="flex flex-col md:flex-row h-screen bg-[#f3f4f6] overflow-hidden">
        
        {/* Mobile Header */}
        <header className="md:hidden bg-white px-4 py-3 flex items-center justify-between gap-3 border-b border-gray-200 z-40">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 bg-[#ff5a1f] rounded-lg flex items-center justify-center font-semibold text-white shrink-0 text-sm">T</div>
            <h1 className="text-lg font-semibold tracking-tight text-gray-900 truncate">{activePageName}</h1>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setShowDateModal(true)}
              aria-label="Change period"
              className="h-9 px-3 flex items-center gap-1.5 bg-gray-100 rounded-full text-[13px] font-medium text-gray-800"
            >
              <Calendar size={15} className="text-indigo-600" />
              <span className="max-w-[120px] truncate">{periodLabel}</span>
              <ChevronDown size={14} className="text-gray-500" />
            </button>
            <button
              ref={mobileBellRef}
              onClick={handleBellClick}
              aria-label="Notifications"
              className="relative w-10 h-10 flex items-center justify-center text-gray-600 rounded-xl"
            >
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-semibold rounded-full flex items-center justify-center px-0.5 leading-none">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Sidebar (Desktop) */}
        <aside className={`hidden md:flex ${sidebarOpen ? 'w-64' : 'w-20'} bg-white flex-col transition-all duration-300 z-30 overflow-hidden shadow-xl m-3 rounded-[32px] border border-gray-200`}>
          <div className="p-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-8 h-8 bg-[#ff5a1f] rounded-lg flex items-center justify-center font-black text-white shrink-0">T</div>
              {sidebarOpen && <span className="text-xl font-extrabold tracking-tight text-gray-900 truncate uppercase">Taskronize</span>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {/* BELL_ICON — Haiku replaces this comment with bell button JSX */}
              <button ref={bellRef} onClick={handleBellClick} className="relative p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-0.5 leading-none">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition-all"
              >
                {sidebarOpen ? <ChevronLeft size={18} /> : <Menu size={18} />}
              </button>
            </div>
          </div>

          <nav className="flex-1 px-4 py-2 space-y-1 overflow-y-auto scrollbar-hide">
            {navigation.filter(item => isTabVisible(item.id as keyof PagePermissions)).map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as keyof PagePermissions)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all font-semibold ${
                    isActive ? 'bg-gray-900 text-white shadow-lg shadow-gray-200' : 'text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <Icon size={20} className={isActive ? 'text-white' : 'text-gray-400'} />
                  {sidebarOpen && <span className="text-sm truncate">{item.name}</span>}
                </button>
              );
            })}
          </nav>

          <div className="p-4 border-t border-gray-100 space-y-2">
            <div className="relative no-print mb-2">
              <button 
                onClick={() => setShowDateModal(true)} 
                className={`w-full flex items-center gap-2 bg-gray-50 px-3 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-100 transition-all font-bold text-[9px] uppercase tracking-widest text-gray-600 ${!sidebarOpen && 'justify-center'}`}
              >
                <Calendar size={14} className="text-gray-400 shrink-0" />
                {sidebarOpen && <span className="truncate">{startDate || 'All'} — {endDate || 'Now'}</span>}
              </button>
            </div>

            <div className={`flex items-center gap-3 px-3 py-3 rounded-2xl group transition-all ${!sidebarOpen && 'justify-center'}`}>
              <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center font-bold text-orange-600 text-sm shrink-0">
                {user.name.charAt(0)}
              </div>
              {sidebarOpen && (
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">{user.name}</p>
                  <p className="text-[10px] text-gray-500 truncate font-medium">@{user.username}</p>
                </div>
              )}
            </div>
            <button
              onClick={() => { setChangePwForm({ currentPassword: '', newPassword: '', confirmPassword: '' }); setChangePwError(''); setShowChangePasswordModal(true); }}
              className={`w-full flex items-center gap-3 px-3 py-2 text-gray-400 hover:text-blue-600 font-bold transition-all text-sm ${!sidebarOpen && 'justify-center'}`}
            >
              <Lock size={18} />
              {sidebarOpen && <span>Change Password</span>}
            </button>
            <button
              onClick={logout}
              className={`w-full flex items-center gap-3 px-3 py-2 text-gray-400 hover:text-red-500 font-bold transition-all text-sm ${!sidebarOpen && 'justify-center'}`}
            >
              <LogOut size={18} />
              {sidebarOpen && <span>Sign Out</span>}
            </button>
          </div>
        </aside>

        {/* Bottom Navigation (Mobile) */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-1 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] grid grid-cols-5 z-40">
          {mobilePrimary.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => goToTab(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex flex-col items-center justify-center gap-1 min-h-[48px] rounded-xl ${isActive ? 'text-indigo-600' : 'text-gray-500'}`}
              >
                <Icon size={22} />
                <span className={`text-[11px] leading-none ${isActive ? 'font-semibold' : 'font-medium'}`}>{item.id === 'dashboard' ? 'Home' : item.name}</span>
              </button>
            );
          })}
          <button
            onClick={() => setShowMoreSheet(true)}
            className={`flex flex-col items-center justify-center gap-1 min-h-[48px] rounded-xl ${isMoreActive || showMoreSheet ? 'text-indigo-600' : 'text-gray-500'}`}
          >
            <Menu size={22} />
            <span className={`text-[11px] leading-none ${isMoreActive ? 'font-semibold' : 'font-medium'}`}>More</span>
          </button>
        </nav>

        {/* More sheet (Mobile) — every page the user can access */}
        {showMoreSheet && (
          <div className="md:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="All pages">
            <button aria-label="Close" className="absolute inset-0 bg-gray-900/45" onClick={() => setShowMoreSheet(false)} />
            <div className="absolute left-0 right-0 bottom-0 max-h-[88vh] overflow-y-auto bg-white rounded-t-3xl px-4 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
              <div className="mx-auto w-10 h-1.5 rounded-full bg-gray-300" />
              <div className="flex items-center justify-between py-3">
                <h2 className="text-lg font-semibold text-gray-900">All pages</h2>
                <button aria-label="Close" onClick={() => setShowMoreSheet(false)} className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-600">
                  <X size={18} />
                </button>
              </div>
              <div className="space-y-4">
                {mobileMoreGroups.map(group => (
                  <div key={group.label}>
                    <h3 className="text-xs font-medium uppercase tracking-wider text-gray-500 mb-2">{group.label}</h3>
                    <div className="grid grid-cols-4 gap-2">
                      {group.items.map(item => {
                        const Icon = item.icon;
                        const isActive = activeTab === item.id;
                        return (
                          <button
                            key={item.id}
                            onClick={() => goToTab(item.id)}
                            className={`min-h-[76px] rounded-2xl flex flex-col items-center justify-center gap-1.5 px-1 text-center text-xs font-medium ${isActive ? 'bg-indigo-600 text-white' : 'bg-gray-50 text-gray-900'}`}
                          >
                            <Icon size={22} className={isActive ? 'text-white' : 'text-indigo-600'} />
                            <span className="leading-tight">{item.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-2 border-t border-gray-100">
                <button
                  onClick={() => { setShowMoreSheet(false); setChangePwForm({ currentPassword: '', newPassword: '', confirmPassword: '' }); setChangePwError(''); setShowChangePasswordModal(true); }}
                  className="w-full h-12 flex items-center gap-3 text-[15px] font-medium text-gray-900"
                >
                  <Lock size={18} className="text-gray-500" /> Change password
                </button>
                <button onClick={() => { setShowMoreSheet(false); logout(); }} className="w-full h-12 flex items-center gap-3 text-[15px] font-medium text-red-600">
                  <LogOut size={18} /> Sign out
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col min-w-0 bg-white md:m-3 md:ml-0 md:rounded-[32px] md:border md:border-gray-200 overflow-hidden shadow-sm relative">
          <OverdueTicker currentUser={user} />
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-8 scroll-smooth pb-24 md:pb-8">
            <div className="max-w-[1400px] mx-auto">
              {renderContent()}
            </div>
          </div>
        </main>
      </div>

      {/* Date Filter Modal - Fixed Clipping Issue */}
      <Modal 
        title="Period Selection" 
        isOpen={showDateModal} 
        onClose={() => setShowDateModal(false)}
        showSaveButton={false}
        maxWidth="max-w-xs"
      >
        <div className="pb-4">
          <DateShortcuts 
            startDate={startDate} 
            endDate={endDate} 
            onStartDateChange={setStartDate} 
            onEndDateChange={setEndDate} 
            onShortcutSelect={(start, end) => { 
              setStartDate(start); 
              setEndDate(end); 
              setShowDateModal(false); 
            }} 
          />
        </div>
      </Modal>

      {/* Notification Dropdown */}
      {showNotifDropdown && (
        <NotificationDropdown
          ref={notifDropdownRef}
          notifications={notifications}
          unreadCount={unreadCount}
          position={dropdownPos}
          currentUser={user}
          notifAllUsers={notifAllUsers}
          notifAdminUserId={notifAdminUserId}
          onAdminUserChange={setNotifAdminUserId}
          onMarkAllRead={handleMarkAllRead}
          onNotifClick={handleNotifClick}
        />
      )}

      {showChangePasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Lock className="text-blue-600" size={20} />
                <h3 className="font-bold text-slate-800">Change Password</h3>
              </div>
              <button onClick={() => setShowChangePasswordModal(false)} className="p-1 hover:bg-slate-200 rounded-lg"><X size={20} /></button>
            </div>
            <form onSubmit={handleChangePassword} className="p-6 space-y-4">
              {changePwError && (
                <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-medium border border-red-100">{changePwError}</div>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Current Password</label>
                <input type="password" required value={changePwForm.currentPassword} onChange={e => setChangePwForm({ ...changePwForm, currentPassword: e.target.value })} className="w-full px-4 py-2 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20" placeholder="••••••••" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">New Password</label>
                <input type="password" required value={changePwForm.newPassword} onChange={e => setChangePwForm({ ...changePwForm, newPassword: e.target.value })} className="w-full px-4 py-2 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20" placeholder="••••••••" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Confirm New Password</label>
                <input type="password" required value={changePwForm.confirmPassword} onChange={e => setChangePwForm({ ...changePwForm, confirmPassword: e.target.value })} className="w-full px-4 py-2 border rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20" placeholder="••••••••" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowChangePasswordModal(false)} className="flex-1 py-3 px-4 rounded-xl border border-slate-200 text-slate-600 font-bold">Cancel</button>
                <button type="submit" disabled={changePwLoading} className="flex-1 py-3 px-4 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition-all disabled:opacity-50">
                  {changePwLoading ? 'Saving...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
};

export default App;
