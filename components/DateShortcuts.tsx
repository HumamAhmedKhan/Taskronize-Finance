
import React from 'react';

interface DateShortcutsProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  onShortcutSelect: (start: string, end: string) => void;
}

export const DateShortcuts: React.FC<DateShortcutsProps> = ({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  onShortcutSelect
}) => {
  const getDateString = (date: Date) => date.toISOString().split('T')[0];

  const shortcuts = [
    { label: 'Today', getRange: () => { const t = getDateString(new Date()); return [t, t]; } },
    { label: 'This Week', getRange: () => { const now = new Date(); const d = now.getDay(); const s = new Date(now); s.setDate(now.getDate() - d); return [getDateString(s), getDateString(now)]; } },
    { label: 'This Month', getRange: () => { const now = new Date(); const s = new Date(now.getFullYear(), now.getMonth(), 1); return [getDateString(s), getDateString(now)]; } },
    { label: 'Last Month', getRange: () => { const now = new Date(); const s = new Date(now.getFullYear(), now.getMonth() - 1, 1); const e = new Date(now.getFullYear(), now.getMonth(), 0); return [getDateString(s), getDateString(e)]; } },
    { label: 'All Time', getRange: () => ['2020-01-01', '2099-12-31'] }
  ];

  return (
    <div className="space-y-4 min-w-[240px]">
      <div className="grid grid-cols-2 gap-2">
        {shortcuts.map(shortcut => {
          const [start, end] = shortcut.getRange();
          const isActive = startDate === start && endDate === end;
          return (
            <button
              key={shortcut.label}
              onClick={() => onShortcutSelect(start, end)}
              className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all ${
                isActive ? 'bg-gray-900 text-white shadow-sm' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
              }`}
            >
              {shortcut.label}
            </button>
          );
        })}
      </div>

      <div className="space-y-3 pt-3 border-t border-gray-100">
        <div>
          <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">From</label>
          <input
            type="date"
            value={startDate}
            onChange={e => onStartDateChange(e.target.value)}
            className="w-full px-3 py-2 bg-gray-50 border-none rounded-xl text-xs font-bold focus:ring-2 focus:ring-gray-100 outline-none"
          />
        </div>
        <div>
          <label className="block text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1">To</label>
          <input
            type="date"
            value={endDate}
            onChange={e => onEndDateChange(e.target.value)}
            className="w-full px-3 py-2 bg-gray-50 border-none rounded-xl text-xs font-bold focus:ring-2 focus:ring-gray-100 outline-none"
          />
        </div>
      </div>
    </div>
  );
};
