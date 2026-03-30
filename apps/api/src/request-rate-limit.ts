export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, number[]>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  check(key: string, limit: number, windowMs: number): RateLimitResult {
    if (limit <= 0 || windowMs <= 0) {
      return {
        allowed: true,
        retryAfterSeconds: 0,
      };
    }

    const currentTime = this.now();
    const cutoff = currentTime - windowMs;
    const recent = (this.buckets.get(key) ?? []).filter((timestamp) => timestamp > cutoff);

    if (recent.length >= limit) {
      const oldestAllowedTimestamp = recent[0] ?? currentTime;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldestAllowedTimestamp + windowMs - currentTime) / 1000));
      this.buckets.set(key, recent);
      return {
        allowed: false,
        retryAfterSeconds,
      };
    }

    recent.push(currentTime);
    this.buckets.set(key, recent);
    return {
      allowed: true,
      retryAfterSeconds: 0,
    };
  }
}
