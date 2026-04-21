
import React, { useState, useEffect, useMemo, useContext } from 'react';
import { supabase, db } from '../lib/supabase';
import { TeamMember, Project, ProjectAllocation, Revenue, IncomeStream, ProductionPayment, OtherPayment, Expense, FinancialGoal, User } from '../types';
import { calculateRevenueDetails, extractPaidIds, getConnectsMonthly } from '../utils/calculations';
import SearchableSelect from '../components/SearchableSelect';
import Modal from '../components/Modal';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { 
  History,
  ArrowUpCircle,
  Plus,
  Minus,
  Coins,
  Trash2,
  X,
  Eye,
  Download,
  Share2,
  PiggyBank,
  CheckCircle2,
  Target,
  Briefcase,
  AlertCircle,
  FileText
} from 'lucide-react';

interface PaymentsViewProps {
  globalStart: string;
  globalEnd: string;
  currentUser?: User | null;
}


const PaymentsView: React.FC<PaymentsViewProps> = ({ globalStart, globalEnd, currentUser }) => {
  const isPartner = currentUser?.user_type === 'partner';
  const partnerStreamIds = isPartner ? (currentUser?.linked_income_stream_ids || []) : null;
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [allocations, setAllocations] = useState<ProjectAllocation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [revenues, setRevenues] = useState<Revenue[]>([]);
  const [incomeStreams, setIncomeStreams] = useState<IncomeStream[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [payments, setPayments] = useState<ProductionPayment[]>([]);
  const [otherPayments, setOtherPayments] = useState<OtherPayment[]>([]);
  const [projectRevenueLinks, setProjectRevenueLinks] = useState<any[]>([]);
  const [goals, setGoals] = useState<FinancialGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingPayment, setSavingPayment] = useState(false);
  
  const [showSettlementModal, setShowSettlementModal] = useState(false);
  const [showOtherModal, setShowOtherModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);

  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [selectedGoal, setSelectedGoal] = useState<FinancialGoal | null>(null);
  const [viewingPayment, setViewingPayment] = useState<ProductionPayment | null>(null);
  
  const [selectedRevenueKeys, setSelectedRevenueKeys] = useState<string[]>([]);
  const [selectedOtherIds, setSelectedOtherIds] = useState<number[]>([]);
  const [selectedAllocIds, setSelectedAllocIds] = useState<number[]>([]);
  
  const [paymentMeta, setPaymentMeta] = useState({ 
    date: new Date().toISOString().split('T')[0], 
    method: 'Bank Transfer', 
    notes: '',
    amount: 0
  });

  const [otherFormData, setOtherFormData] = useState<Partial<OtherPayment>>({
    date: new Date().toISOString().split('T')[0],
    category: 'bonus',
    amount: 0,
    description: '',
    recipient_id: undefined,
    recipient_type: 'team'
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const [members, allocs, projs, revs, streams, exps, pymts, others, links, goalsData] = await Promise.all([
        db.get<TeamMember>('team_members'),
        db.get<ProjectAllocation>('project_allocations'),
        db.get<Project>('projects'),
        db.get<Revenue>('revenues'),
        db.get<IncomeStream>('income_streams'),
        db.get<Expense>('expenses'),
        db.get<ProductionPayment>('production_payments'),
        supabase.from('other_payments').select('*'),
        supabase.from('project_revenue_links').select('*'),
        supabase.from('financial_goals').select('*')
      ]);
      setTeamMembers(members); 
      setAllocations(allocs); 
      setProjects(projs); 
      setRevenues(partnerStreamIds ? (revs || []).filter((r: Revenue) => partnerStreamIds.includes(r.income_stream_id)) : revs);
      setIncomeStreams(partnerStreamIds ? (streams || []).filter((s: IncomeStream) => partnerStreamIds.includes(s.id)) : streams);
      setExpenses(exps); 
      setPayments(pymts); 
      setOtherPayments(others.data || []);
      setProjectRevenueLinks(links.data || []);
      setGoals(goalsData.data || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, [globalStart, globalEnd]);

  const combinedAuditPool = useMemo(() => {
    const teamPool = teamMembers.map(member => {
      const unpaidCommissions: any[] = [];
      
      if (member.role === 'Partner') {
        revenues.forEach(rev => {
          const stream = incomeStreams.find(s => s.id === rev.income_stream_id);
          if (!stream) return;
          const rule = stream.commission_structure?.find((r: any) => r.name === member.name);
          if (!rule) return;

          const details = calculateRevenueDetails(rev, stream, expenses, payments, revenues, projects, allocations, projectRevenueLinks);
          const grossShareValue = details.grossCommissions[member.name] || 0;
          
          const key = `${rev.id}-${member.name}`;
          const isPaid = payments.some(p => {
            if (Number(p.recipient_id) !== Number(member.id)) return false;
            const parsedIds = extractPaidIds(p);
            return parsedIds.some(id => String(id) === key);
          });
          
          if (!isPaid && grossShareValue > 0) {
            const linkedProjs = projectRevenueLinks
              .filter(link => String(link.revenue_id) === String(rev.id))
              .map(link => projects.find(p => p.id === link.project_id))
              .filter(Boolean) as Project[];

            unpaidCommissions.push({ 
              key, revId: rev.id, client: rev.client_name, stream: stream.name,
              grossShareValue, date: rev.date,
              deductConnects: rule.deductConnects,
              deductProduction: rule.deductProduction,
              totalSale: rev.total_sale,
              linkedProjects: linkedProjs,
              description: rev.project_description
            });
          }
        });
      }

      const unpaidAllocs = allocations
        .filter(a => a.team_member_id === member.id)
        .filter(a => {
          const isPaid = payments.some(p => {
            if (Number(p.recipient_id) !== Number(member.id)) return false;
            const parsedIds = extractPaidIds(p);
            const hasIdInArray = parsedIds.some(id => String(id) === `ALLOC_${a.id}`);
            const hasLegacyNote = p.notes?.includes(`Alloc: ${a.id}`);
            return hasIdInArray || hasLegacyNote;
          });
          return !isPaid;
        })
        .map(a => {
           const proj = projects.find(p => p.id === a.project_id);
           return { id: a.id, description: `Project: ${proj?.project_name || 'Production'}`, amount: a.amount, date: proj?.date || 'N/A', category: 'Allocation' };
        });

      const unpaidOthers = otherPayments
        .filter(o => o.recipient_id === member.id && !o.is_paid)
        .map(o => ({ ...o, category: o.category || 'Other' }));
      
      let cardConnectsDeduction = 0;
      let cardProductionDeduction = 0;
      const processedConnects = new Set<string>();
      const processedProjects = new Set<number>();
      const processedProdManual = new Set<string>();

      // Periods where connects/production deductions were already charged in prior settlements
      const chargedPeriods = new Set<string>();
      payments.forEach(p => {
        if (Number(p.recipient_id) !== Number(member.id)) return;
        extractPaidIds(p).forEach(id => {
          if (id.startsWith('ALLOC_')) return;
          const dashIdx = id.indexOf('-');
          if (dashIdx === -1) return;
          const prevRev = revenues.find(r => String(r.id) === id.slice(0, dashIdx));
          if (prevRev) chargedPeriods.add(`${prevRev.income_stream_id}-${prevRev.date.substring(0, 7)}`);
        });
      });

      unpaidCommissions.forEach(c => {
          const rev = revenues.find(r => r.id === c.revId);
          const stream = incomeStreams.find(s => s.name === c.stream);

          if (rev && stream) {
             const periodKey = `${rev.income_stream_id}-${rev.date.substring(0, 7)}`;
             const rule = stream.commission_structure?.find((r: any) => r.name === member.name);

             if (rule?.deductConnects && !processedConnects.has(periodKey) && !chargedPeriods.has(periodKey)) {
                 const ym = rev.date.substring(0, 7);
                 const connectsMonthly = getConnectsMonthly(expenses, Number(rev.income_stream_id), `${ym}-01`, `${ym}-31`);
                 const share = connectsMonthly * (Number(rule.value) / 100);
                 if (share > 0) {
                    cardConnectsDeduction += share;
                    processedConnects.add(periodKey);
                 }
             }

             if (rule?.deductProduction) {
                 const linkedProjectIds = projectRevenueLinks
                    .filter(link => String(link.revenue_id) === String(rev.id))
                    .map(link => Number(link.project_id));
                 
                 linkedProjectIds.forEach(pId => {
                     if (!processedProjects.has(pId)) {
                         const projAllocTotal = allocations
                            .filter(a => a.project_id === pId)
                            .reduce((s, a) => s + Number(a.amount), 0);
                         const share = projAllocTotal * (Number(rule.value) / 100);
                         if (share > 0) {
                            cardProductionDeduction += share;
                            processedProjects.add(pId);
                         }
                     }
                 });

                 if (!processedProdManual.has(periodKey) && !chargedPeriods.has(periodKey)) {
                     const manualProdMonthly = expenses
                      .filter(e =>
                        (e.is_production || e.category === 'Production Costs') &&
                        Number(e.income_stream_id) === Number(rev.income_stream_id) &&
                        e.date.startsWith(rev.date.substring(0, 7))
                      )
                      .reduce((s, e) => s + Number(e.amount), 0);

                     const share = manualProdMonthly * (Number(rule.value) / 100);
                     if (share > 0) {
                        cardProductionDeduction += share;
                        processedProdManual.add(periodKey);
                     }
                 }
             }
          }
      });

      const totalGross = unpaidCommissions.reduce((s, c) => s + c.grossShareValue, 0) +
                        unpaidAllocs.reduce((s, a) => s + a.amount, 0) +
                        unpaidOthers.reduce((s, o) => s + (o.category === 'deduction' ? -o.amount : o.amount), 0);
      
      const totalOwed = Math.max(0, totalGross - cardConnectsDeduction - cardProductionDeduction);

      return { type: 'team' as const, member, unpaidCommissions, unpaidOthers, unpaidAllocs, totalOwed };
    }).filter(status => status.totalOwed > 0);

    const goalPool = goals.filter(g => !g.is_achieved).map(goal => {
      const rangeStart = globalStart || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
      const rangeEnd = globalEnd || new Date().toISOString().split('T')[0];
      
      const savedInRange = payments
        .filter(p => p.payment_type === 'savings' && p.date >= rangeStart && p.date <= rangeEnd && (p.notes?.includes(`Goal: ${goal.name}`) || p.notes === goal.name))
        .reduce((s, p) => s + Number(p.total_amount), 0);
      
      const pending = Math.max(0, (goal.monthly_allocation || 0) - savedInRange);

      return { type: 'goal' as const, goal, totalOwed: pending };
    }).filter(g => g.totalOwed > 0);

    return [...teamPool, ...goalPool];
  }, [teamMembers, allocations, projects, revenues, incomeStreams, payments, otherPayments, goals, globalStart, globalEnd, expenses, projectRevenueLinks]);

  const auditCalculation = useMemo(() => {
    if (!selectedMember) return { revShareGross: 0, otherAdditions: 0, connectsTotal: 0, prodTotal: 0, manualDeductions: 0, grossTotal: 0, payable: 0, deductionItems: [] };
    const pool = combinedAuditPool.find(p => p.type === 'team' && p.member.id === selectedMember.id) as any;
    if (!pool) return { revShareGross: 0, otherAdditions: 0, connectsTotal: 0, prodTotal: 0, manualDeductions: 0, grossTotal: 0, payable: 0, deductionItems: [] };
    
    let revShareGross = 0;
    let connectsTotal = 0;
    let prodTotal = 0;
    const processedConnects = new Set<string>();
    const processedProjects = new Set<number>();
    const processedProdManual = new Set<string>();
    const deductionItems: any[] = [];
    
    const selectedComms = pool.unpaidCommissions.filter((c: any) => selectedRevenueKeys.includes(c.key));

    // Periods where deductions were already charged in prior settlements for this member
    const chargedPeriods = new Set<string>();
    payments.forEach(p => {
      if (Number(p.recipient_id) !== Number(selectedMember.id)) return;
      extractPaidIds(p).forEach(id => {
        if (id.startsWith('ALLOC_')) return;
        const dashIdx = id.indexOf('-');
        if (dashIdx === -1) return;
        const prevRev = revenues.find(r => String(r.id) === id.slice(0, dashIdx));
        if (prevRev) chargedPeriods.add(`${prevRev.income_stream_id}-${prevRev.date.substring(0, 7)}`);
      });
    });

    selectedComms.forEach((c: any) => {
      revShareGross += c.grossShareValue;
      const rev = revenues.find(r => r.id === c.revId);
      const stream = incomeStreams.find(s => s.name === c.stream);

      if (rev && stream) {
        const periodKey = `${rev.income_stream_id}-${rev.date.substring(0, 7)}`;
        const rule = stream.commission_structure?.find((r: any) => r.name === selectedMember.name);

        if (rule?.deductConnects && !processedConnects.has(periodKey) && !chargedPeriods.has(periodKey)) {
          const ym = rev.date.substring(0, 7);
          const connectsMonthly = getConnectsMonthly(expenses, Number(rev.income_stream_id), `${ym}-01`, `${ym}-31`);
          const share = connectsMonthly * (Number(rule.value) / 100);
          if (share > 0) {
            connectsTotal += share;
            deductionItems.push({ type: 'Connects', label: `${stream.name} - ${ym}`, amount: share });
            processedConnects.add(periodKey);
          }
        }

        if (rule?.deductProduction) {
          const linkedProjectIds = projectRevenueLinks
            .filter(link => Number(link.revenue_id) === Number(rev.id))
            .map(link => Number(link.project_id));
            
          linkedProjectIds.forEach(pId => {
            if (!processedProjects.has(pId)) {
              const proj = projects.find(p => p.id === pId);
              const projAllocTotal = allocations
                .filter(a => a.project_id === pId)
                .reduce((s, a) => s + Number(a.amount), 0);
              
              const share = projAllocTotal * (Number(rule.value) / 100);
              if (share > 0) {
                prodTotal += share;
                deductionItems.push({ type: 'Production', label: `Project: ${proj?.project_name || 'Unlinked'}`, amount: share });
                processedProjects.add(pId);
              }
            }
          });

          if (!processedProdManual.has(periodKey) && !chargedPeriods.has(periodKey)) {
             const manualProdMonthly = expenses
              .filter(e =>
                (e.is_production || e.category === 'Production Costs') &&
                Number(e.income_stream_id) === Number(rev.income_stream_id) &&
                e.date.startsWith(rev.date.substring(0, 7))
              )
              .reduce((s, e) => s + Number(e.amount), 0);

             const share = manualProdMonthly * (Number(rule.value) / 100);
             if (share > 0) {
               prodTotal += share;
               deductionItems.push({ type: 'Production (Exp)', label: `${stream.name} - ${rev.date.substring(0, 7)}`, amount: share });
               processedProdManual.add(periodKey);
             }
          }
        }
      }
    });

    let otherAdditions = 0;
    let manualDeductions = 0;
    pool.unpaidOthers.filter((o: any) => selectedOtherIds.includes(o.id)).forEach((o: any) => {
      if (o.category === 'deduction') manualDeductions += o.amount;
      else otherAdditions += o.amount;
    });
    pool.unpaidAllocs.filter((a: any) => selectedAllocIds.includes(a.id)).forEach((a: any) => otherAdditions += a.amount);

    const grossTotal = revShareGross + otherAdditions;
    const payable = Math.max(0, grossTotal - connectsTotal - prodTotal - manualDeductions);
    
    return { revShareGross, otherAdditions, connectsTotal, prodTotal, manualDeductions, grossTotal, payable, deductionItems };
  }, [selectedMember, selectedRevenueKeys, selectedOtherIds, selectedAllocIds, combinedAuditPool, revenues, incomeStreams, expenses, allocations, projectRevenueLinks, projects]);

  const reportData = useMemo(() => {
    if (!viewingPayment) return null;
    
    const settledOthers = otherPayments.filter(o => o.settled_in_payment_id === viewingPayment.id);
    const settledAllocs: any[] = [];
    const commBreakdown: any[] = [];
    let grossCommissions = 0;
    
    // Deduction Calculation Variables
    let connectsTotal = 0;
    let prodTotal = 0;
    const processedConnects = new Set<string>();
    const processedProjects = new Set<number>();
    const processedProdManual = new Set<string>();
    
    if (viewingPayment.paid_revenue_commission_ids) {
      viewingPayment.paid_revenue_commission_ids.forEach(key => {
        if (key.startsWith('ALLOC_')) {
          const allocId = Number(key.split('_')[1]);
          const alloc = allocations.find(a => a.id === allocId);
          if (alloc) {
            const project = projects.find(p => p.id === alloc.project_id);
            settledAllocs.push({
              description: `Project: ${project?.project_name || 'Unknown'}`,
              date: alloc.created_at ? alloc.created_at.split('T')[0] : viewingPayment.date,
              category: 'ALLOCATION',
              amount: alloc.amount
            });
          }
        } else if (key.includes('-')) {
          const dashIdx = key.indexOf('-');
          const revId = key.slice(0, dashIdx);
          const memberName = key.slice(dashIdx + 1);
          const rev = revenues.find(r => String(r.id) === revId);
          if (rev) {
            const stream = incomeStreams.find(s => s.id === rev.income_stream_id);
            if (stream) {
              const details = calculateRevenueDetails(rev, stream, expenses, payments, revenues, projects, allocations, projectRevenueLinks);
              
              // 1. Capture Gross Amount
              const grossAmt = details.grossCommissions[memberName] || 0;
              grossCommissions += grossAmt;
              commBreakdown.push({ 
                client: rev.client_name, 
                stream: stream.name, 
                date: rev.date, 
                amount: grossAmt,
                totalSale: rev.total_sale // Store original project value for display context
              });
              
              // 2. Re-calculate Deductions using "once-per-period" logic
              const periodKey = `${rev.income_stream_id}-${rev.date.substring(0, 7)}`;
              const rule = stream.commission_structure?.find((r: any) => r.name === memberName);
              
              if (rule?.deductConnects && !processedConnects.has(periodKey)) {
                const ym = rev.date.substring(0, 7);
                const connectsMonthly = getConnectsMonthly(expenses, Number(rev.income_stream_id), `${ym}-01`, `${ym}-31`);
                const share = connectsMonthly * (Number(rule.value) / 100);
                if (share > 0) {
                  connectsTotal += share;
                  processedConnects.add(periodKey);
                }
              }

              if (rule?.deductProduction) {
                // Linked Projects
                const linkedProjectIds = projectRevenueLinks
                  .filter(link => String(link.revenue_id) === String(rev.id))
                  .map(link => Number(link.project_id));
                  
                linkedProjectIds.forEach(pId => {
                  if (!processedProjects.has(pId)) {
                    const projAllocTotal = allocations
                      .filter(a => a.project_id === pId)
                      .reduce((s, a) => s + Number(a.amount), 0);
                    
                    const share = projAllocTotal * (Number(rule.value) / 100);
                    if (share > 0) {
                      prodTotal += share;
                      processedProjects.add(pId);
                    }
                  }
                });

                // Manual Production Costs
                if (!processedProdManual.has(periodKey)) {
                   const manualProdMonthly = expenses
                    .filter(e => 
                      (e.is_production || e.category === 'Production Costs') && 
                      Number(e.income_stream_id) === Number(rev.income_stream_id) && 
                      e.date.startsWith(rev.date.substring(0, 7))
                    )
                    .reduce((s, e) => s + Number(e.amount), 0);
                  
                   const share = manualProdMonthly * (Number(rule.value) / 100);
                   if (share > 0) {
                     prodTotal += share;
                     processedProdManual.add(periodKey);
                   }
                }
              }
            }
          }
        }
      });
    }

    const combinedOthers = [
      ...settledOthers.map(o => ({
        description: o.description,
        date: o.date,
        category: o.category,
        amount: o.amount
      })),
      ...settledAllocs
    ];

    const otherAdditions = combinedOthers.reduce((s, o) => s + (o.category === 'deduction' ? 0 : Number(o.amount)), 0);
    const manualDeductions = combinedOthers.reduce((s, o) => s + (o.category === 'deduction' ? Number(o.amount) : 0), 0);
    const productionDeduction = connectsTotal + prodTotal;

    const netAmountDue = grossCommissions + otherAdditions - productionDeduction - manualDeductions;

    return {
      recipient: viewingPayment.recipient_name,
      date: viewingPayment.date,
      paymentType: viewingPayment.payment_type,
      grossCommissions,
      otherAdditions,
      productionDeduction,
      netAmountDue,
      paymentReceived: viewingPayment.total_amount,
      outstandingBalance: netAmountDue - viewingPayment.total_amount,
      commissions: commBreakdown,
      others: combinedOthers
    };
  }, [viewingPayment, revenues, incomeStreams, otherPayments, expenses, payments, projects, allocations, projectRevenueLinks]);

  const handleSaveSettlement = async () => {
    if (!selectedMember || auditCalculation.payable < 0) return alert('Selection error.');
    
    setSavingPayment(true);
    try {
      const pool = combinedAuditPool.find(p => p.type === 'team' && p.member.id === selectedMember.id) as any;
      const otherToMark = pool?.unpaidOthers.filter((o: any) => selectedOtherIds.includes(o.id)).map((o: any) => o.id) || [];
      const allocToMark = pool?.unpaidAllocs.filter((a: any) => selectedAllocIds.includes(a.id)).map((a: any) => a.id) || [];

      const combinedPaidIds = [
        ...selectedRevenueKeys,
        ...allocToMark.map((id: number) => `ALLOC_${id}`)
      ];

      // Embed paid IDs into notes as a reliable text fallback
      // (paid_revenue_commission_ids array column may not persist correctly in all DB configs)
      const paidIdsJson = JSON.stringify(combinedPaidIds);

      const payload = {
        date: paymentMeta.date,
        payment_type: selectedMember.role === 'Partner' ? 'partner' : 'developer',
        recipient_id: selectedMember.id,
        recipient_name: selectedMember.name,
        total_amount: auditCalculation.payable,
        payment_method: paymentMeta.method,
        notes: `Audit Settlement. Deductions: Overheads(${auditCalculation.connectsTotal.toFixed(2)}), Prod-Alloc(${(auditCalculation.prodTotal).toFixed(2)}). Range: ${globalStart} - ${globalEnd}. PaidIDs:${paidIdsJson}`,
        paid_revenue_commission_ids: combinedPaidIds
      };

      const { error: rpcErr } = await supabase.rpc('create_settlement', {
        p_date:                         payload.date,
        p_payment_type:                 payload.payment_type,
        p_recipient_id:                 payload.recipient_id,
        p_recipient_name:               payload.recipient_name,
        p_total_amount:                 payload.total_amount,
        p_payment_method:               payload.payment_method,
        p_notes:                        payload.notes,
        p_paid_revenue_commission_ids:  payload.paid_revenue_commission_ids,
        p_other_payment_ids:            otherToMark.length > 0 ? otherToMark : [],
      });

      if (rpcErr) {
        console.error('Settlement RPC error:', rpcErr);
        throw new Error(rpcErr.message);
      }
      
      await loadData(); 
      setShowSettlementModal(false); 
    } catch (err: any) { 
      console.error(err);
      alert(`Save failed: ${err.message || 'Unknown error'}`); 
    } finally {
      setSavingPayment(false);
    }
  };

  const handleSaveOther = async () => {
    if (!otherFormData.recipient_id || !otherFormData.amount) return alert('Fill required fields');
    const member = teamMembers.find(m => m.id === otherFormData.recipient_id);
    try {
      await supabase.from('other_payments').insert({ ...otherFormData, recipient_name: member?.name || 'Unknown', is_paid: false });
      setShowOtherModal(false); loadData();
    } catch (err) { alert('Failed to log adjustment'); }
  };

  const handleDeleteOther = async (id: number) => {
    if (!confirm('Permanently remove this adjustment record?')) return;
    try {
      await db.delete('other_payments', id);
      loadData();
    } catch (err) { alert('Delete failed'); }
  };

  const handleSaveGoalSettlement = async () => {
    if (!selectedGoal || paymentMeta.amount <= 0) return;
    try {
      await supabase.from('production_payments').insert({
        date: paymentMeta.date,
        payment_type: 'savings',
        recipient_id: 0,
        recipient_name: 'Wealth Savings',
        total_amount: paymentMeta.amount,
        payment_method: paymentMeta.method,
        notes: `Goal: ${selectedGoal.name}. Monthly Target Allocation Settlement.`
      });
      setShowGoalModal(false);
      loadData();
    } catch (err) {
      alert('Failed to settle goal allocation.');
    }
  };

  const handleDeletePayment = async (id: number) => {
    if (!confirm('CAUTION: Deleting this payment will revert all associated commissions and adjustments to "Unpaid". Continue?')) return;
    try {
      await supabase.from('other_payments').update({ is_paid: false, settled_in_payment_id: null }).eq('settled_in_payment_id', id);
      await db.delete('production_payments', id);
      loadData();
    } catch (err) { alert('Delete failed'); }
  };

  const generatePDF = () => {
    if (!reportData) return;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    const isDeveloper = reportData.paymentType === 'developer';

    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Reconciliation Audit Statement', 15, 20);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text(isDeveloper ? 'Developer/Designer:' : 'Partner:', 15, 32);
    doc.text('Settlement Date:', pageWidth - 60, 32);
    
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.text(reportData.recipient || 'N/A', 15, 38);
    doc.text(reportData.date, pageWidth - 60, 38);

    doc.setFillColor(248, 250, 252);
    doc.roundedRect(15, 50, pageWidth - 30, isDeveloper ? 50 : 70, 5, 5, 'F');
    
    doc.setFontSize(10);
    doc.setTextColor(148, 163, 184);
    doc.text('EARNINGS SUMMARY', 25, 60);

    const summaryItems = isDeveloper ? [
      { label: 'Total Allocations & Additions:', val: `+${formatCurrency(reportData.otherAdditions)}`, color: [79, 70, 229] },
      { label: 'Net Amount Due:', val: formatCurrency(reportData.netAmountDue), color: [0, 0, 0], bold: true },
      { label: 'Payment Received:', val: `-${formatCurrency(reportData.paymentReceived)}`, color: [225, 29, 72] },
      { label: 'Outstanding Balance:', val: formatCurrency(reportData.outstandingBalance), color: [16, 185, 129], bold: true }
    ] : [
      { label: 'Gross Commissions Earned:', val: formatCurrency(reportData.grossCommissions), color: [0, 0, 0] },
      { label: 'Other Additions (Bonus/Adv):', val: `+${formatCurrency(reportData.otherAdditions)}`, color: [79, 70, 229] },
      { label: 'Less: Production Deduction:', val: `-${formatCurrency(reportData.productionDeduction)}`, color: [225, 29, 72] },
      { label: 'Net Amount Due:', val: formatCurrency(reportData.netAmountDue), color: [0, 0, 0], bold: true },
      { label: 'Payment Received:', val: `-${formatCurrency(reportData.paymentReceived)}`, color: [225, 29, 72] },
      { label: 'Outstanding Balance:', val: formatCurrency(reportData.outstandingBalance), color: [16, 185, 129], bold: true }
    ];

    let yPos = 70;
    summaryItems.forEach(item => {
      doc.setFont('helvetica', item.bold ? 'bold' : 'normal');
      doc.setTextColor(0);
      doc.text(item.label, 25, yPos);
      doc.setTextColor(item.color[0], item.color[1], item.color[2]);
      doc.text(item.val, pageWidth - 25, yPos, { align: 'right' });
      yPos += 8;
    });

    if (!isDeveloper) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(148, 163, 184);
      doc.text('REVENUE COMMISSIONS BREAKDOWN', 15, 135);

      (doc as any).autoTable({
        startY: 140,
        head: [['Client / Stream', 'Date', 'Gross Amount']],
        body: reportData.commissions.map(c => [
          `${c.client}\n${c.stream}\n(Project Value: ${formatCurrency(c.totalSale || 0)})`,
          c.date,
          formatCurrency(c.amount)
        ]),
        theme: 'grid',
        headStyles: { fillColor: [248, 250, 252], textColor: [100, 116, 139], fontSize: 9 },
        columnStyles: { 2: { halign: 'right' } },
        margin: { left: 15, right: 15 }
      });
    }

    if (reportData.others.length > 0) {
      const finalY = isDeveloper ? 115 : ((doc as any).lastAutoTable?.finalY || 140) + 15;
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(148, 163, 184);
      doc.text('OTHER PAYMENTS SETTLED', 15, finalY);

      (doc as any).autoTable({
        startY: finalY + 5,
        head: [['Description', 'Category', 'Date', 'Amount']],
        body: reportData.others.map(o => [
          o.description,
          o.category.toUpperCase(),
          o.date,
          formatCurrency(o.amount)
        ]),
        theme: 'grid',
        headStyles: { fillColor: [248, 250, 252], textColor: [100, 116, 139], fontSize: 9 },
        columnStyles: { 3: { halign: 'right' } },
        margin: { left: 15, right: 15 }
      });
    }

    doc.save(`Audit_${reportData.recipient}_${reportData.date}.pdf`);
  };

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

  const paymentsSummary = useMemo(() => {
    const teamPool = combinedAuditPool.filter(p => p.type === 'team') as any[];
    const partnersOwed = teamPool
      .filter(p => p.member.role === 'Partner')
      .reduce((s: number, p: any) => s + p.totalOwed, 0);
    const teamOwed = teamPool
      .filter(p => p.member.role !== 'Partner')
      .reduce((s: number, p: any) => s + p.totalOwed, 0);

    const inRange = (date: string) =>
      (!globalStart || date >= globalStart) && (!globalEnd || date <= globalEnd);

    const partnersSettled = payments
      .filter(p => p.payment_type === 'partner' && inRange(p.date))
      .reduce((s, p) => s + Number(p.total_amount), 0);
    const teamSettled = payments
      .filter(p => p.payment_type === 'developer' && inRange(p.date))
      .reduce((s, p) => s + Number(p.total_amount), 0);

    return { partnersOwed, teamOwed, partnersSettled, teamSettled };
  }, [combinedAuditPool, payments, globalStart, globalEnd]);

  return (
    <div className="space-y-12 pb-32 animate-in fade-in">
      {/* Summary Card */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">
            Total Outstanding
          </p>
          <p className="text-3xl font-black text-gray-900 mb-4">
            {formatCurrency(paymentsSummary.partnersOwed + paymentsSummary.teamOwed)}
          </p>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Partners</span>
              <span className="font-bold text-gray-700">{formatCurrency(paymentsSummary.partnersOwed)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Team production</span>
              <span className="font-bold text-gray-700">{formatCurrency(paymentsSummary.teamOwed)}</span>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">
            Total Settled This Period
          </p>
          <p className="text-3xl font-black text-emerald-600 mb-4">
            {formatCurrency(paymentsSummary.partnersSettled + paymentsSummary.teamSettled)}
          </p>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Partners</span>
              <span className="font-bold text-emerald-600">{formatCurrency(paymentsSummary.partnersSettled)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Team production</span>
              <span className="font-bold text-emerald-600">{formatCurrency(paymentsSummary.teamSettled)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-extrabold text-gray-900 tracking-tight">Authorization Panel</h2>
          <p className="text-gray-500 font-medium text-sm">Verify audits and release funds for team payables and wealth goals.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setOtherFormData({ date: new Date().toISOString().split('T')[0], category: 'deduction', amount: 0, description: '', recipient_id: undefined, recipient_type: 'team' });
              setShowOtherModal(true);
            }}
            className="flex items-center gap-2 bg-rose-600 text-white px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-lg active:scale-95 transition-all"
          >
            <Minus size={16} /> Log Deduction
          </button>
          <button
            onClick={() => {
              setOtherFormData({ date: new Date().toISOString().split('T')[0], category: 'bonus', amount: 0, description: '', recipient_id: undefined, recipient_type: 'team' });
              setShowOtherModal(true);
            }}
            className="flex items-center gap-2 bg-gray-900 text-white px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-lg active:scale-95 transition-all"
          >
            <Plus size={16} /> Log Adjustment
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {combinedAuditPool.map((status, idx) => (
          <div key={idx} className={`bg-white rounded-[32px] border ${status.type === 'goal' ? 'border-indigo-100' : 'border-gray-100'} p-6 shadow-sm hover:shadow-lg transition-all group relative overflow-hidden`}>
            {status.type === 'goal' && (
              <div className="absolute top-4 right-4 text-indigo-100 rotate-12 group-hover:rotate-0 transition-transform">
                <Target size={40} strokeWidth={1.5} />
              </div>
            )}
            <div className="flex items-center gap-4 mb-6">
              <div className={`w-12 h-12 ${status.type === 'goal' ? 'bg-indigo-600 text-white' : 'bg-gray-900 text-white'} rounded-2xl flex items-center justify-center font-black text-lg`}>
                {status.type === 'goal' ? <PiggyBank size={24} /> : status.member.name.charAt(0)}
              </div>
              <div>
                <h4 className="font-extrabold text-gray-900">{status.type === 'goal' ? status.goal.name : status.member.name}</h4>
                <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{status.type === 'goal' ? 'Savings Target' : status.member.role}</p>
              </div>
            </div>
            <div className={`rounded-2xl p-5 mb-6 flex flex-col items-center border ${status.type === 'goal' ? 'bg-indigo-50 border-indigo-100' : 'bg-gray-50 border-gray-100'}`}>
              <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">
                Pending {status.type === 'goal' ? 'Allocation' : 'Balance'}
              </span>
              <span className={`text-3xl font-black tracking-tighter ${status.type === 'goal' ? 'text-indigo-600' : 'text-gray-900'}`}>{formatCurrency(status.totalOwed)}</span>
            </div>
            <button 
              onClick={() => { 
                if (status.type === 'team') {
                  setSelectedMember(status.member); 
                  setSelectedRevenueKeys(status.unpaidCommissions.map((c: any) => c.key)); 
                  setSelectedOtherIds(status.unpaidOthers.map((o: any) => o.id)); 
                  setSelectedAllocIds(status.unpaidAllocs.map((a: any) => a.id));
                  setShowSettlementModal(true); 
                } else {
                  setSelectedGoal(status.goal);
                  setPaymentMeta({ ...paymentMeta, amount: status.totalOwed });
                  setShowGoalModal(true);
                }
              }} 
              className={`w-full py-3.5 ${status.type === 'goal' ? 'bg-indigo-600' : 'bg-gray-900'} text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-sm`}
            >
              <ArrowUpCircle size={16} /> Review & {status.type === 'goal' ? 'Settle Savings' : 'Pay Member'}
            </button>
          </div>
        ))}
      </div>

      {showSettlementModal && selectedMember && (
        <Modal 
          title="Reconciliation Audit Statement" 
          isOpen={showSettlementModal} 
          onClose={() => setShowSettlementModal(false)} 
          onSave={handleSaveSettlement} 
          saveLabel={savingPayment ? "Recording..." : "Authorize & Release"} 
          maxWidth="max-w-2xl"
        >
          {/* ... (Existing Modal Content Remains Same) ... */}
          <div className="space-y-6">
            {(combinedAuditPool.find(p => p.type === 'team' && p.member.id === selectedMember.id) as any)?.unpaidCommissions.length > 0 && (
              <div className="space-y-3">
                <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Unpaid Revenue Shares</h5>
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1 scrollbar-hide">
                  {(combinedAuditPool.find(p => p.type === 'team' && p.member.id === selectedMember.id) as any)?.unpaidCommissions.map((c: any) => (
                    <label key={c.key} className={`block px-4 py-3 rounded-xl border transition-all cursor-pointer ${selectedRevenueKeys.includes(c.key) ? 'bg-indigo-50/50 border-indigo-100 shadow-sm' : 'bg-gray-50 border-transparent hover:border-gray-200'}`}>
                      <div className="flex items-start gap-3">
                        <input type="checkbox" checked={selectedRevenueKeys.includes(c.key)} onChange={() => {
                          if (selectedRevenueKeys.includes(c.key)) setSelectedRevenueKeys(selectedRevenueKeys.filter(k => k !== c.key));
                          else setSelectedRevenueKeys([...selectedRevenueKeys, c.key]);
                        }} className="w-4 h-4 mt-1 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 shrink-0" />
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start mb-1">
                            {c.linkedProjects && c.linkedProjects.length > 0 ? (
                              <span className="text-sm font-black text-indigo-600 flex items-center gap-1.5">
                                <Briefcase size={14} className="text-indigo-500" />
                                {c.linkedProjects.map((p: Project) => p.project_name).join(', ')}
                              </span>
                            ) : (
                              <span className="text-xs font-bold text-gray-400 flex items-center gap-1.5 italic">
                                <AlertCircle size={12} />
                                No Linked Project
                              </span>
                            )}
                            <span className="text-sm font-black text-indigo-600">{formatCurrency(c.grossShareValue)}</span>
                          </div>
                          
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-bold text-gray-900">{c.client}</span>
                            <span className="font-medium text-gray-500">Gross: {formatCurrency(c.totalSale || 0)}</span>
                          </div>
                          
                          <div className="flex justify-between items-center mt-1">
                            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wide">{c.stream} • {c.date}</span>
                          </div>

                          {c.description && (
                            <p className="text-[10px] text-gray-400 mt-1 line-clamp-1 border-t border-dashed border-gray-200 pt-1">{c.description}</p>
                          )}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
            
            {/* ... Other sections (Allocs/Others/Summary) remain same ... */}
            {(combinedAuditPool.find(p => p.type === 'team' && p.member.id === selectedMember.id) as any)?.unpaidAllocs.length > 0 && (
              <div className="space-y-3">
                <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Unpaid Project Allocations</h5>
                <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1 scrollbar-hide">
                  {(combinedAuditPool.find(p => p.type === 'team' && p.member.id === selectedMember.id) as any)?.unpaidAllocs.map((a: any) => (
                    <div key={a.id} className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${selectedAllocIds.includes(a.id) ? 'bg-indigo-50/50 border-indigo-100 shadow-sm' : 'bg-gray-50 border-transparent hover:border-gray-200'}`}>
                      <label className="flex items-center gap-3 cursor-pointer flex-1">
                        <input type="checkbox" checked={selectedAllocIds.includes(a.id)} onChange={() => {
                          if (selectedAllocIds.includes(a.id)) setSelectedAllocIds(selectedAllocIds.filter(i => i !== a.id));
                          else setSelectedAllocIds([...selectedAllocIds, a.id]);
                        }} className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                        <div>
                          <span className="text-xs font-bold text-gray-900 block">{a.description}</span>
                          <span className="text-[9px] text-gray-400 font-bold uppercase">{a.date} • {a.category}</span>
                        </div>
                      </label>
                      <div className="flex items-center gap-4">
                        <span className="text-xs font-black text-gray-900">{formatCurrency(a.amount)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(() => {
              const pool = combinedAuditPool.find(p => p.type === 'team' && p.member.id === selectedMember.id) as any;
              const additions = pool?.unpaidOthers.filter((o: any) => o.category !== 'deduction') || [];
              const deductions = pool?.unpaidOthers.filter((o: any) => o.category === 'deduction') || [];
              return (
                <>
                  {additions.length > 0 && (
                    <div className="space-y-3">
                      <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Other Outstanding (Bonus/Adv)</h5>
                      <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1 scrollbar-hide">
                        {additions.map((o: any) => (
                          <div key={o.id} className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${selectedOtherIds.includes(o.id) ? 'bg-indigo-50/50 border-indigo-100 shadow-sm' : 'bg-gray-50 border-transparent hover:border-gray-200'}`}>
                            <label className="flex items-center gap-3 cursor-pointer flex-1">
                              <input type="checkbox" checked={selectedOtherIds.includes(o.id)} onChange={() => {
                                if (selectedOtherIds.includes(o.id)) setSelectedOtherIds(selectedOtherIds.filter(i => i !== o.id));
                                else setSelectedOtherIds([...selectedOtherIds, o.id]);
                              }} className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                              <div>
                                <span className="text-xs font-bold text-gray-900 block">{o.description}</span>
                                <span className="text-[9px] text-gray-400 font-bold uppercase">{o.date} • {o.category}</span>
                              </div>
                            </label>
                            <div className="flex items-center gap-4">
                              <span className="text-xs font-black text-gray-900">{formatCurrency(o.amount)}</span>
                              <button onClick={() => handleDeleteOther(o.id)} className="p-1 text-rose-300 hover:text-rose-500 transition-colors"><Trash2 size={14} /></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {deductions.length > 0 && (
                    <div className="space-y-3">
                      <h5 className="text-[10px] font-black text-rose-400 uppercase tracking-widest px-1">Pending Deductions</h5>
                      <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1 scrollbar-hide">
                        {deductions.map((o: any) => (
                          <div key={o.id} className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${selectedOtherIds.includes(o.id) ? 'bg-rose-50 border-rose-200 shadow-sm' : 'bg-rose-50/40 border-rose-100 hover:border-rose-200'}`}>
                            <label className="flex items-center gap-3 cursor-pointer flex-1">
                              <input type="checkbox" checked={selectedOtherIds.includes(o.id)} onChange={() => {
                                if (selectedOtherIds.includes(o.id)) setSelectedOtherIds(selectedOtherIds.filter(i => i !== o.id));
                                else setSelectedOtherIds([...selectedOtherIds, o.id]);
                              }} className="w-4 h-4 rounded border-rose-300 text-rose-600 focus:ring-rose-500" />
                              <div>
                                <span className="text-xs font-bold text-rose-800 block">{o.description}</span>
                                <span className="text-[9px] text-rose-400 font-bold uppercase">{o.date} • Deduction</span>
                              </div>
                            </label>
                            <div className="flex items-center gap-4">
                              <span className="text-xs font-black text-rose-600">-{formatCurrency(o.amount)}</span>
                              <button onClick={() => handleDeleteOther(o.id)} className="p-1 text-rose-300 hover:text-rose-500 transition-colors"><Trash2 size={14} /></button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            <div className="bg-slate-50 rounded-[32px] p-8 border border-gray-100 space-y-4">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center text-gray-500"><span>Gross Commissions:</span><span className="text-gray-900 font-bold">{formatCurrency(auditCalculation.revShareGross)}</span></div>
                <div className="flex justify-between items-center text-gray-500"><span>Allocations & Extras:</span><span className="text-gray-900 font-bold">{formatCurrency(auditCalculation.otherAdditions)}</span></div>
                
                {auditCalculation.deductionItems.length > 0 && (
                  <div className="pt-2 space-y-1">
                    <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest">Deducted Overheads</p>
                    {auditCalculation.deductionItems.map((item, i) => (
                      <div key={i} className="flex justify-between items-center text-rose-500 font-medium italic text-xs">
                        <span>• {item.label} ({item.type})</span>
                        <span className="font-bold">-{formatCurrency(item.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {auditCalculation.manualDeductions > 0 && (
                  <div className="pt-2 space-y-1">
                    <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest">Manual Deductions</p>
                    <div className="flex justify-between items-center text-rose-500 font-medium italic text-xs">
                      <span>• Selected deduction items</span>
                      <span className="font-bold">-{formatCurrency(auditCalculation.manualDeductions)}</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="pt-6 border-t border-dashed border-gray-300 flex justify-between items-center">
                <span className="text-xl font-black text-indigo-900">Total Settlement:</span>
                <span className="text-3xl font-black text-indigo-600 tracking-tighter">{formatCurrency(auditCalculation.payable)}</span>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {showReportModal && reportData && (
        <Modal title="Reconciliation Audit Statement" isOpen={showReportModal} onClose={() => setShowReportModal(false)} showSaveButton={false} maxWidth="max-w-3xl">
          <div className="space-y-8 animate-in slide-in-from-bottom-2 duration-300">
            <div className="flex justify-between items-start">
              <div className="space-y-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{reportData.paymentType === 'developer' ? 'Developer/Designer' : 'Partner'}</p>
                <h3 className="text-xl font-black text-slate-900">{reportData.recipient}</h3>
              </div>
              <div className="text-right space-y-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Settlement Date</p>
                <h3 className="text-xl font-black text-slate-900">{reportData.date}</h3>
              </div>
            </div>

            <div className="bg-slate-50 rounded-[32px] p-8 border border-slate-100">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">Earnings Summary</h4>
              {reportData.paymentType === 'developer' ? (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-indigo-600">Total Allocations & Additions:</span>
                    <span className="text-sm font-black text-indigo-600">+{formatCurrency(reportData.otherAdditions)}</span>
                  </div>
                  <div className="pt-4 border-t border-slate-200 flex justify-between items-center">
                    <span className="text-base font-black text-slate-900">Net Amount Due:</span>
                    <span className="text-base font-black text-slate-900">{formatCurrency(reportData.netAmountDue)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-black text-rose-600">Payment Received:</span>
                    <span className="text-sm font-black text-rose-600">-{formatCurrency(reportData.paymentReceived)}</span>
                  </div>
                  <div className="pt-6 border-t border-dashed border-slate-200 flex justify-between items-center">
                    <span className="text-xl font-black text-slate-900">Outstanding Balance:</span>
                    <div className="text-right">
                      <span className="text-2xl font-black text-emerald-500 tracking-tighter">{formatCurrency(reportData.outstandingBalance)}</span>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">Fully Settled</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-slate-600">Gross Commissions Earned:</span>
                    <span className="text-sm font-black text-slate-900">{formatCurrency(reportData.grossCommissions)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-indigo-600">Other Additions (Bonus/Adv):</span>
                    <span className="text-sm font-black text-indigo-600">+{formatCurrency(reportData.otherAdditions)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-rose-500 italic">Less: Production Deduction:</span>
                    <span className="text-sm font-black text-rose-500">-{formatCurrency(reportData.productionDeduction)}</span>
                  </div>
                  <div className="pt-4 border-t border-slate-200 flex justify-between items-center">
                    <span className="text-base font-black text-slate-900">Net Amount Due:</span>
                    <span className="text-base font-black text-slate-900">{formatCurrency(reportData.netAmountDue)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-black text-rose-600">Payment Received:</span>
                    <span className="text-sm font-black text-rose-600">-{formatCurrency(reportData.paymentReceived)}</span>
                  </div>
                  <div className="pt-6 border-t border-dashed border-slate-200 flex justify-between items-center">
                    <span className="text-xl font-black text-slate-900">Outstanding Balance:</span>
                    <div className="text-right">
                      <span className="text-2xl font-black text-emerald-500 tracking-tighter">{formatCurrency(reportData.outstandingBalance)}</span>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">Fully Settled</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {reportData.paymentType !== 'developer' && (
              <div className="space-y-4">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <FileText size={14} className="text-slate-300" /> Revenue Commissions Breakdown
                </h4>
                <div className="border border-slate-100 rounded-3xl overflow-hidden">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                      <tr><th className="px-6 py-4">Client / Stream</th><th className="px-6 py-4 text-right">Gross Share</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {reportData.commissions.map((c, i) => (
                        <tr key={i} className="hover:bg-slate-50/30">
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="text-sm font-black text-slate-900">{c.client}</span>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] font-bold text-slate-400 uppercase">{c.stream} • {c.date}</span>
                                <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[9px] font-bold">Proj: {formatCurrency(c.totalSale || 0)}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right font-black text-slate-900 text-sm">{formatCurrency(c.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {reportData.others.length > 0 && (
              <div className="space-y-4">
                <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest flex items-center gap-2">
                  <Plus size={14} className="text-indigo-300" /> Other Payments Settled (Bonuses/Advances)
                </h4>
                <div className="space-y-3">
                  {reportData.others.map((o, i) => (
                    <div key={i} className="flex justify-between items-center p-6 bg-indigo-50/30 rounded-3xl border border-indigo-50">
                      <div>
                        <span className="text-sm font-black text-indigo-900 block">{o.description}</span>
                        <span className="text-[10px] font-bold text-indigo-400 uppercase">{o.date} • {o.category}</span>
                      </div>
                      <span className="text-base font-black text-indigo-600">+{formatCurrency(o.amount)}</span>
                    </div>
                  ))}
                  <div className="p-4 flex justify-between items-center border-t border-indigo-100">
                    <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Total Other Additions</span>
                    <span className="text-lg font-black text-indigo-600">{formatCurrency(reportData.otherAdditions)}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="pt-6 flex gap-4 no-print">
              <button 
                onClick={generatePDF}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-indigo-200 transition-all flex items-center justify-center gap-3 active:scale-95"
              >
                <Download size={18} /> Export PDF
              </button>
              <button 
                onClick={() => setShowReportModal(false)}
                className="px-8 bg-slate-100 hover:bg-slate-200 text-slate-600 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ... (Other Modals and Layout remain same) ... */}
      {showOtherModal && (
        <Modal
          title={otherFormData.category === 'deduction' ? 'Log Deduction' : 'Record Other Payment Item'}
          isOpen={showOtherModal}
          onClose={() => setShowOtherModal(false)}
          onSave={handleSaveOther}
          saveLabel="Save"
        >
          <div className="space-y-6">
            {otherFormData.category === 'deduction' && (
              <div className="px-4 py-3 bg-rose-50 border border-rose-100 rounded-xl text-xs font-bold text-rose-600">
                This amount will be subtracted from the member's next settlement total.
              </div>
            )}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Recipient</label>
              <SearchableSelect
                options={teamMembers.map(m => ({ value: m.id, label: `${m.name} (${m.role})` }))}
                value={otherFormData.recipient_id}
                onChange={val => setOtherFormData({...otherFormData, recipient_id: val})}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Amount ($)</label>
                <input type="number" step="0.01" value={otherFormData.amount} onChange={e => setOtherFormData({...otherFormData, amount: parseFloat(e.target.value)})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl text-sm font-black outline-none" placeholder="0.00" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Date</label>
                <input type="date" value={otherFormData.date} onChange={e => setOtherFormData({...otherFormData, date: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl text-sm font-bold outline-none" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Description</label>
              <input type="text" value={otherFormData.description} onChange={e => setOtherFormData({...otherFormData, description: e.target.value})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl text-sm font-bold outline-none" placeholder={otherFormData.category === 'deduction' ? 'e.g., Tax deduction, Connects fee...' : 'e.g., Performance Bonus, Advance...'} />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Category</label>
              <select value={otherFormData.category} onChange={e => setOtherFormData({...otherFormData, category: e.target.value as any})} className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl text-sm font-bold outline-none bg-white">
                <option value="bonus">Bonus</option>
                <option value="advance">Advance</option>
                <option value="refund">Refund</option>
                <option value="deduction">Deduction</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
        </Modal>
      )}

      {showGoalModal && selectedGoal && (
        <Modal title="Goal Allocation Settlement" isOpen={showGoalModal} onClose={() => setShowGoalModal(false)} onSave={handleSaveGoalSettlement} saveLabel="Settle Savings" maxWidth="max-w-md">
          <div className="space-y-6">
            <div className="p-6 bg-indigo-50 border border-indigo-100 rounded-[28px] flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center text-indigo-600 shadow-sm mb-4"><Target size={32} /></div>
              <h4 className="text-lg font-black text-gray-900">{selectedGoal.name}</h4>
              <p className="text-xs text-gray-500 font-medium mt-1 uppercase tracking-widest">Settle Monthly Allocation</p>
            </div>
            
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">Settlement Amount ($)</label>
              <input 
                type="number" 
                value={paymentMeta.amount} 
                onChange={e => setPaymentMeta({...paymentMeta, amount: parseFloat(e.target.value)})}
                className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl text-2xl font-black text-indigo-600 outline-none focus:ring-2 focus:ring-indigo-100" 
              />
            </div>
          </div>
        </Modal>
      )}

      <div className="bg-white border border-gray-100 rounded-[32px] shadow-sm overflow-hidden">
        <header className="px-8 py-5 border-b border-gray-50 flex items-center justify-between bg-gray-50/20">
          <div className="flex items-center gap-3">
            <History size={18} className="text-gray-400" />
            <h3 className="font-black text-base text-gray-900 uppercase tracking-widest">Disbursement Logs</h3>
          </div>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-gray-50/50 text-gray-400 text-[9px] font-black uppercase tracking-widest border-b border-gray-100">
              <tr><th className="px-8 py-4">Date</th><th className="px-8 py-4">Recipient</th><th className="px-8 py-4">Type</th><th className="px-8 py-4 text-right">Settled Amount</th><th className="px-8 py-4 text-center">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {payments.filter(p => (!globalStart || p.date >= globalStart) && (!globalEnd || p.date <= globalEnd)).sort((a,b) => b.date.localeCompare(a.date)).map(p => (
                <tr key={p.id} className="hover:bg-gray-50/30 transition-all group">
                  <td className="px-8 py-5 text-[11px] font-bold text-gray-400">{p.date}</td>
                  <td className="px-8 py-5 font-black text-gray-900 text-xs">{p.recipient_name}</td>
                  <td className="px-8 py-5 text-[10px] font-black text-gray-400 uppercase tracking-widest">{p.payment_type}</td>
                  <td className="px-8 py-5 text-right font-black text-indigo-600 text-sm">{formatCurrency(p.total_amount)}</td>
                  <td className="px-8 py-5 text-center">
                    <div className="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                      <button 
                        onClick={() => { setViewingPayment(p); setShowReportModal(true); }}
                        className="p-2 text-indigo-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                      >
                        <Eye size={16} />
                      </button>
                      <button onClick={() => handleDeletePayment(p.id)} className="p-2 text-rose-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default PaymentsView;
