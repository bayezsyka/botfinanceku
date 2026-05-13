import { supabase } from '../../lib/supabase.js';
import { Expense } from './expense.types.js';

export const expenseRepository = {
  async createExpense(data: Expense) {
    const { data: result, error } = await supabase
      .from('expenses')
      .insert([data])
      .select()
      .single();

    if (error) throw error;
    return result;
  },

  async getExpensesByDate(date: string, workspaceId?: string | null) {
    let query = supabase
      .from('expenses')
      .select('*')
      .eq('expense_date', date)
      .order('created_at', { ascending: true });

    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
    }

    const { data, error } = await query;

    if (error) throw error;
    return data as Expense[];
  },

  async deleteExpense(id: string, workspaceId?: string | null) {
    let query = supabase
      .from('expenses')
      .delete()
      .eq('id', id);

    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
    }

    const { error } = await query;

    if (error) throw error;
  },
};
