import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { 
  Download, 
  Upload, 
  Loader2, 
  Database, 
  DollarSign, 
  Briefcase, 
  CreditCard, 
  FileText, 
  Calendar, 
  Users,
  CheckCircle2,
  AlertCircle,
  HardDrive
} from 'lucide-react';

const BackupView: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({
    revenues: 0,
    projects: 0,
    expenses: 0,
    production_payments: 0,
    other_payments: 0,
    team_members: 0
  });

  const fetchCounts = async () => {
    try {
      const tables = ['revenues', 'projects', 'expenses', 'production_payments', 'other_payments', 'team_members'];
      const newCounts: Record<string, number> = {};
      
      for (const table of tables) {
        const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
        if (!error) {
          newCounts[table] = count || 0;
        }
      }
      setCounts(newCounts);
    } catch (err) {
      console.error('Error fetching table counts:', err);
    }
  };

  useEffect(() => {
    fetchCounts();
  }, []);

  const handleExportFullJSON = async () => {
    setLoading(true);
    setMsg('Collecting all data from Supabase...');
    setSuccess(false);
    try {
      const tables = [
        'users', 'team_members', 'income_streams', 'revenues', 
        'projects', 'project_allocations', 'expenses', 
        'production_payments', 'payment_project_rows', 'other_payments',
        'recurring_expenses', 'project_revenue_links'
      ];
      
      const data: any = {};
      for (const table of tables) {
        const { data: tableData, error } = await supabase.from(table).select('*');
        if (error) throw error;
        data[table] = tableData || [];
      }
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `taskronize_full_backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      setMsg('Full System Export successful!');
      setSuccess(true);
    } catch (err: any) {
      setMsg(`Export failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = async (table: string, fileName: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from(table).select('*');
      if (error) throw error;
      if (!data || data.length === 0) {
        alert('No data to export for this module.');
        return;
      }
      
      const headers = Object.keys(data[0]);
      const csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(h => {
          const val = row[h];
          if (val === null || val === undefined) return '""';
          return `"${String(val).replace(/"/g, '""')}"`;
        }).join(','))
      ].join('\n');
      
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
    } catch (err: any) {
      console.error(err);
      alert(`CSV Export failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show confirmation modal instead of confirm()
    setImportFile(file);
    setShowImportConfirm(true);
  };

  const runImport = async (file: File) => {
    setLoading(true);
    setMsg('Initializing System Recovery...');
    setSuccess(false);
    setShowImportConfirm(false);

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const rawData = JSON.parse(event.target?.result as string);

          // STRICT ORDER for foreign keys
          const tableOrder = [
            'users',
            'team_members',
            'income_streams',
            'revenues',
            'projects',
            'expenses',
            'recurring_expenses',
            'project_allocations',
            'production_payments',
            'payment_project_rows',
            'other_payments',
            'project_revenue_links'
          ];

          let totalCount = 0;
          for (const table of tableOrder) {
            const records = rawData[table];
            if (records && Array.isArray(records) && records.length > 0) {
              setMsg(`Restoring ${table} (${records.length} items)...`);

              const chunkSize = 100;
              for (let i = 0; i < records.length; i += chunkSize) {
                const chunk = records.slice(i, i + chunkSize);
                const { error } = await supabase.from(table).upsert(chunk, {
                  onConflict: 'id',
                  ignoreDuplicates: false
                });

                if (error) {
                  console.error(`Error importing ${table}:`, error);
                  throw new Error(`Conflict in ${table}: ${error.message}`);
                }
              }
              totalCount += records.length;
            }
          }

          setMsg(`System Restored Successfully! (${totalCount} records processed)`);
          setSuccess(true);
          fetchCounts();
        } catch (err: any) {
          console.error(err);
          setMsg(`Recovery Failed: ${err.message}`);
        } finally {
          setLoading(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
          setImportFile(null);
        }
      };
      reader.readAsText(file);
    } catch (err) {
      setMsg('Error parsing file.');
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setImportFile(null);
    }
  };

  const handleCancelImport = () => {
    setShowImportConfirm(false);
    setImportFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="space-y-12 animate-in fade-in duration-700 max-w-[1200px] mx-auto pb-20">
      {/* Header Area */}
      <div>
        <h2 className="text-4xl font-black text-[#0f172a] tracking-tight">Backup & Export Center</h2>
        <p className="text-slate-500 text-lg font-medium mt-2">Manage system-wide data integrity and historical snapshots.</p>
      </div>

      {/* Main Hero Card */}
      <div className="bg-[#0f172a] rounded-[48px] p-16 relative overflow-hidden text-white shadow-2xl shadow-slate-900/10">
        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-12">
          <div className="flex flex-col md:flex-row items-center gap-8 text-center md:text-left">
            <div className="w-24 h-24 bg-[#6366f1] rounded-[32px] flex items-center justify-center shadow-xl shadow-indigo-500/20 transform hover:scale-105 transition-transform">
              <Database size={48} strokeWidth={2.5} />
            </div>
            <div className="space-y-3">
              <h3 className="text-5xl font-black tracking-tight">Full System Backup</h3>
              <p className="text-slate-400 text-xl font-medium max-w-lg leading-relaxed">
                Export every single record and relationship in one JSON bundle for disaster recovery.
              </p>
            </div>
          </div>
          
          <div className="flex flex-col gap-4 min-w-[320px]">
            <button 
              onClick={handleExportFullJSON}
              disabled={loading}
              className="w-full px-10 py-5 bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-[24px] font-black text-xs uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-3 shadow-2xl shadow-indigo-600/40 transform active:scale-95"
            >
              {loading ? <Loader2 className="animate-spin" size={22} /> : <Download size={22} />}
              Download JSON Bundle
            </button>
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="w-full px-10 py-5 bg-white/5 border border-white/10 hover:bg-white/10 text-white rounded-[24px] font-black text-xs uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-3 cursor-pointer transform active:scale-95 disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin" size={22} /> : <Upload size={22} />}
              Import Data (JSON)
            </button>
            <input 
              ref={fileInputRef}
              type="file" 
              accept=".json" 
              className="hidden" 
              onChange={handleImport} 
            />
          </div>
        </div>

        {/* Decorative Graphic Elements */}
        <div className="absolute right-[-40px] top-1/2 -translate-y-1/2 opacity-10 pointer-events-none hidden lg:block">
          <HardDrive size={380} strokeWidth={1} />
        </div>
      </div>

      {/* Status Notifications */}
      {msg && (
        <div className={`p-6 rounded-[32px] flex items-center gap-5 text-sm font-black uppercase tracking-widest border-2 animate-in slide-in-from-top-4 ${
          success ? 'bg-green-50 text-green-700 border-green-100' : 'bg-indigo-50 text-indigo-700 border-indigo-100'
        }`}>
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${success ? 'bg-green-100' : 'bg-indigo-100'}`}>
            {success ? <CheckCircle2 size={24} /> : <AlertCircle size={24} className="animate-pulse" />}
          </div>
          {msg}
        </div>
      )}

      {/* Import Confirmation Modal */}
      {showImportConfirm && importFile && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 animate-in scale-in-95 duration-200">
            <h3 className="text-2xl font-black text-[#0f172a] mb-4 flex items-center gap-2">
              <AlertCircle size={28} className="text-amber-500" />
              Confirm Data Import
            </h3>
            <div className="space-y-4 mb-6">
              <p className="text-slate-600 font-medium">
                This will overwrite existing records where IDs match. Current record counts:
              </p>
              <div className="bg-slate-50 rounded-lg p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">Revenues:</span>
                  <span className="font-black text-slate-900">{counts.revenues}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Projects:</span>
                  <span className="font-black text-slate-900">{counts.projects}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Expenses:</span>
                  <span className="font-black text-slate-900">{counts.expenses}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Outgoing Payments:</span>
                  <span className="font-black text-slate-900">{counts.production_payments}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Other Payments:</span>
                  <span className="font-black text-slate-900">{counts.other_payments}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Team Members:</span>
                  <span className="font-black text-slate-900">{counts.team_members}</span>
                </div>
              </div>
              <p className="text-xs text-red-600 font-black uppercase tracking-widest">
                This action cannot be undone. Export a backup first if you haven't already.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleCancelImport}
                className="flex-1 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg font-black text-sm uppercase tracking-wider transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => runImport(importFile)}
                className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-black text-sm uppercase tracking-wider transition-all shadow-lg"
              >
                Yes, Import & Overwrite
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Module Specific Export Grid */}
      <div className="space-y-10">
        <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.5em] px-2 flex items-center gap-3">
          <div className="h-px bg-slate-200 flex-1"></div>
          Specific Module Exports
          <div className="h-px bg-slate-200 flex-1"></div>
        </h4>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          <ExportCard 
            title="Revenues" 
            count={counts.revenues} 
            icon={<DollarSign />} 
            color="bg-emerald-50 text-emerald-500"
            onClick={() => handleExportCSV('revenues', 'revenues_export')}
            loading={loading}
          />
          <ExportCard 
            title="Projects" 
            count={counts.projects} 
            icon={<Briefcase />} 
            color="bg-blue-50 text-blue-500"
            onClick={() => handleExportCSV('projects', 'projects_export')}
            loading={loading}
          />
          <ExportCard 
            title="Expenses" 
            count={counts.expenses} 
            icon={<CreditCard />} 
            color="bg-rose-50 text-rose-500"
            onClick={() => handleExportCSV('expenses', 'expenses_export')}
            loading={loading}
          />
          <ExportCard 
            title="Outgoing Payments" 
            count={counts.production_payments} 
            icon={<FileText />} 
            color="bg-indigo-50 text-indigo-500"
            onClick={() => handleExportCSV('production_payments', 'outgoing_payments_export')}
            loading={loading}
          />
          <ExportCard 
            title="Other Payments" 
            count={counts.other_payments} 
            icon={<Calendar />} 
            color="bg-violet-50 text-violet-500"
            onClick={() => handleExportCSV('other_payments', 'other_payments_export')}
            loading={loading}
          />
          <ExportCard 
            title="Team Members" 
            count={counts.team_members} 
            icon={<Users />} 
            color="bg-amber-50 text-amber-500"
            onClick={() => handleExportCSV('team_members', 'team_members_export')}
            loading={loading}
          />
        </div>
      </div>
    </div>
  );
};

interface ExportCardProps {
  title: string;
  count: number;
  icon: React.ReactNode;
  color: string;
  onClick: () => void;
  loading: boolean;
}

const ExportCard: React.FC<ExportCardProps> = ({ title, count, icon, color, onClick, loading }) => {
  return (
    <div className="bg-white rounded-[40px] border border-slate-100 p-12 hover:border-slate-300 transition-all group shadow-sm hover:shadow-2xl hover:-translate-y-1 duration-300 relative overflow-hidden">
      <div className={`absolute -right-6 -bottom-6 opacity-5 scale-150 rotate-12 transition-transform group-hover:rotate-0 duration-500`}>
        {icon}
      </div>

      <div className="flex items-start justify-between mb-10">
        <div className={`w-20 h-20 rounded-[28px] flex items-center justify-center text-3xl ${color} transition-all group-hover:scale-110 shadow-sm`}>
          {icon}
        </div>
      </div>
      <div className="space-y-2 mb-10">
        <h5 className="text-3xl font-black text-[#0f172a] tracking-tight">{title}</h5>
        <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">{count} RECORDED ITEMS</p>
      </div>
      <button 
        onClick={onClick}
        disabled={loading}
        className="w-full py-5 bg-slate-50 group-hover:bg-[#0f172a] group-hover:text-white text-slate-400 font-black text-[11px] uppercase tracking-[0.2em] rounded-[24px] transition-all flex items-center justify-center gap-3 border border-slate-100 group-hover:border-[#0f172a] shadow-sm hover:shadow-lg active:scale-95"
      >
        <Download size={18} />
        Export CSV
      </button>
    </div>
  );
};

export default BackupView;