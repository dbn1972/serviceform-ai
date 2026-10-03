export type BreakerState = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private halfOpenInFlight = false;

  constructor(
    private readonly failureThreshold = 5,
    private readonly openMs = 5000,
  ) {}

  state(now = Date.now()): BreakerState {
    if (this.failures < this.failureThreshold) return 'closed';
    if (now - this.openedAt >= this.openMs) return 'half_open';
    return 'open';
  }

  /** Returns false when the call must not proceed. Half-open admits one probe. */
  tryEnter(now = Date.now()): boolean {
    const s = this.state(now);
    if (s === 'closed') return true;
    if (s === 'open') return false;
    if (this.halfOpenInFlight) return false;
    this.halfOpenInFlight = true;
    return true;
  }

  onSuccess(): void {
    this.failures = 0;
    this.openedAt = 0;
    this.halfOpenInFlight = false;
  }

  onFailure(now = Date.now()): void {
    this.failures += 1;
    this.halfOpenInFlight = false;
    if (this.failures >= this.failureThreshold) this.openedAt = now;
  }
}
