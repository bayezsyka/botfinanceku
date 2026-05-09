import { ParsedExpense } from './expense.types.js';

export function parseExpenseMessage(message: string): ParsedExpense | null {
  const tokens = message.trim().split(/\s+/);
  if (tokens.length < 2) return null;

  const rawAmount = tokens.pop()!;
  const subject = tokens.join(' ');

  if (!subject) return null;

  const amount = parseAmount(rawAmount);
  if (amount === null || amount <= 0) return null;

  return {
    subject,
    amount,
    raw_amount: rawAmount,
  };
}

function parseAmount(raw: string): number | null {
  let cleaned = raw.toLowerCase().replace(/,/g, '.');
  
  // Extract number and suffix
  const match = cleaned.match(/^([\d.]+)(k|rb|ribu|jt|juta)?$/);
  if (!match) return null;

  const numPart = parseFloat(match[1]);
  const suffix = match[2];

  if (isNaN(numPart)) return null;

  let multiplier = 1;
  if (suffix) {
    if (['k', 'rb', 'ribu'].includes(suffix)) {
      multiplier = 1000;
    } else if (['jt', 'juta'].includes(suffix)) {
      multiplier = 1000000;
    }
  }

  return Math.floor(numPart * multiplier);
}
