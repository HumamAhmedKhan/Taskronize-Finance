import React, { useMemo } from 'react';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { Download, FileText, Plus } from 'lucide-react';
import Modal from './Modal';
import { ProductionPayment, Revenue, IncomeStream, OtherPayment, Expense, Project, ProjectAllocation } from '../types';
import { calculateRevenueDetails, extractPaidIds, getConnectsMonthly } from '../utils/calculations';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  payment: ProductionPayment;
  revenues: Revenue[];
  incomeStreams: IncomeStream[];
  expenses: Expense[];
  otherPayments: OtherPayment[];
  payments: ProductionPayment[];
  projects: Project[];
  allocations: ProjectAllocation[];
  projectRevenueLinks: any[];
}

const SettlementDetailModal: React.FC<Props> = ({
  isOpen, onClose, payment,
  revenues, incomeStreams, expenses, otherPayments, payments, projects, allocations, projectRevenueLinks
}) => {
  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

  const reportData = useMemo(() => {
    const settledOthers = otherPayments.filter(o => o.settled_in_payment_id === payment.id);
    const settledAllocs: any[] = [];
    const commBreakdown: any[] = [];
    let grossCommissions = 0;
    let connectsTotal = 0;
    let prodTotal = 0;
    const processedConnects = new Set<string>();
    const processedProjects = new Set<number>();
    const processedProdManual = new Set<string>();
    const deductionItems: { label: string; amount: number }[] = [];

    const priorPayments = payments.filter(
      p => p.id !== payment.id && Number(p.recipient_id) === Number(payment.recipient_id)
    );
    const rdSettledConnects = new Set<string>();
    const rdSettledProdManual = new Set<string>();
    const rdSettledProdProjects = new Set<number>();
    const rdChargedPeriods = new Set<string>();
    priorPayments.forEach(p => {
      extractPaidIds(p).forEach(id => {
        if (id.startsWith('CONNECTS_')) { rdSettledConnects.add(id.slice(9)); return; }
        if (id.startsWith('PRODMANUAL_')) { rdSettledProdManual.add(id.slice(11)); return; }
        if (id.startsWith('PRODPROJECT_')) { rdSettledProdProjects.add(Number(id.slice(12))); return; }
        if (id.startsWith('ALLOC_')) return;
        const dashIdx = id.indexOf('-');
        if (dashIdx === -1) return;
        const prevRev = revenues.find(r => String(r.id) === id.slice(0, dashIdx));
        if (prevRev) rdChargedPeriods.add(`${prevRev.income_stream_id}-${prevRev.date.substring(0, 7)}`);
      });
    });

    if (payment.paid_revenue_commission_ids) {
      payment.paid_revenue_commission_ids.forEach(key => {
        if (key.startsWith('CONNECTS_') || key.startsWith('PRODMANUAL_') || key.startsWith('PRODPROJECT_')) return;
        if (key.startsWith('ALLOC_')) {
          const allocId = Number(key.split('_')[1]);
          const alloc = allocations.find(a => a.id === allocId);
          if (alloc) {
            const project = projects.find(p => p.id === alloc.project_id);
            settledAllocs.push({
              description: `Project: ${project?.project_name || 'Unknown'}`,
              date: alloc.created_at ? alloc.created_at.split('T')[0] : payment.date,
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
              const grossAmt = details.grossCommissions[memberName] || 0;
              grossCommissions += grossAmt;
              commBreakdown.push({
                client: rev.client_name,
                stream: stream.name,
                date: rev.date,
                amount: grossAmt,
                totalSale: rev.total_sale
              });

              const periodKey = `${rev.income_stream_id}-${rev.date.substring(0, 7)}`;
              const rule = stream.commission_structure?.find((r: any) => r.name === memberName);

              if (rule?.deductConnects && !processedConnects.has(periodKey) && !rdSettledConnects.has(periodKey) && !rdChargedPeriods.has(periodKey)) {
                const ym = rev.date.substring(0, 7);
                const connectsMonthly = getConnectsMonthly(expenses, Number(rev.income_stream_id), `${ym}-01`, `${ym}-31`);
                const share = connectsMonthly * (Number(rule.value) / 100);
                if (share > 0) {
                  connectsTotal += share;
                  deductionItems.push({ label: `${stream.name} — ${ym} (Connects)`, amount: share });
                  processedConnects.add(periodKey);
                }
              }

              if (rule?.deductProduction) {
                const linkedProjectIds = projectRevenueLinks
                  .filter(link => String(link.revenue_id) === String(rev.id))
                  .map(link => Number(link.project_id));

                linkedProjectIds.forEach(pId => {
                  if (!processedProjects.has(pId) && !rdSettledProdProjects.has(pId)) {
                    const proj = projects.find(p => p.id === pId);
                    const projAllocTotal = allocations
                      .filter(a => a.project_id === pId)
                      .reduce((s, a) => s + Number(a.amount), 0);
                    const share = projAllocTotal * (Number(rule.value) / 100);
                    if (share > 0) {
                      prodTotal += share;
                      deductionItems.push({ label: `Project: ${proj?.project_name || 'Unknown'} (Production)`, amount: share });
                      processedProjects.add(pId);
                    }
                  }
                });

                if (!processedProdManual.has(periodKey) && !rdSettledProdManual.has(periodKey) && !rdChargedPeriods.has(periodKey)) {
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
                    deductionItems.push({ label: `${stream.name} — ${rev.date.substring(0, 7)} (Production)`, amount: share });
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
        category: o.category as string,
        amount: o.amount
      })),
      ...settledAllocs
    ];

    const otherAdditions = combinedOthers.reduce((s, o) => s + (o.category === 'deduction' ? 0 : Number(o.amount)), 0);
    const manualDeductions = combinedOthers.reduce((s, o) => s + (o.category === 'deduction' ? Number(o.amount) : 0), 0);
    const productionDeduction = connectsTotal + prodTotal;
    const netAmountDue = grossCommissions + otherAdditions - productionDeduction - manualDeductions;

    return {
      recipient: payment.recipient_name,
      date: payment.date,
      paymentType: payment.payment_type,
      grossCommissions,
      otherAdditions,
      productionDeduction,
      deductionItems,
      netAmountDue,
      paymentReceived: payment.total_amount,
      outstandingBalance: netAmountDue - payment.total_amount,
      commissions: commBreakdown,
      others: combinedOthers
    };
  }, [payment, revenues, incomeStreams, otherPayments, expenses, payments, projects, allocations, projectRevenueLinks]);

  const generatePDF = () => {
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

    const partnerDeductionLines: { label: string; val: string; color: number[]; bold?: boolean; small?: boolean; headerOnly?: boolean }[] =
      reportData.deductionItems.length > 0
        ? [
            { label: 'DEDUCTED OVERHEADS', val: '', color: [225, 29, 72], headerOnly: true },
            ...reportData.deductionItems.map(d => ({ label: `  • ${d.label}`, val: `-${formatCurrency(d.amount)}`, color: [225, 29, 72], small: true })),
            { label: 'Total Deductions:', val: `-${formatCurrency(reportData.productionDeduction)}`, color: [225, 29, 72], bold: true }
          ]
        : reportData.productionDeduction > 0
          ? [{ label: 'Less: Production Deduction:', val: `-${formatCurrency(reportData.productionDeduction)}`, color: [225, 29, 72] }]
          : [];

    const partnerItems = [
      { label: 'Gross Commissions Earned:', val: formatCurrency(reportData.grossCommissions), color: [0, 0, 0] },
      { label: 'Other Additions (Bonus/Adv):', val: `+${formatCurrency(reportData.otherAdditions)}`, color: [79, 70, 229] },
      ...partnerDeductionLines,
      { label: 'Net Amount Due:', val: formatCurrency(reportData.netAmountDue), color: [0, 0, 0], bold: true },
      { label: 'Payment Received:', val: `-${formatCurrency(reportData.paymentReceived)}`, color: [225, 29, 72] },
      { label: 'Outstanding Balance:', val: formatCurrency(reportData.outstandingBalance), color: [16, 185, 129], bold: true }
    ];

    const devItems = [
      { label: 'Total Allocations & Additions:', val: `+${formatCurrency(reportData.otherAdditions)}`, color: [79, 70, 229] },
      { label: 'Net Amount Due:', val: formatCurrency(reportData.netAmountDue), color: [0, 0, 0], bold: true },
      { label: 'Payment Received:', val: `-${formatCurrency(reportData.paymentReceived)}`, color: [225, 29, 72] },
      { label: 'Outstanding Balance:', val: formatCurrency(reportData.outstandingBalance), color: [16, 185, 129], bold: true }
    ];

    const summaryItems = isDeveloper ? devItems : partnerItems;
    const boxHeight = 20 + summaryItems.length * 8 + 8;

    doc.setFillColor(248, 250, 252);
    doc.roundedRect(15, 50, pageWidth - 30, boxHeight, 5, 5, 'F');
    doc.setFontSize(10);
    doc.setTextColor(148, 163, 184);
    doc.text('EARNINGS SUMMARY', 25, 60);

    let yPos = 70;
    summaryItems.forEach((item: any) => {
      if (item.headerOnly) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(item.color[0], item.color[1], item.color[2]);
        doc.text(item.label, 25, yPos);
        doc.setFontSize(10);
      } else {
        doc.setFontSize(item.small ? 9 : 10);
        doc.setFont('helvetica', item.bold ? 'bold' : 'normal');
        doc.setTextColor(0);
        doc.text(item.label, 25, yPos);
        doc.setTextColor(item.color[0], item.color[1], item.color[2]);
        doc.text(item.val, pageWidth - 25, yPos, { align: 'right' });
        doc.setFontSize(10);
      }
      yPos += 8;
    });

    if (!isDeveloper && reportData.commissions.length > 0) {
      const breakdownY = yPos + 10;
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(148, 163, 184);
      doc.text('REVENUE COMMISSIONS BREAKDOWN', 15, breakdownY);
      (doc as any).autoTable({
        startY: breakdownY + 5,
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
          String(o.category).toUpperCase(),
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

  return (
    <Modal title="Reconciliation Audit Statement" isOpen={isOpen} onClose={onClose} showSaveButton={false} maxWidth="max-w-3xl">
      <div className="space-y-8 animate-in slide-in-from-bottom-2 duration-300">
        <div className="flex justify-between items-start">
          <div className="space-y-1">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              {reportData.paymentType === 'developer' ? 'Developer/Designer' : 'Partner'}
            </p>
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
              {reportData.otherAdditions > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-indigo-600">Other Additions (Bonus/Adv):</span>
                  <span className="text-sm font-black text-indigo-600">+{formatCurrency(reportData.otherAdditions)}</span>
                </div>
              )}
              {reportData.deductionItems.length > 0 ? (
                <div className="space-y-1.5 py-1">
                  <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest">Deducted Overheads</p>
                  {reportData.deductionItems.map((d, i) => (
                    <div key={i} className="flex justify-between items-center text-xs pl-2">
                      <span className="text-rose-500 italic">• {d.label}</span>
                      <span className="font-black text-rose-500">-{formatCurrency(d.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between items-center text-sm pt-1.5 border-t border-rose-100">
                    <span className="font-medium text-rose-500">Total Deductions:</span>
                    <span className="font-black text-rose-500">-{formatCurrency(reportData.productionDeduction)}</span>
                  </div>
                </div>
              ) : reportData.productionDeduction > 0 ? (
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-rose-500 italic">Less: Production Deduction:</span>
                  <span className="text-sm font-black text-rose-500">-{formatCurrency(reportData.productionDeduction)}</span>
                </div>
              ) : null}
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

        {reportData.paymentType !== 'developer' && reportData.commissions.length > 0 && (
          <div className="space-y-4">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <FileText size={14} className="text-slate-300" /> Revenue Commissions Breakdown
            </h4>
            <div className="border border-slate-100 rounded-3xl overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-4">Client / Stream</th>
                    <th className="px-6 py-4 text-right">Gross Share</th>
                  </tr>
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
            onClick={onClose}
            className="px-8 bg-slate-100 hover:bg-slate-200 text-slate-600 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default SettlementDetailModal;
