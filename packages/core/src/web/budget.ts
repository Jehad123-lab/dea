/** A time budget shared by the steps of one call. A step that runs out of it fails with a plain error instead of hanging. */
export class BudgetExceeded extends Error {
  constructor(
    readonly what: string,
    readonly limitMs: number,
  ) {
    super(`${what} did not finish within ${Math.round(limitMs / 1000)} s (the time budget for this call)`);
    this.name = 'BudgetExceeded';
  }
}

export class Budget {
  readonly signal: AbortSignal;
  private readonly t0 = Date.now();
  constructor(readonly totalMs: number) {
    this.signal = AbortSignal.timeout(Math.max(1, totalMs));
  }
  remainingMs(): number {
    return Math.max(0, this.totalMs - (Date.now() - this.t0));
  }
  expired(): boolean {
    return this.remainingMs() <= 0;
  }
  /** a signal that ends at this budget or after `ms`, whichever comes first */
  within(ms: number): AbortSignal {
    return AbortSignal.any([this.signal, AbortSignal.timeout(Math.max(1, ms))]);
  }
  /** Run a step; if the budget ends first, say which step it was. */
  async run<T>(what: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.expired()) throw new BudgetExceeded(what, this.totalMs);
    try {
      return await fn(this.signal);
    } catch (e) {
      if (this.expired() || (e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError') throw new BudgetExceeded(what, this.totalMs);
      throw e;
    }
  }
}
