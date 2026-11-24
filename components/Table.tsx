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
  /** Controlled selection. When given, the parent owns which rows are ticked (rows hidden by a filter can stay ticked). */
  selectedIds?: (string | number)[];
}

function Table<T>({ 
  data, 
  columns, 
  rowKey, 
  onRowClick, 
  emptyMessage = 'No records found',
  selectable = false,
  onSelectionChange,
  selectedIds: controlledSelectedIds
}: TableProps<T>) {
  const [sortColumn, setSortColumn] = useState<keyof T | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [internalSelectedIds, setInternalSelectedIds] = useState<(string | number)[]>([]);
  const selectedIds = controlledSelectedIds ?? internalSelectedIds;
  const setSelectedIds = (ids: (string | number)[]) => { if (!controlledSelectedIds) setInternalSelectedIds(ids); };

  const handleSort = (accessor: keyof T) => {
    if (sortColumn === accessor) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(accessor);
      setSortDirection('asc');
    }
  };

  // Select-all works on the rows currently shown; ticked rows hidden by a filter are kept.
  const visibleIds = data.map(row => rowKey(row));
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.includes(id));
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    const ids = e.target.checked
      ? [...selectedIds, ...visibleIds.filter(id => !selectedIds.includes(id))]
      : selectedIds.filter(id => !visibleIds.includes(id));
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

  // Mobile card layout: pick a title column, an amount column and an actions column by header name.
  // Works for every table in the app without per-view configuration.
  const headerOf = (c: Column<T>) => (c.header || '').toUpperCase();
  const actionsIdx = columns.findIndex(c => /ACTION/.test(headerOf(c)));
  const titleIdx = (() => {
    const i = columns.findIndex((c, idx) => idx !== actionsIdx && /PROJECT NAME|CLIENT|RECIPIENT|DESCRIPTION|NAME|PROJECT|MEMBER/.test(headerOf(c)));
    return i >= 0 ? i : (columns.length > 1 ? 1 : 0);
  })();
  const amountIdx = columns.findIndex((c, idx) => idx !== titleIdx && idx !== actionsIdx && /VALUE|GROSS|AMOUNT|TOTAL|ALLOCATION/.test(headerOf(c)));
  const detailCols = columns
    .map((c, idx) => ({ c, idx }))
    .filter(({ idx }) => idx !== titleIdx && idx !== amountIdx && idx !== actionsIdx);
  const renderCell = (col: Column<T>, row: T) => col.render ? col.render(row) : String(row[col.accessor as keyof T] || '');

  return (
    <div className="w-full bg-white rounded-[24px] overflow-hidden">
      {/* Mobile: cards */}
      <ul className="md:hidden divide-y divide-gray-100">
        {sortedData.map((row) => {
          const id = rowKey(row);
          const isSelected = selectedIds.includes(id);
          return (
            <li
              key={id}
              className={`flex gap-3 px-4 py-4 ${onRowClick ? 'cursor-pointer active:bg-gray-50' : ''} ${isSelected ? 'bg-gray-50' : ''}`}
              onClick={(e) => {
                const target = e.target as HTMLElement;
                if (target.tagName !== 'INPUT' && target.tagName !== 'BUTTON' && !target.closest('button') && !target.closest('a')) {
                  onRowClick?.(row);
                }
              }}
            >
              {selectable && (
                <input
                  type="checkbox"
                  aria-label="Select row"
                  className="w-5 h-5 mt-0.5 shrink-0 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                  checked={isSelected}
                  onChange={() => handleSelectRow(id)}
                />
              )}
              <div className="flex-1 min-w-0 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 text-[15px] leading-snug break-words">{renderCell(columns[titleIdx], row)}</div>
                  {amountIdx >= 0 && <div className="shrink-0 text-right text-[15px]">{renderCell(columns[amountIdx], row)}</div>}
                </div>
                {detailCols.length > 0 && (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                    {detailCols.map(({ c, idx }) => (
                      <div key={idx} className="min-w-0">
                        <dt className="text-[10px] font-medium uppercase tracking-wider text-gray-500">{c.header}</dt>
                        <dd className="text-[13px] text-gray-900 break-words [&_*]:text-left">{renderCell(c, row)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {actionsIdx >= 0 && (
                  <div className="flex justify-end -mr-2 -mb-1">{renderCell(columns[actionsIdx], row)}</div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Desktop: table (unchanged) */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/30">
              {selectable && (
                <th className="px-6 py-4 w-12">
                  <input 
                    type="checkbox" 
                    className="w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900 cursor-pointer"
                    onChange={handleSelectAll}
                    checked={allVisibleSelected}
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