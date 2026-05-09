create extension if not exists "pgcrypto";

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  subject text not null,
  amount integer not null check (amount > 0),
  raw_amount text not null,
  sender_jid text not null,
  sender_phone text not null,
  expense_date date not null,
  created_at timestamptz not null default now()
);

create index if not exists expenses_expense_date_idx
on expenses (expense_date);

create index if not exists expenses_sender_phone_idx
on expenses (sender_phone);
