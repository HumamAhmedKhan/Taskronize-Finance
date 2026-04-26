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
      const { data: personalData } = await supabase
        .from('personal_tasks')
        .select('title, completed, due_date')
        .eq('user_id', currentUser.id);

      const personal = (personalData || [])
        .filter((t: any) => !t.completed && t.due_date && t.due_date < today)
        .map((t: any) => t.title as string);

      let team: string[] = [];
      if (currentUser.team_member_id) {
        const { data: teamData } = await supabase
          .from('team_task_assignees')
          .select('team_tasks(title, due_date, completed, status)')
          .eq('team_member_id', currentUser.team_member_id);

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

      setTitles([...personal, ...team]);
    };

    fetchOverdue();

    // Re-evaluate whenever a personal task changes (e.g. marked complete)
    const channel = supabase
      .channel('overdue-ticker')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'personal_tasks', filter: `user_id=eq.${currentUser.id}` },
        () => fetchOverdue()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'team_tasks' },
        () => fetchOverdue()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
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
