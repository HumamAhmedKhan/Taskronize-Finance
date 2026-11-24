import React from 'react';
import { X, AlertTriangle } from 'lucide-react';

export interface BulkAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  variant?: 'danger' | 'primary';
}

export interface BulkStat {
  label: string;
  value: string;
  tone?: 'default' | 'good' | 'bad';
}

interface BulkActionBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  actions: BulkAction[];
  /** Live totals for the selected rows, shown between the count and the actions. */
  stats?: BulkStat[];
  /** Short warnings (e.g. "2 hidden by search"), shown under the stats. */
  notes?: string[];
}

const toneClass = (tone?: BulkStat['tone']) =>
  tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-rose-300' : 'text-white';

const BulkActionBar: React.FC<BulkActionBarProps> = ({
  selectedCount,
  onClearSelection,
  actions,
  stats = [],
  notes = []
}) => {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed z-40 left-4 right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:left-1/2 md:right-auto md:bottom-8 md:-translate-x-1/2 md:w-max md:max-w-[min(64rem,calc(100vw-4rem))]">
      <div className="bg-slate-900 text-white rounded-xl shadow-2xl px-4 py-3 md:px-6 md:py-4 flex flex-col md:flex-row md:items-center gap-2.5 md:gap-6">
        <div className="flex items-center justify-between md:justify-start gap-2 shrink-0">
          <span className="font-semibold whitespace-nowrap">{selectedCount} selected</span>
          <button
            onClick={onClearSelection}
            aria-label="Clear selection"
            className="p-1 hover:bg-slate-700 rounded transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {stats.length > 0 && (
          <>
            <div className="hidden md:block h-8 w-px bg-slate-700 shrink-0" />
            <div className="min-w-0 md:flex-1 space-y-1.5">
              <dl className="grid grid-cols-3 gap-x-4 gap-y-1.5 md:flex md:flex-nowrap md:gap-x-5">
                {stats.map((s, i) => (
                  // Phones show the first three; the rest appear from md up.
                  <div key={s.label} className={`min-w-0 ${i >= 3 ? 'hidden md:block' : ''}`}>
                    <dt className="text-[10px] uppercase tracking-wider text-slate-400 whitespace-nowrap">{s.label}</dt>
                    <dd className={`text-sm font-semibold tabular-nums whitespace-nowrap ${toneClass(s.tone)}`}>{s.value}</dd>
                  </div>
                ))}
              </dl>
              {notes.length > 0 && (
                <ul className="space-y-0.5">
                  {notes.map(n => (
                    <li key={n} className="flex items-start gap-1.5 text-[11px] md:text-xs leading-snug text-amber-300">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {n}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        <div className="hidden md:block h-8 w-px bg-slate-700 shrink-0" />

        <div className="flex gap-2 shrink-0">
          {actions.map((action, idx) => (
            <button
              key={idx}
              onClick={action.onClick}
              className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-3 md:px-4 py-2 text-sm md:text-base rounded-lg font-semibold whitespace-nowrap transition-colors ${
                action.variant === 'danger'
                  ? 'bg-red-600 hover:bg-red-700'
                  : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default BulkActionBar;
