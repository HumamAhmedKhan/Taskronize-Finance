import React, { useState, useEffect, useRef } from 'react';
import { db, supabase } from '../lib/supabase';
import { Project, IncomeStream, TeamMember, ProjectAllocation, User } from '../types';
import { Search, Filter, Plus, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, AlertCircle, TrendingUp, AlertTriangle, Rocket, MessageSquare, X, Calendar, Link as LinkIcon, Paperclip, AtSign, Send, CheckCircle2, Circle, History, Layers, Check, Edit2, Trash2, List, FolderOpen } from 'lucide-react';
import Modal from '../components/Modal';
import RichTextEditor, { RichCommentContent } from '../components/RichTextEditor';

// Plain TEXT storage — no timezone conversion ever.
// The stored value is exactly what the datetime-local input produces: "YYYY-MM-DDTHH:MM"

// For datetime-local inputs: stored value is already the correct local string, just ensure correct length.
const toDatetimeLocal = (val: string | null | undefined): string => {
  if (!val) return '';
  const plain = val.slice(0, 16); // "YYYY-MM-DDTHH:MM"
  return plain.includes('T') ? plain : plain + 'T00:00';
};

// Display: parse string parts directly, no Date object, no timezone.
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const formatDisplayDatetime = (val: string | null | undefined): string => {
  if (!val) return '';
  const [datePart, timePart] = val.slice(0, 16).split('T');
  if (!datePart) return val;
  const [y, mo, d] = datePart.split('-').map(Number);
  const month = MONTHS[mo - 1];
  if (!month || isNaN(y) || isNaN(d)) return '';
  if (!timePart) return `${month} ${d}, ${y}`;
  const [h, min] = timePart.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${month} ${d}, ${y} ${h12}:${String(min).padStart(2, '0')} ${period}`;
};

// Parse plain "YYYY-MM-DDTHH:MM" string into a local Date (for comparisons/timers only).
const parsePlainLocal = (val: string | null | undefined): Date => {
  if (!val) return new Date(NaN);
  const [datePart, timePart = '00:00'] = val.slice(0, 16).split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, min] = timePart.split(':').map(Number);
  return new Date(y, mo - 1, d, h, min);
};

interface ProjectManagementViewProps {
  globalStart: string;
  globalEnd: string;
  currentUser?: User | null;
}

interface Subtask {
  id: string;
  title: string;
  completed: boolean;
  start_date?: string;
  due_date?: string;
  assignee_id?: string;
}

interface ChecklistItem {
  id: string;
  title: string;
  completed: boolean;
}

interface Activity {
  id: string;
  project_id: number;
  user_id: number;
  user_name: string;
  user_avatar?: string;
  action: string;
  content?: string;
  created_at: string;
}

interface Tag {
  name: string;
  color: string;
}

interface CustomColumn {
  id: string;
  name: string;
  options: { label: string; color: string }[];
}

interface ProjectManagementData {
  status: string;
  priority: string;
  start_date: string;
  due_date: string;
  pipeline_stage_id: number | null;
  tags: (string | Tag)[];
  description: string;
  progress: number;
  subtasks: Subtask[];
  dependencies: number[];
  compliance_checklist: ChecklistItem[];
  custom_fields?: Record<string, string>;
}

const ProjectManagementView: React.FC<ProjectManagementViewProps> = ({ globalStart, globalEnd, currentUser }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentView, setCurrentView] = useState<'list' | 'calendar' | 'gantt' | 'kanban'>('list');
  const [ganttZoom, setGanttZoom] = useState<'today' | 'day' | 'week' | 'month'>('month');
  const [ganttExpanded, setGanttExpanded] = useState<Set<number>>(new Set());
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [expandedProjects, setExpandedProjects] = useState<Set<number>>(() => {
    try {
      const saved = localStorage.getItem('pm_expandedProjects');
      return saved ? new Set<number>(JSON.parse(saved)) : new Set<number>();
    } catch { return new Set<number>(); }
  });

  const persistExpanded = (next: Set<number>) => {
    setExpandedProjects(next);
    try { localStorage.setItem('pm_expandedProjects', JSON.stringify([...next])); } catch {}
  };
  const [incomeStreams, setIncomeStreams] = useState<IncomeStream[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [allocations, setAllocations] = useState<ProjectAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Local state for project management data
  const [managementData, setManagementData] = useState<Record<number, ProjectManagementData>>({});
  const [activities, setActivities] = useState<Activity[]>([]);
  
  // Custom Statuses state
  const [statuses, setStatuses] = useState<{id: string, name: string, color: string}[]>([]);

  // Statuses are loaded inside loadData (below) so they're resolved before
  // project rows are auto-created. This ref holds the resolved list so loadData
  // can use it without depending on the statuses React state (which would be
  // stale on first render).
  const statusesRef = useRef<{id: string, name: string, color: string}[]>([]);
  
  // Modal state
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [editData, setEditData] = useState<ProjectManagementData>({ 
    status: 'ToDo', 
    priority: 'medium', 
    start_date: '',
    due_date: '',
    pipeline_stage_id: null,
    tags: [],
    description: '',
    progress: 0,
    subtasks: [],
    dependencies: [],
    compliance_checklist: []
  });

  const [newTag, setNewTag] = useState('');
  const [newTagColor, setNewTagColor] = useState('');
  const [newSubtask, setNewSubtask] = useState('');
  const [newDependency, setNewDependency] = useState('');
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
  const [dateError, setDateError] = useState('');

  useEffect(() => { setDateError(''); }, [selectedProject]);

  // Status management state
  const [showPipelineModal, setShowPipelineModal] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState('');
  const [newPipelineColor, setNewPipelineColor] = useState('bg-slate-100 text-slate-800');
  const [editingPipelineId, setEditingPipelineId] = useState<string | null>(null);
  const [editingPipelineName, setEditingPipelineName] = useState('');
  const [editingPipelineColor, setEditingPipelineColor] = useState('bg-slate-100 text-slate-800');
  const [statusToDelete, setStatusToDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Brief generation state
  const [briefGenerating, setBriefGenerating] = useState<Set<number>>(new Set());
  const [briefToast, setBriefToast] = useState<string | null>(null);
  const [isSavingMgmt, setIsSavingMgmt] = useState(false);

  // Bulk Edit state
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<number>>(new Set());
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkEditFields, setBulkEditFields] = useState({
    updateStatus: false,
    status: '',
    updateStartDate: false,
    start_date: '',
    updateDueDate: false,
    due_date: '',
    updateAssignees: false,
    assignees: [] as number[]
  });
  const [isMoving, setIsMoving] = useState(false);
  const [dividerPct, setDividerPct] = useState(60);
  const isDragging = useRef(false);

  // Resizable column widths (persisted to localStorage)
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('pm_colWidths');
      return saved ? JSON.parse(saved) : { name: 280, tags: 120, assignee: 130, dueDate: 155, priority: 100, taskStatus: 130 };
    } catch { return { name: 280, tags: 120, assignee: 130, dueDate: 155, priority: 100, taskStatus: 130 }; }
  });
  const resizingCol = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  // Custom columns
  const [customColumns, setCustomColumns] = useState<CustomColumn[]>([]);
  const [showCustomColModal, setShowCustomColModal] = useState(false);
  const [customColForm, setCustomColForm] = useState<{ id: string | null; name: string; options: { label: string; color: string }[] }>({ id: null, name: '', options: [] });
  const [customColNewLabel, setCustomColNewLabel] = useState('');
  const [customColNewColor, setCustomColNewColor] = useState('#3b82f6');

  // Inline dropdowns for status/priority/custom-column cells in list view
  const [openStatusDropdown, setOpenStatusDropdown] = useState<number | null>(null);
  const [openPriorityDropdown, setOpenPriorityDropdown] = useState<number | null>(null);
  const [openCcDropdown, setOpenCcDropdown] = useState<{ projectId: number; colId: string } | null>(null);
  // Inline add-new row state
  const [addingToGroup, setAddingToGroup] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  // Column menu panel
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  // Column order (persisted to localStorage)
  const [colOrder, setColOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('pm_colOrder');
      return saved ? JSON.parse(saved) : ['name', 'tags', 'assignee', 'dueDate', 'priority', 'taskStatus'];
    } catch { return ['name', 'tags', 'assignee', 'dueDate', 'priority', 'taskStatus']; }
  });
  const draggingColKey = useRef<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        // Load statuses first so they are available when auto-creating project rows below.
        const fallbackStatuses = [
          { id: '1', name: 'Kickoff', color: 'bg-blue-100 text-blue-800' },
          { id: '2', name: 'Web UI', color: 'bg-purple-100 text-purple-800' },
          { id: '3', name: 'Development', color: 'bg-emerald-100 text-emerald-800' },
          { id: '4', name: 'Completed', color: 'bg-gray-100 text-gray-800' }
        ];
        try {
          const { data: statusData, error: statusError } = await supabase.from('project_statuses').select('*').order('created_at', { ascending: true });
          if (statusError) throw statusError;
          const resolved = (statusData && statusData.length > 0) ? statusData : fallbackStatuses;
          statusesRef.current = resolved;
          setStatuses(resolved);
        } catch {
          statusesRef.current = fallbackStatuses;
          setStatuses(fallbackStatuses);
        }

        // Load custom columns (graceful fallback if table doesn't exist yet)
        try {
          const { data: colData } = await supabase.from('project_custom_columns').select('*').order('sort_order', { ascending: true });
          if (colData) setCustomColumns(colData.map((c: any) => ({ id: c.id, name: c.name, options: c.options || [] })));
        } catch { /* project_custom_columns table not yet created */ }

        const [projData, streamData, teamData, allocData] = await Promise.all([
          supabase.from('projects').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }),
          db.get<IncomeStream>('income_streams'),
          db.get<TeamMember>('team_members'),
          db.get<ProjectAllocation>('project_allocations')
        ]);

        const rawProjects = projData.data || [];

        // Filter projects based on user role
        let filteredProjects = rawProjects;
        if (currentUser && currentUser.user_type !== 'admin') {
          if (currentUser.user_type === 'partner') {
            // Partners see all projects from their linked income streams
            const partnerStreamIds: number[] = currentUser.linked_income_stream_ids || [];
            filteredProjects = partnerStreamIds.length > 0
              ? rawProjects.filter(p => partnerStreamIds.includes(p.income_stream_id))
              : rawProjects;
          } else {
            // Team members see only projects they are allocated to
            const currentTeamMember = teamData?.find(tm => tm.id === currentUser.team_member_id);
            if (currentTeamMember) {
              const allocatedProjectIds = new Set(
                (allocData || [])
                  .filter(a => a.team_member_id === currentTeamMember.id)
                  .map(a => a.project_id)
              );
              filteredProjects = rawProjects.filter(p => allocatedProjectIds.has(p.id));
            } else {
              filteredProjects = [];
            }
          }
        }

        setProjects(filteredProjects);
        setIncomeStreams(streamData || []);
        setTeamMembers(teamData || []);
        setAllocations(allocData || []);

        const projectIds = filteredProjects.map(p => p.id);

        const [mgmtResult, actResult] = await Promise.all([
          projectIds.length > 0
            ? supabase.from('project_management').select('*').in('project_id', projectIds)
            : Promise.resolve({ data: [] as any[], error: null }),
          projectIds.length > 0
            ? supabase.from('project_activities').select('*').in('project_id', projectIds).order('created_at', { ascending: false })
            : Promise.resolve({ data: [] as any[], error: null })
        ]);

        // Build managementData map from project_management rows
        const formattedData: Record<number, ProjectManagementData> = {};
        (mgmtResult.data || []).forEach((row: any) => {
          formattedData[row.project_id] = {
            status: row.pipeline_status || statusesRef.current[0]?.name || 'Uncategorized',
            priority: row.priority || 'medium',
            start_date: row.start_date || '',
            due_date: row.due_date || '',
            pipeline_stage_id: row.pipeline_stage_id ?? null,
            tags: row.tags || [],
            description: row.description || '',
            progress: row.progress || 0,
            subtasks: row.subtasks || [],
            dependencies: row.dependencies || [],
            compliance_checklist: row.compliance_checklist || [],
            custom_fields: row.custom_fields || {}
          };
        });

        // Auto-create default rows for projects with no project_management entry
        const missingIds = filteredProjects.filter(p => !formattedData[p.id]);
        if (missingIds.length > 0) {
          const defaultRows = missingIds.map(p => ({
            project_id: p.id,
            pipeline_status: statusesRef.current[0]?.name || 'Uncategorized',
            task_status: 'ToDo',
            priority: 'medium',
            start_date: p.date || null,
            due_date: null,
            pipeline_stage_id: p.income_stream_id || null,
            tags: [],
            description: '',
            progress: 0,
            subtasks: [],
            dependencies: [],
            compliance_checklist: []
          }));
          const { error: insertError } = await supabase.from('project_management').insert(defaultRows);
          if (insertError) console.error('Failed to auto-create project_management rows:', insertError);
          missingIds.forEach(p => {
            formattedData[p.id] = {
              status: statusesRef.current[0]?.name || 'Uncategorized',
              priority: 'medium',
              start_date: p.date || '',
              due_date: '',
              pipeline_stage_id: p.income_stream_id || null,
              tags: [],
              description: '',
              progress: 0,
              subtasks: [],
              dependencies: [],
              compliance_checklist: []
            };
          });
        }

        setManagementData(formattedData);
        setActivities((actResult.data || []).map((row: any) => ({
          id: row.id?.toString() || Date.now().toString(),
          project_id: row.project_id,
          user_id: row.user_id,
          user_name: row.user_name,
          action: row.action,
          content: row.content,
          created_at: row.created_at
        })));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const saveManagementData = async (projectId: number, mgmtData: ProjectManagementData) => {
    const payload = {
      pipeline_status: mgmtData.status,
      task_status: mgmtData.status,
      priority: mgmtData.priority,
      start_date: mgmtData.start_date || null,
      due_date: mgmtData.due_date || null,
      pipeline_stage_id: mgmtData.pipeline_stage_id,
      tags: mgmtData.tags,
      description: mgmtData.description,
      progress: mgmtData.progress,
      subtasks: mgmtData.subtasks,
      dependencies: mgmtData.dependencies,
      compliance_checklist: mgmtData.compliance_checklist,
      ...(mgmtData.custom_fields && Object.keys(mgmtData.custom_fields).length > 0 ? { custom_fields: mgmtData.custom_fields } : {})
    };
    try {
      const { data: updated, error: updateError } = await supabase
        .from('project_management')
        .update(payload)
        .eq('project_id', projectId)
        .select('id');
      if (updateError) throw updateError;

      // Row didn't exist yet — insert it
      if (!updated || updated.length === 0) {
        const { error: insertError } = await supabase
          .from('project_management')
          .insert({ project_id: projectId, task_status: 'ToDo', ...payload });
        if (insertError) throw insertError;
      }
    } catch (e) {
      console.error('Failed to save management data', e);
    }
  };

  const saveActivityToDb = async (activity: Activity) => {
    try {
      const { error } = await supabase.from('project_activities').insert({
        project_id: activity.project_id,
        user_id: typeof activity.user_id === 'number' ? activity.user_id : null,
        user_name: activity.user_name,
        action: activity.action,
        content: activity.content || null,
        created_at: activity.created_at
      });
      if (error) throw error;
    } catch (e) {
      console.error('Failed to save activity', e);
    }
  };

  const handleSaveManagementData = async () => {
    if (!selectedProject || isSavingMgmt) return;

    const missingStart = !editData.start_date;
    const missingDue = !editData.due_date;
    if (missingStart && missingDue) {
      setDateError('Please save both a start date and due date.');
      return;
    } else if (missingStart) {
      setDateError('Please save a start date.');
      return;
    } else if (missingDue) {
      setDateError('Please save a due date.');
      return;
    }
    setDateError('');
    setIsSavingMgmt(true);

    const existingData = managementData[selectedProject.id] || {
      status: statuses[0]?.name || 'Uncategorized',
      priority: 'medium',
      start_date: selectedProject.date,
      due_date: '',
      pipeline_stage_id: selectedProject.income_stream_id,
      tags: [],
      description: '',
      progress: 0,
      subtasks: [],
      dependencies: [],
      compliance_checklist: []
    };
    const newActivities: Activity[] = [];
    
    if (existingData.status !== editData.status) {
      newActivities.push({
        id: Date.now().toString() + '-status',
        project_id: selectedProject.id,
        user_id: currentUser?.id || null,
        user_name: currentUser?.name || currentUser?.username || 'System',
        action: 'updated status to',
        content: editData.status,
        created_at: new Date().toISOString()
      });
    }
    
    if (existingData.priority !== editData.priority) {
      newActivities.push({
        id: Date.now().toString() + '-priority',
        project_id: selectedProject.id,
        user_id: currentUser?.id || null,
        user_name: currentUser?.name || currentUser?.username || 'System',
        action: 'changed priority to',
        content: editData.priority,
        created_at: new Date().toISOString()
      });
    }
    
    if (existingData.due_date !== editData.due_date) {
      newActivities.push({
        id: Date.now().toString() + '-due',
        project_id: selectedProject.id,
        user_id: currentUser?.id || null,
        user_name: currentUser?.name || currentUser?.username || 'System',
        action: 'set due date to',
        content: formatDisplayDatetime(editData.due_date),
        created_at: new Date().toISOString()
      });
    }

    // If pipeline stage changed, update the project's income_stream_id
    if (existingData.pipeline_stage_id !== editData.pipeline_stage_id) {
      try {
        await db.update('projects', selectedProject.id, { income_stream_id: editData.pipeline_stage_id });
        setProjects(projects.map(p => p.id === selectedProject.id ? { ...p, income_stream_id: editData.pipeline_stage_id || 0 } : p));
        
        const pipelineName = incomeStreams.find(s => s.id === editData.pipeline_stage_id)?.name || 'Uncategorized';
        newActivities.push({
          id: Date.now().toString() + '-pipeline',
          project_id: selectedProject.id,
          user_id: currentUser?.id || null,
          user_name: currentUser?.name || currentUser?.username || 'System',
          action: 'moved to pipeline',
          content: pipelineName,
          created_at: new Date().toISOString()
        });
      } catch (e) {
        console.error('Failed to update project pipeline', e);
      }
    }
    
    const updatedActivities = [...newActivities, ...activities];
    if (newActivities.length > 0) {
      setActivities(updatedActivities);
      for (const act of newActivities) {
        await saveActivityToDb(act);
      }
    }

    const mergedData: ProjectManagementData = { ...existingData, ...editData };

    setManagementData({ ...managementData, [selectedProject.id]: mergedData });
    await saveManagementData(selectedProject.id, mergedData);

    setSelectedProject(null);
    setIsSavingMgmt(false);
  };

  const handleAddComment = async (html: string) => {
    if (!html || html === '<p></p>' || !selectedProject || !currentUser) return;

    const activity: Activity = {
      id: Date.now().toString(),
      project_id: selectedProject.id,
      user_id: currentUser.id,
      user_name: currentUser.name || currentUser.username,
      action: 'commented',
      content: html,
      created_at: new Date().toISOString()
    };

    setActivities([activity, ...activities]);
    await saveActivityToDb(activity);
    await checkAndFireAutomations(selectedProject.id, 'comment_added', {});
  };

  const handleAddActivity = async (action: string, content?: string) => {
    if (!selectedProject || !currentUser) return;
    
    const activity: Activity = {
      id: Date.now().toString(),
      project_id: selectedProject.id,
      user_id: currentUser.id,
      user_name: currentUser.name || currentUser.username,
      action,
      content,
      created_at: new Date().toISOString()
    };
    
    setActivities([activity, ...activities]);
    await saveActivityToDb(activity);
  };

  const handleSaveCustomColumn = async () => {
    if (!customColForm.name.trim()) return;
    try {
      if (customColForm.id) {
        await supabase.from('project_custom_columns').update({ name: customColForm.name, options: customColForm.options }).eq('id', customColForm.id);
        setCustomColumns(prev => prev.map(c => c.id === customColForm.id ? { ...c, name: customColForm.name, options: customColForm.options } : c));
      } else {
        const { data } = await supabase.from('project_custom_columns').insert({ name: customColForm.name, options: customColForm.options, sort_order: customColumns.length }).select().single();
        if (data) setCustomColumns(prev => [...prev, { id: data.id, name: data.name, options: data.options || [] }]);
      }
      setShowCustomColModal(false);
    } catch {
      alert('Could not save column. Run this SQL in Supabase first:\nCREATE TABLE project_custom_columns (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, name text NOT NULL, options jsonb DEFAULT \'[]\', sort_order int DEFAULT 0, created_at timestamptz DEFAULT now());\nALTER TABLE project_management ADD COLUMN IF NOT EXISTS custom_fields jsonb DEFAULT \'{}\';');
    }
  };

  const handleDeleteCustomColumn = async (id: string) => {
    if (!confirm('Delete this column and all its values?')) return;
    try {
      await supabase.from('project_custom_columns').delete().eq('id', id);
      setCustomColumns(prev => prev.filter(c => c.id !== id));
    } catch { alert('Delete failed.'); }
  };

  const handleAddProject = async (statusName: string) => {
    if (!newProjectName.trim()) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const newProject = await db.insert<Project>('projects', {
        date: today,
        project_name: newProjectName.trim(),
        client_name: '',
        income_stream_id: null,
        project_value: 0,
        created_at: new Date().toISOString()
      });
      if (newProject) {
        setProjects(prev => [newProject, ...prev]);
        const newMgmt: ProjectManagementData = {
          status: statusName,
          priority: 'medium',
          start_date: today,
          due_date: '',
          pipeline_stage_id: null,
          tags: [],
          description: '',
          progress: 0,
          subtasks: [],
          dependencies: [],
          compliance_checklist: [],
          custom_fields: {}
        };
        setManagementData(prev => ({ ...prev, [newProject.id]: newMgmt }));
        await saveManagementData(newProject.id, newMgmt);
      }
    } catch (e) {
      console.error('Failed to create project', e);
    }
    setNewProjectName('');
    setAddingToGroup(null);
  };

  const handlePriorityChange = async (projectId: number, newPriority: string) => {
    const existingData = managementData[projectId];
    if (!existingData || existingData.priority === newPriority) return;
    const updated = { ...existingData, priority: newPriority };
    setManagementData(prev => ({ ...prev, [projectId]: updated }));
    await saveManagementData(projectId, updated);
  };

  const checkAndFireAutomations = async (
    projectId: number,
    eventType: string,
    eventData: Record<string, any>
  ) => {
    try {
      // Load all active automations — we check both primary and extra triggers
      const { data: allActive } = await supabase
        .from('automations')
        .select('*')
        .eq('is_active', true);

      if (!allActive || allActive.length === 0) return;

      // Keep only automations whose primary OR any extra trigger matches eventType
      const activeAutomations = allActive.filter(a => {
        if (a.trigger_event === eventType) return true;
        const extra: any[] = a.action_config?.extra_triggers || [];
        return extra.some((t: any) => t.event === eventType);
      });

      if (activeAutomations.length === 0) return;

      const project = projects.find(p => p.id === projectId);
      if (!project) return;

      const mgmt = managementData[projectId];
      const projectAllocations = allocations.filter(a => a.project_id === projectId);
      const assigneeNames = projectAllocations
        .map(a => teamMembers.find(t => t.id === a.team_member_id)?.name)
        .filter(Boolean)
        .join(', ');
      const assigneeSlacks = projectAllocations
        .map(a => {
          const tm = teamMembers.find(t => t.id === a.team_member_id);
          return tm?.slack_username ? `<@${tm.slack_username.replace(/^@/, '')}>` : null;
        })
        .filter(Boolean)
        .join(' ');

      for (const automation of activeAutomations) {
        // Find the conditions for the matching trigger
        let conditions: any[];
        if (automation.trigger_event === eventType) {
          conditions = automation.trigger_conditions || [];
        } else {
          const extra: any[] = automation.action_config?.extra_triggers || [];
          const matchedExtra = extra.find((t: any) => t.event === eventType);
          conditions = matchedExtra?.conditions || [];
        }

        // Check conditions — condition value for due_date_overdue is in total minutes
        let conditionsMet = true;
        for (const cond of conditions) {
          if (eventType === 'status_changed') {
            if (cond.field === 'status_from' && cond.value && cond.value !== eventData.from) { conditionsMet = false; break; }
            if (cond.field === 'status_to' && cond.value && cond.value !== eventData.to) { conditionsMet = false; break; }
          }
          if (eventType === 'due_date_overdue' && cond.value) {
            const thresholdMinutes = parseInt(cond.value);
            const overdueMinutes = eventData.overdueMinutes ?? (eventData.overdueHours ?? 0) * 60;
            if (!isNaN(thresholdMinutes) && overdueMinutes < thresholdMinutes) { conditionsMet = false; break; }
          }
          if (eventType === 'assignee_added' && cond.value) {
            if (String(eventData.team_member_id) !== String(cond.value)) { conditionsMet = false; break; }
          }
        }

        if (!conditionsMet) continue;

        // For overdue events: dedup via in-memory set (synchronous) + DB log (cross-session)
        if (eventType === 'due_date_overdue' && eventData.due_date) {
          const fireKey = `${automation.id}-${projectId}-${eventData.due_date}`;

          if (firedAutomations.current.has(fireKey)) continue;

          const { data: existingLog, error: logCheckError } = await supabase
            .from('automation_logs')
            .select('id')
            .eq('automation_id', automation.id)
            .eq('project_id', projectId)
            .eq('due_date', eventData.due_date)
            .maybeSingle();
          if (logCheckError) {
            console.error('automation_logs check failed:', logCheckError.message);
            continue;
          }
          if (existingLog) {
            firedAutomations.current.add(fireKey);
            continue;
          }

          firedAutomations.current.add(fireKey);

          const { error: insertError } = await supabase.from('automation_logs').insert({
            automation_id: automation.id,
            project_id: projectId,
            due_date: eventData.due_date,
          });
          if (insertError) {
            firedAutomations.current.delete(fireKey);
            console.error('automation_logs insert failed:', insertError.message);
            continue;
          }
        }

        // Resolve actions array — support legacy single-action and new multi-action format
        const cfg = automation.action_config || {};
        const actions: any[] = cfg.actions?.length
          ? cfg.actions
          : [{ type: automation.action_type, ...cfg }];

        let didFire = false;
        for (const actionItem of actions) {
          if (actionItem.type === 'send_slack_message') {
            const webhookUrl = actionItem.webhook_url || import.meta.env.VITE_SLACK_WEBHOOK_URL;
            if (!webhookUrl) continue;

            const message = (actionItem.message || '')
              .replace(/{project_name}/g, project.project_name || '')
              .replace(/{status}/g, mgmt?.status || eventData.to || '')
              .replace(/{due_date}/g, formatDisplayDatetime(mgmt?.due_date || ''))
              .replace(/{assignee}/g, assigneeNames)
              .replace(/{assignee_slack}/g, assigneeSlacks);

            try {
              await supabase.functions.invoke('send-slack', {
                body: { webhook_url: webhookUrl, message, channel: actionItem.channel || undefined },
                headers: { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
              });
              didFire = true;
            } catch (e) {
              console.error('Failed to send Slack message', e);
            }

          } else if (actionItem.type === 'change_status' && actionItem.status && mgmt) {
            const newMgmt = { ...mgmt, status: actionItem.status };
            setManagementData(prev => ({ ...prev, [projectId]: newMgmt }));
            await saveManagementData(projectId, newMgmt);
            didFire = true;

          } else if (actionItem.type === 'change_assignee' && actionItem.assignee_id) {
            const memberId = parseInt(actionItem.assignee_id);
            const alreadyAssigned = allocations.some(
              a => a.project_id === projectId && a.team_member_id === memberId
            );
            if (!alreadyAssigned) {
              try {
                const { data: newAlloc } = await supabase
                  .from('project_allocations')
                  .insert({ project_id: projectId, team_member_id: memberId })
                  .select()
                  .single();
                if (newAlloc) setAllocations(prev => [...prev, newAlloc]);
                didFire = true;
              } catch (e) {
                console.error('Failed to change assignee', e);
              }
            }

          } else if (actionItem.type === 'create_subtask' && actionItem.subtask_title && mgmt) {
            const newSubtask = {
              id: Date.now().toString(),
              title: actionItem.subtask_title,
              completed: false,
            };
            const newMgmt = { ...mgmt, subtasks: [...(mgmt.subtasks || []), newSubtask] };
            setManagementData(prev => ({ ...prev, [projectId]: newMgmt }));
            await saveManagementData(projectId, newMgmt);
            didFire = true;
          }
        }

        if (didFire) {
          await supabase
            .from('automations')
            .update({ last_triggered_at: new Date().toISOString() })
            .eq('id', automation.id);
        }
      }
    } catch (err) {
      console.error('checkAndFireAutomations error', err);
    }
  };

  const overdueTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Tracks combos already scheduled this session to prevent duplicate timers across re-renders
  const scheduledOverdue = useRef<Set<string>>(new Set());
  // Tracks automations already fired this session — synchronous guard before any async DB check
  const firedAutomations = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!projects.length || !Object.keys(managementData).length) return;

    const schedule = async () => {
      // Load all active automations — include those with due_date_overdue as an extra trigger
      const { data: allActive } = await supabase
        .from('automations')
        .select('*')
        .eq('is_active', true);

      const automations = (allActive || []).filter(a => {
        if (a.trigger_event === 'due_date_overdue') return true;
        const extra: any[] = a.action_config?.extra_triggers || [];
        return extra.some((t: any) => t.event === 'due_date_overdue');
      });

      if (automations.length === 0) return;

      const now = Date.now();

      for (const project of projects) {
        const mgmt = managementData[project.id];
        if (!mgmt?.due_date) continue;

        const dueMs = parsePlainLocal(mgmt.due_date).getTime();
        if (isNaN(dueMs)) continue;

        for (const automation of automations) {
          const key = `${automation.id}:${project.id}:${mgmt.due_date}`;
          if (scheduledOverdue.current.has(key)) continue;
          scheduledOverdue.current.add(key);

          // Get conditions for the due_date_overdue trigger (primary or extra)
          let conditions: any[];
          if (automation.trigger_event === 'due_date_overdue') {
            conditions = automation.trigger_conditions || [];
          } else {
            const extra: any[] = automation.action_config?.extra_triggers || [];
            const matched = extra.find((t: any) => t.event === 'due_date_overdue');
            conditions = matched?.conditions || [];
          }

          // Condition value is stored as total minutes
          const thresholdMinutes = conditions.reduce((acc: number, c: any) => {
            const v = parseInt(c.value);
            return isNaN(v) ? acc : Math.max(acc, v);
          }, 0);

          const fireAt = dueMs + thresholdMinutes * 60 * 1000;
          const delay = fireAt - now;
          const overdueMinutes = Math.max(0, (now - dueMs) / 60000);

          if (delay <= 0) {
            const t = setTimeout(() => {
              checkAndFireAutomations(project.id, 'due_date_overdue', { overdueMinutes, due_date: mgmt.due_date });
            }, 0);
            overdueTimers.current.push(t);
          } else {
            const t = setTimeout(() => {
              checkAndFireAutomations(project.id, 'due_date_overdue', { overdueMinutes: thresholdMinutes, due_date: mgmt.due_date });
            }, delay);
            overdueTimers.current.push(t);
          }
        }
      }
    };

    schedule();

    return () => {
      overdueTimers.current.forEach(clearTimeout);
      overdueTimers.current = [];
      // Reset dedup set so timers are rescheduled on next render.
      // Without this, cleared timers would never be re-added because the key
      // was already in scheduledOverdue.
      scheduledOverdue.current = new Set();
    };
  }, [projects, managementData]);

  // Close inline dropdowns and column menu when clicking outside
  useEffect(() => {
    const close = () => {
      setOpenStatusDropdown(null);
      setOpenPriorityDropdown(null);
      setOpenCcDropdown(null);
      setShowColumnMenu(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  // Column resize — global mouse tracking
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingCol.current) return;
      const { key, startX, startWidth } = resizingCol.current;
      const next = Math.max(60, startWidth + (e.clientX - startX));
      setColWidths(prev => {
        const updated = { ...prev, [key]: next };
        try { localStorage.setItem('pm_colWidths', JSON.stringify(updated)); } catch {}
        return updated;
      });
    };
    const onUp = () => { resizingCol.current = null; document.body.style.cursor = ''; };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, []);

  const toggleAssignee = async (teamMemberId: number) => {
    if (!selectedProject) return;
    
    const existingAlloc = allocations.find(a => a.project_id === selectedProject.id && a.team_member_id === teamMemberId);
    
    if (existingAlloc) {
      // Remove allocation
      await db.delete('project_allocations', existingAlloc.id);
      setAllocations(allocations.filter(a => a.id !== existingAlloc.id));
      
      const member = teamMembers.find(tm => tm.id === teamMemberId);
      if (member) {
        handleAddActivity('removed assignee', member.name);
      }
    } else {
      // Add allocation
      const newAlloc = await db.insert<ProjectAllocation>('project_allocations', {
        project_id: selectedProject.id,
        team_member_id: teamMemberId,
        role: 'Assignee',
        amount: 0,
        created_at: new Date().toISOString()
      });
      
      if (newAlloc) {
        setAllocations([...allocations, newAlloc]);
        const member = teamMembers.find(tm => tm.id === teamMemberId);
        if (member) {
          handleAddActivity('added assignee', member.name);
          await checkAndFireAutomations(selectedProject.id, 'assignee_added', { team_member_id: teamMemberId });
        }
      }
    }
  };

  const handleCreatePipeline = async () => {
    if (!newPipelineName.trim()) {
      setShowPipelineModal(false);
      return;
    }

    const newStatus = {
      id: Date.now().toString(),
      name: newPipelineName.trim(),
      color: newPipelineColor
    };

    try {
      const { error } = await supabase.from('project_statuses').insert([newStatus]);
      if (error) throw error;
      setStatuses([...statuses, newStatus]);
      setNewPipelineName('');
      setNewPipelineColor('bg-slate-100 text-slate-800');
      setShowPipelineModal(false);
    } catch (err) {
      console.error('Error creating pipeline:', err);
      setError('Failed to create pipeline. Please try again.');
    }
  };

  const handleUpdatePipeline = async (id: string) => {
    if (!editingPipelineName.trim()) return;
    
    try {
      const { error } = await supabase.from('project_statuses').update({ name: editingPipelineName.trim(), color: editingPipelineColor }).eq('id', id);
      if (error) throw error;
      setStatuses(statuses.map(s => s.id === id ? { ...s, name: editingPipelineName.trim(), color: editingPipelineColor } : s));
      setEditingPipelineId(null);
      setEditingPipelineName('');
      setEditingPipelineColor('bg-slate-100 text-slate-800');
    } catch (err) {
      console.error('Error updating pipeline:', err);
      setError('Failed to update pipeline. Please try again.');
    }
  };

  const moveStatus = async (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === statuses.length - 1) return;

    const newStatuses = [...statuses];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    
    // Swap in local state
    const temp = newStatuses[index];
    newStatuses[index] = newStatuses[targetIndex];
    newStatuses[targetIndex] = temp;
    
    setStatuses(newStatuses);
    
    try {
      const { data: row1 } = await supabase.from('project_statuses').select('id, created_at').eq('id', statuses[index].id).single();
      const { data: row2 } = await supabase.from('project_statuses').select('id, created_at').eq('id', statuses[targetIndex].id).single();
      
      if (row1 && row2) {
        await supabase.from('project_statuses').update({ created_at: row2.created_at }).eq('id', row1.id);
        await supabase.from('project_statuses').update({ created_at: row1.created_at }).eq('id', row2.id);
      }
    } catch (err) {
      console.error('Failed to swap created_at', err);
    }
  };

  const handleDeleteStatus = (id: string) => {
    setStatusToDelete(id);
  };

  const confirmDeleteStatus = async () => {
    if (statusToDelete) {
      try {
        const { error } = await supabase.from('project_statuses').delete().eq('id', statusToDelete);
        if (error) throw error;
        setStatuses(statuses.filter(s => s.id !== statusToDelete));
        setStatusToDelete(null);
      } catch (err) {
        console.error('Error deleting pipeline:', err);
        setError('Failed to delete pipeline. Please try again.');
      }
    }
  };

  const handleStatusChange = async (projectId: number, newStatusName: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    
    const existingData = managementData[projectId] || {
      status: statuses[0]?.name || 'Kickoff',
      priority: 'medium',
      start_date: project.date,
      due_date: '',
      pipeline_stage_id: project.income_stream_id,
      tags: [],
      description: '',
      progress: 0,
      subtasks: [],
      dependencies: [],
      compliance_checklist: []
    };

    if (existingData.status === newStatusName) return;

    const newEditData = { ...existingData, status: newStatusName };
    const activity: Activity = {
      id: Date.now().toString() + '-status-' + projectId,
      project_id: projectId,
      user_id: currentUser?.id || null,
      user_name: currentUser?.name || currentUser?.username || 'System',
      action: 'moved to status',
      content: newStatusName,
      created_at: new Date().toISOString()
    };

    setManagementData({ ...managementData, [projectId]: newEditData });
    setActivities([activity, ...activities]);
    await saveManagementData(projectId, newEditData);
    await saveActivityToDb(activity);
    await checkAndFireAutomations(projectId, 'status_changed', { from: existingData.status, to: newStatusName });
  };

  const handleBulkSave = async () => {
    setIsMoving(true);
    try {
      const newManagementData = { ...managementData };
      let newActivities = [...activities];
      let newAllocations = [...allocations];

      for (const projectId of Array.from(selectedProjectIds)) {
        const project = projects.find(p => p.id === projectId);
        if (!project) continue;

        const existingData: ProjectManagementData = newManagementData[projectId] ?? {
          status: statuses[0]?.name || 'Kickoff',
          priority: 'medium',
          start_date: project.date,
          due_date: '',
          pipeline_stage_id: project.income_stream_id,
          tags: [],
          description: '',
          progress: 0,
          subtasks: [],
          dependencies: [],
          compliance_checklist: []
        };

        // Only overwrite fields the user explicitly toggled in the bulk form
        const updatedData: ProjectManagementData = {
          ...existingData,
          ...(bulkEditFields.updateStatus && bulkEditFields.status ? { status: bulkEditFields.status } : {}),
          ...(bulkEditFields.updateStartDate && bulkEditFields.start_date ? { start_date: bulkEditFields.start_date } : {}),
          ...(bulkEditFields.updateDueDate && bulkEditFields.due_date ? { due_date: bulkEditFields.due_date } : {})
        };
        const projectActivities: Activity[] = [];

        if (bulkEditFields.updateStatus && bulkEditFields.status) {
          projectActivities.push({
            id: Date.now().toString() + '-status-' + projectId,
            project_id: projectId,
            user_id: currentUser?.id || null,
            user_name: currentUser?.name || currentUser?.username || 'System',
            action: 'moved to status',
            content: bulkEditFields.status,
            created_at: new Date().toISOString()
          });
        }

        if (bulkEditFields.updateDueDate && bulkEditFields.due_date) {
          projectActivities.push({
            id: Date.now().toString() + '-due-' + projectId,
            project_id: projectId,
            user_id: currentUser?.id || null,
            user_name: currentUser?.name || currentUser?.username || 'System',
            action: 'set due date to',
            content: formatDisplayDatetime(bulkEditFields.due_date),
            created_at: new Date().toISOString()
          });
        }

        if (bulkEditFields.updateAssignees) {
          const existingAllocs = newAllocations.filter(a => a.project_id === projectId);
          for (const alloc of existingAllocs) {
            await db.delete('project_allocations', alloc.id);
          }
          newAllocations = newAllocations.filter(a => a.project_id !== projectId);

          for (const tmId of bulkEditFields.assignees) {
            const newAlloc = await db.insert<ProjectAllocation>('project_allocations', {
              project_id: projectId,
              team_member_id: tmId,
              role: 'Assignee',
              amount: 0,
              created_at: new Date().toISOString()
            });
            if (newAlloc) newAllocations.push(newAlloc);
          }

          projectActivities.push({
            id: Date.now().toString() + '-assignees-' + projectId,
            project_id: projectId,
            user_id: currentUser?.id || null,
            user_name: currentUser?.name || currentUser?.username || 'System',
            action: 'updated assignees',
            content: '',
            created_at: new Date().toISOString()
          });
        }

        newManagementData[projectId] = updatedData;
        newActivities = [...projectActivities, ...newActivities];

        await saveManagementData(projectId, updatedData);
        for (const act of projectActivities) {
          await saveActivityToDb(act);
        }
      }

      setManagementData(newManagementData);
      setActivities(newActivities);
      setAllocations(newAllocations);
      setShowBulkModal(false);
      setSelectedProjectIds(new Set());
      setIsBulkMode(false);
      
      setBulkEditFields({
        updateStatus: false,
        status: '',
        updateStartDate: false,
        start_date: '',
        updateDueDate: false,
        due_date: '',
        updateAssignees: false,
        assignees: []
      });
    } catch (e) {
      console.error('Failed to perform bulk update', e);
      setError('Failed to perform bulk update');
    } finally {
      setIsMoving(false);
    }
  };

  const handleGenerateBrief = async (project: Project) => {
    setBriefGenerating(prev => new Set(prev).add(project.id));
    try {
      const res = await fetch('https://hook.us2.make.com/lsd7rvtt6h3kr598ntwtzda5vojtbt8l', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: project.id,
          pcb_doc_id: project.pcb_doc_id,
          project_brief_doc_id: project.project_brief_doc_id,
          sensitive_doc_id: project.sensitive_doc_id,
          dev_brief_doc_id: project.dev_brief_doc_id,
        }),
      });
      if (!res.ok) throw new Error(`Webhook responded with ${res.status}`);
      await supabase.from('projects').update({ brief_generated: true }).eq('id', project.id);
      const { data: refreshed } = await supabase.from('projects').select('*').eq('id', project.id).single();
      if (refreshed) setProjects(prev => prev.map(p => p.id === project.id ? refreshed : p));
    } catch (err) {
      console.error('Brief generation failed', err);
      setBriefToast('Brief generation failed. Try again.');
      setTimeout(() => setBriefToast(null), 4000);
    } finally {
      setBriefGenerating(prev => { const n = new Set(prev); n.delete(project.id); return n; });
    }
  };

  const openEditModal = (project: Project) => {
    setSelectedProject(project);
    const existingData = managementData[project.id];
    
    // Ensure status is valid, otherwise set to Uncategorized
    let currentStatus = existingData?.status || statuses[0]?.name || 'Kickoff';
    if (currentStatus !== 'Uncategorized' && !statuses.some(s => s.name === currentStatus)) {
      currentStatus = 'Uncategorized';
    }

    setEditData({
      status: currentStatus,
      priority: existingData?.priority || 'medium',
      start_date: existingData?.start_date || project.date,
      due_date: existingData?.due_date || '',
      pipeline_stage_id: existingData?.pipeline_stage_id || project.income_stream_id,
      tags: existingData?.tags || [],
      description: existingData?.description || '',
      progress: existingData?.progress || 0,
      subtasks: existingData?.subtasks || [],
      dependencies: existingData?.dependencies || [],
      compliance_checklist: existingData?.compliance_checklist || [
        { id: '1', title: 'ISO 27001 Validation', completed: false },
        { id: '2', title: 'Quarterly Risk Assessment', completed: false }
      ]
    });
  };

  const getStatusColor = (statusName: string) => {
    const status = statuses.find(s => s.name === statusName);
    if (status) return status.color;
    
    switch (statusName) {
      case 'ToDo': return 'bg-slate-100 text-slate-800';
      case 'In Progress': return 'bg-blue-100 text-blue-800';
      case 'In Review': return 'bg-purple-100 text-purple-800';
      case 'Completed': return 'bg-emerald-100 text-emerald-800';
      case 'On Hold': return 'bg-amber-100 text-amber-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  // Convert Tailwind bg-*-100 status class → solid hex color for bars
  const BG_TO_HEX: Record<string, string> = {
    'bg-slate-100': '#64748b', 'bg-gray-100': '#6b7280',
    'bg-blue-100': '#3b82f6',  'bg-indigo-100': '#6366f1', 'bg-violet-100': '#7c3aed',
    'bg-purple-100': '#8b5cf6','bg-fuchsia-100': '#d946ef','bg-pink-100': '#ec4899',
    'bg-rose-100': '#f43f5e',  'bg-red-100': '#ef4444',   'bg-orange-100': '#f97316',
    'bg-amber-100': '#f59e0b', 'bg-yellow-100': '#eab308', 'bg-lime-100': '#84cc16',
    'bg-green-100': '#22c55e', 'bg-emerald-100': '#10b981','bg-teal-100': '#14b8a6',
    'bg-cyan-100': '#06b6d4',
  };
  const bgToHex = (statusColor: string): string => {
    const bg = statusColor.split(' ')[0];
    return BG_TO_HEX[bg] || '#94a3b8';
  };

  const getPriorityCell = (priority: string): { color: string; label: string } => {
    switch (priority) {
      case 'high':   return { color: '#ef4444', label: 'High' };
      case 'medium': return { color: '#f97316', label: 'Medium' };
      case 'low':    return { color: '#3b82f6', label: 'Low' };
      default:       return { color: '#cbd5e1', label: '—' };
    }
  };

  // Used in Kanban cards and the edit modal priority selector
  const getPriorityIcon = (priority: string) => {
    const { color, label } = getPriorityCell(priority);
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color }}>
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        {label}
      </span>
    );
  };

  // Group projects by status
  const groupedProjects = statuses.map((status, index) => {
    return {
      status,
      projects: projects.filter(p => {
        const mgmtStatus = managementData[p.id]?.status;
        return mgmtStatus === status.name || (!mgmtStatus && index === 0); // Default to first status if none
      })
    };
  }).filter(g => g.projects.length > 0 || true); // Keep empty statuses visible

  // Add uncategorized projects
  const uncategorizedProjects = projects.filter(p => {
    const mgmtStatus = managementData[p.id]?.status;
    return mgmtStatus && !statuses.some(s => s.name === mgmtStatus);
  });
  
  if (uncategorizedProjects.length > 0) {
    groupedProjects.push({
      status: { id: '0', name: 'Uncategorized', color: 'bg-slate-100 text-slate-800' },
      projects: uncategorizedProjects
    });
  }

  // Ordered column keys, merged with any new custom columns not yet in persisted order
  const effectiveColOrder = React.useMemo(() => {
    const validBuiltIn = new Set(['name', 'tags', 'assignee', 'dueDate', 'priority', 'taskStatus']);
    const validCcKeys = new Set(customColumns.map(c => `cc_${c.id}`));
    const filtered = colOrder.filter(k => validBuiltIn.has(k) || validCcKeys.has(k));
    const missing = customColumns.filter(c => !colOrder.includes(`cc_${c.id}`)).map(c => `cc_${c.id}`);
    return [...filtered, ...missing];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colOrder, customColumns]);

  const getColWidth = (key: string): number => {
    const defaults: Record<string, number> = { name: 280, tags: 120, assignee: 130, dueDate: 155, priority: 100, taskStatus: 130 };
    return colWidths[key] ?? defaults[key] ?? 120;
  };

  const reorderCols = (fromKey: string, toKey: string) => {
    const curr = [...effectiveColOrder];
    const from = curr.indexOf(fromKey);
    const to = curr.indexOf(toKey);
    if (from === -1 || to === -1 || from === to) return;
    curr.splice(from, 1);
    curr.splice(to, 0, fromKey);
    setColOrder(curr);
    try { localStorage.setItem('pm_colOrder', JSON.stringify(curr)); } catch {}
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Loading project management...</div>;
  }

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto w-full font-manrope relative pb-16">
      {/* View Switcher */}
      <div className="flex items-center gap-6 border-b border-slate-200 mb-4">
        <button
          onClick={() => setCurrentView('list')}
          className={`text-sm font-semibold pb-2 -mb-[1px] border-b-2 transition-colors ${currentView === 'list' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
        >
          List
        </button>
        <button
          onClick={() => setCurrentView('kanban')}
          className={`text-sm font-semibold pb-2 -mb-[1px] border-b-2 transition-colors ${currentView === 'kanban' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
        >
          Kanban
        </button>
        <button
          onClick={() => setCurrentView('gantt')}
          className={`text-sm font-semibold pb-2 -mb-[1px] border-b-2 transition-colors ${currentView === 'gantt' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
        >
          Gantt
        </button>
        <button
          onClick={() => setCurrentView('calendar')}
          className={`text-sm font-semibold pb-2 -mb-[1px] border-b-2 transition-colors ${currentView === 'calendar' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
        >
          Calendar
        </button>
      </div>

      {/* Page Header */}
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Precision Project Management</h1>
        <div className="flex items-center gap-2">
          {(currentUser.user_type === 'admin' || currentUser.permissions?.pmBulkEdit === 'full') && (
            <>
              <button
                onClick={() => {
                  setIsBulkMode(!isBulkMode);
                  if (isBulkMode) setSelectedProjectIds(new Set());
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs font-bold transition-all shadow-sm ${isBulkMode ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'}`}
              >
                <List size={14} />
                {isBulkMode ? 'Cancel Bulk' : 'Bulk'}
              </button>
              {isBulkMode && selectedProjectIds.size > 0 && (
                <button
                  onClick={() => setShowBulkModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 text-white rounded-lg hover:bg-slate-900 transition-all text-xs font-bold shadow-sm"
                >
                  <Edit2 size={14} />
                  Bulk Edit ({selectedProjectIds.size})
                </button>
              )}
            </>
          )}
          {(currentUser.user_type === 'admin' || currentUser.permissions?.pmManageStatuses === 'full') && (
            <button
              onClick={() => setShowPipelineModal(true)}
              className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
            >
              <Layers size={14} />
              Manage Statuses
            </button>
          )}
          {currentView === 'list' && (
            <>
              <button
                onClick={() => {
                  const allIds = projects
                    .filter(p => managementData[p.id]?.subtasks?.length > 0)
                    .map(p => p.id);
                  persistExpanded(new Set(allIds));
                }}
                className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
              >
                <ChevronDown size={14} />
                Expand All
              </button>
              <button
                onClick={() => persistExpanded(new Set())}
                className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
              >
                <ChevronUp size={14} />
                Collapse All
              </button>
              {/* Column manager */}
              <div className="relative">
                <button
                  onMouseDown={e => { e.stopPropagation(); setShowColumnMenu(v => !v); setOpenStatusDropdown(null); setOpenCcDropdown(null); }}
                  className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                >
                  <Layers size={14} />
                  Columns
                </button>
                {showColumnMenu && (
                  <div className="absolute right-0 top-full mt-1 w-64 bg-white rounded-xl shadow-xl border border-slate-100 z-50 overflow-hidden" onMouseDown={e => e.stopPropagation()}>
                    <div className="px-3 py-2 border-b border-slate-100">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Manage Columns</span>
                    </div>
                    <div className="p-2 space-y-0.5">
                      {customColumns.map(col => (
                        <div key={col.id} className="flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-slate-50">
                          <span className="flex-1 text-xs font-medium text-slate-700 truncate">{col.name}</span>
                          <button onClick={() => { setCustomColForm({ id: col.id, name: col.name, options: col.options }); setShowCustomColModal(true); setShowColumnMenu(false); }} className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors">
                            <Edit2 size={12} />
                          </button>
                          <button onClick={() => { handleDeleteCustomColumn(col.id); setShowColumnMenu(false); }} className="p-1 text-slate-400 hover:text-red-500 rounded transition-colors">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                      {customColumns.length === 0 && (
                        <div className="px-2 py-2 text-xs text-slate-400 italic">No custom columns yet.</div>
                      )}
                    </div>
                    {currentUser?.user_type === 'admin' && (
                      <div className="p-2 border-t border-slate-100">
                        <button
                          onClick={() => { setCustomColForm({ id: null, name: '', options: [] }); setCustomColNewLabel(''); setCustomColNewColor('#3b82f6'); setShowCustomColModal(true); setShowColumnMenu(false); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <Plus size={12} />
                          Add new column
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-800 p-4 rounded-xl text-sm font-medium flex items-center justify-between shadow-sm border border-red-100">
          <div className="flex items-center gap-3">
            <AlertCircle className="shrink-0" size={18} />
            <p>{error}</p>
          </div>
          <button onClick={() => setError(null)} className="p-1 hover:bg-red-100 rounded-lg transition-colors">
            <X size={16} />
          </button>
        </div>
      )}

      {/* List View Groups */}
      {currentView === 'list' && (
        <div className="space-y-6 mb-6">
          {groupedProjects.map(group => (
            <div key={group.status.id} className="bg-white rounded-xl border border-slate-200 shadow-sm" style={{ overflow: 'hidden' }}>
              <section 
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  const projectIdStr = e.dataTransfer.getData('projectId');
                  if (!projectIdStr) return;
                  const projectId = parseInt(projectIdStr);
                  if (isNaN(projectId)) return;
                  
                  const project = projects.find(p => p.id === projectId);
                  if (!project) return;
                  
                  const currentStatus = managementData[projectId]?.status || statuses[0]?.name || 'Kickoff';
                  if (currentStatus !== group.status.name) {
                    await handleStatusChange(projectId, group.status.name);
                  }
                }}
              >
                {/* Group Header */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-slate-50/50">
                  <div className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${group.status.color}`}>
                    {group.status.name}
                  </div>
                  <span className="text-slate-400 text-[10px] ml-1 font-medium">{group.projects.length}</span>
                  {isBulkMode && group.projects.length > 0 && (() => {
                    const groupIds = group.projects.map(p => p.id);
                    const allSelected = groupIds.every(id => selectedProjectIds.has(id));
                    return (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const next = new Set(selectedProjectIds);
                          if (allSelected) {
                            groupIds.forEach(id => next.delete(id));
                          } else {
                            groupIds.forEach(id => next.add(id));
                          }
                          setSelectedProjectIds(next);
                        }}
                        className="ml-2 text-[10px] font-semibold text-blue-600 hover:text-blue-800 transition-colors"
                      >
                        {allSelected ? 'Deselect All' : 'Select All'}
                      </button>
                    );
                  })()}
                </div>

                {/* Horizontally scrollable table area */}
                <div className="overflow-x-auto">
                {/* Table Header */}
                {group.projects.length > 0 && (
                  <div className="flex items-stretch border-b border-slate-100 bg-white select-none" style={{ minHeight: 32 }}>
                    {isBulkMode && <div style={{ width: 40 }} className="shrink-0" />}
                    {effectiveColOrder.map(key => {
                      const isCustom = key.startsWith('cc_');
                      const ccId = isCustom ? key.slice(3) : null;
                      const ccCol = ccId ? customColumns.find(c => c.id === ccId) : null;
                      if (isCustom && !ccCol) return null;
                      const w = getColWidth(key);
                      const LABELS: Record<string, string> = { name: 'Name', tags: 'Tags', assignee: 'Assignee', dueDate: 'Due date', priority: 'Priority', taskStatus: 'Task Status' };
                      const label = isCustom ? ccCol!.name : (LABELS[key] || key);
                      return (
                        <div
                          key={key}
                          draggable
                          onDragStart={e => { e.stopPropagation(); draggingColKey.current = key; }}
                          onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverCol(key); }}
                          onDragLeave={() => setDragOverCol(null)}
                          onDrop={e => { e.preventDefault(); e.stopPropagation(); if (draggingColKey.current) reorderCols(draggingColKey.current, key); draggingColKey.current = null; setDragOverCol(null); }}
                          className={`group/colhdr relative flex items-center px-3 text-xs font-medium text-slate-400 shrink-0 border-r border-slate-100 cursor-grab active:cursor-grabbing transition-colors ${dragOverCol === key ? 'bg-blue-50 text-blue-500' : ''}`}
                          style={{ width: w }}
                        >
                          <span className="truncate flex-1 select-none">{label}</span>
                          {isCustom && ccCol && (
                            <>
                              <button onClick={e => { e.stopPropagation(); setCustomColForm({ id: ccCol.id, name: ccCol.name, options: ccCol.options }); setCustomColNewLabel(''); setCustomColNewColor('#3b82f6'); setShowCustomColModal(true); }} className="ml-1 opacity-0 group-hover/colhdr:opacity-100 text-slate-400 hover:text-slate-600 shrink-0 transition-all" title="Edit">
                                <Edit2 size={10} />
                              </button>
                              <button onClick={e => { e.stopPropagation(); handleDeleteCustomColumn(ccCol.id); }} className="ml-0.5 opacity-0 group-hover/colhdr:opacity-100 text-slate-400 hover:text-red-500 shrink-0 transition-all" title="Delete">
                                <Trash2 size={10} />
                              </button>
                            </>
                          )}
                          <div
                            className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400 z-10 transition-colors"
                            onMouseDown={e => { e.preventDefault(); e.stopPropagation(); resizingCol.current = { key, startX: e.clientX, startWidth: w }; document.body.style.cursor = 'col-resize'; }}
                          />
                        </div>
                      );
                    })}
                    <div className="flex-1" />
                    <div style={{ width: 32 }} className="shrink-0" />
                  </div>
                )}
                
                <div className="flex flex-col">
                  {group.projects.map(project => {
                    const projectAllocs = allocations.filter(a => a.project_id === project.id);
                    const assignees = projectAllocs.map(a => teamMembers.find(tm => tm.id === a.team_member_id)).filter(Boolean) as TeamMember[];
                    const pData = selectedProject?.id === project.id ? editData : (managementData[project.id] || { status: 'ToDo', priority: 'medium', description: '' });
                    const projectActivities = activities.filter(a => a.project_id === project.id);
                    
                    // Check if overdue
                    const displayDate = pData.due_date || '';
                    const isOverdue = !!displayDate && parsePlainLocal(displayDate) < new Date() && pData.status !== 'Done';
                    
                    const pc = getPriorityCell(pData.priority);
                    const statusHex = bgToHex(getStatusColor(pData.status));
                    return (
                      <React.Fragment key={project.id}>
                        <div
                          className={`flex items-stretch min-h-[40px] hover:bg-slate-50 transition-colors border-t border-slate-100 cursor-pointer group ${selectedProjectIds.has(project.id) ? 'bg-blue-50/50' : isOverdue ? 'bg-red-50/40 border-l-2 border-l-red-400' : ''}`}
                          onClick={(e) => {
                            if (isBulkMode) {
                              const newSet = new Set(selectedProjectIds);
                              if (newSet.has(project.id)) newSet.delete(project.id);
                              else newSet.add(project.id);
                              setSelectedProjectIds(newSet);
                            } else {
                              openEditModal(project);
                            }
                          }}
                          draggable={!isBulkMode}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('projectId', project.id.toString());
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                        >
                          {isBulkMode && (
                            <div className="flex items-center px-3 shrink-0" style={{ width: 40 }} onClick={e => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                checked={selectedProjectIds.has(project.id)}
                                onChange={e => {
                                  const newSet = new Set(selectedProjectIds);
                                  if (e.target.checked) newSet.add(project.id);
                                  else newSet.delete(project.id);
                                  setSelectedProjectIds(newSet);
                                }}
                              />
                            </div>
                          )}

                          {/* Cells rendered in column order */}
                          {effectiveColOrder.map(key => {
                            if (key === 'name') return (
                              <div key="name" className="flex items-center px-3 gap-2 pr-4 shrink-0" style={{ width: getColWidth('name') }}>
                                {pData.subtasks && pData.subtasks.length > 0 ? (
                                  <button onClick={e => { e.stopPropagation(); const s = new Set(expandedProjects); s.has(project.id) ? s.delete(project.id) : s.add(project.id); persistExpanded(s); }} className="p-0.5 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-600 transition-colors shrink-0">
                                    {expandedProjects.has(project.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                  </button>
                                ) : <div className="w-[18px] shrink-0" />}
                                <span className="text-xs font-medium text-slate-700 hover:underline truncate">{project.project_name}</span>
                                {projectActivities.length > 0 && <MessageSquare size={12} className="text-slate-400 shrink-0" />}
                              </div>
                            );
                            if (key === 'tags') return (
                              <div key="tags" className="flex items-center px-3 flex-wrap gap-1 shrink-0" style={{ width: getColWidth('tags') }}>
                                {pData.tags && pData.tags.length > 0 ? pData.tags.slice(0, 2).map((tag: any, idx: number) => {
                                  let parsedTag: any = tag;
                                  if (typeof tag === 'string' && tag.trim().startsWith('{')) {
                                    try { parsedTag = JSON.parse(tag); } catch {}
                                  }
                                  const tagName = typeof parsedTag === 'string' ? parsedTag : (parsedTag.name || '');
                                  let colorClass = (typeof parsedTag === 'string' ? null : parsedTag.color) || '';
                                  if (!colorClass) {
                                    const cols = ['bg-blue-50 text-blue-600','bg-purple-50 text-purple-600','bg-emerald-50 text-emerald-600','bg-amber-50 text-amber-600','bg-rose-50 text-rose-600','bg-cyan-50 text-cyan-600','bg-indigo-50 text-indigo-600','bg-fuchsia-50 text-fuchsia-600'];
                                    let h = 0; for (let i = 0; i < tagName.length; i++) h = tagName.charCodeAt(i) + ((h << 5) - h);
                                    colorClass = cols[Math.abs(h) % cols.length];
                                  }
                                  return <span key={idx} className={`text-[0.6rem] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider truncate max-w-full ${colorClass}`}>{tagName}</span>;
                                }) : <span className="text-slate-400 text-xs">-</span>}
                                {pData.tags && pData.tags.length > 2 && <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 uppercase tracking-wider">+{pData.tags.length - 2}</span>}
                              </div>
                            );
                            if (key === 'assignee') return (
                              <div key="assignee" className="flex items-center px-3 -space-x-1.5 shrink-0" style={{ width: getColWidth('assignee') }}>
                                {assignees.slice(0, 3).map((a, idx) => {
                                  const initials = a.name ? a.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() : '?';
                                  return <div key={idx} className="relative group/av"><div className="w-6 h-6 rounded-full border-2 border-white bg-blue-100 flex items-center justify-center text-[0.5rem] font-bold text-blue-600 overflow-hidden">{a.avatar_url ? <img src={a.avatar_url} alt={a.name || ''} className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : initials}</div><span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover/av:opacity-100 z-50 transition-none">{a.name}</span></div>;
                                })}
                                {assignees.length > 3 && <div className="w-6 h-6 rounded-full border-2 border-white bg-slate-100 flex items-center justify-center text-[0.5rem] font-bold text-slate-500">+{assignees.length - 3}</div>}
                                {assignees.length === 0 && <div className="w-6 h-6 rounded-full border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400" />}
                              </div>
                            );
                            if (key === 'dueDate') return (
                              <div key="dueDate" className={`flex items-center px-3 text-xs shrink-0 ${isOverdue ? 'text-red-500 font-medium' : 'text-slate-500'}`} style={{ width: getColWidth('dueDate') }}>
                                {displayDate ? formatDisplayDatetime(displayDate) : <span className="text-slate-300">—</span>}
                              </div>
                            );
                            if (key === 'priority') return (
                              <div key="priority"
                                className="relative self-stretch flex items-center justify-center shrink-0 border-x border-slate-100 text-xs font-semibold cursor-pointer select-none"
                                style={{ width: getColWidth('priority'), backgroundColor: pc.color, color: pc.color === '#cbd5e1' ? '#94a3b8' : 'white' }}
                                onMouseDown={e => { e.stopPropagation(); setOpenPriorityDropdown(openPriorityDropdown === project.id ? null : project.id); setOpenStatusDropdown(null); setOpenCcDropdown(null); setShowColumnMenu(false); }}
                                onClick={e => e.stopPropagation()}
                              >
                                {pc.label}
                                {openPriorityDropdown === project.id && (
                                  <div className="absolute top-full left-0 z-50 bg-white rounded-xl shadow-xl border border-slate-100 py-1 min-w-[140px]" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
                                    {[{ value: 'high', label: 'High', color: '#ef4444' }, { value: 'medium', label: 'Medium', color: '#f97316' }, { value: 'low', label: 'Low', color: '#3b82f6' }].map(opt => (
                                      <button key={opt.value} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 text-left transition-colors"
                                        onClick={() => { handlePriorityChange(project.id, opt.value); setOpenPriorityDropdown(null); }}
                                      >
                                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: opt.color }} />
                                        <span className="text-xs font-medium text-slate-700 flex-1">{opt.label}</span>
                                        {pData.priority === opt.value && <Check size={12} className="text-blue-500 shrink-0" />}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                            if (key === 'taskStatus') return (
                              <div key="taskStatus"
                                className="relative self-stretch flex items-center justify-center shrink-0 border-r border-slate-100 text-xs font-semibold cursor-pointer select-none"
                                style={{ width: getColWidth('taskStatus'), backgroundColor: statusHex, color: 'white' }}
                                onMouseDown={e => { e.stopPropagation(); setOpenStatusDropdown(openStatusDropdown === project.id ? null : project.id); setOpenCcDropdown(null); setOpenPriorityDropdown(null); setShowColumnMenu(false); }}
                                onClick={e => e.stopPropagation()}
                              >
                                {pData.status || 'Kickoff'}
                                {openStatusDropdown === project.id && (
                                  <div className="absolute top-full left-0 z-50 bg-white rounded-xl shadow-xl border border-slate-100 py-1 min-w-[160px]" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
                                    {statuses.map(s => (
                                      <button key={s.id} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 text-left transition-colors"
                                        onClick={() => { handleStatusChange(project.id, s.name); setOpenStatusDropdown(null); }}
                                      >
                                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: bgToHex(s.color) }} />
                                        <span className="text-xs font-medium text-slate-700 flex-1">{s.name}</span>
                                        {pData.status === s.name && <Check size={12} className="text-blue-500 shrink-0" />}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                            if (key.startsWith('cc_')) {
                              const ccId = key.slice(3);
                              const col = customColumns.find(c => c.id === ccId);
                              if (!col) return null;
                              const val = pData.custom_fields?.[col.id] || '';
                              const opt = col.options.find(o => o.label === val);
                              const isOpen = openCcDropdown?.projectId === project.id && openCcDropdown?.colId === col.id;
                              return (
                                <div key={key}
                                  className="relative self-stretch flex items-center justify-center shrink-0 border-r border-slate-100 text-xs font-semibold cursor-pointer select-none"
                                  style={{ width: getColWidth(key), backgroundColor: opt?.color || 'transparent', color: opt ? 'white' : '#94a3b8' }}
                                  onMouseDown={e => { e.stopPropagation(); setOpenCcDropdown(isOpen ? null : { projectId: project.id, colId: col.id }); setOpenStatusDropdown(null); setOpenPriorityDropdown(null); setShowColumnMenu(false); }}
                                  onClick={e => e.stopPropagation()}
                                >
                                  {val || '—'}
                                  {isOpen && (
                                    <div className="absolute top-full left-0 z-50 bg-white rounded-xl shadow-xl border border-slate-100 py-1 min-w-[150px]" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
                                      <button className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 text-left transition-colors"
                                        onClick={() => { const f = { ...(pData.custom_fields || {}), [col.id]: '' }; const u = { ...pData, custom_fields: f }; setManagementData(prev => ({ ...prev, [project.id]: u })); saveManagementData(project.id, u); setOpenCcDropdown(null); }}
                                      >
                                        <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-slate-200" />
                                        <span className="text-xs font-medium text-slate-400 flex-1">—</span>
                                        {!val && <Check size={12} className="text-blue-500 shrink-0" />}
                                      </button>
                                      {col.options.map(o => (
                                        <button key={o.label} className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 text-left transition-colors"
                                          onClick={() => { const f = { ...(pData.custom_fields || {}), [col.id]: o.label }; const u = { ...pData, custom_fields: f }; setManagementData(prev => ({ ...prev, [project.id]: u })); saveManagementData(project.id, u); setOpenCcDropdown(null); }}
                                        >
                                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: o.color }} />
                                          <span className="text-xs font-medium text-slate-700 flex-1">{o.label}</span>
                                          {val === o.label && <Check size={12} className="text-blue-500 shrink-0" />}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            }
                            return null;
                          })}

                          <div className="flex-1"></div>
                          
                          {/* Actions */}
                          <div className="flex items-center gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            {(currentUser.user_type === 'admin' || currentUser.user_type === 'team_member') && (() => {
                              const noPcb = !project.pcb_doc_id;
                              const isReady = !!project.brief_generated;
                              const isGenerating = briefGenerating.has(project.id);
                              return (
                                <button
                                  onClick={(e) => { e.stopPropagation(); if (!isReady && !isGenerating && !noPcb) handleGenerateBrief(project); }}
                                  disabled={isReady || isGenerating || noPcb}
                                  title={noPcb ? 'No PCB doc linked yet' : isReady ? 'Brief already generated' : 'Generate project brief'}
                                  className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all whitespace-nowrap ${
                                    isReady
                                      ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 cursor-default'
                                      : isGenerating
                                      ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-wait'
                                      : noPcb
                                      ? 'bg-slate-50 text-slate-300 border border-slate-200 cursor-not-allowed'
                                      : 'bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100'
                                  }`}
                                >
                                  {isReady ? 'Brief Ready ✓' : isGenerating ? 'Generating...' : 'Generate Brief'}
                                </button>
                              );
                            })()}
                            {project.drive_folder_url && (
                              <a
                                href={project.drive_folder_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Open Drive Folder"
                                onClick={(e) => e.stopPropagation()}
                                className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                              >
                                <FolderOpen size={14} />
                              </a>
                            )}
                          </div>
                        </div>
                        
                        {/* Subtasks rendering */}
                        {expandedProjects.has(project.id) && pData.subtasks && pData.subtasks.map((subtask: any) => (
                          <div key={subtask.id} className="flex items-stretch min-h-[36px] hover:bg-slate-50 transition-colors border-t border-slate-50 group">
                            {isBulkMode && <div className="shrink-0" style={{ width: 40 }} />}

                            {/* Subtask cells follow same column order */}
                            {effectiveColOrder.map(key => {
                              if (key === 'name') return (
                                <div key="name" className="flex items-center pl-10 pr-4 gap-2 shrink-0" style={{ width: getColWidth('name') }}>
                                  <button onClick={e => { e.stopPropagation(); const cur = managementData[project.id]; if (!cur) return; const upd = cur.subtasks.map((s: any) => s.id === subtask.id ? { ...s, completed: !s.completed } : s); const d = { ...cur, subtasks: upd }; setManagementData(prev => ({ ...prev, [project.id]: d })); saveManagementData(project.id, d); }} className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${subtask.completed ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white hover:border-blue-400'}`}>
                                    {subtask.completed && <Check size={10} className="text-white" />}
                                  </button>
                                  <span className={`text-xs ${subtask.completed ? 'text-slate-400 line-through' : 'text-slate-700'} truncate`}>{subtask.title}</span>
                                </div>
                              );
                              if (key === 'tags') return <div key="tags" className="flex items-center px-3 text-slate-400 text-xs shrink-0" style={{ width: getColWidth('tags') }}>-</div>;
                              if (key === 'assignee') {
                                const member = subtask.assignee_id ? teamMembers.find((t: TeamMember) => String(t.id) === String(subtask.assignee_id)) : null;
                                const initials = member?.name ? member.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() : '?';
                                return (
                                  <div key="assignee" className="flex items-center px-3 shrink-0" style={{ width: getColWidth('assignee') }}>
                                    {member ? <div className="relative group/av"><div className="w-6 h-6 rounded-full border-2 border-white bg-blue-100 flex items-center justify-center text-[0.5rem] font-bold text-blue-600 overflow-hidden">{member.avatar_url ? <img src={member.avatar_url} alt={member.name || ''} className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : initials}</div><span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover/av:opacity-100 z-50 transition-none">{member.name}</span></div> : <div className="w-6 h-6 rounded-full border-2 border-dashed border-slate-300" />}
                                  </div>
                                );
                              }
                              if (key === 'dueDate') return <div key="dueDate" className="flex items-center px-3 text-xs text-slate-500 shrink-0" style={{ width: getColWidth('dueDate') }}>{subtask.due_date ? formatDisplayDatetime(subtask.due_date) : '-'}</div>;
                              if (key === 'priority') return <div key="priority" className="self-stretch shrink-0 border-x border-slate-100 flex items-center justify-center text-slate-300 text-xs" style={{ width: getColWidth('priority'), backgroundColor: '#f8fafc' }}>—</div>;
                              if (key === 'taskStatus') return <div key="taskStatus" className="self-stretch shrink-0 border-r border-slate-100 flex items-center justify-center text-xs font-semibold" style={{ width: getColWidth('taskStatus'), backgroundColor: subtask.completed ? '#10b981' : '#94a3b8', color: 'white' }}>{subtask.completed ? 'Done' : 'Pending'}</div>;
                              if (key.startsWith('cc_')) return <div key={key} className="self-stretch shrink-0 border-r border-slate-100" style={{ width: getColWidth(key) }} />;
                              return null;
                            })}

                            <div className="flex-1" />
                            <div className="shrink-0" style={{ width: 32 }} />
                          </div>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </div>
                {/* Close overflow-x-auto wrapper */}
                </div>
                {/* + Add new button (outside scroll wrapper so it stays full-width) */}
                {addingToGroup === group.status.id ? (
                  <div className="flex items-center gap-2 px-4 py-2 border-t border-slate-100" onClick={e => e.stopPropagation()}>
                    <input
                      autoFocus
                      className="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                      placeholder="Project name..."
                      value={newProjectName}
                      onChange={e => setNewProjectName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleAddProject(group.status.name);
                        if (e.key === 'Escape') { setAddingToGroup(null); setNewProjectName(''); }
                      }}
                    />
                    <button onClick={() => handleAddProject(group.status.name)} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-medium hover:bg-slate-800 transition-colors">Add</button>
                    <button onClick={() => { setAddingToGroup(null); setNewProjectName(''); }} className="px-3 py-1.5 text-slate-500 text-xs hover:text-slate-700 transition-colors">Cancel</button>
                  </div>
                ) : (
                  <button
                    className="w-full flex items-center gap-2 px-4 py-2 text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors border-t border-slate-100"
                    onClick={() => setAddingToGroup(group.status.id)}
                  >
                    <Plus size={12} />
                    Add new
                  </button>
                )}
              </section>
            </div>
          ))}

          {groupedProjects.length === 0 && (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200 shadow-sm">
              <p className="text-slate-500 font-medium">No projects found for the selected period.</p>
            </div>
          )}
        </div>
      )}

      {/* Kanban View */}
      {currentView === 'kanban' && (
        <div className="flex gap-6 overflow-x-auto pb-8 snap-x">
          {groupedProjects.map(group => (
            <div key={group.status.id} className="min-w-[300px] w-[300px] flex-shrink-0 snap-start">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${group.status.color.split(' ')[0]}`} />
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">{group.status.name} ({group.projects.length})</h3>
                </div>
              </div>
              
              <div
                className="space-y-1.5 min-h-[200px] bg-slate-50/50 rounded-xl p-2.5 border border-slate-100"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  const projectIdStr = e.dataTransfer.getData('projectId');
                  if (!projectIdStr) return;
                  const projectId = parseInt(projectIdStr);
                  if (isNaN(projectId)) return;
                  
                  const project = projects.find(p => p.id === projectId);
                  if (!project) return;
                  
                  const currentStatus = managementData[projectId]?.status || statuses[0]?.name || 'Kickoff';
                  if (currentStatus !== group.status.name) {
                    await handleStatusChange(projectId, group.status.name);
                  }
                }}
              >
                {group.projects.map(project => {
                  const pData = managementData[project.id] || { status: statuses[0]?.name || 'Uncategorized', priority: 'medium', start_date: project.start_date, due_date: project.end_date, pipeline_stage_id: project.income_stream_id, tags: [], description: '', progress: 0, subtasks: [], dependencies: [], compliance_checklist: [] };
                  const assignees = allocations.filter(a => a.project_id === project.id).map(a => teamMembers.find(t => t.id === a.team_member_id)).filter(Boolean) as TeamMember[];
                  const isOverdue = parsePlainLocal(pData.due_date || project.end_date) < new Date() && pData.status !== 'Completed';
                  const projectActivities = activities.filter(a => a.project_id === project.id);
                  
                  return (
                    <div 
                      key={project.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('projectId', project.id.toString());
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onClick={() => {
                        setSelectedProject(project);
                        setEditData(pData);
                      }}
                      className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer group flex flex-col"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex flex-wrap gap-1">
                          {pData.tags && pData.tags.length > 0 ? (
                            pData.tags.map((tag, idx) => {
                              let parsedTag: any = tag;
                              if (typeof tag === 'string' && tag.trim().startsWith('{')) {
                                try { parsedTag = JSON.parse(tag); } catch {}
                              }
                              const tagName = typeof parsedTag === 'string' ? parsedTag : (parsedTag.name || '');
                              const tagColor = typeof parsedTag === 'string' ? null : parsedTag.color;
                              
                              let colorClass = tagColor || '';
                              if (!colorClass) {
                                const colors = [
                                  'bg-blue-50 text-blue-600',
                                  'bg-purple-50 text-purple-600',
                                  'bg-emerald-50 text-emerald-600',
                                  'bg-amber-50 text-amber-600',
                                  'bg-rose-50 text-rose-600',
                                  'bg-cyan-50 text-cyan-600',
                                  'bg-indigo-50 text-indigo-600',
                                  'bg-fuchsia-50 text-fuchsia-600',
                                ];
                                let hash = 0;
                                for (let i = 0; i < tagName.length; i++) {
                                  hash = tagName.charCodeAt(i) + ((hash << 5) - hash);
                                }
                                colorClass = colors[Math.abs(hash) % colors.length];
                              }
                              
                              return (
                                <span key={idx} className={`text-[0.6rem] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${colorClass}`}>
                                  {tagName}
                                </span>
                              );
                            })
                          ) : (
                            <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 uppercase tracking-wider">
                              Project #{project.id}
                            </span>
                          )}
                        </div>
                        {getPriorityIcon(pData.priority)}
                      </div>
                      <h4 className="font-medium text-xs text-slate-700 mb-2 group-hover:text-blue-600 transition-colors line-clamp-2 leading-snug">{project.project_name}</h4>

                      <div className="flex items-center justify-between mt-auto mb-2">
                        <div className="flex -space-x-1.5">
                          {assignees.slice(0, 3).map((assignee, idx) => (
                            <div key={idx} className="relative group/av">
                              <div className="w-5 h-5 rounded-full border-2 border-white bg-blue-100 flex items-center justify-center text-[0.45rem] font-bold text-blue-600 overflow-hidden">
                                {assignee.avatar_url ? (
                                  <img src={assignee.avatar_url} alt={assignee.name || 'User'} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                ) : (
                                  (assignee.name || 'U').charAt(0).toUpperCase()
                                )}
                              </div>
                              <span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover/av:opacity-100 z-50 transition-none">{assignee.name}</span>
                            </div>
                          ))}
                        </div>
                        <div className={`flex items-center gap-1 text-xs ${isOverdue ? 'text-red-500' : 'text-slate-400'}`}>
                          <Calendar size={10} />
                          {formatDisplayDatetime(pData.due_date || project.end_date)}
                        </div>
                      </div>
                      
                      <div className="pt-2 border-t border-slate-100 flex items-center gap-3 text-slate-400 text-xs">
                        <div className="flex items-center gap-1">
                          <Layers size={12} />
                          <span>{pData.subtasks?.length || 0}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Paperclip size={12} />
                          <span>{projectActivities.filter(a => a.action === 'added attachment').length || 0}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Calendar View */}
      {currentView === 'calendar' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-6">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
            <h3 className="font-semibold text-slate-900 text-base">
              {calendarDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
            </h3>
            <div className="flex gap-1">
              <button
                onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1))}
                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1))}
                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 border-b border-slate-100">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="py-2 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          {(() => {
            const today = new Date();
            const firstDay = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1);
            const lastDay = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 0);
            const totalCells = firstDay.getDay() + lastDay.getDate();
            const rows = Math.ceil(totalCells / 7);
            const cells: React.ReactNode[] = [];

            // Empty leading cells
            for (let i = 0; i < firstDay.getDay(); i++) {
              cells.push(
                <div key={`e-${i}`} className="border-r border-b border-slate-100 bg-slate-50/40 min-h-[90px] p-1" />
              );
            }

            // Day cells
            for (let d = 1; d <= lastDay.getDate(); d++) {
              const isToday = d === today.getDate() && calendarDate.getMonth() === today.getMonth() && calendarDate.getFullYear() === today.getFullYear();

              // Projects due on this day
              const dayProjects = projects.filter(p => {
                const pData = managementData[p.id];
                const dateStr = pData?.due_date || p.end_date;
                if (!dateStr) return false;
                const due = parsePlainLocal(dateStr);
                return due.getDate() === d && due.getMonth() === calendarDate.getMonth() && due.getFullYear() === calendarDate.getFullYear();
              });

              cells.push(
                <div
                  key={d}
                  className={`border-r border-b border-slate-100 min-h-[90px] p-1 ${isToday ? 'bg-blue-50/20' : 'bg-white'}`}
                >
                  {/* Date number */}
                  <div className="flex justify-end mb-1 pr-0.5">
                    <span className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-semibold ${isToday ? 'bg-blue-600 text-white' : 'text-slate-500'}`}>
                      {d}
                    </span>
                  </div>

                  {/* Task bars */}
                  <div className="flex flex-col gap-0.5">
                    {dayProjects.map(project => {
                      const pData = managementData[project.id] || { status: statuses[0]?.name || 'Uncategorized', due_date: '' };
                      const statusObj = statuses.find(s => s.name === pData.status) || statuses[0];
                      const isOverdue = parsePlainLocal(pData.due_date || project.end_date) < new Date() && pData.status !== 'Completed' && pData.status !== 'Done';
                      const barColor = isOverdue ? '#ef4444' : bgToHex(statusObj?.color || 'bg-slate--100');

                      // Extract time from due_date
                      const dueDateStr = pData.due_date || '';
                      const timePart = dueDateStr.includes('T') ? dueDateStr.split('T')[1]?.slice(0, 5) : '';
                      let timeLabel = '';
                      if (timePart && timePart !== '00:00') {
                        const [hh, mm] = timePart.split(':').map(Number);
                        const period = hh >= 12 ? 'PM' : 'AM';
                        const h12 = hh % 12 || 12;
                        timeLabel = `${h12}:${String(mm).padStart(2, '0')} ${period}`;
                      }

                      return (
                        <div
                          key={project.id}
                          onClick={() => { setSelectedProject(project); setEditData(pData); }}
                          title={project.project_name}
                          style={{ background: barColor, borderRadius: 4, padding: '2px 5px', cursor: 'pointer', opacity: 0.9 }}
                          onMouseOver={e => (e.currentTarget.style.opacity = '1')}
                          onMouseOut={e  => (e.currentTarget.style.opacity = '0.9')}
                        >
                          <div style={{ fontSize: 11, fontWeight: 600, color: 'white', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', lineHeight: '14px' }}>
                            {project.project_name}
                          </div>
                          {timeLabel && (
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.8)', lineHeight: '13px' }}>
                              {timeLabel}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }

            // Trailing empty cells to complete last row
            const trailing = (7 - (totalCells % 7)) % 7;
            for (let i = 0; i < trailing; i++) {
              cells.push(
                <div key={`et-${i}`} className="border-r border-b border-slate-100 bg-slate-50/40 min-h-[90px] p-1" />
              );
            }

            return (
              <div className="grid grid-cols-7" style={{ borderLeft: '1px solid #f1f5f9' }}>
                {cells}
              </div>
            );
          })()}
        </div>
      )}

      {/* Gantt View */}
      {currentView === 'gantt' && (() => {
        const todayG = new Date();
        todayG.setHours(0, 0, 0, 0);
        const todayEndMs = todayG.getTime() + 86400000;

        // ── TODAY VIEW ──────────────────────────────────────────────────────
        if (ganttZoom === 'today') {
          type TodayRow = { kind: 'project' | 'subtask'; label: string; assignees: string[]; status: string; statusColor: string; projectName?: string; };
          const todayRows: TodayRow[] = [];

          projects.forEach(p => {
            const pData = managementData[p.id] || {};
            const rawStart = pData.start_date || p.start_date;
            const rawEnd = pData.due_date || p.end_date;
            if (!rawEnd) return;
            const startMs = rawStart ? parsePlainLocal(rawStart).getTime() : parsePlainLocal(rawEnd).getTime();
            const endMs = parsePlainLocal(rawEnd).getTime();
            const activeToday = startMs <= todayEndMs && endMs >= todayG.getTime();
            if (activeToday) {
              const projectAllocs = allocations.filter(a => a.project_id === p.id);
              const assigneeNames = projectAllocs.map(a => teamMembers.find(t => t.id === a.team_member_id)?.name).filter(Boolean) as string[];
              const statusObj = statuses.find(s => s.name === pData.status) || statuses[0];
              todayRows.push({ kind: 'project', label: p.project_name, assignees: assigneeNames, status: pData.status || 'Unknown', statusColor: bgToHex(statusObj?.color || 'bg-slate-100') });
            }
            // Subtasks active today
            (pData.subtasks || []).forEach((st: Subtask) => {
              if (!st.due_date) return;
              const stStart = st.start_date ? parsePlainLocal(st.start_date).getTime() : parsePlainLocal(st.due_date).getTime();
              const stEnd = parsePlainLocal(st.due_date).getTime();
              if (stStart <= todayEndMs && stEnd >= todayG.getTime()) {
                const assigneeName = st.assignee_id ? teamMembers.find(t => String(t.id) === String(st.assignee_id))?.name || 'Unassigned' : 'Unassigned';
                const statusObj = statuses.find(s => s.name === pData.status) || statuses[0];
                todayRows.push({ kind: 'subtask', label: st.title, assignees: [assigneeName], status: st.completed ? 'Completed' : 'Pending', statusColor: st.completed ? '#10b981' : bgToHex(statusObj?.color || 'bg-slate-100'), projectName: p.project_name });
              }
            });
          });

          return (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-6">
              {/* Toolbar */}
              <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <h3 className="font-bold text-slate-900 text-base">Today — {todayG.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
                  <div className="flex bg-slate-100 p-1 rounded-lg">
                    {(['today', 'day', 'week', 'month'] as const).map(z => (
                      <button key={z} onClick={() => setGanttZoom(z)}
                        className={`px-3 py-1 text-xs font-bold rounded-md transition-colors capitalize ${ganttZoom === z ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                        {z.charAt(0).toUpperCase() + z.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {todayRows.length === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-slate-400">Nothing scheduled for today</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {todayRows.map((row, i) => (
                    <div key={i} className={`flex items-center gap-4 px-5 py-3 ${row.kind === 'subtask' ? 'pl-10 bg-slate-50/60' : 'bg-white'}`}>
                      {row.kind === 'subtask' && <span className="text-slate-300 text-xs">↳</span>}
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: row.statusColor }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-800 truncate">{row.label}</div>
                        {row.kind === 'subtask' && row.projectName && (
                          <div className="text-[10px] text-slate-400 truncate">{row.projectName}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {row.assignees.length === 0 ? (
                          <span className="text-xs text-slate-400">Unassigned</span>
                        ) : row.assignees.map((name, idx) => (
                          <span key={idx} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[10px] font-semibold rounded-full">{name}</span>
                        ))}
                      </div>
                      <span className="text-[10px] font-medium text-slate-500 shrink-0 w-20 text-right">{row.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        }

        // ── TIMELINE VIEW (day / week / month) ───────────────────────────────
        // Build columns based on zoom level
        type GCol = { label: string; start: Date };
        const cols: GCol[] = [];

        if (ganttZoom === 'day') {
          const base = new Date(todayG);
          base.setDate(todayG.getDate() - 4);
          for (let i = 0; i < 18; i++) {
            const d = new Date(base);
            d.setDate(base.getDate() + i);
            cols.push({ label: `${d.getDate()} ${d.toLocaleString('default', { month: 'short' })}`, start: new Date(d) });
          }
        } else if (ganttZoom === 'week') {
          const base = new Date(todayG);
          base.setDate(todayG.getDate() - todayG.getDay() - 7);
          for (let i = 0; i < 10; i++) {
            const d = new Date(base);
            d.setDate(base.getDate() + i * 7);
            cols.push({ label: `${d.getDate()} ${d.toLocaleString('default', { month: 'short' })}`, start: new Date(d) });
          }
        } else {
          const base = new Date(todayG.getFullYear(), todayG.getMonth() - 2, 1);
          for (let i = 0; i < 10; i++) {
            const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
            cols.push({ label: d.toLocaleString('default', { month: 'short', year: '2-digit' }), start: new Date(d) });
          }
        }

        const colWidthPx = ganttZoom === 'day' ? 52 : ganttZoom === 'week' ? 88 : 96;
        const nameWidthPx = 220;
        const rowH = 40;
        const subtaskRowH = 34;
        const totalChartW = cols.length * colWidthPx;

        const timelineStartMs = cols[0].start.getTime();
        const getColEnd = (i: number) => {
          if (i + 1 < cols.length) return cols[i + 1].start.getTime();
          const last = cols[cols.length - 1].start;
          if (ganttZoom === 'day') { const d = new Date(last); d.setDate(d.getDate() + 1); return d.getTime(); }
          if (ganttZoom === 'week') { const d = new Date(last); d.setDate(d.getDate() + 7); return d.getTime(); }
          return new Date(last.getFullYear(), last.getMonth() + 1, 1).getTime();
        };
        const timelineEndMs = getColEnd(cols.length - 1);
        const timelineDurMs = timelineEndMs - timelineStartMs;

        const msToX = (ms: number) => ((ms - timelineStartMs) / timelineDurMs) * totalChartW;
        const todayX = msToX(todayG.getTime());

        const ganttProjects = projects.filter(p => {
          const d = managementData[p.id] || {};
          return !!(d.due_date || p.end_date);
        });

        const MIN_BAR = 60;

        const renderGridLines = (h: number) => cols.map((col, i) => {
          const isTodayCol = ganttZoom === 'day' && col.start.getTime() === todayG.getTime();
          return (
            <div key={i} className={`absolute top-0 bottom-0 ${isTodayCol ? 'bg-blue-50/30' : ''}`}
              style={{ left: i * colWidthPx, width: colWidthPx, height: h, borderRight: '1px solid #f1f5f9' }} />
          );
        });

        return (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-6">
            {/* Toolbar */}
            <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h3 className="font-bold text-slate-900 text-base">Project Timeline</h3>
                <div className="flex bg-slate-100 p-1 rounded-lg">
                  {(['today', 'day', 'week', 'month'] as const).map(z => (
                    <button key={z} onClick={() => setGanttZoom(z)}
                      className={`px-3 py-1 text-xs font-bold rounded-md transition-colors capitalize ${ganttZoom === z ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                      {z.charAt(0).toUpperCase() + z.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                {statuses.map(s => (
                  <span key={s.id} className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full" style={{ background: bgToHex(s.color) }} />
                    {s.name}
                  </span>
                ))}
              </div>
            </div>

            {/* Chart */}
            <div className="overflow-x-auto">
              <div style={{ minWidth: nameWidthPx + totalChartW }}>
                {/* Column headers */}
                <div className="flex border-b border-slate-100 bg-slate-50/60">
                  <div style={{ width: nameWidthPx, minWidth: nameWidthPx }} className="px-4 py-2 text-xs font-bold text-slate-400 uppercase tracking-wider border-r border-slate-100">
                    Project
                  </div>
                  <div className="flex" style={{ width: totalChartW }}>
                    {cols.map((col, i) => {
                      const isTodayCol = ganttZoom === 'day' && col.start.getTime() === todayG.getTime();
                      return (
                        <div key={i} style={{ width: colWidthPx, minWidth: colWidthPx }}
                          className={`py-2 text-center border-r border-slate-100 text-[10px] font-medium select-none ${isTodayCol ? 'text-blue-600 font-bold bg-blue-50/40' : 'text-slate-400'}`}>
                          {col.label}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Rows */}
                {ganttProjects.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-slate-400">No projects with due dates to display</div>
                ) : ganttProjects.map((project, rowIdx) => {
                  const pData = managementData[project.id] || { status: statuses[0]?.name || 'Uncategorized' };
                  const statusObj = statuses.find(s => s.name === pData.status) || statuses[0];

                  const rawStart = pData.start_date || project.start_date;
                  const rawEnd = pData.due_date || project.end_date;

                  const endMs = parsePlainLocal(rawEnd).getTime();
                  const isOverdue = endMs < Date.now() && pData.status !== 'Done' && pData.status !== 'Completed';
                  const barColor = isOverdue ? '#ef4444' : bgToHex(statusObj?.color || 'bg-slate-100');

                  let barLeft: number;
                  let barWidth: number;

                  if (rawStart) {
                    const startMs = parsePlainLocal(rawStart).getTime();
                    barLeft = msToX(startMs);
                    barWidth = Math.max(MIN_BAR / 2, msToX(endMs) - barLeft);
                  } else {
                    const endX = msToX(endMs);
                    barLeft = endX - MIN_BAR;
                    barWidth = MIN_BAR;
                  }

                  const clampedLeft = Math.max(0, barLeft);
                  const clampedWidth = Math.min(barWidth + barLeft - clampedLeft, totalChartW - clampedLeft);

                  // Team members assigned to this project
                  const projectAllocs = allocations.filter(a => a.project_id === project.id);
                  const assigneeNames = projectAllocs.map(a => teamMembers.find(t => t.id === a.team_member_id)?.name).filter(Boolean) as string[];
                  const assigneeLabel = assigneeNames.join(', ');

                  const hasSubtasks = (pData.subtasks || []).length > 0;
                  const isExpanded = ganttExpanded.has(project.id);

                  return (
                    <div key={project.id}>
                      {/* Project row */}
                      <div className="flex" style={{ height: rowH, background: rowIdx % 2 === 1 ? '#f8fafc' : 'white', borderBottom: '1px solid #f1f5f9' }}>
                        {/* Name */}
                        <div style={{ width: nameWidthPx, minWidth: nameWidthPx, height: rowH }}
                          className="flex items-center px-2 border-r border-slate-100 gap-1">
                          {hasSubtasks ? (
                            <button
                              onClick={() => {
                                const next = new Set(ganttExpanded);
                                isExpanded ? next.delete(project.id) : next.add(project.id);
                                setGanttExpanded(next);
                              }}
                              className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors shrink-0"
                            >
                              <ChevronDown size={13} className={`transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                            </button>
                          ) : (
                            <span className="w-5 shrink-0" />
                          )}
                          <span className="text-xs font-medium text-slate-700 hover:text-blue-600 cursor-pointer transition-colors truncate"
                            onClick={() => { setSelectedProject(project); setEditData(pData); }}>
                            {project.project_name}
                          </span>
                        </div>
                        {/* Bar area */}
                        <div className="relative" style={{ width: totalChartW, height: rowH }}>
                          {renderGridLines(rowH)}
                          {clampedWidth > 0 && (
                            <div
                              className="absolute cursor-pointer hover:opacity-85 transition-opacity"
                              style={{
                                left: clampedLeft, width: clampedWidth,
                                top: 7, bottom: 7, borderRadius: 6,
                                background: barColor,
                                display: 'flex', alignItems: 'center',
                                paddingLeft: 6, paddingRight: 6, overflow: 'hidden',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                              }}
                              onClick={() => { setSelectedProject(project); setEditData(pData); }}
                              title={`${project.project_name}${rawStart ? `\nStart: ${rawStart}` : ''}${rawEnd ? `\nDue: ${rawEnd}` : ''}${assigneeLabel ? `\nAssigned: ${assigneeLabel}` : ''}`}
                            >
                              {clampedWidth > 55 && (
                                <span style={{ fontSize: 10, fontWeight: 600, color: 'white', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                                  {assigneeLabel || project.project_name}
                                </span>
                              )}
                            </div>
                          )}
                          {todayX >= 0 && todayX <= totalChartW && (
                            <div className="absolute top-0 bottom-0 pointer-events-none z-10"
                              style={{ left: todayX, width: 2, background: 'rgba(59,130,246,0.5)' }} />
                          )}
                        </div>
                      </div>

                      {/* Subtask rows */}
                      {isExpanded && (pData.subtasks || []).map((subtask: Subtask, stIdx: number) => {
                        if (!subtask.due_date) return null;
                        const stEndMs = parsePlainLocal(subtask.due_date).getTime();
                        let stLeft: number, stWidth: number;
                        if (subtask.start_date) {
                          const stStartMs = parsePlainLocal(subtask.start_date).getTime();
                          stLeft = msToX(stStartMs);
                          stWidth = Math.max(MIN_BAR / 2, msToX(stEndMs) - stLeft);
                        } else {
                          stLeft = msToX(stEndMs) - MIN_BAR;
                          stWidth = MIN_BAR;
                        }
                        const stClampedLeft = Math.max(0, stLeft);
                        const stClampedWidth = Math.min(stWidth + stLeft - stClampedLeft, totalChartW - stClampedLeft);
                        const stAssigneeName = subtask.assignee_id
                          ? teamMembers.find(t => String(t.id) === String(subtask.assignee_id))?.name || ''
                          : '';
                        const stBarColor = subtask.completed ? '#10b981' : '#64748b';

                        return (
                          <div key={subtask.id} className="flex" style={{ height: subtaskRowH, background: stIdx % 2 === 0 ? '#f8fafc' : '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
                            {/* Subtask name */}
                            <div style={{ width: nameWidthPx, minWidth: nameWidthPx, height: subtaskRowH }}
                              className="flex items-center pl-8 pr-2 border-r border-slate-100 gap-1">
                              <span className="text-slate-300 text-xs mr-1">↳</span>
                              <span className={`text-[11px] truncate ${subtask.completed ? 'text-slate-400 line-through' : 'text-slate-600'}`}>
                                {subtask.title}
                              </span>
                            </div>
                            {/* Subtask bar area */}
                            <div className="relative" style={{ width: totalChartW, height: subtaskRowH }}>
                              {renderGridLines(subtaskRowH)}
                              {stClampedWidth > 0 && (
                                <div
                                  className="absolute"
                                  style={{
                                    left: stClampedLeft, width: stClampedWidth,
                                    top: 6, bottom: 6, borderRadius: 4,
                                    background: stBarColor,
                                    display: 'flex', alignItems: 'center',
                                    paddingLeft: 5, paddingRight: 5, overflow: 'hidden',
                                    opacity: subtask.completed ? 0.6 : 1,
                                  }}
                                  title={`${subtask.title}${stAssigneeName ? `\nAssigned: ${stAssigneeName}` : ''}${subtask.due_date ? `\nDue: ${subtask.due_date}` : ''}`}
                                >
                                  {stClampedWidth > 50 && stAssigneeName && (
                                    <span style={{ fontSize: 9, fontWeight: 600, color: 'white', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                                      {stAssigneeName}
                                    </span>
                                  )}
                                </div>
                              )}
                              {todayX >= 0 && todayX <= totalChartW && (
                                <div className="absolute top-0 bottom-0 pointer-events-none z-10"
                                  style={{ left: todayX, width: 2, background: 'rgba(59,130,246,0.5)' }} />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Brief error toast */}
      {briefToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 px-5 py-3 bg-red-600 text-white rounded-xl shadow-xl text-sm font-semibold animate-in fade-in slide-in-from-bottom-2">
          <span>{briefToast}</span>
          <button onClick={() => setBriefToast(null)} className="text-red-200 hover:text-white transition-colors ml-1">✕</button>
        </div>
      )}

      {/* Custom Edit Modal */}
      {selectedProject && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setSelectedProject(null)} />

          <div className="relative bg-white rounded-2xl shadow-2xl flex overflow-hidden border border-slate-100" style={{ width: '90vw', maxWidth: '1200px', height: '90vh' }}>

            {/* Left Panel - Project Details */}
            <div className="overflow-y-auto scrollbar-hide flex-shrink-0" style={{ width: `${dividerPct}%`, padding: '32px' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>

                {/* Header */}
                <div style={{ marginBottom: '20px' }}>
                  <span style={{ fontSize: '11px', fontWeight: 500, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', display: 'block', marginBottom: '6px' }}>Project</span>
                  <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#0f172a', letterSpacing: '-0.01em', margin: '0 0 10px 0', lineHeight: 1.3 }}>{selectedProject.project_name}</h2>
                  {selectedProject.drive_folder_url && (
                    <a
                      href={selectedProject.drive_folder_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 border border-slate-200 hover:border-emerald-200 rounded-lg text-xs font-medium transition-all"
                    >
                      <FolderOpen size={13} />
                      Open Drive Folder
                    </a>
                  )}
                </div>

                {/* Grid Details */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" style={{ marginBottom: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Task Status</label>
                    <div className="relative">
                      <select
                        value={editData.status}
                        onChange={e => setEditData({ ...editData, status: e.target.value })}
                        style={{ height: '38px' }}
                        className={`w-full appearance-none border border-slate-200 rounded-lg pl-10 pr-10 text-xs font-medium uppercase tracking-wider focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all cursor-pointer ${getStatusColor(editData.status)}`}
                      >
                        {statuses.map(s => (
                          <option key={s.id} value={s.name}>{s.name}</option>
                        ))}
                        <option value="Uncategorized">Uncategorized</option>
                      </select>
                      <div className="absolute left-4 top-1/2 -translate-y-1/2">
                        <Circle size={12} className="fill-current" />
                      </div>
                      <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 opacity-50 pointer-events-none" />
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Priority</label>
                    <div className="relative">
                      <select
                        value={editData.priority}
                        onChange={e => setEditData({ ...editData, priority: e.target.value })}
                        style={{ height: '38px' }}
                        className="w-full appearance-none bg-white border border-slate-200 rounded-lg pl-10 pr-10 text-sm font-medium text-slate-700 focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all cursor-pointer"
                      >
                        <option value="low">Low Priority</option>
                        <option value="medium">Medium Priority</option>
                        <option value="high">High Priority</option>
                      </select>
                      <div className="absolute left-4 top-1/2 -translate-y-1/2">
                        <span className="w-2.5 h-2.5 rounded-full block" style={{ backgroundColor: getPriorityCell(editData.priority).color }} />
                      </div>
                      <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Start Date</label>
                    <input
                      type="date"
                      value={editData.start_date}
                      onChange={e => { setEditData({ ...editData, start_date: e.target.value }); setDateError(''); }}
                      style={{ height: '38px' }}
                      className="w-full appearance-none bg-white border border-slate-200 rounded-lg px-3 text-sm font-medium text-slate-700 focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all"
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Due Date</label>
                    <input
                      type="datetime-local"
                      value={toDatetimeLocal(editData.due_date)}
                      onChange={e => { setEditData({ ...editData, due_date: e.target.value }); setDateError(''); }}
                      style={{ height: '38px' }}
                      className="w-full appearance-none bg-white border border-slate-200 rounded-lg px-3 text-sm font-medium text-slate-700 focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Income Stream</label>
                    <div className="relative">
                      <select
                        value={editData.pipeline_stage_id || ''}
                        onChange={e => setEditData({ ...editData, pipeline_stage_id: Number(e.target.value) })}
                        style={{ height: '38px' }}
                        className="w-full appearance-none bg-white border border-slate-200 rounded-lg pl-10 pr-10 text-sm font-medium text-slate-700 focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500 transition-all cursor-pointer"
                      >
                        <option value="">Uncategorized</option>
                        {incomeStreams.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                        <Layers size={16} />
                      </div>
                      <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                  </div>
                </div>

                {/* Assignees & Tags */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" style={{ marginBottom: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Assignees</label>
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-2">
                        {allocations.filter(a => a.project_id === selectedProject.id).map(a => teamMembers.find(tm => tm.id === a.team_member_id)).filter(Boolean).map((assignee, idx) => (
                          <div key={idx} className="relative group/av">
                            <div className="w-10 h-10 rounded-full border-2 border-white bg-blue-100 flex items-center justify-center text-xs font-medium text-blue-600 overflow-hidden shadow-sm">
                              {assignee?.avatar_url ? (
                                <img src={assignee.avatar_url} alt={assignee.name || 'User'} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              ) : (
                                (assignee?.name || 'U').charAt(0).toUpperCase()
                              )}
                            </div>
                            <span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover/av:opacity-100 z-50 transition-none">{assignee?.name}</span>
                          </div>
                        ))}
                      </div>
                      <div className="relative">
                        <button 
                          onClick={() => setShowAssigneeDropdown(!showAssigneeDropdown)}
                          className="w-10 h-10 rounded-full border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400 hover:text-blue-600 hover:border-blue-600 transition-colors bg-slate-50"
                        >
                          <Plus size={16} />
                        </button>
                        
                        {showAssigneeDropdown && (
                          <div className="absolute top-full left-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-100 z-50 overflow-hidden">
                            <div className="p-3 border-b border-slate-50">
                              <h4 className="text-[0.65rem] font-semibold text-slate-400 uppercase tracking-widest">Select Team Members</h4>
                            </div>
                            <div className="max-h-60 overflow-y-auto p-2">
                              {teamMembers.length === 0 ? (
                                <div className="p-4 text-center text-sm text-slate-500">No team members found. Add them in the Team page.</div>
                              ) : (
                                teamMembers.map(member => {
                                  const isAssigned = allocations.some(a => a.project_id === selectedProject.id && a.team_member_id === member.id);
                                  return (
                                    <button
                                      key={member.id}
                                      onClick={() => toggleAssignee(member.id)}
                                      className="w-full flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg transition-colors text-left"
                                    >
                                      <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-600 overflow-hidden">
                                          {member.avatar_url ? (
                                            <img src={member.avatar_url} alt={member.name || 'User'} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                          ) : (
                                            (member.name || 'U').charAt(0).toUpperCase()
                                          )}
                                        </div>
                                        <div>
                                          <div className="text-sm font-medium text-slate-900">{member.name}</div>
                                          <div className="text-xs text-slate-500">{member.role}</div>
                                        </div>
                                      </div>
                                      {isAssigned && <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-white"><Check size={12} /></div>}
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Tags</label>
                    <div className="flex flex-wrap items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl p-2 min-h-[52px]">
                      {editData.tags.map((tag, idx) => {
                        let parsedTag: any = tag;
                        if (typeof tag === 'string' && tag.trim().startsWith('{')) {
                          try { parsedTag = JSON.parse(tag); } catch {}
                        }
                        const tagName = typeof parsedTag === 'string' ? parsedTag : (parsedTag.name || '');
                        let tagColor = typeof parsedTag === 'string' ? null : parsedTag.color;
                        
                        if (!tagColor) {
                          const colors = [
                            'bg-blue-50 text-blue-600',
                            'bg-purple-50 text-purple-600',
                            'bg-emerald-50 text-emerald-600',
                            'bg-amber-50 text-amber-600',
                            'bg-rose-50 text-rose-600',
                            'bg-cyan-50 text-cyan-600',
                            'bg-indigo-50 text-indigo-600',
                            'bg-fuchsia-50 text-fuchsia-600',
                          ];
                          let hash = 0;
                          for (let i = 0; i < tagName.length; i++) {
                            hash = tagName.charCodeAt(i) + ((hash << 5) - hash);
                          }
                          tagColor = colors[Math.abs(hash) % colors.length];
                        }
                        
                        return (
                          <span key={idx} className={`px-2 py-0.5 text-xs font-medium rounded-full flex items-center gap-1 ${tagColor}`}>
                            #{tagName}
                            <button onClick={() => setEditData({ ...editData, tags: editData.tags.filter(t => t !== tag) })} className="hover:opacity-75"><X size={12} /></button>
                          </span>
                        );
                      })}
                      <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                        <input
                          type="text"
                          value={newTag}
                          onChange={e => setNewTag(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && newTag.trim()) {
                              e.preventDefault();
                              const tagName = newTag.trim();
                              const exists = editData.tags.some(t => (typeof t === 'string' ? t : t.name) === tagName);
                              if (!exists) {
                                setEditData({ ...editData, tags: [...editData.tags, { name: tagName, color: newTagColor }] });
                              }
                              setNewTag('');
                              setNewTagColor('');
                            }
                          }}
                          placeholder="Add tags..."
                          className="flex-1 bg-transparent outline-none text-sm font-medium text-slate-700 px-2 min-w-[100px]"
                        />
                        <div className="flex items-center gap-1">
                          {[
                            { value: 'bg-blue-50 text-blue-600', bg: 'bg-blue-500' },
                            { value: 'bg-purple-50 text-purple-600', bg: 'bg-purple-500' },
                            { value: 'bg-emerald-50 text-emerald-600', bg: 'bg-emerald-500' },
                            { value: 'bg-amber-50 text-amber-600', bg: 'bg-amber-500' },
                            { value: 'bg-rose-50 text-rose-600', bg: 'bg-rose-500' },
                            { value: 'bg-cyan-50 text-cyan-600', bg: 'bg-cyan-500' },
                            { value: 'bg-indigo-50 text-indigo-600', bg: 'bg-indigo-500' },
                            { value: 'bg-fuchsia-50 text-fuchsia-600', bg: 'bg-fuchsia-500' },
                          ].map(color => (
                            <button
                              key={color.value}
                              onClick={() => setNewTagColor(newTagColor === color.value ? '' : color.value)}
                              className={`w-4 h-4 rounded-full ${color.bg} ${newTagColor === color.value ? 'ring-2 ring-offset-1 ring-slate-400' : 'opacity-70 hover:opacity-100'} transition-all`}
                              title={color.value.split('-')[1]}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Project Description */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Project Description</label>
                  <textarea
                    value={editData.description}
                    onChange={e => setEditData({ ...editData, description: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium text-slate-700 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all min-h-[100px] resize-y shadow-inner"
                    placeholder="Enter detailed project description..."
                  />
                </div>

                {/* Project Progress */}
                <div style={{ marginBottom: '16px' }}>
                  <div className="flex justify-between items-center mb-2">
                    <label style={{ fontSize: '11px', fontWeight: 500, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Project Progress</label>
                    <span className="text-sm font-medium text-slate-900">
                      {editData.subtasks.length > 0 
                        ? Math.round((editData.subtasks.filter(s => s.completed).length / editData.subtasks.length) * 100) 
                        : editData.progress}%
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden">
                    <div 
                      className="bg-slate-900 h-full rounded-full transition-all duration-500" 
                      style={{ 
                        width: `${editData.subtasks.length > 0 
                          ? Math.round((editData.subtasks.filter(s => s.completed).length / editData.subtasks.length) * 100) 
                          : editData.progress}%` 
                      }} 
                    />
                  </div>
                </div>

                {/* Subtasks & Dependencies Grid */}
                <div className="grid grid-cols-1 gap-2">
                  {/* Subtasks */}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <h3 className="text-sm font-semibold text-slate-900">Subtasks</h3>
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[0.65rem] font-medium rounded-full uppercase tracking-wider">
                        {editData.subtasks.filter(s => s.completed).length}/{editData.subtasks.length} Complete
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {editData.subtasks.map(subtask => (
                        <div key={subtask.id} className="flex flex-col gap-1.5 p-2 bg-slate-50 rounded-lg border border-slate-100 group">
                          <div className="flex items-center gap-3">
                            <button 
                              onClick={() => {
                                const updated = editData.subtasks.map(s => s.id === subtask.id ? { ...s, completed: !s.completed } : s);
                                setEditData({ ...editData, subtasks: updated });
                              }}
                              className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors ${subtask.completed ? 'bg-slate-900 text-white' : 'bg-slate-100 text-transparent hover:bg-slate-200 border border-slate-300'}`}
                            >
                              <CheckCircle2 size={14} />
                            </button>
                            <input
                              type="text"
                              value={subtask.title}
                              onChange={(e) => {
                                const updated = editData.subtasks.map(s => s.id === subtask.id ? { ...s, title: e.target.value } : s);
                                setEditData({ ...editData, subtasks: updated });
                              }}
                              className={`flex-1 bg-transparent border-none focus:ring-0 p-0 text-sm font-medium transition-all ${subtask.completed ? 'text-slate-400 line-through' : 'text-slate-700'}`}
                            />
                            <button 
                              onClick={() => setEditData({ ...editData, subtasks: editData.subtasks.filter(s => s.id !== subtask.id) })}
                              className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-all ml-2"
                            >
                              <X size={16} />
                            </button>
                          </div>
                          <div className="flex items-center gap-4 pl-9 flex-wrap overflow-hidden min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-400 font-medium">Start</span>
                              <input
                                type="datetime-local"
                                value={toDatetimeLocal(subtask.start_date)}
                                onChange={(e) => {
                                  const updated = editData.subtasks.map(s => s.id === subtask.id ? { ...s, start_date: e.target.value } : s);
                                  setEditData({ ...editData, subtasks: updated });
                                }}
                                className="text-xs text-slate-500 bg-transparent border-none p-0 focus:ring-0 w-28"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <Calendar size={12} className="text-slate-400" />
                              <input
                                type="datetime-local"
                                value={toDatetimeLocal(subtask.due_date)}
                                onChange={(e) => {
                                  const updated = editData.subtasks.map(s => s.id === subtask.id ? { ...s, due_date: e.target.value } : s);
                                  setEditData({ ...editData, subtasks: updated });
                                }}
                                className="text-xs text-slate-500 bg-transparent border-none p-0 focus:ring-0 w-28"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <AtSign size={12} className="text-slate-400" />
                              <select
                                value={subtask.assignee_id || ''}
                                onChange={(e) => {
                                  const updated = editData.subtasks.map(s => s.id === subtask.id ? { ...s, assignee_id: e.target.value } : s);
                                  setEditData({ ...editData, subtasks: updated });
                                }}
                                className="text-xs text-slate-500 bg-transparent border-none p-0 focus:ring-0 w-32"
                              >
                                <option value="">Unassigned</option>
                                {teamMembers.map(tm => (
                                  <option key={tm.id} value={tm.id}>{tm.name}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      ))}
                      
                      <div className="flex items-center gap-3 mt-4">
                        <button 
                          onClick={() => {
                            if (newSubtask.trim()) {
                              setEditData({ ...editData, subtasks: [...editData.subtasks, { id: Date.now().toString(), title: newSubtask.trim(), completed: false }] });
                              setNewSubtask('');
                            }
                          }}
                          className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-blue-600 hover:bg-blue-50 transition-colors"
                        >
                          <Plus size={16} />
                        </button>
                        <input
                          type="text"
                          value={newSubtask}
                          onChange={e => setNewSubtask(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && newSubtask.trim()) {
                              e.preventDefault();
                              setEditData({ ...editData, subtasks: [...editData.subtasks, { id: Date.now().toString(), title: newSubtask.trim(), completed: false }] });
                              setNewSubtask('');
                            }
                          }}
                          placeholder="Add subtask..."
                          className="flex-1 bg-transparent outline-none text-sm font-medium text-blue-600 placeholder:text-blue-400"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Dependencies & Checklist */}
                  <div className="space-y-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 mb-2">Dependencies</h3>
                      <div className="space-y-1.5 mb-2">
                        {editData.dependencies.map(dep => {
                          const depProject = projects.find(p => p.id === dep.dependent_on_project_id);
                          return (
                            <div key={dep.id} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-100 group">
                              <div className="flex items-center gap-3 min-w-0">
                                <LinkIcon size={14} className="text-slate-400 shrink-0" />
                                <span className="text-sm font-medium text-slate-700 truncate min-w-0">{depProject?.project_name || 'Unknown Project'}</span>
                                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${dep.type === 'blocking' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                                  {dep.type}
                                </span>
                              </div>
                              <button 
                                onClick={() => {
                                  const updated = editData.dependencies.filter(d => d.id !== dep.id);
                                  setEditData({ ...editData, dependencies: updated });
                                }}
                                className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex gap-2 relative">
                        <select
                          value={newDependency}
                          onChange={e => setNewDependency(e.target.value)}
                          className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all appearance-none"
                        >
                          <option value="">Select project to depend on...</option>
                          {projects.filter(p => p.id !== selectedProject?.id && !editData.dependencies.some(d => d.dependent_on_project_id === p.id)).map(p => (
                            <option key={p.id} value={p.id}>{p.project_name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => {
                            if (newDependency) {
                              setEditData({
                                ...editData,
                                dependencies: [
                                  ...editData.dependencies,
                                  {
                                    id: Date.now().toString(),
                                    dependent_on_project_id: parseInt(newDependency),
                                    type: 'blocking'
                                  }
                                ]
                              });
                              setNewDependency('');
                            }
                          }}
                          disabled={!newDependency}
                          className="px-4 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 mb-2">Compliance Checklist</h3>
                      <div className="space-y-2 mb-2">
                        {editData.compliance_checklist.map(item => (
                          <div key={item.id} className="flex items-center gap-3 group min-w-0">
                            <button
                              onClick={() => {
                                const updated = editData.compliance_checklist.map(c => c.id === item.id ? { ...c, completed: !c.completed } : c);
                                setEditData({ ...editData, compliance_checklist: updated });
                              }}
                              className={`w-5 h-5 rounded flex items-center justify-center shrink-0 transition-colors ${item.completed ? 'bg-blue-600 text-white' : 'bg-white border-2 border-slate-200 text-transparent hover:border-blue-400'}`}
                            >
                              <CheckCircle2 size={12} strokeWidth={3} />
                            </button>
                            <span className={`text-sm font-medium flex-1 min-w-0 truncate ${item.completed ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{item.title}</span>
                            <button 
                              onClick={() => {
                                const updated = editData.compliance_checklist.filter(c => c.id !== item.id);
                                setEditData({ ...editData, compliance_checklist: updated });
                              }}
                              className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newChecklistItem}
                          onChange={e => setNewChecklistItem(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && newChecklistItem.trim()) {
                              setEditData({
                                ...editData,
                                compliance_checklist: [
                                  ...editData.compliance_checklist,
                                  { id: Date.now().toString(), title: newChecklistItem.trim(), completed: false }
                                ]
                              });
                              setNewChecklistItem('');
                            }
                          }}
                          placeholder="Add checklist item..."
                          className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all"
                        />
                        <button
                          onClick={() => {
                            if (newChecklistItem.trim()) {
                              setEditData({
                                ...editData,
                                compliance_checklist: [
                                  ...editData.compliance_checklist,
                                  { id: Date.now().toString(), title: newChecklistItem.trim(), completed: false }
                                ]
                              });
                              setNewChecklistItem('');
                            }
                          }}
                          disabled={!newChecklistItem.trim()}
                          className="px-4 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Save Button */}
                <div className="pt-3 border-t border-slate-100">
                  {dateError && (
                    <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                      <svg xmlns="http://www.w3.org/2000/svg" className="shrink-0" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      <span>{dateError}</span>
                    </div>
                  )}
                  <div className="flex justify-end">
                    <button
                      onClick={handleSaveManagementData}
                      className="px-6 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-medium transition-all shadow-xl shadow-slate-900/20 text-sm"
                    >
                      Save Changes
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Draggable divider */}
            <div
              className="cursor-col-resize bg-slate-200 hover:bg-blue-400 active:bg-blue-500 transition-colors shrink-0"
              style={{ width: '4px' }}
              onMouseDown={(e) => {
                e.preventDefault();
                isDragging.current = true;
                const container = (e.currentTarget.parentElement as HTMLElement);
                const onMove = (me: MouseEvent) => {
                  if (!isDragging.current) return;
                  const rect = container.getBoundingClientRect();
                  const pct = Math.min(75, Math.max(25, ((me.clientX - rect.left) / rect.width) * 100));
                  setDividerPct(pct);
                };
                const onUp = () => {
                  isDragging.current = false;
                  window.removeEventListener('mousemove', onMove);
                  window.removeEventListener('mouseup', onUp);
                };
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
              }}
            />

            {/* Right Panel - Activity Feed */}
            <div className="bg-slate-50 flex flex-col" style={{ width: `${100 - dividerPct}%`, minWidth: 0 }}>
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-white shrink-0">
                <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
                  <History size={15} />
                  Activity Feed
                </div>
                <button onClick={() => setSelectedProject(null)} className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
                  <X size={18} />
                </button>
              </div>

              {/* Scrollable activity list */}
              <div className="flex-1 overflow-y-auto scrollbar-hide" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '0' }}>
                {activities.filter(a => a.project_id === selectedProject.id).map(activity => (
                  <div key={activity.id} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '14px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#e2e8f0', flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 500, color: '#64748b' }}>
                      {activity.user_avatar ? (
                        <img src={activity.user_avatar} alt={activity.user_name || 'User'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} referrerPolicy="no-referrer" />
                      ) : (
                        (activity.user_name || 'U').charAt(0).toUpperCase()
                      )}
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>{activity.user_name}</span>
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>{formatDisplayDatetime(activity.created_at)}</span>
                      </div>
                      {activity.action === 'commented' ? (
                        <div style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: '8px', padding: '8px 10px', marginTop: '4px' }}>
                          <RichCommentContent html={activity.content || ''} />
                        </div>
                      ) : (
                        <div style={{ fontSize: '12px', color: '#64748b' }}>
                          {activity.action}{' '}
                          <span style={{ fontWeight: 500, color: '#0f172a' }}>
                            {activity.action === 'set due date to'
                              ? (formatDisplayDatetime(activity.content) || activity.content)
                              : activity.content}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {activities.filter(a => a.project_id === selectedProject.id).length === 0 && (
                  <div className="text-center text-slate-400 text-sm py-12">
                    No activity yet. Start the conversation!
                  </div>
                )}
              </div>

              {/* Comment input — fixed at bottom */}
              <div className="shrink-0 p-4 bg-white border-t border-slate-200">
                <RichTextEditor
                  teamMembers={teamMembers}
                  onSubmit={handleAddComment}
                />
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Manage Statuses Modal */}
      <Modal 
        title="Manage Statuses" 
        isOpen={showPipelineModal} 
        onClose={() => setShowPipelineModal(false)}
        onSave={handleCreatePipeline}
      >
        <div className="space-y-6">
          <div className="bg-blue-50 text-blue-800 p-4 rounded-xl text-sm font-medium flex items-start gap-3">
            <Layers className="shrink-0 mt-0.5" size={18} />
            <p>Statuses are used to group your projects into stages or categories. They are fully customizable.</p>
          </div>
          
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Create New Status</label>
            <input 
              type="text" 
              value={newPipelineName}
              onChange={e => setNewPipelineName(e.target.value)}
              placeholder="e.g. Kickoff, Web UI, Development"
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-medium text-slate-700"
            />
            <div className="flex flex-wrap gap-2 mt-3">
              {[
                'bg-slate-100 text-slate-800',
                'bg-blue-100 text-blue-800',
                'bg-purple-100 text-purple-800',
                'bg-emerald-100 text-emerald-800',
                'bg-amber-100 text-amber-800',
                'bg-rose-100 text-rose-800',
                'bg-cyan-100 text-cyan-800',
                'bg-indigo-100 text-indigo-800',
                'bg-fuchsia-100 text-fuchsia-800',
              ].map(color => (
                <button
                  key={color}
                  onClick={() => setNewPipelineColor(color)}
                  className={`w-6 h-6 rounded-full border-2 ${newPipelineColor === color ? 'border-slate-400 scale-110' : 'border-transparent'} ${color.split(' ')[0]}`}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-3">Existing Statuses</label>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
              {statuses.map(status => (
                <div key={status.id} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-100 rounded-xl">
                  {editingPipelineId === status.id ? (
                    <div className="flex flex-col gap-2 flex-1 mr-4">
                      <div className="flex items-center gap-2">
                        <input 
                          type="text" 
                          value={editingPipelineName}
                          onChange={e => setEditingPipelineName(e.target.value)}
                          className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm font-medium"
                          autoFocus
                        />
                        <button 
                          onClick={() => handleUpdatePipeline(status.id)}
                          className="p-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                        >
                          <Check size={16} />
                        </button>
                        <button 
                          onClick={() => {
                            setEditingPipelineId(null);
                            setEditingPipelineName('');
                          }}
                          className="p-1.5 bg-slate-200 text-slate-600 rounded-lg hover:bg-slate-300 transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          'bg-slate-100 text-slate-800',
                          'bg-blue-100 text-blue-800',
                          'bg-purple-100 text-purple-800',
                          'bg-emerald-100 text-emerald-800',
                          'bg-amber-100 text-amber-800',
                          'bg-rose-100 text-rose-800',
                          'bg-cyan-100 text-cyan-800',
                          'bg-indigo-100 text-indigo-800',
                          'bg-fuchsia-100 text-fuchsia-800',
                        ].map(color => (
                          <button
                            key={color}
                            onClick={() => setEditingPipelineColor(color)}
                            className={`w-5 h-5 rounded-full border-2 ${editingPipelineColor === color ? 'border-slate-400 scale-110' : 'border-transparent'} ${color.split(' ')[0]}`}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col -space-y-1 mr-1">
                          <button 
                            onClick={() => moveStatus(statuses.indexOf(status), 'up')}
                            disabled={statuses.indexOf(status) === 0}
                            className="text-slate-300 hover:text-slate-600 disabled:opacity-30 transition-colors"
                          >
                            <ChevronUp size={14} />
                          </button>
                          <button 
                            onClick={() => moveStatus(statuses.indexOf(status), 'down')}
                            disabled={statuses.indexOf(status) === statuses.length - 1}
                            className="text-slate-300 hover:text-slate-600 disabled:opacity-30 transition-colors"
                          >
                            <ChevronDown size={14} />
                          </button>
                        </div>
                        <div className={`w-3 h-3 rounded-full ${status.color.split(' ')[0]}`} />
                        <span className="font-bold text-slate-700">{status.name}</span>
                        <button 
                          onClick={() => {
                            setEditingPipelineId(status.id);
                            setEditingPipelineName(status.name);
                            setEditingPipelineColor(status.color || 'bg-slate-100 text-slate-800');
                          }}
                          className="text-slate-400 hover:text-blue-500 transition-colors"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button 
                          onClick={() => handleDeleteStatus(status.id)}
                          className="text-slate-400 hover:text-red-500 transition-colors ml-1"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <span className="text-xs font-bold text-slate-400 bg-white px-2 py-1 rounded-md border border-slate-200">
                        {projects.filter(p => managementData[p.id]?.status === status.name).length} Projects
                      </span>
                    </>
                  )}
                </div>
              ))}
              {statuses.length === 0 && (
                <div className="text-center py-4 text-slate-400 text-sm">No statuses exist yet.</div>
              )}
            </div>
          </div>
        </div>
      </Modal>
      {/* Bulk Edit Modal */}
      <Modal
        title={`Bulk Edit (${selectedProjectIds.size} selected)`}
        isOpen={showBulkModal}
        onClose={() => setShowBulkModal(false)}
        onSave={handleBulkSave}
      >
        <div className="space-y-6">
          <div className="bg-blue-50 text-blue-800 p-4 rounded-xl text-sm font-medium flex items-start gap-3">
            <Edit2 className="shrink-0 mt-0.5" size={18} />
            <p>
              Apply changes to all {selectedProjectIds.size} selected projects. Leave unselected fields unchanged.
            </p>
          </div>
          
          <div className="space-y-4">
            {/* Status */}
            <div className="flex items-start gap-3">
              <input 
                type="checkbox" 
                className="mt-1 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                checked={bulkEditFields.updateStatus}
                onChange={(e) => setBulkEditFields({ ...bulkEditFields, updateStatus: e.target.checked })}
              />
              <div className="flex-1">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Change Status</label>
                <select
                  value={bulkEditFields.status}
                  onChange={e => setBulkEditFields({ ...bulkEditFields, status: e.target.value })}
                  disabled={!bulkEditFields.updateStatus || isMoving}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-medium text-slate-700 disabled:opacity-50 disabled:bg-slate-50"
                >
                  <option value="">Select Status</option>
                  {statuses.map(s => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Start Date */}
            <div className="flex items-start gap-3">
              <input 
                type="checkbox" 
                className="mt-1 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                checked={bulkEditFields.updateStartDate}
                onChange={(e) => setBulkEditFields({ ...bulkEditFields, updateStartDate: e.target.checked })}
              />
              <div className="flex-1">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Change Start Date</label>
                <input
                  type="date"
                  value={bulkEditFields.start_date}
                  onChange={e => setBulkEditFields({ ...bulkEditFields, start_date: e.target.value })}
                  disabled={!bulkEditFields.updateStartDate || isMoving}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-medium text-slate-700 disabled:opacity-50 disabled:bg-slate-50"
                />
              </div>
            </div>

            {/* Due Date */}
            <div className="flex items-start gap-3">
              <input 
                type="checkbox" 
                className="mt-1 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                checked={bulkEditFields.updateDueDate}
                onChange={(e) => setBulkEditFields({ ...bulkEditFields, updateDueDate: e.target.checked })}
              />
              <div className="flex-1">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Change Due Date</label>
                <input
                  type="datetime-local"
                  value={toDatetimeLocal(bulkEditFields.due_date)}
                  onChange={e => setBulkEditFields({ ...bulkEditFields, due_date: e.target.value })}
                  disabled={!bulkEditFields.updateDueDate || isMoving}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-medium text-slate-700 disabled:opacity-50 disabled:bg-slate-50"
                />
              </div>
            </div>

            {/* Assignees */}
            <div className="flex items-start gap-3">
              <input 
                type="checkbox" 
                className="mt-1 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                checked={bulkEditFields.updateAssignees}
                onChange={(e) => setBulkEditFields({ ...bulkEditFields, updateAssignees: e.target.checked })}
              />
              <div className="flex-1">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Change Assignees (Replaces current)</label>
                <div className={`flex flex-wrap gap-2 p-3 border rounded-xl transition-all ${bulkEditFields.updateAssignees ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-50'}`}>
                  {teamMembers.map(member => {
                    const isSelected = bulkEditFields.assignees.includes(member.id);
                    return (
                      <button
                        key={member.id}
                        disabled={!bulkEditFields.updateAssignees || isMoving}
                        onClick={() => {
                          const newAssignees = isSelected 
                            ? bulkEditFields.assignees.filter(id => id !== member.id)
                            : [...bulkEditFields.assignees, member.id];
                          setBulkEditFields({ ...bulkEditFields, assignees: newAssignees });
                        }}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${
                          isSelected 
                            ? 'bg-blue-100 text-blue-700 border border-blue-200' 
                            : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                          {member.avatar ? (
                            <img src={member.avatar} alt={member.name} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-[10px] font-bold text-slate-500">
                              {member.name.charAt(0)}
                            </span>
                          )}
                        </div>
                        {member.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* Delete Status Confirmation Modal */}
      <Modal
        title="Delete Status"
        isOpen={statusToDelete !== null}
        onClose={() => setStatusToDelete(null)}
        onSave={confirmDeleteStatus}
        saveLabel="Delete Status"
      >
        <div className="space-y-6">
          <div className="bg-red-50 text-red-800 p-4 rounded-xl text-sm font-medium flex items-start gap-3">
            <AlertCircle className="shrink-0 mt-0.5" size={18} />
            <p>
              Are you sure you want to delete the status <strong>{statuses.find(s => s.id === statusToDelete)?.name}</strong>?
              Projects in this status will be moved to Uncategorized.
            </p>
          </div>
        </div>
      </Modal>

      {/* Custom Column Modal */}
      <Modal
        title={customColForm.id ? 'Edit Column' : 'Add Column'}
        isOpen={showCustomColModal}
        onClose={() => setShowCustomColModal(false)}
        onSave={handleSaveCustomColumn}
        saveLabel={customColForm.id ? 'Save Column' : 'Add Column'}
      >
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Column Name</label>
            <input
              type="text"
              value={customColForm.name}
              onChange={e => setCustomColForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Phase, Department, Region..."
              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-medium text-slate-700"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Dropdown Options</label>
            <div className="space-y-2 mb-3">
              {customColForm.options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded shrink-0" style={{ backgroundColor: opt.color }} />
                  <span className="flex-1 text-sm font-medium text-slate-700">{opt.label}</span>
                  <button onClick={() => setCustomColForm(f => ({ ...f, options: f.options.filter((_, j) => j !== i) }))} className="p-1 text-slate-400 hover:text-red-500 transition-colors">
                    <X size={14} />
                  </button>
                </div>
              ))}
              {customColForm.options.length === 0 && <p className="text-xs text-slate-400 italic">No options yet — add one below.</p>}
            </div>

            <div className="flex gap-2 items-center">
              <input
                type="color"
                value={customColNewColor}
                onChange={e => setCustomColNewColor(e.target.value)}
                className="w-9 h-9 rounded-lg border border-slate-200 cursor-pointer p-0.5 shrink-0"
              />
              <input
                type="text"
                value={customColNewLabel}
                onChange={e => setCustomColNewLabel(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && customColNewLabel.trim()) {
                    setCustomColForm(f => ({ ...f, options: [...f.options, { label: customColNewLabel.trim(), color: customColNewColor }] }));
                    setCustomColNewLabel('');
                  }
                }}
                placeholder="Option label..."
                className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all"
              />
              <button
                onClick={() => {
                  if (!customColNewLabel.trim()) return;
                  setCustomColForm(f => ({ ...f, options: [...f.options, { label: customColNewLabel.trim(), color: customColNewColor }] }));
                  setCustomColNewLabel('');
                }}
                className="px-3 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors shrink-0"
              >
                Add
              </button>
            </div>
          </div>

          {customColForm.id && (
            <button onClick={() => handleDeleteCustomColumn(customColForm.id!)} className="w-full py-2 text-red-500 text-sm font-semibold hover:bg-red-50 rounded-xl transition-colors border border-red-100">
              Delete Column
            </button>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default ProjectManagementView;
