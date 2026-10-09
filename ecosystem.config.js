module.exports = {
  apps: [
    {
      name: "jsk-api",
      script: "index.js",
      instances: "max",       // Use all CPU cores for the API
      exec_mode: "cluster",   // Multi-process load balancing
      env: {
        NODE_ENV: "production",
      },
      watch: false,           // Disable watch in production for performance
      max_memory_restart: "1G"
    },
    {
      name: "jsk-worker",
      script: "worker.js",
      instances: 1,           // Background tasks only need 1 instance
      exec_mode: "fork",      // Standard single process
      env: {
        NODE_ENV: "production",
      },
      watch: false,
      max_memory_restart: "1G"
    }
  ]
};
