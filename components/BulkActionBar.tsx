import React from 'react';
import { Trash2, Download, X } from 'lucide-react';

export interface BulkAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  variant?: 'danger' | 'primary';
}

interface BulkActionBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  actions: BulkAction[];
}

const BulkActionBar: React.FC<BulkActionBarProps> = ({
  selectedCount,
  onClearSelection,
  actions
}) => {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 z-40">
      <div className="bg-slate-900 text-white rounded-xl shadow-2xl px-6 py-4 flex items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{selectedCount} selected</span>
          <button
            onClick={onClearSelection}
            className="p-1 hover:bg-slate-700 rounded transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="h-6 w-px bg-slate-700" />

        <div className="flex gap-2">
          {actions.map((action, idx) => (
            <button
              key={idx}
              onClick={action.onClick}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-colors ${
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