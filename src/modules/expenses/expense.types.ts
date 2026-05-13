export interface Expense {
  id?: string;
  workspace_id?: string | null;
  created_by_phone?: string | null;

  subject: string;
  amount: number;
  raw_amount: string;
  sender_jid: string;
  sender_phone: string;
  expense_date: string;
  created_at?: string;

  predicted_category?: string | null;
  confidence?: number | null;
  is_confident?: boolean;
  confirmed_category?: string | null;
  is_confirmed?: boolean;
  model_version?: string | null;
}

export interface ParsedExpense {
  subject: string;
  amount: number;
  raw_amount: string;
}
