import React, { useState, useEffect } from 'react';
import { supabase, createNotification, parseMentionUsernames } from '../lib/supabase';
import { User, TeamMember, Project, TeamTask, TaskComment } from '../types';

interface TeamTaskRow extends TeamTask {
  assignees: { team_member_id: number; name: string }[];
}

interface ProjectInfo {
  project: Project;
  status: string;
  assignees: { name: string; role: string }[];
}

interface AddForm {
  title: string;
  project_id: string;
  assignee_ids: number[];
  due_date: string;
  priority: 'high' | 'medium' | 'low';
  status: 'todo' | 'in_progress' | 'completed';
}

const PRIORITY_STYLES: Record<string, string> = {
  high: 'bg-error-container text-on-error-container',
  medium: 'bg-surface-container text-on-secondary-container',
  low: 'bg-surface-container text-outline',
};

const STATUS_GROUPS = [
  { key: 'todo' as const, label: 'To Do', badgeColor: '' },
  { key: 'completed' as const, label: 'Completed', badgeColor: '' },
];

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-purple-500', 'bg-emerald-500', 'bg-rose-500',
  'bg-amber-500', 'bg-cyan-500', 'bg-indigo-500', 'bg-pink-500',
];

const todayStr = () => new Date().toISOString().split('T')[0];
const getInitials = (name: string) =>
  name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

const formatDueDate = (dateStr: string): string => {
  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  if (dateStr === today) return 'Today';
  if (dateStr === tomorrowStr) return 'Tomorrow';
  const [, month, day] = dateStr.split('-').map(Number);
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${MONTHS[month - 1]} ${day}`;
};

interface TeamTasksViewProps {
  currentUser: User;
}

const TeamTasksView: React.FC<TeamTasksViewProps> = ({ currentUser }) => {
  const [tasks, setTasks] = useState<TeamTaskRow[]>([]);
  const [projects, setProjects] = useState<Pick<Project, 'id' | 'project_name' | 'client_name' | 'project_value' | 'project_description'>[]>([]);
  const [teamMembers, setTeamMembers] = useState<Pick<TeamMember, 'id' | 'name' | 'role'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAssignee, setFilterAssignee] = useState<number | null>(null);
  const [filterProject, setFilterProject] = useState<number | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<AddForm>({
    title: '', project_id: '', assignee_ids: [], due_date: '', priority: 'medium', status: 'todo',
  });
  const [saving, setSaving] = useState(false);
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
  const [loadingProjectInfo, setLoadingProjectInfo] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editTask, setEditTask] = useState<TeamTaskRow | null>(null);
  const [editForm, setEditForm] = useState<AddForm>({ title: '', project_id: '', assignee_ids: [], due_date: '', priority: 'medium', status: 'todo' });
  const [editSaving, setEditSaving] = useState(false);
  const [editComments, setEditComments] = useState<TaskComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [commentSaving, setCommentSaving] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    const [{ data: tasksData }, { data: projectsData }, { data: membersData }] = await Promise.all([
      supabase
        .from('team_tasks')
        .select('*, team_task_assignees(team_member_id, team_members(id, name))')
        .order('created_at', { ascending: false }),
      supabase
        .from('projects')
        .select('id, project_name, client_name, project_value, project_description')
        .order('project_name'),
      supabase
        .from('team_members')
        .select('id, name, role')
        .order('name'),
    ]);

    const formatted: TeamTaskRow[] = (tasksData || []).map((t: any) => ({
      ...t,
      assignees: (t.team_task_assignees || []).map((a: any) => ({
        team_member_id: a.team_member_id,
        name: a.team_members?.name || '',
      })),
    }));

    setTasks(formatted);
    setProjects(projectsData || []);
    setTeamMembers(membersData || []);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const filteredTasks = tasks.filter(t => {
    if (filterAssignee !== null && !t.assignees.some(a => a.team_member_id === filterAssignee)) return false;
    if (filterProject !== null && t.project_id !== filterProject) return false;
    return true;
  });

  const handleToggleComplete = async (task: TeamTaskRow) => {
    const completed = !task.completed;
    const status = completed ? 'completed' : 'todo';
    const completed_at = completed ? new Date().toISOString() : null;
    await supabase
      .from('team_tasks')
      .update({ completed, completed_at, status })
      .eq('id', task.id);
    setTasks(prev =>
      prev.map(t =>
        t.id === task.id ? { ...t, completed, completed_at, status } : t
      )
    );
  };

  const handleUpdateTitle = async (taskId: number, newTitle: string) => {
    if (!newTitle.trim()) {
      setEditingTaskId(null);
      return;
    }
    await supabase
      .from('team_tasks')
      .update({ title: newTitle.trim() })
      .eq('id', taskId);
    setTasks(prev =>
      prev.map(t =>
        t.id === taskId ? { ...t, title: newTitle.trim() } : t
      )
    );
    setEditingTaskId(null);
  };

  const handleDeleteTask = async (id: number) => {
    await supabase.from('team_task_assignees').delete().eq('task_id', id);
    await supabase.from('team_tasks').delete().eq('id', id);
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  const openEditModal = async (task: TeamTaskRow) => {
    setEditTask(task);
    setEditForm({
      title: task.title,
      project_id: task.project_id ? String(task.project_id) : '',
      assignee_ids: task.assignees.map(a => a.team_member_id),
      due_date: task.due_date || '',
      priority: task.priority,
      status: task.status,
    });
    setNewComment('');
    const { data } = await supabase
      .from('task_comments')
      .select('*')
      .eq('task_type', 'team')
      .eq('task_id', task.id)
      .order('created_at', { ascending: true });
    setEditComments(data || []);
  };

  const handleSaveComment = async () => {
    if (!editTask || !newComment.trim()) return;
    setCommentSaving(true);
    const content = newComment.trim();
    await supabase.from('task_comments').insert({
      task_type: 'team',
      task_id: editTask.id,
      user_id: currentUser.id,
      user_name: currentUser.name,
      content,
    });
    const { data } = await supabase
      .from('task_comments')
      .select('*')
      .eq('task_type', 'team')
      .eq('task_id', editTask.id)
      .order('created_at', { ascending: true });
    setEditComments(data || []);
    setNewComment('');
    // Notify assignees (except commenter)
    for (const assignee of editTask.assignees) {
      const { data: au } = await supabase
        .from('users').select('id').eq('team_member_id', assignee.team_member_id).maybeSingle();
      if (au && au.id !== currentUser.id) {
        await createNotification({
          user_id: au.id, type: 'comment',
          actor_id: currentUser.id, actor_name: currentUser.name,
          message: `${currentUser.name} commented on "${editTask.title}"`,
          preview: content.slice(0, 100),
          entity_type: 'team_task', entity_id: editTask.id, entity_name: editTask.title,
        });
      }
    }
    // @mentions
    for (const username of parseMentionUsernames(content)) {
      const { data: mu } = await supabase
        .from('users').select('id').ilike('username', username).maybeSingle();
      if (mu && mu.id !== currentUser.id) {
        await createNotification({
          user_id: mu.id, type: 'mention',
          actor_id: currentUser.id, actor_name: currentUser.name,
          message: `${currentUser.name} mentioned you in "${editTask.title}"`,
          preview: content.slice(0, 100),
          entity_type: 'team_task', entity_id: editTask.id, entity_name: editTask.title,
        });
      }
    }
    setCommentSaving(false);
  };

  const handleEditSave = async () => {
    if (!editTask || !editForm.title.trim()) return;
    setEditSaving(true);
    await supabase.from('team_tasks').update({
      title: editForm.title.trim(),
      project_id: editForm.project_id ? Number(editForm.project_id) : null,
      due_date: editForm.due_date || null,
      priority: editForm.priority,
    }).eq('id', editTask.id);
    // Sync assignees: delete old, insert new
    await supabase.from('team_task_assignees').delete().eq('task_id', editTask.id);
    if (editForm.assignee_ids.length > 0) {
      await supabase.from('team_task_assignees').insert(
        editForm.assignee_ids.map(mid => ({ task_id: editTask.id, team_member_id: mid }))
      );
    }
    // Notify newly added assignees
    const prevIds = editTask.assignees.map(a => a.team_member_id);
    const newAssigneeIds = editForm.assignee_ids.filter(id => !prevIds.includes(id));
    for (const mid of newAssigneeIds) {
      const { data: au } = await supabase
        .from('users').select('id').eq('team_member_id', mid).maybeSingle();
      if (au && au.id !== currentUser.id) {
        await createNotification({
          user_id: au.id, type: 'assigned',
          actor_id: currentUser.id, actor_name: currentUser.name,
          message: `${currentUser.name} assigned you to "${editForm.title.trim()}"`,
          entity_type: 'team_task', entity_id: editTask.id, entity_name: editForm.title.trim(),
        });
      }
    }
    await loadAll();
    setEditTask(null);
    setEditComments([]);
    setNewComment('');
    setEditSaving(false);
  };

  const openAddModal = (status: 'todo' | 'in_progress' | 'completed') => {
    setAddForm({ title: '', project_id: '', assignee_ids: [], due_date: '', priority: 'medium', status });
    setShowAddModal(true);
  };

  const handleSaveTask = async () => {
    if (!addForm.title.trim()) return;
    setSaving(true);
    const { data: newTask, error } = await supabase
      .from('team_tasks')
      .insert({
        title: addForm.title.trim(),
        project_id: addForm.project_id ? Number(addForm.project_id) : null,
        priority: addForm.priority,
        status: addForm.status,
        due_date: addForm.due_date || null,
        completed: addForm.status === 'completed',
        completed_at: addForm.status === 'completed' ? new Date().toISOString() : null,
        created_by: currentUser.id,
      })
      .select()
      .single();

    if (!error && newTask && addForm.assignee_ids.length > 0) {
      await supabase.from('team_task_assignees').insert(
        addForm.assignee_ids.map(mid => ({ task_id: newTask.id, team_member_id: mid }))
      );
      // Notify each assignee (except creator)
      for (const mid of addForm.assignee_ids) {
        const { data: au } = await supabase
          .from('users').select('id').eq('team_member_id', mid).maybeSingle();
        if (au && au.id !== currentUser.id) {
          await createNotification({
            user_id: au.id, type: 'assigned',
            actor_id: currentUser.id, actor_name: currentUser.name,
            message: `${currentUser.name} assigned you to "${addForm.title.trim()}"`,
            entity_type: 'team_task', entity_id: newTask.id, entity_name: addForm.title.trim(),
          });
        }
      }
    }

    await loadAll();
    setShowAddModal(false);
    setSaving(false);
  };

  const handleProjectClick = async (projectId: number) => {
    setLoadingProjectInfo(true);
    setProjectInfo(null);
    const [{ data: project }, { data: mgmt }, { data: allocs }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).single(),
      supabase.from('project_management').select('pipeline_status').eq('project_id', projectId).maybeSingle(),
      supabase.from('project_allocations').select('role, team_members(name)').eq('project_id', projectId),
    ]);
    if (project) {
      setProjectInfo({
        project,
        status: (mgmt as any)?.pipeline_status || 'Uncategorized',
        assignees: (allocs || []).map((a: any) => ({
          name: a.team_members?.name || '',
          role: a.role,
        })),
      });
    }
    setLoadingProjectInfo(false);
  };

  const toggleAssigneeInForm = (id: number) => {
    setAddForm(prev => ({
      ...prev,
      assignee_ids: prev.assignee_ids.includes(id)
        ? prev.assignee_ids.filter(x => x !== id)
        : [...prev.assignee_ids, id],
    }));
  };

  const AssigneeAvatars = ({
    assignees,
  }: {
    assignees: { team_member_id: number; name: string }[];
  }) => {
    const shown = assignees.slice(0, 3);
    const extra = assignees.length - 3;
    return (
      <div className="flex items-center -space-x-2">
        {shown.map((a, i) => (
          <div
            key={a.team_member_id}
            title={a.name}
            className={`w-8 h-8 rounded-full ${AVATAR_COLORS[a.team_member_id % AVATAR_COLORS.length]} text-white text-[10px] font-bold flex items-center justify-center border-2 border-surface-container-lowest`}
          >
            {getInitials(a.name)}
          </div>
        ))}
        {extra > 0 && (
          <div className="w-8 h-8 rounded-full bg-surface-container-low text-outline text-[10px] font-bold flex items-center justify-center border-2 border-surface-container-lowest">
            +{extra}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <h1 className="text-4xl font-extrabold tracking-tight text-on-surface">Team Tasks</h1>
      </div>

      {/* Filters row */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <select
          value={filterAssignee ?? ''}
          onChange={e => setFilterAssignee(e.target.value ? Number(e.target.value) : null)}
          className="px-4 py-2.5 border border-outline-variant rounded-xl text-sm bg-surface-container-lowest outline-none focus:ring-2 focus:ring-primary/20 font-medium text-on-surface"
        >
          <option value="">All members</option>
          {teamMembers.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <select
          value={filterProject ?? ''}
          onChange={e => setFilterProject(e.target.value ? Number(e.target.value) : null)}
          className="px-4 py-2.5 border border-outline-variant rounded-xl text-sm bg-surface-container-lowest outline-none focus:ring-2 focus:ring-primary/20 font-medium text-on-surface"
        >
          <option value="">All projects</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.project_name}</option>
          ))}
        </select>
      </div>

      {/* Status groups */}
      {loading ? (
        <div className="text-center py-16 text-on-surface-variant text-sm">Loading tasks...</div>
      ) : (
        STATUS_GROUPS.map(group => {
          const groupTasks = filteredTasks.filter(t => t.status === group.key);
          return (
            <section key={group.key}>
              {/* Group header */}
              <div className="flex items-center gap-3 mb-4 px-2">
                <span
                  className="px-2.5 py-0.5 rounded text-xs font-bold uppercase tracking-wider"
                  style={group.key === 'todo' ? { backgroundColor: '#fea619', color: '#684000' } : { backgroundColor: '#dcfce7', color: '#166534' }}
                >
                  {group.label}
                </span>
                <span className="text-sm font-bold text-outline">{groupTasks.length} Tasks</span>
                <div className="flex-grow h-px bg-surface-container-high ml-4" />
              </div>

              {/* Table card */}
              <div className="bg-surface-container-lowest rounded-2xl shadow-sm overflow-hidden border border-outline-variant/10">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse table-fixed">
                    <thead>
                      <tr className="bg-surface-container-low/50 border-b border-outline-variant/10">
                        <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-widest text-outline w-[45%]">Task Name</th>
                        <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-widest text-outline w-[25%]">Assignees</th>
                        <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-widest text-outline w-[15%] text-right">Due Date</th>
                        <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-widest text-outline w-[15%] text-right">Priority</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-container-low">
                      {groupTasks.map(task => {
                        const overdue = !task.completed && !!task.due_date && task.due_date < todayStr();
                        const project = task.project_id ? projects.find(p => p.id === task.project_id) : null;
                        const isCompleted = task.completed;
                        return (
                          <tr key={task.id} className={`transition-colors group ${isCompleted ? 'opacity-50' : 'hover:bg-surface-container-low/30'}`}>
                            <td className="px-6 py-5">
                              <div className="flex items-center gap-3">
                                {/* Checkbox */}
                                <button
                                  onClick={() => !isCompleted && handleToggleComplete(task)}
                                  disabled={isCompleted}
                                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                                    isCompleted
                                      ? 'bg-emerald-500 border-emerald-500 text-white cursor-default'
                                      : 'border-outline-variant hover:border-primary'
                                  }`}
                                >
                                  {isCompleted && (
                                    <span className="material-symbols-outlined text-white" style={{ fontSize: '12px', fontVariationSettings: "'FILL' 1" }}>check</span>
                                  )}
                                </button>
                                <div className="flex-1 min-w-0 space-y-0.5">
                                  <p
                                    onClick={() => !isCompleted && openEditModal(task)}
                                    className={`font-medium leading-tight ${isCompleted ? 'line-through text-outline' : 'text-on-surface cursor-pointer hover:text-primary transition-colors'}`}
                                  >
                                    {task.title}
                                  </p>
                                  {project && <p className="text-xs text-outline line-clamp-1">{project.project_name}</p>}
                                </div>
                                {!isCompleted && (
                                  <>
                                    <button
                                      onClick={() => openEditModal(task)}
                                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-primary/10 text-outline hover:text-primary transition-all shrink-0"
                                      title="Edit task"
                                    >
                                      <span className="material-symbols-outlined text-sm">edit</span>
                                    </button>
                                    <button
                                      onClick={() => handleDeleteTask(task.id)}
                                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-error/10 text-outline hover:text-error transition-all shrink-0"
                                      title="Delete task"
                                    >
                                      <span className="material-symbols-outlined text-sm">delete</span>
                                    </button>
                                  </>
                                )}
                                {isCompleted && (
                                  <button
                                    onClick={() => handleDeleteTask(task.id)}
                                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-error/10 text-outline hover:text-error transition-all shrink-0"
                                    title="Delete task"
                                  >
                                    <span className="material-symbols-outlined text-sm">delete</span>
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-5">
                              {task.assignees.length > 0 ? (
                                <AssigneeAvatars assignees={task.assignees} />
                              ) : (
                                <span className="text-outline-variant text-xs">—</span>
                              )}
                            </td>
                            <td className="px-6 py-5 text-right">
                              {task.due_date ? (
                                <span className={`text-xs font-semibold px-2 py-1 rounded ${overdue ? 'bg-error-container text-on-error-container' : 'text-on-surface-variant bg-surface-container'}`}>
                                  {formatDueDate(task.due_date)}
                                </span>
                              ) : (
                                <span className="text-outline text-xs">—</span>
                              )}
                            </td>
                            <td className="px-6 py-5 text-right">
                              <span className={`px-2 py-1 text-[10px] font-bold rounded uppercase ${PRIORITY_STYLES[task.priority]}`}>
                                {task.priority}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Add Task row — only for non-completed groups */}
                {group.key !== 'completed' && (
                  <div className="p-4 border-t border-outline-variant/10">
                    <button
                      onClick={() => openAddModal(group.key)}
                      className="flex items-center gap-2 text-xs font-bold text-primary hover:bg-primary/5 px-3 py-2 rounded-lg transition-all active:scale-95"
                    >
                      <span className="material-symbols-outlined text-sm">add</span> Add Task
                    </button>
                  </div>
                )}
              </div>
            </section>
          );
        })
      )}

      {/* FAB */}
      <button
        onClick={() => openAddModal('todo')}
        className="fixed bottom-8 right-8 h-14 px-6 rounded-full bg-gradient-to-br from-primary to-primary-container text-on-primary flex items-center gap-3 shadow-[0_12px_24px_rgba(0,74,198,0.25)] hover:scale-105 active:scale-95 z-50 transition-transform font-bold text-sm tracking-wide group"
      >
        <span className="material-symbols-outlined group-hover:rotate-90 transition-transform duration-300">add</span>
        Create Task
      </button>

      {/* Edit Task Modal */}
      {editTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-surface-container-lowest w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant/10 flex items-center justify-between">
              <h3 className="font-bold text-on-surface">Edit Task</h3>
              <button onClick={() => { setEditTask(null); setEditComments([]); setNewComment(''); }} className="p-1 hover:bg-surface-container rounded-lg transition-colors">
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Title */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-outline mb-2">Title *</label>
                <input
                  type="text"
                  value={editForm.title}
                  onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleEditSave()}
                  autoFocus
                  className="w-full px-4 py-2.5 border border-outline-variant rounded-xl outline-none focus:ring-2 focus:ring-primary/20 text-sm bg-surface-container-low text-on-surface"
                />
              </div>

              {/* Project */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-outline mb-2">Project</label>
                <select
                  value={editForm.project_id}
                  onChange={e => setEditForm(p => ({ ...p, project_id: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-outline-variant rounded-xl outline-none focus:ring-2 focus:ring-primary/20 text-sm bg-surface-container-low text-on-surface"
                >
                  <option value="">No project</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.project_name}</option>
                  ))}
                </select>
              </div>

              {/* Assignees */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-outline mb-2">Assignees</label>
                <div className="border border-outline-variant rounded-xl p-2 max-h-36 overflow-y-auto space-y-0.5">
                  {teamMembers.map(m => (
                    <label key={m.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface-container-low cursor-pointer">
                      <div
                        onClick={() => setEditForm(prev => ({
                          ...prev,
                          assignee_ids: prev.assignee_ids.includes(m.id)
                            ? prev.assignee_ids.filter(x => x !== m.id)
                            : [...prev.assignee_ids, m.id],
                        }))}
                        className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${editForm.assignee_ids.includes(m.id) ? 'bg-primary border-primary' : 'border-outline-variant'}`}
                      >
                        {editForm.assignee_ids.includes(m.id) && (
                          <span className="material-symbols-outlined text-white text-xs">check</span>
                        )}
                      </div>
                      <span className="text-sm text-on-surface font-medium flex-1">{m.name}</span>
                      <span className="text-xs text-on-surface-variant">{m.role}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Due date + Priority */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-outline mb-2">Due date</label>
                  <input
                    type="date"
                    value={editForm.due_date}
                    onChange={e => setEditForm(p => ({ ...p, due_date: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-outline-variant rounded-xl outline-none focus:ring-2 focus:ring-primary/20 text-sm bg-surface-container-low text-on-surface"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-outline mb-2">Priority</label>
                  <div className="flex gap-1">
                    {(['high', 'medium', 'low'] as const).map(p => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setEditForm(prev => ({ ...prev, priority: p }))}
                        className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${
                          editForm.priority === p
                            ? p === 'high' ? 'bg-error-container text-on-error-container'
                              : p === 'medium' ? 'bg-secondary-container text-on-secondary-container'
                              : 'bg-tertiary-container text-on-tertiary-container'
                            : 'bg-surface-container text-outline-variant hover:bg-surface-container-high'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Comment Thread */}
            <div className="px-6 pb-4 pt-2 border-t border-outline-variant/10 mt-2">
              <p className="text-[11px] font-bold uppercase tracking-widest text-outline mb-3">Comments</p>
              {editComments.length > 0 && (
                <div className="space-y-3 mb-4 max-h-40 overflow-y-auto pr-1">
                  {editComments.map(c => (
                    <div key={c.id} className="flex gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-surface-container flex items-center justify-center shrink-0 text-[10px] font-bold text-on-surface-variant uppercase">
                        {c.user_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-xs font-semibold text-on-surface">{c.user_name}</span>
                          <span className="text-[10px] text-outline">
                            {(() => {
                              const diff = Date.now() - new Date(c.created_at).getTime();
                              const mins = Math.floor(diff / 60000);
                              if (mins < 1) return 'Just now';
                              if (mins < 60) return `${mins}m ago`;
                              const hrs = Math.floor(mins / 60);
                              if (hrs < 24) return `${hrs}h ago`;
                              return `${Math.floor(hrs / 24)}d ago`;
                            })()}
                          </span>
                        </div>
                        <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">{c.content}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSaveComment()}
                  placeholder="Add a comment… use @username to mention"
                  className="flex-1 px-3 py-2 border border-outline-variant rounded-xl text-xs bg-surface-container-low text-on-surface outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-outline/50"
                />
                <button
                  onClick={handleSaveComment}
                  disabled={!newComment.trim() || commentSaving}
                  className="px-3 py-2 bg-primary text-on-primary rounded-xl text-xs font-bold disabled:opacity-40 hover:bg-primary-container transition-colors shrink-0"
                >
                  {commentSaving ? '…' : 'Post'}
                </button>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-outline-variant/10 flex gap-3">
              <button onClick={() => { setEditTask(null); setEditComments([]); setNewComment(''); }} className="flex-1 py-2.5 px-4 border border-outline-variant rounded-xl text-on-surface font-bold text-sm hover:bg-surface-container transition-colors">
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={!editForm.title.trim() || editSaving}
                className="flex-1 py-2.5 px-4 bg-primary text-on-primary rounded-xl font-bold text-sm hover:bg-primary-container transition-colors disabled:opacity-40"
              >
                {editSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Task Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-surface-container-lowest w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant/10 flex items-center justify-between">
              <h3 className="font-bold text-on-surface">Add Team Task</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 hover:bg-surface-container rounded-lg transition-colors"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Title */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-outline mb-2">
                  Title *
                </label>
                <input
                  type="text"
                  value={addForm.title}
                  onChange={e => setAddForm(p => ({ ...p, title: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && handleSaveTask()}
                  placeholder="Task title..."
                  autoFocus
                  className="w-full px-4 py-2.5 border border-outline-variant rounded-xl outline-none focus:ring-2 focus:ring-primary/20 text-sm bg-surface-container-low text-on-surface"
                />
              </div>

              {/* Project */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-outline mb-2">
                  Project
                </label>
                <select
                  value={addForm.project_id}
                  onChange={e => setAddForm(p => ({ ...p, project_id: e.target.value }))}
                  className="w-full px-4 py-2.5 border border-outline-variant rounded-xl outline-none focus:ring-2 focus:ring-primary/20 text-sm bg-surface-container-low text-on-surface"
                >
                  <option value="">No project</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.project_name}</option>
                  ))}
                </select>
              </div>

              {/* Assignees */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-outline mb-2">
                  Assignees
                </label>
                <div className="border border-outline-variant rounded-xl p-2 max-h-36 overflow-y-auto space-y-0.5">
                  {teamMembers.map(m => (
                    <label
                      key={m.id}
                      className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-surface-container-low cursor-pointer"
                    >
                      <div
                        onClick={() => toggleAssigneeInForm(m.id)}
                        className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                          addForm.assignee_ids.includes(m.id)
                            ? 'bg-primary border-primary'
                            : 'border-outline-variant'
                        }`}
                      >
                        {addForm.assignee_ids.includes(m.id) && (
                          <span className="material-symbols-outlined text-white text-xs">check</span>
                        )}
                      </div>
                      <span className="text-sm text-on-surface font-medium flex-1">{m.name}</span>
                      <span className="text-xs text-on-surface-variant">{m.role}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Due date + Priority */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-outline mb-2">
                    Due date
                  </label>
                  <input
                    type="date"
                    value={addForm.due_date}
                    onChange={e => setAddForm(p => ({ ...p, due_date: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-outline-variant rounded-xl outline-none focus:ring-2 focus:ring-primary/20 text-sm bg-surface-container-low text-on-surface"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-outline mb-2">
                    Priority
                  </label>
                  <div className="flex gap-1">
                    {(['high', 'medium', 'low'] as const).map(p => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setAddForm(prev => ({ ...prev, priority: p }))}
                        className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${
                          addForm.priority === p
                            ? p === 'high'
                              ? 'bg-error-container text-on-error-container'
                              : p === 'medium'
                              ? 'bg-secondary-container text-on-secondary-container'
                              : 'bg-tertiary-container text-on-tertiary-container'
                            : 'bg-surface-container text-outline-variant hover:bg-surface-container-high'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-outline-variant/10 flex gap-3">
              <button
                onClick={() => setShowAddModal(false)}
                className="flex-1 py-2.5 px-4 border border-outline-variant rounded-xl text-on-surface font-bold text-sm hover:bg-surface-container transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTask}
                disabled={!addForm.title.trim() || saving}
                className="flex-1 py-2.5 px-4 bg-primary text-on-primary rounded-xl font-bold text-sm hover:bg-primary-container transition-colors disabled:opacity-40"
              >
                {saving ? 'Saving...' : 'Add Task'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Project Info Modal */}
      {(projectInfo !== null || loadingProjectInfo) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-surface-container-lowest w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant/10 flex items-center justify-between">
              <h3 className="font-bold text-on-surface">Project Details</h3>
              <button
                onClick={() => setProjectInfo(null)}
                className="p-1 hover:bg-surface-container rounded-lg transition-colors"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            {loadingProjectInfo ? (
              <div className="py-12 text-center text-on-surface-variant text-sm">Loading...</div>
            ) : projectInfo && (
              <div className="p-6 space-y-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-outline mb-0.5">
                    Project
                  </p>
                  <p className="font-bold text-on-surface text-lg leading-tight">
                    {projectInfo.project.project_name}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-outline mb-0.5">
                      Client
                    </p>
                    <p className="text-sm font-medium text-on-surface">
                      {projectInfo.project.client_name}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-outline mb-0.5">
                      Value
                    </p>
                    <p className="text-sm font-medium text-on-surface">
                      ${Number(projectInfo.project.project_value).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-outline mb-0.5">
                      Status
                    </p>
                    <span className="px-2 py-0.5 bg-surface-container text-on-surface-variant rounded-md text-xs font-bold">
                      {projectInfo.status}
                    </span>
                  </div>
                </div>

                {projectInfo.project.project_description && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-outline mb-0.5">
                      Description
                    </p>
                    <p className="text-sm text-on-surface-variant leading-relaxed">
                      {projectInfo.project.project_description}
                    </p>
                  </div>
                )}

                {projectInfo.assignees.length > 0 && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-outline mb-2">
                      Team
                    </p>
                    <div className="space-y-2">
                      {projectInfo.assignees.map((a, i) => (
                        <div key={i} className="flex items-center gap-2.5">
                          <div
                            className={`w-7 h-7 rounded-full ${
                              AVATAR_COLORS[i % AVATAR_COLORS.length]
                            } text-white text-[10px] font-bold flex items-center justify-center shrink-0`}
                          >
                            {getInitials(a.name)}
                          </div>
                          <span className="text-sm font-medium text-on-surface flex-1">
                            {a.name}
                          </span>
                          <span className="text-xs text-on-surface-variant">{a.role}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TeamTasksView;
