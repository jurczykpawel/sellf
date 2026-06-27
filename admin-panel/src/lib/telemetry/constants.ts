export const PROJECT = 'sellf';
export const SCHEMA_VERSION = 1 as const;
export const DEFAULT_TELEMETRY_URL = 'https://telemetry.techskills.academy/v1/ingest';
export const SEND_WINDOW_MS = 20 * 60 * 60 * 1000; // ~daily cadence gate
export const RETRY_LEASE_MS = 60 * 60 * 1000;       // don't re-attempt within 1h
export const POLL_INTERVAL_MS = 60 * 60 * 1000;     // hourly tick; DB claim is the real gate
export const BOOT_DELAY_MS = 30 * 1000;             // defer first attempt off cold start
