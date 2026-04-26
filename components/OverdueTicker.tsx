import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { User } from '../types';
import { AlertTriangle } from 'lucide-react';

interface Props {
  currentUser: User;
}

const OverdueTicker: React.FC<Props> = ({ currentUser }) => {
  const [titles, setTitles] = useState<string[]>([]);

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];

    const fetchOverdue = async () => {
      // Fetch all personal tasks (same as PersonalTasksView — filter client-side)
      const { data: personalData, error: personalErr } = await supabase
        .from('personal_tasks')
        .select('title, completed, due_date')
        .eq('user_id', currentUser.id);

      if (personalErr) console.error('[OverdueTicker] personal_tasks error:', personalErr);

      const personal = (personalData || [])
        .filter((t: any) => !t.completed && t.due_date && t.due_date < today)
        .map((t: any) => t.title as string);

      let team: string[] = [];
      if (currentUser.team_member_id) {
        const { data: teamData, error: teamErr } = await supabase
          .from('team_task_assignees')
          .select('team_tasks(title, due_date, completed, status)')
          .eq('team_member_id', currentUser.team_member_id);

        if (teamErr) console.error('[OverdueTicker] team_task_assignees error:', teamErr);

        team = (teamData || [])
          .map((r: any) => r.team_tasks)
          .filter(
            (t: any) =>
              t &&
              !t.completed &&
              t.status !== 'completed' &&
              t.due_date &&
              t.due_date < today
          )
          .map((t: any) => t.title as string);
      }

      const all = [...personal, ...team];
      console.log('[OverdueTicker] overdue tasks:', all, 'today:', today);
      setTitles(all);
    };

    fetchOverdue();
  }, [currentUser.id, currentUser.team_member_id]);

  if (titles.length === 0) return null;

  const segment = titles.map(t => `OVERDUE: ${t}`).join('   ·   ');
  const content = `${segment}   ·   ${segment}`;

  return (
    <div className="flex items-stretch bg-red-600 text-white text-[11px] font-bold h-8 overflow-hidden shrink-0">
      <div className="flex items-center gap-2 px-4 bg-red-700 shrink-0 z-10">
        <AlertTriangle size={13} />
        <span className="uppercase tracking-widest whitespace-nowrap">Overdue Tasks</span>
      </div>
      <div className="flex-1 overflow-hidden flex items-center">
        <span className="animate-ticker whitespace-nowrap uppercase tracking-wide">
          {content}
        </span>
      </div>
    </div>
  );
};

export default OverdueTicker;
