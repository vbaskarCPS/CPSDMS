// src/planner/features/money/categories.ts — the fixed category list and the built-in merchant rules.
export interface Category { name: string; icon: string; color: string; spending: boolean }

export const CATEGORIES: Category[] = [
  { name: 'Groceries', icon: 'ShoppingCart', color: '#2a9d8f', spending: true },
  { name: 'Dining', icon: 'Utensils', color: '#e76f51', spending: true },
  { name: 'Coffee', icon: 'Coffee', color: '#a86b0a', spending: true },
  { name: 'Transport', icon: 'Bus', color: '#457b9d', spending: true },
  { name: 'Gas', icon: 'Fuel', color: '#6d597a', spending: true },
  { name: 'Housing', icon: 'Home', color: '#0f3d3e', spending: true },
  { name: 'Utilities', icon: 'Zap', color: '#f4a261', spending: true },
  { name: 'Phone & Internet', icon: 'Smartphone', color: '#3d5a80', spending: true },
  { name: 'Insurance', icon: 'Shield', color: '#5c677d', spending: true },
  { name: 'Health', icon: 'HeartPulse', color: '#c0392b', spending: true },
  { name: 'Fitness', icon: 'Dumbbell', color: '#1b998b', spending: true },
  { name: 'Shopping', icon: 'ShoppingBag', color: '#b56576', spending: true },
  { name: 'Kids', icon: 'Baby', color: '#f6b23c', spending: true },
  { name: 'Entertainment', icon: 'Film', color: '#8e44ad', spending: true },
  { name: 'Subscriptions', icon: 'Repeat', color: '#6c5ce7', spending: true },
  { name: 'Travel', icon: 'Plane', color: '#0984e3', spending: true },
  { name: 'Gifts', icon: 'Gift', color: '#e84393', spending: true },
  { name: 'Education', icon: 'GraduationCap', color: '#00897b', spending: true },
  { name: 'Personal care', icon: 'Scissors', color: '#d35400', spending: true },
  { name: 'Transfers', icon: 'ArrowLeftRight', color: '#7f8c8d', spending: false },
  { name: 'Credit card payment', icon: 'CreditCard', color: '#7f8c8d', spending: false },
  { name: 'Income', icon: 'Banknote', color: '#2a9d8f', spending: false },
  { name: 'Fees & interest', icon: 'Percent', color: '#c0392b', spending: true },
  { name: 'Cash', icon: 'Wallet', color: '#636e72', spending: true },
  { name: 'Other', icon: 'CircleDashed', color: '#95a5a6', spending: true },
];
export const CATEGORY_NAMES = CATEGORIES.map(c => c.name);
export const SPENDING_CATEGORIES = CATEGORIES.filter(c => c.spending).map(c => c.name);
export const byName = (name: string): Category => CATEGORIES.find(c => c.name === name) || CATEGORIES[CATEGORIES.length - 1];

// Built-in merchant rules: shared with the planner-plaid edge function (bank rows get the same categories).
export { builtinCategory } from '../../../../supabase/functions/_shared/plannerMoney';
