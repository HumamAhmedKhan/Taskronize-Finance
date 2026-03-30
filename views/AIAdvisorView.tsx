
import React, { useState, useEffect, useRef, useMemo, useContext } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { supabase, db } from '../lib/supabase';
import { AuthContext } from '../App';
import Modal from '../components/Modal';
import { FinancialGoal, Revenue, Expense, ProductionPayment, IncomeStream, TeamMember, Project, ProjectAllocation, OtherPayment, RecurringExpense } from '../types';
import { calculateRevenueDetails } from '../utils/calculations';
import { 
  Sparkles, 
  History, 
  PiggyBank, 
  Edit2, 
  Plus, 
  Trash2, 
  RefreshCw, 
  ArrowRight, 
  Bot, 
  Loader2, 
  ShieldCheck, 
  Wallet, 
  AlertCircle, 
  Save, 
  Landmark,
  Coins,
  X,
  Eye,
  Calendar
} from 'lucide-react';

const AIAdvisorView: React.FC = () => {
  const auth = useContext(AuthContext);
  const [goals, setGoals] = useState<FinancialGoal[]>([]);
  const [allRevenues, setAllRevenues] = useState<Revenue[]>([]);
  const [streams, setStreams] = useState<IncomeStream[]>([]);
  const [allExpenses, setAllExpenses] = useState<Expense[]>([]);
  const [allPayments, setAllPayments] = useState<ProductionPayment[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [allocations, setAllocations] = useState<ProjectAllocation[]>([]);
  const [allOtherPayments, setAllOtherPayments] = useState<OtherPayment[]>([]);
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>([]);
  const [links, setLinks] = useState<any[]>([]);
  
  const [globalInstructions, setGlobalInstructions] = useState(() => {
    return localStorage.getItem('taskronize_ai_directives') || "Do not suggest any spending if 'Account Balance' is negative. Prioritize debt clearance over all other goals. Treat money owed to partners as already spent.";
  });
  const [isSavingDirectives, setIsSavingDirectives] = useState(false);

  const [loading, setLoading] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'model', content: string, timestamp: string}[]>([]);
  
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  
  const [selectedGoal, setSelectedGoal] = useState<Partial<FinancialGoal>>({});
  const [manualContribution, setManualContribution] = useState({ amount: 0, date: new Date().toISOString().split('T')[0], notes: '' });
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [goalsData, revs, streamsData, exps, pymts, membersData, projs, allocs, others, recData, linkData] = await Promise.all([
        supabase.from('financial_goals').select('*').order('priority', { ascending: false }),
        supabase.from('revenues').select('*'),
        db.get<IncomeStream>('income_streams'),
        supabase.from('expenses').select('*'),
        supabase.from('production_payments').select('*'),
        db.get<TeamMember>('team_members'),
        db.get<Project>('projects'),
        db.get<ProjectAllocation>('project_allocations'),
        supabase.from('other_payments').select('*'),
        supabase.from('recurring_expenses').select('*').eq('is_active', true),
        supabase.from('project_revenue_links').select('*')
      ]);
      
      setGoals(goalsData.data || []);
      setAllRevenues(revs.data || []);
      setStreams(streamsData || []);
      setAllExpenses(exps.data || []);
      setAllPayments(pymts.data || []);
      setMembers(membersData || []);
      setProjects(projs || []);
      setAllocations(allocs || []);
      setAllOtherPayments(others.data || []);
      setRecurringExpenses(recData.data || []);
      setLinks(linkData.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatHistory, isTyping]);

  const goalsWithDynamicProgress = useMemo(() => {
    return goals.map(goal => {
      const contributions = allPayments.filter(p => 
        p.payment_type === 'savings' && 
        (p.notes?.includes(`Goal: ${goal.name}`) || p.notes === goal.name)
      );
      const dynamicProgress = contributions.reduce((sum, p) => sum + Number(p.total_amount), 0);
      return { ...goal, current_progress: dynamicProgress, contributions };
    });
  }, [goals, allPayments]);

  const financialSummary = useMemo(() => {
    // Unify logic with Dashboard view to ensure negative balances are reflected
    const totalGross = allRevenues.reduce((sum, r) => sum + Number(r.total_sale || 0), 0);
    const totalFees = allRevenues.reduce((sum, r) => sum + (Number(r.total_sale || 0) * Number(r.platform_fee_percent || 0) / 100), 0);
    const totalOpEx = allExpenses.filter(e => !e.is_production).reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const totalRec = recurringExpenses.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const totalDev = allPayments.filter(p => p.payment_type === 'developer').reduce((sum, p) => sum + Number(p.total_amount || 0), 0);
    const totalOtherPaid = allOtherPayments.filter(o => o.is_paid).reduce((sum, o) => sum + Number(o.amount || 0), 0);
    const totalSavings = allPayments.filter(p => p.payment_type === 'savings').reduce((sum, p) => sum + Number(p.total_amount), 0);

    let totalPartnerComms = 0;
    allRevenues.forEach(rev => {
      const stream = streams.find(s => s.id === rev.income_stream_id);
      if (!stream) return;
      const details = calculateRevenueDetails(rev, stream, allExpenses, allPayments, allRevenues, projects, allocations, links);
      Object.entries(details.commissions).forEach(([name, amount]) => {
        if (members.some(m => m.name === name && m.role === 'Partner')) totalPartnerComms += amount;
      });
    });

    // Retained Profit = Gross - Fees - Operational Burn - Developer Pay - Ad-hoc Pay - Accrued Partner Shares
    const retainedProfit = totalGross - totalFees - totalOpEx - totalRec - totalDev - totalPartnerComms - totalOtherPaid;
    // Current Balance = Profit - Funds already deployed to savings
    const accountBalance = retainedProfit - totalSavings;

    const now = new Date();
    const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthlyGross = allRevenues.filter(r => r.date.startsWith(currentMonthPrefix)).reduce((s, r) => s + Number(r.total_sale), 0);
    const monthlyExpenses = allExpenses.filter(e => e.date.startsWith(currentMonthPrefix)).reduce((s, e) => s + Number(e.amount), 0);

    return { accountBalance, retainedProfit, monthlySurplus: monthlyGross - monthlyExpenses };
  }, [allRevenues, streams, allExpenses, allPayments, members, projects, allocations, allOtherPayments, recurringExpenses, links]);

  const sendMessage = async (text: string = userInput) => {
    if (!text.trim()) return;
    const userMsg = { role: 'user' as const, content: text, timestamp: new Date().toLocaleTimeString() };
    setChatHistory(prev => [...prev, userMsg]);
    setUserInput('');
    setIsTyping(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const systemInstruction = `
        You are the Taskronize Financial Wealth Strategist.
        - ACTUAL ACCOUNT BALANCE: $${financialSummary.accountBalance.toFixed(2)}
        - RETAINED PROFIT: $${financialSummary.retainedProfit.toFixed(2)}
        - MONTHLY SURPLUS: $${financialSummary.monthlySurplus.toFixed(2)}
        - DIRECTIVES: "${globalInstructions}"
        If balance is negative, focus exclusively on debt reduction and lean operations.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: chatHistory.concat(userMsg).map(m => ({ role: m.role, parts: [{ text: m.content }] })),
        config: { systemInstruction }
      });

      setChatHistory(prev => [...prev, { role: 'model', content: response.text || "I've analyzed your data.", timestamp: new Date().toLocaleTimeString() }]);
    } catch (err) {
      setChatHistory(prev => [...prev, { role: 'model', content: "Communication interrupted.", timestamp: new Date().toLocaleTimeString() }]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleDeleteGoal = async (id: number) => {
    if (!confirm('Are you sure you want to delete this wealth plan? Associated savings history will remain in payments but the target tracking will be lost.')) return;
    try {
      const { error } = await supabase.from('financial_goals').delete().eq('id', id);
      if (error) throw error;
      loadData();
    } catch (err) {
      alert('Failed to delete goal.');
    }
  };

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-32">
      <div className="flex justify-between items-center px-2 md:px-0">
        <div>
          <h1 className="text-3xl font-black text-gray-900 flex items-center gap-3"><Sparkles className="text-[#ff5a1f]" /> Advisor Panel</h1>
          <p className="text-sm font-bold text-gray-400 uppercase tracking-widest mt-1">Directives-Based Wealth Strategy</p>
        </div>
        <button onClick={loadData} className="p-3 bg-gray-50 text-gray-400 rounded-2xl border border-gray-100 transition-all active:scale-95"><RefreshCw size={20} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white rounded-[40px] border border-gray-100 p-8 shadow-sm flex flex-col h-[750px]">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-xl font-black text-gray-900 flex items-center gap-3"><PiggyBank className="text-[#ff5a1f]" /> Wealth Distribution</h2>
            <button 
              onClick={() => { setSelectedGoal({}); setShowGoalModal(true); }} 
              className="px-5 py-2.5 bg-gray-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all shadow-lg active:scale-95 flex items-center gap-2"
            >
              <Plus size={14} /> Create Plan
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto pr-2 space-y-4 scrollbar-hide">
            {goalsWithDynamicProgress.map(goal => (
              <div key={goal.id} className="p-6 border border-gray-100 rounded-[32px] bg-gray-50/30 group relative overflow-hidden transition-all hover:border-gray-200">
                <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-all z-10 bg-white/80 backdrop-blur-sm p-1.5 rounded-xl shadow-sm border border-gray-100 transform translate-x-2 group-hover:translate-x-0">
                  <button onClick={(e) => { e.stopPropagation(); setSelectedGoal(goal); setShowGoalModal(true); }} className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                    <Edit2 size={14} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleDeleteGoal(goal.id); }} className="p-1.5 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>

                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-2xl shadow-sm border border-gray-50">{goal.icon || '💰'}</div>
                    <div>
                      <h3 className="font-black text-gray-900">{goal.name}</h3>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Target: {goal.target_date || 'Ongoing'}</p>
                    </div>
                  </div>
                </div>
                
                <div className="h-3 bg-white rounded-full overflow-hidden border border-gray-100 mb-2">
                  <div 
                    className={`h-full transition-all duration-1000 rounded-full ${goal.current_progress >= goal.target_amount ? 'bg-emerald-500' : 'bg-[#ff5a1f]'}`} 
                    style={{ width: `${Math.min(100, (goal.current_progress / goal.target_amount) * 100)}%` }} 
                  />
                </div>
                <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                  <span className="text-gray-900">{formatCurrency(goal.current_progress)} Settled</span>
                  <span className="text-gray-400">{formatCurrency(goal.target_amount)} Goal</span>
                </div>
              </div>
            ))}
            {goals.length === 0 && (
              <div className="text-center py-20 text-gray-400">
                <p className="text-xs font-bold">No wealth plans active.</p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-[40px] border border-gray-100 flex flex-col h-[750px] shadow-sm overflow-hidden">
          <header className="p-8 border-b bg-gray-50/30">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 bg-gray-900 text-white rounded-2xl flex items-center justify-center shadow-lg"><Bot size={24} /></div>
              <div><h3 className="font-black text-gray-900">AI Strategist</h3><p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Directives Active</p></div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="p-5 bg-white border border-gray-100 rounded-3xl flex flex-col shadow-sm">
                <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5 mb-1"><Landmark size={12} className="text-indigo-500" /> Net Liquidity</span>
                <span className={`text-xl font-black tracking-tighter ${financialSummary.accountBalance >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>{formatCurrency(financialSummary.accountBalance)}</span>
              </div>
              <div className="p-5 bg-white border border-gray-100 rounded-3xl flex flex-col shadow-sm">
                <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5 mb-1"><AlertCircle size={12} className="text-amber-500" /> Monthly Surplus</span>
                <span className="text-xl font-black tracking-tighter text-gray-900">{formatCurrency(financialSummary.monthlySurplus)}</span>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto p-8 space-y-6 scrollbar-hide">
            {chatHistory.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2`}>
                <div className={`max-w-[85%] px-6 py-4 rounded-[28px] ${msg.role === 'user' ? 'bg-gray-900 text-white shadow-xl' : 'bg-gray-50 border text-gray-900 font-medium'}`}>{msg.content}</div>
              </div>
            ))}
            {isTyping && <div className="flex justify-start"><div className="bg-gray-50 px-6 py-4 rounded-[28px] border border-gray-100 flex items-center gap-2"><Loader2 size={16} className="animate-spin text-indigo-500" /> <span className="text-xs font-black text-indigo-600 uppercase tracking-widest">Consulting Guardrails...</span></div></div>}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-8 border-t bg-white">
            <div className="flex gap-4 p-2 bg-gray-50 rounded-[32px] border border-gray-100 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
              <input 
                type="text" 
                value={userInput} 
                onChange={e => setUserInput(e.target.value)} 
                onKeyPress={e => e.key === 'Enter' && sendMessage()} 
                placeholder="Ask about your financial status..." 
                className="flex-1 px-6 bg-transparent outline-none text-sm font-bold placeholder:text-gray-300" 
              />
              <button onClick={() => sendMessage()} disabled={!userInput.trim() || isTyping} className="w-12 h-12 bg-gray-900 text-white rounded-full flex items-center justify-center disabled:opacity-50 transition-all shadow-lg active:scale-95"><ArrowRight size={20} /></button>
            </div>
          </div>
        </div>
      </div>

      <Modal 
        title={selectedGoal.id ? 'Edit Wealth Plan' : 'New Wealth Plan'} 
        isOpen={showGoalModal} 
        onClose={() => setShowGoalModal(false)} 
        onSave={async () => {
          if (!selectedGoal.name || !selectedGoal.target_amount) return alert('Fill required fields');
          try {
            if (selectedGoal.id) await supabase.from('financial_goals').update(selectedGoal).eq('id', selectedGoal.id);
            else await supabase.from('financial_goals').insert({ ...selectedGoal, current_progress: 0 });
            setShowGoalModal(false); loadData();
          } catch (err) { alert('Save failed'); }
        }}
        maxWidth="max-w-md"
      >
        <div className="space-y-6">
          <div className="grid grid-cols-4 gap-4">
            <div className="col-span-1 space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Icon</label>
              <input type="text" value={selectedGoal.icon || ''} onChange={e => setSelectedGoal({...selectedGoal, icon: e.target.value})} placeholder="💰" className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-center text-xl" />
            </div>
            <div className="col-span-3 space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Goal Name</label>
              <input type="text" value={selectedGoal.name || ''} onChange={e => setSelectedGoal({...selectedGoal, name: e.target.value})} placeholder="e.g. Rainy Day Fund" className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Target Amount ($)</label>
            <input type="number" value={selectedGoal.target_amount || ''} onChange={e => setSelectedGoal({...selectedGoal, target_amount: parseFloat(e.target.value)})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold" />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Monthly Allocation Target ($)</label>
            <input type="number" value={selectedGoal.monthly_allocation || ''} onChange={e => setSelectedGoal({...selectedGoal, monthly_allocation: parseFloat(e.target.value)})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl text-sm font-bold" placeholder="Auto-suggested monthly savings..." />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default AIAdvisorView;
