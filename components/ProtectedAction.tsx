import React from 'react';
import { User } from '../types';

interface ProtectedActionProps {
  children: React.ReactNode;
  user: User;
  page: keyof User['permissions'];
  fallback?: React.ReactNode;
}

const ProtectedAction: React.FC<ProtectedActionProps> = ({
  children,
  user,
  page,
  fallback = null
}) => {
  const hasAccess = user.permissions[page] === 'full';
  
  if (!hasAccess) {
    return <>{fallback}</>;
  }
  
  return <>{children}</>;
};

export default ProtectedAction;