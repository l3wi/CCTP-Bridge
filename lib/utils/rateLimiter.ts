/**
 * Simple rate limiter for API calls.
 * Ensures minimum interval between calls to prevent hitting rate limits.
 */

export class RateLimiter {
  private lastCall = 0;
  private readonly minInterval: number;

  constructor(requestsPerSecond: number) {
    this.minInterval = 1000 / requestsPerSecond;
  }

  /**
   * Throttle a function call to respect rate limits.
   * If called too soon after the previous call, waits before executing.
   */
  async throttle<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCall;

    if (timeSinceLastCall < this.minInterval) {
      await new Promise((r) => setTimeout(r, this.minInterval - timeSinceLastCall));
    }

    this.lastCall = Date.now();
    return fn();
  }
}

/**
 * Rate limiter for Circle's Iris API.
 * Iris has a rate limit of 35 requests/second with 5-minute blocks on violations.
 * We use 15 req/s to stay well under the limit.
 */
export const irisRateLimiter = new RateLimiter(15);
