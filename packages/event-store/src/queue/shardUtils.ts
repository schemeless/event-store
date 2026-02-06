/**
 * djb2 hash algorithm - simple and effective string hash function
 * @param str - String to hash
 * @returns 32-bit unsigned integer hash
 */
export const hashString = (str: string): number => {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        // hash * 33 + char
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    // Convert to unsigned 32-bit integer
    return hash >>> 0;
};

/**
 * Get partition index from a key using consistent hashing
 * Handles negative modulo correctly and ensures result is in [0, numPartitions)
 * 
 * @param key - The shard key
 * @param numPartitions - Number of partitions
 * @returns Partition index in range [0, numPartitions)
 */
export const getPartitionIndex = (key: string, numPartitions: number): number => {
    if (numPartitions <= 1) return 0;

    const hash = hashString(key);
    // Safe modulo that handles potential negative numbers (though hash is unsigned)
    return ((hash % numPartitions) + numPartitions) % numPartitions;
};
