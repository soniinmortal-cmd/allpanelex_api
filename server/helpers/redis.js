const { createClient } = require("redis");

const redis = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
  },
  password: process.env.REDIS_PASSWORD,
});

redis.on("connect", () => console.log("Redis connected"));
redis.on("ready", () => console.log("Redis ready"));
redis.on("error", (err) => console.error("Redis error:", err));

let isConnecting = false;

async function getRedis() {
  try {
    if (!redis.isOpen && !isConnecting) {
      isConnecting = true;
      await redis.connect();
      isConnecting = false;
    }
    return redis;
  } catch (err) {
    console.error("Redis failed, but continuing app:", err);

    // 🔥 IMPORTANT: NEVER BREAK APP FLOW
    return redis;   // ❗ NOT null
  }
}

module.exports = { getRedis };