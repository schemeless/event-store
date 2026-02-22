export const logger = {
    info: (msg: string, ...args: any[]) => console.log(`[PgEventStore] INFO: ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => console.error(`[PgEventStore] ERROR: ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => console.warn(`[PgEventStore] WARN: ${msg}`, ...args),
};
