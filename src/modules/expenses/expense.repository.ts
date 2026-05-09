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

  async getExpensesByDate(date: string) {
    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .eq('expense_date', date)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data as Expense[];
  },
};
