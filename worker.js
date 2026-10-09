const mongoose = require("mongoose");
const cron = require("node-cron");
const config = require("./config/config");
const { getRedis } = require("./server/helpers/redis");
const {
  checkCasinoBettingResult,
  //autoDeletePendingCasinoBets,
  
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

// Core logic: Background Workers
console.log("🚀 [Worker] Starting background worker process...");

let isRunning = false;

// 1. Casino Result Checker (Every 20 seconds)
cron.schedule("*/15 * * * * *", async () => {
  if (isRunning) {
    console.log("[Worker] Previous casino-betting job still running, skipping...");
    return;
  }

  try {
    isRunning = true;
    await checkCasinoBettingResult();
  } catch (err) {
    console.error("[Worker] Error in checkCasinoBettingResult:", err);
  } finally {
    isRunning = false;
  }

});

// let isPendingCasinoDeleteRunning = false;

// cron.schedule("* * * * *", async () => {
//   if (isPendingCasinoDeleteRunning) {
//     console.log(
//       "[AUTODELETE+++Worker] Previous pending casino auto-delete job still running, skipping..."
//     );
//     return;
//   }

//   try {
//     isPendingCasinoDeleteRunning = true;

//     await autoDeletePendingCasinoBets();

//     console.log(
//       "[AUTODELETE+++Worker] ✅ Pending casino auto-delete job completed"
//     );
//   } catch (err) {
//     console.error(
//       "[Worker] Error in autoDeletePendingCasinoBets:",
//       err
//     );
//   } finally {
//     isPendingCasinoDeleteRunning = false;
//   }
// });

// 2. Third-Party Result API (Fancy result poller - every 2 minutes)
const {
  checkFancyResults,
  checkMatchResults,
  EnableCricket,
} = require("./server/helpers/thirdPartyResultCron");

cron.schedule("*/2 * * * *", async () => {
  try {
    await checkFancyResults();
  } catch (err) {
    console.error("[Worker][3P-Cron] Fancy poller error:", err.message);
  }
});

// 3. Third-Party Result API (Match result poller - every minute)
cron.schedule("*/2 * * * *", async () => {
  try {
    await checkMatchResults();
  } catch (err) {
    console.error("[Worker][3P-Cron] Match poller error:", err.message);
  }
});

// 3.1 Third-Party Result API (cricket autoEnable - every minute)
let isEnableCricketRunning = false;

// cron.schedule("* * * * *", async () => {
//     console.log("===== EnableCricket Cron Started =====");
//   if (isEnableCricketRunning) {
//     console.log(
//       "[Worker][EnableCricket] Previous job still running, skipping..."
//     );
//     return;
//   }

//   try {
//     isEnableCricketRunning = true;

//     await EnableCricket();

//     //  console.log(
//     //   "[Worker][EnableCricket] success:"
//     // );

//   } catch (err) {
//     console.error(
//       "[Worker][EnableCricket] Error:",
//       err.message
//     );
//   } finally {
//     isEnableCricketRunning = false;
//   }
// });

// 4. Daily Cleanup (Demo Users) - Midnight
cron.schedule("0 0 * * *", async () => {
  const cutoff = new Date(Date.now() - 1 * 60 * 60 * 1000);
  const demoUsers = await getAllUsers({
    role: "demo",
    createdAt: { $lt: cutoff },
  });

  for (const demoUser of demoUsers) {
    await deleteManyTransaction(demoUser._id);
    await deleteManyUserPerformances(demoUser._id);
    await deleteManySportsData(demoUser._id);
    await deleteManyBet(demoUser._id);
    await deleteUser(demoUser._id);
  }

  console.log(`[Worker] 🧹 Cleaned up ${demoUsers.length} demo users`);
});

// 5. Daily Cleanup (Old Games) - Midnight
cron.schedule("0 0 * * *", async () => {
  try {
    const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const result = await Game.updateMany(
      {
        isActive: true,
        createdAt: { $lt: cutoffDate },
        gtype: "match",
      },
      { $set: { isActive: false } },
    );

    const deactivatedCount =
      (typeof result?.modifiedCount === "number" && result.modifiedCount) ||
      (typeof result?.nModified === "number" && result.nModified) ||
      (typeof result?.n === "number" && result.n) ||
      0;

    console.log(
      `[Worker] 🧹 Deactivated ${deactivatedCount} old games at ${new Date().toISOString()}`,
    );
  } catch (err) {
    console.error("[Worker] Error while deactivating old games:", err);
  }
});

// 6. Domain Maintenance (Every 15 minutes)
cron.schedule("*/15 * * * *", async () => {
  try {
    const domains = await Domain.find({
      maintenance_mode: true,
      maintenance_deadline: { $ne: null },
    });
    for (const domain of domains) {
      if (new Date(domain.maintenance_deadline) <= new Date()) {
        await Domain.findByIdAndUpdate(domain._id, {
          maintenance_mode: false,
          maintenance_message: "",
          maintenance_deadline: null,
        });
        console.log(
          `[Worker] ✅ Maintenance mode disabled for domain: ${
            domain.name || domain.domain
          }`,
        );
      }
    }
  } catch (err) {
    console.error("[Worker] Cron job error:", err.message);
  }
});

// 7. Exposure Self-Healing (Every 3 minutes)
cron.schedule("*/3 * * * *", async () => {
  try {
    const {
      fixHierarchyExposure,
    } = require("./server/helpers/exposure.helper");
    const result = await fixHierarchyExposure();
    if (result && result.fixedUsers && result.fixedUsers.length > 0) {
      console.log(
        `[Worker] 🔄 [Self-Healing] Exposure auto-fixed for ${result.fixedUsers.length} users.`,
      );
    } else {
      console.log(`[Worker] ✅ [Self-Healing] Exposure check complete. All users are in sync.`);
    }
  } catch (err) {
    console.error("[Worker] Self-Healing Cron Error:", err.message);
  }
});

// Database & Redis Init
const mongoConfig = {
  maxPoolSize: 50,
};

mongoose
  .connect(config?.mongo?.host, mongoConfig)
  .then(async () => {
    console.log(`[Worker] Database connection success`);
    try {
      await getRedis();
      console.log("[Worker] Redis connection success");
    } catch (err) {
      console.error("[Worker] Failed to connect to Redis:", err);
      process.exit(1);
    }
  })
  .catch((e) => {
    console.error("[Worker] Connection error", e);
  });
