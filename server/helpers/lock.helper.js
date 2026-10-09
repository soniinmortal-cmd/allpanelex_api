const { getRedis } = require("./redis");

/**
 * Robust lock release script (Lua) to ensure we only delete OUR lock.
 */
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
`;

/**
 * Acquire a lock for a specific key.
 * @param {string} key - The unique lock key (e.g., `lock:user:123`).
 * @param {number} ttl - Time to live in milliseconds (default 5000ms).
 * @returns {Promise<boolean>} - Returns true if lock acquired, false otherwise.
 */
const acquireLock = async (key, ttl = 5000) => {
    try {
        const redis = await getRedis();
        // Use a unique value to identify the owner of the lock
        const lockValue = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        
        const result = await redis.set(key, lockValue, {
            NX: true, // Only set if not exists
            PX: ttl,  // Expire in ttl milliseconds
        });
        
        return result === "OK" ? lockValue : false;
    } catch (err) {
        console.error(`Error acquiring lock for key "${key}":`, err);
        return false;
    }
};

/**
 * Release a lock for a specific key.
 * @param {string} key - The unique lock key.
 * @returns {Promise<void>}
 */
const releaseLock = async (key, lockValue) => {
    if (!lockValue) {
        // Fallback for legacy calls that didn't store the lockValue, 
        // though we should encourage passing it.
        console.warn(`⚠️ releaseLock called without lockValue for "${key}"; fallback to unsafe delete.`);
        try {
            const redis = await getRedis();
            await redis.del(key);
        } catch (err) {
            console.error(`Error releasing lock for key "${key}":`, err);
        }
        return;
    }

    try {
        const redis = await getRedis();
        await redis.eval(RELEASE_LOCK_SCRIPT, {
            keys: [key],
            arguments: [lockValue],
        });
    } catch (err) {
        console.error(`Error safely releasing lock for key "${key}":`, err);
    }
};

module.exports = {
    acquireLock,
    releaseLock,
};
