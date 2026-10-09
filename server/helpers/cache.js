const { getRedis } = require("./redis");

// In-memory map to store pending promises for deduplication on the same instance
const pendingPromises = new Map();

/**
 * Robust lock release script (Lua) to ensure we only delete OUR lock.
 * Returns 1 if released, 0 if not found or owned by someone else.
 */
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
`;

const getCache = async (key) => {
  try {
    const redis = await getRedis();
    const result = await redis.get(key);
    return result ? JSON.parse(result) : null;
  } catch (err) {
    console.error(`Error getting cache for key "${key}":`, err);
    return null;
  }
};

const setCache = async (key, value, ttl = 3600) => {
  try {
    const redis = await getRedis();
    await redis.setEx(key, ttl, JSON.stringify(value));
  } catch (err) {
    console.error(` Error setting cache for key "${key}":`, err);
  }
};

const delCache = async (key) => {
  try {
    const redis = await getRedis();
    await redis.del(key);
  } catch (err) {
    console.error(` Error deleting cache key "${key}":`, err);
  }
};

const delCacheByPattern = async (pattern) => {
  try {
    const redis = await getRedis();
    let cursor = 0;
    let totalDeleted = 0;

    do {
      const result = await redis.scan(cursor, {
        MATCH: pattern,
        COUNT: 100,
      });


      let newCursor, keys;
      if (Array.isArray(result)) {
        [newCursor, keys] = result;
      } else {
        newCursor = result.cursor ?? result[0];
        keys = result.keys ?? result[1] ?? [];
      }

      if (keys.length > 0) {
        await redis.del(...keys);
        totalDeleted += keys.length;
      }

      cursor = Number(newCursor);
    } while (cursor !== 0);

    console.log(`🧹 Deleted ${totalDeleted} keys for pattern: "${pattern}"`);
  } catch (err) {
    console.error(
      `❌ Error deleting cache keys with pattern "${pattern}":`,
      err
    );
  }
};

/**
 * Get data from cache, or fetch it if missing, ensuring only one fetch happens at a time.
 * Uses in-memory deduplication for local concurrency and Redis locking for distributed concurrency.
 * @param {string} key - The cache key.
 * @param {function} fetchFunction - The function to fetch data if cache is missing. Must return a promise.
 * @param {number} ttl - Time to live in seconds.
 * @returns {Promise<any>} - The cached or fetched data.
 */
const getOrSetCache = async (key, fetchFunction, ttl = 3600) => {
  // 1. Check if we correspond to a pending promise locally
  if (pendingPromises.has(key)) {
    return pendingPromises.get(key);
  }

  // 2. Try to get from cache first
  const cachedValue = await getCache(key);
  if (cachedValue) {
    return cachedValue;
  }

      // 3. Define the fetch task
  const fetchTask = async () => {
    const redis = await getRedis();
    const lockKey = `lock:${key}`;
    const lockValue = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    let acquiredLock = false;

    try {
      // Try to acquire distributed lock
      // SET key value NX EX 10 (Set if Not Exists, Expire in 10 seconds)
      const result = await redis.set(lockKey, lockValue, {
        NX: true,
        EX: 10,
      });

      if (result === "OK") {
        acquiredLock = true;
      } else {
        // Did not acquire lock, wait and retry getting cache
        let attempts = 0;
        while (attempts < 50) { // Wait up to 5 seconds (50 * 100ms)
          await new Promise((resolve) => setTimeout(resolve, 100));
          const val = await getCache(key);
          if (val) return val;
          attempts++;
        }
        // Fallback: If still no value, we might proceed to fetch anyway to avoid hanging 
        // especially if the previous owner crashed.
        console.warn(`⚠️ Lock wait timeout for "${key}". Proceeding with redundant fetch.`);
      }

      // Perform the actual fetch
      const data = await fetchFunction();

      // Only cache if data is valid (not null/undefined)
      if (data !== undefined && data !== null) {
        await setCache(key, data, ttl);
      }

      return data;

    } catch (err) {
      if (err.isAxiosError || err.config) {
        const method = err.config?.method?.toUpperCase() || "UNKNOWN";
        const url = err.config?.url || "UNKNOWN";
        const status = err.response?.status || 500;
        console.error(`❌ Cache fetch error for "${key}": ${method} ${url} [${status}] - ${err.message}`);
      } else {
        console.error(`Error in getOrSetCache for key "${key}":`, err.message || err);
      }
      throw err;
    } finally {
      // Release lock ONLY if we acquired it AND it's still ours
      if (acquiredLock) {
        try {
          await redis.eval(RELEASE_LOCK_SCRIPT, {
            keys: [lockKey],
            arguments: [lockValue],
          });
        } catch (lockErr) {
          console.error(`Error releasing lock for "${lockKey}":`, lockErr.message);
        }
      }
      pendingPromises.delete(key);
    }
  };

  // 4. Store the promise in memory to dedup local calls
  const promise = fetchTask();
  pendingPromises.set(key, promise);

  return promise;
};

module.exports = {
  getCache,
  setCache,
  delCache,
  delCacheByPattern,
  getOrSetCache,
};
