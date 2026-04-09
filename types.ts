
export type PermissionLevel = 'full' | 'edit-hidden' | 'none';

export interface PagePermissions {
  dashboard: PermissionLevel;
  revenue: PermissionLevel;
  payments: PermissionLevel;
  expenses: PermissionLevel;
  projects: PermissionLevel;
  projectManagement: PermissionLevel;
  incomeStreams: PermissionLevel;
  team: PermissionLevel;
  users: PermissionLevel;
  monthlyClosing: PermissionLevel;
  backup: PermissionLevel;
  aiAdvisor: PermissionLevel;
  automations: PermissionLevel;
  withdrawals: PermissionLevel;
  myEarnings: PermissionLevel;
  pmBulkEdit: PermissionLevel;
  pmManageStatuses: PermissionLevel;
}

export interface User {
  id: number;
  username: string;
  password_hash: string;
  name: string;
  email: string | null;
  user_type: 'admin' | 'team_member' | 'partner';
  permissions: PagePermissions;
  team_member_id: number | null;
  linked_income_stream_id: number | null;
  linked_income_stream_ids: number[];
  status: 'active' | 'inactive';
  created_at: string;
}

export interface TeamMember {
  id: number;
  name: string;
  role: 'Partner' | 'Developer' | 'Designer' | 'Bidder' | 'Other';
  designation: string | null;
  slack_username: string | null;
  created_at: string;
}

export interface IncomeStream {
  id: number;
  name: string;
  platform: string;
  platform_fee_percent: number;
  commission_structure: any[];
  is_active: boolean;
  created_at: string;
}

export interface Revenue {
  id: number;
  date: string;
  income_stream_id: number;
  client_name: string;
  project_description: string | null;
  total_sale: number;
  platform_fee_percent: number | null;
  mirjan_involved: boolean;
  created_at: string;
}

export interface Project {
  id: number;
  date: string;
  project_name: string;
  client_name: string;
  income_stream_id: number | null;
  project_description: string | null;
  project_value: number;
  drive_folder_url: string | null;
  drive_client_folder_url: string | null;
  created_at: string;
  pcb_doc_id: string | null;
  project_brief_doc_id: string | null;
  sensitive_doc_id: string | null;
  dev_brief_doc_id: string | null;
  brief_generated: boolean | null;
  folders_creating: boolean | null;
}

export interface ProjectAllocation {
  id: number;
  project_id: number;
  team_member_id: number;
  role: string;
  amount: number;
  created_at: string;
}

export interface Expense {
  id: number;
  date: string;
  description: string;
  amount: number;
  category: string;
  type: 'fixed' | 'variable';
  is_production: boolean;
  income_stream_id: number | null;
  meta: any | null;
  created_at: string;
}

export interface RecurringExpense {
  id: number;
  name: string;
  amount: number;
  category: string;
  day_of_month: number;
  is_active: boolean;
  created_at: string;
}

export interface ProductionPayment {
  id: number;
  date: string;
  payment_type: string;
  recipient_id: number;
  recipient_name: string | null;
  total_amount: number;
  payment_method: string;
  notes: string | null;
  created_at: string;
  paid_revenue_commission_ids?: string[];
}

export interface PaymentProjectRow {
  id: number;
  payment_id: number;
  project_id: number;
  project_name: string;
  client_name: string;
  amount: number;
  project_details: string | null;
}

export interface OtherPayment {
  id: number;
  date: string;
  recipient_type: 'team' | 'external';
  recipient_id: number | null;
  recipient_name: string;
  amount: number;
  description: string;
  category: 'bonus' | 'advance' | 'refund' | 'deduction' | 'other';
  is_paid: boolean;
  settled_in_payment_id: number | null;
  created_at: string;
}

export interface FinancialGoal {
  id: number;
  name: string;
  target_amount: number;
  current_progress: number;
  target_date: string;
  priority: 'high' | 'medium' | 'low';
  category: string;
  monthly_allocation: number;
  allocation_reasoning: string;
  icon: string;
  is_achieved: boolean;
  created_at: string;
}

export interface Tag {
  text: string;
  color: string;
}
