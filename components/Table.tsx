import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, Database } from 'lucide-react';

interface Column<T> {
  header: string;
  accessor?: keyof T;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
  className?: string;
}

interface TableProps<T> {
  data: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  selectable?: boolean;
  onSelectionChange?: (selectedIds: (string | number)[]) => void;
}

function Table<T>({ 
  data, 
  columns, 
  rowKey, 
  onRowClick, 
  emptyMessage = 'No records found',
  selectable = false,
  onSelectionChange
}: TableProps<T>) {
  const [sortColumn, setSortColumn] = useState<keyof T | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);

  const handleSort = (accessor: keyof T) => {
    if (sortColumn === accessor) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(accessor);
      setSortDirection('asc');
    }
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    const ids = e.target.checked ? data.map(row => rowKey(row)) : [];
    setSelectedIds(ids);
    onSelectionChange?.(ids);
  };

  const handleSelectRow = (id: string | number) => {
    const newSelected = selectedIds.includes(id)
      ? selectedIds.filter(i => i !== id)
      : [...selectedIds, id];
    setSelectedIds(newSelected);
    onSelectionChange?.(newSelected);
  };

  const sortedData = useMemo(() => {
    if (!sortColumn) return data;

    return [...data].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];
      if (aVal === bVal) return 0;
      const comparison = (aVal ?? '') > (bVal ?? '') ? 1 : -1;
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [data, sortColumn, sortDirection]);

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-gray-50 rounded-[32px] border-2 border-dashed border-gray-200">
        <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
          <Database className="text-gray-300" size={32} />
        </div>
        <p className="text-gray-500 font-semibold">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="w-full bg-white rounded-[24px] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/30">
              {selectable && (
                <th className="px-6 py-4 w-12">
                  <input 
                    type="checkbox" 
                    className="w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900 cursor-pointer"
                    onChange={handleSelectAll}
                    checked={selectedIds.length === data.length && data.length > 0}
                  />
                </th>
              )}
              {columns.map((col, idx) => (
                <th
                  key={idx}
                  className={`px-4 py-4 text-[10px] font-extrabold text-gray-400 uppercase tracking-widest ${col.className || ''}`}
                  onClick={() => col.sortable && col.accessor && handleSort(col.accessor)}
                  style={{ cursor: col.sortable ? 'pointer' : 'default' }}
                >
                  <div className="flex items-center gap-1.5 hover:text-gray-600 transition-colors">
                    {col.header}
                    {col.sortable && col.accessor && sortColumn === col.accessor && (
                      sortDirection === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {sortedData.map((row) => {
              const id = rowKey(row);
              const isSelected = selectedIds.includes(id);
              return (
                <tr
                  key={id}
                  className={`group transition-all hover:bg-gray-50/50 ${onRowClick ? 'cursor-pointer' : ''} ${isSelected ? 'bg-gray-50' : ''}`}
                  onClick={(e) => {
                    const target = e.target as HTMLElement;
                    if (target.tagName !== 'INPUT' && target.tagName !== 'BUTTON' && !target.closest('button')) {
                      onRowClick?.(row);
                    }
                  }}
                >
                  {selectable && (
                    <td className="px-6 py-5">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900 cursor-pointer"
                        checked={isSelected}
                        onChange={() => handleSelectRow(id)}
                      />
                    </td>
                  )}
                  {columns.map((col, idx) => (
                    <td key={idx} className={`px-4 py-5 text-sm font-semibold text-gray-900 ${col.className || ''}`}>
                      {col.render ? col.render(row) : String(row[col.accessor as keyof T] || '')}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Table;