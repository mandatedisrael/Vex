export const RETTIWT_API_KEY_ENV = "RETTIWT_API_KEY";
export const RETTIWT_PROXY_URL_ENV = "RETTIWT_PROXY_URL";
export const RETTIWT_TIMEOUT_MS_ENV = "RETTIWT_TIMEOUT_MS";
export const RETTIWT_DELAY_MS_ENV = "RETTIWT_DELAY_MS";
export const RETTIWT_MAX_RETRIES_ENV = "RETTIWT_MAX_RETRIES";

export interface TwitterAccountRateLimit {
  limit?: string;
  remaining?: string;
  reset?: string;
}

export interface TwitterAccountResult {
  action: string;
  data: unknown;
  rateLimit?: TwitterAccountRateLimit;
}

export interface CursoredJson<T = unknown> {
  items: T[];
  next: string;
}
