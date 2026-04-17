
import React from 'react';
import { User } from '../types';
import PersonalTasksView from './PersonalTasksView';
import TeamTasksView from './TeamTasksView';

interface TasksViewProps {
  currentUser: User;
  activeTab: 'personal' | 'team';
  onTabChange: (tab: 'personal' | 'team') => void;
}

const TasksView: React.FC<TasksViewProps> = ({ currentUser, activeTab, onTabChange }) => {

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Tasks</h2>
          <p className="text-slate-500 text-sm">Manage personal and team tasks.</p>
        </div>
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
          <button
            onClick={() => onTabChange('personal')}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
              activeTab === 'personal'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            My Tasks
          </button>
          <button
            onClick={() => onTabChange('team')}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
              activeTab === 'team'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Team Tasks
          </button>
        </div>
      </div>

      {activeTab === 'personal' ? (
        <PersonalTasksView currentUser={currentUser} />
      ) : (
        <TeamTasksView currentUser={currentUser} />
      )}
    </div>
  );
};

export default TasksView;
