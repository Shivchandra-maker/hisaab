import { createContext, useContext } from 'react';
import type { Account, Category, Transaction } from './domain/types';

/** Things any screen can open: editors, toasts, navigation. Provided by App. */
export type TxnDraft = Partial<Transaction>;

export interface UI {
  go: (route: string) => void;
  openTxn: (t?: TxnDraft) => void;
  openAccount: (a?: Partial<Account>) => void;
  openCategory: (c?: Partial<Category>) => void;
  toast: (message: string, undo?: () => void) => void;
}

export const UICtx = createContext<UI | null>(null);

export function useUI(): UI {
  const u = useContext(UICtx);
  if (!u) throw new Error('useUI outside App');
  return u;
}
