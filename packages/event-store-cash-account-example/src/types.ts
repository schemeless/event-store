export type CashAccountCommand =
  | { kind: 'OpenCashAccount'; accountId: string; ownerName: string; openingBalance: number }
  | { kind: 'DepositCash'; accountId: string; amount: number }
  | { kind: 'WithdrawCash'; accountId: string; amount: number };

export type CashAccountEvent =
  | {
      id?: string;
      domain: 'cashAccount';
      type: 'CashAccountOpened';
      identifier?: string;
      payload: { accountId: string; ownerName: string; openingBalance: number };
      created: Date;
      sequence?: number;
    }
  | {
      id?: string;
      domain: 'cashAccount';
      type: 'CashDeposited';
      identifier?: string;
      payload: { accountId: string; amount: number };
      created: Date;
      sequence?: number;
    }
  | {
      id?: string;
      domain: 'cashAccount';
      type: 'CashWithdrawn';
      identifier?: string;
      payload: { accountId: string; amount: number };
      created: Date;
      sequence?: number;
    };

export interface CashAccountState {
  opened: boolean;
  ownerName?: string;
  balance: number;
}
