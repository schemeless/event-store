export class ConcurrencyError extends Error {
    constructor(
        public readonly streamKey: string,
        public readonly expectedSequence: number,
        public readonly actualSequence: number
    ) {
        super(
            `Concurrency conflict on stream "${streamKey}": expected sequence ${expectedSequence}, but found ${actualSequence}`
        );
        this.name = 'ConcurrencyError';
    }
}
