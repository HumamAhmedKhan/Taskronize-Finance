import React from 'react';
import { Bell } from 'lucide-react';
import { AppNotification, User } from '../types';

const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-purple-500',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-amber-500',
  'bg-cyan-500',
  'bg-indigo-500',
  'bg-pink-500',
];

const timeAgo = (dateStr: string): string => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
};

const getInitials = (name: string): string => {
  const words = name.trim().split(/\s+/);
  const initials = words.map(w => w.charAt(0).toUpperCase()).slice(0, 2).join('');
  return initials;
};

interface NotificationDropdownProps {
  notifications: AppNotification[];
  unreadCount: number;
  position: { top: number; left: number };
  currentUser: User;
  notifAllUsers: { id: number; name: string }[];
  notifAdminUserId: number | null;
  onAdminUserChange: (id: number) => void;
  onMarkAllRead: () => void;
  onNotifClick: (notif: AppNotification) => void;
}

const NotificationDropdown = React.forwardRef<
  HTMLDivElement,
  NotificationDropdownProps
>((props, ref) => {
  const {
    notifications,
    unreadCount,
    position,
    currentUser,
    notifAllUsers,
    notifAdminUserId,
    onAdminUserChange,
    onMarkAllRead,
    onNotifClick,
  } = props;

  const unread = notifications.filter(n => !n.is_read);
  const read = notifications.filter(n => n.is_read);

  const getAvatarColor = (name: string): string => {
    return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
  };

  const getTypeBadgeClasses = (
    type: 'mention' | 'assigned' | 'comment'
  ): string => {
    switch (type) {
      case 'mention':
        return 'bg-purple-100 text-purple-700';
      case 'assigned':
        return 'bg-teal-100 text-teal-700';
      case 'comment':
        return 'bg-amber-100 text-amber-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  const truncate = (text: string, maxLength: number): string => {
    return text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
  };

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        width: 380,
        zIndex: 9999,
      }}
      className="bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col max-h-[520px]"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0 flex items-center justify-between">
        <h2 className="font-bold text-gray-900 text-sm">Notifications</h2>
        <div className="flex items-center gap-3">
          {unreadCount > 0 && (
            <span className="bg-blue-100 text-blue-700 text-xs font-bold rounded-full px-2 py-0.5">
              {unreadCount}
            </span>
          )}
          <button
            onClick={onMarkAllRead}
            disabled={unreadCount === 0}
            className={`text-xs font-medium ${
              unreadCount === 0
                ? 'opacity-50 cursor-not-allowed text-gray-400'
                : 'text-blue-600 hover:underline cursor-pointer'
            }`}
          >
            Mark all read
          </button>
        </div>
      </div>

      {/* Admin Filter */}
      {currentUser.user_type === 'admin' && (
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex-shrink-0">
          <label className="text-xs text-gray-600 font-medium">Viewing:</label>
          <select
            value={notifAdminUserId || ''}
            onChange={(e) => onAdminUserChange(Number(e.target.value))}
            className="mt-1 block w-full text-xs border border-gray-300 rounded px-2 py-1 bg-white text-gray-700"
          >
            {notifAllUsers.map(user => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Notifications Body */}
      <div className="flex-1 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <Bell size={32} className="mb-2" />
            <p className="text-sm">No notifications</p>
          </div>
        ) : (
          <>
            {/* New Section */}
            {unread.length > 0 && (
              <div>
                <div className="px-4 pt-3 pb-1">
                  <p className="text-[10px] font-bold text-gray-400 tracking-widest uppercase">
                    New
                  </p>
                </div>
                {unread.map(notif => (
                  <div
                    key={notif.id}
                    onClick={() => onNotifClick(notif)}
                    className="px-4 py-3 bg-blue-50 hover:bg-gray-50 cursor-pointer transition-colors flex items-start gap-3"
                  >
                    {/* Avatar */}
                    <div
                      className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold ${getAvatarColor(
                        notif.actor_name
                      )}`}
                    >
                      {getInitials(notif.actor_name)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 leading-snug">
                        {truncate(notif.message, 80)}
                      </p>
                      {notif.preview && (
                        <p className="text-xs text-gray-400 truncate mt-0.5">
                          {truncate(notif.preview, 60)}
                        </p>
                      )}
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-[10px] text-gray-400">
                          {timeAgo(notif.created_at)}
                        </span>
                        <span
                          className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ml-2 ${getTypeBadgeClasses(
                            notif.type
                          )}`}
                        >
                          {notif.type}
                        </span>
                      </div>
                    </div>

                    {/* Unread dot */}
                    <div className="flex-shrink-0 flex items-center">
                      <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Earlier Section */}
            {read.length > 0 && (
              <div>
                <div className="px-4 pt-3 pb-1">
                  <p className="text-[10px] font-bold text-gray-400 tracking-widest uppercase">
                    Earlier
                  </p>
                </div>
                {read.map(notif => (
                  <div
                    key={notif.id}
                    onClick={() => onNotifClick(notif)}
                    className="px-4 py-3 bg-white hover:bg-gray-50 cursor-pointer transition-colors flex items-start gap-3"
                  >
                    {/* Avatar */}
                    <div
                      className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold ${getAvatarColor(
                        notif.actor_name
                      )}`}
                    >
                      {getInitials(notif.actor_name)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 leading-snug">
                        {truncate(notif.message, 80)}
                      </p>
                      {notif.preview && (
                        <p className="text-xs text-gray-400 truncate mt-0.5">
                          {truncate(notif.preview, 60)}
                        </p>
                      )}
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-[10px] text-gray-400">
                          {timeAgo(notif.created_at)}
                        </span>
                        <span
                          className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ml-2 ${getTypeBadgeClasses(
                            notif.type
                          )}`}
                        >
                          {notif.type}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});

NotificationDropdown.displayName = 'NotificationDropdown';

export default NotificationDropdown;
