/**
 * betSettlement.internal.js
 *
 * Internal (non-HTTP) versions of fancy and match result declaration.
 * Used by the third-party result cron job to auto-declare results.
 * Also used internally by the route handlers for deduplication.
 *
 * KEY DESIGN PRINCIPLE — Idempotency / No Double Declaration:
 *   All bet updates use: Bet.findOneAndUpdate({ _id, status: "pending" }, ...)
 *   This means if a bet is already settled (won/lost/cancelled) by either:
 *   - Admin manually declaring via the route
 *   - The cron auto-declaring
 *   ...the other will simply get null back and skip it. No double settlement possible.
 */

const { Bet } = require("../apis/bet/bet.helper");
const { getSportsData, updateSportsData } = require("../apis/sports-data/sports-data.helper");
const { setCache } = require("./cache");
const { distributeCommissionHierarchy,distributeBettingCommissionHierarchy, atomicUpdateUserBalanceExp } = require("./utils");
const { acquireLock, releaseLock } = require("./lock.helper");
const { verifyAndFixUserExposure } = require("./exposure.helper");
const Users = require("../apis/users/users.model");

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
const isTeenpattiEventBet = (bet) =>
  /teen\s*patti|teenpatti/i.test(bet?.eventName || bet?.marketName || "");
const isJokerEventBet = (bet) =>
  /joker/i.test(bet?.eventName || bet?.marketName || "");
const isTeenpattiResultBet = (bet) => {
  const keys = getBetTypeKeys(bet);
  return (
    keys.some((key) => TEENPATTI_RESULT_GTYPES.includes(key)) ||
    isTeenpattiEventBet(bet)
  );
};
const isJokerResultBet = (bet) => {
  const keys = getBetTypeKeys(bet);
  return (
    keys.some((key) => JOKER_RESULT_GTYPES.includes(key) || key.includes("joker")) ||
    isJokerEventBet(bet)
  );
};
const getTeenJokerResultProfitLoss = (bet, status, fallback) => {
  if (!["won", "lost"].includes(status)) return fallback;
  if (!isTeenpattiResultBet(bet) && !isJokerResultBet(bet)) return fallback;

  const amount = Number(bet?.amount || 0);
  if (status === "lost") return -amount;
  return Number((((Number(bet?.uRate || 0) || 0) - 1) * amount).toFixed(2));
};

/**
 * Parse the result string from third-party API into a numeric run value.
 *
 * "171"    → 171   (numeric result for fancy/meter/khado)
 * "yes"    → 1     (fancy1 YES / oddeven ODD wins via back)
 * "no"     → 0     (fancy1 NO  / oddeven ODD  wins via lay)
 * "even"   → 1     (oddeven: back=even wins  → run=1)
 * "odd"    → 0     (oddeven: lay=odd  wins   → run=0)
 * "cancel" → -1    (cancelled — caller should settle as 'cancelled')
 * "-"      → null  (not yet declared — skip)
 *
 * @param {string} resultStr
 * @returns {number|null}
 */
function parseThirdPartyFancyResult(resultStr) {
  if (!resultStr || resultStr === "-") return null;
  const lower = resultStr.toString().toLowerCase().trim();
  if (lower === "yes")    return 1;
  if (lower === "no")     return 0;
  if (lower === "odd") return 1; // back = odd side wins
  if (lower === "even") return 0; // lay = even side wins
  if (
    lower === "cancel" ||
    lower === "no result"
  ) {
    return -1;
  }  // cancelled fancy
  const num = parseInt(lower, 10);
  return isNaN(num) ? null : num;
}

/**
 * Parse winner from match result.
 * The third-party API returns the winning team name as the result field.
 * e.g. "India", "West Indies"
 * We need to match it against sectionName on bets (case-insensitive).
 *
 * @param {string} resultStr
 * @returns {string|null}
 */
function parseThirdPartyMatchWinner(resultStr) {
  if (!resultStr || resultStr === "-") return null;
  return resultStr.trim();
}

/**
 * Internal fancy result declaration.
 * Matches the exact same logic as declareFancyResult route handler,
 * but operates without req/res — callable from cron jobs.
 *
 * @param {string} gameId
 * @param {number} marketId
 * @param {number} sectionId
 * @param {number} run - numeric run value (1=yes, 0=no for fancy1/oddeven)
 * @returns {Promise<{updatedCount: number, updatedBets: Array}>}
 */
async function declareFancyResultInternal(gameId, marketId, sectionId, run) {
  const updatedBets = [];

  // Group pending bets by user (same as route handler)
  const pipeline = [
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

  if (!bets || !bets.length) {
    return { updatedCount: 0, updatedBets: [] };
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
        `[3P-Cron] Failed to acquire lock for user ${user._id} during fancy result declaration`
      );
      continue;
    }

    try {
      // Re-fetch inside lock to avoid race conditions
      const freshUserBets = await Bet.find({
        userId: user._id,
        gameId,
        marketId,
        sectionId,
        isActive: true,
        status: "pending",
      });

      if (freshUserBets.length === 0) continue;

      let updateExp = 0;
      let updatePartnerExp = 0;
      let balance = 0;
      let userUpdatedCount = 0;

      // Get the user's current balance before settling these bets
      const userDoc = await Users.findById(user._id).select("balance").lean();

      if (!userDoc) {
        console.warn("[3P-Cron] User not found:", user._id);
        continue;
      }

      let runningBalance = Number(userDoc.balance || 0);

      const currentUserUpdatedBets = [];

      const findSpotsData = await getSportsData({
        mid: marketId,
        userId: user._id,
      });

      for (const bet of freshUserBets) {
        let isWin = false;
        let profitLoss = 0;
        let profit = Number(((bet.amount * bet.size) / 100).toFixed(2));
        let loss = bet.amount;

        if (["fancy", "meter"].includes(bet.gType)) {
          if (bet.betType === "lay") {
            isWin = run < bet.uRate;
            profitLoss = isWin ? loss : -profit;
          } else {
            isWin = run >= bet.uRate;
            profitLoss = isWin ? profit : -loss;
          }
        } else if (bet.gType === "fancy1") {
          profit = Number((parseFloat(bet.uRate - 1) * bet.amount).toFixed(2));
          loss = bet.amount;
          if (bet.betType === "lay") {
            isWin = run === 0;
            profitLoss = isWin ? loss : -profit;
          } else {
            isWin = run === 1;
            profitLoss = isWin ? profit : -loss;
          }
        } else if (bet.gType === "oddeven") {
          const oddEvenResult = run % 2 === 0 ? 0 : 1;
          profit = Number((parseFloat(bet.uRate - 1) * bet.amount).toFixed(2));
          loss = bet.amount;
          if (bet.betType === "lay") {
            isWin = oddEvenResult === 0;
            profitLoss = isWin ? loss : -profit;
          } else {
            isWin = oddEvenResult === 1;
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
        } else if (bet.gType === "cricketcasino" || isTeenpattiResultBet(bet) || isJokerResultBet(bet)) {
          profit = Number((parseFloat(bet.uRate - 1) * bet.amount).toFixed(2));
          loss = bet.amount;
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

        const prevBal = Number(runningBalance.toFixed(2));
        const currBal = Number((prevBal + profitLoss).toFixed(2));

        // ATOMIC — if another process (manual admin or another cron tick) already settled this,
        // findOneAndUpdate returns null and we skip. No double settlement.
        const updated = await Bet.findOneAndUpdate(
          { _id: bet._id, status: "pending" },
          {
            status: updatedStatus,
            profit: profitLoss,
            run: run,
            prevBal,
            currBal,
          },
          { new: true }
        );

        console.log("[Settlement fancy] Atomic update", {
            betId: bet._id,
            updated: !!updated,
            previousStatus: bet.status,
            newStatus: updatedStatus,
        });

        if (updated) {
          runningBalance = currBal;
          updatedBets.push(updated);
          balance += profitLoss;
          userUpdatedCount++;
          currentUserUpdatedBets.push(updated);
        }
      }

      if (userUpdatedCount > 0) {
        const spotsData = findSpotsData?.sdata || [];
        const idx = spotsData.findIndex((exp) => exp?.sid === sectionId);

        if (idx > -1) {
          const checkExp = spotsData[idx];
          const currentMarketLiability = Math.min(0, checkExp.amount ?? 0);
          const maxMinusAmt = currentMarketLiability * -1;
          updateExp += maxMinusAmt;

          const maxExpValue = Math.max(
            0,
            ...checkExp.calcTable.map((r) => r.profitLoss).filter((v) => v > 0)
          );
          updatePartnerExp += maxExpValue;

          spotsData.splice(idx, 1);
          // [PATCH] Added autoSyncExposure: true to trigger Universal Exposure Anchor
          await updateSportsData(marketId, user._id, {
            mid: marketId,
            sdata: spotsData,
            userId: user._id,
          }, { autoSyncExposure: true });
        }

        if (userUpdatedCount > 0) {
          try {
            const getUser = await atomicUpdateUserBalanceExp(
              user._id,
              balance,
              updateExp
            );
            if (!getUser) {
              console.warn("[3P-Cron] User not found:", user._id);
            } else {
              const cacheKey = `user:${getUser._id}`;
              await setCache(cacheKey, getUser, 60);
              await distributeCommissionHierarchy(getUser, {
                exp: updatePartnerExp,
                profit: balance,
              });

              if (currentUserUpdatedBets.length > 0) {
                await distributeBettingCommissionHierarchy(
                  getUser,
                  {
                    gameId,
                    marketId,
                    bets: currentUserUpdatedBets,
                  }
                );
              }
            }
          } catch (err) {
            console.error(
              `[3P-Cron] Error updating balance/exp for userId:${user._id}`,
              err
            );
          }
        }
      }
    } finally {
      await releaseLock(lockKey, lockAcquired);
      // Universal anchor handles self-healing automatically via updateSportsData above
    }
  }
  console.log("[Settlement Finished fancy]", {
    updatedCount: updatedBets.length,
  });
  return { updatedCount: updatedBets.length, updatedBets };
}

/**
 * Internal match result declaration.
 * Matches the exact same logic as declareMatchResult route handler,
 * but operates without req/res — callable from cron jobs.
 *
 * @param {string} gameId
 * @param {number} marketId
 * @param {string} winner - team name or "cancel"
 * @returns {Promise<{updatedCount: number, updatedBets: Array}>}
 */
async function declareMatchResultInternal(gameId, marketId, winner) {
  const updatedBets = [];

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
  ];

  const bets = await Bet.aggregate(pipeline);

  if (!bets || !bets.length) {
    return { updatedCount: 0, updatedBets: [] };
  }

  for (const user of bets) {
    const userIdToLock = user._id;
    const lockKey = `lock:user:${userIdToLock}`;
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
        `[3P-Cron] Failed to acquire lock for user ${userIdToLock} during match result declaration`
      );
      continue;
    }

    try {
      const freshUserBets = await Bet.find({
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

      if (freshUserBets.length === 0) continue;

      const marketsMap = {};
      for (const bet of freshUserBets) {
        if (!marketsMap[bet.marketId])
          marketsMap[bet.marketId] = { marketId: bet.marketId, bets: [] };
        marketsMap[bet.marketId].bets.push(bet);
      }
      const freshMarkets = Object.values(marketsMap);

      let updateExp = 0;
      let balance = 0;
      let updatePartnerExp = 0;
      let userUpdatedCount = 0;


      // Get the user's current balance before settling these bets
      const userDoc = await Users.findById(userIdToLock)
        .select("balance")
        .lean();

      if (!userDoc) {
        console.warn("[3P-Cron] User not found:", userIdToLock);
        continue;
      }

      let runningBalance = Number(userDoc.balance || 0);

      const settledMarkets = [];

      for (const market of freshMarkets) {
        const settledMarketBets = [];
        const findSpotsData = await getSportsData({
          mid: market.marketId,
          userId: userIdToLock,
        });

        const normalizeName = (name) => {
          if (!name) return "";
          return name
            .toString()
            .toLowerCase()
            .replace(/\bmain\b/g, "")
            .trim()
            .replace(/\.+$/, "")
            .replace(/\s+/g, " ");
        };

        for (const bet of market.bets) {
          let profitLoss = 0;
          let profit = Number(
            ((parseFloat(bet.uRate) - 1) * bet.amount).toFixed(2)
          );
          let loss = bet.amount;

          const winnerTeam = normalizeName(winner);
          const section = normalizeName(bet.sectionName);
          let isWin = false;

          if (winner !== "cancel") {
            if (isTeenpattiResultBet(bet) || isJokerResultBet(bet)) {
              const selectedWon = winnerTeam === section;
              isWin = bet.betType === "lay" ? !selectedWon : selectedWon;
              profitLoss = isWin ? profit : -loss;
            } else if (["match"].includes(bet.gType)) {
              if (
                bet.marketName === "TIED_MATCH" ||
                bet.marketName?.toUpperCase() === "TIED MATCH"
              ) {
                // if (section === "yes") {
                //   if (bet.betType === "lay") {
                //     isWin = winnerTeam !== "tie";
                //     profitLoss = isWin ? loss : -profit;
                //   } else {
                //     isWin = winnerTeam === "tie";
                //     profitLoss = isWin ? profit : -loss;
                //   }
                // } else {
                //   if (bet.betType === "lay") {
                //     isWin = winnerTeam === "tie";
                //     profitLoss = isWin ? loss : -profit;
                //   } else {
                //     isWin = winnerTeam !== "tie";
                //     profitLoss = isWin ? profit : -loss;
                //   }
                // }
                
                    ///cheanges for tie


                  if (section === "yes") {
                    if (bet.betType === "lay") {
                      // Lay YES wins when result is NO
                      isWin = winnerTeam === "no";
                      profitLoss = isWin ? loss : -profit;
                    } else {
                      isWin = winnerTeam === "yes";
                      profitLoss = isWin ? profit : -loss;
                    }
                  } else {
                    if (bet.betType === "lay") {
                      // Lay NO wins when result is YES
                      isWin = winnerTeam === "yes";
                      profitLoss = isWin ? loss : -profit;
                    } else {
                      isWin = winnerTeam === "no";
                      profitLoss = isWin ? profit : -loss;
                    }
                  }

              }  else {
                const isTopFinishMarket =
                    /TOP\s*[23]\s*FINISH/i.test(bet.marketName || "");

                if (
                    winnerTeam === "tie" &&
                    bet.marketName?.toUpperCase() !== "TIED MATCH" &&
                    bet.marketName !== "TIED_MATCH"
                ) {
                    isWin = false;
                    profitLoss = 0;
                } else if (isTopFinishMarket) {

                    // TOP 2 / TOP 3:
                    // winner contains multiple horses separated by comma.
                    const finishingHorses = winnerTeam
                        .split(",")
                        .map((name) => normalizeName(name))
                        .filter(Boolean);

                    const selectedFinished = finishingHorses.includes(section);

                    if (bet.betType === "lay") {
                        // Lay wins when selected horse is NOT in Top N
                        isWin = !selectedFinished;
                        profitLoss = isWin ? loss : -profit;
                    } else {
                        // Back wins when selected horse IS in Top N
                        isWin = selectedFinished;
                        profitLoss = isWin ? profit : -loss;
                    }

                } else {
                    // Normal MATCH_ODDS logic
                    if (bet.betType === "lay") {
                        isWin = winnerTeam !== section;
                        profitLoss = isWin ? loss : -profit;
                    } else {
                        isWin = winnerTeam === section;
                        profitLoss = isWin ? profit : -loss;
                    }
                }
                // if (
                //     winnerTeam === "tie" &&
                //     bet.marketName?.toUpperCase() !== "TIED MATCH" &&
                //     bet.marketName !== "TIED_MATCH"
                // ) {
                //     isWin = false;
                //     profitLoss = 0;
                // } else {
                //     if (bet.betType === "lay") {
                //         isWin = winnerTeam !== section;
                //         profitLoss = isWin ? loss : -profit;
                //     } else {
                //         isWin = winnerTeam === section;
                //         profitLoss = isWin ? profit : -loss;
                //     }
                // }
              }
            } else if (["match1"].includes(bet.gType)) {
              profit = Number(
                ((bet.amount * parseFloat(bet.uRate)) / 100).toFixed(2)
              );

              if (
                  winnerTeam === "tie" &&
                  bet.marketName?.toUpperCase() !== "TIED MATCH" &&
                  bet.marketName !== "TIED_MATCH"
              ) {
                  profitLoss = 0;
              } else {
                if (
                  bet.marketName === "TIED_MATCH" ||
                  bet.marketName?.toUpperCase() === "TIED MATCH"
                ) {
                  // if (section === "yes") {
                  //   if (bet.betType === "lay") {
                  //     isWin = winnerTeam !== "tie";
                  //     profitLoss = isWin ? loss : -profit;
                  //   } else {
                  //     isWin = winnerTeam === "tie";
                  //     profitLoss = isWin ? profit : -loss;
                  //   }
                  // } else {
                  //   if (bet.betType === "lay") {
                  //     isWin = winnerTeam === "tie";
                  //     profitLoss = isWin ? loss : -profit;
                  //   } else {
                  //     isWin = winnerTeam !== "tie";
                  //     profitLoss = isWin ? profit : -loss;
                  //   }
                  // } 

                    ///cheanges for tie
                  
                    if (section === "yes") {
                      if (bet.betType === "lay") {
                        // Lay YES wins when result is NO
                        isWin = winnerTeam === "no";
                        profitLoss = isWin ? loss : -profit;
                      } else {
                        isWin = winnerTeam === "yes";
                        profitLoss = isWin ? profit : -loss;
                      }
                    } else {
                      if (bet.betType === "lay") {
                        // Lay NO wins when result is YES
                        isWin = winnerTeam === "yes";
                        profitLoss = isWin ? loss : -profit;
                      } else {
                        isWin = winnerTeam === "no";
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

              
            }else if(["cricketcasino"].includes(bet.gType)){
                if (bet.betType === "back") {
                    isWin = section === winnerTeam;
                    profitLoss = isWin ? profit : -loss;
                } else {
                    isWin = section !== winnerTeam;
                    profitLoss = isWin ? loss : -profit;
                }
            }
          }

          const isTieCancelled =
            ["match", "match1"].includes(bet.gType) &&
            winnerTeam === "tie" &&
            bet.marketName?.toUpperCase() !== "TIED MATCH" &&
            bet.marketName !== "TIED_MATCH";

          const updatedStatus =
            winner === "cancel" || isTieCancelled
                ? "cancelled"
                : isWin
                ? "won"
                : "lost";
          profitLoss = getTeenJokerResultProfitLoss(bet, updatedStatus, profitLoss);

          // ATOMIC — prevents double settlement if admin already declared manually
          const prevBal = Number(runningBalance.toFixed(2));
const     currBal = Number((prevBal + profitLoss).toFixed(2));
          const updated = await Bet.findOneAndUpdate(
            { _id: bet._id, status: "pending" },
            {
              status: updatedStatus,
              profit: profitLoss,
              winner: winner,
              prevBal,
              currBal,
            },
            { new: true }
          );

          console.log("[Settlement Match] Atomic update", {
              betId: bet._id,
              updated: !!updated,
              previousStatus: bet.status,
              newStatus: updatedStatus,
          });

          if (updated) {
            runningBalance = currBal;
            balance += profitLoss;
            updatedBets.push(updated);
            
            if (String(updated.etid) === "4") {
              settledMarketBets.push(updated);
            }

            userUpdatedCount++;
          }
        }

        if (settledMarketBets.length > 0) {
          settledMarkets.push({
            marketId: market.marketId,
            bets: settledMarketBets,
          });
        }

        if (userUpdatedCount > 0) {
          const spotsData = findSpotsData?.sdata || [];
          const currentMarketLiability = Math.min(
            0,
            ...spotsData.map((s) => s.amount)
          );
          const maxMinusAmt = currentMarketLiability * -1;
          updateExp += maxMinusAmt;

          const maxExpValue = Math.max(0, ...spotsData.map((s) => s.amount));
          updatePartnerExp += maxExpValue;

          // [PATCH] Clear SportsData and trigger Anchor Sync
          await updateSportsData(market.marketId, userIdToLock, {
            mid: market.marketId,
            sdata: [],
            userId: userIdToLock,
          }, { autoSyncExposure: true });
        }
      }

      if (userUpdatedCount > 0) {
        try {
          const getUser = await atomicUpdateUserBalanceExp(
            userIdToLock,
            balance,
            updateExp
          );
          if (!getUser) {
            console.warn("[3P-Cron] User not found:", userIdToLock);
          } else {
            const cacheKey = `user:${getUser._id}`;
            await setCache(cacheKey, getUser, 60);
            await distributeCommissionHierarchy(getUser, {
              exp: updatePartnerExp,
              profit: balance,
            });

            for (const market of settledMarkets) {
              await distributeBettingCommissionHierarchy(
                getUser,
                {
                  gameId,
                  marketId: market.marketId,
                  bets: market.bets,
                }
              );
            }
          }
        } catch (err) {
          console.error(
            `[3P-Cron] Error updating balance/exp for userId:${userIdToLock}`,
            err
          );
        }
      }
    } finally {
      await releaseLock(lockKey, lockAcquired);
      // verifyAndFixUserExposure call was here, but anchor sync now happens inside updateSportsData
    }
  }
  console.log("[Settlement Finished match]", {
      updatedCount: updatedBets.length,
  });

  return { updatedCount: updatedBets.length, updatedBets };
}

/**
 * Internal fancy cancel declaration.
 * Matches the exact same logic as cancelFancyResult route handler,
 * but operates without req/res — callable from cron jobs.
 *
 * @param {string} gameId
 * @param {number} marketId
 * @param {number} sectionId
 * @returns {Promise<{updatedCount: number, updatedBets: Array}>}
 */
async function cancelFancyResultInternal(gameId, marketId, sectionId) {
  const updatedBets = [];

  const pipeline = [
    {
      $match: {
        gameId,
        marketId,
        sectionId,
        isActive: true,
        status: { $in: ["won", "lost", "pending"] }, // Cancels both pending and incorrectly settled
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
    return { updatedCount: 0, updatedBets: [] };
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
        `[3P-Cron] Failed to acquire lock for user ${user._id} during fancy cancellation`
      );
      continue;
    }

    try {
      // Re-fetch inside lock
      const freshUserBets = await Bet.find({
        userId: user._id,
        gameId,
        marketId,
        sectionId,
        isActive: true,
        status: { $in: ["won", "lost", "pending"] },
      });

      if (freshUserBets.length === 0) continue;

      let updateExp = 0;
      let updatePartnerExp = 0;
      let userUpdatedCount = 0;
      let totalBalanceAdjustment = 0;

      const userDoc = await Users.findById(user._id)
        .select("balance")
        .lean();

      if (!userDoc) {
        console.warn("[3P-Cron] User not found during cancel:", user._id);
        continue;
      }

      let runningBalance = Number(userDoc.balance || 0);

      const findSpotsData = await getSportsData({
        mid: marketId,
        userId: user._id,
      });

      for (const bet of freshUserBets) {
        let balanceAdjustment = 0;
        // If bet was already settled (won/lost) accidentally, reverse the P/L
        if (["won", "lost"].includes(bet.status)) {
          balanceAdjustment = -1 * (Number(bet.profit) || 0);
        }

        const prevBal = Number(runningBalance.toFixed(2));
        const currBal = Number(
          (prevBal + balanceAdjustment).toFixed(2)
        );

        const updated = await Bet.findOneAndUpdate(
          { _id: bet._id, status: { $in: ["won", "lost", "pending"] } },
          {
            profit: 0,
            status: "cancelled",
            prevBal,
            currBal,
          },
          { new: true }
        );

        if (updated) {
          runningBalance = currBal;
          updatedBets.push(updated);
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

          // [PATCH] Added autoSyncExposure: true to trigger Universal Exposure Anchor
          await updateSportsData(marketId, user._id, {
            mid: marketId,
            sdata: spotsData,
            userId: user._id,
          }, { autoSyncExposure: true });
        }

        if (updateExp !== 0 || totalBalanceAdjustment !== 0) {
          try {
            const getUser = await atomicUpdateUserBalanceExp(
              user._id,
              totalBalanceAdjustment,
              updateExp
            );
            if (!getUser) {
              console.warn("[3P-Cron] User not found during cancel:", user._id);
            } else {
              const cacheKey = `user:${getUser._id}`;
              await setCache(cacheKey, getUser, 60);
              await distributeCommissionHierarchy(getUser, {
                exp: updatePartnerExp,
              });
            }
          } catch (err) {
            console.error(
              `[3P-Cron] Error updating balance/exp for userId:${user._id} during cancel`,
              err
            );
          }
        }
      }
    } finally {
      await releaseLock(lockKey, lockAcquired);
    }
  }

  return { updatedCount: updatedBets.length, updatedBets };
}

module.exports = {
  declareFancyResultInternal,
  cancelFancyResultInternal,
  declareMatchResultInternal,
  parseThirdPartyFancyResult,
  parseThirdPartyMatchWinner,
};
