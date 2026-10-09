const httpStatus = require("http-status");
const APIError = require("../../helpers/APIError");
const axios = require("axios");
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
  generateUniqueMarketId,
} = require("./bet.helper");
const { getUserById, getUser, getAllUsers } = require("../users/users.helper");
const mongoose = require("mongoose");
const {
  updateSportsData,
  getSportsData,
  getAllSportsData,
  getSportsDataById,
  SportsData
} = require("../sports-data/sports-data.helper");
const { setCache, delCacheByPattern, delCache } = require("../../helpers/cache");
const { getButtonSettings } = require("../settings/settings.helper");
const {
  apiRequest,
  filterBetsByDate,
  distributeCommissionHierarchy,
  getUserCommissionHierarchyFast,
} = require("../../helpers/utils");
const betModel = require("./bet.model");
const { recalculateUserDirectExposure,updateUserExposureSecure } = require("../../helpers/exposure.helper");
const User = require("../users/users.model");
const moment = require("moment/moment");
const {
  findPartnershipByUserAndPartner,
} = require("../partnership/partnership.helper");
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
const SectionBetRestriction = require("../section-restriction/sectionBetRestriction.model");
const SettingMarket = require("../settings/settingMarkets.model");
const Settings = require("../settings/settings.model");

const CASINO_GTYPES = [
  "lucky5", "lucky7", "lucky7eu", "lucky7eu2", "aaa", "ab", "dt", "poker", "poker6", "poker20", "teen20", "teen", "teen9", "teen8", "card32eu", "32cards", "7updown", "amar", "akbar", "anthony", "max", "min", "worli", "bollywood",
  "3cardj", "aaa2", "ab20", "ab3", "ab4", "abj", "baccarat", "baccarat2", "btable", "btable2", "card32", "dolidana", "dt20", "dt202", "dt6", "dtl20", "dum10", "goal", "goal2", "joker1", "joker120", "joker20", "lottcard", "lucky15", "patti2",
  "pbaccarat", "pcard32", "pdt20", "pdt6", "plucky7", "poison", "poison20", "pteen20", "queen", "race17", "race2", "race20", "roulette11", "roulette12", "roulette13", "sicbo", "sicbo2", "tdt20", "teen1", "teen120", "teen20b",
  "teen20c", "teen3", "teen32", "teen33", "teen41", "teen42", "teen6", "teen62", "teenmuf", "teensin", "teenunique", "trap", "trio", "war", "worli2", "worli3", "ourroullete", "cricketv3", "superover", "superover2", "superover3", "notenum", "kbc", "kbc2"
];
//server


const rebuildSportsDataForBet = async ({
  bet,
  currentSportsData,
  table,
  section,
  gameType,
  odds,
  userId,
}) => {
  const existingMap = {};

  currentSportsData?.sdata?.forEach((s) => {
    existingMap[s.sid] = s.amount;
  });

  let spotsData = [];
  let expBal = 0;
  let partnerExpBal = 0;

  let lRate = 0;
  let bRate = 0;
  let lsize = 0;
  let bsize = 0;

  // placeBet handlers expect req.body
  const req = {
    body: {
      ...bet,
    },
  };

  // ==========================================
  // MATCH / BOOKMAKER
  // ==========================================

  if (
    ["match1", "match"].includes(bet?.gType) &&
    !["mogambo", "cricketcasino"].includes(bet?.gType)
  ) {
    const result = handleMatchBet(
      req,
      currentSportsData,
      expBal,
      partnerExpBal,
      table,
      gameType,
      odds,
      existingMap
    );

    spotsData = result.spotsData;

    expBal = Number(Number(result.expBal).toFixed(3));
    partnerExpBal = Number(Number(result.partnerExpBal).toFixed(3));
  }

  // ==========================================
  // FANCY
  // ==========================================

  else if (
    ["fancy", "meter", "khado", "mogambo", "cricketcasino"].includes(
      bet?.gType
    )
  ) {
    const result = await handleFancyBet(
      req,
      currentSportsData,
      expBal,
      partnerExpBal,
      userId,
      section,
      odds,
      getBets
    );

    spotsData = result.spotsData;

    // ==========================================
    // CRICKET CASINO NUMBER P/L
    // Same logic as placeBet
    // ==========================================

    if (bet?.gType === "cricketcasino") {
      const stake = Number(bet?.amount || 0);

      const currentOdds = Number(
        odds?.odds ||
        bet?.uRate ||
        bet?.oRate ||
        0
      );

      const selectedNumber = String(
        bet?.sectionName ||
        bet?.nat ||
        ""
      ).match(/\d+/)?.[0];

      const previousMap = {};

      (currentSportsData?.sdata || []).forEach((item) => {
        previousMap[String(item.sid)] =
          Number(item.amount || 0);
      });

      spotsData = (table?.section || []).map((item) => {
        const sid = String(item?.sid);

        const itemNumber = String(
          item?.nat ||
          item?.sectionName ||
          item?.name ||
          ""
        ).match(/\d+/)?.[0];

        const previousAmount =
          Number(previousMap[sid] || 0);

        let newAmount = previousAmount;

        if (String(itemNumber) === String(selectedNumber)) {
          newAmount += (currentOdds - 1) * stake;
        } else {
          newAmount -= stake;
        }

        return {
          sid: item.sid,
          amount: Number(newAmount.toFixed(2)),
          calcTable: [],
        };
      });
    }

    expBal = Number(Number(result.expBal).toFixed(3));
    partnerExpBal = Number(Number(result.partnerExpBal).toFixed(3));

    lRate = result.lRate;
    bRate = result.bRate;
    lsize = result.lsize;
    bsize = result.bsize;
  }

  // ==========================================
  // CASINO
  // ==========================================

  else if (CASINO_GTYPES.includes(bet?.gType)) {
    const result = handleCasinoFancyBet(
      req,
      currentSportsData,
      expBal,
      partnerExpBal,
      odds,
      null
    );

    spotsData = result.spotsData;

    expBal = Number(Number(result.expBal).toFixed(3));
    partnerExpBal = Number(Number(result.partnerExpBal).toFixed(3));
  }

  // ==========================================
  // FANCY 1
  // ==========================================

  else if (bet?.gType === "fancy1") {
    const result = await handleFancy1Bet(
      req,
      currentSportsData,
      expBal,
      partnerExpBal,
      userId,
      section,
      odds,
      getBets
    );

    spotsData = result.spotsData;

    expBal = Number(Number(result.expBal).toFixed(3));
    partnerExpBal = Number(Number(result.partnerExpBal).toFixed(3));

    lRate = result.lRate;
    bRate = result.bRate;
    lsize = result.lsize;
    bsize = result.bsize;
  }

  // ==========================================
  // ODD EVEN
  // ==========================================

  else if (bet?.gType === "oddeven") {
    const result = await handleOddEvenBet(
      req,
      currentSportsData,
      expBal,
      partnerExpBal,
      userId,
      odds,
      getBets
    );

    spotsData = result.spotsData;

    expBal = Number(Number(result.expBal).toFixed(3));
    partnerExpBal = Number(Number(result.partnerExpBal).toFixed(3));
  }

  return {
    spotsData,
    expBal,
    partnerExpBal,
    lRate,
    bRate,
    lsize,
    bsize,
  };
};





const placeBet = async (req, res, next) => {
   console.log("Request Body:", JSON.stringify(req.body, null, 2)); 
  const isOwnerEntry = false; // FEATURE DEACTIVATED: Admin-entry bypass is disabled.
  const id = req?.user?._id; // Always use the logged-in user ID

  const requestStart = Date.now();
  const profile = {};

  const startStep = (name) => {
    profile[name] = Date.now();
  };

  const endStep = (name) => {
    if (!profile[name]) return;

    const stepTime = Date.now() - profile[name];
    const totalTime = Date.now() - requestStart;

    console.log(
      `[BET PROFILE] ${name.padEnd(35)} Step: ${stepTime}ms | Total: ${totalTime}ms`
    );

    delete profile[name];
  };

  const profileLog = (msg) => {
    console.log(
      `[BET PROFILE] ${msg} | Total: ${Date.now() - requestStart}ms`
    );
  };

  const profileEnd = () => {
    console.log("==========================================================");
    console.log(
      `[BET PROFILE] TOTAL REQUEST TIME : ${Date.now() - requestStart}ms`
    );
    console.log("==========================================================");
  };

  const lockKey = `lock:user:${id}`;
  const lockAcquired = await acquireLock(lockKey, 5000); // 5s lock


  if (!lockAcquired) {
    return res.status(httpStatus.TOO_MANY_REQUESTS).send(
      new APIResponse(
        {},
        "Processing previous request. Please wait a moment.",
        httpStatus.TOO_MANY_REQUESTS
      )
    );
  }

  try {
    startStep("getUser");
    const user = await getUserById(id);
    endStep("getUser");
    let expBal = 0;
    let partnerExpBal = 0;

    const betAmount = Number(req.body.amount) || 0;
    const userBalance = Number(user?.balance) || 0;
    const minBet = Number(req.body.min) || 0;
    const maxBet = Number(req.body.max) || 0;

    const payload = {
      etid: req.body.etid,
      gmid: req.body.gameId,
      vir: true,
    };
    if (user?.userLock) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            "Your account is locked. Please contact support.",
            httpStatus.BAD_REQUEST
          )
        );
    }

    if (user?.betLock) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            "Betting is locked for your account. Please contact support.",
            httpStatus.BAD_REQUEST
          )
        );
    }
    if (betAmount <= 0) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            "Bet amount must be greater than 0",
            httpStatus.BAD_REQUEST
          )
        );
    }
    // if (userBalance < betAmount) {
    //   return res
    //     .status(httpStatus.BAD_REQUEST)
    //     .send(
    //       new APIResponse(
    //         {},
    //         `Insufficient balance. Your balance is ${userBalance}, but you tried to bet ${betAmount}.`,
    //         httpStatus.BAD_REQUEST
    //       )
    //     );
    // }
    if (req?.body?.customBetType !== "cashoutBet" && betAmount < minBet) {
      return res.status(httpStatus.BAD_REQUEST).send(
        new APIResponse(
          {},
          "Bet Not Confirm Reason Min and Max Bet Range Not Valid.",
          // `Bet amount must be at least ${minBet}. You entered ${betAmount}.`,
          httpStatus.BAD_REQUEST
        )
      );
    }
    if (
      req?.body?.customBetType !== "cashoutBet" &&
      (maxBet === 0 || betAmount > maxBet)
    ) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            "Check Maximum Bet Limit",
            // `Bet amount cannot exceed ${maxBet}. You entered ${betAmount}.`,
            httpStatus.BAD_REQUEST
          )
        );
    }
     const gameType = [
      "superover3",
      "superover",
      "superover2",
      "cricketv3",
    ]?.includes(req?.body?.cType)
      ? "casino"
      : "game";

      // ================= working code BET DELAY =================
      // const currentDomain = req?.domainConfig?.domain;
      // const currentGameId = String(req?.body?.gameId);
      // const currentType = req?.body?.gType;
      // let delayTime = null;
      // // First check:
      // // same gameId + domain + type 
      // const settingMarket = await SettingMarket.findOne({
      //   category: "bet-delay",
      //   values: {
      //     $elemMatch: {
      //       gameId: currentGameId,
      //       domain: currentDomain,
      //       type: currentType
      //     }
      //   }
      // }).lean();


      // if (settingMarket) {
      //   delayTime = settingMarket.values.find(
      //     (item) =>
      //       String(item?.gameId) === currentGameId &&
      //       item?.domain === currentDomain &&
      //       item?.type === currentType
      //   );
      // }


      // console.log("SettingMarket delay:", delayTime?.value);
      // if (!delayTime) {
      //   const bettingDelay = await getButtonSettings(
      //     "bet-delay",
      //     currentDomain
      //   );
      //   delayTime = bettingDelay?.data?.find(
      //     (item) => item?.type === currentType
      //   );
      //   console.log("Default bettingDelay:", delayTime?.value);
      // }
      // // Final delay
      // startStep("delay");
      // const delay = Number(delayTime?.value ?? 1000);
      // endStep("delay");
      // console.log("FINAL BET DELAY:", delay);


      // ================= BET DELAY =================

        const currentDomain = req?.domainConfig?.domain;
        const currentGameId = String(req?.body?.gameId);
        const currentType = req?.body?.gType;

        let delayTime = null;

        // ==========================================
        // 1. FIRST: GAME + DOMAIN + TYPE
        // ==========================================
        const settingMarket = await SettingMarket.findOne({
          category: "bet-delay",
          values: {
            $elemMatch: {
              gameId: currentGameId,
              domain: currentDomain,
              type: currentType,
            },
          },
        }).lean();

        if (settingMarket) {
          const gameDelay = settingMarket.values?.find(
            (item) =>
              String(item?.gameId) === currentGameId &&
              item?.domain === currentDomain &&
              item?.type === currentType
          );

          // Only use if value is greater than 0
          if (Number(gameDelay?.value) > 0) {
            delayTime = gameDelay;
          }
        }

        console.log("GAME WISE DELAY:", delayTime?.value);


        // ==========================================
        // 2. SECOND: DOMAIN + TYPE
        // ==========================================
        if (!delayTime && currentDomain) {
          const domainSetting = await Settings.findOne({
            category: "bet-delay",
            domain: currentDomain,
          }).lean();

          const domainDelay = domainSetting?.values?.find(
            (item) => item?.type === currentType
          );

          // Only use if value is greater than 0
          if (Number(domainDelay?.value) > 0) {
            delayTime = domainDelay;
          }

          console.log("DOMAIN WISE DELAY:", delayTime?.value);
        }


        // ==========================================
        // 3. LAST: OLD EXISTING LOGIC
        // ==========================================
        if (!delayTime) {
          const bettingDelay = await getButtonSettings(
            "bet-delay",
            currentDomain
          );

          const defaultDelay = bettingDelay?.data?.find(
            (item) => item?.type === currentType
          );

          if (defaultDelay) {
            delayTime = defaultDelay;
          }

          console.log("DEFAULT BETTING DELAY:", delayTime?.value);
        }


        // ==========================================
        // 4. FINAL DELAY
        // ==========================================
        startStep("delay");

        const delay = Number(delayTime?.value ?? 1000);

        endStep("delay");

        console.log("FINAL BET DELAY:", delay);

     
        /////delay end//////////

    // Check for Section Bet Restrictions

    startStep("restrictionCheck");
    const restriction = await SectionBetRestriction.findOne({
      gameId: req.body.gameId,
      marketId: req.body.marketId,
      userIds: id,
    });
    endStep("restrictionCheck");

    if (restriction) {
      await releaseLock(lockKey, lockAcquired); // Ensure lock is released before returning
      return res.status(httpStatus.FORBIDDEN).send(
        new APIResponse(
          {},
          "User locked for this market",
          httpStatus.FORBIDDEN
        )
      );
    }
    startStep("promise");
    await new Promise((resolve) => setTimeout(resolve, delay));
    endStep("promise");
    let gameDetails = null;

    startStep("fetchgamedetails");
    if (gameType === "casino") {
      // const res = await apiRequest({
      //   url: `casino/data`,
      //   apiAction: "GET",
      //   data: { type:req.body.cType, key: process.env.JSK_KEY },
      //   host: process.env.JSK_CASINO_SERVER_URL,
      //   noEncrypt: true
      // });
      // gameDetails = res.data;

        const casinoResponse = await apiRequest({
          url: "casino/data",
          apiAction: "GET",
          data: {
            gtype: req.body.cType,
            key: "V67JKNJKMM8BOKJLMKN",
          },
          host: "https://diamond-casino-api-demo-s2.avrkhub.in",
          noEncrypt: true,
        });

      console.log(
        "PLACE BET CASINO RESPONSE:",
        JSON.stringify(casinoResponse?.data, null, 2)
      );

      gameDetails =
        casinoResponse?.data?.data?.data?.t2 ||
        casinoResponse?.data?.data?.t2 ||
        casinoResponse?.data?.t2 ||
        [];

      //gameDetails = res.data.data.t2;
      
     console.log("=====CASINO TYPE gameDetails:===========", gameDetails);
    } else {
      try{

        const res = await apiRequest({
          url: `gamedataPrivate`,
          apiAction: "GET",
          data: {
            etid: req.body.etid,
            gmid: req.body.gameId,
            key: "V67JKNJKMM8BOKJLMKN",
          },
          host: "https://diamond-sports-api-demo-s2.avrkhub.in",
          noEncrypt: true,
        });
          // console.log("res",res);

          
          gameDetails = res.data.data;

         // ================= LAST UPDATED TIME CHECK =================

          const lastUpdatedAt = res?.data?.lastUpdatedAt;

          if (lastUpdatedAt) {
            const thirdPartyTime = new Date(lastUpdatedAt).getTime();
            const currentTime = Date.now();

            const timeDifference = currentTime - thirdPartyTime;

            console.log("===== LAST UPDATED TIME CHECK =====");
            console.log(
              "Third Party lastUpdatedAt:",
              lastUpdatedAt
            );
            console.log(
              "Current Time:",
              new Date(currentTime).toISOString()
            );
            console.log(
              "Difference:",
              timeDifference,
              "ms"
            );
            console.log(
              "Difference:",
              (timeDifference / 1000).toFixed(3),
              "seconds"
            );
            console.log("==================================");

            // Agar current time third-party se 1.5 sec se zyada aage hai
            if (timeDifference > 1500) {
              return res.status(httpStatus.BAD_REQUEST).send(
                new APIResponse(
                  {},
                  "Unable to place bet. .",
                  httpStatus.BAD_REQUEST
                )
              );
            }
          }

          // ================= END LAST UPDATED TIME CHECK =================
      }catch(error){
        console.log("error",error);
      }
      
    }
    endStep("fetchgamedetails");

    const table = gameDetails?.find(
      (item) => item?.mid === req?.body?.marketId
    );
    const section = table?.section?.find(
      (item) => item?.sid === req?.body?.sectionId
    );
    let odds = null;
    if (req?.body?.customBetType === "cashoutBet") {
      odds = { odds: req.body.oRate };
      console.log('custom',odds);
    } else if (req?.body?.betType === "lay") {
      odds = section?.odds?.find(
        (item) => item?.otype === req?.body?.betType && Number(item?.odds) === Number(req?.body?.oRate)
      );
      if (!odds) {
        odds = section?.odds?.find((item) => item?.otype === req?.body?.betType);
      }
    } else {
      odds = section?.odds?.findLast(
        (item) => item?.otype === req?.body?.betType && Number(item?.odds) === Number(req?.body?.oRate)
      );
      if (!odds) {
        odds = section?.odds?.findLast((item) => item?.otype === req?.body?.betType);
      }
    }

    if (isOwnerEntry) {
      if (odds?.odds) {
        odds.odds = req.body.oRate;
      } else {
        odds = { odds: req.body.oRate };
      }
    }

    if ((!odds || !odds.odds || Number(odds.odds) <= 0) && !isOwnerEntry) {
      return res.status(httpStatus.BAD_REQUEST).send(
        new APIResponse(
          {},
          "Invalid odds (rate 0). Please refresh and try again.",
          httpStatus.BAD_REQUEST
        )
      );
    }

    if (section?.gstatus === "SUSPENDED" && !isOwnerEntry) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            "Betting is currently suspended for this market.",
            httpStatus.BAD_REQUEST
          )
        );
    }
    if (
      req?.body?.gType === "match" &&
      req?.body?.customBetType !== "cashoutBet" &&
      !isOwnerEntry
    ) {
      const condition =
        req?.body?.betType === "lay"
          ? odds?.odds > req?.body?.oRate || odds?.odds > req?.body?.uRate
          : odds?.odds < req?.body?.oRate || odds?.odds < req?.body?.uRate;
      if (condition) {
        return res
          .status(httpStatus.BAD_REQUEST)
          .send(
            new APIResponse(
              {},
              "Odds have changed. Please refresh and place your bet again.",
              httpStatus.BAD_REQUEST
            )
          );
      }
    } else if (
      (Number(odds?.odds) !== Number(req?.body?.oRate) || Number(odds?.odds) !== Number(req?.body?.uRate)) &&
      req?.body?.customBetType !== "cashoutBet" &&
      !isOwnerEntry
    ) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            "Odds have changed. Please refresh and place your bet again.",
            httpStatus.BAD_REQUEST
          )
        );
    }
    const findSpotsData = await getSportsData({
      mid: req?.body?.marketId,
      userId: id,
    });
    const existingMap = {};
    findSpotsData?.sdata?.forEach((s) => {
      existingMap[s.sid] = s.amount;
    });
    let spotsData = [];
    let lRate = 0;
    let bRate = 0;
    let lsize = 0;
    let bsize = 0;

    startStep("handleBets");
    if (["match1", "match"].includes(req?.body?.gType) && !["mogambo", "cricketcasino"].includes(req?.body?.gType)) {
      const result = handleMatchBet(
        req,
        findSpotsData,
        expBal,
        partnerExpBal,
        table,
        gameType,
        odds,
        existingMap
      );
      spotsData = result.spotsData;
      expBal = Number(Number(result.expBal).toFixed(3));
      partnerExpBal = Number(Number(result.partnerExpBal).toFixed(3));
      req.body.sections = result.sections;
    } else if (["fancy", "meter", "khado", "mogambo", "cricketcasino"].includes(req?.body?.gType)) {
      const result = await handleFancyBet(
        req,
        findSpotsData,
        expBal,
        partnerExpBal,
        id,
        section,
        odds,
        getBets
      );
      spotsData = result.spotsData;
      ////for number profit loss

          if (req?.body?.gType === "cricketcasino") {
            const stake = Number(req?.body?.amount || 0);

            const currentOdds = Number(
              odds?.odds ||
              req?.body?.uRate ||
              req?.body?.oRate ||
              0
            );

            // Example: "4 Number" => "4"
            const selectedNumber = String(
              req?.body?.sectionName ||
              req?.body?.nat ||
              ""
            ).match(/\d+/)?.[0];

            // Previous P/L ACTUAL section sid ke against
            const previousMap = {};

            (findSpotsData?.sdata || []).forEach((item) => {
              previousMap[String(item.sid)] =
                Number(item.amount || 0);
            });

            spotsData = (table?.section || []).map((item) => {
              // IMPORTANT: actual API section id hi rakhna hai
              const sid = String(item?.sid);

              // Example item nat/sectionName = "4 Number"
              const itemNumber = String(
                item?.nat ||
                item?.sectionName ||
                item?.name ||
                ""
              ).match(/\d+/)?.[0];

              const previousAmount =
                Number(previousMap[sid] || 0);

              let newAmount = previousAmount;

              if (String(itemNumber) === String(selectedNumber)) {
                // Selected number profit
                newAmount += (currentOdds - 1) * stake;
              } else {
                // Baaki sab numbers current stake lose karenge
                newAmount -= stake;
              }

              return {
                sid: item.sid, // <-- actual section sid
                amount: Number(newAmount.toFixed(2)),
                calcTable: []
              };
            });

            console.log("CRICKETCASINO NUMBER P/L DEBUG:", {
              marketId: req.body.marketId,
              sectionId: req.body.sectionId,
              sectionName: req.body.sectionName,
              nat: req.body.nat,
              selectedNumber,
              stake,
              currentOdds,
              sections: (table?.section || []).map((x) => ({
                sid: x?.sid,
                nat: x?.nat,
                sectionName: x?.sectionName,
                name: x?.name
              })),
              spotsData
            });
          }


      expBal = Number(Number(result.expBal).toFixed(3));
      partnerExpBal = Number(Number(result.partnerExpBal).toFixed(3));
      lRate = result.lRate;
      bRate = result.bRate;
      lsize = result.lsize;
      bsize = result.bsize;
      req.body.sections = table?.section || [];
    } else if (CASINO_GTYPES.includes(req?.body?.gType)) {
      const { handleCasinoFancyBet } = require("./bettingHandlers/casinoFancyBet");
      const result = handleCasinoFancyBet(
        req,
        findSpotsData,
        expBal,
        partnerExpBal,
        odds,
        null // sectionRecord not needed for non-mogambo winner markets
      );
      spotsData = result.spotsData;
      expBal = Number(Number(result.expBal).toFixed(3));
      partnerExpBal = Number(Number(result.partnerExpBal).toFixed(3));
    } else if (["fancy1"].includes(req?.body?.gType)) {
      const result = await handleFancy1Bet(
        req,
        findSpotsData,
        expBal,
        partnerExpBal,
        id,
        section,
        getBets
      );
      spotsData = result.spotsData;
      expBal = Number(Number(result.expBal).toFixed(3));
      partnerExpBal = Number(Number(result.partnerExpBal).toFixed(3));
      lRate = result.lRate;
      bRate = result.bRate;
      lsize = result.lsize;
      bsize = result.bsize;
    } else if (["oddeven"].includes(req?.body?.gType)) {
      const result = await handleOddEvenBet(
        req,
        findSpotsData,
        expBal,
        partnerExpBal,
        id,
        odds,
        getBets
      );
      spotsData = result.spotsData;
      expBal = Number(Number(result.expBal).toFixed(3));
      partnerExpBal = Number(Number(result.partnerExpBal).toFixed(3));
    }
    endStep("handleBets");

    // --- STAKE SAFETY FALLBACK ---
    // If the exposure delta is still 0 after all handlers, we MUST at least lock the stake
    // for any new bet to prevent negative balance drift from unhandled gTypes.
    const stakeDelta = -Number(req.body.amount || 0);
    if (expBal === 0 && stakeDelta < 0) {
      // Only apply fallback if it's not a known hedging market that might legitimately be 0 delta.
      expBal = stakeDelta;
    }
    // --- EXPOSURE LIMIT VALIDATION ---
    const currentExp = Math.abs(Number(user.exp || 0));
    const newExposure = Math.abs(Number(user.exp || 0) + Number(expBal || 0));
    const expLimit = Number(user.exp_limit || 0);

    console.log("++CHECK EXP2+++");
    console.log(currentExp, "currentExp");
    console.log(newExposure, "newExposure");
    console.log(expLimit, "expLimit");
    console.log("++END CHECK EXP2+++");

    if (expLimit > 0 && newExposure > expLimit && !isOwnerEntry) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            `Exposure limit is low. Your limit is ${expLimit}, current exposure is ${currentExp}.`,
            httpStatus.BAD_REQUEST
          )
        );
    }

    // --- STRICT BUFFER VALIDATION (FINAL GATE) ---
    const currentBuffer = Number((Number(user.balance || 0) + Number(user.exp || 0)).toFixed(2));
    const projectedBuffer = Number((currentBuffer + expBal).toFixed(2));

    if (projectedBuffer < -0.01 && !isOwnerEntry) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            `Insufficient balance.`,
            httpStatus.BAD_REQUEST
          )
        );
    }
    if (!req.body.sections && table?.section) {
      req.body.sections = table?.section || [];
    }

    const findKhadoORate = section?.odds?.find((item) => item?.otype === "lay");
    const thirdPartyMarketId=await generateUniqueMarketId();
    let newBetData = {
      ...req.body,
      uRate: odds?.odds,
      oRate: req?.body?.gType === "khado" ? findKhadoORate?.odds : odds?.odds,
      userId: id,
      bRate: bRate,
      lRate: lRate,
      lsize: lsize,
      bsize: bsize,
      ip: req.clientIp || "",
      domain: req?.domainConfig?.domain,
      browserDetails: req.headers["user-agent"] || "",
      thirdPartyMarketId:thirdPartyMarketId
    };
    if (isOwnerEntry) {
      newBetData = {
        ...newBetData,
        ip: req.body.userIp || "",
        browserDetails: req.body.browserDetails || "",
        createdAt: req.body.betDate || new Date(),
        updatedAt: req.body.betDate || new Date(),
      };
    }

    // --- ATOMIC EXPOSURE UPDATE (RESERVATION) ---
    const { atomicUpdateUserFinance } = require("../../helpers/finance.helper");
    let exposureReserved = false;
    let oldExpVal = Number(user.exp) || 0;
    let newExpVal = oldExpVal + expBal;

    startStep("updateUser");
    try {
      const updatedUser = await atomicUpdateUserFinance(
        id, 
        { exp: expBal }, 
        { allowNegativeBuffer: false } // Force strict balance check (No Overdraft)
      );
      
      if (updatedUser) {
        oldExpVal = Number(updatedUser.exp) - expBal;
        newExpVal = updatedUser.exp;
        user.exp = newExpVal; // Update local object for consistency
        exposureReserved = true;
      }
    } catch (err) {
      return res.status(httpStatus.BAD_REQUEST).send(
        new APIResponse({}, err.message, httpStatus.BAD_REQUEST)
      );
    }
    endStep("updateUser");

    startStep("createBetandmore");
    try {
      const bet = await createBet({
        ...newBetData,
      });

  //     console.log(
  //   "UPDATING SPORTSDATA:",
  //   JSON.stringify({
  //       mid: req.body.marketId,
  //       userId: id,
  //       sdata: spotsData
  //   }, null, 2)
  // );

      await updateSportsData(req?.body?.marketId, id, {
        mid: req?.body?.marketId,
        sdata: spotsData,
        userId: id,
      });

      const saved = await SportsData.findOne({
          mid: req.body.marketId,
          userId: id,
      }).lean();



      // Log Exposure
      // createExposureLog({
      //   userId: user._id,
      //   betId: bet._id,
      //   gameId: req?.body?.gameId,
      //   marketId: req?.body?.marketId,
      //   oldExp: oldExpVal,
      //   newExp: newExpVal,
      //   diff: expBal,
      //   action: "place",
      //   remark: "Bet Placement",
      //   createdBy: user._id
      // });

      const cacheKey = `user:${id}`;
      await setCache(cacheKey, user, 60);
      // await user.save(); // REMOVED: Unsafe

      await distributeCommissionHierarchy(user, { exp: partnerExpBal });

      if (user.role === 'user') {
        recalculateUserDirectExposure(id).catch(err => console.error(`[RealTimeSync] Error for userId ${id}:`, err.message));
      }

      res
        .status(httpStatus.OK)
        .send(
          new APIResponse(
            { ...bet.toObject(), spotsData },
            "Bet placed successfully",
            httpStatus.OK
          )
        );

      // Upline exposure is maintained by distributeCommissionHierarchy above + cron for self-healing.

      // Third-Party Result API Registration (fire-and-forget, non-blocking)
      // Registers the fancy section or match with resultapi.live so the third-party
      // can track it for result declaration. Called only once per unique section/game
      // (deduplication handled inside the service via ThirdPartyFancyRegistry /
      // ThirdPartyMatchRegistry collections). Failures are logged but never affect bets.
      try {
        const { registerFancyIfNeeded, registerMatchIfNeeded } = require("../../helpers/thirdPartyResult.service");
        const betGType = req.body.gType;
        const betMarketName = (req.body.marketName || "").toUpperCase();
        const betEtid = Number(req.body.etid);


        // Sport filter:
        //   Cricket (etid=4)  → register ALL bet types (fancy, match_odds, bookmaker, etc.)
        //   Football (etid=1) → register fancy + MATCH_ODDS + BOOKMAKER
        //   Tennis (etid=2)   → register ONLY MATCH_ODDS and BOOKMAKER (match1)
        const isCricket = betEtid === 4;
        const isFootball = betEtid === 1;
        const isTennis = betEtid === 2;
        const isHorseRacing = betEtid===10;
        const isGreyHoundRacing = betEtid===65;

        if (["fancy", "meter", "fancy1", "oddeven", "khado", "cricketcasino"].includes(betGType)) {
          // Pure fancy bet types
          // Allowed for cricket only; football and tennis skip fancy markets
          if (isCricket) {
            if (req.body.gType === "cricketcasino") {
              console.log(
                "[CRICKETCASINO REGISTER]",
                JSON.stringify({
                  gameId: req.body.gameId,
                  originalMarketId: req.body.marketId,
                  thirdPartyMarketId,
                  sectionId: req.body.sectionId,
                  marketName: req.body.marketName,
                  sectionName: req.body.sectionName,
                  nat: req.body.nat,
                  gType: req.body.gType
                }, null, 2)
              );
              registerMatchIfNeeded({
                event_id: req.body.gameId,
                event_name: req.body.eventName,
                market_id: thirdPartyMarketId,
                originalMarketId:req.body.marketId,
                market_name: req.body.marketName,
                market_type:req.body.marketName,
                sport_id: String(betEtid),
                client_ref: bet._id.toString()
              })
              console.log("cricket casino registered in match")
            }else{
              registerFancyIfNeeded({
                event_id: req.body.gameId,
                event_name: req.body.eventName,
                market_id: thirdPartyMarketId,
                sectionId:req.body.sectionId,
                originalMarketId:req.body.marketId,
               // market_name: req.body.nat,///mychanges
               market_name: req.body.sectionName,
                market_type:req.body.gType,
                sport_id: String(betEtid),
                client_ref: bet._id.toString()
              }).catch(err => console.error("[3P-Result] registerFancy error:", err));
              console.log("other registered in fancy")
            }
            
          }

        } else if (betGType === "match" && betMarketName === "MATCH_ODDS") {
          // MATCH_ODDS → allowed for all sports
          registerMatchIfNeeded({
            event_id: req.body.gameId,
            event_name: req.body.eventName,
            market_id: thirdPartyMarketId,
            originalMarketId:req.body.marketId,
            market_name: req.body.marketName,
            market_type:req.body.marketName,
            sport_id: String(betEtid),
            client_ref: bet._id.toString()
          }).catch(err => console.error("[3P-Result] registerMatch error:", err));

        } else if (betGType === "match") {
          // Non-MATCH_ODDS match markets (OVER_UNDER_xx, Next Goal, 1st Period Winner etc.)
          // Only register for cricket; skip for football/tennis
          if (isCricket || isFootball || isTennis ||isHorseRacing ||isGreyHoundRacing) {
            if (req.body.gType === "cricketcasino") {
              console.log(
                "[CRICKETCASINO REGISTER]",
                JSON.stringify({
                  gameId: req.body.gameId,
                  originalMarketId: req.body.marketId,
                  thirdPartyMarketId,
                  sectionId: req.body.sectionId,
                  marketName: req.body.marketName,
                  sectionName: req.body.sectionName,
                  nat: req.body.nat,
                  gType: req.body.gType
                }, null, 2)
              );
            }
            if (
              isTennis||
              isHorseRacing||
              isGreyHoundRacing||
              String(req.body.marketName).toUpperCase() === "TIED_MATCH" ||
              ((String(req.body.marketName || "").toUpperCase()).includes("UNDER/OVER")) ||
              ((String(req.body.marketName || "").toUpperCase()).includes("OVER_UNDER")) ||
              ((String(req.body.marketName || "").toUpperCase()).includes("NEXT GOAL")) ||
              ((String(req.body.marketName || "").toUpperCase()).includes("PERIOD WINNER")) ||
              ((String(req.body.marketName || "").toUpperCase()).includes("DRAW NO BET")) ||
              ((String(req.body.marketName || "").toUpperCase()).includes("MATCH TIME RESULT")) ||
              ((String(req.body.marketName || "").toUpperCase()).includes("BOTH TEAMS TO SCORE")) ||
              ((String(req.body.marketName || "").toUpperCase()).includes("HT/FT")) ||
              /^FIRST_HALF_GOALS_\d+$/.test(
                String(req.body.mname || "").toUpperCase()
              ) ||

              String(req.body.mname || "").toUpperCase() === "HALF_TIME" ||
              String(req.body.mname || "").toUpperCase() === "DRAW_NO_BET" ||
              String(req.body.mname || "").toUpperCase() === "CORRECT_SCORE" 
            ){

              registerMatchIfNeeded({
                event_id: req.body.gameId,
                event_name: req.body.eventName,
                market_id: thirdPartyMarketId,
                originalMarketId: req.body.marketId,
                market_name: req.body.marketName,   // TIED_MATCH
                market_type: req.body.marketName,   // TIED_MATCH
                sport_id: String(betEtid),
                client_ref: bet._id.toString(),
              }).catch(err =>
                console.error("[3P-Result] registerMatch (TIED_MATCH) error:", err)
              );

            }else{
              registerFancyIfNeeded({
                event_id: req.body.gameId,
                event_name: req.body.eventName,
                market_id: thirdPartyMarketId,
                originalMarketId:req.body.marketId,
                //market_name: req.body.nat,///mychanges
                market_name: req.body.sectionName,
                market_type:req.body.gType,
                sport_id: String(betEtid),
                client_ref: bet._id.toString()
              }).catch(err => console.error("[3P-Result] registerFancy (match-market) error:", err));
            }
            
          }

        } else if (betGType === "match1") {
          // Bookmaker → allowed for all sports
          registerMatchIfNeeded({
            event_id: req.body.gameId,
            event_name: req.body.eventName,
            market_id: thirdPartyMarketId,
            originalMarketId:req.body.marketId,
            market_name: req.body.marketName,
            market_type:req.body.marketName,
            sport_id: String(betEtid),
            client_ref: bet._id.toString()
          }).catch(err => console.error("[3P-Result] registerMatch (match1) error:", err));
        }
      } catch (tpErr) {
        console.error("[3P-Result] Registration hook error (non-critical):", tpErr);
      }

    } catch (err) {
      console.error("Error creating bet, rolling back exposure:", err);
      // ROLLBACK EXPOSURE
      if (exposureReserved) {
        if (!isOwnerEntry) {
          // Use secure helper? Or just force inc? Force inc to ensure rollback even if balance changed.
          // Actually if we release exposure, it's always safe (unless it goes positive? but exposure is <= 0).
          // updateUserExposureSecure ensures balance constraint, releasing logic doesn't violate insufficient balance.
          // But updateUserExposureSecure checks constraint. Release delta is POSITIVE (usually, if expBal was negative).
          // Or wait, expBal is negative for liability increase.
          // So Rollback is -expBal (Positive).
          // proposedExp = current + positive.
          // abs(current+pos) < balance?
          // If current is -500, rollback +500 -> 0. abs(0) < balance. OK.
          // So secure helper works for rollback too.
          await updateUserExposureSecure(id, -expBal).catch(e => console.error("Rollback failed", e));
        } else {
          await User.findOneAndUpdate({ _id: id }, { $inc: { exp: -expBal } });
        }
      }
      throw err; // Propagate error to next(err)
    }
    endStep("createBetandmore");
  } catch (err) {
    next(err);
  } finally {
    await releaseLock(lockKey, lockAcquired);
  }
};


const casinoPlaceBet = async (req, res, next) => {
  const isOwnerEntry = false; // Always false for Casino bets
  const id = req?.user?._id;
  const lockKey = `lock:user:${id}`;
  const lockAcquired = await acquireLock(lockKey, 5000);

  if (!lockAcquired) {
    return res.status(httpStatus.TOO_MANY_REQUESTS).send(
      new APIResponse(
        {},
        "Processing previous request. Please wait a moment.",
        httpStatus.TOO_MANY_REQUESTS
      )
    );
  }  try {
    const user = await User.findById(id);
    if (!user) {
      return res.status(httpStatus.NOT_FOUND).send(new APIResponse({}, "User not found", httpStatus.NOT_FOUND));
    }

    let expBal = 0;
    let partnerExpBal = 0;
    const betAmount = Number(req.body.amount) || 0;
    const userBalance = Number(user.balance || 0);
    const minBet = Number(req.body.min) || 0;
    const maxBet = Number(req.body.max) || 0;
    
    // 2. AUTHORITATIVE SPORTS DATA READ (POST-LOCK)
    const findSpotsData = await getSportsData({
      mid: req?.body?.marketId,
      userId: id,
    });

    const payload = {
      gtype: req.body.gType,
    };
    if (betAmount <= 0) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            "Bet amount must be greater than 0",
            httpStatus.BAD_REQUEST
          )
        );
    }

    if (user?.userLock) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            "Your account is locked. Please contact support.",
            httpStatus.BAD_REQUEST
          )
        );
    }

    if (user?.betLock) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            "Betting is locked for your account. Please contact support.",
            httpStatus.BAD_REQUEST
          )
        );
    }
    if (betAmount < minBet) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            `Bet amount must be at least ${minBet}. You entered ${betAmount}.`,
            httpStatus.BAD_REQUEST
          )
        );
    }
    if (maxBet === 0 || betAmount > maxBet) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            "Check Maximum Bet Limit",
            httpStatus.BAD_REQUEST
          )
        );
    }
        // ======================================================
        // THIRD PARTY CASINO - ONLY allpanelexc7.com
        // ======================================================

        const currentDomain = String(
            req?.domainConfig?.domain || ""
          )
            .toLowerCase()
            .replace(/^https?:\/\//, "")
            .replace(/\/$/, "");

          const isCasinoThirdParty =
            currentDomain === "allpanelexc7.com" &&
            req?.domainConfig?.isCasinoThirdParty === true;

        if (isCasinoThirdParty) {
          try {
            const gameType =
              req.body?.gameType ||
              req.body?.gType ||
              "teen62";

            const thirdPartyBetData = {
              marketId: req.body?.marketId,
              sectionId: req.body?.sectionId,
              betType: req.body?.betType,
              amount: Number(req.body?.amount || 0),
              gameType: gameType,
              nation: req.body?.nation || req.body?.sectionName || "",
              uRate: Number(req.body?.uRate || 0),
              subId: Number(req.body?.subId || 0),
              profit: Number(req.body?.profit || 0),
              userid: req.body?.userid || id,
              betid: req.body?.betid || req.body?.betId || "",
            };

            // const thirdPartyResponse = await apiRequest({
            //   url: `postbetdata?gtype=${encodeURIComponent(gameType)}`,
            //   apiAction: "POST",
            //   data: thirdPartyBetData,
            //   host: "https://casino.allpanelexc7.com",
            //   noEncrypt: true,
            // });
            const thirdPartyResponse = await axios({
              method: "POST",
              url: `https://casino.allpanelexc7.com/postbetdata?gtype=${encodeURIComponent(gameType)}`,
              headers: {
                "Content-Type": "application/json",
              },
              data: thirdPartyBetData,
              timeout: 10000,
            });

            // return res.status(httpStatus.OK).send(
            //   new APIResponse(
            //     thirdPartyResponse?.data ?? thirdPartyResponse,
            //     "Bet placed successfully",
            //     httpStatus.OK
            //   )
            // );
          } catch (err) {
            return res.status(httpStatus.BAD_REQUEST).send(
              new APIResponse(
                {},
                err?.message || "Third party casino bet failed",
                httpStatus.BAD_REQUEST
              )
            );
          }
        }



      const gameDetailsResponse = await apiRequest({
      url: "casino/data",
      apiAction: "GET",
      data: {
        gtype: req.body.gType,
        key: "V67JKNJKMM8BOKJLMKN",
      },
      host: "https://diamond-casino-api-demo-s2.avrkhub.in",
      noEncrypt: true,
    });
   
    const gameDetails =
      gameDetailsResponse?.data?.data ??
      gameDetailsResponse?.data ??
      gameDetailsResponse;

      const sectionId = [
        "roulette11",
        "ourroullete",
        "roulette13",
        "roulette12",
      ].includes(req.body?.gType)
        ? "i"
        : "sid";


    // const section = gameDetails?.sub?.find(
    //   (item) =>
    //     String(item?.[sectionId]) ===
    //     String(req?.body?.sectionId)
    // );


      const isWorli3 = req.body?.gType === "worli3";

      const casinoSections = isWorli3
        ? (Array.isArray(gameDetails)
            ? gameDetails
            : Array.isArray(gameDetails?.data)
            ? gameDetails.data
            : [])
        : gameDetails?.sub;

      const section = isWorli3
        ? casinoSections?.find(
            (item) =>
              String(item?.mid) === String(req.body?.marketId)
          )
        : casinoSections?.find(
            (item) =>
              String(item?.[sectionId]) ===
              String(req?.body?.sectionId)
          );

    

    if (req.body?.gType === "worli3") {
      console.log("*****WORLI3 MARKET DEBUG:", {
        marketId: req.body?.marketId,
        sectionId: req.body?.sectionId,
        subType: req.body?.subType,
        sectionName: req.body?.sectionName,
        gameDetailsKeys: Object.keys(gameDetails || {}),
        subIsArray: Array.isArray(gameDetails?.sub),
        subData: (gameDetails?.sub || []).map((item) => ({
          sid: item?.sid,
          i: item?.i,
          subtype: item?.subtype,
          etype: item?.etype,
          b: item?.b,
          gstatus: item?.gstatus,
        })),
        matchedSection: section || null,
      });
    }

    // const sectionRecord = gameDetails?.sub?.filter(
    //   (item) =>
    //     String(item?.subtype || "").toLowerCase() ===
    //     String(req?.body?.subType || "").toLowerCase()
    // );

    const sectionRecord = isWorli3
      ? []
      : gameDetails?.sub?.filter(
          (item) =>
            String(item?.subtype || "").toLowerCase() ===
            String(req?.body?.subType || "").toLowerCase()
    );

      // CMETER1 ONLY FIX
    if (req.body?.gType === "cmeter1") {
      const selectedRate = Number(
        req.body?.betType === "lay"
          ? section?.l || section?.b || req.body?.uRate
          : section?.b || req.body?.uRate
      );

      // Selected section fix
      if (section) {
        section.bbhav = Number.isFinite(Number(section.bbhav))
          ? Number(section.bbhav)
          : selectedRate;

        section.lbhav = Number.isFinite(Number(section.lbhav))
          ? Number(section.lbhav)
          : selectedRate;

        section.l = Number.isFinite(Number(section.l)) && Number(section.l) > 0
          ? Number(section.l)
          : Number(section.b || selectedRate);
      }

      // IMPORTANT:
      // handleCasinoFancyBet receives sectionRecord array,
      // so every item needs valid bhav/rate values.
      (sectionRecord || []).forEach((item) => {
        const itemRate = Number(item?.b || selectedRate);

        item.bbhav = Number.isFinite(Number(item?.bbhav))
          ? Number(item.bbhav)
          : itemRate;

        item.lbhav = Number.isFinite(Number(item?.lbhav))
          ? Number(item.lbhav)
          : itemRate;

        item.l = Number.isFinite(Number(item?.l)) && Number(item.l) > 0
          ? Number(item.l)
          : itemRate;
      });

      req.body.bhav = selectedRate;
      req.body.bbhav = selectedRate;
      req.body.lbhav = selectedRate;


    }

    let odds = null;
    //old logic
    // if (section?.odds?.length > 0 && req?.body?.subId > 0) {
    //   const findSubOdds = section?.odds?.find(
    //     (sub) => (sub?.sid ?? sub?.ssid) === req?.body?.subId
    //   );
    //   if (req?.body?.betType === "lay") {
    //     odds = findSubOdds?.l;
    //   } else {
    //     odds = findSubOdds?.b;
    //   }
    // } else {
    //   if (req.body?.gType === "3cardj") {
    //     odds = section?.b;
    //   } else if (req?.body?.betType === "lay") {
    //     odds = section?.l;
    //   } else {
    //     odds = section?.b;
    //   }
    // }

    //  CASINO SIMPLE LOGIC NEW
    // if (section?.etype === "match") {
    //   odds =
    //     req.body.betType === "lay"
    //       ? Number(section?.l)
    //       : Number(section?.b);
    // }


    //  MATCH (normal casino like mogambo + btable2 )
    // if (section?.etype === "match") {
    //   odds =
    //     req.body.betType === "lay"
    //       ? Number(section?.l)
    //       : Number(section?.b);
    // }
    if (section?.etype === "match") {
      odds = req.body.betType === "lay"
        ? Number(section?.l)
        : Number(section?.b);

      // ✅ Fallback if odds are missing
      // if (!odds || odds <= 0) {
      //   odds = Number(req.body.uRate);
      //   console.log("Fallback to uRate for odds:", odds);
      // }
      if (!odds || odds <= 0) {
      odds =
        req.body.betType === "lay"
          ? Number(section?.l || section?.b || req.body.uRate)
          : Number(section?.b || req.body.uRate);
    }
    }

    //  FANCY (no lay mostly)
    else if (["fancy", "Fancy"].includes(section?.etype)) {
      //odds = Number(section?.b);
        if (
        req.body?.gType === "race20" &&
        req.body?.subType === "race20fancy" &&
        ["Total points", "Total cards"].includes(req.body?.sectionName)
      ) {
        odds =
          req.body.betType === "lay"
            ? Number(section?.l || req.body.uRate)
            : Number(section?.b || req.body.uRate);
      } else {
        odds = Number(section?.b);
      }
    }

    //  FANCY1 (special odds)
    else if (["fancy1", "Fancy1"].includes(section?.etype)) {
      odds =
        req.body.betType === "lay"
          ? Number(section?.l || section?.b)
          : Number(section?.b);
    }

    //  FANCY2 (like mogambo sid 3)
    else if (["fancy2", "Fancy2"].includes(section?.etype)) {
      odds =
        req.body.betType === "lay"
          ? Number(section?.l)
          : Number(section?.b);
    }

    //  fallback safety
    // if (!odds || odds <= 0) {
    //   odds = Number(section?.b);
    // }
    if (!odds || odds <= 0) {
      odds =
        req.body.betType === "lay"
          ? Number(section?.l || section?.b || req.body.uRate)
          : Number(section?.b || req.body.uRate);
    }


    //  special override games
    if (["worli2", "worli", "worli3", "kbc", "lucky5"].includes(req.body?.gType)) {
      odds = Number(req?.body.uRate);
    }

    if (req.body?.gType === "lucky5") {
      odds = Number(section?.b || req.body.uRate);
    }

    //  fallback safety
    if (!odds || odds <= 0) {
      odds = Number(section?.b);
    }



        if (["worli2", "worli", "worli3", "kbc"].includes(req.body?.gType)) {
          odds = req?.body.uRate;
        }
        if (
      ["roulette11", "ourroullete", "roulette13", "roulette12"].includes(
        req.body?.gType
      )
    ) {
      odds =
        req.body.betType === "lay"
          ? Number(section?.l)
          : Number(section?.b);


    }
    if (section?.gstatus === "SUSPENDED") {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            "Betting is currently suspended for this market.",
            httpStatus.BAD_REQUEST
          )
        );
    }

    if ((!odds || isNaN(Number(odds)) || Number(odds) <= 0)) {
      return res.status(httpStatus.BAD_REQUEST).send(
        new APIResponse(
          {},
          "Invalid odds (rate 0). Please refresh and try again.",
          httpStatus.BAD_REQUEST
        )
      );
    }
    // if (Number(odds) !== Number(req?.body?.uRate)) 
      if (Number(req?.body?.uRate) > 0 && Number(odds) !== Number(req?.body?.uRate))
    {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            "Odds have changed. Please refresh and place your bet again.",
            httpStatus.BAD_REQUEST
          )
        );
    }

    //     const eventType = [
    //   "roulette11",
    //   "ourroullete",
    //   "roulette13",
    //   "roulette12",
    // ].includes(req.body?.gType)
    //   ? "match"
    //   : [
    //       "mogambo",
    //       "cricketcasino",
    //       "notenum",
    //       "kbc",
    //       "cmeter1",
    //       "kbc2",
    //     ].includes(req.body?.gType)
    //   ? "fancy"
    //   : section?.etype;
    // const eventType = [
    //   "roulette11",
    //   "ourroullete",
    //   "roulette13",
    //   "roulette12",
    // ].includes(req.body?.gType)
    //   ? "match"
    //   : req.body?.gType === "mogambo"
    //   ? section?.etype
    //   : [
    //       "cricketcasino",
    //       "notenum",
    //       "kbc",
    //       "cmeter1",
    //       "kbc2",
    //     ].includes(req.body?.gType)
    //   ? "fancy"
    //   : section?.etype;

        const eventType = [
          "roulette11",
          "ourroullete",
          "roulette13",
          "roulette12",
        ].includes(req.body?.gType)
          ? "match"
        : ["mogambo", "cmeter1"].includes(req.body?.gType)
        ? section?.etype
        : [
            "cricketcasino",
            "notenum",
            "kbc",
            "kbc2",
          ].includes(req.body?.gType)
        ? "fancy"
        : section?.etype;


        if (!section) {
        return res.status(httpStatus.BAD_REQUEST).send(
          new APIResponse(
            {},
            "Selected casino market not found. Please refresh and try again.",
            httpStatus.BAD_REQUEST
          )
        );
      }

          
        const existingMap = {};
        findSpotsData?.sdata?.forEach((s) => {
          existingMap[s.sid] = s.amount;
        });
        let spotsData = [];
        let lRate = 0;
        let bRate = 0;
        let lsize = 0;
        let bsize = 0;
        if (
          req?.body?.type === "random" &&
          Array.isArray(req.body?.ucard) &&
          req?.body?.ucard?.length > 0
        ) {
          const result = await handleRandomBet(
            req,
            findSpotsData,
            expBal,
            partnerExpBal,
            id,
            user,
            eventType,
            odds,
            section
          );
          spotsData = result.spotsData;
          expBal = Number(Number(result.expBal).toFixed(3));
          partnerExpBal = Number(Number(result.partnerExpBal).toFixed(3));
          req.body._randomBets = result.bets;
        } else {
          if (req.body?.gType === "cmatch20") {
            const result = await handleCmatch20Bet(
              req,
              findSpotsData,
              expBal,
              partnerExpBal,
              id
            );
            spotsData = result.spotsData;
            expBal = Number(Number(result.expBal).toFixed(3));
            partnerExpBal = Number(Number(result.partnerExpBal).toFixed(3));
          } else if (["Fancy", "fancy"].includes(eventType)) {
            const result = handleCasinoFancyBet(
              req,
              findSpotsData,
              expBal,
              partnerExpBal,
              odds,
              sectionRecord
            );
            spotsData = result.spotsData;
            expBal = Number(Number(result.expBal).toFixed(3));
          partnerExpBal = Number(Number(result.partnerExpBal).toFixed(3));
    // CMETER1 ONLY FIX
          if (req.body?.gType === "cmeter1") {
            const stake = Number(req.body?.amount || 0);
            const bhav = Number(
              section?.b || req.body?.uRate || 0
            );
            const selectedSid = String(req.body?.sectionId);

            spotsData = (spotsData || []).map((item) => {
              const isSelected =
                String(item?.sid) === selectedSid;

              const calculatedProfit = Number(
                ((bhav * stake) / 100).toFixed(2)
              );

              const safeAmount = Number.isFinite(
                Number(item?.amount)
              )
                ? Number(item.amount)
                : 0;

              return {
                ...item,

                amount: safeAmount,

                profit: Number.isFinite(Number(item?.profit))
                  ? Number(item.profit)
                  : isSelected
                  ? calculatedProfit
                  : 0,

                abovePL: Number.isFinite(Number(item?.abovePL))
                  ? Number(item.abovePL)
                  : safeAmount,

                belowPL: Number.isFinite(Number(item?.belowPL))
                  ? Number(item.belowPL)
                  : safeAmount,
              };
            });


          }


          } else if (["fancy1", "Fancy1"].includes(eventType)) {
            const result = await handleCasinoFancy1Bet(
              req,
              findSpotsData,
              expBal,
              partnerExpBal,
              id,
              section,
              getBets
            );
            spotsData = result.spotsData;
            expBal = Number(Number(result.expBal).toFixed(3));
          partnerExpBal = Number(Number(result.partnerExpBal).toFixed(3));
            lRate = result.lRate;
            bRate = result.bRate;
          } else if (["match", "Match"].includes(eventType)) {
            const result = handleCasinoMatchBet(
              req,
              findSpotsData,
              expBal,
              partnerExpBal,
              eventType,
              sectionRecord,
              odds,
              existingMap
            );
            spotsData = result.spotsData;
            expBal = Number(Number(result.expBal).toFixed(3));
          partnerExpBal = Number(Number(result.partnerExpBal).toFixed(3));
            req.body.sections = result.sections;
          } else if (["Fancy2", "fancy2"].includes(eventType)) {
            const result = await handleCasinoFancy2Bet(
              req,
              findSpotsData,
              expBal,
              partnerExpBal,
              id,
              section,
              odds,
              getBets
            );
            spotsData = result.spotsData;
            expBal = Number(Number(result.expBal).toFixed(3));
            partnerExpBal = Number(Number(result.partnerExpBal).toFixed(3));
            
            lRate = result.lRate;
            bRate = result.bRate;
            lsize = result.lsize;
            bsize = result.bsize;
          }
        }

        if (
      ["roulette11", "ourroullete", "roulette13", "roulette12"].includes(req.body?.gType)
    ) {
      const amount = Number(req.body.amount || 0);
    const rate = Number(odds || req.body.uRate || 0);

    expBal = req.body.betType === "lay"
      ? -Number(((rate - 1) * amount).toFixed(2))
      : -amount;

    partnerExpBal = Math.abs(expBal);


    }
        // --- STAKE SAFETY FALLBACK ---
        const stakeDelta = -Number(req.body.amount || 0);
        if (expBal === 0 && stakeDelta < 0) {
          expBal = stakeDelta;
        }

        // --- STRICT BUFFER VALIDATION (FINAL GATE) ---
        const currentBuffer = Number((Number(user.balance || 0) + Number(user.exp || 0)).toFixed(2));
        const projectedBuffer = Number((currentBuffer + expBal).toFixed(2));

          const currentExp = Math.abs(Number(user.exp || 0));
          const newExposure = Math.abs(Number(user.exp || 0) + Number(expBal || 0));
          const expLimit = Number(user.exp_limit || 0);

      if (expLimit > 0 && newExposure > expLimit && !isOwnerEntry) {
        return res
          .status(httpStatus.BAD_REQUEST)
          .send(
            new APIResponse(
              {},
              `Exposure limit is low. Your limit is ${expLimit}, current exposure is ${currentExp}.`,
              httpStatus.BAD_REQUEST
            )
          );
      }


        if (projectedBuffer < -0.01 && !isOwnerEntry) {
          return res
            .status(httpStatus.BAD_REQUEST)
            .send(
              new APIResponse(
                {},
                `Insufficient balance.`,
                httpStatus.BAD_REQUEST
              )
            );
        }

        // --- ATOMIC EXPOSURE UPDATE (RESERVATION) ---
        const { updateUserExposureSecure } = require("../../helpers/exposure.helper");
        let exposureReserved = false;
        let oldExpVal = Number(user.exp) || 0;
        let newExpVal = oldExpVal + expBal;

        try {
          const secureResult = await updateUserExposureSecure(id, expBal);
          exposureReserved = true;
          oldExpVal = secureResult.oldExp;
          newExpVal = secureResult.newExp;
          user.exp = newExpVal;
        } catch (err) {
          return res.status(httpStatus.BAD_REQUEST).send(
            new APIResponse({}, err.message, httpStatus.BAD_REQUEST)
          );
        }

        try {
          const mergedSdata = [];
          (spotsData || []).forEach(item => {
            const existing = mergedSdata.find(m => String(m.sid) === String(item.sid) && String(m.subId || 0) === String(item.subId || 0));
            if (existing) {
              existing.amount = Number(existing.amount || 0) + Number(item.amount || 0);
              existing.abovePL = Number(existing.abovePL || 0) + Number(item.abovePL || 0);
              existing.belowPL = Number(existing.belowPL || 0) + Number(item.belowPL || 0);
              existing.profit = Number(existing.profit || 0) + Number(item.profit || 0);
            } else {
              mergedSdata.push({ ...item });
            }
          });

          if (["mogambo", "cmeter1"].includes(req.body?.gType)) {
      const invalidSpot = mergedSdata.find((item) =>
        Object.entries(item || {}).some(([key, value]) => {
          const numericFields = [
            "amount",
            "profit",
            "abovePL",
            "belowPL",
          ];

          return (
            numericFields.includes(key) &&
            !Number.isFinite(Number(value))
          );
        })
      );

      if (invalidSpot) {
        console.error("INVALID MOGAMBO/CMETER1 SPOT DATA:", {
          gType: req.body?.gType,
          eventType,
          section,
          odds,
          invalidSpot,
        });

        throw new Error(
          `Invalid profit calculation for ${req.body?.gType}. Please refresh and try again.`
        );
      }
    }


          await updateSportsData(req?.body?.marketId, id, {
            mid: req?.body?.marketId,
            sdata: mergedSdata,
            userId: id,
          });

          let bet = null;
          if (req.body._randomBets) {
            const createdBets = [];
            for (const bData of req.body._randomBets) {
              const b = await createBet(bData);
              createdBets.push(b.toObject());
            }

            bet = { ...createdBets[0], allBets: createdBets };
          } else {

            bet = await createBet({
              ...req.body,
              uRate: odds,
              eType: eventType,
              userId: id,
              bRate: bRate,
              lRate: lRate,
              lsize: lsize,
              bsize: bsize,
              ip: req.clientIp || "",
              browserDetails: req.headers["user-agent"] || "",
              domain: req?.domainConfig?.domain,
            });
          }

          const cacheKey = `user:${id}`;
          await setCache(cacheKey, user, 60);

          await distributeCommissionHierarchy(user, { exp: partnerExpBal });

          if (user.role === 'user') {
            recalculateUserDirectExposure(id).catch(err => console.error(`[RealTimeSync-Casino] Error for userId ${id}:`, err.message));
          }

          res
            .status(httpStatus.OK)
            .send(
              new APIResponse(
                { ...(bet.toObject ? bet.toObject() : bet), spotsData: mergedSdata },
                "Bet placed successfully",
                httpStatus.OK
              )
            );
        //       const responseData = new APIResponse(
        //   { ...(bet.toObject ? bet.toObject() : bet), spotsData: mergedSdata },
        //   "Bet placed successfully",
        //   httpStatus.OK
        // );

        // console.log("Bet placed successfully Response:++++", responseData);

        // res
        //   .status(httpStatus.OK)
        //   .send(responseData);

        } catch (err) {
          console.error("Error creating casino bet, rolling back exposure:", err);
          if (exposureReserved) {
            await updateUserExposureSecure(id, -expBal).catch(e => console.error("Rollback failed", e));
          }
          throw err;
        }
      } catch (err) {
        console.log(err, "err");
        next(err);
      } finally {
        const id = req?.user?._id;
        // id is defined in try block scope in original code, but I moved it to top scope in the Fix 1.
        // So 'id' should be available.
        const lockKey = `lock:user:${id}`;
        await releaseLock(lockKey, lockAcquired);
      }
};


const listBets = async (req, res, next) => {
  try {
    const { gameId, marketId, gType, status, isActive } = req.query;
    const id = req?.user?._id;
    if (!id || (!gameId && (!marketId || !gType))) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "Either (gameId + userId) or (marketId + gType + userId) are required",
            httpStatus.BAD_REQUEST
          )
        );
    }

    const bets = await getBets({
      userId: id,
      isDeleteBetShowUser: { $ne: true },
       deleteBetStatus: { $ne: true },
      ...(gameId && { gameId }),
      ...(marketId && { marketId }),
      ...(gType && { gType }),
      ...(status && { status }),
      ...(isActive && { isActive }),
    });
    const marketIds = [...new Set(bets.map((bet) => bet.marketId))];

    const findSpotsDataRaw = await getAllSportsData({
      mid: { $in: marketIds },
      userId: id,
    });

    const findSpotsData = (findSpotsDataRaw || []).map(sd => sd.toObject ? sd.toObject() : sd);

    // Merge duplicate sdata entries to ensure UI shows the combined total profit/loss
    (findSpotsData || []).forEach(sd => {
      const mergedSdata = [];
      (sd.sdata || []).forEach(item => {
        const existing = mergedSdata.find(m => String(m.sid) === String(item.sid) && String(m.subId || 0) === String(item.subId || 0));
        if (existing) {
          existing.amount = Number(existing.amount || 0) + Number(item.amount || 0);
          existing.abovePL = Number(existing.abovePL || 0) + Number(item.abovePL || 0);
          existing.belowPL = Number(existing.belowPL || 0) + Number(item.belowPL || 0);
          existing.profit = Number(existing.profit || 0) + Number(item.profit || 0);
        } else {
          mergedSdata.push({ ...item });
        }
      });
      sd.sdata = mergedSdata;
    });
    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          { bets, spotsData: findSpotsData },
          "Bets fetched successfully",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(err);
  }
};

const listBetsAll = async (req, res, next) => {
  try {
    const id = req?.user?._id;
    const { type, page, limit, search, filter } = req?.body;
    if (!id) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(new APIError("userId are required", httpStatus.BAD_REQUEST));
    }

    let pagination = null;
    if (page && limit) {
      pagination = {
        skip: (Number(page) - 1) * Number(limit),
        limit: Number(limit)
      };
    }

    const dbFilter = {
      userId: id,
      isActive: true,
      isDeleteBetShowUser: { $ne: true },
       deleteBetStatus: { $ne: true },
      subType: { $exists: type === "casino" },
      status: "pending",
    };

    if (search) {
      const regex = new RegExp(search, "i");
      dbFilter.$or = [
        { eventName: { $regex: regex } },
        { marketName: { $regex: regex } },
        { sectionName: { $regex: regex } },
        { gType: { $regex: regex } }
      ];
    }

    if (filter && filter !== "all") {
      dbFilter.betType = filter;
    }

    const bets = await getBets(dbFilter, false, pagination);
    bets.forEach((bet) => {
      if (String(bet.etid) === "10") {
        bet._doc.sportName = "Horse Racing";
      }
    });
    if (pagination) {
      let totalRecords = 0;
      let totalAmount = 0;
      if (typeof Bet !== "undefined") {
        const stats = await Bet.aggregate([
          { $match: dbFilter },
          {
            $group: {
              _id: null,
              totalRecords: { $sum: 1 },
              totalAmount: { $sum: "$amount" },
            },
          },
        ]);
        totalRecords = stats[0]?.totalRecords || 0;
        totalAmount = stats[0]?.totalAmount || 0;
      } else {
        totalRecords = bets.length;
        totalAmount = bets.reduce((sum, bet) => sum + (bet.amount || 0), 0);
      }
      return res
        .status(httpStatus.OK)
        .send(
          new APIResponse(
            { bets, totalRecords, totalAmount },
            "Bets fetched successfully",
            httpStatus.OK
          )
        );
    }

    res
      .status(httpStatus.OK)
      .send(new APIResponse(bets, "Bets fetched successfully", httpStatus.OK));
  } catch (err) {
    next(err);
  }
};


const getCurrentBet = async (req, res, next) => {
  try {
    const apiStart = Date.now();
    const id = req?.user?._id;

    const {
      type,
      subType,
      isDelete,
      page = 1,
      search = "",
    } = req?.body;



    // ==========================================
    // USER ID VALIDATION
    // ==========================================

    if (!id) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "userId is required",
            httpStatus.BAD_REQUEST
          )
        );
    }

    // ==========================================
    // GET CURRENT USER
    // ==========================================

    const userStart = Date.now();

    const currentUser = await getUserById(id);

    console.log(
      "[BET API] getUserById:",
      Date.now() - userStart,
      "ms"
    );

    if (!currentUser) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(
          new APIError(
            "User not found",
            httpStatus.NOT_FOUND
          )
        );
    }

    // ==========================================
    // PAGINATION
    // ==========================================

    const pageNumber = Math.max(
      Number(page) || 1,
      1
    );

    // ALWAYS 10 RECORDS
    const limitNumber = 10;

    // Page 1 = 0
    // Page 2 = 10
    // Page 3 = 20
    // Page 4 = 30
    const skip =
      (pageNumber - 1) * limitNumber;

    // ==========================================
    // BASE MATCH QUERY
    // ==========================================

    const matchQuery = {
      isActive: !isDelete,
      status: "pending",
      deleteBetStatus: {
        $ne: true,
      },
    };

    // ==========================================
    // TYPE / SUBTYPE
    // ==========================================

    if (type === "casino") {
      matchQuery.subType = {
        $exists: true,
      };

      if (
        subType &&
        subType !== "all"
      ) {
        matchQuery.subType = subType;
      }
    } else {
      matchQuery.subType = {
        $exists: false,
      };

      if (
        subType &&
        subType !== "all"
      ) {
        matchQuery.betType = subType;
      }
    }

    // ==========================================
    // USER FILTER
    // ==========================================

    if (currentUser?.role !== "owner") {
      const idsStart = Date.now();

      const allIds =
        await collectAllIds(currentUser);

      console.log(
        "[BET API] collectAllIds:",
        Date.now() - idsStart,
        "ms",
        "IDs:",
        allIds.length
      );

      matchQuery.userId = {
        $in: allIds,
      };
    }

    // ==========================================
    // SEARCH
    // ==========================================

    /*
      IMPORTANT:

      user.username aggregation lookup ke baad
      available hota tha.

      Ab hum user collection ko directly search
      karenge aur matching userIds ko matchQuery
      me add karenge.
    */

    if (search) {
      const searchRegex = {
        $regex: search,
        $options: "i",
      };

      // ------------------------------------------
      // SEARCH USERS
      // ------------------------------------------

      const usersCollection =
        betModel.db.collection("users");

      const matchingUsers =
        await usersCollection
          .find(
            {
              username: searchRegex,
            },
            {
              projection: {
                _id: 1,
              },
            }
          )
          .toArray();

      const matchingUserIds =
        matchingUsers.map(
          (user) => user._id
        );

      // ------------------------------------------
      // SEARCH BET FIELDS
      // ------------------------------------------

      const searchConditions = [
        {
          eventName: searchRegex,
        },
        {
          marketName: searchRegex,
        },
        {
          sectionName: searchRegex,
        },
      ];

      // Username matches
      if (matchingUserIds.length > 0) {
        searchConditions.push({
          userId: {
            $in: matchingUserIds,
          },
        });
      }

      matchQuery.$or =
        searchConditions;
    }

    // ==========================================
    // COLLECTIONS
    // ==========================================

    const usersCollection =
      betModel.db.collection("users");

    const gamesCollection =
      betModel.db.collection("games");

    // ==========================================
    // TOTAL COUNT
    // ==========================================

    const totalPromise =
      betModel.countDocuments(
        matchQuery
      );

    // ==========================================
    // CURRENT PAGE BETS ONLY
    // ==========================================

    const betsPromise =
      betModel
        .find(
          matchQuery,
          {
            _id: 1,
            userId: 1,
            betType: 1,
            marketId: 1,
            etid: 1,
            eventName: 1,
            marketName: 1,
            sectionName: 1,

            uRate: 1,
            bhav: 1,
            bsize: 1,
            lsize: 1,

            bRate: 1,
            lRate: 1,

            amount: 1,
            ip: 1,

            gameId: 1,
            gType: 1,

            isActive: 1,
            createdAt: 1,
          }
        )
        .sort({
          createdAt: -1,
          _id: -1,
        })
        .skip(skip)
        .limit(limitNumber)
        .lean();

    // ==========================================
    // COUNT + BETS IN PARALLEL
    // ==========================================

    const betsDbStart = Date.now();

    const [total, bets] =
      await Promise.all([
        totalPromise,
        betsPromise,
      ]);

    console.log(
      "[BET API] count + bets:",
      Date.now() - betsDbStart,
      "ms"
    );

    // ==========================================
    // SAFETY
    // ==========================================

    const currentPageBets =
      Array.isArray(bets)
        ? bets.slice(
            0,
            limitNumber
          )
        : [];

    // ==========================================
    // USER IDS
    // ==========================================

    const userIds =
      currentPageBets
        .map((bet) => bet.userId)
        .filter(Boolean);

    // Remove duplicate user IDs
    const uniqueUserIds = [
      ...new Map(
        userIds.map((uid) => [
          String(uid),
          uid,
        ])
      ).values(),
    ];

    // ==========================================
    // GAME IDS
    // ==========================================

    const gameIds =
      currentPageBets
        .map((bet) => bet.gameId)
        .filter(
          (gameId) =>
            gameId !== undefined &&
            gameId !== null
        );
    
    console.log("[BET API] GAME IDS:", gameIds);

    // Unique game IDs
    const uniqueGameIds = [
      ...new Set(
        gameIds.map((gameId) =>
          String(gameId)
        )
      ),
    ];

    // ==========================================
    // BULK USER + GAME QUERY
    // ==========================================

    const usersPromise =
      uniqueUserIds.length > 0
        ? usersCollection
            .find(
              {
                _id: {
                  $in: uniqueUserIds,
                },
              },
              {
                projection: {
                  _id: 1,
                  name: 1,
                  username: 1,
                },
              }
            )
            .toArray()
        : Promise.resolve([]);

    // ------------------------------------------
    // GAME QUERY
    // ------------------------------------------

    let gamesPromise =
      Promise.resolve([]);

    if (
      uniqueGameIds.length > 0
    ) {
      const rawGameIds = [
        ...gameIds,
      ];

      const stringGameIds = [
        ...uniqueGameIds,
      ];

      gamesPromise =
        gamesCollection
          .find(
            {
              $or: [
                {
                  gmid: {
                    $in: rawGameIds,
                  },
                }
              ],
            },
            {
              projection: {
                _id: 0,
                gmid: 1,
                gameId: 1,
                eventName: 1,
                ename: 1,
                name: 1,
                event: 1,
              },
            }
          )
          .limit(20)
          .toArray();
    }

    // ==========================================
    // USERS + GAMES IN PARALLEL
    // ==========================================

    const usersGamesStart = Date.now();

    const usersStart = Date.now();
    const gamesStart = Date.now();

    const [users, games] =
      await Promise.all([
        usersPromise.then((result) => {
          // console.log(
          //   "[BET API] USERS QUERY:",
          //   Date.now() - usersStart,
          //   "ms"
          // );
          return result;
        }),

        gamesPromise.then((result) => {
          // console.log(
          //   "[BET API] GAMES QUERY:",
          //   Date.now() - gamesStart,
          //   "ms"
          // );
          return result;
        }),
      ]);

    // console.log(
    //   "[BET API] users + games:",
    //   Date.now() - usersGamesStart,
    //   "ms"
    // );

    // ==========================================
    // USER MAP
    // ==========================================

    const userMap = new Map();

    users.forEach((user) => {
      userMap.set(
        String(user._id),
        {
          _id: user._id,
          name: user.name,
          username: user.username,
        }
      );
    });

    // ==========================================
    // GAME MAP
    // ==========================================

    const gameMap = new Map();

    games.forEach((game) => {
      const eventName =
        game.eventName ??
        game.ename ??
        game.name ??
        game.event ??
        "";

      if (
        game.gmid !== undefined &&
        game.gmid !== null
      ) {
        gameMap.set(
          String(game.gmid),
          eventName
        );
      }

      if (
        game.gameId !== undefined &&
        game.gameId !== null
      ) {
        gameMap.set(
          String(game.gameId),
          eventName
        );
      }
    });

    // ==========================================
    // FINAL RESPONSE DATA
    // ==========================================

    const finalBets =
      currentPageBets.map((bet) => {
        const user =
          bet.userId
            ? userMap.get(
                String(bet.userId)
              )
            : undefined;

        // Existing eventName
        let eventName =
          bet.eventName;

        // If eventName empty/null,
        // get it from games collection
        if (
          eventName === undefined ||
          eventName === null ||
          String(eventName).trim() === ""
        ) {
          eventName =
            gameMap.get(
              String(bet.gameId)
            ) || "";
        }

        return {
          _id: bet._id,
          userId: bet.userId,
          betType: bet.betType,
          marketId: bet.marketId,
          etid: bet.etid,

          eventName,

          marketName:
            bet.marketName,

          sectionName:
            bet.sectionName,

          uRate: bet.uRate,
          bhav: bet.bhav,
          bsize: bet.bsize,
          lsize: bet.lsize,

          bRate: bet.bRate,
          lRate: bet.lRate,

          amount: bet.amount,
          ip: bet.ip,

          gameId: bet.gameId,
          gType: bet.gType,

          isActive:
            bet.isActive,

          createdAt:
            bet.createdAt,

          user: user || null,

          betDate:
            bet.createdAt,
        };
      });

    // ==========================================
    // FINAL SAFETY
    // ==========================================

    const responseData =
      finalBets.slice(
        0,
        limitNumber
      );

    // ==========================================
    // DEBUG
    // ==========================================

    // console.log(
    //   "CURRENT BET PAGINATION:",
    //   {
    //     page: pageNumber,
    //     skip,
    //     limit: limitNumber,
    //     total,
    //     recordsSent:
    //       responseData.length,
    //   }
    // );

    // ==========================================
    // RESPONSE
    // ==========================================

    // console.log(
    //   "[BET API] TOTAL:",
    //   Date.now() - apiStart,
    //   "ms"
    // );

    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          {
            // ONLY 10 RECORDS
            data: responseData,

            // ALL MATCHING RECORDS
            total,

            // CURRENT PAGE
            page: pageNumber,

            // ALWAYS 10
            limit: 10,

            // TOTAL PAGES
            totalPages:
              Math.ceil(
                total / 10
              ),
          },

          "Bets fetched successfully",

          httpStatus.OK
        )
      );

  } catch (err) {
    console.error(
      "getCurrentBet error:",
      err
    );

    next(err);
  }
};

const getChitBets = async (req, res, next) => {
  try {
    const bettingDelay = await getButtonSettings(
      "bet-delay",
      req?.domainConfig?.domain
    );
    const allIds = await collectAllIds(req?.user);

    const delayTime = {};
    bettingDelay?.data?.forEach((item) => {
      delayTime[item.type] = item.value;
    });
    const duplicatesBets = await findDuplicateBet({
      delayTime: delayTime,
      allIds,
    });
    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          { duplicatesBets },
          "fetched chit bets successfully",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(err);
  }
};


const getChitBetsShotx = async (req, res, next) => {
  try {
    const { userId, gmid, etid } = req.query;

    // --------------------------------------------------
    // VALIDATE REQUEST
    // --------------------------------------------------

    if (!userId || !gmid || !etid) {
      throw new APIError(
        "userId, gmid and etid are required",
        httpStatus.BAD_REQUEST
      );
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new APIError(
        "Invalid userId",
        httpStatus.BAD_REQUEST
      );
    }

    // --------------------------------------------------
    // FIND REQUESTED USER
    // --------------------------------------------------

    const requestedUser = await Usermodel.findById(userId)
      .select("_id username role parent")
      .lean();

    if (!requestedUser) {
      throw new APIError(
        "User not found",
        httpStatus.NOT_FOUND
      );
    }

    // --------------------------------------------------
    // COLLECT COMPLETE DOWNLINE
    // Excludes the requested user, like the existing
    // direct-child betting report.
    // --------------------------------------------------

    const allHierarchyUserIds = [];
    const userMap = new Map();

    let currentLevel = [requestedUser._id];

    while (currentLevel.length) {
      const children = await Usermodel.find({
        parent: { $in: currentLevel },
        isActive: true,
      })
        .select("_id username role parent")
        .lean();

      if (!children.length) {
        break;
      }

      const nextLevel = [];

      for (const child of children) {
        const childId = String(child._id);

        allHierarchyUserIds.push(child._id);
        userMap.set(childId, child);
        nextLevel.push(child._id);
      }

      currentLevel = nextLevel;
    }

    if (!allHierarchyUserIds.length) {
      return res.status(httpStatus.OK).send(
        new APIResponse(
          { duplicatesBets: [] },
          "No users found in the requested user's hierarchy",
          httpStatus.OK
        )
      );
    }

    // --------------------------------------------------
    // FETCH BET DELAY SETTINGS
    // --------------------------------------------------

    const bettingDelay = await getButtonSettings(
      "bet-delay",
      req?.domainConfig?.domain
    );

    const delayTime = {};

    bettingDelay?.data?.forEach((item) => {
      delayTime[item.type] = Number(item.value);
    });

    const delayBranches = Object.entries(delayTime).map(
      ([type, value]) => ({
        case: { $eq: ["$gType", type] },
        then: value,
      })
    );

    // --------------------------------------------------
    // FIND CHIT / DUPLICATE BETS
    // gmid maps to Bet.gameId.
    // --------------------------------------------------

    const duplicatesBets = await Bet.aggregate([
      {
        $match: {
          isActive: true,
          userId: { $in: allHierarchyUserIds },
          gameId: String(gmid),
          etid: String(etid),
          subType: { $exists: false },
        },
      },

      {
        $setWindowFields: {
          partitionBy: {
            userId: "$userId",
            etid: "$etid",
            sectionId: "$sectionId",
            marketId: "$marketId",
            gameId: "$gameId",
            winner: "$winner",
            ip: "$ip",
            domain: "$domain",
            browserDetails: "$browserDetails",
            status: "$status",
            gType: "$gType",
            sectionName: "$sectionName",
            marketName: "$marketName",
            eventName: "$eventName",
            amount: "$amount",
            uRate: "$uRate",
          },

          sortBy: {
            createdAt: 1,
            _id: 1,
          },

          output: {
            prevCreatedAt: {
              $shift: {
                output: "$createdAt",
                by: -1,
              },
            },
          },
        },
      },

      {
        $addFields: {
          timeDiffMs: {
            $subtract: ["$createdAt", "$prevCreatedAt"],
          },

          delayValue: {
            $switch: {
              branches: delayBranches,
              default: 1000,
            },
          },
        },
      },

      {
        $match: {
          $expr: {
            $and: [
              { $gte: ["$timeDiffMs", 0] },
              { $lte: ["$timeDiffMs", "$delayValue"] },
            ],
          },
        },
      },

      {
        $group: {
          _id: {
            userId: "$userId",
            etid: "$etid",
            sectionId: "$sectionId",
            marketId: "$marketId",
            gameId: "$gameId",
            winner: "$winner",
            ip: "$ip",
            domain: "$domain",
            browserDetails: "$browserDetails",
            status: "$status",
            gType: "$gType",
            sectionName: "$sectionName",
            marketName: "$marketName",
            eventName: "$eventName",
            amount: "$amount",
            uRate: "$uRate",
          },

          duplicateBets: {
            $push: {
              _id: "$_id",
              createdAt: "$createdAt",
              amount: "$amount",
              betType: "$betType",
              uRate: "$uRate",
              status: "$status",
              timeDiffMs: "$timeDiffMs",
            },
          },

          count: { $sum: 1 },
        },
      },

      {
        $lookup: {
          from: "users",
          localField: "_id.userId",
          foreignField: "_id",
          as: "user",
        },
      },

      { $unwind: "$user" },

      {
        $project: {
          _id: 1,
          duplicateBets: 1,
          count: 1,
          username: "$user.username",
        },
      },

      {
        $sort: {
          "_id.userId": 1,
          "_id.marketId": 1,
          "_id.sectionId": 1,
        },
      },
    ]);

    // --------------------------------------------------
    // RESPONSE
    // --------------------------------------------------

    return res.status(httpStatus.OK).send(
      new APIResponse(
        { duplicatesBets },
        "Fetched chit bets successfully",
        httpStatus.OK
      )
    );
  } catch (err) {
    next(err);
  }
};




const deleteBets = async (req, res, next) => {
  try {
    const { _id } = req.user;
    const { betIds, isDeleteBetShowUser = false } = req.body;

    let betIdsArray = [];

      if (typeof betIds === "string" && betIds.trim() !== "") {
        betIdsArray = betIds
          .split(",")
          .map((id) => new mongoose.Types.ObjectId(id.trim()));
      } else if (Array.isArray(betIds)) {
        betIdsArray = betIds.map((id) => new mongoose.Types.ObjectId(id));
      }
      
      if (!betIdsArray.length) {
        return res.status(400).json({
          message: "betIds is required",
        });
      }


      // const matchStage = {};
      // matchStage.isActive = true;
      // if (betIdsArray.length > 0) {
      //   matchStage._id = { $in: betIdsArray };
      // }

      const matchStage = {
        _id: { $in: betIdsArray },
        isActive: true,
      };

      let pipeline = [
        {
          $match: matchStage,
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
        return res
          .status(404)
          .json({ message: "No bets found for this market/section" });
      }

      const updatedBets = [];
      const userGroupWiseBets = bets;
      for (const user of userGroupWiseBets) {
        const lockKey = `lock:user:${user._id}`;
        const lockAcquired = await acquireLock(lockKey, 5000);
        if (!lockAcquired) {
          console.error(`[deleteBets] Failed to acquire lock for user ${user._id}`);
          continue;
        }

        try {
          let expBal = 0;
          let partnerExpBal = 0;
          let updateBalance = 0;
          for (const bet of user?.bets) {
            // console.log("BET STATUS:", bet.status, "BET ID:", bet._id.toString());
            if (["won", "lost"]?.includes(bet?.status)) {
              // console.log("=== DELETE BET ===", {
              //   betId: bet._id.toString(),
              //   status: bet.status,
              //   amount: bet.amount,
              //   profit: bet.profit,
              //   balanceBeforeAccumulation: updateBalance,
              // });

              // const updated = await updateBet(bet._id, {
              //   // profit: 0,
              //   isActive: false,
              //   isDeleteBetShowUser: isDeleteBetShowUser,
              //   updatedBy: _id,
              // });
                const updated = await Bet.findOneAndUpdate(
                  {
                    _id: bet._id,
                    isActive: true,
                    status: { $in: ["won", "lost"] },
                  },
                  {
                    $set: {
                      isActive: false,
                      isDeleteBetShowUser: isDeleteBetShowUser,
                      updatedBy: _id,
                    },
                  },
                  {
                    new: true,
                  }
                );
                // console.log("UPDATE BET RETURN:", updated);
              // if (updated) updatedBets.push(bet);
              //   updateBalance += bet.profit;
                  // if (updated) {
                  //   updatedBets.push(bet);

                  //   if (bet.status === "lost") {
                  //     updateBalance -= Number(bet.amount || 0);
                  //   } else if (bet.status === "won") {
                  //     updateBalance += Number(bet.profit || 0);
                  //   }
                  // }
                  if (updated) {
                     updatedBets.push(bet);

                      // console.log("BEFORE ADD:", {
                      //   oldUpdateBalance: updateBalance,
                      //   status: bet.status,
                      //   amount: bet.amount,
                      //   profit: bet.profit,
                      // });

                      // if (bet.status === "lost") {
                      //   updateBalance = updateBalance - Number(bet.amount || 0);
                      // } else if (bet.status === "won") {
                      //   updateBalance = updateBalance + Number(bet.profit || 0);
                      // }
                        if (bet.status === "lost") {
                         
                          updateBalance += Number(bet.profit || 0);

                        } else if (bet.status === "won") {
                          
                          updateBalance += Number(bet.profit || 0);
                        }
                        // console.log("AFTER ADD:", {
                        //   updateBalance,
                        // });
                  }
                  console.log("=== AFTER ACCUMULATION ===", {
                    betId: bet._id.toString(),
                    updateBalance,
                  });
              } else if (["cancelled"]?.includes(bet?.status)) {
                const updated = await updateBet(bet._id, {
                  // profit: 0,
                  isActive: false,
                  isDeleteBetShowUser: isDeleteBetShowUser,
                  updatedBy: _id,
                });
                if (updated) updatedBets.push(bet);
              } else if (["pending"]?.includes(bet?.status)) {
                const updated = await updateBet(bet._id, {
                  // profit: 0,
                  isActive: false,
                  isDeleteBetShowUser: isDeleteBetShowUser,
                  updatedBy: _id,
                });
                if (updated) updatedBets.push(bet);
            }
          }

          // remove pending bet exp
          const pendingBet = updatedBets?.filter(
            (item) => item?.status === "pending"
          );

          if (pendingBet?.length > 0) {
            for (const bet of pendingBet) {
              // ... [Rest of logic follows, but inside try/finally block now]
              const findSpotsData = await getSportsData({
                mid: bet?.marketId,
                userId: user?._id,
              });

              const existingMap = {};
              findSpotsData?.sdata?.forEach((s) => {
                existingMap[s.sid] = s.amount;
              });
              let spotsData = [];
              const eventType = bet?.eType;
              const odds = bet?.uRate;
              const isCasino = bet?.subType;
              if (isCasino && bet?.gType === "cmatch20") {
                const sportBet = [];
                const findOldBackBet =
                  (await getBets({
                    marketId: bet?.marketId,
                    userId: user?._id,
                    isActive: true,
                    _id: { $ne: bet?._id },
                  })) ?? [];
                const bets = findOldBackBet;
                for (let sid = 1; sid <= 10; sid++) {
                  let totalAmt = 0;
                  bets.forEach(({ sectionName, uRate, amount, betType }) => {
                    const selectedRun = parseInt(
                      sectionName.replace("Run ", ""),
                      10
                    );
                    let result = 0;

                    if (betType === "back") {
                      result = -amount;
                      if (selectedRun + sid >= 12) {
                        result = amount * (uRate - 1);
                      }
                    } else if (betType === "lay") {
                      result = amount;
                      if (selectedRun + sid >= 12) {
                        result = -amount * (uRate - 1);
                      }
                    }

                    totalAmt += result;
                  });

                  sportBet.push({
                    sid,
                    subId: 0,
                    amount: Math.round(totalAmt),
                  });
                }
                spotsData = sportBet;
                if (findSpotsData?.sdata?.length > 0) {
                  const oldMaxMinusAmt = Math.min(
                    ...findSpotsData?.sdata.map((item) => item.amount)
                  );
                  expBal += oldMaxMinusAmt;

                  const maxExp = Math.max(
                    0,
                    ...findSpotsData?.sdata
                      .map((r) => r.amount)
                      .filter((v) => v > 0)
                  );
                  partnerExpBal += maxExp;
                }
                const maxMinusAmt = Math.min(
                  ...sportBet.map((item) => item.amount)
                );
                expBal -= maxMinusAmt;

                const maxExp = Math.max(
                  0,
                  ...sportBet.map((r) => r.amount).filter((v) => v > 0)
                );
                partnerExpBal -= maxExp;
              } else if (isCasino && ["Fancy", "fancy"].includes(eventType)) {
                spotsData = findSpotsData?.sdata ? [...findSpotsData.sdata] : [];
                const idx = spotsData.findIndex(
                  (s) => s.sid === bet?.sectionId && s?.subId === bet?.subId
                );
                const oldAmt = idx > -1 ? spotsData[idx].amount : 0;
                const oldProfit = idx > -1 ? spotsData[idx].profit : 0;
                const amountCal =
                  bet?.subType === "race20fancy"
                    ? bet?.betType === "lay"
                      ? -bet?.bhav
                      : -bet?.amount
                    : bet?.betType === "lay" || bet?.gType === "cmeter1"
                      ? -Number(((parseFloat(odds) - 1) * bet?.amount).toFixed(2))
                      : -bet?.amount;

                const profitCal =
                  bet?.subType === "race20fancy"
                    ? bet?.betType === "lay"
                      ? bet?.amount
                      : bet?.bhav
                    : bet?.betType === "lay" || bet?.gType === "cmeter1"
                      ? bet?.amount
                      : Number(((parseFloat(odds) - 1) * bet?.amount).toFixed(2));
                    const newEntry = {
                      sid: bet?.sectionId,
                      amount: oldAmt + amountCal,
                      profit: oldProfit + profitCal,
                      subId: bet?.subId,
                    };

                if (idx > -1) {
                  expBal -= oldAmt;
                  partnerExpBal -= oldProfit;
                  spotsData[idx] = newEntry;
                } else {
                  spotsData.push(newEntry);
                }
                partnerExpBal += newEntry.profit;
                expBal += newEntry.amount;
              } else if (isCasino && ["fancy1", "Fancy1"].includes(eventType)) {
                spotsData = findSpotsData?.sdata ? [...findSpotsData.sdata] : [];
                const idx = spotsData.findIndex((s) => s.sid === bet?.sectionId);
                const oldAmt = idx > -1 ? spotsData[idx].amount : 0;
                if (idx > -1) {
                  const maxExp = Math.max(
                    0,
                    ...spotsData[idx]?.calcTable
                      .map((r) => r.profitLoss)
                      .filter((v) => v > 0)
                  );
                  partnerExpBal += maxExp;
                }
                const findOldBackBet = await getBets({
                  marketId: bet?.marketId,
                  userId: user?._id,
                  sectionId: bet?.sectionId,
                  betType: "back",
                  isActive: true,
                  _id: { $ne: bet?._id },
                });
                const findOldLayBet = await getBets({
                  marketId: bet?.marketId,
                  userId: user?._id,
                  sectionId: bet?.sectionId,
                  betType: "lay",
                  isActive: true,
                  _id: { $ne: bet?._id },
                });
                let backOdds = bet?.bRate;
                let layOdds = bet?.lRate;
                let newEntry = {};

                let backAmt =
                  findOldBackBet?.reduce(
                    (sum, b) => sum + Number(b.amount || 0),
                    0
                  ) || 0;

                let layAmt =
                  findOldLayBet?.reduce(
                    (sum, b) => sum + Number(b.amount || 0),
                    0
                  ) || 0;

                const targetRun = 1;
                // if (bet?.betType === "back") {
                //   backAmt += bet.amount;
                // } else {
                //   layAmt += bet.amount;
                // }

                const calcTable = [];
                let runCount = 1;

                for (
                  let run = targetRun - runCount;
                  run <= targetRun + runCount;
                  run++
                ) {
                  let profitLoss = 0;

                  if (backAmt > 0) {
                    if (run >= targetRun) {
                      profitLoss += Number(
                        (parseFloat(backOdds - 1) * backAmt).toFixed(2)
                      );
                    } else {
                      profitLoss -= backAmt;
                    }
                  }

                  if (layAmt > 0) {
                    if (run < targetRun) {
                      profitLoss += layAmt;
                    } else {
                      profitLoss -= Number(
                        (parseFloat(layOdds - 1) * layAmt).toFixed(2)
                      );
                    }
                  }

                  calcTable.push({
                    run,
                    back:
                      backAmt > 0
                        ? run >= targetRun
                          ? Number((parseFloat(backOdds - 1) * backAmt).toFixed(2))
                          : -backAmt
                        : 0,
                    lay:
                      layAmt > 0
                        ? run < targetRun
                          ? layAmt
                          : -Number((parseFloat(layOdds - 1) * layAmt).toFixed(2))
                        : 0,
                    profitLoss,
                  });
                }

                if (idx > -1) expBal += oldAmt;
                const minExp = Math.min(...calcTable.map((r) => r.profitLoss));
                expBal -= minExp;
                newEntry = {
                  sid: bet?.sectionId,
                  amount: minExp,
                  calcTable,
                };

                const maxExp = Math.max(
                  0,
                  ...calcTable.map((r) => r.profitLoss).filter((v) => v > 0)
                );
                partnerExpBal -= maxExp;
                if (idx > -1) {
                  spotsData[idx] = newEntry;
                } else {
                  spotsData.push(newEntry);
                }
              } else if (isCasino && ["Fancy2", "fancy2"].includes(eventType)) {
                spotsData = findSpotsData?.sdata ? [...findSpotsData.sdata] : [];
                const idx = spotsData.findIndex((s) => s.sid === bet?.sectionId);
                const oldAmt = idx > -1 ? spotsData[idx].amount : 0;
                if (idx > -1) {
                  const maxExp = Math.max(
                    0,
                    ...spotsData[idx]?.calcTable
                      .map((r) => r.profitLoss)
                      .filter((v) => v > 0)
                  );
                  partnerExpBal += maxExp;
                }
                const findOldBackBet = await getBets({
                  marketId: bet?.marketId,
                  userId: user?._id,
                  sectionId: bet?.sectionId,
                  betType: "back",
                  isActive: true,
                  _id: { $ne: bet?._id },
                });
                const findOldLayBet = await getBets({
                  marketId: bet?.marketId,
                  userId: user?._id,
                  sectionId: bet?.sectionId,
                  betType: "lay",
                  isActive: true,
                  _id: { $ne: bet?._id },
                });
                let backOdds = { size: bet?.bsize, odds: bet?.bRate };
                let layOdds = { size: bet?.lsize, odds: bet?.lRate };
                let newEntry = {};

                let backAmt =
                  findOldBackBet?.reduce(
                    (sum, b) => sum + Number(b.amount || 0),
                    0
                  ) || 0;

                let layAmt =
                  findOldLayBet?.reduce(
                    (sum, b) => sum + Number(b.amount || 0),
                    0
                  ) || 0;

                const targetRun = Number(odds);
                // if (bet?.betType === "back") {
                //   backAmt += bet.amount;
                // } else {
                //   layAmt += bet.amount;
                // }

                const calcTable = [];
                let runCount = 1;
                if (backOdds?.odds !== layOdds?.odds) {
                  runCount += backOdds?.odds - layOdds?.odds;
                }
                for (
                  let run = targetRun - runCount;
                  run <= targetRun + runCount;
                  run++
                ) {
                  let profitLoss = 0;

                  if (backAmt > 0) {
                    if (run >= backOdds?.odds) {
                      profitLoss += Number(
                        ((backAmt * backOdds?.size) / 100).toFixed(2)
                      );
                    } else {
                      profitLoss -= backAmt;
                    }
                  }

                  if (layAmt > 0) {
                    if (run < layOdds?.odds) {
                      profitLoss += layAmt;
                    } else {
                      profitLoss -= Number(
                        ((layAmt * layOdds?.size) / 100).toFixed(2)
                      );
                    }
                  }

                  calcTable.push({
                    run,
                    back:
                      backAmt > 0
                        ? run >= backOdds?.odds
                          ? Number(((backAmt * backOdds?.size) / 100).toFixed(2))
                          : -backAmt
                        : 0,
                    lay:
                      layAmt > 0
                        ? run < layOdds?.odds
                          ? layAmt
                          : -Number(((layAmt * layOdds?.size) / 100).toFixed(2))
                        : 0,
                    profitLoss,
                  });
                }

                // Save exposure
                if (idx > -1) expBal -= oldAmt;
                const minExp = Math.min(...calcTable.map((r) => r.profitLoss));
                expBal += minExp;

                const maxExp = Math.max(
                  0,
                  ...calcTable.map((r) => r.profitLoss).filter((v) => v > 0)
                );
                partnerExpBal -= maxExp;
                newEntry = {
                  sid: bet?.sectionId,
                  amount: minExp,
                  calcTable,
                };
                if (idx > -1) {
                  spotsData[idx] = newEntry;
                } else {
                  spotsData.push(newEntry);
                }
              } else if (isCasino && ["match", "Match"].includes(eventType)) {
                const findOldBet = await getBets({
                  marketId: bet?.marketId,
                  userId: user?._id,
                  isActive: true,
                  _id: { $ne: bet?._id },
                });

                const oldMaxMinusAmt = Math.min(
                  ...findSpotsData?.sdata.map((item) => item.amount)
                );
                expBal -= oldMaxMinusAmt;

                const maxExp = Math.max(
                  0,
                  ...findSpotsData?.sdata.map((r) => r.amount).filter((v) => v > 0)
                );
                partnerExpBal -= maxExp;
                spotsData = [...(findSpotsData?.sdata || [])];
                let oldSportData = [];
                findOldBet?.forEach((bet) => {
                  const existingMap = {};
                  oldSportData?.forEach((s) => {
                    existingMap[s.sid] = s.amount;
                  });
                  let newSportData = [];
                  bet?.sections?.forEach((item) => {
                    const isBookmakerBet = bet?.gType === "match1" || bet?.marketName === "Bookmaker";
                    const newAmt = Number(
                      (isBookmakerBet
                        ? item?.sid === bet?.sectionId
                          ? (bet?.betType === "lay" ? -1 : 1) *
                          ((bet?.amount * parseFloat(bet?.uRate)) / 100).toFixed(
                            2
                          )
                          : (bet?.betType === "lay" ? 1 : -1) * bet?.amount
                        : item?.sid === bet?.sectionId
                          ? (bet?.betType === "lay" ? -1 : 1) *
                          ((parseFloat(bet?.uRate) - 1) * bet?.amount).toFixed(2)
                          : (bet?.betType === "lay" ? 1 : -1) * bet?.amount
                      ).toFixed(2)
                    );
                    const oldAmt = existingMap[item?.sid] || 0;
                    const updatedAmt = oldAmt + newAmt;

                    const index = spotsData.findIndex((s) => s.sid === item.sid);

                    if (index > -1) {
                      spotsData[index].amount = updatedAmt;
                    } else {
                      spotsData.push({
                        sid: item.sid,
                        amount: updatedAmt,
                      });
                    }
                    newSportData.push({
                      sid: item.sid,
                      amount: updatedAmt,
                    });
                  });
                  oldSportData = newSportData;
                });

                if (!findOldBet?.length > 0) {
                  spotsData.forEach((item) =>
                    oldSportData.push({
                      sid: item.sid,
                      amount: 0,
                    })
                  );
                }

                spotsData = oldSportData;
                const maxMinusAmt = Math.min(
                  ...oldSportData.map((item) => item.amount)
                );
                expBal += maxMinusAmt;

                const updateMaxExp = Math.max(
                  0,
                  ...oldSportData.map((r) => r.amount).filter((v) => v > 0)
                );
                partnerExpBal -= updateMaxExp;
              } else if (
                !isCasino &&
                ["match1", "match", "cricketcasino"].includes(bet?.gType)
              ) {
                const findOldBet = await getBets({
                  marketId: bet?.marketId,
                  userId: user?._id,
                  isActive: true,
                  _id: { $ne: bet?._id },
                });

                const oldMaxMinusAmt = Math.min(
                  ...findSpotsData?.sdata.map((item) => item.amount)
                );
                expBal -= oldMaxMinusAmt;

                const maxExp = Math.max(
                  0,
                  ...findSpotsData?.sdata.map((r) => r.amount).filter((v) => v > 0)
                );
                partnerExpBal += maxExp;
                spotsData = [...(findSpotsData?.sdata || [])];
                let oldSportData = [];
                findOldBet?.forEach((bet) => {
                  const existingMap = {};
                  oldSportData?.forEach((s) => {
                    existingMap[s.sid] = s.amount;
                  });
                  let newSportData = [];
                  bet?.sections?.forEach((item) => {
                    const isBookmakerBet = bet?.gType === "match1" || bet?.marketName === "Bookmaker";
                    const newAmt = Number(
                      (isBookmakerBet
                        ? item?.sid === bet?.sectionId
                          ? (bet?.betType === "lay" ? -1 : 1) *
                          ((bet?.amount * parseFloat(bet?.uRate)) / 100).toFixed(
                            2
                          )
                          : (bet?.betType === "lay" ? 1 : -1) * bet?.amount
                        : item?.sid === bet?.sectionId
                          ? (bet?.betType === "lay" ? -1 : 1) *
                          ((parseFloat(bet?.uRate) - 1) * bet?.amount).toFixed(2)
                          : (bet?.betType === "lay" ? 1 : -1) * bet?.amount
                      ).toFixed(2)
                    );
                    const oldAmt = existingMap[item?.sid] || 0;
                    const updatedAmt = oldAmt + newAmt;

                    const index = spotsData.findIndex((s) => s.sid === item.sid);

                    if (index > -1) {
                      spotsData[index].amount = updatedAmt;
                    } else {
                      spotsData.push({
                        sid: item.sid,
                        amount: updatedAmt,
                      });
                    }
                    newSportData.push({
                      sid: item.sid,
                      amount: updatedAmt,
                    });
                  });
                  oldSportData = newSportData;
                });

                if (!findOldBet?.length > 0) {
                  spotsData.forEach((item) =>
                    oldSportData.push({
                      sid: item.sid,
                      amount: 0,
                    })
                  );
                }

                spotsData = oldSportData;
                const maxMinusAmt = Math.min(
                  ...oldSportData.map((item) => item.amount)
                );
                expBal += maxMinusAmt;

                const updateMaxExp = Math.max(
                  0,
                  ...oldSportData.map((r) => r.amount).filter((v) => v > 0)
                );
                partnerExpBal -= updateMaxExp;
              } else if (
                !isCasino &&
                ["fancy", "meter", "khado"].includes(bet?.gType)
              ) {
                spotsData = findSpotsData?.sdata ? [...findSpotsData.sdata] : [];
                const idx = spotsData.findIndex((s) => s.sid === bet?.sectionId);

                // 1. Fetch ALL remaining active bets (excluding current deleted one)
                const findOldBackBet = await getBets({
                  marketId: bet?.marketId,
                  userId: user?._id,
                  sectionId: bet?.sectionId,
                  betType: "back",
                  status: "pending",
                  isActive: true,
                  _id: { $ne: bet?._id },
                });
                const findOldLayBet = await getBets({
                  marketId: bet?.marketId,
                  userId: user?._id,
                  sectionId: bet?.sectionId,
                  betType: "lay",
                  status: "pending",
                  isActive: true,
                  _id: { $ne: bet?._id },
                });

                const remainingBets = [
                  ...(findOldBackBet || []),
                  ...(findOldLayBet || []),
                ];

                // 2. Define Helper for Exposure Calculation
                const calculateExposure = (bets) => {
                  if (!bets || bets.length === 0) return { minExp: 0, maxExp: 0, calcTable: [] };

                  let maxRate = 0;
                  let minRate = Infinity;
                  let maxBackRun = 0;
                  let maxLayRun = 0;

                  bets.forEach((b) => {
                    const r = Number(b.odds ?? b.uRate ?? b.rate);
                    if (r > maxRate) maxRate = r;
                    if (r < minRate) minRate = r;
                    if (Number(b.amount) > 0) {
                      if (b.betType === "back" && r > maxBackRun) maxBackRun = r;
                      if (b.betType === "lay" && r > maxLayRun) maxLayRun = r;
                    }
                  });

                  const startRun = 0;
                  const endRun = maxRate + 10;
                  let localCalcTable = [];

                  for (let run = startRun; run <= endRun; run++) {
                    let profitLoss = 0;
                    let backPL = 0;
                    let layPL = 0;

                    bets.forEach((b) => {
                      let betPL = 0;
                      const betAmt = Number(b.amount);
                      const betRate = Number(b.odds ?? b.uRate ?? b.rate);
                      const betSize = Number(b.size || 100);

                      if (b.betType === "back") {
                        if (run >= betRate) {
                          if (run >= maxBackRun) betPL = Number(((betAmt * betSize) / 100).toFixed(2));
                          else betPL = 0;
                        } else betPL = -betAmt;
                        backPL += betPL;
                      } else if (b.betType === "lay") {
                        if (run < betRate) betPL = betAmt;
                        else {
                          if (run >= maxLayRun) betPL = -Number(((betAmt * betSize) / 100).toFixed(2));
                          else betPL = 0;
                        }
                        layPL += betPL;
                      }
                      profitLoss += betPL;
                    });

                    localCalcTable.push({ run, back: backPL, lay: layPL, profitLoss });
                  }

                  // Filter Range
                  if (minRate === Infinity) minRate = 0;
                  const displayMin = minRate - 2;
                  const displayMax = maxRate + 2;
                  const finalTable = localCalcTable.filter(r => r.run >= displayMin && r.run <= displayMax);

                  const minExp = localCalcTable.length > 0 ? Math.min(0, ...localCalcTable.map(r => r.profitLoss)) : 0;
                  const maxExp = localCalcTable.length > 0 ? Math.max(0, ...localCalcTable.map(r => r.profitLoss).filter(v => v > 0)) : 0;

                  return { minExp, maxExp, calcTable: finalTable };
                };

                // 3. Calculate NEW Exposure (Remaining Bets)
                const newStats = calculateExposure(remainingBets);

                // 4. Calculate OLD Exposure (Remaining + Deleted Bet)
                // We use the deleted 'bet' object. Note: bet status might be 'pending' or 'deleted' but we treat it as active for this calc.
                const oldBets = [...remainingBets, bet];
                const oldStats = calculateExposure(oldBets);

                // 5. Delta Calculation (Stateless)
                // The change in exposure is strictly New - Old. 
                // We do NOT use 'oldAmt' from SportsData because it might be corrupted.
                const expChange = newStats.minExp - oldStats.minExp;
                expBal += expChange;

                // Partner Exp Change
                const partnerExpChange = newStats.maxExp - oldStats.maxExp;
                // Wait, partnerExpBal logic in original code:
                // "partnerExpBal -= maxExp" (new)
                // "partnerExpBal += maxExp" (old)
                // So Delta is -(New) + (Old) = Old - New.
                // So partnerExpBal += (oldStats.maxExp - newStats.maxExp);
                partnerExpBal += (oldStats.maxExp - newStats.maxExp);


                newEntry = {
                  sid: bet?.sectionId,
                  amount: newStats.minExp,
                  calcTable: newStats.calcTable,
                };

                if (idx > -1) {
                  spotsData[idx] = newEntry;
                } else {
                  spotsData.push(newEntry);
                }
              } else if (!isCasino && ["fancy1"].includes(bet?.gType)) {
                spotsData = findSpotsData?.sdata ? [...findSpotsData.sdata] : [];
                const idx = spotsData.findIndex((s) => s.sid === bet?.sectionId);
                const oldAmt = idx > -1 ? spotsData[idx].amount : 0;
                if (idx > -1) {
                  const maxExp = Math.max(
                    0,
                    ...spotsData[idx]?.calcTable
                      .map((r) => r.profitLoss)
                      .filter((v) => v > 0)
                  );
                  partnerExpBal += maxExp;
                }
                const findOldBackBet = await getBets({
                  marketId: bet?.marketId,
                  userId: user?._id,
                  sectionId: bet?.sectionId,
                  betType: "back",
                  isActive: true,
                  _id: { $ne: bet?._id },
                });
                const findOldLayBet = await getBets({
                  marketId: bet?.marketId,
                  userId: user?._id,
                  sectionId: bet?.sectionId,
                  betType: "lay",
                  isActive: true,
                  _id: { $ne: bet?._id },
                });
                let backOdds = { size: bet?.bsize, odds: bet?.bRate };
                let layOdds = { size: bet?.lsize, odds: bet?.lRate };
                let newEntry = {};

                let backAmt =
                  findOldBackBet?.reduce(
                    (sum, b) => sum + Number(b.amount || 0),
                    0
                  ) || 0;

                let layAmt =
                  findOldLayBet?.reduce(
                    (sum, b) => sum + Number(b.amount || 0),
                    0
                  ) || 0;

                const targetRun = 1;
                // if (bet?.betType === "back") {
                //   backAmt += req.body.amount;
                // } else {
                //   layAmt += req.body.amount;
                // }

                const calcTable = [];
                let runCount = 1;

                for (
                  let run = targetRun - runCount;
                  run <= targetRun + runCount;
                  run++
                ) {
                  let profitLoss = 0;

                  if (backAmt > 0) {
                    if (run >= targetRun) {
                      profitLoss += Number(
                        (parseFloat(backOdds?.odds - 1) * backAmt).toFixed(2)
                      );
                    } else {
                      profitLoss -= backAmt;
                    }
                  }

                  if (layAmt > 0) {
                    if (run < targetRun) {
                      profitLoss += layAmt;
                    } else {
                      profitLoss -= Number(
                        (parseFloat(layOdds?.odds - 1) * layAmt).toFixed(2)
                      );
                    }
                  }

                  calcTable.push({
                    run,
                    back:
                      backAmt > 0
                        ? run >= targetRun
                          ? Number(
                            (parseFloat(backOdds?.odds - 1) * backAmt).toFixed(2)
                          )
                          : -backAmt
                        : 0,
                    lay:
                      layAmt > 0
                        ? run < targetRun
                          ? layAmt
                          : -Number(
                            (parseFloat(layOdds?.odds - 1) * layAmt).toFixed(2)
                          )
                        : 0,
                    profitLoss,
                  });
                }

                // Save exposure
                if (idx > -1) expBal -= oldAmt;
                const minExp = Math.min(...calcTable.map((r) => r.profitLoss));
                expBal += minExp;
                newEntry = {
                  sid: bet?.sectionId,
                  amount: minExp,
                  calcTable,
                };
                if (idx > -1) {
                  spotsData[idx] = newEntry;
                } else {
                  spotsData.push(newEntry);
                }

                const maxExp = Math.max(
                  0,
                  ...calcTable.map((r) => r.profitLoss).filter((v) => v > 0)
                );
                partnerExpBal -= maxExp;
              } else if (!isCasino && ["oddeven"].includes(bet?.gType)) {
                spotsData = findSpotsData?.sdata ? [...findSpotsData.sdata] : [];

                const idx = spotsData.findIndex((s) => s.sid === bet?.sectionId);
                const oldAmt = idx > -1 ? spotsData[idx].amount : 0;
                if (idx > -1) {
                  const maxExp = Math.max(
                    0,
                    ...spotsData[idx]?.calcTable
                      .map((r) => r.profitLoss)
                      .filter((v) => v > 0)
                  );
                  partnerExpBal += maxExp;
                }
                // ✅ Fetch old bets for this section
                const findOldOddBet = await getBets({
                  marketId: bet?.marketId,
                  userId: user?._id,
                  sectionId: bet?.sectionId,
                  betType: "lay",
                  status: "pending",
                  isActive: true,
                  _id: { $ne: bet?._id },
                });
                const findOldEvenBet = await getBets({
                  marketId: bet?.marketId,
                  userId: user?._id,
                  sectionId: bet?.sectionId,
                  betType: "back",
                  status: "pending",
                  isActive: true,
                  _id: { $ne: bet?._id },
                });

                let oddAmt =
                  findOldOddBet?.reduce(
                    (sum, b) => sum + Number(b.amount || 0),
                    0
                  ) || 0;

                let evenAmt =
                  findOldEvenBet?.reduce(
                    (sum, b) => sum + Number(b.amount || 0),
                    0
                  ) || 0;

                // if (bet?.betType === "lay") {
                //   oddAmt += req.body.amount;
                // } else {
                //   evenAmt += req.body.amount;
                // }

                const calcTable = [];
                for (let outcome of ["lay", "back"]) {
                  let profitLoss = 0;

                  if (oddAmt > 0) {
                    if (outcome === "lay") {
                      profitLoss += Number(
                        ((parseFloat(odds) - 1) * oddAmt).toFixed(2)
                      );
                    } else {
                      profitLoss -= oddAmt;
                    }
                  }

                  if (evenAmt > 0) {
                    if (outcome === "back") {
                      profitLoss += Number(
                        ((parseFloat(odds) - 1) * evenAmt).toFixed(2)
                      );
                    } else {
                      profitLoss -= evenAmt;
                    }
                  }

                  calcTable.push({
                    outcome,
                    odd:
                      oddAmt > 0
                        ? outcome === "lay"
                          ? Number(((parseFloat(odds) - 1) * oddAmt).toFixed(2))
                          : -oddAmt
                        : 0,
                    even:
                      evenAmt > 0
                        ? outcome === "back"
                          ? Number(((parseFloat(odds) - 1) * evenAmt).toFixed(2))
                          : -evenAmt
                        : 0,
                    profitLoss,
                  });
                }

                if (idx > -1) expBal -= oldAmt;
                const minExp = Math.min(...calcTable.map((r) => r.profitLoss));
                expBal += minExp;

                const newEntry = {
                  sid: bet?.sectionId,
                  amount: minExp,
                  calcTable,
                };

                if (idx > -1) {
                  spotsData[idx] = newEntry;
                } else {
                  spotsData.push(newEntry);
                }
                const maxExp = Math.max(
                  0,
                  ...calcTable.map((r) => r.profitLoss).filter((v) => v > 0)
                );
                partnerExpBal -= maxExp;
              }

              await updateSportsData(bet?.marketId, user?._id, {
                mid: bet?.marketId,
                sdata: spotsData,
                userId: user?._id,
              });
              // console.log(spotsData, "spotsData");
            }
          }
          // console.log(partnerExpBal, expBal, "spotsData");

          if (updateBalance !== 0 || partnerExpBal !== 0 || expBal !== 0) {
            try {
              // Atomic Update to prevent race conditions (Using native $inc helper to prevent WriteConflicts)
              const { atomicUpdateUserBalanceExp } = require("../../helpers/utils");
                console.log("=== BEFORE BALANCE UPDATE ===", {
                    userId: user._id.toString(),
                    updateBalance,
                    balanceDelta: -updateBalance,
                    expBal,
                    partnerExpBal,
                });
              const updatedUser = await atomicUpdateUserBalanceExp(user._id, -updateBalance, expBal);
                console.log("=== AFTER BALANCE UPDATE ===", {
                  newBalance: updatedUser?.balance,
                  newExp: updatedUser?.exp,
                });
              if (!updatedUser) {
                console.warn("User not found during deleteBets update:", user?._id);
              } else {
                const cacheKey = `user:${updatedUser._id}`;
                await setCache(cacheKey, updatedUser, 60);

                // Propagate to uplines (which already uses atomic logic in distributeCommissionHierarchy)
                await distributeCommissionHierarchy(updatedUser, {
                  exp: partnerExpBal,
                });
              }
            } catch (err) {
              console.error(
                `Error updating user balance/exp for userId:${user?._id}`,
                err
              );
            }
          }
        } finally {
          await releaseLock(lockKey, lockAcquired);
        }
      }

      res.status(200).json({
        message: "Bets updated successfully",
        data: updatedBets,
      });
  } catch (error) {
    next(error);
  }
};


const rollBackBets = async (req, res, next) => {
  try {
    const { _id } = req.user;
    const { betId } = req.body;

    // 1. Single betId validate
    if (!betId) {
      return res.status(400).json({
        message: "betId is required",
      });
    }

    let betIdObject;

    try {
      betIdObject = new mongoose.Types.ObjectId(betId);
    } catch (error) {
      return res.status(400).json({
        message: "Invalid betId",
      });
    }

    // 2. Deleted bet find
    const deletedBets = await Bet.find({
      _id: betIdObject,
      isActive: false,
    }).lean();

    if (!deletedBets.length) {
      return res.status(404).json({
        message: "Deleted bet not found",
      });
    }

    const rollbackBets = [];

    // 3. User wise grouping
    const userGroups = {};

    for (const bet of deletedBets) {
      const userId = bet.userId.toString();

      if (!userGroups[userId]) {
        userGroups[userId] = [];
      }

      userGroups[userId].push(bet);
    }

    // 4. User process
    for (const [userId, userBets] of Object.entries(userGroups)) {

      const lockKey = `lock:user:${userId}`;

      const lockAcquired = await acquireLock(lockKey, 5000);

      if (!lockAcquired) {
        continue;
      }

      try {

        let balanceDelta = 0;
        let expDelta = 0;
        let partnerExpDelta = 0;

        // =========================
        // RESTORE BET
        // =========================
        for (const bet of userBets) {

          // won/lost ka delete reverse
          if (["won", "lost"].includes(bet.status)) {
            balanceDelta += Number(bet.profit || 0);
          }

          const restoredBet = await Bet.findOneAndUpdate(
            {
              _id: bet._id,
              isActive: false,
            },
            {
              $set: {
                isActive: true,
                isDeleteBetShowUser: false,
                updatedBy: _id,
              },
            },
            {
              new: true,
            }
          );

          if (restoredBet) {
            rollbackBets.push(restoredBet);
          }
        }

        // =========================
        // REBUILD SPORTS DATA
        // =========================

        // Get unique markets from the restored bets
        const marketIds = [
          ...new Set(
            userBets.map((bet) => String(bet.marketId))
          ),
        ];

        for (const marketId of marketIds) {

          // Get ALL active bets for this user + market
          // Restored bet will already be included because
          // we restored isActive = true above.
          const activeBets = await Bet.find({
            userId: userId,
            marketId: marketId,
            isActive: true,
          })
            .sort({ createdAt: 1, _id: 1 })
            .lean();

          console.log(
            "[ROLLBACK] REBUILD SPORTS DATA",
            {
              userId,
              marketId,
              activeBets: activeBets.length,
            }
          );

          // Start from empty SportsData
          let currentSportsData = {
            mid: marketId,
            userId: userId,
            sdata: [],
          };

          // Re-apply every active bet in order
          for (const activeBet of activeBets) {

            console.log(
              "[ROLLBACK] PROCESSING BET:",
              activeBet._id.toString()
            );

            // Same sections that were stored with the bet
            const table = {
              mid: activeBet.marketId,
              section: activeBet.sections || [],
            };

            const section =
              table.section?.find(
                (item) =>
                  String(item?.sid) ===
                  String(activeBet.sectionId)
              ) || null;

            // Same odds that were used when bet was placed
            const odds = {
              odds: Number(
                activeBet.uRate ??
                activeBet.oRate ??
                0
              ),
            };

            const gameType = [
              "superover3",
              "superover",
              "superover2",
              "cricketv3",
            ].includes(activeBet?.cType)
              ? "casino"
              : "game";

            // ==========================================
            // USE THE HELPER YOU ADDED
            // ==========================================

            const result = await rebuildSportsDataForBet({
              bet: activeBet,
              currentSportsData,
              table,
              section,
              gameType,
              odds,
              userId,
            });

            // ==========================================
            // IMPORTANT:
            // Next bet starts from previous bet's
            // calculated SportsData
            // ==========================================

            currentSportsData = {
              mid: marketId,
              userId: userId,
              sdata: result.spotsData,
            };
          }

          // ==========================================
          // SAVE FINAL SPORTS DATA
          // ==========================================

          await updateSportsData(
            marketId,
            userId,
            {
              mid: marketId,
              sdata: currentSportsData.sdata,
              userId: userId,
            }
          );

          console.log(
            "[ROLLBACK] FINAL SPORTS DATA:",
            JSON.stringify(
              currentSportsData.sdata,
              null,
              2
            )
          );
        }

        // =========================
        // RESTORE BALANCE / EXP
        // =========================
        if (
          balanceDelta !== 0 ||
          expDelta !== 0 ||
          partnerExpDelta !== 0
        ) {

          const {
            atomicUpdateUserBalanceExp,
          } = require("../../helpers/utils");

          const updatedUser =
            await atomicUpdateUserBalanceExp(
              userId,
              balanceDelta,
              expDelta
            );

          if (updatedUser) {

            await setCache(
              `user:${updatedUser._id}`,
              updatedUser,
              60
            );

            if (partnerExpDelta !== 0) {
              await distributeCommissionHierarchy(
                updatedUser,
                {
                  exp: partnerExpDelta,
                }
              );
            }
          }
        }

      } finally {
        await releaseLock(
          lockKey,
          lockAcquired
        );
      }
    }

    return res.status(200).json({
      message: "Bet rollback successfully",
      data: rollbackBets,
    });

  } catch (error) {
    console.error("[rollback] Error:", error);
    next(error);
  }
};

module.exports = {
  placeBet,
  casinoPlaceBet,
  listBets,
  listBetsAll,
  getCurrentBet,
  getChitBets,
  getChitBetsShotx,
  deleteBets,
  rollBackBets
};
