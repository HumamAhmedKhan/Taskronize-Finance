import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { User, PersonalTask } from '../types';

interface PersonalTasksViewProps {
  currentUser: User;
}

const todayStr = () => new Date().toISOString().split('T')[0];

const formatDueDate = (dateStr: string | null): string => {
  if (!dateStr) return '';
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  if (dateStr === tomorrowStr) return 'Tomorrow';
  const [, month, day] = dateStr.split('-').map(Number);
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${MONTHS[month - 1]} ${day}`;
};

const ActiveTaskRow: React.FC<{
  task: PersonalTask;
  onToggle: (t: PersonalTask) => void;
  onEdit: (t: PersonalTask) => void;
  onDelete: (id: number) => void;
  isOverdue: (t: PersonalTask) => boolean;
}> = ({ task, onToggle, onEdit, onDelete, isOverdue }) => (
  <div className="group flex items-center gap-4 p-4 bg-surface-container-lowest rounded-xl hover:shadow-[0_8px_24px_rgba(23,28,31,0.06)] transition-all duration-300">
    <div className="relative flex items-center justify-center">
      <input
        type="checkbox"
        checked={task.completed}
        onChange={() => onToggle(task)}
        onClick={e => e.stopPropagation()}
        className="peer h-5 w-5 rounded-md border-outline-variant text-primary focus:ring-primary/20 transition-all cursor-pointer"
      />
    </div>
    <label
      onClick={() => onEdit(task)}
      className="flex-1 flex items-center justify-between cursor-pointer group-hover:translate-x-1 transition-transform min-w-0"
    >
      <span className="text-on-surface font-medium text-[0.9375rem]">{task.title}</span>
      {task.due_date && (
        isOverdue(task) ? (
          <span className="text-xs text-error font-semibold shrink-0 ml-2">Overdue</span>
        ) : (
          <span className="text-xs text-outline font-medium shrink-0 ml-2">{formatDueDate(task.due_date)}</span>
        )
      )}
    </label>
    <button
      onClick={e => { e.stopPropagation(); onDelete(task.id); }}
      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-error/10 text-outline hover:text-error transition-all shrink-0"
      title="Delete task"
    >
      <span className="material-symbols-outlined text-sm">delete</span>
    </button>
  </div>
);

const PersonalTasksView: React.FC<PersonalTasksViewProps> = ({ currentUser }) => {
  const [tasks, setTasks] = useState<PersonalTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [groupBy, setGroupBy] = useState<'none' | 'due_date'>('none');
  const [allUsers, setAllUsers] = useState<Pick<User, 'id' | 'name'>[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number>(currentUser.id);

  // Edit modal state
  const [editTask, setEditTask] = useState<PersonalTask | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const isAdmin = currentUser.user_type === 'admin';
  const titleInputRef = useRef<HTMLInputElement>(null);
  const dueDateInputRef = useRef<HTMLInputElement>(null);

  const loadTasks = async (uid: number) => {
    setLoading(true);
    const { data } = await supabase
      .from('personal_tasks')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });
    setTasks(data || []);
    setLoading(false);
  };

  useEffect(() => {
    loadTasks(selectedUserId);
  }, [selectedUserId]);

  useEffect(() => {
    if (!isAdmin) return;
    supabase
      .from('users')
      .select('id, name')
      .eq('status', 'active')
      .then(({ data }) => setAllUsers(data || []));
  }, [isAdmin]);

  const handleAddTask = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setSaving(true);
    await supabase.from('personal_tasks').insert({
      user_id: selectedUserId,
      title,
      due_date: newDueDate || null,
    });
    setNewTitle('');
    setNewDueDate('');
    await loadTasks(selectedUserId);
    setSaving(false);
  };

  const handleToggle = async (task: PersonalTask) => {
    const completed = !task.completed;
    const completed_at = completed ? new Date().toISOString() : null;
    await supabase
      .from('personal_tasks')
      .update({ completed, completed_at })
      .eq('id', task.id);
    setTasks(prev =>
      prev.map(t => t.id === task.id ? { ...t, completed, completed_at } : t)
    );
  };

  const handleDelete = async (id: number) => {
    await supabase.from('personal_tasks').delete().eq('id', id);
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const openEdit = (task: PersonalTask) => {
    setEditTask(task);
    setEditTitle(task.title);
    setEditDueDate(task.due_date || '');
  };

  const handleEditSave = async () => {
    if (!editTask || !editTitle.trim()) return;
    setEditSaving(true);
    await supabase.from('personal_tasks').update({
      title: editTitle.trim(),
      due_date: editDueDate || null,
    }).eq('id', editTask.id);
    await loadTasks(selectedUserId);
    setEditTask(null);
    setEditSaving(false);
  };

  const handleEditDelete = async () => {
    if (!editTask) return;
    await handleDelete(editTask.id);
    setEditTask(null);
  };

  const isOverdue = (task: PersonalTask) =>
    !task.completed && !!task.due_date && task.due_date < todayStr();

  const activeTasks = tasks.filter(t => !t.completed);
  const completedTasks = tasks.filter(t => t.completed);

  const today = todayStr();
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; })();
  const weekEnd = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().split('T')[0]; })();

  const DUE_DATE_GROUPS = [
    { key: 'overdue', label: 'Overdue', filter: (t: PersonalTask) => !!t.due_date && t.due_date < today },
    { key: 'today', label: 'Today', filter: (t: PersonalTask) => t.due_date === today },
    { key: 'tomorrow', label: 'Tomorrow', filter: (t: PersonalTask) => t.due_date === tomorrow },
    { key: 'this_week', label: 'This Week', filter: (t: PersonalTask) => !!t.due_date && t.due_date > tomorrow && t.due_date <= weekEnd },
    { key: 'later', label: 'Later', filter: (t: PersonalTask) => !!t.due_date && t.due_date > weekEnd },
    { key: 'no_date', label: 'No Due Date', filter: (t: PersonalTask) => !t.due_date },
  ];

  return (
    <div className="relative">
      {/* Admin user filter */}
      {isAdmin && allUsers.length > 0 && (
        <div className="flex items-center gap-2 mb-6">
          <span className="text-xs font-bold text-on-surface-variant uppercase tracking-tight">Viewing:</span>
          <select
            value={selectedUserId}
            onChange={e => setSelectedUserId(Number(e.target.value))}
            className="px-3 py-1.5 border border-outline-variant rounded-lg text-sm font-medium bg-surface-container-lowest outline-none"
          >
            {allUsers.map(u => (
              <option key={u.id} value={u.id}>
                {u.name}{u.id === currentUser.id ? ' (you)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Main content area */}
      <div className="grid grid-cols-1 gap-8 items-start">
        <section className="space-y-12">
          {/* PENDING / ACTIVE TASKS section */}
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                My Tasks
              </h2>
              <div className="flex items-center gap-3">
                {/* Group by toggle */}
                <div className="flex items-center bg-surface-container-low p-0.5 rounded-lg">
                  <button
                    onClick={() => setGroupBy('none')}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${groupBy === 'none' ? 'bg-surface-container-lowest shadow-sm text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
                  >
                    None
                  </button>
                  <button
                    onClick={() => setGroupBy('due_date')}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${groupBy === 'due_date' ? 'bg-surface-container-lowest shadow-sm text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
                  >
                    Due Date
                  </button>
                </div>
                <span className="text-sm font-medium text-on-surface-variant bg-surface-container px-2.5 py-0.5 rounded-full">
                  {activeTasks.length} Remaining
                </span>
              </div>
            </div>

            <div className="space-y-3">
              {/* ADD TASK ROW */}
              <div className="group flex items-center gap-4 p-4 bg-surface-container-low/50 border border-dashed border-outline-variant rounded-xl hover:bg-surface-container-low transition-all duration-300">
                <div className="relative flex items-center justify-center">
                  <span className="material-symbols-outlined text-outline/50 text-[20px]">add</span>
                </div>
                <div className="flex-1 flex items-center justify-between gap-3">
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddTask()}
                    placeholder="Add a task"
                    className="bg-transparent border-none p-0 text-outline font-medium text-[0.9375rem] w-full focus:ring-0 placeholder:text-outline/50 outline-none"
                  />
                  <div className="flex items-center gap-2 text-outline/50 hover:text-primary transition-colors cursor-pointer relative shrink-0">
                    <span className="text-xs font-medium whitespace-nowrap">
                      {newDueDate ? formatDueDate(newDueDate) : 'Set due date'}
                    </span>
                    <span className="material-symbols-outlined text-sm">calendar_today</span>
                    <input
                      ref={dueDateInputRef}
                      type="date"
                      value={newDueDate}
                      onChange={e => setNewDueDate(e.target.value)}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full"
                    />
                  </div>
                </div>
              </div>

              {/* ACTIVE TASK ROWS */}
              {loading ? (
                <div className="text-center py-10 text-on-surface-variant text-sm">Loading...</div>
              ) : activeTasks.length === 0 ? (
                <div className="text-center py-8 text-on-surface-variant text-sm">No active tasks</div>
              ) : groupBy === 'none' ? (
                activeTasks.map(task => (
                  <ActiveTaskRow key={task.id} task={task} onToggle={handleToggle} onEdit={openEdit} onDelete={handleDelete} isOverdue={isOverdue} />
                ))
              ) : (
                DUE_DATE_GROUPS.map(grp => {
                  const grpTasks = activeTasks.filter(grp.filter);
                  if (grpTasks.length === 0) return null;
                  return (
                    <div key={grp.key}>
                      <div className="flex items-center gap-2 mb-2 mt-4">
                        <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ${grp.key === 'overdue' ? 'bg-error/10 text-error' : 'bg-surface-container text-outline'}`}>
                          {grp.label}
                        </span>
                        <div className="flex-1 h-px bg-outline-variant/30" />
                      </div>
                      <div className="space-y-2">
                        {grpTasks.map(task => (
                          <ActiveTaskRow key={task.id} task={task} onToggle={handleToggle} onEdit={openEdit} onDelete={handleDelete} isOverdue={isOverdue} />
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* COMPLETED SECTION */}
          {completedTasks.length > 0 && (
            <div className="opacity-70">
              <div
                className="flex items-center justify-between mb-6 cursor-pointer"
                onClick={() => setShowCompleted(!showCompleted)}
              >
                <h2 className="text-xl font-semibold flex items-center gap-2 text-on-surface-variant">
                  <span className="w-1.5 h-6 bg-outline rounded-full"></span>
                  Completed
                  <span className="text-sm font-medium bg-surface-container px-2.5 py-0.5 rounded-full ml-1">
                    {completedTasks.length}
                  </span>
                </h2>
                <span className="material-symbols-outlined text-on-surface-variant">
                  {showCompleted ? 'expand_less' : 'expand_more'}
                </span>
              </div>

              {showCompleted && (
                <div className="space-y-2">
                  {completedTasks.map(task => (
                    <div
                      key={task.id}
                      className="flex items-center gap-4 p-4 bg-surface-container-low rounded-xl cursor-pointer hover:bg-surface-container transition-colors"
                      onClick={() => openEdit(task)}
                    >
                      <span
                        className="material-symbols-outlined text-primary"
                        style={{ fontVariationSettings: "'FILL' 1" }}
                      >
                        check_circle
                      </span>
                      <div className="flex-1 flex items-center justify-between">
                        <span className="text-on-surface-variant line-through text-[0.9375rem]">
                          {task.title}
                        </span>
                        <span className="text-[10px] text-outline font-medium uppercase tracking-wider">
                          DONE
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* FAB button */}
      <button
        onClick={() => titleInputRef.current?.focus()}
        className="fixed bottom-10 right-10 w-16 h-16 bg-primary-container text-on-primary rounded-full shadow-2xl flex items-center justify-center hover:scale-105 active:scale-95 transition-transform z-50"
      >
        <span className="material-symbols-outlined text-3xl">add</span>
      </button>

      {/* Edit Modal */}
      {editTask !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-surface-container-lowest w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant flex items-center justify-between">
              <h3 className="font-semibold text-on-surface">Edit Task</h3>
              <button
                onClick={() => setEditTask(null)}
                className="p-1 hover:bg-surface-container rounded-lg transition-colors"
              >
                <span className="material-symbols-outlined text-on-surface-variant text-[20px]">close</span>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-on-surface-variant uppercase mb-1.5">
                  Title
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="w-full px-4 py-2.5 border border-outline-variant rounded-xl outline-none focus:border-primary text-sm bg-surface-container-low text-on-surface"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-on-surface-variant uppercase mb-1.5">
                  Due Date
                </label>
                <input
                  type="date"
                  value={editDueDate}
                  onChange={e => setEditDueDate(e.target.value)}
                  className="w-full px-4 py-2.5 border border-outline-variant rounded-xl outline-none focus:border-primary text-sm bg-surface-container-low"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-outline-variant flex gap-3">
              <button
                onClick={handleEditDelete}
                className="px-4 py-2.5 border border-error/30 text-error rounded-xl text-sm font-medium hover:bg-error/5 transition-colors"
              >
                Delete
              </button>
              <button
                onClick={() => setEditTask(null)}
                className="flex-1 py-2.5 border border-outline-variant rounded-xl text-on-surface-variant text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={editSaving}
                className="flex-1 py-2.5 bg-primary text-on-primary rounded-xl text-sm font-bold hover:bg-primary/90 disabled:opacity-40 transition-colors"
              >
                {editSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PersonalTasksView;
