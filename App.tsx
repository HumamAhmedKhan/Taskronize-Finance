
import React, { useState, useEffect, createContext } from 'react';
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
  Zap
} from 'lucide-react';
import { User, PagePermissions } from './types';
import { supabase } from './lib/supabase';
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
import { DateShortcuts } from './components/DateShortcuts';
import Modal from './components/Modal';

interface AuthContextType {
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
  canAccess: (page: keyof PagePermissions) => boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<keyof PagePermissions>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  
  // Global Date State for consistent filtering across Dashboard & views
  const [startDate, setStartDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [showDateModal, setShowDateModal] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('taskronize_user');
    if (!saved) return;
    const cached: User = JSON.parse(saved);
    setUser(cached);
    // Re-fetch from DB so stale cached fields (e.g. linked_income_stream_ids) are always fresh
    supabase.from('users').select('*').eq('id', cached.id).single().then(({ data }) => {
      if (data) {
        setUser(data);
        localStorage.setItem('taskronize_user', JSON.stringify(data));
      }
    });
  }, []);

  const login = (userData: User) => {
    setUser(userData);
    localStorage.setItem('taskronize_user', JSON.stringify(userData));
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('taskronize_user');
  };

  const canAccess = (page: keyof PagePermissions) => {
    if (!user || !user.permissions) return false;
    let level = user.permissions[page];
    if (level === undefined && page === 'projectManagement') {
      level = user.permissions['projects'];
    }
    return level === 'full' || level === 'edit-hidden';
  };

  const isTabVisible = (page: keyof PagePermissions) => {
    if (!user || !user.permissions) return false;
    if (page === 'dashboard') return user.permissions['dashboard'] !== 'none';
    if (page === 'automations') return user.user_type === 'admin';
    if (page === 'myEarnings') return user.user_type === 'partner' || user.user_type === 'team_member';
    let level = user.permissions[page];
    if (level === undefined && page === 'projectManagement') {
      level = user.permissions['projects'];
    }
    return level === 'full' || level === 'edit-hidden';
  };

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
    { id: 'expenses', name: 'Expenses', icon: Receipt },
    { id: 'incomeStreams', name: 'Income Streams', icon: Database },
    { id: 'team', name: 'Team', icon: Users },
    { id: 'users', name: 'Users', icon: Settings },
    { id: 'monthlyClosing', name: 'Monthly Closing', icon: Calendar },
    { id: 'backup', name: 'Backup & Restore', icon: Database },
    ...(user?.user_type === 'admin' ? [{ id: 'automations', name: 'Automations', icon: Zap }] : []),
    ...(user?.user_type === 'partner' || user?.user_type === 'team_member' ? [{ id: 'myEarnings', name: 'My Earnings', icon: DollarSign }] : [])
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard startDate={startDate} endDate={endDate} />;
      case 'aiAdvisor': return <AIAdvisorView />;
      case 'revenue': return <RevenueView globalStart={startDate} globalEnd={endDate} currentUser={user} />;
      case 'projects': return <ProjectsView globalStart={startDate} globalEnd={endDate} currentUser={user} />;
      case 'projectManagement': return <ProjectManagementView globalStart={startDate} globalEnd={endDate} currentUser={user} />;
      case 'payments': return <PaymentsView globalStart={startDate} globalEnd={endDate} />;
      case 'expenses': return <ExpensesView globalStart={startDate} globalEnd={endDate} />;
      case 'team': return <TeamView />;
      case 'users': return <UsersView />;
      case 'incomeStreams': return <IncomeStreamsView />;
      case 'monthlyClosing': return <MonthlyClosingView />;
      case 'backup': return <BackupView />;
      case 'automations': return <AutomationsView />;
      case 'myEarnings': return <MyEarningsView currentUser={user} globalStart={startDate} globalEnd={endDate} />;
      default: return <Dashboard startDate={startDate} endDate={endDate} />;
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, canAccess }}>
      <div className="flex flex-col md:flex-row h-screen bg-[#f3f4f6] overflow-hidden">
        
        {/* Mobile Header */}
        <header className="md:hidden bg-white px-6 py-4 flex items-center justify-between border-b border-gray-200 z-40">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#ff5a1f] rounded-lg flex items-center justify-center font-black text-white shrink-0 text-xs">T</div>
            <span className="text-lg font-black tracking-tight text-gray-900 uppercase">Taskronize</span>
          </div>
          <button 
            onClick={() => setShowDateModal(true)}
            className="p-2 bg-gray-50 rounded-xl text-gray-400 hover:bg-gray-100 transition-all border border-gray-100"
          >
            <Calendar size={20} />
          </button>
        </header>

        {/* Sidebar (Desktop) */}
        <aside className={`hidden md:flex ${sidebarOpen ? 'w-64' : 'w-20'} bg-white flex-col transition-all duration-300 z-30 overflow-hidden shadow-xl m-3 rounded-[32px] border border-gray-200`}>
          <div className="p-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-8 h-8 bg-[#ff5a1f] rounded-lg flex items-center justify-center font-black text-white shrink-0">T</div>
              {sidebarOpen && <span className="text-xl font-extrabold tracking-tight text-gray-900 truncate uppercase">Taskronize</span>}
            </div>
            <button 
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition-all"
            >
              {sidebarOpen ? <ChevronLeft size={18} /> : <Menu size={18} />}
            </button>
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
              onClick={logout}
              className={`w-full flex items-center gap-3 px-3 py-2 text-gray-400 hover:text-red-500 font-bold transition-all text-sm ${!sidebarOpen && 'justify-center'}`}
            >
              <LogOut size={18} />
              {sidebarOpen && <span>Sign Out</span>}
            </button>
          </div>
        </aside>

        {/* Bottom Navigation (Mobile) */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-2 py-2 flex items-center justify-around z-40 pb-safe shadow-2xl">
          {navigation.slice(0, 5).filter(item => isTabVisible(item.id as keyof PagePermissions)).map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as keyof PagePermissions)}
                className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${
                  isActive ? 'text-indigo-600' : 'text-gray-400'
                }`}
              >
                <Icon size={20} />
                <span className="text-[10px] font-black uppercase tracking-tighter">{item.name.split(' ')[0]}</span>
              </button>
            );
          })}
          <button 
            onClick={() => setActiveTab('incomeStreams')}
            className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${
              activeTab === 'incomeStreams' ? 'text-indigo-600' : 'text-gray-400'
            }`}
          >
            <Menu size={20} />
            <span className="text-[10px] font-black uppercase tracking-tighter">More</span>
          </button>
        </nav>

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col min-w-0 bg-white md:m-3 md:ml-0 md:rounded-[32px] md:border md:border-gray-200 overflow-hidden shadow-sm relative">
          <div className="flex-1 overflow-y-auto p-4 md:p-8 scroll-smooth pb-24 md:pb-8">
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
    </AuthContext.Provider>
  );
};

export default App;
