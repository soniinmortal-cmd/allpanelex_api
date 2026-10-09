const mongoose = require("mongoose");
const util = require("util");
const cron = require("node-cron");
const config = require("./config/config");
const app = require("./config/express");
//app.set("trust proxy", true);

const debug = require("debug")("express-mongoose-es6-rest-api:index");
const { getRedis } = require("./server/helpers/redis");
const {
  checkCasinoBettingResult,
} = require("./server/helpers/bettingResultChecker");
const { getAllUsers, deleteUser } = require("./server/apis/users/users.helper");
const { deleteManyBet } = require("./server/apis/bet/bet.helper");
const {
  deleteManyTransaction,
} = require("./server/apis/transaction/transaction.helper");
const {
  deleteManySportsData,
} = require("./server/apis/sports-data/sports-data.helper");
const {
  deleteManyUserPerformances,
} = require("./server/apis/userPerformance/userPerformance.helper");
const { Domain } = require("./server/apis/domain/domain.helper");
const { Game } = require("./server/apis/games/games.helper");
const httpServer = require("http").Server(app);

// ========================================
// SOCKET.IO - ONLY FOR GAMEDATA PRIVATE
// ========================================
const { Server } = require("socket.io");

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});
const registerGamedataSocket =
  require("./server/sockets/gamedata.socket");

const registerGetByIdSocket =
  require("./server/sockets/getById.socket");

const registerData2Socket =
  require("./server/sockets/data2.socket");


registerGamedataSocket(io);
registerGetByIdSocket(io);
registerData2Socket(io);
// ========================================
// ===== NODE HEALTH MONITOR =====
const {
  monitorEventLoopDelay,
  performance,
} = require("perf_hooks");

const eventLoop = monitorEventLoopDelay({
  resolution: 20,
});

eventLoop.enable();

let previousCpuUsage = process.cpuUsage();
let previousTime = Date.now();
let previousELU = performance.eventLoopUtilization();

setInterval(() => {
  const now = Date.now();

  // -----------------------------
  // CPU usage during this interval
  // -----------------------------
  const cpu = process.cpuUsage(previousCpuUsage);

  const cpuTimeMs =
    (cpu.user + cpu.system) / 1000;

  const wallTimeMs =
    now - previousTime;

  const cpuPercent =
    (cpuTimeMs / wallTimeMs) * 100;

  previousCpuUsage = process.cpuUsage();
  previousTime = now;

  // -----------------------------
  // Event loop utilization
  // -----------------------------
  const elu = performance.eventLoopUtilization(
    previousELU
  );

  previousELU = performance.eventLoopUtilization();

  // -----------------------------
  // Memory
  // -----------------------------
  const mem = process.memoryUsage();

  // -----------------------------
  // Log
  // -----------------------------
  console.log(
    `[NODE HEALTH] ` +
    `CPU=${cpuPercent.toFixed(1)}% ` +
    `ELU=${(elu.utilization * 100).toFixed(1)}% ` +
    `EVENT_LOOP_P95=${(eventLoop.percentile(95) / 1e6).toFixed(1)}ms ` +
    `EVENT_LOOP_P99=${(eventLoop.percentile(99) / 1e6).toFixed(1)}ms ` +
    `EVENT_LOOP_MAX=${(eventLoop.max / 1e6).toFixed(1)}ms ` +
    `HEAP=${(mem.heapUsed / 1024 / 1024).toFixed(0)}MB ` +
    `RSS=${(mem.rss / 1024 / 1024).toFixed(0)}MB`
  );

  eventLoop.reset();
}, 10000);

Promise = require("bluebird");

mongoose.Promise = Promise;

const mongoConfig = {
  maxPoolSize: 50,
};
// mongoose
//   .connect(config?.mongo?.host, mongoConfig)
//   .then(async () => {
//     console.log(`Database connection success`);
//     // Detect topology ONCE at startup to determine if transactions are supported
//     const { detectTopology } = require("./server/helpers/db-topology");
//     await detectTopology();
//   })
mongoose
  .connect(config?.mongo?.host, mongoConfig)
  .then(async () => {
    console.log("Database connection success");
    console.log("Connected Mongo DB:", mongoose.connection.name);
    console.log("Mongo URI:", config?.mongo?.host);

    // Detect topology ONCE at startup to determine if transactions are supported
    const { detectTopology } = require("./server/helpers/db-topology");
    await detectTopology();
  })
  .catch((e) => {
    console.log("Connection error", e);
  });

// print mongoose logs in dev env
if (config.mongooseDebug) {
  mongoose.set("debug", (collectionName, method, query, doc) => {
    debug(`${collectionName}.${method}`, util.inspect(query, false, 20), doc);
  });
}

// module.parent check is required to support mocha watch
// src: https://github.com/mochajs/mocha/issues/1912
if (!module.parent) {
  (async () => {
    try {
      await getRedis();
      httpServer.listen(config.port, "0.0.0.0", () => {
        console.info(`server started on port ${config.port} (${config.env})`);
      });
    } catch (err) {
      console.error("Failed to connect to Redis:", err);
      process.exit(1);
    }
  })();
}

module.exports = app;
