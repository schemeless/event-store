export interface AccountBalanceView {
  accountId: string;
  balance: number;
}

export interface AccountSummaryView {
  accountId: string;
  ownerName?: string;
  balance: number;
  status: 'open';
}

export class MemoryProjectionStore {
  balances = new Map<string, AccountBalanceView>();
  summaries = new Map<string, AccountSummaryView>();

  reset(): void {
    this.balances.clear();
    this.summaries.clear();
  }
}
