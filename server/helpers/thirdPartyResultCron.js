/**
 * thirdPartyResultCron.js
 *
 * Cron jobs that:
 * 1. Self-heal: scan pending sport bets (cricket/football/tennis) and register
 *    any that were missed (failed at placement or placed before integration).
 * 2. Poll third-party result API for declared results and auto-settle bets.
 *
 * Sport etid filter: 1=Football, 2=Tennis, 4=Cricket
 * Casino bets are excluded (they have different etid/gType).
 *
 * SAFETY — No double declaration:
 *   All bet updates are atomic: findOneAndUpdate({ status: "pending" }).
 *   Manual admin + cron cannot both settle the same bet.
 */

const ThirdPartyFancyRegistry = require("../apis/third-party-result/thirdPartyFancyRegistry.model");
const ThirdPartyMatchRegistry = require("../apis/third-party-result/thirdPartyMatchRegistry.model");
const {
  registerFancyIfNeeded,
  registerMatchIfNeeded,
  getFancyResults,
  getMatchResult,
  buildFancyKey,
} = require("./thirdPartyResult.service");
const {
  declareFancyResultInternal,
  cancelFancyResultInternal,
  declareMatchResultInternal,
  parseThirdPartyFancyResult,
  parseThirdPartyMatchWinner,
} = require("./betSettlement.internal");
const { Bet } = require("../apis/bet/bet.helper");
const { acquireLock, releaseLock } = require("../helpers/lock.helper");
const mongoose = require("mongoose");
const {
  updateSportsData,
  getSportsData,
  getAllSportsData,
  getSportsDataById,
} = require("../apis/sports-data/sports-data.helper");
const { setCache, delCacheByPattern, delCache } = require("../helpers/cache");
const {
    apiRequest,
  distributeCommissionHierarchy,
  distributeBettingCommissionHierarchy,
} = require("../helpers/utils");


const {
  Game,
  getAllGame,
  updateGame,
  getGame,
  getGameByCid,
  getGameByGidAndType,
  getGameByGmid,
  getGameById,
} = require("../apis/games/games.helper");

const {
 
  getDomainByDomain,
} = require("../apis/domain/domain.helper");



// Only cricket (4), football (1), tennis (2) — exclude casino
const SPORT_ETIDS = [
  "1",
  "2",
  "4",
  "10",
  "65",
  1,
  2,
  4,
  10,
  65
];

// Threshold for giving up on failed registrations (7 days)
const FAILED_REGISTRATION_CUTOFF_MS = 7 * 24 * 60 * 60 * 1000;

// gType values that are sport-related (not casino)
const SPORT_FANCY_GTYPES = ["fancy", "meter", "fancy1", "oddeven", "khado", "cricketcasino"];
const SPORT_MATCH_GTYPES = ["match", "match1"];

let isFancyCronRunning = false;
let isMatchCronRunning = false;

// Feature flag — set ENABLE_TP_RESULT_API=true in .env to activate.
// Leave unset or set to anything else to disable (safe default for production).
const TP_RESULT_API_ENABLED = process.env.ENABLE_TP_RESULT_API === "true";


/**
 * Scans pending sport bets for a given gType category and registers any
 * that are missing from the registry. This is the self-healing step.
 */
// async function ensureFancyBetsRegistered() {
//   try {
//     // Find all pending cricket + football fancy bets (fancy/meter/match-non-MATCH_ODDS)
//     // Tennis (etid=2) does NOT use fancy registration — skip it.
//     // Football (etid=1) and Cricket (etid=4) register fancies.
//     const pendingBets = await Bet.find({
//       status: "pending",
//       isActive: true,
//       etid: { $in: [4, "4"] }, // cricket only (football/tennis skip fancy)
//       $or: [
//         { gType: { $in: SPORT_FANCY_GTYPES } },
//         // match gType but NOT MATCH_ODDS (i.e. OVER_UNDER, Next Goal, etc.)
//         { gType: "match", marketName: { $not: /^MATCH_ODDS$/i } },
//       ],
//     }).lean();

//     if (!pendingBets.length) return;

//     // Register missing fancies OR re-enable polling for fancies with new pending bets
//     const existingFancies = await ThirdPartyFancyRegistry.find(
//       { registrationFailed: { $ne: true } },
//       { fancyKey: 1, resultDeclared: 1 }
//     ).lean();
    
//     const existingKeys = new Set(existingFancies.map((r) => r.fancyKey));
//     const declaredKeys = new Set(existingFancies.filter(r => r.resultDeclared).map(r => r.fancyKey));

//     const toRegister = [];
//     const keysToReEnable = [];

//     for (const bet of pendingBets) {
//       const fancyKey = buildFancyKey(bet.marketId, bet.sectionId);
//       if (!existingKeys.has(fancyKey)) {
//         toRegister.push(bet);
//       } else if (declaredKeys.has(fancyKey)) {
//         keysToReEnable.push(fancyKey);
//       }
//     }

//     if (toRegister.length === 0 && keysToReEnable.length === 0) return;

//     if (toRegister.length > 0) {
//       console.log(
//         `[3P-Cron][Self-Heal] Found ${toRegister.length} unregistered cricket/football fancy bet(s) — registering...`
//       );
//       for (const bet of toRegister) {
//         await registerFancyIfNeeded(
//           bet.marketId,
//           bet.sectionId,
//           bet.gameId,
//           Number(bet.etid),
//           bet.sectionName
//         );
//       }
//     }

//     if (keysToReEnable.length > 0) {
//       const res = await ThirdPartyFancyRegistry.updateMany(
//         { fancyKey: { $in: keysToReEnable } },
//         { $set: { resultDeclared: false } }
//       );
//       if (res.modifiedCount > 0) {
//         console.log(
//           `[3P-Cron][Self-Heal] Re-enabled fancy polling for ${res.modifiedCount} market(s) with pending bets.`
//         );
//       }
//     }

//     console.log(
//       `[3P-Cron][Self-Heal] Found ${toRegister.length} unregistered cricket/football fancy bet(s) — registering...`
//     );

//     for (const bet of toRegister) {
//       await registerFancyIfNeeded(
//         bet.marketId,
//         bet.sectionId,
//         bet.gameId,
//         Number(bet.etid),
//         bet.sectionName
//       );
//     }
//   } catch (err) {
//     console.error("[3P-Cron][Self-Heal] Fancy registration scan error:", err.message);
//   }
// }

async function ensureFancyBetsRegistered() {
  try {
    const pendingBets = await Bet.find({
      status: "pending",
      isActive: true,
      etid: { $in: [4, "4"] },
      $or: [
        { gType: { $in: SPORT_FANCY_GTYPES } },
        {
          gType: "match",
          marketName: { $nin: ["MATCH_ODDS", "BOOKMAKER", "TOSS", "TIE"] },
        },
      ],
    }).lean();

    if (!pendingBets.length) return;

    const existingRegs = await ThirdPartyFancyRegistry.find(
      {},
      {
        gameId: 1,
        marketId: 1,
        resultDeclared: 1,
      }
    ).lean();

    const existingKeys = new Set(
      existingRegs.map(
        (r) => `${r.gameId}_${r.marketId}`
      )
    );

    const declaredKeys = new Set(
      existingRegs
        .filter((r) => r.resultDeclared)
        .map((r) => `${r.gameId}_${r.marketId}`)
    );

    const toRegister = [];
    const toReEnable = [];

    for (const bet of pendingBets) {
      const registryKey =
        `${bet.gameId}_${bet.thirdPartyMarketId}`;

      if (!existingKeys.has(registryKey)) {
        toRegister.push(bet);
      } else if (declaredKeys.has(registryKey)) {
        toReEnable.push(registryKey);
      }
    }

    if (!toRegister.length && !toReEnable.length) {
      return;
    }

    if (toRegister.length) {


      for (const bet of toRegister) {
        await registerFancyIfNeeded({
          event_id: Number(bet.gameId),
          event_name: bet.eventName,

          market_id: Number(bet.thirdPartyMarketId),

          market_name: bet.sectionName,
          market_type: bet.gType,

          sport_id: String(bet.etid),

          client_ref: bet._id.toString(),

          originalMarketId: bet.marketId,
          sectionId: bet.sectionId,
        });
      }
    }

    if (toReEnable.length) {
      const conditions = [];

      for (const key of toReEnable) {
        const [gameId, marketId] = key.split("_");

        conditions.push({
          gameId,
          marketId,
        });
      }

      const res = await ThirdPartyFancyRegistry.updateMany(
        {
          $or: conditions,
          resultDeclared: true,
        },
        {
          $set: {
            resultDeclared: false,
          },
        }
      );

      if (res.modifiedCount > 0) {

      }
    }
  } catch (err) {
    console.error(
      "[3P-Cron][Fancy] Registration scan error:",
      err.message
    );
  }
}

/**
 * Scans pending MATCH_ODDS bets and registers any gameIds missing from
 * the match registry.
 */
// async function ensureMatchBetsRegistered() {
//   try {
//     // Scan pending MATCH_ODDS bets for ALL sports + BOOKMAKER (match1) bets for ALL sports.
//     // Football (etid=1) and Tennis (etid=2): only MATCH_ODDS + BOOKMAKER are tracked.
//     // Cricket (etid=4): MATCH_ODDS + BOOKMAKER also go through match registry.
//     const pendingBets = await Bet.find({
//       status: "pending",
//       isActive: true,
//       etid: { $in: SPORT_ETIDS },
//       $or: [
//         { gType: { $in: ["match", "match1"] }, marketName: /^MATCH_ODDS$/i },
//         { gType: "match1" }, // Bookmaker — always registered for all sports
//       ],
//     })
//       .distinct("gameId")
//       .lean();

//     if (!pendingBets.length) return;

//     // Build set of already-registered gameIds
//     const existingGameIds = new Set(
//       (await ThirdPartyMatchRegistry.find({}, { gameId: 1 }).lean()).map(
//         (r) => r.gameId
//       )
//     );

//     // Register missing games OR re-enable polling for games with new pending bets
//     const toRegister = [];
//     const gamesToReEnable = [];

//     for (const gameId of pendingBets) {
//       if (!existingGameIds.has(gameId)) {
//         toRegister.push(gameId);
//       } else {
//         gamesToReEnable.push(gameId);
//       }
//     }

//     if (toRegister.length === 0 && gamesToReEnable.length === 0) return;

//     if (toRegister.length > 0) {
//       console.log(
//         `[3P-Cron][Self-Heal] Found ${toRegister.length} unregistered match game(s) — registering...`
//       );
//       for (const gameId of toRegister) {
//         const sample = await Bet.findOne({
//           gameId,
//           etid: { $in: SPORT_ETIDS },
//           $or: [
//             { gType: { $in: ["match", "match1"] }, marketName: /^MATCH_ODDS$/i },
//             { gType: "match1" },
//           ],
//         }).lean();
//         if (sample) {
//           await registerMatchIfNeeded(gameId, Number(sample.etid));
//         }
//       }
//     }

//     if (gamesToReEnable.length > 0) {
//       // Re-enable polling for games that have pending bets but were marked as resultDeclared: true
//       const res = await ThirdPartyMatchRegistry.updateMany(
//         { gameId: { $in: gamesToReEnable }, resultDeclared: true },
//         { $set: { resultDeclared: false } }
//       );
//       if (res.modifiedCount > 0) {
//         console.log(
//           `[3P-Cron][Self-Heal] Re-enabled match result polling for ${res.modifiedCount} game(s) with pending bets.`
//         );
//       }
//     }
//   } catch (err) {
//     console.error("[3P-Cron][Self-Heal] Match registration scan error:", err.message);
//   }
// }

async function ensureMatchBetsRegistered() {
  try {
    const pendingBets = await Bet.find({
      status: "pending",
      isActive: true,
      etid: { $in: SPORT_ETIDS },
      $or: [
        {
          gType: "match",
          marketName: /^MATCH_ODDS$/i,
        },
        {
          gType: "match1",
        },

        // Only tennis set-winner markets
          {
            gType: "match",
            etid: { $in: [2, "2"] },
            marketName:
              /^\d+(st|nd|rd|th)\s+Set\s+Winner\s+Home\/Away$/i,
          },

          // Only tennis game-winner markets
          {
            gType: "match",
            etid: { $in: [2, "2"] },
            marketName:
              /^Game\s+Winner\s+\d+\/\d+$/i,
          },
      ],
    }).lean();

    if (!pendingBets.length) {
      return;
    }

    const existingRegs = await ThirdPartyMatchRegistry.find(
      {},
      {
        gameId: 1,
        marketId: 1,
        resultDeclared: 1,
      }
    ).lean();

    const existingKeys = new Set(
      existingRegs.map(
        (r) => `${r.gameId}_${r.marketId}`
      )
    );

    const declaredKeys = new Set(
      existingRegs
        .filter((r) => r.resultDeclared)
        .map((r) => `${r.gameId}_${r.marketId}`)
    );

    const toRegister = [];
    const toReEnable = [];

    for (const bet of pendingBets) {
      const registryKey =
        `${bet.gameId}_${bet.thirdPartyMarketId}`;

      if (!existingKeys.has(registryKey)) {
        toRegister.push(bet);
      } else if (declaredKeys.has(registryKey)) {
        toReEnable.push(registryKey);
      }
    }

    if (!toRegister.length && !toReEnable.length) {
      return;
    }

    if (toRegister.length) {


      for (const bet of toRegister) {
        await registerMatchIfNeeded({
          event_id: Number(bet.gameId),
          event_name: bet.eventName,

          market_id: Number(bet.thirdPartyMarketId),

          market_name: bet.marketName,
          market_type: bet.marketName,

          sport_id: String(bet.etid),

          client_ref: bet._id.toString(),

          originalMarketId: bet.marketId,
        });
      }
    }

    if (toReEnable.length) {
      const conditions = [];

      for (const key of toReEnable) {
        const [gameId, marketId] = key.split("_");

        conditions.push({
          gameId,
          marketId,
        });
      }

      const res = await ThirdPartyMatchRegistry.updateMany(
        {
          $or: conditions,
          resultDeclared: true,
        },
        {
          $set: {
            resultDeclared: false,
          },
        }
      );

      if (res.modifiedCount > 0) {

      }
    }
  } catch (err) {
    console.error(
      "[3P-Cron][Match] Registration scan error:",
      err.message
    );
  }
}

/**
 * Cron job 1 — Fancy Result Poller (every 2 minutes)
 * Step 1: Self-heal — register any missing pending fancy bets.
 * Step 2: Poll for declared results and settle.
 */
// async function checkFancyResults() {
//   if (!TP_RESULT_API_ENABLED) return; // disabled via ENABLE_TP_RESULT_API env var
//   if (isFancyCronRunning) return;
//   isFancyCronRunning = true;

//   try {
//     // --- Step 1: Self-healing registration ---
//     await ensureFancyBetsRegistered();

//     /*
//      * Poll results for:
//      * 1. Successful registrations (registrationFailed != true)
//      * 2. Recent failed registrations (registrationFailed == true AND createdAt >= 7 days)
//      *    This retries failed/404 fancies for a week before giving up.
//      */
//     const failedCutoff = new Date(Date.now() - FAILED_REGISTRATION_CUTOFF_MS);
//     const registries = await ThirdPartyFancyRegistry.find({
//       resultDeclared: false,
//       $or: [
//         { registrationFailed: { $ne: true } },
//         { registrationFailed: true, createdAt: { $gte: failedCutoff } },
//       ],
//     }).lean();

//     if (!registries.length) return;

//     // Group by gameId — one API call per game
//     const gameIdMap = {};
//     for (const reg of registries) {
//       if (!gameIdMap[reg.gameId]) gameIdMap[reg.gameId] = [];
//       gameIdMap[reg.gameId].push(reg);
//     }

//     for (const [gameId, fancyRegs] of Object.entries(gameIdMap)) {
//       try {
//         const fancyResponse = await getFancyResults(reg);
//         if (!fancyResponse || fancyResponse.success === false) {
//           // 3P explicitly says no fancies found for this game (or general failure)
//           // Mark all pending registries for this game as failed to stop polling and notify admin
//           await ThirdPartyFancyRegistry.updateMany(
//             { gameId, resultDeclared: false },
//             { registrationFailed: true }
//           );
//           continue;
//         }
//         const fancyResults = fancyResponse.fancies || [];
//         if (!fancyResults.length) continue;

//         // Build lookup map: fancyKey → result
//         const resultMap = {};
//         for (const fr of fancyResults) {
//           resultMap[fr.fancyId] = fr;
//         }

//         for (const reg of fancyRegs) {
//           const fancyKey = buildFancyKey(reg.marketId, reg.sectionId);

//           // Check if pending bets still exist BEFORE calling API (Manual Settle Sync)
//           let pendingCount = await Bet.countDocuments({
//             gameId,
//             marketId: reg.marketId,
//             sectionId: reg.sectionId,
//             status: "pending",
//             isActive: true,
//           });

//           if (pendingCount === 0) {
//             console.log(`[3P-Cron][Manual-Sync] No pending bets for fancyKey=${fancyKey} — marking as declared (Manually Settled)`);
//             await ThirdPartyFancyRegistry.findOneAndUpdate(
//               { fancyKey },
//               { resultDeclared: true, comment: (reg.comment || "") + " (Manually Settled)", declaredAt: new Date() }
//             );
//             continue;
//           }

//           const resultObj = resultMap[fancyKey];

//           if (!resultObj) {
//             // Fancy is registered in our system but missing from 3P list.
//             // If the match itself is already declared/cancelled, it's a permanent tracking failure.
//             const matchRecord = await getMatchResult(gameId);
//             if (matchRecord && (matchRecord.status === "DECLARED" || matchRecord.status === "CANCELLED")) {
//               console.warn(`[3P-Cron] Fancy key=${fancyKey} missing from 3P list but match is ${matchRecord.status} — marking as failed`);
//               await ThirdPartyFancyRegistry.findOneAndUpdate(
//                 { fancyKey },
//                 { registrationFailed: true }
//               );
//             }
//             continue;
//           }
//           if (resultObj.status !== "DECLARED" && resultObj.status !== "CANCELLED") continue;

//           const run = parseThirdPartyFancyResult(resultObj.result);
//           if (run === null) continue;

//           // Check if pending bets still exist
//           pendingCount = await Bet.countDocuments({
//             gameId,
//             marketId: reg.marketId,
//             sectionId: reg.sectionId,
//             status: "pending",
//             isActive: true,
//           });

//           if (pendingCount === 0) {
//             // Already settled by admin or previous tick — stop polling
//             // But still update with the latest result data from 3P for visibility in registry
//             await ThirdPartyFancyRegistry.findOneAndUpdate(
//               { fancyKey },
//               { resultDeclared: true, resultData: resultObj, declaredAt: new Date(), registrationFailed: false }
//             );
//             continue;
//           }

//           if (run === -1 || resultObj.status === "CANCELLED") {
//             console.log(
//               `[3P-Cron] Cancelling fancy: fancyKey=${fancyKey}, result=${resultObj.result}`
//             );
//             const { updatedCount } = await cancelFancyResultInternal(
//               gameId,
//               reg.marketId,
//               reg.sectionId
//             );
//             console.log(
//               `[3P-Cron] Fancy cancelled: fancyKey=${fancyKey}, updatedBets=${updatedCount}`
//             );
//           } else {
//             console.log(
//               `[3P-Cron] Declaring fancy: fancyKey=${fancyKey}, run=${run}, result=${resultObj.result}`
//             );
//             const { updatedCount } = await declareFancyResultInternal(
//               gameId,
//               reg.marketId,
//               reg.sectionId,
//               run
//             );
//             console.log(
//               `[3P-Cron] Fancy declared: fancyKey=${fancyKey}, updatedBets=${updatedCount}`
//             );
//           }

//           await ThirdPartyFancyRegistry.findOneAndUpdate(
//             { fancyKey },
//             { resultDeclared: true, resultData: resultObj, declaredAt: new Date(), registrationFailed: false }
//           );
//         }
//       } catch (gameErr) {
//         const status = gameErr?.response?.status;
//         if (status === 404) {
//           console.warn(`[3P-Cron] Fancy results for gameId=${gameId} not found on 3P side (404) — marking as failed`);
//           await ThirdPartyFancyRegistry.updateMany(
//             { gameId, resultDeclared: false },
//             { registrationFailed: true }
//           ).catch(() => {});
//         } else {
//           console.error(
//             `[3P-Cron] Error processing fancy gameId=${gameId}:`,
//             gameErr.message
//           );
//         }
//       }
//     }
//   } catch (err) {
//     console.error("[3P-Cron] Fancy cron error:", err.message);
//   } finally {
//     isFancyCronRunning = false;
//   }
// }

async function checkFancyResults() {
  console.log("check fancy bets result");
  if (!TP_RESULT_API_ENABLED) return;
  if (isFancyCronRunning) return;

  isFancyCronRunning = true;

  try {
    await ensureFancyBetsRegistered();

    const failedCutoff = new Date(
      Date.now() - FAILED_REGISTRATION_CUTOFF_MS
    );

    const registries = await ThirdPartyFancyRegistry.find({
      resultDeclared: false,
      $or: [
        { registrationFailed: { $ne: true } },
        {
          registrationFailed: true,
          createdAt: { $gte: failedCutoff },
        },
      ],
    }).lean();

    if (!registries.length) return;

    for (const reg of registries) {
      try {


        let pendingCount = await Bet.countDocuments({
          gameId: reg.gameId,
          marketId: reg.originalMarketId,
          status: "pending",
          isActive: true,
        });

        if (pendingCount === 0) {


          await ThirdPartyFancyRegistry.findOneAndUpdate(
            {
              gameId: reg.gameId,
              marketId: reg.marketId,
            },
            {
              resultDeclared: true,
              declaredAt: new Date(),
            }
          );

          continue;
        }

        const fancyResults = await getFancyResults(reg);

        if (
            !fancyResults ||
            !Array.isArray(fancyResults.markets)
        ) {
            continue;
        }

        const normalize = (value = "") =>
            value
                .replace(/_/g, " ")
                .trim()
                .toUpperCase();

        const resultObj = fancyResults.markets.find(
            (m) =>
                normalize(m.marketName) ===
                normalize(reg.marketName)
        );

        if (!resultObj) {

            continue;
        }

        if (resultObj.status?.toUpperCase() !== "SETTLE") {
            continue;
        }

        // console.log(
        //   "[FANCY RAW RESPONSE]",
        //   JSON.stringify(resultObj, null, 2)
        // );


        // if (
        //   !resultObj ||
        //   resultObj.is_declared === false
        // ) {
        //   console.log("[Fancy] Skip - result not declared");
        //   continue;
        // }

        // if (
        //   !resultObj.is_declared &&
        //   !resultObj.is_roleback
        // ) {
        //   console.log("[Fancy] Skip - result not declared2");
        //   continue;
        // }

        // console.log(
        //   "[FANCY WINNER PARSE]",
        //   {
        //     finalResult: resultObj.final_result
        //   }
        // );

        const run = resultObj.rollback
          ? -1
          : Number(resultObj.winnerId);

        // console.log(
        //   "[FANCY RUN PARSE]",
        //   {
        //     finalResult: resultObj.final_result,
        //     run,
        //   }
        // );

        if (
            !resultObj.rollback &&
            (run === null || Number.isNaN(run))
        ){
          console.log("[Fancy] Skip - parser returned null", {
            final_result: resultObj.winnerId,
          });
          continue;
        }

        

        pendingCount = await Bet.countDocuments({
          gameId: reg.gameId,
          thirdPartyMarketId: reg.marketId,
          status: "pending",
          isActive: true,
        });

        if (pendingCount === 0) {
          await ThirdPartyFancyRegistry.findOneAndUpdate(
            {
              gameId: reg.gameId,
              marketId: reg.marketId,
            },
            {
              resultDeclared: true,
              resultData: resultObj,
              declaredAt: new Date(),
              registrationFailed: false,
            }
          );

          continue;
        }

        if (
            resultObj.rollback ||
            run === -1
        ){
          console.log(
            `[3P-Cron][Fancy] Cancelling`,
            {
              gameId: reg.gameId,
              marketId: reg.marketId,
            }
          );

          await cancelFancyResultInternal(
            reg.gameId,
            Number(reg.originalMarketId),
            Number(reg.sectionId)
          );

        } else {


          await declareFancyResultInternal(
            reg.gameId,
            Number(reg.originalMarketId),
            Number(reg.sectionId),
            run
          );
        }

        await ThirdPartyFancyRegistry.findOneAndUpdate(
          {
            gameId: reg.gameId,
            marketId: reg.marketId,
          },
          {
            resultDeclared: true,
            resultData: resultObj,
            declaredAt: new Date(),
            registrationFailed: false,
          }
        );
      } catch (regErr) {
        console.error(
          `[3P-Cron][Fancy] Error`,
          {
            gameId: reg.gameId,
            marketId: reg.marketId,
            error: regErr?.message,
          }
        );
      }
    }
  } catch (err) {
    console.error(
      "[3P-Cron][Fancy] Cron error:",
      err.message
    );
  } finally {
    isFancyCronRunning = false;
  }
}

async function fancyResultRoleBackInternal(gameId, marketId, sectionId) {
  const updatedBets = [];

  const pipeline = [
    {
      $match: {
        gameId,
        marketId,
        sectionId,
        isActive: true,
        status: { $in: ["lost", "won", "cancelled"] },
      },
    },
    {
      $group: {
        _id: "$userId",
        bets: { $push: "$$ROOT" },
      },
    },
  ];

  const bets = await Bet.aggregate(pipeline);

  if (!bets || !bets.length) {


    return {
      updatedCount: 0,
      updatedBets: [],
    };
  }

  for (const user of bets) {
    const lockKey = `lock:user:${user._id}`;

    let lockAcquired = false;
    let retries = 0;

    while (!lockAcquired && retries < 10) {
      lockAcquired = await acquireLock(lockKey, 5000);

      if (!lockAcquired) {
        await new Promise((r) => setTimeout(r, 200));
        retries++;
      }
    }

    if (!lockAcquired) {
      console.error(
        `[3P-Callback][Fancy][Rollback] Failed to acquire lock for user ${user._id}`
      );

      continue;
    }

    let updateExp = 0;
    let updatePartnerExp = 0;
    let userUpdatedCount = 0;
    let totalBalanceRev = 0;

    const currentUserUpdatedBets = [];

    const session = await mongoose.startSession();

    const runSettlementInternal = async (sessionParam) => {
      updateExp = 0;
      updatePartnerExp = 0;
      userUpdatedCount = 0;
      totalBalanceRev = 0;
      currentUserUpdatedBets.length = 0;

      /*
       * Re-fetch inside lock.
       */
      const freshQuery = Bet.find({
        userId: user._id,
        gameId,
        marketId,
        sectionId,
        isActive: true,
        status: { $in: ["lost", "won", "cancelled"] },
      });

      const freshUserBets = sessionParam
        ? await freshQuery.session(sessionParam)
        : await freshQuery;

      if (freshUserBets.length === 0) {
        return;
      }

      /*
       * Get current sports exposure.
       */
      const findSpotsData = await getSportsData(
        {
          mid: marketId,
          userId: user._id,
        },
        {
          session: sessionParam,
        }
      );

      /*
       * Roll back each bet.
       */
      for (const bet of freshUserBets) {
        let balanceReversal = 0;

        /*
         * If the bet was already settled as won/lost,
         * reverse the previously applied profit/loss.
         */
        if (["won", "lost"].includes(bet.status)) {
          balanceReversal =
            -1 * (Number(bet.profit) || 0);
        }

        const updated = await Bet.findOneAndUpdate(
          {
            _id: bet._id,
            status: {
              $in: ["won", "lost", "cancelled"],
            },
          },
          {
            status: "pending",
            profit: 0,
            run: 0,
            $unset: {
              winner: "",
            },
          },
          {
            session: sessionParam,
            new: true,
          }
        );

        if (updated) {
          currentUserUpdatedBets.push(updated);

          userUpdatedCount++;

          totalBalanceRev += balanceReversal;
        }
      }

      /*
       * Rebuild exposure after bets are returned to pending.
       */
      if (userUpdatedCount > 0) {
        const spotsData = findSpotsData?.sdata || [];

        const idx = spotsData.findIndex(
          (exp) => exp?.sid === sectionId
        );

        /*
         * Get all pending bets for this section.
         */
        const pendingBetsQuery = Bet.find({
          userId: user._id,
          marketId: marketId,
          sectionId: sectionId,
          status: "pending",
          isActive: true,
        });

        const pendingBets = sessionParam
          ? await pendingBetsQuery.session(sessionParam)
          : await pendingBetsQuery;

        if (pendingBets.length > 0) {
          const sample = pendingBets[0];

          let newAmount = 0;
          let newCalcTable = [];

          /*
           * FANCY / METER / KHADO / FANCY1
           */
          if (
            [
              "fancy",
              "meter",
              "khado",
              "fancy1",
            ].includes(sample.gType)
          ) {
            let maxRate = 0;
            let maxBackRun = 0;
            let maxLayRun = 0;

            pendingBets.forEach((b) => {
              const r = Number(
                b.uRate || b.oRate || 0
              );

              if (r > maxRate) {
                maxRate = r;
              }

              if (b.amount > 0) {
                if (
                  b.betType === "back" &&
                  r > maxBackRun
                ) {
                  maxBackRun = r;
                }

                if (
                  b.betType === "lay" &&
                  r > maxLayRun
                ) {
                  maxLayRun = r;
                }
              }
            });

            const startRun = 0;
            const endRun = maxRate + 10;

            for (
              let run = startRun;
              run <= endRun;
              run++
            ) {
              let pl = 0;

              pendingBets.forEach((b) => {
                const amt = Number(
                  b.amount || 0
                );

                const rate = Number(
                  b.uRate || b.oRate || 0
                );

                const size = Number(
                  b.size || 100
                );

                /*
                 * FANCY / METER
                 */
                if (
                  ["fancy", "meter"].includes(
                    b.gType
                  )
                ) {
                  if (b.betType === "back") {
                    pl +=
                      run >= rate
                        ? run >= maxBackRun
                          ? (amt * size) / 100
                          : 0
                        : -amt;
                  } else {
                    pl +=
                      run < rate
                        ? amt
                        : run >= maxLayRun
                          ? -(amt * size) / 100
                          : 0;
                  }
                }

                /*
                 * FANCY1
                 */
                else if (b.gType === "fancy1") {
                  const profit = Number(
                    (
                      parseFloat(rate - 1) *
                      amt
                    ).toFixed(2)
                  );

                  const loss = amt;

                  if (b.betType === "lay") {
                    const isWin = run === 0;

                    pl += isWin
                      ? loss
                      : -profit;
                  } else {
                    const isWin = run === 1;

                    pl += isWin
                      ? profit
                      : -loss;
                  }
                }

                /*
                 * KHADO
                 */
                else if (b.gType === "khado") {
                  const inRange =
                    run >= rate &&
                    run <
                      rate +
                        Number(
                          b.oRate || 0
                        );

                  const profit = Number(
                    (
                      (amt * size) /
                      100
                    ).toFixed(2)
                  );

                  if (b.betType === "lay") {
                    pl += !inRange
                      ? amt
                      : -profit;
                  } else {
                    pl += inRange
                      ? profit
                      : -amt;
                  }
                }
              });

              newCalcTable.push({
                run,
                profitLoss: Number(
                  pl.toFixed(2)
                ),
              });
            }

            newAmount = Math.min(
              0,
              ...newCalcTable.map(
                (r) => r.profitLoss
              )
            );
          }

          /*
           * ODDEVEN
           */
          else if (
            sample.gType === "oddeven"
          ) {
            for (const outcome of [
              "lay",
              "back",
            ]) {
              let pl = 0;

              pendingBets.forEach((b) => {
                const amt = Number(
                  b.amount || 0
                );

                const rate = Number(
                  b.uRate || 0
                );

                const isLay =
                  b.betType === "lay";

                if (isLay) {
                  pl +=
                    outcome === "lay"
                      ? (rate - 1) * amt
                      : -amt;
                } else {
                  pl +=
                    outcome === "back"
                      ? (rate - 1) * amt
                      : -amt;
                }
              });

              newCalcTable.push({
                outcome,
                profitLoss: Number(
                  pl.toFixed(2)
                ),
              });
            }

            newAmount = Math.min(
              0,
              ...newCalcTable.map(
                (r) => r.profitLoss
              )
            );
          }

          /*
           * Update sports exposure.
           */
          if (newCalcTable.length > 0) {
            const newEntry = {
              sid: sectionId,
              amount: newAmount,
              calcTable: newCalcTable,
            };

            if (idx > -1) {
              spotsData[idx] = newEntry;
            } else {
              spotsData.push(newEntry);
            }

            await updateSportsData(
              marketId,
              user._id,
              {
                mid: marketId,
                sdata: spotsData,
                userId: user._id,
              },
              {
                autoSyncExposure: true,
                session: sessionParam,
              }
            );

            updateExp += newAmount;

            updatePartnerExp += Math.max(
              0,
              ...newCalcTable
                .map(
                  (r) => r.profitLoss
                )
                .filter((v) => v > 0)
            );
          }
        }

        /*
         * Reverse user financial settlement.
         */
        if (
          totalBalanceRev !== 0 ||
          updateExp !== 0
        ) {
          const {
            atomicUpdateUserFinance,
          } = require(
            "../helpers/finance.helper"
          );

          const getUser =
            await atomicUpdateUserFinance(
              user._id,
              {
                balance:
                  totalBalanceRev,
                exp: updateExp,
              },
              {
                session:
                  sessionParam,
                allowNegativeBuffer:
                  true,
              }
            );

          if (!getUser) {
            throw new Error(
              "User not found during fancy result rollback"
            );
          }

          const cacheKey =
            `user:${getUser._id}`;

          await setCache(
            cacheKey,
            getUser,
            60
          );

          await distributeCommissionHierarchy(
            getUser,
            {
              exp:
                updatePartnerExp * -1,
              profit:
                totalBalanceRev,
            },
            {
              session:
                sessionParam,
            }
          );
        }
      }
    };

    try {
      /*
       * Try transaction first.
       */
      await session.withTransaction(
        async () => {
          await runSettlementInternal(
            session
          );
        }
      );
    } catch (err) {
      /*
       * Standalone MongoDB fallback.
       */
      if (
        err.message.includes(
          "sessions are not supported"
        ) ||
        err.code === 20
      ) {
        console.warn(
          "[REPLICASET] Standalone DB detected in fallback for fancy rollback."
        );

        await runSettlementInternal(null);
      } else {
        console.error(
          `Error processing user ${user._id} for fancy rollback:`,
          err
        );
      }
    } finally {
      await session.endSession();

      await releaseLock(
        lockKey,
        lockAcquired
      );

      updatedBets.push(
        ...currentUserUpdatedBets
      );

      const {
        verifyAndFixUserExposure,
      } = require(
        "../helpers/exposure.helper"
      );

      await verifyAndFixUserExposure(
        user._id
      ).catch((e) =>
        console.error(
          "[Self-Heal] Error:",
          e
        )
      );
    }
  }

  console.log(
    "[3P-Callback][Fancy][Rollback] Completed",
    {
      gameId,
      marketId,
      sectionId,
      updatedCount: updatedBets.length,
    }
  );

  return {
    updatedCount: updatedBets.length,
    updatedBets,
  };
}

async function fancyResultCallback(req, res) {
  try {


    const {
      message,
      result,
      runnerName,
      matchId,
      selectionId,
      gtype,
      isRoleback,
    } = req.body;



    if (message !== "ok") {
      return res.status(400).json({
        message: "Invalid callback",
      });
    }

    if (!matchId || !runnerName) {
      return res.status(400).json({
        message: "matchId and runnerName are required",
      });
    }

    const gameId = String(matchId).trim();
    const sectionName = String(runnerName).trim();
    const rollback = Number(isRoleback) === 1;



    /*
     * --------------------------------------------------
     * ROLLBACK FLOW
     * --------------------------------------------------
     *
     * For rollback, DO NOT require:
     *   status: "pending"
     *   isActive: true
     *
     * because the original result may already have
     * settled the bet.
     */
    if (rollback) {


      /*
      * Find any bet for this game + section.
      *
      * Do NOT require pending status because rollback can
      * happen after the original result has already settled.
      */
      const bet = await Bet.findOne({
        gameId,
        sectionName,
      })
        .sort({ createdAt: -1 })
        .lean();

      if (!bet) {


        return res.status(200).json({
          message: "ok",
        });
      }

      console.log(
        "[3P-Callback][Fancy] Rollback bet found",
        {
          betId: bet._id,
          gameId: bet.gameId,
          sectionName: bet.sectionName,
          status: bet.status,
          isActive: bet.isActive,
          marketId: bet.marketId,
          thirdPartyMarketId: bet.thirdPartyMarketId,
          sectionId: bet.sectionId,
        }
      );

      /*
      * Find registry even if resultDeclared is already true.
      */
      const registry = await ThirdPartyFancyRegistry.findOne({
        gameId,
        marketId: bet.thirdPartyMarketId,
      })
        .sort({ createdAt: -1 })
        .lean();

      if (!registry) {
        console.log(
          "[3P-Callback][Fancy] Rollback registry not found",
          {
            gameId,
            thirdPartyMarketId: bet.thirdPartyMarketId,
            sectionName,
          }
        );

        return res.status(200).json({
          message: "ok",
        });
      }

      console.log(
        "[3P-Callback][Fancy] Rollback registry found",
        {
          gameId: registry.gameId,
          marketId: registry.marketId,
          originalMarketId: registry.originalMarketId,
          sectionId: registry.sectionId,
          resultDeclared: registry.resultDeclared,
        }
      );

      /*
      * Run the COMPLETE fancy rollback logic.
      *
      * This changes:
      *
      * won/lost/cancelled -> pending
      * profit -> 0
      * run -> 0
      * winner -> removed
      *
      * and reverses balance/exposure/commission.
      */
      console.log(
        "[3P-Callback][Fancy] Calling fancyResultRoleBackInternal",
        {
          gameId: registry.gameId,
          originalMarketId: registry.originalMarketId,
          sectionId: registry.sectionId,
        }
      );

      const rollbackResult = await fancyResultRoleBackInternal(
        registry.gameId,
        Number(registry.originalMarketId),
        Number(registry.sectionId)
      );

      console.log(
        "[3P-Callback][Fancy] Rollback completed",
        {
          gameId: registry.gameId,
          marketId: registry.marketId,
          sectionId: registry.sectionId,
          updatedCount: rollbackResult?.updatedCount,
        }
      );

      /*
      * Result has been rolled back, so registry should no longer
      * consider the result as declared.
      */
      await ThirdPartyFancyRegistry.findOneAndUpdate(
        {
          gameId: registry.gameId,
          marketId: registry.marketId,
        },
        {
          resultDeclared: false,
          resultData: req.body,
          declaredAt: new Date(),
          registrationFailed: false,
        }
      );

      console.log(
        "[3P-Callback][Fancy] Registry reset after rollback",
        {
          gameId: registry.gameId,
          marketId: registry.marketId,
          resultDeclared: false,
        }
      );

      return res.status(200).json({
        message: "ok",
      });
    }

    /*
     * --------------------------------------------------
     * NORMAL RESULT FLOW
     * --------------------------------------------------
     */

    console.log(
      "[3P-Callback][Fancy] Normal result callback"
    );

    /*
     * Find pending bets for this game + fancy section.
     */
    const bets = await Bet.find({
      gameId,
      sectionName,
      status: "pending",
      isActive: true,
    }).lean();

    if (!bets.length) {
      console.log(
        "[3P-Callback][Fancy] No pending bets found",
        {
          gameId,
          sectionName,
        }
      );

      return res.status(200).json({
        message: "ok",
      });
    }

    const thirdPartyMarketId = bets[0].thirdPartyMarketId;

    console.log(
      "[3P-Callback][Fancy] Bets found",
      {
        gameId,
        sectionName,
        thirdPartyMarketId,
        count: bets.length,
        selectionId,
        gtype,
        result,
      }
    );

    /*
     * Find the corresponding third-party registry.
     */
    const registry = await ThirdPartyFancyRegistry.findOne({
      gameId,
      marketId: thirdPartyMarketId,
      resultDeclared: false,
    }).lean();

    if (!registry) {
      console.log(
        "[3P-Callback][Fancy] Registry not found",
        {
          gameId,
          thirdPartyMarketId,
          sectionName,
        }
      );

      return res.status(200).json({
        message: "ok",
      });
    }

    /*
     * Check pending bets using the third-party market ID.
     */
    const pendingCount = await Bet.countDocuments({
      gameId: registry.gameId,
      thirdPartyMarketId: registry.marketId,
      status: "pending",
      isActive: true,
    });

    if (pendingCount === 0) {
      console.log(
        "[3P-Callback][Fancy] No pending bets. Marking registry complete.",
        {
          gameId: registry.gameId,
          marketId: registry.marketId,
        }
      );

      await ThirdPartyFancyRegistry.findOneAndUpdate(
        {
          gameId: registry.gameId,
          marketId: registry.marketId,
        },
        {
          resultDeclared: true,
          resultData: req.body,
          declaredAt: new Date(),
          registrationFailed: false,
        }
      );

      return res.status(200).json({
        message: "ok",
      });
    }

    /*
     * Parse normal result.
     */
    const run = Number(result);

    if (Number.isNaN(run)) {
      console.log(
        "[3P-Callback][Fancy] Invalid result",
        {
          gameId,
          sectionName,
          result,
        }
      );

      return res.status(400).json({
        message: "Invalid result",
      });
    }

    console.log(
      "[3P-Callback][Fancy] Declaring",
      {
        gameId: registry.gameId,
        marketId: registry.marketId,
        originalMarketId: registry.originalMarketId,
        sectionId: registry.sectionId,
        run,
      }
    );

    await declareFancyResultInternal(
      registry.gameId,
      Number(registry.originalMarketId),
      Number(registry.sectionId),
      run
    );

    console.log(
      "[3P-Callback][Fancy] Declaration completed",
      {
        gameId: registry.gameId,
        marketId: registry.marketId,
        sectionId: registry.sectionId,
        run,
      }
    );

    /*
     * Mark registry as completed after successful settlement.
     */
    await ThirdPartyFancyRegistry.findOneAndUpdate(
      {
        gameId: registry.gameId,
        marketId: registry.marketId,
      },
      {
        resultDeclared: true,
        resultData: req.body,
        declaredAt: new Date(),
        registrationFailed: false,
      }
    );

    console.log(
      "[3P-Callback][Fancy] Registry updated successfully",
      {
        gameId: registry.gameId,
        marketId: registry.marketId,
        resultDeclared: true,
      }
    );

    return res.status(200).json({
      message: "ok",
    });

  } catch (err) {
    console.error(
      "[3P-Callback][Fancy] Error",
      {
        error: err?.message,
        stack: err?.stack,
      }
    );

    return res.status(500).json({
      message: "error",
    });
  }
}
/**
 * Cron job 2 — Match Result Poller (every 1 minute)
 * Step 1: Self-heal — register any missing pending MATCH_ODDS bets.
 * Step 2: Poll for declared results and settle.
 */
// async function checkMatchResults() {
//   if (!TP_RESULT_API_ENABLED) return; // disabled via ENABLE_TP_RESULT_API env var
//   if (isMatchCronRunning) return;
//   isMatchCronRunning = true;

//   try {
//     // --- Step 1: Self-healing registration ---
//     await ensureMatchBetsRegistered();

//     /*
//      * Poll results for:
//      * 1. Successful registrations (registrationFailed != true)
//      * 2. Recent failed registrations (registrationFailed == true AND createdAt >= 7 days)
//      *    This retries failed/404 match winners for a week before giving up.
//      */
//     const failedCutoff = new Date(Date.now() - FAILED_REGISTRATION_CUTOFF_MS);
//     const registries = await ThirdPartyMatchRegistry.find({
//       resultDeclared: false,
//       $or: [
//         { registrationFailed: { $ne: true } },
//         { registrationFailed: true, createdAt: { $gte: failedCutoff } },
//       ],
//     }).lean();

//     if (!registries.length) return;

//     for (const reg of registries) {
//       try {
//         // Check if any pending bets exist for this match (Manual Settle Sync)
//         const pendingCount = await Bet.countDocuments({
//           gameId: reg.gameId,
//           status: "pending",
//           isActive: true,
//           etid: { $in: SPORT_ETIDS },
//           $or: [
//             { gType: { $in: ["match", "match1"] }, marketName: /^MATCH_ODDS$/i },
//             { gType: "match1" },
//           ],
//         });

//         if (pendingCount === 0) {
//           console.log(`[3P-Cron][Manual-Sync] No pending bets for match gameId=${reg.gameId} — marking as declared (Manually Settled)`);
//           await ThirdPartyMatchRegistry.findOneAndUpdate(
//             { gameId: reg.gameId },
//             { resultDeclared: true, comment: (reg.name || "") + " (Manually Settled)", declaredAt: new Date() }
//           );
//           continue;
//         }

//         const matchResult = await getMatchResult(reg);

//         if (!matchResult || matchResult.success === false) {
//           // Either no response or explicitly success: false
//           // Stop polling this match by marking as declared (similar to 404)
//           await ThirdPartyMatchRegistry.findOneAndUpdate(
//             { gameId: reg.gameId },
//             { resultDeclared: true, registrationFailed: true }
//           );
//           continue;
//         }
//         if (matchResult.status !== "DECLARED" && matchResult.status !== "CANCELLED") continue;

//         const winner = matchResult.status === "CANCELLED" ? "cancel" : parseThirdPartyMatchWinner(matchResult.result);
//         if (!winner) continue;

//         // Find all distinct pending match marketIds for this game
//         const pendingMarketIds = await Bet.distinct("marketId", {
//           gameId: reg.gameId,
//           status: "pending",
//           gType: { $in: ["match", "match1"] },
//           isActive: true,
//           etid: { $in: SPORT_ETIDS },
//         });

//         if (!pendingMarketIds || pendingMarketIds.length === 0) {
//           // No pending bets — already settled
//           // But still update with the latest result data from 3P for visibility in registry
//           await ThirdPartyMatchRegistry.findOneAndUpdate(
//             { gameId: reg.gameId },
//             { resultDeclared: true, resultData: matchResult, declaredAt: new Date(), registrationFailed: false }
//           );
//           continue;
//         }

//         let totalUpdated = 0;
//         for (const marketId of pendingMarketIds) {
//           console.log(
//             `[3P-Cron] Declaring match: gameId=${reg.gameId}, marketId=${marketId}, winner=${winner}`
//           );
  
//           const { updatedCount } = await declareMatchResultInternal(
//             reg.gameId,
//             marketId,
//             winner
//           );
          
//           totalUpdated += updatedCount;
//         }

//         if (totalUpdated > 0) {
//           console.log(
//             `[3P-Cron] Match declared completely: gameId=${reg.gameId}, winner=${winner}, totalUpdatedBets=${totalUpdated}`
//           );
//         }

//         // Only mark as resultDeclared:true if:
//         // 1. The match is DECLARED on the 3rd party side.
//         // 2. We have successfully processed all current pending markets for this game.
//         // (Wait: if we only settle what's pending, but new bets are placed later, we miss them?)
//         // (But usually matching results are global. If we have no more pending bets, we can stop polling).
//         await ThirdPartyMatchRegistry.findOneAndUpdate(
//           { gameId: reg.gameId },
//           { resultDeclared: true, resultData: matchResult, declaredAt: new Date(), registrationFailed: false }
//         );
//       } catch (regErr) {
//         const status = regErr?.response?.status;
//         if (status === 404) {
//           // 3P doesn't know this game — stop polling it and mark as failed
//           console.warn(`[3P-Cron] Match gameId=${reg.gameId} not found on 3P side (404) — marking as done/failed`);
//           await ThirdPartyMatchRegistry.findOneAndUpdate(
//             { gameId: reg.gameId },
//             { resultDeclared: true, registrationFailed: true }
//           ).catch(() => {});
//         } else {
//           console.error(
//             `[3P-Cron] Error processing match gameId=${reg.gameId}:`,
//             regErr.message
//           );
//         }
//       }
//     }
//   } catch (err) {
//     console.error("[3P-Cron] Match cron error:", err.message);
//   } finally {
//     isMatchCronRunning = false;
//   }
// }


////old working code
async function checkMatchResults() {
  console.log("check match bets result");
  if (!TP_RESULT_API_ENABLED) return;
  if (isMatchCronRunning) return;

  isMatchCronRunning = true;

  try {
    await ensureMatchBetsRegistered();

    const failedCutoff = new Date(
      Date.now() - FAILED_REGISTRATION_CUTOFF_MS
    );

    const registries = await ThirdPartyMatchRegistry.find({
      resultDeclared: false,
      $or: [
        { registrationFailed: { $ne: true } },
        {
          registrationFailed: true,
          createdAt: { $gte: failedCutoff },
        },
      ],
    }).lean();

    if (!registries.length) return;

    for (const reg of registries) {
      try {
        // console.log(
        //   `[3P-Cron][Match] Polling result`,
        //   {
        //     gameId: reg.gameId,
        //     marketId: reg.marketId,
        //     marketType: reg.marketType,
        //   }
        // );

        const pendingCount = await Bet.countDocuments({
          gameId: reg.gameId,
          status: "pending",
          isActive: true,
          etid: { $in: SPORT_ETIDS }
        });

        if (pendingCount === 0) {
          await ThirdPartyMatchRegistry.findOneAndUpdate(
            {
              gameId: reg.gameId,
              marketId: reg.marketId,
            },
            {
              resultDeclared: true,
              declaredAt: new Date(),
            }
          );

          continue;
        }

        // const matchResult = await getMatchResult(reg);

        // console.log(
        //   `[3P-Cron][Match] Result response`,
        //   matchResult
        // );

        // if (
        //   !matchResult ||
        //   matchResult.is_declared === false
        // ) {
        //   continue;
        // }

        // if (
        //   !matchResult.is_declared &&
        //   !matchResult.is_roleback
        // ) {
        //   continue;
        // }

        // // console.log(
        // //   "[MATCH WINNER PARSE]",
        // //   {
        // //     finalResult: matchResult.final_result
        // //   }
        // // );

        // const winner =
        //   matchResult.is_roleback ||
        //   matchResult.final_result?.trim().toLowerCase() === "no result"
        //     ? "cancel"
        //     : matchResult.final_result;

        // if (!winner) {
        //   // console.log(
        //   //   "[3P-Cron][Match] Could not parse winner",
        //   //   matchResult.final_result
        //   // );
        //   continue;
        // }

        const matchResults = await getMatchResult(reg);


        if (
          !matchResults ||
          !Array.isArray(matchResults.markets)
        ) {
          continue;
        }

        const normalize = (value = "") =>
          value
            .replace(/_/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .toUpperCase();

        const registryMarket = normalize(reg.marketName);

        const marketResult = matchResults.markets.find((m) => {
          const apiMname = normalize(m.mname || "");
          const apiMarketName = normalize(m.marketName || "");

          // Existing exact match (unchanged)
          if (
            apiMname === registryMarket ||
            apiMarketName === registryMarket
          ) {
            return true;
          }

          // Only for UNDER/OVER & OVER_UNDER markets
          const isRegistryOU =
            registryMarket.includes("UNDER/OVER") ||
            registryMarket.includes("OVER UNDER");

          if (!isRegistryOU) {
            return false;
          }

          // Compare only the goal line (0.5, 1.5, 2.5, etc.)
          const registryLine =
            registryMarket.match(/(\d+(\.\d+)?)/)?.[1];

          const apiLine =
            apiMname.match(/(\d+(\.\d+)?)/)?.[1] ||
            apiMarketName.match(/(\d+(\.\d+)?)/)?.[1];

          return registryLine && registryLine === apiLine;
        });

        if (!marketResult) {
          console.log(
            "[3P-Cron][Match] Market result not found",
            {
              gameId: reg.gameId,
              marketName: reg.marketName,
            }
          );
          continue;
        }

        const winnerName = (marketResult.winnerName || "").trim().toLowerCase();

        const isNoResult = winnerName === "no result";

        if (marketResult.status !== "SETTLE" && !isNoResult) {
          continue;
        }

        const winner =
          marketResult.rollback ||
          (marketResult.winnerName || "").trim().toLowerCase() === "no result"
            ? "cancel"
            : marketResult.winnerName;

        if (!winner) {
          continue;
        }

        const pendingMarketIds =
          await Bet.distinct("marketId", {
            gameId: reg.gameId,
            status: "pending",
            gType: {
              $in: ["match", "match1","cricketcasino"],
            },
            isActive: true,
            etid: {
              $in: SPORT_ETIDS,
            },
          });

        let totalUpdated = 0;

        for (const marketId of pendingMarketIds) {
          const { updatedCount } =
            await declareMatchResultInternal(
              reg.gameId,
              Number(reg.originalMarketId),
              winner
            );

          totalUpdated += updatedCount;
        }

        // console.log(
        //   `[3P-Cron][Match] Declared`,
        //   {
        //     gameId: reg.gameId,
        //     marketId: reg.marketId,
        //     winner,
        //     totalUpdated,
        //   }
        // );

        // console.log(
        //   "[MATCH REGISTRY UPDATE]",
        //   {
        //     gameId: reg.gameId,
        //     marketId: reg.marketId,
        //   }
        // );

        await ThirdPartyMatchRegistry.findOneAndUpdate(
          {
            gameId: reg.gameId,
            marketId: reg.marketId,
          },
          {
            resultDeclared: true,
            resultData: marketResult,
            declaredAt: new Date(),
            registrationFailed: false,
          }
        );

        // console.log(
        //   "[MATCH REGISTRY UPDATED]",
        //   {
        //     gameId: reg.gameId,
        //     marketId: reg.marketId,
        //   }
        // );
      } catch (regErr) {
        console.error(
          `[3P-Cron][Match] Error`,
          {
            gameId: reg.gameId,
            marketId: reg.marketId,
            error: regErr?.message,
          }
        );
      }
    }
  } catch (err) {
    console.error(
      "[3P-Cron][Match] Cron error:",
      err.message
    );
  } finally {
    isMatchCronRunning = false;
  }
}


const EnableCricket = async () => {
  try {
    // ============================================================
    // 1. GET CRICKET GAME LIST FROM highlighthomePrivate
    //    Only ETID = 4
    // ============================================================
    const response = await apiRequest({
      url: "highlighthomePrivate",
      apiAction: "GET",
      data: {
        etid: 4,
        key: process.env.JSK_KEY,
      },
      host: process.env.JSK_SERVER_URL,
      noEncrypt: true,
    });

    // ============================================================
    // 2. GET t1 + t2
    // ============================================================
    let matchesData = [
      ...(response?.data?.data?.t1 || []),
      ...(response?.data?.data?.t2 || []),
    ];

    console.log(
      `[EnableCricket] Total cricket games received: ${matchesData.length}`
    );

    // ============================================================
    // 3. ONLY ETID = 4
    // ============================================================
    matchesData = matchesData.filter(
      (data) => Number(data?.etid) === 4
    );

    // ============================================================
    // 4. iscc = 0 => SKIP
    //    iscc != 0 => PROCESS
    // ============================================================
    matchesData = matchesData.filter((data) => {
      if (Number(data?.iscc) === 0) {
        console.log(
          `[EnableCricket] ⏭️ SKIP GMID: ${data?.gmid} | iscc: 0`
        );

        return false;
      }

      return true;
    });

    console.log(
      `[EnableCricket] Eligible cricket games: ${matchesData.length}`
    );

    // ============================================================
    // 5. GET ONLY DOMAINS WHERE autoEnable = true
    // ============================================================
    const autoEnableDomains = await mongoose.connection.db
      .collection("domains")
      .find({
        autoEnable: true,
      })
      .toArray();

    console.log(
      `[EnableCricket] Auto-enable domains: ${autoEnableDomains.length}`
    );

    if (!autoEnableDomains.length) {
      console.log(
        "[EnableCricket] ⚠️ No domain found with autoEnable: true"
      );

      return [];
    }

    const results = [];

    // ============================================================
    // 6. DOMAIN-WISE PROCESSING
    //
    // Every eligible cricket game will be processed only for
    // domains where autoEnable = true.
    // ============================================================
    for (const domainData of autoEnableDomains) {
      const domain = domainData?.domain;

      if (!domain) {
        continue;
      }

      console.log(
        `\n[EnableCricket] 🌐 Processing Domain: ${domain}`
      );

      // ==========================================================
      // 7. PROCESS EACH ELIGIBLE CRICKET GAME
      // ==========================================================
      for (const originalData of matchesData) {
        const data = {
          ...originalData,
          domain,
        };

        // ========================================================
        // SAFETY CHECK
        // ========================================================
        if (Number(data?.etid) !== 4) {
          console.log(
            `[EnableCricket] ⏭️ Skip GMID: ${data?.gmid} | ETID: ${data?.etid}`
          );

          continue;
        }

        if (Number(data?.iscc) === 0) {
          console.log(
            `[EnableCricket] ⏭️ Skip GMID: ${data?.gmid} | iscc: 0`
          );

          continue;
        }

        // ========================================================
        // SAME CREATE QUERY
        // ========================================================
        const query = {
          gmid: data.gmid,
          domain: data.domain,
        };

        if (data?.gtype) {
          query.gtype = data.gtype;
        }

        console.log(
          `[EnableCricket] Processing GMID: ${data?.gmid} | Domain: ${data?.domain} | ETID: ${data?.etid} | iscc: ${data?.iscc}`
        );

        let existingMatch = await getGame(query);

        // ========================================================
        // GAME EXISTS
        // SAME CREATE UPDATE LOGIC
        // ========================================================
        if (existingMatch) {
          // Update isActive if:
          // 1. Existing record is NOT casino
          // 2. OR request explicitly targets casino
          if (
            existingMatch.gtype !== "casino" ||
            data?.gtype === "casino"
          ) {
            existingMatch.isActive =
              data.isActive !== undefined
                ? data.isActive
                : existingMatch.isActive;
          }

          // ======================================================
          // CASINO UPDATE
          // ======================================================
          if (data?.gtype === "casino") {
            existingMatch.gmid =
              data.gmid || existingMatch.gmid;

            existingMatch.gname =
              data.gname || existingMatch.gname;

            existingMatch.imgpath =
              data.imgpath || existingMatch.imgpath;
          }

          // ======================================================
          // BET CONFIG
          // ======================================================
          if (data?.bet_config) {
            existingMatch.bet_config = {
              ...(existingMatch.bet_config?.toObject?.() ||
                existingMatch.bet_config),
              ...data?.bet_config,
            };
          }

          // ======================================================
          // BET LIMIT
          // ======================================================
          if (data?.bet_limit) {
            existingMatch.bet_limit = {
              ...(existingMatch.bet_limit?.toObject?.() ||
                existingMatch.bet_limit),
              ...data?.bet_limit,
            };
          }

          await existingMatch.save();

          results.push({
            match: existingMatch.toObject(),
            message: `Game updated (isActive: ${existingMatch.isActive})`,
          });

          console.log(
            `[EnableCricket] ✅ Game updated | GMID: ${data?.gmid} | Domain: ${data?.domain}`
          );
        }

        // ========================================================
        // GAME DOES NOT EXIST
        // SAME CREATE ELSE LOGIC
        // ========================================================
        else {
          // ======================================================
          // GET GAMEDATA FOR NON-CASINO
          // ======================================================
          if (data?.gtype !== "casino") {
            const payload = {
              etid: data.etid,
              gmid: data.gmid,
              vir: true,
            };

            console.log(
              `[EnableCricket] Calling gamedataPrivate | ETID: ${payload.etid} | GMID: ${payload.gmid}`
            );

            const res = await apiRequest({
              url: "gamedataPrivate",
              apiAction: "GET",
              data: {
                etid: data.etid,
                gmid: data.gmid,
                key: process.env.JSK_KEY,
              },
              host: process.env.JSK_SERVER_URL,
              noEncrypt: true,
            });

            let section = null;

            if (res?.data?.data?.length > 0) {
              section = res?.data?.data
                ?.find(
                  (item) =>
                    item?.gtype === "match1" ||
                    item?.gtype === "match"
                )
                ?.section?.map((item) => ({
                  teamName: item?.nat,
                  sid: item?.sid,
                }));

              data.section = section;
            }
          }

          // ======================================================
          // GET DOMAIN CONFIG
          // ======================================================
          const domainConfig =
            await getDomainByDomain(data?.domain);

          // ======================================================
          // CREATE GAME
          // ======================================================
          const match = new Game({
            ...data,
            bet_limit: domainConfig?.bet_limit,
          });

          console.log("[EnableCricket] SAVING GAME:", {
            gmid: match.gmid,
            domain: match.domain,
            etid: match.etid,
            iscc: match.iscc,
          });

          await match.save();

          results.push({
            match: match.toObject(),
            message: "Game created",
          });

          console.log(
            `[EnableCricket] ✅ Game created | GMID: ${data?.gmid} | Domain: ${data?.domain}`
          );
        }

        // ========================================================
        // SAME CACHE LOGIC
        // ========================================================
        const target =
          existingMatch ||
          results[results.length - 1].match;

        await delCache("matches:all");

        await delCache(
          `matches:cid:${target.cid}`
        );

        await delCache(
          `matches:gid:${target.gid}:type:${target.type}`
        );

        if (target?.gtype === "casino") {
          await delCache(
            `tablelist:${target.gid}-${data?.domain}`
          );
        }

        // ========================================================
        // DOMAIN + ETID CACHE
        // ========================================================
        if (data?.domain && data?.etid) {
          await delCache(
            `highlighthomePrivate:${data.domain}-${data.etid}`
          );

          await delCacheByPattern(
            `highlighthomePrivate:${data.domain}-${data.etid}-*`
          );
        }

        // ========================================================
        // TABLELIST CACHE
        // ========================================================
        if (data?.domain && data?.gid) {
          await delCacheByPattern(
            `tablelist:${data.gid}-${data.domain}-*`
          );
        }
      }
    }

    // ============================================================
    // COMPLETE
    // ============================================================
    console.log(
      `[EnableCricket] ✅ Complete | Domains: ${autoEnableDomains.length} | Games: ${matchesData.length} | Processed: ${results.length}`
    );

    return results;
  } catch (e) {
    console.log(
      e,
      "++++++=Enable Cricket Error+++++"
    );

    throw e;
  }
};

module.exports = {
  checkFancyResults,
  checkMatchResults,
  fancyResultCallback,
  EnableCricket,
};
