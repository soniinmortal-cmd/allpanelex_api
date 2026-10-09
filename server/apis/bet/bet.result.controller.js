const httpStatus = require("http-status");
const APIError = require("../../helpers/APIError");
const APIResponse = require("../../helpers/APIResponse");
const {
  createBet,
  getBets,
  getBetById,
  updateBet,
  getBetsByMarketID,
  collectAllIds,
  Bet,
  findDuplicateBet,
} = require("./bet.helper");
const Transaction=require("../transaction/transaction.model");
 
const { getUserById, getUser, getAllUsers } = require("../users/users.helper");
const mongoose = require("mongoose");
const {
  updateSportsData,
  getSportsData,
  getAllSportsData,
  getSportsDataById,
} = require("../sports-data/sports-data.helper");
const { setCache, delCacheByPattern, delCache } = require("../../helpers/cache");
const { getButtonSettings } = require("../settings/settings.helper");
const {
  apiRequest,
  filterBetsByDate,
  distributeCommissionHierarchy,
  getUserCommissionHierarchyFast,
  distributeBettingCommissionHierarchy,
} = require("../../helpers/utils");
const betModel = require("./bet.model");
const User = require("../users/users.model");
const moment = require("moment/moment");
const {
  findPartnershipByUserAndPartner,
} = require("../partnership/partnership.helper");

const TEENPATTI_RESULT_GTYPES = [
  "teen20c",
  "teen20b",
  "teen20",
  "teen20v1",
  "pteen20",
  "tteen20",
  "teen",
  "pteen",
  "tteen",
  "teen62",
];
const JOKER_RESULT_GTYPES = ["joker1", "joker120", "joker20", "teenjoker"];
const getBetTypeKeys = (bet) =>
  [bet?.gType, bet?.cType, bet?.gameId, bet?.subType, bet?.gameType, bet?.type]
    .filter(Boolean)
    .map((value) => value.toString().trim().toLowerCase());
const isTeenpattiEventResultBet = (bet) =>
  /teen\s*patti|teenpatti/i.test(bet?.eventName || bet?.marketName || "");
const isJokerEventResultBet = (bet) =>
  /joker/i.test(bet?.eventName || bet?.marketName || "");
const isTeenpattiResultBet = (bet) => {
  const keys = getBetTypeKeys(bet);
  return (
    keys.some((key) => TEENPATTI_RESULT_GTYPES.includes(key)) ||
    isTeenpattiEventResultBet(bet)
  );
};
const isJokerResultBet = (bet) => {
  const keys = getBetTypeKeys(bet);
  return (
    keys.some((key) => JOKER_RESULT_GTYPES.includes(key) || key.includes("joker")) ||
    isJokerEventResultBet(bet)
  );
};
const getTeenJokerResultProfitLoss = (bet, status, fallback) => {
  if (!["won", "lost"].includes(status)) return fallback;
  if (!isTeenpattiResultBet(bet) && !isJokerResultBet(bet)) return fallback;

  const amount = Number(bet?.amount || 0);
  if (status === "lost") return -amount;
  return Number((((Number(bet?.uRate || 0) || 0) - 1) * amount).toFixed(2));
};
const { updateOneGame } = require("../games/games.helper");
const { handleMatchBet } = require("./bettingHandlers/matchBet");
const { handleFancyBet } = require("./bettingHandlers/fancyBet");
const { handleFancy1Bet } = require("./bettingHandlers/fancy1Bet");
const { handleOddEvenBet } = require("./bettingHandlers/oddEvenBet");
const { handleRandomBet } = require("./bettingHandlers/randomBet");
const { handleCmatch20Bet } = require("./bettingHandlers/cmatch20Bet");
const { handleCasinoFancyBet } = require("./bettingHandlers/casinoFancyBet");
const { handleCasinoFancy1Bet } = require("./bettingHandlers/casinoFancy1Bet");
const { handleCasinoMatchBet } = require("./bettingHandlers/casinoMatchBet");
const { handleCasinoFancy2Bet } = require("./bettingHandlers/casinoFancy2Bet");
const { createExposureLog } = require("../userLog/userLog.helper");
const { acquireLock, releaseLock } = require("../../helpers/lock.helper");

const settleBet = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // won, lost

    const { verifyAndFixUserExposure } = require("../../helpers/exposure.helper");

    const bet = await getBetById(id);
    if (!bet) {
      return res.status(httpStatus.NOT_FOUND).json(new APIError("Bet not found", httpStatus.NOT_FOUND));
    }

    if (bet.status !== 'pending') {
      return res.status(httpStatus.BAD_REQUEST).json(new APIError("Bet is already settled", httpStatus.BAD_REQUEST));
    }

    const user = await getUserById(bet.userId);
    if (!user) {
      return res.status(httpStatus.NOT_FOUND).json(new APIError("User not found", httpStatus.NOT_FOUND));
    }

    let profitLoss = 0;
    const amount = Number(bet.amount) || 0;
    const uRate = parseFloat(bet.uRate) || 0;
    const isBack = bet.betType === 'back';
    const isBookmaker = bet.gType === 'match1' || bet.marketName === 'Bookmaker';
    const isOddsStakeLossCasino =
      isTeenpattiResultBet(bet) || isJokerResultBet(bet);

    if (status === 'won') {
      if (isOddsStakeLossCasino) {
        const profit = Number(((uRate - 1) * amount).toFixed(2));
        profitLoss = profit;
      } else if (isBookmaker) {
        // Bookmaker: Profit = (Amt * Rate) / 100
        const profit = Number(((amount * uRate) / 100).toFixed(2));
        profitLoss = isBack ? profit : amount;
      } else {
        // Match: Profit = (Rate - 1) * Amt
        const profit = Number(((uRate - 1) * amount).toFixed(2));
        profitLoss = isBack ? profit : amount;
      }
    } else if (status === 'lost') {
      if (isOddsStakeLossCasino) {
        profitLoss = -amount;
      } else if (isBookmaker) {
        const profit = Number(((amount * uRate) / 100).toFixed(2));
        profitLoss = isBack ? -amount : -profit;
      } else {
        const profit = Number(((uRate - 1) * amount).toFixed(2));
        profitLoss = isBack ? -amount : -profit;
      }
    }

    const { getSessionIfReplicaSet } = require("../../helpers/db-topology");
    const { atomicUpdateUserFinance } = require("../../helpers/finance.helper");
    const { syncUserExposureFromSportsData } = require("../../helpers/exposure-sync.helper");
    const { updateSportsData } = require("../sports-data/sports-data.helper");

    let liabilityRelease = 0;
    if (isBack) {
      liabilityRelease = amount;
    } else {
      liabilityRelease = isBookmaker ? Number(((amount * uRate) / 100).toFixed(2)) : Number(((uRate - 1) * amount).toFixed(2));
    }

    const session = await getSessionIfReplicaSet();
    try {
      if (session) {
        // REPLICA SET: Use transaction for atomicity
        await session.withTransaction(async () => {
          const updated = await updateBet(id, { status, profit: profitLoss }, { session });
          if (!updated) throw new Error("Bet not found or already updated");

          await atomicUpdateUserFinance(user._id, { balance: profitLoss, exp: liabilityRelease }, { session, allowNegativeBuffer: true });
          await updateSportsData(bet.marketId, user._id, { mid: bet.marketId, sdata: [], userId: user._id }, { session });
          await syncUserExposureFromSportsData(user._id, { session });

          res.status(httpStatus.OK).send(new APIResponse(updated, "Bet settled atomically", httpStatus.OK));
        });
      } else {
        // STANDALONE: Run operations directly (no transaction, no double-execute)
        const updated = await updateBet(id, { status, profit: profitLoss });
        if (!updated) throw new Error("Bet not found or already updated");

        await atomicUpdateUserFinance(user._id, { balance: profitLoss, exp: liabilityRelease }, { allowNegativeBuffer: true });
        await updateSportsData(bet.marketId, user._id, { mid: bet.marketId, sdata: [], userId: user._id });
        await syncUserExposureFromSportsData(user._id);

        res.status(httpStatus.OK).send(new APIResponse(updated, "Bet settled", httpStatus.OK));
      }
    } finally {
      if (session) await session.endSession();
    }
  } catch (err) {
    next(err);
  }
};

const declareFancyResult = async (req, res, next) => {
  try {
    const { run, gameId, marketId, sectionId } = req.body;
    let pipeline = [
      {
        $match: {
          gameId,
          marketId,
          sectionId,
          isActive: true,
          status: "pending",
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

    // Idempotent success if no pending bets
    if (!bets || !bets.length) {
      return res.status(200).json({
        message: "No pending bets found",
        data: []
      });
    }

    const updatedBets = [];
    const userGroupWiseBets = bets;
    for (const user of userGroupWiseBets) {
      const userIdToLock = user._id; // In fancy aggregation, _id is the userId
      const lockKey = `lock:user:${userIdToLock}`;

      let lockAcquired = false;
      let retries = 0;
      while (!lockAcquired && retries < 10) {
        lockAcquired = await acquireLock(lockKey, 5000);
        if (!lockAcquired) {
          await new Promise(r => setTimeout(r, 200));
          retries++;
        }
      }

      if (!lockAcquired) {
        console.error(`Failed to acquire lock for user ${userIdToLock} during fancy result declaration`);
        continue;
      }

      let updateExp = 0;
      let updatePartnerExp = 0;
      let balance = 0;
      let userUpdatedCount = 0;
      const currentUserUpdatedBets = [];

      const session = await mongoose.startSession();
      const runSettlementInternal = async (sessionParam) => {
          // Reset markers for this run
          updateExp = 0;
          updatePartnerExp = 0;
          balance = 0;
          userUpdatedCount = 0;
          currentUserUpdatedBets.length = 0;

          // Re-fetch bets inside the lock & session to avoid aggregation race conditions
          const query = Bet.find({
            userId: userIdToLock,
            gameId,
            marketId,
            sectionId,
            isActive: true,
            status: "pending",
          });
          const freshUserBets = sessionParam ? await query.session(sessionParam) : await query;

          if (freshUserBets.length === 0) return;

          const findSpotsData = await getSportsData({
            mid: marketId,
            userId: userIdToLock,
          });

          for (const bet of freshUserBets) {
            let isWin = false;
            let profitLoss = 0;
            let profit = Number(((bet?.amount * bet?.size) / 100).toFixed(2));
            let loss = bet?.amount;

            if (["fancy", "meter"].includes(bet.gType)) {
              if (bet.betType === "lay") {
                isWin = run < bet.uRate;
                profitLoss = isWin ? loss : -profit;
              } else {
                isWin = run >= bet.uRate;
                profitLoss = isWin ? profit : -loss;
              }
            } else if (bet.gType === "fancy1") {
              profit = Number((parseFloat(bet.uRate - 1) * bet?.amount).toFixed(2));
              loss = bet?.amount;
              if (bet.betType === "lay") {
                isWin = run === 0;
                profitLoss = isWin ? loss : -profit;
              } else {
                isWin = run === 1;
                profitLoss = isWin ? profit : -loss;
              }
            } else if (bet.gType === "oddeven") {
              profit = Number((parseFloat(bet.uRate - 1) * bet?.amount).toFixed(2));
              loss = bet?.amount;
              if (bet.betType === "lay") {
                isWin = run === 0;
                profitLoss = isWin ? loss : -profit;
              } else {
                isWin = run === 1;
                profitLoss = isWin ? profit : -loss;
              }
            } else if (bet.gType === "khado") {
              if (bet.betType === "lay") {
                isWin = !(run >= bet.uRate && run < bet.uRate + bet.oRate);
                profitLoss = isWin ? loss : -profit;
              } else {
                isWin = run >= bet.uRate && run < bet.uRate + bet.oRate;
                profitLoss = isWin ? profit : -loss;
              }
            } else if (["cricketcasino"].includes(bet.gType) || isTeenpattiResultBet(bet) || isJokerResultBet(bet)) {
              profit = Number((parseFloat(bet.uRate - 1) * bet?.amount).toFixed(2));
              loss = bet?.amount;
              const runnerValue = parseInt(bet.sectionName, 10);
              isWin = run === runnerValue;
              if (isTeenpattiResultBet(bet) || isJokerResultBet(bet)) {
                if (bet.betType === "lay") {
                  isWin = !isWin;
                }
                profitLoss = isWin ? profit : -loss;
              } else if (bet.betType === "lay") {
                isWin = !isWin;
                profitLoss = isWin ? loss : -profit;
              } else {
                profitLoss = isWin ? profit : -loss;
              }
            }
            const updatedStatus = isWin ? "won" : "lost";

            const updateOpts = sessionParam ? { session: sessionParam, new: true } : { new: true };
            const updated = await Bet.findOneAndUpdate(
              { _id: bet._id, status: "pending" },
              {
                status: updatedStatus,
                profit: profitLoss,
                run: run,
                $unset: { winner: "" } // Ensure no stale winner field remains
              },
              updateOpts
            );

            if (updated) {
              currentUserUpdatedBets.push(updated);
              balance += profitLoss;
              userUpdatedCount++;
            }
          }

          if (userUpdatedCount > 0) {
            const spotsData = findSpotsData?.sdata || [];
            const idx = spotsData.findIndex(
              (exp) => exp?.sid === sectionId
            );
            if (idx > -1) {
              const checkExp = spotsData[idx];
              const currentMarketLiability = Math.min(0, checkExp.amount ?? 0);
              const maxMinusAmt = currentMarketLiability * -1;
              updateExp += maxMinusAmt;

              const maxExpValue = Math.max(
                0,
                ...checkExp?.calcTable.map((r) => r.profitLoss).filter((v) => v > 0)
              );
              updatePartnerExp += maxExpValue;

              spotsData.splice(idx, 1);
              await require("../sports-data/sports-data.helper").updateSportsData(marketId, userIdToLock, {
                mid: marketId,
                sdata: spotsData,
                userId: userIdToLock,
              }, { autoSyncExposure: true, ...(sessionParam ? { session: sessionParam } : {}) });
            }

            if (userUpdatedCount > 0) {
              const { atomicUpdateUserFinance } = require("../../helpers/finance.helper");
              const opts = { allowNegativeBuffer: true, ...(sessionParam ? { session: sessionParam } : {}) };
              const getUser = await atomicUpdateUserFinance(
                userIdToLock,
                { balance, exp: updateExp },
                opts
              );

              if (!getUser) {
                throw new Error("User not found during settlement");
              } else {
                const cacheKey = `user:${getUser._id}`;
                await setCache(cacheKey, getUser, 60);

                await distributeCommissionHierarchy(
                  getUser,
                  {
                    exp: updatePartnerExp,
                    profit: balance,
                  },
                  sessionParam ? { session: sessionParam } : {}
                );

                // Betting commission
                if (currentUserUpdatedBets.length > 0) {
                  await distributeBettingCommissionHierarchy(
                    getUser,
                    {
                      gameId,
                      marketId,
                      bets: currentUserUpdatedBets,
                    },
                    sessionParam
                      ? { session: sessionParam }
                      : {}
                  );
                }
              }
            }
          }
      };

      const { isReplicaSet } = require("../../helpers/db-topology");
      try {
        if (isReplicaSet()) {
          // REPLICA SET: Use transaction for atomicity
          await session.withTransaction(async () => {
            await runSettlementInternal(session);
          });
        } else {
          // STANDALONE: Run directly without session (no double-execute risk)
          await runSettlementInternal(null);
        }
      } catch (err) {
        console.error(`Error processing user ${userIdToLock} for fancy result:`, err);
      } finally {
        await session.endSession();
        await releaseLock(lockKey, lockAcquired);
        // Add successfully updated bets to global list
        updatedBets.push(...currentUserUpdatedBets);
        // Self-healing: Verify exposure after result processing (non-blocking)
        const { verifyAndFixUserExposure } = require("../../helpers/exposure.helper");
        await verifyAndFixUserExposure(userIdToLock).catch(err => console.error(`[Self-Heal] Error verifying user ${userIdToLock}:`, err));
      }
    }

    res.status(200).json({
      message: "Bets updated successfully",
      data: updatedBets,
    });
  } catch (err) {
    next(err);
  }
};

const cancelFancyResult = async (req, res, next) => {
  try {
    const { gameId, marketId, sectionId } = req.body;
    let pipeline = [
      {
        $match: {
          gameId,
          marketId,
          sectionId,
          isActive: true,
          status: { $in: ["won", "lost", "pending"] }, 
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
      return res.status(200).json({
        message: "No settled bets found to cancel",
        data: []
      });
    }

    const updatedBets = [];
    const userGroupWiseBets = bets;
    for (const user of userGroupWiseBets) {
      const lockKey = `lock:user:${user?._id}`;
      let lockAcquired = false;
      let retries = 0;
      while (!lockAcquired && retries < 10) {
        lockAcquired = await acquireLock(lockKey, 5000);
        if (!lockAcquired) {
          await new Promise(r => setTimeout(r, 200));
          retries++;
        }
      }

      if (!lockAcquired) {
        continue;
      }

      let updateExp = 0;
      let updatePartnerExp = 0;
      let userUpdatedCount = 0;
      let totalBalanceAdjustment = 0;
      const currentUserUpdatedBets = [];

      const session = await mongoose.startSession();
      const runSettlementInternal = async (sessionParam) => {
          updateExp = 0;
          updatePartnerExp = 0;
          userUpdatedCount = 0;
          totalBalanceAdjustment = 0;
          currentUserUpdatedBets.length = 0;

          const freshQuery = Bet.find({
            userId: user?._id,
            gameId,
            marketId,
            sectionId,
            isActive: true,
            status: { $in: ["won", "lost", "pending"] },
          });
          const freshUserBets = sessionParam ? await freshQuery.session(sessionParam) : await freshQuery;

          if (freshUserBets.length === 0) return;

          const findSpotsData = await getSportsData({
            mid: marketId,
            userId: user?._id,
          }, { session: sessionParam });

          for (const bet of freshUserBets) {
            let balanceAdjustment = 0;
            if (["won", "lost"].includes(bet.status)) {
              balanceAdjustment = -1 * (Number(bet.profit) || 0);
            }

            const updated = await Bet.findOneAndUpdate(
              {
                _id: bet._id,
                status: { $in: ["won", "lost", "pending"] }
              },
              {
                profit: 0,
                status: "cancelled",
              },
              { session: sessionParam, new: true }
            );

            if (updated) {
              currentUserUpdatedBets.push(updated);
              userUpdatedCount++;
              if (balanceAdjustment !== 0) {
                totalBalanceAdjustment += balanceAdjustment;
              }
            }
          }

          if (userUpdatedCount > 0) {
            const spotsData = findSpotsData?.sdata || [];
            const idx = spotsData.findIndex((exp) => exp?.sid === sectionId);

            if (idx > -1) {
              const checkExp = spotsData[idx];
              const maxMinusAmt = (checkExp.amount ?? 0) * -1;
              updateExp += maxMinusAmt;

              const maxExp = Math.max(
                0,
                ...checkExp?.calcTable.map((r) => r.profitLoss).filter((v) => v > 0)
              );
              updatePartnerExp += maxExp;

              spotsData.splice(idx, 1);

              await updateSportsData(marketId, user?._id, {
                mid: marketId,
                sdata: spotsData,
                userId: user?._id,
              }, { autoSyncExposure: true, session: sessionParam });
            }

            if (updateExp !== 0 || totalBalanceAdjustment !== 0) {
              const { atomicUpdateUserFinance } = require("../../helpers/finance.helper");
              const getUser = await atomicUpdateUserFinance(
                user?._id, 
                { balance: totalBalanceAdjustment, exp: updateExp }, 
                { session: sessionParam, allowNegativeBuffer: true }
              );

              if (!getUser) {
                  throw new Error("User not found during fancy result cancellation");
              } else {
                const cacheKey = `user:${getUser._id}`;
                await setCache(cacheKey, getUser, 60);
                await distributeCommissionHierarchy(getUser, {
                  exp: updatePartnerExp,
                }, { session: sessionParam });
              }
            }
          }
      };

      try {
        await session.withTransaction(async () => {
          await runSettlementInternal(session);
        });
      } catch (err) {
        if (err.message.includes('sessions are not supported') || err.code === 20) {
          console.warn(`[REPLICASET] Standalone DB detected in cancel fancy result. Using legacy update logic.`);
          await runSettlementInternal(null);
        } else {
          console.error(`Error processing user ${user?._id} for cancel fancy result:`, err);
        }
      } finally {
        await session.endSession();
        await releaseLock(lockKey, lockAcquired);
        updatedBets.push(...currentUserUpdatedBets);
        const { verifyAndFixUserExposure } = require("../../helpers/exposure.helper");
        await verifyAndFixUserExposure(user?._id).catch(e => console.error(`[Self-Heal] Error:`, e));
      }
    }

    res.status(200).json({
      message: "Bets updated successfully",
      data: updatedBets,
    });
  } catch (err) {
    next(err);
  }
};

const fancyResultRoleBack = async (req, res, next) => {
  try {
    const { gameId, marketId, sectionId } = req.body;
    let pipeline = [
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
      return res.status(200).json({ message: "No bet found to rollback", data: [] });
    }

    const allBetIds = bets.flatMap((group) =>
      group.bets.map((bet) => bet._id)
    );

    console.log("[Fancy Rollback] allBetIds:", allBetIds);

    const commissionTransactions = await Transaction.find({
        type: "commission",
        betIds: { $in: allBetIds },
        status: "approved",
      });

      console.log(
        "[Fancy Rollback] commissionTransactions:",
        commissionTransactions.map((t) => ({
          id: t._id,
          userId: t.userId,
          amount: t.amount,
          betIds: t.betIds,
        }))
      );

    const updatedBets = [];
    const userGroupWiseBets = bets;


    for (const user of userGroupWiseBets) {
      const lockKey = `lock:user:${user._id}`;
      let lockAcquired = false;
      let retries = 0;
      while (!lockAcquired && retries < 10) {
        lockAcquired = await acquireLock(lockKey, 5000);
        if (!lockAcquired) {
          await new Promise(r => setTimeout(r, 200));
          retries++;
        }
      }

      if (!lockAcquired) {
        console.error(`[fancyResultRoleBack] Failed to acquire lock for user ${user._id}`);
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

          const freshQuery = Bet.find({
            userId: user._id,
            gameId,
            marketId,
            sectionId,
            isActive: true,
            status: { $in: ["lost", "won", "cancelled"] },
          });
          const freshUserBets = sessionParam ? await freshQuery.session(sessionParam) : await freshQuery;

          if (freshUserBets.length === 0) return;

          const findSpotsData = await getSportsData({
            mid: marketId,
            userId: user?._id,
          }, { session: sessionParam });

          for (const bet of freshUserBets) {
            let balanceReversal = 0;
            if (["won", "lost"].includes(bet.status)) {
              balanceReversal = -1 * (Number(bet.profit) || 0);
            }

            const updated = await Bet.findOneAndUpdate(
              {
                _id: bet._id,
                status: { $in: ["won", "lost", "cancelled"] }
              },
              {
                status: "pending",
                profit: 0,
                run: 0,
                $unset: { winner: "" } // Clear winner on fancy rollback
              },
              { session: sessionParam, new: true }
            );

            if (updated) {
              currentUserUpdatedBets.push(updated);
              userUpdatedCount++;
              totalBalanceRev += balanceReversal;
            }
          }

          if (userUpdatedCount > 0) {
            const spotsData = findSpotsData?.sdata || [];
            const idx = spotsData.findIndex((exp) => exp?.sid === sectionId);

            const pendingBets = await Bet.find({
              userId: user._id,
              marketId: marketId,
              sectionId: sectionId,
              status: "pending",
              isActive: true
            }).session(sessionParam);

            if (pendingBets.length > 0) {
              const sample = pendingBets[0];
              let newAmount = 0;
              let newCalcTable = [];

              if (["fancy", "meter", "khado", "fancy1"].includes(sample.gType)) {
                let maxRate = 0;
                let maxBackRun = 0;
                let maxLayRun = 0;
                pendingBets.forEach((b) => {
                  const r = Number(b.uRate || b.oRate || 0);
                  if (r > maxRate) maxRate = r;
                  if (b.amount > 0) {
                    if (b.betType === "back" && r > maxBackRun) maxBackRun = r;
                    if (b.betType === "lay" && r > maxLayRun) maxLayRun = r;
                  }
                });

                const startRun = 0;
                const endRun = maxRate + 10;

                for (let run = startRun; run <= endRun; run++) {
                  let pl = 0;
                  pendingBets.forEach((b) => {
                    const amt = Number(b.amount || 0);
                    const rate = Number(b.uRate || b.oRate || 0);
                    const size = Number(b.size || 100);

                    if (["fancy", "meter"].includes(b.gType)) {
                      if (b.betType === "back") {
                        pl += (run >= rate ? (run >= maxBackRun ? (amt * size) / 100 : 0) : -amt);
                      } else {
                        pl += (run < rate ? amt : (run >= maxLayRun ? -(amt * size) / 100 : 0));
                      }
                    } else if (b.gType === "fancy1") {
                      let profit = Number((parseFloat(rate - 1) * amt).toFixed(2));
                      let loss = amt;
                      if (b.betType === "lay") {
                        let isWin = run === 0;
                        pl += isWin ? loss : -profit;
                      } else {
                        let isWin = run === 1;
                        pl += isWin ? profit : -loss;
                      }
                    } else if (b.gType === "khado") {
                      let inRange = run >= rate && run < rate + Number(b.oRate || 0);
                      let profit = Number(((amt * size) / 100).toFixed(2));
                      if (b.betType === "lay") {
                        pl += (!inRange ? amt : -profit);
                      } else {
                        pl += (inRange ? profit : -amt);
                      }
                    }
                  });
                  newCalcTable.push({ run, profitLoss: Number(pl.toFixed(2)) });
                }
                newAmount = Math.min(0, ...newCalcTable.map((r) => r.profitLoss));
              } else if (sample.gType === "oddeven") {
                 for (let outcome of ["lay", "back"]) {
                  let pl = 0;
                  pendingBets.forEach((b) => {
                    const amt = Number(b.amount || 0);
                    const rate = Number(b.uRate || 0);
                    let isLay = b.betType === "lay";
                    if (isLay) {
                      pl += (outcome === "lay" ? (rate - 1) * amt : -amt);
                    } else {
                      pl += (outcome === "back" ? (rate - 1) * amt : -amt);
                    }
                  });
                  newCalcTable.push({ outcome, profitLoss: Number(pl.toFixed(2)) });
                }
                newAmount = Math.min(0, ...newCalcTable.map((r) => r.profitLoss));
              }

              if (newCalcTable.length > 0) {
                const newEntry = { sid: sectionId, amount: newAmount, calcTable: newCalcTable };
                if (idx > -1) spotsData[idx] = newEntry;
                else spotsData.push(newEntry);

                await updateSportsData(marketId, user._id, {
                  mid: marketId,
                  sdata: spotsData,
                  userId: user._id
                }, { autoSyncExposure: true, session: sessionParam });

                updateExp += newAmount;
                updatePartnerExp += Math.max(0, ...newCalcTable.map(r => r.profitLoss).filter(v => v > 0));
              }
            }

            if (totalBalanceRev !== 0 || updateExp !== 0) {
                const { atomicUpdateUserFinance } = require("../../helpers/finance.helper");
                const getUser = await atomicUpdateUserFinance(
                    user?._id, 
                    { balance: totalBalanceRev, exp: updateExp }, 
                    { session: sessionParam, allowNegativeBuffer: true }
                );

                if (!getUser) {
                  throw new Error("User not found during fancy result rollback");
                } else {
                  const cacheKey = `user:${getUser._id}`;
                  await setCache(cacheKey, getUser, 60);
                  await distributeCommissionHierarchy(getUser, {
                    exp: updatePartnerExp * -1,
                    profit: totalBalanceRev,
                  }, { session: sessionParam });
                }
            }
          }
      };

      try {
        await session.withTransaction(async () => {
          await runSettlementInternal(session);
        });
      } catch (err) {
        if (err.message.includes('sessions are not supported') || err.code === 20) {
          console.warn(`[REPLICASET] Standalone DB detected in fallback for fancy rollback.`);
          await runSettlementInternal(null);
        } else {
          console.error(`Error processing user ${user._id} for fancy rollback:`, err);
        }
      } finally {
        await session.endSession();
        await releaseLock(lockKey, lockAcquired);
        updatedBets.push(...currentUserUpdatedBets);
        const { verifyAndFixUserExposure } = require("../../helpers/exposure.helper");
        await verifyAndFixUserExposure(user._id).catch(e => console.error(`[Self-Heal] Error:`, e));
      }
    }
      // ==========================================
      // HERE COMMISSION ROLLBACK ADDED
      // ==========================================

      if (commissionTransactions.length > 0) {
        const { atomicUpdateUserFinance } = require("../../helpers/finance.helper");

        for (const transaction of commissionTransactions) {
          const originalAmount = Number(transaction.amount || 0);

          if (originalAmount === 0) continue;

          const reverseAmount = -originalAmount;

          const updatedUser = await atomicUpdateUserFinance(
            transaction.userId,
            {
              balance: reverseAmount,
            },
            {
              allowNegativeBuffer: true,
            }
          );

          if (!updatedUser) {
            throw new Error(
              `User not found during commission rollback: ${transaction.userId}`
            );
          }

          await Transaction.updateOne(
            {
              _id: transaction._id,
              status: "approved",
            },
            {
              $set: {
                status: "rolled_back",
              },
            }
          );
        }
      }
    res.status(200).json({
      message: "Bets updated successfully",
      data: updatedBets,
    });
  } catch (err) {
    next(err);
  }
};

const declareMatchResult = async (req, res, next) => {
  try {
    const { winner, gameId, marketId } = req.body;

    console.log(
      "[declareMatchResult] Request Body:\n",
      JSON.stringify(req.body, null, 2)
    );

    const pipeline = [
      {
        $match: {
          gameId,
          marketId,
          status: "pending",
          $or: [
            { gType: { $in: ["match", "match1", "cricketcasino", ...TEENPATTI_RESULT_GTYPES, ...JOKER_RESULT_GTYPES] } },
            { gameId: { $in: [...TEENPATTI_RESULT_GTYPES, ...JOKER_RESULT_GTYPES] } },
            { subType: { $in: [...TEENPATTI_RESULT_GTYPES, ...JOKER_RESULT_GTYPES] } },
            { eventName: /teen\s*patti|teenpatti/i },
            { marketName: /teen\s*patti|teenpatti/i },
            { eventName: /joker/i },
            { marketName: /joker/i },
          ],
          isActive: true,
        },
      },
      {
        $group: {
          _id: "$userId",
          bets: { $push: "$$ROOT" },
        },
      },
      {
        $project: {
          userId: "$_id",
          _id: 0,
          markets: {
            $map: {
              input: {
                $setUnion: ["$bets.marketId"],
              },
              as: "marketId",
              in: {
                marketId: "$$marketId",
                bets: {
                  $filter: {
                    input: "$bets",
                    as: "bet",
                    cond: { $eq: ["$$bet.marketId", "$$marketId"] },
                  },
                },
              },
            },
          },
        },
      },
    ];

    const bets = await Bet.aggregate(pipeline);

    if (!bets || !bets.length) {
      return res.status(200).json({
        message: "No pending bets found",
        data: []
      });
    }

    const updatedBets = [];
    const userGroupWiseBets = bets;
    for (const user of userGroupWiseBets) {
      const userIdToLock = user.userId || user._id; 
      const lockKey = `lock:user:${userIdToLock}`;

      let lockAcquired = false;
      let retries = 0;
      while (!lockAcquired && retries < 10) {
        lockAcquired = await acquireLock(lockKey, 5000);
        if (!lockAcquired) {
          await new Promise(r => setTimeout(r, 200));
          retries++;
        }
      }

      if (!lockAcquired) {
        console.error(`Failed to acquire lock for user ${userIdToLock} during match result declaration`);
        continue;
      }

      let updateExp = 0;
      let updatePartnerExp = 0;
      let balance = 0;
      let userUpdatedCount = 0;
      const currentUserUpdatedBets = [];

      const session = await mongoose.startSession();
      const runSettlementInternal = async (sessionParam) => {
          updateExp = 0;
          updatePartnerExp = 0;
          balance = 0;
          userUpdatedCount = 0;
          currentUserUpdatedBets.length = 0;

          const freshQuery = Bet.find({
            userId: userIdToLock,
            gameId,
            marketId,
            status: "pending",
            $or: [
              { gType: { $in: ["match", "match1", "cricketcasino", ...TEENPATTI_RESULT_GTYPES, ...JOKER_RESULT_GTYPES] } },
              { gameId: { $in: [...TEENPATTI_RESULT_GTYPES, ...JOKER_RESULT_GTYPES] } },
              { subType: { $in: [...TEENPATTI_RESULT_GTYPES, ...JOKER_RESULT_GTYPES] } },
              { eventName: /teen\s*patti|teenpatti/i },
              { marketName: /teen\s*patti|teenpatti/i },
              { eventName: /joker/i },
              { marketName: /joker/i },
            ],
            isActive: true,
          });
          const freshUserBets = sessionParam ? await freshQuery.session(sessionParam) : await freshQuery;

          if (freshUserBets.length === 0) return;

          const marketsMap = {};
          for (const bet of freshUserBets) {
            if (!marketsMap[bet.marketId]) marketsMap[bet.marketId] = { marketId: bet.marketId, bets: [] };
            marketsMap[bet.marketId].bets.push(bet);
          }
          const freshMarkets = Object.values(marketsMap);

          for (const market of freshMarkets) {
            const findSpotsData = await getSportsData({
              mid: market?.marketId,
              userId: userIdToLock,
            }, { session: sessionParam });

            for (const bet of market?.bets) {
              let profitLoss = 0;
              let profit = Number(
                ((parseFloat(bet?.uRate) - 1) * bet?.amount).toFixed(2)
              );
              let loss = bet?.amount;
              const normalizeName = (name) => {
                if (!name) return "";
                return name
                  .toLowerCase()
                  .replace(/\bmain\b/g, "")
                  .trim()
                  .replace(/\.+$/, "")
                  .replace(/\s+/g, " ");
              };
              const winnerTeam = normalizeName(winner);
              const section = normalizeName(bet?.sectionName);
              let isWin = false;
              if (winner !== "cancel" && winner !== "No Result") {
                if (isTeenpattiResultBet(bet) || isJokerResultBet(bet)) {
                  const selectedWon = winnerTeam === section;
                  isWin = bet.betType === "lay" ? !selectedWon : selectedWon;
                  profitLoss = isWin ? profit : -loss;
                } else if (["match"].includes(bet.gType)) {
                  if (
                    winnerTeam === "tie" &&
                    bet.marketName?.toUpperCase() !== "TIED MATCH" &&
                    bet.marketName !== "TIED_MATCH"
                  ) {
                    profitLoss = 0;
                  } else if (
                    bet?.marketName === "TIED_MATCH" ||
                    bet?.marketName?.toUpperCase() === "TIED MATCH"
                  ) {

                    if (section === "yes") {
                      if (bet.betType === "lay") {
                        isWin = winnerTeam !== "tie";
                        profitLoss = isWin ? loss : -profit;
                      } else {
                        isWin = winnerTeam === "tie";
                        profitLoss = isWin ? profit : -loss;
                      }
                    } else {
                      if (bet.betType === "lay") {
                        isWin = winnerTeam === "tie";
                        profitLoss = isWin ? loss : -profit;
                      } else {
                        isWin = winnerTeam !== "tie";
                        profitLoss = isWin ? profit : -loss;
                      }
                    }

                  } else {

                    if (bet.betType === "lay") {
                      isWin = winnerTeam !== section;
                      profitLoss = isWin ? loss : -profit;
                    } else {
                      isWin = winnerTeam === section;
                      profitLoss = isWin ? profit : -loss;
                    }

                  }
                } else if (["match1"].includes(bet.gType)) {
                  profit = Number(
                    ((bet?.amount * parseFloat(bet?.uRate)) / 100).toFixed(2)
                  );


                  if (
                      winnerTeam === "tie" &&
                      bet.marketName?.toUpperCase() !== "TIED MATCH" &&
                      bet.marketName !== "TIED_MATCH"
                  ) {
                      profitLoss = 0;
                  }  else {
                      if (bet?.marketName === "TIED_MATCH" || bet?.marketName?.toUpperCase() === "TIED MATCH") {
                        if (section === "yes") {
                          if (bet.betType === "lay") {
                            isWin = winnerTeam !== "tie";
                            profitLoss = isWin ? loss : -profit;
                          } else {
                            isWin = winnerTeam === "tie";
                            profitLoss = isWin ? profit : -loss;
                          }
                        } else {
                          if (bet.betType === "lay") {
                            isWin = winnerTeam === "tie";
                            profitLoss = isWin ? loss : -profit;
                          } else {
                            isWin = winnerTeam !== "tie";
                            profitLoss = isWin ? profit : -loss;
                          }
                        }
                      } else {
                        if (bet.betType === "lay") {
                          isWin = winnerTeam !== section;
                          profitLoss = isWin ? loss : -profit;
                        } else {
                          isWin = winnerTeam === section;
                          profitLoss = isWin ? profit : -loss;
                        }
                      }
                  }

                  
                } else if (["cricketcasino"].includes(bet.gType)) {
                  if (bet.betType === "lay") {
                    isWin = winnerTeam !== section;
                    profitLoss = isWin ? loss : -profit;
                  } else {
                    isWin = winnerTeam === section;
                    profitLoss = isWin ? profit : -loss;
                  }
                }
              }

              const isTieCancelled =
                (bet.gType === "match" || bet.gType === "match1") &&
                winnerTeam === "tie" &&
                bet.marketName?.toUpperCase() !== "TIED MATCH" &&
                bet.marketName !== "TIED_MATCH";

              const updatedStatus =
                  winner === "cancel" ||
                  winner === "No Result" ||
                  isTieCancelled
                      ? "cancelled"
                      : isWin
                      ? "won"
                      : "lost";
              
              profitLoss = getTeenJokerResultProfitLoss(bet, updatedStatus, profitLoss);

              const updated = await Bet.findOneAndUpdate(
                { _id: bet._id, status: "pending" },
                {
                  status: updatedStatus,
                  profit: profitLoss,
                  winner: winner,
                  $unset: { run: "" } // Ensure no stale run field remains
                },
                { session: sessionParam, new: true }
              );

              if (updated) {
                balance += profitLoss;
                currentUserUpdatedBets.push(updated);
                userUpdatedCount++;
              }
            }

            if (userUpdatedCount > 0) {
              const marketBets = market?.bets || [];
              const betsInThisMarketUpdated = currentUserUpdatedBets.filter(ub => marketBets.some(mb => mb._id.toString() === ub._id.toString()));

              if (betsInThisMarketUpdated.length > 0) {
                const currentMarketLiability = Math.min(
                  0,
                  ...(findSpotsData?.sdata || []).map((item) => item.amount)
                );
                const minMinusAmt = currentMarketLiability * -1;
                updateExp += minMinusAmt;

                const currentMarketMaxProfit = Math.max(
                  0,
                  ...(findSpotsData?.sdata || []).map((item) => item.amount)
                );
                const maxMinusAmtForPartner = currentMarketMaxProfit;
                updatePartnerExp += maxMinusAmtForPartner;

                await updateSportsData(market?.marketId, userIdToLock, {
                  mid: market?.marketId,
                  sdata: [],
                  userId: userIdToLock
                }, { autoSyncExposure: true, session: sessionParam });
              }
            }
          }

          console.log("[DEBUG] before commission", {
  balance,
  userUpdatedCount,
  bets: currentUserUpdatedBets.length
});

          if ((balance !== 0 || updateExp !== 0) && userUpdatedCount > 0) {
            const { atomicUpdateUserFinance } = require("../../helpers/finance.helper");
            const getUser = await atomicUpdateUserFinance(
                userIdToLock, 
                { balance, exp: updateExp }, 
                { session: sessionParam, allowNegativeBuffer: true }
            );

            if (!getUser) {
              throw new Error("User not found during match result declaration");
            } else {
              const cacheKey = `user:${getUser._id}`;
              await setCache(cacheKey, getUser, 60);
              await distributeCommissionHierarchy(getUser, {
                exp: updatePartnerExp,
                profit: balance,
              }, { session: sessionParam });

              for (const market of freshMarkets) {
                const settledBetsForMarket =
                  currentUserUpdatedBets.filter((updatedBet) =>
                    updatedBet.marketId?.toString() ===
                    market.marketId?.toString() &&
                    String(updatedBet.etid) === "4"
                  );

                if (settledBetsForMarket.length > 0) {
                  console.log("[DEBUG] calling betting commission", {
  gTypes: settledBetsForMarket.map(b => b.gType),
  count: settledBetsForMarket.length
});
                  await distributeBettingCommissionHierarchy(
                    getUser,
                    {
                      gameId,
                      marketId: market.marketId,
                      bets: settledBetsForMarket,
                    },
                    { session: sessionParam }
                  );
                }
              }
            }
          }
      };

      try {
        await session.withTransaction(async () => {
          await runSettlementInternal(session);
        });
      } catch (err) {
        if (err.message.includes('sessions are not supported') || err.code === 20) {
          console.warn(`[REPLICASET] Standalone DB detected in match result. Using legacy update logic.`);
          await runSettlementInternal(null);
        } else {
          console.error(`Error processing user ${userIdToLock} for match result:`, err);
        }
      } finally {
        await session.endSession();
        await releaseLock(lockKey, lockAcquired);
        updatedBets.push(...currentUserUpdatedBets);
        const { verifyAndFixUserExposure } = require("../../helpers/exposure.helper");
        await verifyAndFixUserExposure(userIdToLock).catch(e => console.error(`[Self-Heal] Error:`, e));
      }
    }

    const etid = bets?.[0]?.markets?.[0]?.bets?.[0]?.etid || bets?.[0]?.bets?.[0]?.etid;
    if (etid && !isNaN(Number(etid))) {
      await updateOneGame(
        { gmid: Number(gameId), etid: Number(etid) },
        { isActive: false }
      );
      await delCacheByPattern(`highlighthomePrivate:${req?.domainConfig?.domain}-${etid}-*`);
    }

    res.status(200).json({
      message: "Bets updated successfully",
      data: updatedBets,
    });
  } catch (err) {
    next(err);
  }
};

// const matchResultRoleBack = async (req, res, next) => {
//   try {
//     const { gameId, marketId } = req.body;
//     const pipeline = [
//       {
//         $match: {
//           gameId,
//           marketId,
//           status: { $in: ["lost", "won"] },
//           $or: [
//             { gType: { $in: ["match", "match1", "cricketcasino", ...TEENPATTI_RESULT_GTYPES, ...JOKER_RESULT_GTYPES] } },
//             { gameId: { $in: [...TEENPATTI_RESULT_GTYPES, ...JOKER_RESULT_GTYPES] } },
//             { subType: { $in: [...TEENPATTI_RESULT_GTYPES, ...JOKER_RESULT_GTYPES] } },
//             { eventName: /teen\s*patti|teenpatti/i },
//             { marketName: /teen\s*patti|teenpatti/i },
//             { eventName: /joker/i },
//             { marketName: /joker/i },
//           ],
//           isActive: true,
//         },
//       },
//       {
//         $group: {
//           _id: "$userId",
//           bets: { $push: "$$ROOT" },
//         },
//       },
//       {
//         $project: {
//           userId: "$_id",
//           _id: 0,
//           markets: {
//             $map: {
//               input: {
//                 $setUnion: ["$bets.marketId"],
//               },
//               as: "marketId",
//               in: {
//                 marketId: "$$marketId",
//                 bets: {
//                   $filter: {
//                     input: "$bets",
//                     as: "bet",
//                     cond: { $eq: ["$$bet.marketId", "$$marketId"] },
//                   },
//                 },
//               },
//             },
//           },
//         },
//       },
//     ];

//     const bets = await Bet.aggregate(pipeline);

//     if (!bets || !bets.length) {
//       return res.status(200).json({
//         message: "No bets found to rollback",
//         data: []
//       });
//     }

//     const updatedBets = [];
//     const userGroupWiseBets = bets;
//     for (const user of userGroupWiseBets) {
//       const userIdToLock = user.userId || user._id;
//       const lockKey = `lock:user:${userIdToLock}`;

//       let lockAcquired = false;
//       let retries = 0;
//       while (!lockAcquired && retries < 10) {
//         lockAcquired = await acquireLock(lockKey, 5000);
//         if (!lockAcquired) {
//           await new Promise(r => setTimeout(r, 200));
//           retries++;
//         }
//       }

//       if (!lockAcquired) {
//         console.error(`[matchResultRoleBack] Failed to acquire lock for user ${userIdToLock}`);
//         continue;
//       }

//       let updateExp = 0;
//       let balance = 0;
//       let updatePartnerExp = 0;
//       let userUpdatedCount = 0;
//       const currentUserUpdatedBets = [];

//       const session = await mongoose.startSession();
//       const runSettlementInternal = async (sessionParam) => {
//           updateExp = 0;
//           balance = 0;
//           updatePartnerExp = 0;
//           userUpdatedCount = 0;
//           currentUserUpdatedBets.length = 0;

//           const freshQuery = Bet.find({
//             userId: userIdToLock,
//             gameId,
//             marketId,
//             status: { $in: ["lost", "won"] },
//             $or: [
//               { gType: { $in: ["match", "match1", "cricketcasino", ...TEENPATTI_RESULT_GTYPES, ...JOKER_RESULT_GTYPES] } },
//               { gameId: { $in: [...TEENPATTI_RESULT_GTYPES, ...JOKER_RESULT_GTYPES] } },
//               { subType: { $in: [...TEENPATTI_RESULT_GTYPES, ...JOKER_RESULT_GTYPES] } },
//               { eventName: /teen\s*patti|teenpatti/i },
//               { marketName: /teen\s*patti|teenpatti/i },
//               { eventName: /joker/i },
//               { marketName: /joker/i },
//             ],
//             isActive: true,
//           });
//           const freshUserBets = sessionParam ? await freshQuery.session(sessionParam) : await freshQuery;

//           if (freshUserBets.length === 0) return;

//           const marketsMap = {};
//           for (const bet of freshUserBets) {
//             if (!marketsMap[bet.marketId]) marketsMap[bet.marketId] = { marketId: bet.marketId, bets: [] };
//             marketsMap[bet.marketId].bets.push(bet);
//           }
//           const freshMarkets = Object.values(marketsMap);

//           for (const market of freshMarkets) {
//              const { handleMatchBet } = require("./bettingHandlers/matchBet");
//              const { handleCasinoMatchBet } = require("./bettingHandlers/casinoMatchBet");

//              for (const bet of market.bets) {
//                 const balanceReversal = -1 * (Number(bet.profit) || 0);

//                 const updated = await Bet.findOneAndUpdate(
//                   { _id: bet._id, status: { $in: ["lost", "won"] } },
//                   { status: "pending", profit: 0, $unset: { winner: "", run: "" } }, // Deep reset
//                   { session: sessionParam, new: true }
//                 );

//                 if (updated) {
//                   currentUserUpdatedBets.push(updated);
//                   userUpdatedCount++;
//                   balance += balanceReversal;
//                 }
//              }

//              if (userUpdatedCount > 0) {
//                // Recalculate exposure for the newly pending bets in this market
//                const queryPending = Bet.find({
//                  userId: userIdToLock,
//                  marketId: market.marketId,
//                  status: "pending",
//                  isActive: true
//                });
//                const allPendingInMarket = sessionParam ? await queryPending.session(sessionParam) : await queryPending;

//                let marketExp = 0;
//                let marketPartnerExp = 0;

//                if (allPendingInMarket.length > 0) {
//                  const { calculateMatchPLs, calculateMarketExposure, calculateInvertedMarketExposure } = require("../../helpers/exposure.helper");
//                  const sample = allPendingInMarket[0];
//                  let runners = [];
//                  if (sample.sections && sample.sections.length > 0) {
//                    runners = sample.sections.map(s => ({ sid: s.sid }));
//                  }
                 
//                  const scenarios = calculateMatchPLs(allPendingInMarket, runners);
//                  marketExp = calculateMarketExposure(market.marketId, allPendingInMarket);
//                  marketPartnerExp = calculateInvertedMarketExposure(market.marketId, allPendingInMarket);

//                  const sdata = scenarios.map(s => ({
//                    sid: s.sid,
//                    amount: s.pl
//                  }));

//                  await updateSportsData(market.marketId, userIdToLock, {
//                     mid: market.marketId,
//                     sdata: sdata,
//                     userId: userIdToLock
//                  }, { autoSyncExposure: true, session: sessionParam });
//                }

//                updateExp += marketExp;
//                updatePartnerExp += marketPartnerExp;
//              }
//           }

//           if (balance !== 0 || updateExp !== 0) {
//              const { atomicUpdateUserFinance } = require("../../helpers/finance.helper");
//              const getUser = await atomicUpdateUserFinance(
//                 userIdToLock,
//                 { balance, exp: updateExp },
//                 { session: sessionParam, allowNegativeBuffer: true }
//              );

//              if (!getUser) {
//                throw new Error("User not found during match result rollback");
//              } else {
//                 const cacheKey = `user:${getUser._id}`;
//                 await setCache(cacheKey, getUser, 60);
//                 await distributeCommissionHierarchy(getUser, {
//                    exp: updatePartnerExp,
//                    profit: balance,
//                 }, { session: sessionParam });
//              }
//           }
//       };

//       try {
//         await session.withTransaction(async () => {
//           await runSettlementInternal(session);
//         });
//       } catch (err) {
//         if (err.message.includes('sessions are not supported') || err.code === 20) {
//           console.warn(`[REPLICASET] Standalone DB detected in fallback for match rollback.`);
//           await runSettlementInternal(null);
//         } else {
//           console.error(`Error processing user ${userIdToLock} for match rollback:`, err);
//         }
//       } finally {
//         await session.endSession();
//         await releaseLock(lockKey, lockAcquired);
//         updatedBets.push(...currentUserUpdatedBets);
//         const { verifyAndFixUserExposure } = require("../../helpers/exposure.helper");
//         await verifyAndFixUserExposure(userIdToLock).catch(e => console.error(`[Self-Heal] Error:`, e));
//       }
//     }

//     res.status(200).json({
//       message: "Bets updated successfully",
//       data: updatedBets,
//     });
//   } catch (err) {
//     next(err);
//   }
// };


const matchResultRoleBack = async (req, res, next) => {
  try {
    const { gameId, marketId } = req.body;

    console.log("========================================");
    console.log("MATCH RESULT ROLLBACK");
    console.log("REQUEST gameId:", gameId);
    console.log("REQUEST marketId:", marketId);
    console.log("========================================");

    // =========================================================
    // COMMON TYPE SAFE VALUES
    // =========================================================

    const gameIdValues = [
      gameId,
      String(gameId),
      Number(gameId)
    ].filter(
      (v) =>
        v !== undefined &&
        v !== null &&
        v !== "" &&
        !(typeof v === "number" && Number.isNaN(v))
    );

    const marketIdValues = [
      marketId,
      String(marketId),
      Number(marketId)
    ].filter(
      (v) =>
        v !== undefined &&
        v !== null &&
        v !== "" &&
        !(typeof v === "number" && Number.isNaN(v))
    );

    const uniqueGameIds = [
      ...new Set(gameIdValues)
    ];

    const uniqueMarketIds = [
      ...new Set(marketIdValues)
    ];

    console.log(
      "GAME IDS:",
      uniqueGameIds
    );

    console.log(
      "MARKET IDS:",
      uniqueMarketIds
    );


    // =========================================================
    // SUPER OVER CHECK
    //
    // IMPORTANT:
    // First try exact gameId + marketId.
    // =========================================================

    // =========================================================
    // SUPER OVER CHECK + ROLLBACK
    // ONLY SUPER OVER LOGIC
    // OLD NORMAL GAME LOGIC WILL REMAIN UNCHANGED
    // =========================================================

    let superOverBets = await Bet.find({
      gameId: {
        $in: uniqueGameIds
      },

      cType: {
        $regex: /^superover/i
      },

      isActive: true,

      status: {
        $in: [
          "lost",
          "won"
        ]
      }
    }).lean();

    console.log(
      "SUPER OVER BETS:",
      superOverBets.length
    );


    // =========================================================
    // SUPER OVER ROLLBACK
    // =========================================================

    if (superOverBets.length > 0) {

      console.log("========================================");
      console.log("SUPER OVER ROLLBACK START");
      console.log("========================================");

      const updatedBets = [];

      // =======================================================
      // GROUP BY USER
      // =======================================================

      const usersMap = {};

      for (const bet of superOverBets) {

        const uid = String(bet.userId);

        if (!usersMap[uid]) {
          usersMap[uid] = [];
        }

        usersMap[uid].push(bet);
      }


      // =======================================================
      // USER LOOP
      // =======================================================

      for (const userId of Object.keys(usersMap)) {

        const lockKey = `lock:user:${userId}`;

        let lockAcquired = false;
        let retries = 0;

        // =====================================================
        // LOCK
        // =====================================================

        while (!lockAcquired && retries < 10) {

          lockAcquired = await acquireLock(
            lockKey,
            5000
          );

          if (!lockAcquired) {

            await new Promise((resolve) =>
              setTimeout(resolve, 200)
            );

            retries++;
          }
        }


        if (!lockAcquired) {

          console.error(
            "LOCK FAILED FOR SUPER OVER USER:",
            userId
          );

          continue;
        }


        try {

          const currentUserUpdatedBets = [];

          let balance = 0;
          let updateExp = 0;
          let updatePartnerExp = 0;


          // =====================================================
          // FRESH SUPER OVER BETS
          // IMPORTANT:
          // DO NOT USE FRONTEND marketId HERE
          // =====================================================

          const freshBets = await Bet.find({

            userId: userId,

            gameId: {
              $in: uniqueGameIds
            },

            cType: {
              $regex: /^superover/i
            },

            isActive: true,

            status: {
              $in: [
                "lost",
                "won"
              ]
            }

          });


          console.log(
            "SUPER OVER FRESH BETS:",
            freshBets.length
          );


          if (freshBets.length === 0) {
            continue;
          }


          // =====================================================
          // ROLLBACK EACH BET
          // =====================================================

          for (const bet of freshBets) {

            console.log(
              "SUPER OVER BET FOUND:",
              {
                id: bet._id,
                userId: bet.userId,
                gameId: bet.gameId,
                marketId: bet.marketId,
                gType: bet.gType,
                cType: bet.cType,
                status: bet.status,
                profit: bet.profit
              }
            );


            const oldProfit =
              Number(bet.profit) || 0;


            // ===================================================
            // EXACT BET UPDATE
            // ===================================================

           // ===================================================
            // SUPER OVER - ROLLBACK BET
            // ONLY SUPER OVER
            // ===================================================

            // const updateResult = await Bet.updateOne(
            //   {
            //     _id: bet._id,
            //     status: {
            //       $in: ["lost", "won"]
            //     },
            //     cType: {
            //       $regex: /^superover/i
            //     }
            //   },
            //   {
            //     $set: {
            //       status: "pending",
            //       profit: 0,

            //       // Make sure Current Bet filters can see it
            //       isActive: true,
            //       isDeleteBetShowUser: false,
            //       deleteBetStatus: false
            //     },

            //     $unset: {
            //       winner: "",
            //       run: ""
            //     }
            //   }
            // );

            const updateResult = await Bet.updateOne(
              {
                _id: bet._id,
                status: {
                  $in: ["lost", "won"]
                },
                cType: {
                  $regex: /^superover/i
                }
              },
              {
                $set: {
                  status: "pending",
                  profit: 0,

                  // Make sure Current Bet filters can see it
                  isActive: true,
                  isDeleteBetShowUser: false,
                  deleteBetStatus: false
                }
              }
            );

            console.log(
              "========================================"
            );

            console.log(
              "SUPER OVER DB UPDATE RESULT:",
              {
                betId: bet._id,
                matchedCount: updateResult.matchedCount,
                modifiedCount: updateResult.modifiedCount
              }
            );

          // ===================================================
          // VERIFY ACTUAL DATABASE VALUE
          // ===================================================

            if (updateResult.modifiedCount === 1) {

              const updated = await Bet.findById(
                bet._id
              ).lean();

              console.log(
                "SUPER OVER DATABASE AFTER ROLLBACK:",
                {
                  id: updated?._id,
                  status: updated?.status,
                  profit: updated?.profit,
                  isActive: updated?.isActive,
                  isDeleteBetShowUser:
                    updated?.isDeleteBetShowUser,
                  deleteBetStatus:
                    updated?.deleteBetStatus,
                  cType: updated?.cType,
                  gameId: updated?.gameId,
                  marketId: updated?.marketId
                }
              );

              // =================================================
              // IMPORTANT:
              // ONLY ACCEPT IF DATABASE REALLY HAS PENDING
              // =================================================

              if (
                updated &&
                String(updated.status).toLowerCase() === "pending" &&
                updated.isActive === true
              ) {

                console.log(
                  "========================================"
                );

                console.log(
                  "SUPER OVER ROLLBACK SUCCESS"
                );

                console.log(
                  "BET ID:",
                  updated._id
                );

                console.log(
                  "OLD STATUS:",
                  bet.status
                );

                console.log(
                  "NEW STATUS:",
                  updated.status
                );

                console.log(
                  "OLD PROFIT:",
                  oldProfit
                );

                console.log(
                  "NEW PROFIT:",
                  updated.profit
                );

                console.log(
                  "MARKET ID:",
                  updated.marketId
                );

                console.log(
                  "CTYPE:",
                  updated.cType
                );

                console.log(
                  "========================================"
                );

                currentUserUpdatedBets.push(
                  updated
                );

                // Reverse old settlement profit/loss
                balance += -oldProfit;

              } else {

                console.error(
                  "SUPER OVER ROLLBACK VERIFICATION FAILED:",
                  {
                    betId: bet._id,
                    status: updated?.status,
                    profit: updated?.profit,
                    isActive: updated?.isActive
                  }
                );
              }

            } else {

              console.error(
                "SUPER OVER DB UPDATE FAILED:",
                {
                  betId: bet._id,
                  matchedCount: updateResult.matchedCount,
                  modifiedCount: updateResult.modifiedCount
                }
              );
            }
          }


          // =====================================================
          // RECALCULATE EXPOSURE
          // =====================================================

          if (currentUserUpdatedBets.length > 0) {

            const actualMarketIds = [
              ...new Set(
                currentUserUpdatedBets.map(
                  (b) => String(b.marketId)
                )
              )
            ];


            for (
              const actualMarketIdString of actualMarketIds
            ) {

              const actualBet =
                currentUserUpdatedBets.find(
                  (b) =>
                    String(b.marketId) ===
                    actualMarketIdString
                );


              const actualMarketId =
                actualBet.marketId;


              const pendingBets =
                await Bet.find({

                  userId: userId,

                  marketId: actualMarketId,

                  status: "pending",

                  isActive: true

                });


              console.log(
                "SUPER OVER PENDING:",
                {
                  userId,
                  marketId: actualMarketId,
                  count: pendingBets.length
                }
              );


              let marketExp = 0;
              let marketPartnerExp = 0;


              if (pendingBets.length > 0) {

                const {
                  calculateMatchPLs,
                  calculateMarketExposure,
                  calculateInvertedMarketExposure
                } = require(
                  "../../helpers/exposure.helper"
                );


                const sample =
                  pendingBets[0];


                let runners = [];


                if (
                  sample.sections &&
                  sample.sections.length > 0
                ) {

                  runners =
                    sample.sections.map(
                      (s) => ({
                        sid: s.sid
                      })
                    );
                }


                const scenarios =
                  calculateMatchPLs(
                    pendingBets,
                    runners
                  );


                marketExp =
                  calculateMarketExposure(
                    actualMarketId,
                    pendingBets
                  );


                marketPartnerExp =
                  calculateInvertedMarketExposure(
                    actualMarketId,
                    pendingBets
                  );


                const sdata =
                  scenarios.map(
                    (s) => ({
                      sid: s.sid,
                      amount: s.pl
                    })
                  );


                await updateSportsData(

                  actualMarketId,

                  userId,

                  {
                    mid: actualMarketId,
                    sdata: sdata,
                    userId: userId
                  },

                  {
                    autoSyncExposure: true
                  }
                );
              }


              updateExp += marketExp;

              updatePartnerExp += marketPartnerExp;
            }
          }


          // =====================================================
          // UPDATE USER BALANCE / EXPOSURE
          // =====================================================

          if (
            balance !== 0 ||
            updateExp !== 0
          ) {

            const {
              atomicUpdateUserFinance
            } = require(
              "../../helpers/finance.helper"
            );


            const getUser =
              await atomicUpdateUserFinance(

                userId,

                {
                  balance: balance,
                  exp: updateExp
                },

                {
                  allowNegativeBuffer: true
                }
              );


            if (!getUser) {

              throw new Error(
                "User not found during Super Over rollback"
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
                exp: updatePartnerExp,
                profit: balance
              }
            );
          }


          // =====================================================
          // ADD UPDATED BETS
          // =====================================================

          updatedBets.push(
            ...currentUserUpdatedBets
          );


          // =====================================================
          // SELF HEAL EXPOSURE
          // =====================================================

          const {
            verifyAndFixUserExposure
          } = require(
            "../../helpers/exposure.helper"
          );


          await verifyAndFixUserExposure(
            userId
          ).catch(
            (e) =>
              console.error(
                "[Self-Heal] Error:",
                e
              )
          );


        } catch (error) {

          console.error(
            "SUPER OVER ROLLBACK ERROR:",
            error
          );

        } finally {

          await releaseLock(
            lockKey,
            lockAcquired
          );
        }
      }


      // =======================================================
      // SUPER OVER RESPONSE
      // =======================================================

      console.log(
        "========================================"
      );

      console.log(
        "SUPER OVER TOTAL UPDATED:",
        updatedBets.length
      );

      console.log(
        "========================================"
      );


      if (updatedBets.length === 0) {

        return res.status(400).json({

          message:
            "Super Over bets were not rolled back",

          data: []

        });
      }


      return res.status(200).json({

        message:
          "Super Over bets rolled back successfully",

        data:
          updatedBets

      });
    }

    // =========================================================
    // =========================================================
    // OLD NORMAL GAME LOGIC
    // =========================================================
    // DO NOT CHANGE
    // =========================================================

    const normalResultCondition = {

      subType: {
        $exists: false
      },

      $or: [

        {
          gType: {
            $in: [
              "match",
              "match1",
              "cricketcasino",
              ...TEENPATTI_RESULT_GTYPES,
              ...JOKER_RESULT_GTYPES
            ]
          }
        },

        {
          gameId: {
            $in: [
              ...TEENPATTI_RESULT_GTYPES,
              ...JOKER_RESULT_GTYPES
            ]
          }
        },

        {
          subType: {
            $in: [
              ...TEENPATTI_RESULT_GTYPES,
              ...JOKER_RESULT_GTYPES
            ]
          }
        },

        {
          eventName:
            /teen\s*patti|teenpatti/i
        },

        {
          marketName:
            /teen\s*patti|teenpatti/i
        },

        {
          eventName:
            /joker/i
        },

        {
          marketName:
            /joker/i
        }

      ]
    };


    const pipeline = [

      {
        $match: {

          gameId,

          marketId,

          status: {
            $in: [
              "lost",
              "won"
            ]
          },

          $or: [
            normalResultCondition
          ],

          isActive:
            true
        }
      },


      {
        $group: {

          _id:
            "$userId",

          bets: {
            $push:
              "$$ROOT"
          }

        }
      },


      {
        $project: {

          userId:
            "$_id",

          _id:
            0,

          markets: {

            $map: {

              input: {
                $setUnion: [
                  "$bets.marketId"
                ]
              },

              as:
                "marketId",

              in: {

                marketId:
                  "$$marketId",

                bets: {

                  $filter: {

                    input:
                      "$bets",

                    as:
                      "bet",

                    cond: {
                      $eq: [
                        "$$bet.marketId",
                        "$$marketId"
                      ]
                    }

                  }

                }

              }

            }

          }

        }

      }

    ];


    const bets =
      await Bet.aggregate(
        pipeline
      );


    if (
      !bets ||
      bets.length === 0
    ) {

      return res.status(200).json({

        message:
          "No bets found to rollback",

        data: []

      });
    }


    const updatedBets = [];


    // =========================================================
    // OLD USER LOOP
    // =========================================================

    for (
      const user of bets
    ) {

      const userIdToLock =
        user.userId ||
        user._id;


      const lockKey =
        `lock:user:${userIdToLock}`;


      let lockAcquired =
        false;

      let retries = 0;


      while (
        !lockAcquired &&
        retries < 10
      ) {

        lockAcquired =
          await acquireLock(
            lockKey,
            5000
          );


        if (
          !lockAcquired
        ) {

          await new Promise(
            (r) =>
              setTimeout(
                r,
                200
              )
          );

          retries++;
        }
      }


      if (
        !lockAcquired
      ) {

        console.error(
          `[matchResultRoleBack] Failed to acquire lock for user ${userIdToLock}`
        );

        continue;
      }


      let updateExp = 0;

      let balance = 0;

      let updatePartnerExp = 0;

      let userUpdatedCount = 0;

      const currentUserUpdatedBets = [];


      const session =
        await mongoose.startSession();


      const runSettlementInternal =
        async (
          sessionParam
        ) => {

          updateExp = 0;

          balance = 0;

          updatePartnerExp = 0;

          userUpdatedCount = 0;

          currentUserUpdatedBets.length = 0;


          const freshQuery =
            Bet.find({

              userId:
                userIdToLock,

              gameId,

              marketId,

              status: {
                $in: [
                  "lost",
                  "won"
                ]
              },

              $or: [
                normalResultCondition
              ],

              isActive:
                true
            });


          const freshUserBets =
            sessionParam
              ? await freshQuery.session(
                  sessionParam
                )
              : await freshQuery;


          if (
            freshUserBets.length === 0
          ) {

            return;
          }


          const marketsMap = {};


          for (
            const bet of freshUserBets
          ) {

            if (
              !marketsMap[
                bet.marketId
              ]
            ) {

              marketsMap[
                bet.marketId
              ] = {

                marketId:
                  bet.marketId,

                bets: []

              };
            }


            marketsMap[
              bet.marketId
            ].bets.push(
              bet
            );
          }


          const freshMarkets =
            Object.values(
              marketsMap
            );


          for (
            const market of freshMarkets
          ) {

            for (
              const bet of market.bets
            ) {

              const balanceReversal =
                -1 *
                (
                  Number(
                    bet.profit
                  ) || 0
                );


              const updated =
                await Bet.findOneAndUpdate(

                  {
                    _id:
                      bet._id,

                    status: {
                      $in: [
                        "lost",
                        "won"
                      ]
                    }
                  },

                  {
                    status:
                      "pending",

                    profit:
                      0,

                    $unset: {
                      winner:
                        "",

                      run:
                        ""
                    }
                  },

                  {
                    session:
                      sessionParam,

                    new:
                      true
                  }
                );


              if (
                updated
              ) {

                currentUserUpdatedBets.push(
                  updated
                );

                userUpdatedCount++;

                balance +=
                  balanceReversal;
              }
            }


            if (
              userUpdatedCount > 0
            ) {

              const queryPending =
                Bet.find({

                  userId:
                    userIdToLock,

                  marketId:
                    market.marketId,

                  status:
                    "pending",

                  isActive:
                    true

                });


              const allPendingInMarket =
                sessionParam
                  ? await queryPending.session(
                      sessionParam
                    )
                  : await queryPending;


              let marketExp = 0;

              let marketPartnerExp = 0;


              if (
                allPendingInMarket.length > 0
              ) {

                const {
                  calculateMatchPLs,
                  calculateMarketExposure,
                  calculateInvertedMarketExposure
                } = require(
                  "../../helpers/exposure.helper"
                );


                const sample =
                  allPendingInMarket[0];


                let runners = [];


                if (
                  sample.sections &&
                  sample.sections.length > 0
                ) {

                  runners =
                    sample.sections.map(
                      (s) => ({
                        sid:
                          s.sid
                      })
                    );
                }


                const scenarios =
                  calculateMatchPLs(
                    allPendingInMarket,
                    runners
                  );


                marketExp =
                  calculateMarketExposure(
                    market.marketId,
                    allPendingInMarket
                  );


                marketPartnerExp =
                  calculateInvertedMarketExposure(
                    market.marketId,
                    allPendingInMarket
                  );


                const sdata =
                  scenarios.map(
                    (s) => ({
                      sid:
                        s.sid,

                      amount:
                        s.pl
                    })
                  );


                await updateSportsData(

                  market.marketId,

                  userIdToLock,

                  {
                    mid:
                      market.marketId,

                    sdata,

                    userId:
                      userIdToLock
                  },

                  {
                    autoSyncExposure:
                      true,

                    session:
                      sessionParam
                  }
                );
              }


              updateExp +=
                marketExp;

              updatePartnerExp +=
                marketPartnerExp;
            }
          }


          if (
            balance !== 0 ||
            updateExp !== 0
          ) {

            const {
              atomicUpdateUserFinance
            } = require(
              "../../helpers/finance.helper"
            );


            const getUser =
              await atomicUpdateUserFinance(

                userIdToLock,

                {
                  balance,

                  exp:
                    updateExp
                },

                {
                  session:
                    sessionParam,

                  allowNegativeBuffer:
                    true
                }
              );


            if (
              !getUser
            ) {

              throw new Error(
                "User not found during match result rollback"
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
                  updatePartnerExp,

                profit:
                  balance
              },

              {
                session:
                  sessionParam
              }
            );
          }
        };


      try {

        await session.withTransaction(
          async () => {

            await runSettlementInternal(
              session
            );
          }
        );


        updatedBets.push(
          ...currentUserUpdatedBets
        );


      } catch (err) {

        if (
          err.message &&
          (
            err.message.includes(
              "sessions are not supported"
            ) ||
            err.code === 20
          )
        ) {

          await runSettlementInternal(
            null
          );


          updatedBets.push(
            ...currentUserUpdatedBets
          );

        } else {

          console.error(
            `Error processing user ${userIdToLock} for match rollback:`,
            err
          );
        }

      } finally {

        await session.endSession();


        await releaseLock(
          lockKey,
          lockAcquired
        );


        const {
          verifyAndFixUserExposure
        } = require(
          "../../helpers/exposure.helper"
        );


        await verifyAndFixUserExposure(
          userIdToLock
        ).catch(
          (e) =>
            console.error(
              `[Self-Heal] Error:`,
              e
            )
        );
      }
    }


    if (
      updatedBets.length === 0
    ) {

      return res.status(400).json({

        message:
          "No bets were rolled back",

        data: []

      });
    }


    return res.status(200).json({

      message:
        "Bets updated successfully",

      data:
        updatedBets

    });

  } catch (err) {

    console.error(
      "matchResultRoleBack ERROR:",
      err
    );

    next(err);
  }
};

const retroactiveRegisterGame = async (req, res, next) => {
  try {
    const { gameId } = req.body;
    if (!gameId) throw new APIError("gameId is required", httpStatus.BAD_REQUEST);

    const { registerFancyIfNeeded, registerMatchIfNeeded } = require("../../helpers/thirdPartyResult.service");

    const pendingBets = await Bet.find({
      gameId,
      status: "pending",
      isActive: true,
    }).lean();

    if (!pendingBets.length) {
      return res.status(200).json({ message: "No pending bets found for this gameId", registered: 0 });
    }

    let fancyCount = 0;
    let matchCount = 0;
    const errors = [];

    for (const bet of pendingBets) {
      try {
        const betGType = bet.gType;
        const betMarketName = (bet.marketName || "").toUpperCase();
        const betEtid = Number(bet.etid);
        const isCricket = betEtid === 4;

        if (["fancy", "meter", "fancy1", "oddeven", "khado"].includes(betGType)) {
          if (isCricket) {
            await registerFancyIfNeeded(bet.marketId, bet.sectionId, bet.gameId, betEtid, bet.sectionName);
            fancyCount++;
          }
        } else if (betGType === "match" && betMarketName === "MATCH_ODDS") {
          await registerMatchIfNeeded(bet.gameId, betEtid);
          matchCount++;
        } else if (betGType === "match") {
          if (isCricket) {
            await registerFancyIfNeeded(bet.marketId, bet.sectionId, bet.gameId, betEtid, bet.sectionName);
            fancyCount++;
          }
        } else if (betGType === "match1") {
          await registerMatchIfNeeded(bet.gameId, betEtid);
          matchCount++;
        }
      } catch (betErr) {
        errors.push({ betId: bet._id, error: betErr.message });
      }
    }

    console.log(`[3P-Result] Retroactive registration: gameId=${gameId}, fancy=${fancyCount}, match=${matchCount}, errors=${errors.length}`);

    return res.status(200).json({
      message: "Retroactive registration complete",
      gameId,
      totalBets: pendingBets.length,
      fancyRegistered: fancyCount,
      matchRegistered: matchCount,
      errors,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  settleBet,
  declareFancyResult,
  cancelFancyResult,
  fancyResultRoleBack,
  declareMatchResult,
  matchResultRoleBack,
  retroactiveRegisterGame,
};
