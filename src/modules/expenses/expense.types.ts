export interface Expense {
  id?: string;
  subject: string;
  amount: number;
  raw_amount: string;
  sender_jid: string;
  sender_phone: string;
  expense_date: string;
  created_at?: string;
}

export interface ParsedExpense {
  subject: string;
  amount: number;
  raw_amount: string;
}
