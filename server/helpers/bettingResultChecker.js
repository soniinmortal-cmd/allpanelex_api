
const mongoose = require("mongoose");
const {
  AccountStatement,
} = require("../apis/account-statement/account-statement.helper");
const {
  getBets,
  betsGroupingByMarketIdAndUserId,
  Bet,
  betsSportGroupingByMarketIdAndUserId,
  updateBet,
} = require("../apis/bet/bet.helper");

const { acquireLock, releaseLock } = require("./lock.helper");


const { getSportsData, updateSportsData } = require("../apis/sports-data/sports-data.helper");
const { getUserById, User } = require("../apis/users/users.helper");
const { setCache } = require("./cache");
const {
  apiRequest,
  normalizeNat,
  isScoreWin,
  rouletteNumbers,
  compareHands,
  mapValueToRank,
  parseCardValue,
  parseCardGroup,
  tieGameCondition,
  getCardRanks,
  generateFullDeck,
  checkJokerResult,
  distributeCommissionHierarchy,
  distributeCasinoCommissionHierarchy,
  checkPannaType,
  SPGroups,
  DPGroups,
  TPList,
  chart64,
  chart56,
  commonDP,
  commonSP,
  colorDP,
  abr,
  atomicUpdateUserBalanceExp,
} = require("./utils");
const { atomicUpdateUserFinance } = require("./finance.helper");
const {
  calculateFancyPLs,
  calculateMatchPLs,
  recalculateUserExposureAndGetDelta,
} = require("./exposure.helper");

const Domain = require("../apis/domain/domain.model");

let isProcessingWithMarketId = false;
let inProcessMarket = [];

const TEENPATTI_MATCH_GTYPES = ["teen", "pteen", "tteen", "teen62"];
const INSTANT_TEENPATTI_GTYPES = ["teen3", "teen22", "teen33"];
const TEENPATTI_20_GTYPES = [
  "teen20c",
  "teen20b",
  "teen20",
  "teen20v1",
  "pteen20",
  "tteen20",
];
const TEENPATTI_GTYPES = [
    ...TEENPATTI_MATCH_GTYPES,
    ...INSTANT_TEENPATTI_GTYPES,
    ...TEENPATTI_20_GTYPES,
];
const JOKER_GTYPES = ["joker1", "joker120", "joker20", "teenjoker"];

const getBetGameTypes = (bet) =>
  [bet?.gType, bet?.cType, bet?.gameId, bet?.subType, bet?.gameType, bet?.type]
    .filter(Boolean)
    .map((value) => value.toString().trim().toLowerCase());
const isTeenpattiEventBet = (bet) =>
  /teen\s*patti|teenpatti/i.test(bet?.eventName || bet?.marketName || "");
const isJokerEventBet = (bet) =>
  /joker/i.test(bet?.eventName || bet?.marketName || "");
const isTeenpattiBet = (bet) =>
  getBetGameTypes(bet).some((type) => TEENPATTI_GTYPES.includes(type)) ||
  isTeenpattiEventBet(bet);
const isTeenpatti20Bet = (bet) =>
  getBetGameTypes(bet).some((type) => TEENPATTI_20_GTYPES.includes(type));
const isTeenpattiMatchBet = (bet) =>
  getBetGameTypes(bet).some(
    (type) =>
      TEENPATTI_MATCH_GTYPES.includes(type) ||
      INSTANT_TEENPATTI_GTYPES.includes(type)
  ) ||
  isTeenpattiEventBet(bet);
const isJokerBet = (bet) =>
  getBetGameTypes(bet).some(
    (type) => JOKER_GTYPES.includes(type) || type.includes("joker")
  ) || isJokerEventBet(bet);

const cleanTeenpattiValue = (val) =>
  val?.toString()?.toLowerCase()?.replace(/\s+/g, " ")?.trim() || "";

const normalizeTeenpattiSelection = (val) =>
  cleanTeenpattiValue(val)
    .replace(/\bmain\b/g, "")
    .replace(/^winner\s+/, "player ")
    .replace(/\bplayer\s+([ab])\b/g, "player $1")
    .replace(/\s+/g, " ")
    .trim();

const teenpattiSegments = (resultData) =>
  (resultData?.rdesc || "")
    .split("#")
    .map((s) => s?.trim())
    .filter((s) => s !== undefined);

const includesTeenpattiToken = (segment, token) => {
  const cleanSegment = cleanTeenpattiValue(segment);
  const cleanToken = cleanTeenpattiValue(token);
  if (!cleanSegment || !cleanToken) return false;
  return cleanSegment
    .split(/[|,~#]/)
    .map((part) => part.trim())
    .some((part) => part === cleanToken || part.includes(cleanToken));
};


const getTeenpatti20ResultSegment = (resultData) => {
    const rdesc = teenpattiSegments(resultData);

    const handMap = {};

    (rdesc[3] || "")
        .split("|")
        .map(x => x.trim())
        .filter(Boolean)
        .forEach(item => {
            const [player, hand] = item.split(":").map(x => x.trim());

            if (
                (player === "A" || player === "B") &&
                hand
            ) {
                handMap[player] = hand;
            }
        });

    return {
        winner: rdesc[0] || "",
        baccarat: rdesc[1] || "",
        total: rdesc[2] || "",
        pair: handMap,
        redBlack: rdesc[4] || "",
    };
};

const isTeenpattiBackSelectionWinner = (resultData, bet) => {
    const sectionName = bet?.sectionName || "";

    if (isTeenpatti20Bet(bet)) {

        const subType = bet?.subType?.endsWith("1")
            ? bet.subType.slice(0, -1)
            : bet?.subType;

        const normalized = normalizeTeenpattiSelection(
            normalizeNat(sectionName, subType)
        );

        const result = getTeenpatti20ResultSegment(resultData);

        if (
            ["Pair", "Flush", "Straight", "Trio", "Straight Flush"].includes(subType)
        ) {
            let player = null;

            if (/Pair\s*Plus\s*A/i.test(sectionName)) {
                player = "A";
            } else if (/Pair\s*Plus\s*B/i.test(sectionName)) {
                player = "B";
            }

            if (!player) return false;

            return !!result.pair[player];
        }

        switch (subType) {
            case "Player":
                return includesTeenpattiToken(result.winner, normalized);

            case "Baccarat":
            case "Bacc":
            case "Khal":
                return includesTeenpattiToken(result.baccarat, normalized);

            case "Total":
                return includesTeenpattiToken(result.total, normalized);

            case "RedBlack":
                return includesTeenpattiToken(result.redBlack, normalized);

            default:
                return false;
        }
    }

    if (isTeenpattiMatchBet(bet)) {

        if (INSTANT_TEENPATTI_GTYPES.includes(bet?.gType)) {
            const winner = normalizeTeenpattiSelection(resultData?.winnat);
            const section = normalizeTeenpattiSelection(bet?.sectionName);

            return winner === section;
        }

        const rdesc = teenpattiSegments(resultData);
        const section = normalizeTeenpattiSelection(sectionName);
        const winNat = normalizeTeenpattiSelection(resultData?.winnat);

        if (bet?.gType === "teen62" && ["suita", "suitb"].includes(bet?.subType)) {
            const suits = (rdesc[1] || "")
                .split(/\s+/)
                .filter(Boolean)
                .map(cleanTeenpattiValue);

            const playerSuits =
                bet?.subType === "suita"
                    ? suits.slice(0, 3)
                    : suits.slice(3, 6);

            const selectedSuit = section.replace(/^player\s+[ab]\s+/, "");

            return playerSuits.includes(selectedSuit);
        }

        if (bet?.subType === "con") {
            const consecutive = rdesc[3] || "";

            return consecutive.split("|").some((item) => {
                const [player, result] = item.split(":").map((s) => s?.trim());

                const label = normalizeTeenpattiSelection(
                    `Player ${player} Consecutive ${result}`
                );

                return label === `${section} yes`;
            });
        }

        if (sectionName.includes(" - ")) {
            const oddEvenLabel = (rdesc[2] || "")
                .split(/\s{2,}/)
                .filter(Boolean);

            const [card, oddEven] = sectionName
                .split(" - ")
                .map((s) => s.trim());

            const cardIndex = Number((card.match(/\d+/) || [])[0]) - 1;

            return (
                cleanTeenpattiValue(oddEvenLabel[cardIndex]) ===
                cleanTeenpattiValue(oddEven)
            );
        }

        return (
            winNat === section ||
            rdesc.some(
                (part) => normalizeTeenpattiSelection(part) === section
            ) ||
            (winNat === "result" &&
                normalizeTeenpattiSelection(resultData?.rdesc) === section)
        );
    }

    return false;
};

const getTeenpattiBetStatus = (resultData, bet) => {
  const isBackWinner = isTeenpattiBackSelectionWinner(resultData, bet);
  return bet?.betType === "lay"
    ? isBackWinner ? "lost" : "won"
    : isBackWinner ? "won" : "lost";
};

const getTeenpattiProfitLoss = (bet, updateStatus) => {
    const amount = parseFloat(bet?.amount || 0);
    const odds = parseFloat(bet?.uRate || 0);

    const FIXED = {
        Flush: 4,
        Straight: 6,
        Trio: 30,
        "Straight Flush": 40,
    };

    const subType = bet?.subType?.endsWith("1")
        ? bet.subType.slice(0, -1)
        : bet?.subType;

    const payoutOdds =
      isTeenpatti20Bet(bet) && FIXED[bet.settledHand]
          ? FIXED[bet.settledHand]
          : odds;

    // BACK BET
    if (bet?.betType !== "lay") {
        if (updateStatus === "lost") {
            return -amount;
        }

        return Number(((payoutOdds - 1) * amount).toFixed(2));
      // return Number(((payoutOdds) * amount).toFixed(2));
    }


    // LAY BET
    if (updateStatus === "won") {
        // Profit = stake
       // return amount; //layWon Changes
       // return Number((payoutOdds * amount).toFixed(2));
         //return Number(((payoutOdds - 1) * amount).toFixed(2));
           return Number(amount.toFixed(2));
    }

    // Lose liability
    return -Number(((payoutOdds - 1) * amount).toFixed(2));
    //return -Number(((payoutOdds) * amount).toFixed(2));
};

// const getOddsProfitLoss = (bet, updateStatus) => {
//   const amount = parseFloat(bet?.amount || 0);
//   if (updateStatus === "lost") return -amount;

//   return Number(
//     (((parseFloat(bet?.uRate || 0) || 0) - 1) * amount).toFixed(2)
//    // (((parseFloat(bet?.uRate || 0) || 0)) * amount).toFixed(2)
//   );
// };

const getOddsProfitLoss = (bet, updateStatus) => {
  const amount = parseFloat(bet?.amount || 0);
  if(bet?.betType==="lay"){
    if(updateStatus==='won'){
      return amount;
    }else{
      return -(((parseFloat(bet?.uRate || 0) || 0) - 1) * amount).toFixed(2)
    }
  }else{
    if (updateStatus === "lost") return -amount;
 
    return Number(
      (((parseFloat(bet?.uRate || 0) || 0) - 1) * amount).toFixed(2)
    );
  }
 
};

const applyLayToBackStatus = (bet, backStatus) => {
  if (bet?.betType !== "lay") return backStatus;
  if (backStatus === "won") return "lost";
  if (backStatus === "lost") return "won";
  return backStatus;
};

const applyTeenJokerProfitLoss = (bet, updateStatus, profitLoss) => {
  if (!["won", "lost"].includes(updateStatus)) return profitLoss;
  if (isTeenpattiBet(bet)) return getTeenpattiProfitLoss(bet, updateStatus);
  if (isJokerBet(bet)) return getOddsProfitLoss(bet, updateStatus);
  return profitLoss;
};


const getDoliDanaBetStatus = (resultData, bet) => {
  const normalize = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

  const section = normalize(bet?.sectionName);
  const betType = normalize(bet?.betType);

  const resultParts = String(resultData?.rdesc || "")
    .split("#")
    .map(normalize)
    .filter(Boolean);

  /*
   API response:
   rdesc: "Player B#Player A"

   parts[0] = Turn Player
   parts[1] = Winner
  */
  const winner = resultParts[1] || normalize(resultData?.winnat);

  const cards = String(resultData?.card || resultData?.winnat || "")
    .split(",")
    .map((card) => Number(String(card).trim()))
    .filter((card) => Number.isFinite(card));

  const card1 = cards[0];
  const card2 = cards[1];

  const hasTwoCards = cards.length >= 2;
  const total = hasTwoCards ? card1 + card2 : null;
  const isPair = hasTwoCards && card1 === card2;

  let isBackWinner = false;

  // Player A / Player B
  if (section === "player a" || section === "player b") {
    isBackWinner = winner === section;
  }

  // Any Pair
  else if (section === "any pair") {
    isBackWinner = isPair;
  }

  // Odd / Even
  else if (section === "odd") {
    isBackWinner = total !== null && total % 2 !== 0;
  } else if (section === "even") {
    isBackWinner = total !== null && total % 2 === 0;
  }

  // Particular Pair: 1-1 Pair, 2-2 Pair etc.
  else {
    const pairMatch = section.match(/^(\d+)\s*-\s*(\d+)\s*pair$/i);

    if (pairMatch) {
      const selectedCard1 = Number(pairMatch[1]);
      const selectedCard2 = Number(pairMatch[2]);

      isBackWinner =
        hasTwoCards &&
        card1 === selectedCard1 &&
        card2 === selectedCard2;
    }

    // Sum Total 2, Sum Total 3 etc.
    else {
      const totalMatch = section.match(/^sum\s*total\s*(\d+)$/i);

      if (totalMatch) {
        isBackWinner =
          total !== null && total === Number(totalMatch[1]);
      }

      // Less than 7
      else if (
        section === "<7" ||
        section === "under 7" ||
        section === "less than 7"
      ) {
        isBackWinner = total !== null && total < 7;
      }

      // Greater than 7
      else if (
        section === ">7" ||
        section === "over 7" ||
        section === "greater than 7"
      ) {
        isBackWinner = total !== null && total > 7;
      }
    }
  }

  const updateStatus =
    betType === "lay"
      ? isBackWinner
        ? "lost"
        : "won"
      : isBackWinner
        ? "won"
        : "lost";

  console.log("DOLIDANA SETTLEMENT DEBUG", {
    sectionName: bet?.sectionName,
    betType,
    card: resultData?.card,
    cards,
    card1,
    card2,
    total,
    isPair,
    winner,
    isBackWinner,
    updateStatus,
  });

  return updateStatus;
};
const isMogamboThreeCardTotalBet = (bet) => {
  const gType = String(bet?.gType || "").trim().toLowerCase();
  const subType = String(bet?.subType || "").trim().toLowerCase();
  const sectionName = String(bet?.sectionName || "")
    .trim()
    .toLowerCase();

  return (
    gType === "mogambo" &&
    (
      subType === "total" ||
      sectionName.includes("3 card total") ||
      sectionName.includes("total")
    )
  );
};

// const isMogamboThreeCardTotalBet = (bet) => {
//   const gType = String(bet?.gType || "")
//     .trim()
//     .toLowerCase();

//   const subType = String(bet?.subType || "")
//     .trim()
//     .toLowerCase();

//   const sectionName = String(bet?.sectionName || "")
//     .trim()
//     .toLowerCase();

//   return (
//     gType === "mogambo" &&
//     (
//       subType === "total" ||
//       sectionName.includes("3 card total")
//     )
//   );
// };

const getMogamboThreeCardTotalPL = (bet, updateStatus) => {
  const amount = Number(bet?.amount || 0);

  const betType = String(bet?.betType || "")
    .trim()
    .toLowerCase();

  
  const bhav = Number(bet?.bhav || 0);

  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }

  if (!Number.isFinite(bhav) || bhav <= 0) {
    console.error("INVALID MOGAMBO BHAV", {
      betId: bet?._id,
      sectionName: bet?.sectionName,
      betType,
      bhav: bet?.bhav,
      uRate: bet?.uRate,
    });

    return 0;
  }

  // BACK
  if (betType === "back") {
    if (updateStatus === "won") {
      // Example: bhav 70, amount 100 => +70
      return Number(((bhav * amount) / 100).toFixed(2));
    }

    // Back lost => full stake loss
    return -Number(amount.toFixed(2));
  }

  // LAY
  if (betType === "lay") {
    if (updateStatus === "won") {
      // Lay won => full stake profit
      return Number(amount.toFixed(2));
    }

    // Example: bhav 90, amount 100 => -90
    return -Number(((bhav * amount) / 100).toFixed(2));
  }

  return 0;
};



async function checkSportCasinoBettingResult(marketId) {
  try {
    const bets = await betsSportGroupingByMarketIdAndUserId(
      marketId,
      inProcessMarket
    );

    if (!bets?.length) {
      // console.log("No pending bets found.");
      return;
    }
    console.log(`Found ${bets.length} pending bets`, bets);
    // market id wise mapping

    const updateBets = bets?.filter(
      (item) =>
        !inProcessMarket?.some(
          (b) => b?.cType === item?.cType && b?._id === item?._id
        )
    );
   
    

    updateBets.forEach((item) => {
      inProcessMarket.push({
        cType: item?.cType,
        _id: item?._id,
      });
    });
    for (const markets of updateBets) {
      try {
        const gameDetails = await apiRequest({
         // url: `front/accstatepopup`,
          // data: {
          //   gmid: 0,
          //   mid: markets._id,
          //   gtype: markets?.cType,
          //   dtype: "cs",
          // },

          //  url: `casino/detail_result`,
          //   apiAction: "GET",
          //   host: process.env.JSK_CASINO_SERVER_URL,
           
          //   data: { 
          //     gmid: 0,
          //     type: markets?.cType,   
          //     mid: markets?._id,     
          //     key: process.env.JSK_KEY,
          //     dtype: "cs", 
          //   },
           // url: `casino/detail_result`,
             url:  `detail_casino_results`,
                apiAction: "GET",
               // host: process.env.JSK_CASINO_SERVER_URL,
                   host: "https://diamond-casino-api-demo-s2.avrkhub.in",
                data: {
                  gmid: 0,
                  //type: markets?.cType,
                  gtype: markets?.cType,
                 // mid: markets?.gameId,
                 mid: markets?.gameId || markets?._id,
                 // key: process.env.JSK_KEY,
                  key: "V67JKNJKMM8BOKJLMKN",
                  dtype: "cs",
                },
                noEncrypt: true,
        });
           console.log("==== API DEBUG START2 For CASINO SPORTSS ====");
          //console.log("MarketId:", markets?._id);
          console.log("MarketId:", markets?.gameId || markets?._id);
          console.log("GType:", markets?.cType);
          console.log("Full API Response:", JSON.stringify(gameDetails, null, 2));
          console.log("T1 DATA:", gameDetails?.data?.data.t1);
          console.log("==== API DEBUG END2 CASINO SPORTSS ====");

        if (!gameDetails?.data?.data.t1) {
          console.error(
            `❌ result not found (marketId: ${markets._id}, gtype: ${markets?.cType}):`
          );

          inProcessMarket = inProcessMarket.filter(
            (item) => item._id !== markets._id || item.cType !== markets?.cType
          );
          continue;
        }

        // users wise mapping
        for (const user of markets?.users ?? []) {
          try {
            const resultData = gameDetails.data.data.t1;
            //console.log("Casino API RESULT2:", result);
            console.log("Casino API RESULT2:", resultData);
            const rdesc = resultData?.rdesc ? resultData.rdesc.split("#") : [];
            let balance = 0;
            let updateExp = 0;
            let updatePartnerExp = 0;
            let bulkOps = [];
            let casinoLostBets = [];
            const fancyBet =
              user?.bets?.filter(
                (bet) => bet?.gType?.toLowerCase() === "fancy1"
              ) ?? [];
            const subFancySectionMap = new Map();
            fancyBet.forEach((bet) => {
              const key = bet.sectionId || "unknown";
              if (!subFancySectionMap.has(key)) {
                subFancySectionMap.set(key, []);
              }
              subFancySectionMap.get(key).push(bet);
            });
            const fancyBetNestedArray = Array.from(subFancySectionMap.values());
            const fancy1Bet =
              user?.bets?.filter(
                (bet) => bet?.gType?.toLowerCase() === "fancy"
              ) ?? [];
            const matchBet =
              user?.bets?.filter(
                (bet) => bet?.gType?.toLowerCase() === "match1"
              ) ?? [];
            const subSectionMap = new Map();
            fancy1Bet.forEach((bet) => {
              const key = bet.sectionId || "unknown";
              if (!subSectionMap.has(key)) {
                subSectionMap.set(key, []);
              }
              subSectionMap.get(key).push(bet);
            });
            const fancyOneBetNestedArray = Array.from(subSectionMap.values());

            const subTypeMap = new Map();
            matchBet.forEach((bet) => {
              const key = bet.marketId || "unknown";
              if (!subTypeMap.has(key)) {
                subTypeMap.set(key, []);
              }
              subTypeMap.get(key).push(bet);
            });
            const matchBetNestedArray = Array.from(subTypeMap.values());
            for (const betSubType of fancyBetNestedArray) {
              const findSpotsData = await getSportsData({
                mid: betSubType?.[0]?.marketId,
                userId: user?.userId,
              });

              for (const bet of betSubType) {
                try {
                   if (["roulette11", "roulette13", "roulette12", "ourroullete"].includes(bet?.gType)) {
                    console.log("🎰 ========MATCH LOOP HIT======", {
                      betId: bet?._id,
                      eType: bet?.eType,
                      gType: bet?.gType,
                      sectionName: bet?.sectionName,
                      betType: bet?.betType,
                      status: bet?.status,
                    });
                  }
                  let updateStatus = bet?.status;
                  let profitLoss = 0;

                  const { sectionName, uRate, sectionId, gameId } = bet;
                  const parts = sectionName?.trim()?.split(" ");
                  const lastWord = parts?.[parts.length - 1];
                  const betType = parts[2]?.toLowerCase() ?? lastWord ?? "";
                  const overBall = parts[0];
                  const ballNumber = parseInt(overBall?.split(".")[1]);

                  let ballData = [];
                  if (overBall?.toUpperCase() === "COMMON") {
                    ballData = resultData?.score?.filter(
                      (r) => r.nat?.toUpperCase() === lastWord?.toUpperCase()
                    );
                  } else {
                    const data = resultData?.score?.filter(
                      (r) => r.nat?.toUpperCase() === lastWord?.toUpperCase()
                    );

                    ballData = [data?.[ballNumber - 1]];
                  }

                  const totalRuns =
                    ballData?.reduce((sum, b) => sum + b?.run, 0) ?? 0;
                  const totalWkts = ballData?.filter((b) => b?.wkt).length ?? 0;
                  const hasBoundary =
                    ballData?.some((b) => [4, 6].includes(b?.run)) ?? false;

                  const condition = {
                    wicket: totalWkts > 0,
                    zero: totalRuns === 0,
                    one: totalRuns === 1,
                    two: totalRuns === 2,
                    three: totalRuns === 3,
                    boundry: hasBoundary,
                    runs: totalRuns,
                    tie: resultData?.winnat?.toLowerCase()?.trim() === "tie",
                  };
                  if (bet?.betType === "lay") {
                    if (condition[betType]) {
                      updateStatus = "lost";
                    } else {
                      updateStatus = "won";
                    }
                  } else {
                    if (condition[betType]) {
                      updateStatus = "won";
                    } else {
                      updateStatus = "lost";
                    }
                  }

                  if (["won", "lost"].includes(updateStatus)) {
                    const superOverGameType = String(
                      markets?.cType ||
                      bet?.cType ||
                      bet?.gameType ||
                      bet?.type ||
                      ""
                    )
                      .trim()
                      .toLowerCase();

                    const currentGType = String(bet?.gType || "")
                      .trim()
                      .toLowerCase();


        const superOverTypeValues = [
          markets?.cType,
          markets?.gameType,
          markets?.type,
          bet?.cType,
          bet?.gameId,
          bet?.gameType,
          bet?.type,
        ]
    .filter(Boolean)
    .map((value) =>
      String(value)
        .trim()
        .toLowerCase()
    );

  const isSuperOverGame = superOverTypeValues.some((value) =>
    [
      "superover3",
      "superover",
      "superover2",
      "cricketv3",
    ].includes(value)
  );

  const isSuperOverFancy1 =
    isSuperOverGame &&
    currentGType === "fancy1";

  if (isSuperOverFancy1) {
    const amount = Number(bet?.amount || 0);

    const currentBetType = String(bet?.betType || "")
      .trim()
      .toLowerCase();

    // const bhav = Number(
    //   bet?.size ??
    //   bet?.bhav ??
    //   0
    // );

    // if (
    //   !Number.isFinite(amount) ||
    //   amount <= 0 ||
    //   !Number.isFinite(bhav) ||
    //   bhav <= 0
    // ) {
    //   profitLoss = 0;

    //   console.error("INVALID SUPEROVER FANCY1 BHAV", {
    //     betId: bet?._id,
    //     superOverTypeValues,
    //     currentGType,
    //     sectionName: bet?.sectionName,
    //     betType: currentBetType,
    //     uRate: bet?.uRate,
    //     size: bet?.size,
    //     bhav: bet?.bhav,
    //     amount: bet?.amount,
    //   });
    // } else if (currentBetType === "back") {
    //   if (updateStatus === "won") {
    //     profitLoss = Number(
    //       ((bhav * amount) / 100).toFixed(2)
    //     );
    //   } else {
    //     profitLoss = -Number(
    //       amount.toFixed(2)
    //     );
    //   }
    // } else if (currentBetType === "lay") {
    //   if (updateStatus === "won") {
    //     profitLoss = Number(
    //       amount.toFixed(2)
    //     );
    //   } else {
    //     profitLoss = -Number(
    //       ((bhav * amount) / 100).toFixed(2)
    //     );
    //   }
    // }

    // console.log("SUPEROVER FANCY1 FINAL SETTLEMENT", {
    //   betId: bet?._id,
    //   superOverTypeValues,
    //   isSuperOverGame,
    //   isSuperOverFancy1,
    //   currentGType,
    //   sectionName: bet?.sectionName,
    //   betType: currentBetType,
    //   updateStatus,
    //   uRate: bet?.uRate,
    //   size: bet?.size,
    //   storedBhav: bet?.bhav,
    //   finalBhav: bhav,
    //   amount,
    //   profitLoss,
    //                 });

    const odds = Number(bet?.uRate || 0);

    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !Number.isFinite(odds) ||
      odds <= 0
    ) {
      profitLoss = 0;

      console.error("INVALID SUPEROVER FANCY1 ODDS", {
        betId: bet?._id,
        superOverTypeValues,
        currentGType,
        sectionName: bet?.sectionName,
        betType: currentBetType,
        uRate: bet?.uRate,
        amount: bet?.amount,
      });
    } else if (currentBetType === "back") {
      if (updateStatus === "won") {
        // Back won = (odds - 1) * stake
        profitLoss = Number(
          ((odds - 1) * amount).toFixed(2)
        );
      } else {
        // Back lost = stake
        profitLoss = -Number(amount.toFixed(2));
      }
    } else if (currentBetType === "lay") {
      if (updateStatus === "won") {
        // Lay won = stake
        profitLoss = Number(amount.toFixed(2));
      } else {
        // Lay lost = liability = (odds - 1) * stake
        profitLoss = -Number(
          ((odds - 1) * amount).toFixed(2)
        );
      }
    }

    console.log("SUPEROVER FANCY1 FINAL SETTLEMENT", {
      betId: bet?._id,
      superOverTypeValues,
      isSuperOverGame,
      isSuperOverFancy1,
      currentGType,
      sectionName: bet?.sectionName,
      betType: currentBetType,
      updateStatus,
      uRate: bet?.uRate,
      odds,
      amount,
      profitLoss,
    });




                  } else if (isTeenpattiBet(bet)) {
                      profitLoss = getTeenpattiProfitLoss(bet, updateStatus);
                    } else if (isJokerBet(bet)) {
                      profitLoss = getOddsProfitLoss(bet, updateStatus);
                    } else if (bet?.betType === "lay" && updateStatus === "won") {
                      // profitLoss = applyTeenJokerProfitLoss(
                      //   bet,
                      //   updateStatus,
                      //   parseFloat(bet?.amount || 0)
                      // );
                      //// layWon Changes
                        //  profitLoss = applyTeenJokerProfitLoss(
                        //   bet,
                        //   updateStatus,
                        //   Number(
                        //     (
                        //       parseFloat(bet?.uRate || 0) *
                        //       parseFloat(bet?.amount || 0)
                        //     ).toFixed(2)
                        //   )
                        // );
                          profitLoss = Number(
                            parseFloat(bet?.amount || 0).toFixed(2)
                          );
                    } else if (
                      bet?.betType === "lay" &&
                      updateStatus === "lost"
                    ) {
                      // profitLoss = applyTeenJokerProfitLoss(
                      //   bet,
                      //   updateStatus,
                      //   Number(
                      //     (
                      //       -1 *
                      //       ((parseFloat(bet?.uRate || 0) - 1) *
                      //       //((parseFloat(bet?.uRate || 0)) *
                      //         parseFloat(bet?.amount || 0))
                      //     ).toFixed(2)
                      //   )
                      // ); //layLost Change
                        profitLoss = applyTeenJokerProfitLoss(
                        bet,
                        updateStatus,
                        Number(
                          (
                            -1 *
                           // ((parseFloat(bet?.uRate || 0)) *
                           ((parseFloat(bet?.uRate || 0) - 1) *
                              parseFloat(bet?.amount || 0))
                          ).toFixed(2)
                        )
                      );
                    } else if (updateStatus === "won") {
                      profitLoss = Number(
                        (
                          (parseFloat(bet?.uRate || 0) - 1) *
                         //(parseFloat(bet?.uRate || 0)) *
                          parseFloat(bet?.amount || 0)
                        ).toFixed(2)
                      );
                    } else {
                      profitLoss = -parseFloat(bet?.amount || 0);
                    }
                    profitLoss = applyTeenJokerProfitLoss(bet, updateStatus, profitLoss);
                    if (updateStatus === "lost") {
                      casinoLostBets.push({
                        ...bet.toObject?.() ?? bet,
                        status: "lost",
                        eventName: resultData?.ename ?? bet.eventName,
                      });
                    }
                    bulkOps.push({
                      updateOne: {
                        filter: { _id: bet._id, status: "pending" },
                        update: {
                          $set: {
                            profit: profitLoss,
                            status: updateStatus,
                            eventName: resultData?.ename,
                            cresult: resultData,
                          },
                        },
                      },
                    });
                    balance += profitLoss;
                  }
                } catch (err) {
                  console.error(
                    `Error processing bet (market ${markets._id}) betId:${bet._id || "unknown"
                    }`,
                    err
                  );
                }
              }

              const checkExp = findSpotsData?.sdata?.find(
                (exp) => exp?.sid === betSubType?.[0]?.sectionId
              );
              if (checkExp) {
                const maxMinusAmt = (checkExp.amount ?? 0) * -1;
                updateExp += maxMinusAmt;

                const maxExp = Math.max(
                  0,
                  ...(checkExp?.calcTable || [])
                    .map((r) => r.profitLoss)
                    .filter((v) => v > 0)
                );
                updatePartnerExp += maxExp;
              }
            }
            for (const betSubType of fancyOneBetNestedArray) {
              const findSpotsData = await getSportsData({
                mid: betSubType?.[0]?.marketId,
                userId: user?.userId,
              });
              for (const bet of betSubType) {
                try {
                  let updateStatus = bet?.status;
                  let profitLoss = 0;

                  const { sectionName, uRate, sectionId, gameId } = bet;
                  const targetRun = uRate;
                  let totalRuns = 0;
                  if (gameId === "cricketv3") {
                    const parts = sectionName?.trim()?.split(" ");
                    const teamName = parts?.[0];
                    const over = parseInt(parts?.[parts.length - 1] ?? 0);
                    const overBalls = resultData?.score
                      .filter(
                        (r) => r.nat.toUpperCase().includes(teamName)
                        // ||
                        //   team.includes(r.nat.toUpperCase())
                      )
                      .filter((r) => r.oc <= over);

                    totalRuns = overBalls.reduce((sum, b) => sum + b.run, 0);
                  } else {
                    const parts = sectionName?.trim()?.split(" ");
                    const lastWord = parts?.[parts.length - 1];

                    const overBalls = resultData?.score?.filter(
                      (r) => r.nat === lastWord
                    );
                    totalRuns = overBalls.reduce((sum, b) => sum + b.run, 0);
                  }

                  if (bet?.betType === "lay") {
                    if (totalRuns >= targetRun) {
                      updateStatus = "lost";
                    } else {
                      updateStatus = "won";
                    }
                  } else {
                    if (totalRuns >= targetRun) {
                      updateStatus = "won";
                    } else {
                      updateStatus = "lost";
                    }
                  }
                  if (["won", "lost"].includes(updateStatus)) {
                    if (isTeenpattiBet(bet)) {
                      profitLoss = getTeenpattiProfitLoss(bet, updateStatus);
                    } else if (isJokerBet(bet)) {
                      profitLoss = getOddsProfitLoss(bet, updateStatus);
                    } else if (bet?.betType === "lay" && updateStatus === "won") {

                        profitLoss = Number(
                          parseFloat(bet?.amount || 0).toFixed(2)
                        );
                    } else if (
                      bet?.betType === "lay" &&
                      updateStatus === "lost"
                    ) {
                      
                        // profitLoss = applyTeenJokerProfitLoss(
                        //   bet,
                        //   updateStatus,
                        //   Number(
                        //     (
                        //       -1 *
                        //      // ((parseFloat(bet?.uRate || 0)) *
                        //      ((parseFloat(bet?.uRate || 0) - 1) *
                        //         parseFloat(bet?.amount || 0))
                        //     ).toFixed(2)
                        //   )
                        // );

                      const sportsCasinoType = String(
                        markets?.cType ||
                        bet?.cType ||
                        bet?.gameId ||
                        bet?.gameType ||
                        bet?.type ||
                        ""
                      )
                        .trim()
                        .toLowerCase();

                      const isSuperOverFancy =
                        [
                          "superover3",
                          "superover",
                          "superover2",
                          "cricketv3",
                        ].includes(sportsCasinoType) &&
                        String(bet?.gType || "")
                          .trim()
                          .toLowerCase() === "fancy";

                      if (isSuperOverFancy) {
                        const amount = Number(bet?.amount || 0);
                        const bhav = Number(bet?.size ?? bet?.bhav ?? 0);

                        profitLoss = -Number(
                          ((bhav * amount) / 100).toFixed(2)
                        );

                        console.log("SUPEROVER FANCY LAY LOST BHAV", {
                          betId: bet?._id,
                          sportsCasinoType,
                          gType: bet?.gType,
                          sectionName: bet?.sectionName,
                          betType: bet?.betType,
                          updateStatus,
                          uRate: bet?.uRate,
                          size: bet?.size,
                          bhav: bet?.bhav,
                          finalBhav: bhav,
                          amount,
                          profitLoss,
                        });
                      } else {
                        profitLoss = applyTeenJokerProfitLoss(
                          bet,
                          updateStatus,
                          Number(
                            (
                              -1 *
                              ((parseFloat(bet?.uRate || 0) - 1) *
                                parseFloat(bet?.amount || 0))
                            ).toFixed(2)
                          )
                        );
                      }
                    } else if (updateStatus === "won") {
                      profitLoss =
                        (parseFloat(bet?.size || 0) *
                          parseFloat(bet?.amount || 0)) /
                        100;
                    } else {
                      profitLoss = -parseFloat(bet?.amount || 0);
                    }
                  }
                  profitLoss = applyTeenJokerProfitLoss(bet, updateStatus, profitLoss);
                  if (updateStatus === "lost") {
                    casinoLostBets.push({
                      ...bet.toObject?.() ?? bet,
                      status: "lost",
                      eventName: resultData?.ename ?? bet.eventName,
                    });
                  }
                  bulkOps.push({
                      updateOne: {
                        filter: { _id: bet._id, status: "pending" },
                        update: {
                          $set: {
                            profit: profitLoss,
                            status: updateStatus,
                            eventName: resultData?.ename,
                            cresult: resultData,
                          },
                        },
                      },
                    });
                    balance += profitLoss;
                } catch (err) {
                  console.error(
                    `Error processing bet (market ${markets._id}) betId:${bet._id || "unknown"
                    }`,
                    err
                  );
                }
              }


              // Recalculate exposure/profit scenarios from the bets themselves to avoid race conditions with SportsData
              // (SportsData might contain new bets that came in during processing, leading to over-release of exposure)
              let minPL = 0;
              let maxPL = 0;

              if (betSubType && betSubType.length > 0) {
                const pls = calculateFancyPLs(betSubType); // Returns array of run PLs
                minPL = Math.min(0, ...pls);
                maxPL = Math.max(0, ...pls);
              }

              const maxMinusAmt = minPL * -1; // minPL is negative exposure, so release is positive
              updateExp += maxMinusAmt;
              updatePartnerExp += maxMinusAmt;
            }


            for (const betSubType of matchBetNestedArray) {
              for (const bet of betSubType) {
                try {
                  let updateStatus = bet?.status;
                  let profitLoss = 0;
                  const section = bet?.sectionName
                    ?.replace("Main", "")
                    ?.toLowerCase()
                    ?.trim();
                  const winnat = resultData?.winnat?.toLowerCase()?.trim();
                  // if (bet?.betType === "lay") {
                  //   if (winnat === section) {
                  //     updateStatus = "lost";
                  //   } else {
                  //     updateStatus = "won";
                  //   }
                  // } else {
                  //   if (winnat === section) {
                  //     updateStatus = "won";
                  //   } else {
                  //     updateStatus = "lost";
                  //   }
                  // }
                 // updateStatus = getTeenpattiBetStatus(resultData, bet); ///////mychanges
                    // const gameType = bet?.cType || bet?.gType;
                    const gameType = bet?.cType || bet?.gameType || bet?.type || markets?.cType || bet?.gType;
                    if (["superover3", "superover", "superover2", "cricketv3"].includes(gameType)) {
                      const selectedTeam = String(bet?.sectionName || "")
                        .replace("Main", "")
                        .trim()
                        .toLowerCase();

                      const winnerTeam = String(resultData?.winnat || "")
                        .trim()
                        .toLowerCase();

                        if (winnerTeam === "tie") { ////superover Tie Case
                            updateStatus = "tie";
                        } else {
                            const isWin = selectedTeam === winnerTeam;
                            updateStatus =
                              bet?.betType === "lay"
                                ? (isWin ? "lost" : "won")
                                : (isWin ? "won" : "lost");
                        }       
                    } else {
                      updateStatus = getTeenpattiBetStatus(resultData, bet);
                    }

                  if (updateStatus === "tie") { ////superover Tie Case
                      profitLoss = 0;
                        bulkOps.push({
                            updateOne: {
                                filter: {
                                    _id: bet._id,
                                    status: "pending"
                                },
                                update: {
                                    $set: {
                                        profit: 0,
                                        status: "tie",
                                        eventName: resultData?.ename,
                                        cresult: resultData
                                    }
                                }
                            }
                        });
                    // end superover Tie Case
                  } 
                  else if (["won", "lost"].includes(updateStatus)) {

                    if (isTeenpattiBet(bet)) {
                      profitLoss = getTeenpattiProfitLoss(bet, updateStatus);
                    } else if (isJokerBet(bet)) {
                      profitLoss = getOddsProfitLoss(bet, updateStatus);
                    } else if (bet?.betType === "lay" && updateStatus === "won") {
                      // profitLoss = applyTeenJokerProfitLoss(
                      //   bet,
                      //   updateStatus,
                      //   parseFloat(bet?.amount || 0)
                      // ); ////////layWon Changes
                      //  profitLoss = applyTeenJokerProfitLoss(
                      //   bet,
                      //   updateStatus,
                      //   Number(
                      //     (
                      //       parseFloat(bet?.uRate || 0) *
                      //       parseFloat(bet?.amount || 0)
                      //     ).toFixed(2)
                      //   )
                      // );
                        profitLoss = Number(
                          parseFloat(bet?.amount || 0).toFixed(2)
                        );
                    } else if (
                      bet?.betType === "lay" &&
                      updateStatus === "lost"
                    ) {
                      // profitLoss = applyTeenJokerProfitLoss(
                      //   bet,
                      //   updateStatus,
                      //   Number(
                      //     (
                      //       -1 *
                      //       ((parseFloat(bet?.uRate || 0) - 1) *
                      //        //((parseFloat(bet?.uRate || 0)) *
                      //         parseFloat(bet?.amount || 0))
                      //     ).toFixed(2)
                      //   )
                      // ); //layLost changes

                        profitLoss = applyTeenJokerProfitLoss(
                        bet,
                        updateStatus,
                        Number(
                          (
                            -1 *
                            //((parseFloat(bet?.uRate || 0)) *
                            ((parseFloat(bet?.uRate || 0) - 1) *
                              parseFloat(bet?.amount || 0))
                          ).toFixed(2)
                        )
                      );
                    } else if (updateStatus === "won") {
                      profitLoss = Number(
                        (
                          (parseFloat(bet?.uRate || 0) - 1) *
                         //(parseFloat(bet?.uRate || 0)) *
                          parseFloat(bet?.amount || 0)
                        ).toFixed(2)
                      );
                    } else {
                      profitLoss = -parseFloat(bet?.amount || 0);
                    }
                    
                    profitLoss = applyTeenJokerProfitLoss(bet, updateStatus, profitLoss);
                    if (updateStatus === "lost") {
                      casinoLostBets.push({
                        ...bet.toObject?.() ?? bet,
                        status: "lost",
                        eventName: resultData?.ename ?? bet.eventName,
                      });
                    }
                    bulkOps.push({
                      updateOne: {
                        filter: { _id: bet._id, status: "pending" },
                        update: {
                          $set: {
                            profit: profitLoss,
                            status: updateStatus,
                            eventName: resultData?.ename,
                            cresult: resultData,
                          },
                        },
                      },
                    });
                    balance += profitLoss;
                  }
                } catch (err) {
                  console.error(
                    `Error processing bet (market ${markets._id}) betId:${bet._id || "unknown"
                    }`,
                    err
                  );
                }
              }

              // Recalculate match exposure 
              // Note: Match bets might be complicated by runners. 
              // calculateMatchPLs expects runners. 
              // We can infer runners from section IDs of the bets.
              let minMatchPL = 0;
              let maxMatchPL = 0;

              if (betSubType && betSubType.length > 0) {
                const runners = Array.from(new Set(betSubType.map(b => b.sectionId))).map(sid => ({ sid }));
                const scenarios = calculateMatchPLs(betSubType, runners);
                minMatchPL = Math.min(0, ...scenarios.map(s => s.pl));
                maxMatchPL = Math.max(0, ...scenarios.map(s => s.pl));

                // Match exposure logic also includes "Lose all" scenario check in calculateMarketExposure?
                // Original bettingResultChecker logic used `findSpotsData` min amount.
                // `findSpotsData` in match is usually calculated by `bet.controller` using `calculateMarketExposure` which does `Math.min(mainExp, loseAllPL)`.
                // We should replicate that.

                let loseAllPL = 0;
                betSubType.forEach(bet => {
                  if (bet.betType === "back") loseAllPL -= Number(bet.amount);
                  else loseAllPL += Number(bet.amount);
                });

                minMatchPL = Math.min(minMatchPL, loseAllPL);
              }

              const maxMinusAmt = minMatchPL * -1;
              updateExp += maxMinusAmt;
              updatePartnerExp += maxMinusAmt;
            }
            // winning/loss wise update betting status and users balance
            if (bulkOps.length > 0 || balance !== 0 || updateExp !== 0) {
              try {
                // 1. Update Balance (Profit/Loss)
                // const updatedUser = await atomicUpdateUserFinance(
                //   user?.userId,
                //   { balance }, 
                //   { allowNegativeBuffer: true }
                // );

                // if (!updatedUser) {
                //   console.warn("User not found:", user?.userId);
                // } else {
                //   // 2. SELF-HEALING: Recalculate true exposure from scratch
                //   const expDelta = await recalculateUserExposureAndGetDelta(user?.userId);

                //   // Execute bulk bet updates only after balance success
                //   if (bulkOps.length > 0) {
                //     await Bet.bulkWrite(bulkOps, { ordered: false });
                //   }

                //   const cacheKey = `user:${updatedUser._id}`;
                //   await setCache(cacheKey, updatedUser, 60);

                //   // 3. Propagate accurate delta
                //   await distributeCommissionHierarchy(updatedUser, {
                //     exp: expDelta,
                //     profit: balance,
                //   });
                // }
                //=========mychange below
                const updatedUser = await atomicUpdateUserFinance(
                  user?.userId,
                  { balance },
                  { allowNegativeBuffer: true }
                );

                if (!updatedUser) {
                  console.warn("User not found:", user?.userId);
                } else {
                  // 1. Actually settle the bets
                  let verifiedBalance = 0;
                  let verifiedLostBets = [];
                  let verifiedBetOps = [];

                  if (bulkOps.length > 0) {
                    for (const op of bulkOps) {
                      const res = await Bet.updateOne(
                        op.updateOne.filter,
                        op.updateOne.update
                      );

                      // Only process bets that were actually settled
                      if (res.modifiedCount > 0) {
                        verifiedBalance +=
                          op.updateOne.update.$set.profit || 0;

                            // Successfully settled bet track 
                            verifiedBetOps.push(op);

                        const settledBetId = op.updateOne.filter?._id;

                        const lostBet = casinoLostBets.find(
                          (bet) =>
                            String(bet._id) === String(settledBetId)
                        );

                        if (lostBet) {
                          verifiedLostBets.push(lostBet);
                        }
                      }
                    }
                  }

                       // ==========================================
                        // SAVE prevBal / currBal
                        // ==========================================

                        if (verifiedBetOps.length > 0) {
                          const finalBalance = Number(
                            updatedUser.balance || 0
                          );

                          const totalProfit = verifiedBetOps.reduce(
                            (sum, op) =>
                              sum +
                              Number(
                                op?.updateOne?.update?.$set?.profit || 0
                              ),
                            0
                          );

                          // First bet previous balance
                          let runningBalance = Number(
                            (finalBalance - totalProfit).toFixed(2)
                          );

                          const balanceOps = [];

                          for (const op of verifiedBetOps) {
                            const profit = Number(
                              op?.updateOne?.update?.$set?.profit || 0
                            );

                            const prevBal = Number(
                              runningBalance.toFixed(2)
                            );

                            const currBal = Number(
                              (runningBalance + profit).toFixed(2)
                            );

                            balanceOps.push({
                              updateOne: {
                                filter: {
                                  _id: op?.updateOne?.filter?._id,
                                },
                                update: {
                                  $set: {
                                    prevBal,
                                    currBal,
                                  },
                                },
                              },
                            });

                            // Next bet  prevBal = current bet currBal
                            runningBalance = currBal;
                          }

                          if (balanceOps.length > 0) {
                            await Bet.bulkWrite(balanceOps, {
                              ordered: false,
                            });
                          }
                        }

                  // 2. Recalculate exposure
                  const expDelta =
                    await recalculateUserExposureAndGetDelta(user?.userId);

                  // 3. Fetch fresh user
                  const latestUser = await User.findById(user?.userId)
                    .select("username balance exp")
                    .lean();

                  if (!latestUser) {
                    throw new Error(
                      `Updated user ${user?.userId} not found`
                    );
                  }

                  // 4. Cache fresh user
                  await setCache(
                    `user:${user?.userId}`,
                    latestUser,
                    60
                  );

                  // 5. Normal hierarchy
                  await distributeCommissionHierarchy(
                    latestUser,
                    {
                      exp: expDelta,
                      profit: verifiedBalance,
                    }
                  );

                  // 6. CASINO COMMISSION HIERARCHY
                  for (const lostBet of verifiedLostBets) {
                    await distributeCasinoCommissionHierarchy(
                      latestUser,
                      lostBet
                    );
                  }
                }

                // Cleanup SportsData if no pending bets remain
                const pendingBetsCount = await Bet.countDocuments({
                  userId: user?.userId,
                  marketId: markets?._id,
                  status: "pending",
                  isActive: true,
                });

                if (pendingBetsCount === 0) {
                  await updateSportsData(markets?._id, user?.userId, { sdata: [] });
                }
              } catch (err) {
                console.error(
                  `Error updating user balance/exp for userId:${user?.userId}`,
                  err
                );
              }
            }
          } catch (err) {
            console.error(
              `Error processing user ${user?.userId} for market ${markets._id}:`,
              err
            );
          }
        }
        // Market level cleanup of all ghost exposure for this market
        try {
          await mongoose.model("SportsData").deleteMany({ mid: markets._id });
        } catch (e) {
          console.error("Error cleaning up SportsData:", e);
        }

        inProcessMarket = inProcessMarket.filter(
          (item) => item._id !== markets._id || item.gType !== markets?.gType
        );
      } catch (error) {
        // console.error(`❌ Error checking (marketId: ${markets._id}):`, error);
        
        // Ensure cleanup even on error
        try {
          await mongoose.model("SportsData").deleteMany({ mid: markets._id });
        } catch (e) {}

        // Always clean up the lock so next cron tick can retry
        inProcessMarket = inProcessMarket.filter(
          (item) => item._id !== markets._id || item.gType !== markets?.gType
        );
      }
    }
    
  } catch (err) {
    console.error("Error while checking betting result:", err);
  }
}


async function checkCasinoBettingResult(marketId) {
  try {
   
    await checkSportCasinoBettingResult(marketId);
    const bets = await betsGroupingByMarketIdAndUserId(
      marketId,
      inProcessMarket
    );
    if (!bets?.length) {
      // console.log("No pending bets found.");
      return;
    }
    console.log(`Found ${bets.length} pending bets`);
    // market id wise mapping
    const updateBets = bets?.filter(
      (item) =>
        !inProcessMarket?.some(
          (b) => b?.gType === item?.gType && b?._id === item?._id
        )
    );

    updateBets.forEach((item) => {
      inProcessMarket.push({
        gType: item?.gType,
        _id: item?._id,
      });
    });
   
    for (const markets of updateBets) {
      try {
        

        const domainData = await Domain.findOne({
          domain: "allpanelexc7.com",
          isCasinoThirdParty: true,
        });

        const isCasinoThirdParty =
          !!domainData &&
          (markets?.users ?? []).some((user) =>
            (user?.bets ?? []).some(
              (bet) => bet?.domain === "allpanelexc7.com"
            )
          );
       let gameDetails;
        if (isCasinoThirdParty) {
            // NEW API
            gameDetails = await apiRequest({
              url: "detail_casino_results",
              apiAction: "GET",
              host: "https://casino.allpanelexc7.com",
              data: {
                gmid: 0,
                gtype: markets?.gType,
                mid: markets?._id,
                dtype: "cs",
              },
              noEncrypt: true,
            });
          } else {
            gameDetails = await apiRequest({
                    url: `detail_casino_results`,
                    apiAction: "GET",
                    host: "https://diamond-casino-api-demo-s2.avrkhub.in",
                  data: { 
                    gmid: 0,
                    gtype: markets?.gType, 
                    mid: markets?._id,  
                    key: "V67JKNJKMM8BOKJLMKN",
                    dtype: "cs", 
                },
                noEncrypt: true,
            });
       }

        console.log("==== API DEBUG START1 ====");
        console.log("MarketId:", markets?._id);
        console.log("GType:", markets?.gType);
        console.log("Full API Response:", JSON.stringify(gameDetails, null, 2));
        console.log("T1 DATA:", gameDetails?.data?.data.t1);
        console.log("==== API DEBUG END1 ====");

        if (!gameDetails?.data?.data.t1) {
          console.error(
            `result not found (marketId: ${markets._id}, gtype: ${markets?.gType}):`
          );
          inProcessMarket = inProcessMarket.filter(
            (item) => item._id !== markets._id || item.gType !== markets?.gType
          );
          continue;
        }

        // users wise mapping
        for (const user of markets?.users ?? []) {
          try {
            //const resultData = gameDetails.data.t1;
        const resultData = gameDetails?.data?.data?.t1;
            console.log("Casino API RESULT1:", resultData);
            const rdesc = resultData?.rdesc
              ? resultData.rdesc.split("#").map((s) => s.trim())
              : [];
            let balance = 0;
            let updateExp = 0;
            let updatePartnerExp = 0;
            let bulkOps = [];
            let casinoLostBets = [];
            const findSpotsData = await getSportsData({
              mid: markets._id,
              userId: user?.userId,
            });
            const fancyBet =
              user?.bets?.filter(
                (bet) => bet?.eType?.toLowerCase() === "fancy"
              ) ?? [];

            const fancy1Bet =
              user?.bets?.filter(
                (bet) =>
                  bet?.eType?.toLowerCase() === "fancy1" ||
                  bet?.eType?.toLowerCase() === "fancy2"
              ) ?? [];
            const matchBet =
              user?.bets?.filter(
                (bet) => bet?.eType?.toLowerCase() === "match"
              ) ?? [];
            const subSectionMap = new Map();
            fancy1Bet.forEach((bet) => {
              const key = bet.sectionId || "unknown";
              if (!subSectionMap.has(key)) {
                subSectionMap.set(key, []);
              }
              subSectionMap.get(key).push(bet);
            });
            const fancyOneBetNestedArray = Array.from(subSectionMap.values());

            const subTypeMap = new Map();
            matchBet.forEach((bet) => {
              const key = bet.subType || "unknown";
              if (!subTypeMap.has(key)) {
                subTypeMap.set(key, []);
              }
              subTypeMap.get(key).push(bet);
            });
            const matchBetNestedArray = Array.from(subTypeMap.values());
            for (const betSubType of fancyOneBetNestedArray) {
              for (const bet of betSubType) {
                try {
                  let updateStatus = bet?.status;
                  let profitLoss = 0;

                  if (["teensin"].includes(bet?.gType)) {
                    const [, , , , lucky9] = rdesc;
                    const { subType } = bet;
                    updateStatus = "lost";
                    if (
                      subType === "lucky9" &&
                      ((bet?.betType === "lay" && lucky9?.toLowerCase() === "no") ||
                        (bet?.betType === "back" && lucky9?.toLowerCase() === "yes"))
                    ) {
                      updateStatus = "won";
                    }
                  } else if (["ballbyball"].includes(bet?.gType)) {
                    const checkBet = {
                      "Extra Runs": [
                        "Wide",
                        "Leg Bye",
                        "Bye",
                        "No Ball",
                        "Extra Runs",
                      ],
                      Wicket: [
                        "Caught",
                        "Bowled",
                        "Run Out",
                        "LBW",
                        "Stumped",
                        "Wicket",
                      ],
                    };
                    const normRdesc = (resultData?.rdesc || "").toLowerCase();
                    const isWin =
                      checkBet?.[bet?.sectionName]?.some(
                        (s) => s.toLowerCase() === normRdesc
                      ) ||
                      rdesc?.some(
                        (r) =>
                          r.toLowerCase() ===
                          bet?.sectionName?.replace("Runs", "Run")?.toLowerCase()
                      );
                    updateStatus = isWin ? "won" : "lost";
                  } else if (["race17"].includes(bet?.gType)) {
                    const [race17, bigCard, zeroCard, oneZeroCard] =
                      resultData?.rdesc?.split("#").map((s) => s.trim());
                    const { subType, sectionName } = bet;

                    const [label, countStr] = sectionName
                      ?.split("-")
                      ?.map((s) => s.trim());

                    const count = parseInt(countStr, 10);
                    const bigCardArr = bigCard
                      ?.split(" ")
                      .filter(Boolean)
                      .map((s) => s.trim());
                    const zeroCardArr = zeroCard
                      ?.split(" ")
                      .filter(Boolean)
                      .map((s) => s.trim());

                    const condition = {
                      race17: race17?.toLowerCase()?.startsWith("yes"),
                      bigcard: bigCardArr?.[count - 1]?.toLowerCase() === "big",
                      anyzero: oneZeroCard?.toLowerCase() === "yes",
                      zerocard: zeroCardArr?.[count - 1]?.toLowerCase() === "yes",
                    };
                    updateStatus = "lost";
                    if (
                      bet?.betType === "lay"
                        ? !condition?.[subType]
                        : condition?.[subType]
                    ) {
                      updateStatus = "won";
                    }
                  } else if (["trio"].includes(bet?.gType)) {
                    const [session, jqk, redBlack, oddEven] = resultData?.rdesc
                      .split("#")
                      .map((s) => s.trim());
                    const { subType } = bet;
                    const lMatch = (a, b) => a?.toLowerCase()?.trim() === b?.toLowerCase()?.trim();
                    const condition = {
                      trio: session?.toLowerCase()?.includes("yes"),
                      even2: lMatch(oddEven, "even"),
                      odd2: lMatch(oddEven, "odd"),
                      black2: lMatch(redBlack, "black"),
                      red2: lMatch(redBlack, "red"),
                      jqk1: lMatch(jqk, "j q k"),
                      124: lMatch(jqk, "1 2 4"),
                    };
                    updateStatus = "lost";
                    if (
                      bet?.betType === "lay"
                        ? !condition?.[subType]
                        : condition?.[subType]
                    ) {
                      updateStatus = "won";
                    }
                  } else if (["patti2"].includes(bet?.gType)) {
                    const [, baccarat, total] = resultData?.rdesc
                      .split("#")
                      .map((s) => s.trim());
                    const { subType, sectionName, uRate } = bet;
                    const condition = {
                      Baccarat: baccarat?.toLowerCase()?.includes(
                        sectionName?.replace("Mini Baccarat", "Player")?.toLowerCase()?.trim()
                      ),
                      total: total?.split("|")?.map((item) => {
                        const [team, total] = item
                          ?.split(":")
                          ?.map((s) => s?.trim());
                        return `Total ${team}/${total}`;
                      }),
                    };
                    updateStatus = "lost";
                    if (subType === "total") {
                      const findTotal = condition?.total?.find((item) =>
                        item.includes(sectionName)
                      );
                      const [teamName, total] = findTotal
                        ?.split("/")
                        ?.map((s) => s?.trim());
                      const win = total >= uRate;
                      if (bet?.betType === "lay" ? !win : win) {
                        updateStatus = "won";
                      }
                    } else if (
                      bet?.betType === "lay"
                        ? !condition?.[subType]
                        : condition?.[subType]
                    ) {
                      updateStatus = "won";
                    }
                  } else if (["notenum"].includes(bet?.gType)) {
                    const [oddEven, blackRed, highLow] = resultData?.rdesc
                      .split("#")
                      .map((s) => s.trim());

                    const { subType, sectionName, betType } = bet;
                    const buildCards = (str) =>
                      str
                        ?.split(" ")
                        ?.filter(Boolean)
                        ?.map((item, index) => `${item} Card ${index + 1}`);

                    const condition = {
                      even: buildCards(oddEven),
                      odd: buildCards(oddEven),
                      red: buildCards(blackRed),
                      black: buildCards(blackRed),
                      high: buildCards(highLow),
                      low: buildCards(highLow),
                    };

                    updateStatus = "lost";
                    const isWin = condition?.[subType]?.some(
                      (c) => c?.toLowerCase()?.trim() === sectionName?.toLowerCase()?.trim()
                    );
                    if (betType === "lay" ? !isWin : isWin) {
                      updateStatus = "won";
                    }
                  } else if (["btable2", "btable"].includes(bet?.gType)) {
                    const [, odd] = resultData?.rdesc
                      .split("#")
                      .map((s) => s.trim());

                    const { subType, betType } = bet;
                    const condition = {
                      btablefancy1: odd?.toLowerCase() === "yes",
                    };

                    updateStatus = "lost";

                    if (
                      betType === "lay"
                        ? !condition?.[subType]
                        : condition?.[subType]
                    ) {
                      updateStatus = "won";
                    }
                  } else if (isTeenpattiMatchBet(bet)) {
                    updateStatus = getTeenpattiBetStatus(resultData, bet);
                  } else if (["card32eu"].includes(bet?.gType)) {
                    const [, , redBlack] = resultData?.rdesc
                      .split("#")
                      .map((s) => s.trim());

                    const { subType, betType, sectionName } = bet;

                    const sections = {
                      "Any Three Card Black": "Black",
                      "Any Three Card Red": "Red",
                      "Two Black Two Red": "2-2",
                    };

                    const normalize = (str) =>
                      str?.toString().trim().toLowerCase();

                    const condition = {
                      card32eufancy1:
                        normalize(sections?.[sectionName]) ===
                        normalize(redBlack),
                    };

                    updateStatus = "lost";

                    if (
                      betType === "lay"
                        ? !condition?.[subType]
                        : condition?.[subType]
                    ) {
                      updateStatus = "won";
                    }
                  } else if (["trap"].includes(bet?.gType)) {
                    const [, , card] = resultData?.rdesc
                      .split("#")
                      .map((s) => s.trim());
                    const { sectionName, subType, betType } = bet;
                    updateStatus = "lost";
                    const condition = {
                      jqk: card
                        ?.split(",")
                        ?.filter(Boolean)
                        ?.map((item, i) => `Card ${i + 1} JQK ${item}`),
                    };

                    if (
                      betType === "lay"
                        ? condition?.[subType]?.some((c) => c?.toLowerCase()?.trim() === `${sectionName?.toLowerCase()?.trim()} no`)
                        : condition?.[subType]?.some((c) => c?.toLowerCase()?.trim() === `${sectionName?.toLowerCase()?.trim()} yes`)
                    ) {
                      updateStatus = "won";
                    }

                  }else if (["mogambo"].includes(bet?.gType)) {
                      const section = String(bet?.sectionName || "")
                        .replace(/\s+/g, "")
                        .toLowerCase();

                      const winner = String(resultData?.winnat || "")
                        .replace(/\s+/g, "")
                        .toLowerCase();

                      const subType = String(bet?.subType || "")
                        .trim()
                        .toLowerCase();

                      const betType = String(bet?.betType || "")
                        .trim()
                        .toLowerCase();

                      const uRate = Number(bet?.uRate || 0);

                      const isMogamboSession =
                        subType === "total" ||
                        section.includes("total") ||
                        uRate > 10;

                      if (resultData?.rdesc?.includes("#")) {
                        const parts = String(resultData.rdesc)
                          .split("#")
                          .map((s) => s.trim());

                        const totalResult = Number(parts[1]);

                        if (isMogamboSession) {
                          const isBackWinner =
                            Number.isFinite(totalResult) &&
                            Number.isFinite(uRate) &&
                            totalResult >= uRate;

                          updateStatus =
                            betType === "lay"
                              ? isBackWinner
                                ? "lost"
                                : "won"
                              : isBackWinner
                              ? "won"
                              : "lost";

                          console.log("MOGAMBO FANCY2 STATUS:", {
                            betId: bet?._id,
                            sectionName: bet?.sectionName,
                            eType: bet?.eType,
                            betType,
                            totalResult,
                            uRate,
                            isBackWinner,
                            updateStatus,
                          });
                        } else if (winner) {
                          const isBackWinner = winner === section;

                          updateStatus =
                            betType === "lay"
                              ? isBackWinner
                                ? "lost"
                                : "won"
                              : isBackWinner
                              ? "won"
                              : "lost";
                        }
                      }
                    }
                  if (["won", "lost"].includes(updateStatus)) {
                        console.log({
                          gType: bet.gType,
                          betType: bet.betType,
                          isTeen: isTeenpattiBet(bet),
                          isJoker: isJokerBet(bet),
                          updateStatus
                        });
                         if (isMogamboThreeCardTotalBet(bet)) {
                          profitLoss = getMogamboThreeCardTotalPL(
                            bet,
                            updateStatus
                          );

                          // console.log("MOGAMBO 3 CARD TOTAL SETTLEMENT", {
                          //   betId: bet?._id,
                          //   sectionName: bet?.sectionName,
                          //   betType: bet?.betType,
                          //   sessionPoint: bet?.uRate,
                          //   bhav: bet?.bhav,
                          //   amount: bet?.amount,
                          //   status: updateStatus,
                          //   profitLoss,
                          // });
                      // } else if (
                      //   String(bet?.gType || "").toLowerCase() === "race20" &&
                      //   ["total points", "total cards"].includes(
                      //     String(bet?.sectionName || "").trim().toLowerCase()
                      //   )
                      // ) {
                      //   ///new chnages race20
                      //   const amount = Number(bet?.amount || 0);
                      //   const rate = Number(bet?.bhav || 0);
                      //   const betType = String(bet?.betType || "").toLowerCase();

                      //   if (betType === "back") {
                      //     profitLoss =
                      //       updateStatus === "won"
                      //         ? Number((rate * amount).toFixed(2))
                      //         : -amount;
                      //   } else if (betType === "lay") {
                      //     profitLoss =
                      //         updateStatus === "won"
                      //           ? Number(amount.toFixed(2))
                      //           : -Number(((rate - 1) * amount).toFixed(2));
                      //   }

                      //   console.log("RACE20 TOTAL SETTLEMENT", {
                      //     sectionName: bet?.sectionName,
                      //     betType,
                      //     updateStatus,
                      //     rate,
                      //     amount,
                      //     profitLoss,
                      //     bhav:bet.bhav
                      //   });
                  } else if (
                    String(bet?.gType || "").trim().toLowerCase() === "race20" &&
                    ["total points", "total cards"].includes(
                      String(bet?.sectionName || "").trim().toLowerCase()
                    )
                  ) {
                    const amount = Number(bet?.amount || 0);
                    const bhav = Number(bet?.bhav || 0);
                    const betType = String(bet?.betType || "")
                      .trim()
                      .toLowerCase();

                    if (!Number.isFinite(amount) || amount <= 0) {
                      profitLoss = 0;
                    } else if (!Number.isFinite(bhav) || bhav <= 0) {
                      console.error("INVALID RACE20 BHAV", {
                        betId: bet?._id,
                        sectionName: bet?.sectionName,
                        betType,
                        bhav: bet?.bhav,
                        amount: bet?.amount,
                      });

                      profitLoss = 0;
                    } else if (betType === "back") {
                      if (updateStatus === "won") {
                        // Example: bhav 90, amount 100 => +90
                        profitLoss = Number(
                          ((bhav * amount) / 100).toFixed(2)
                        );
                      } else {
                        // Back lost => full stake loss
                        profitLoss = -Number(amount.toFixed(2));
                      }
                    } else if (betType === "lay") {
                      if (updateStatus === "won") {
                        // Lay won => full stake profit
                        profitLoss = Number(amount.toFixed(2));
                      } else {
                        // Example: bhav 110, amount 100 => -110
                        profitLoss = -Number(
                          ((bhav * amount) / 100).toFixed(2)
                        );
                      }
                    }

                    console.log("RACE20 TOTAL SETTLEMENT", {
                      betId: bet?._id,
                      sectionName: bet?.sectionName,
                      betType,
                      updateStatus,
                      bhav,
                      amount,
                      profitLoss,
                    });

                  } else if (
                  String(bet?.gType || "").trim().toLowerCase() === "trio"
                ) {
                  const amount = Number(bet?.amount || 0);
                  const rate = Number(bet?.uRate || 0);
                  const betType = String(bet?.betType || "").trim().toLowerCase();

                  if (updateStatus === "won") {
                    profitLoss =
                      betType === "lay"
                        ? Number(amount.toFixed(2))
                        : Number(((rate - 1) * amount).toFixed(2));
                  } else if (updateStatus === "lost") {
                    profitLoss =
                      betType === "lay"
                        ? -Number(((rate - 1) * amount).toFixed(2))
                        : -amount;
                  }

                  console.log("TRIO SETTLEMENT", {
                    sectionName: bet?.sectionName,
                    betType,
                    updateStatus,
                    rate,
                    amount,
                    profitLoss,
                  });

                  }else if (isTeenpattiBet(bet)) {
                      profitLoss = getTeenpattiProfitLoss(bet, updateStatus);
                  } else if (isJokerBet(bet)) {
                      profitLoss = getOddsProfitLoss(bet, updateStatus);
                    

                    } else if (
                      bet?.eType === "Fancy2" &&
                      bet?.betType === "lay" &&
                      updateStatus === "won"
                    ) {
                     // profitLoss = parseFloat(bet?.amount || 0); // layWon Changes

                      // profitLoss = Number(
                      // (
                      //  // parseFloat(bet?.uRate || bet?.bhav || 0) *
                      //    (parseFloat(bet?.uRate || bet?.bhav || 0) - 1) *
                      //   parseFloat(bet?.amount || 0)
                      // ).toFixed(2)
                    //);
                        profitLoss = Number(
                          parseFloat(bet?.amount || 0).toFixed(2)
                        );
                    } else if (
                      bet?.eType === "Fancy2" &&
                      bet?.betType === "lay" &&
                      updateStatus === "lost"
                    ) {
                      // profitLoss =
                      //   -1 *
                      //   ((parseFloat(bet?.bhav || 0) *
                      //     parseFloat(bet?.amount || 0)) /
                      //     100);//layLost Change
                        profitLoss = applyTeenJokerProfitLoss(
                              bet,
                              updateStatus,
                              Number(
                                (
                                  -1 *
                                  //((parseFloat(bet?.uRate || 0)) *
                                  ((parseFloat(bet?.uRate || 0) - 1) *
                                    parseFloat(bet?.amount || 0))
                                ).toFixed(2)
                              )
                            );
                      //     } else if (
                      //   bet?.gType === "mogambo" &&
                      //   bet?.subType === "total" &&
                      //   bet?.betType === "back" &&
                      //   updateStatus === "won"
                      // ) {
                      //   console.log("++++++mogambo++++++++++");
                      //   profitLoss = Number(
                      //     (
                      //      // Number(bet?.uRate || 0) *
                      //      (Number(bet?.uRate || 0) - 1) *
                      //       Number(bet?.amount || 0)
                      //     ).toFixed(2)
                      //   );
                      
                    } else if (
                      bet?.eType === "Fancy2" &&
                      bet?.betType === "back" &&
                      updateStatus === "won"
                    ) {
                      // profitLoss =
                      //   (parseFloat(bet?.bhav || 0) *
                      //     parseFloat(bet?.amount || 0)) 
                      //   100;
                      // layWon Changes
                       profitLoss = Number(
                        (
                          parseFloat(bet?.uRate || bet?.bhav || 0) *
                          parseFloat(bet?.amount || 0)
                        ).toFixed(2)
                      );
                    } else if (
                      bet?.eType === "Fancy2" &&
                      bet?.betType === "back" &&
                      updateStatus === "lost"
                    ) {
                      profitLoss = -parseFloat(bet?.amount || 0);
                    } else if (
                      bet?.betType === "lay" &&
                      updateStatus === "won"
                    ) {
                      // profitLoss = applyTeenJokerProfitLoss(
                      //   bet,
                      //   updateStatus,
                      //   parseFloat(bet?.amount || 0)
                      // );
                      //  profitLoss = applyTeenJokerProfitLoss(
                      //   bet,
                      //   updateStatus,
                      //   Number(
                      //     (
                      //      // parseFloat(bet?.uRate || 0) *
                      //         (parseFloat(bet?.uRate || 0) - 1) *
                      //       parseFloat(bet?.amount || 0)
                      //     ).toFixed(2)
                      //   )

                      // );

                       profitLoss = applyTeenJokerProfitLoss(
                        bet,
                        updateStatus,
                        Number(parseFloat(bet?.amount || 0).toFixed(2))
                      );
                    } else if (
                      bet?.betType === "lay" &&
                      updateStatus === "lost"
                    ) {
                      // profitLoss = applyTeenJokerProfitLoss(
                      //   bet,
                      //   updateStatus,
                      //   Number(
                      //     (
                      //       -1 *
                      //       //((parseFloat(bet?.uRate || 0) - 1) *
                      //       ((parseFloat(bet?.uRate || 0)) *
                      //         parseFloat(bet?.amount || 0))
                      //     ).toFixed(2)
                      //   )
                      // );//layLost changes
                        profitLoss = applyTeenJokerProfitLoss(
                      bet,
                      updateStatus,
                      Number(
                        (
                          -1 *
                        //  ((parseFloat(bet?.uRate || 0)) *
                        ((parseFloat(bet?.uRate || 0) - 1) *
                            parseFloat(bet?.amount || 0))
                        ).toFixed(2)
                      )
                    );
                    } else if (updateStatus === "won") {
                      profitLoss = Number(
                        (
                          (parseFloat(bet?.uRate || 0) - 1) *
                         // (parseFloat(bet?.uRate || 0)) *
                          parseFloat(bet?.amount || 0)
                        ).toFixed(2)
                      );
                    } else {
                      profitLoss = -parseFloat(bet?.amount || 0);
                    }
                  }
                  profitLoss = applyTeenJokerProfitLoss(bet, updateStatus, profitLoss);
                  console.log("FINAL SETTLEMENT", {
                      betId: bet._id.toString(),
                      section: bet.sectionName,
                      betType: bet.betType,
                      odds: bet.uRate,
                      amount: bet.amount,
                      status: updateStatus,
                      finalProfit: profitLoss
                  });
                  if (updateStatus === "lost") {
                    casinoLostBets.push({
                      ...bet.toObject?.() ?? bet,
                      status: "lost",
                      eventName: resultData?.ename ?? bet.eventName,
                    });
                  }
                  bulkOps.push({
                    updateOne: {
                      filter: { _id: bet._id, status: "pending" },
                      update: {
                        $set: {
                          profit: profitLoss,
                          status: updateStatus,
                          eventName: resultData?.ename,
                          cresult: resultData,
                        },
                      },
                    },
                  });
                  balance += profitLoss;
                } catch (err) {
                  console.error(
                    `Error processing bet (market ${markets._id}) betId:${bet._id || "unknown"
                    }`,
                    err
                  );
                }
              }

              const checkExp = findSpotsData?.sdata?.find(
                (exp) => exp?.sid === betSubType?.[0]?.sectionId
              );

              if (checkExp) {
                const maxMinusAmt = (checkExp.amount ?? 0) * -1;
                updateExp += maxMinusAmt;

                const maxExp = Math.max(
                  0,
                  ...(checkExp?.calcTable || [])
                    .map((r) => r.profitLoss)
                    .filter((v) => v > 0)
                );
                updatePartnerExp += maxExp;
              }
            }
            for (const bet of fancyBet) {
              try {
                let updateStatus = bet?.status;
                let profitLoss = 0;
                const replaceSection = {
                  joker20: "Joker ",
                  poison20: "Poison ",
                  poison: "Poison ",
                  teenjoker: "Joker ",
                };
                if (
                  [
                    "joker20",
                    "poison20",
                    "poison",
                    "teenjoker",
                    "joker1",
                    "joker120",
                    // "poker6", // Moved to dedicated block
                    "cmeter",
                    "dum10",
                  ].includes(bet?.gType)
                ) {
                  const section = bet?.sectionName?.replace(
                    replaceSection?.[bet?.gType] ?? "",
                    ""
                  );
                  if (
                    rdesc.length > 0 &&
                    rdesc.some(
                      (r) =>
                        r.toLowerCase().trim() === section?.toLowerCase()?.trim()
                    )
                  ) {
                    updateStatus = "won";
                  } else {
                    updateStatus = "lost";
                  }
                  if (bet?.gType === "joker120" && bet?.selected) {
                    updateStatus = checkJokerResult(resultData, bet, section);
                  }
                  console.log({
                      gType: bet.gType,
                      eType: bet.eType,
                      betType: bet.betType,
                      sectionName: bet.sectionName,
                      beforeReverse: updateStatus,
                      isJoker: isJokerBet(bet)
                  });
                  if (isJokerBet(bet)) {
                    updateStatus = applyLayToBackStatus(bet, updateStatus);
                  }
                  console.log({
                      afterReverse: updateStatus
                  });

                
                } else if (["poker6"].includes(bet?.gType)) {
                  const [winnerRaw, details] = resultData?.rdesc?.split("#") || [];
                  const winner = winnerRaw?.trim();
                  let winningHand = "";

                  if (details) {
                    if (details.includes(":")) {
                      const patterns = {};
                      details.split("|").forEach((part) => {
                        const [side, combo] = part.split(":").map((s) => s.trim());
                        if (side && combo) patterns[side] = combo;
                      });
                      const winnerPlayerNum = winner?.replace("Player", "").trim();
                      winningHand = patterns[winnerPlayerNum];
                    } else {
                      winningHand = details.trim();
                    }
                  }

                  updateStatus = "lost";

                  const normSection = bet.sectionName?.toLowerCase()?.trim();
                  // Winner Check
                  if (normSection === winner?.toLowerCase()?.trim()) {
                    updateStatus = "won";
                  }

                  // Hand Check
                  if (winningHand && normSection === winningHand.toLowerCase().trim()) {
                    updateStatus = "won";
                  }
                } else if (["lucky15"].includes(bet?.gType)) {
                  const checkBet = {
                    "Extra Runs": [
                      "Wide",
                      "Leg Bye",
                      "Bye",
                      "No Ball",
                      "Extra Runs",
                    ],
                    Wicket: [
                      "Caught",
                      "Bowled",
                      "Run Out",
                      "LBW",
                      "Stumped",
                      "Wicket",
                    ],
                  };
                  const isWin =
                    checkBet?.[bet?.sectionName]?.includes(resultData?.rdesc) ||
                    rdesc?.includes(bet?.sectionName?.replace("Runs", "Run"));
                  updateStatus = isWin ? "won" : "lost";
                } else if (["btable2", "btable"].includes(bet?.gType)) {
                  const section =
                    bet?.sectionName?.toLowerCase() === "odd"
                      ? bet?.betType?.toLowerCase() === "lay"
                        ? "No"
                        : "Yes"
                      : bet?.sectionName?.replaceAll(/( K-Q| J-A|Card )/g, "");
                  if (
                    rdesc.length > 0 &&
                    rdesc.some(
                      (r) =>
                        r.toLowerCase().trim() === section?.toLowerCase()?.trim()
                    )
                  ) {
                    updateStatus = "won";
                  } else {
                    updateStatus = "lost";
                  }
                } else if (["teen42", "teen41"].includes(bet?.gType)) {
                  const section = bet?.sectionName
                    ?.replace(/^Player B\s+/, "B : ")
                    .trim();
                  if (
                    resultData?.rdesc.length > 0 &&
                    resultData?.rdesc?.includes(section)
                  ) {
                    updateStatus = "won";
                  } else {
                    updateStatus = "lost";
                  }
                } else if (isTeenpattiMatchBet(bet)) {
                  updateStatus = getTeenpattiBetStatus(resultData, bet);
                
                console.log("++++++LUCKY5 DEBUG+++", {
                    rdesc,
                    card: resultData?.card,
                    winnat: resultData?.winnat,
                    win: resultData?.win,
                    section: bet.sectionName,
                  });

                  console.log("+++++LUCKY5 STATUS++++++", {
                    section: bet.sectionName,
                    updateStatus,
                  });

                                  
                } else if (["lucky5"].includes(bet?.gType)) {
                  const resultCard = String(resultData?.card || rdesc?.[3] || resultData?.win || "")
                    .trim()
                    .toLowerCase();

                  const normalizeLucky5Card = (v) => {
                    const x = String(v || "").trim().toLowerCase();
                    if (x === "a" || x === "ace") return "1";
                    if (x === "j") return "11";
                    if (x === "q") return "12";
                    if (x === "k") return "13";
                    return x;
                  };

                  const [title, cardNum] = bet?.sectionName
                    ?.split(" ")
                    ?.map((s) => s?.trim());

                  if (title === "Card") {
                    updateStatus =
                      normalizeLucky5Card(cardNum) === normalizeLucky5Card(resultCard)
                        ? "won"
                        : "lost";
                  } else if (
                    rdesc.length > 0 &&
                    rdesc.some(
                      (r) =>
                        r.toLowerCase().trim() ===
                        bet?.sectionName?.toLowerCase()?.trim()
                    )
                  ) {
                    updateStatus = "won";
                  } else {
                    updateStatus = "lost";
                  }
                  
                } else if (isTeenpatti20Bet(bet)) {
                  updateStatus = getTeenpattiBetStatus(resultData, bet);
                  if (isTeenpatti20Bet(bet) && updateStatus === "won") {
                      const handMap = getTeenpatti20ResultSegment(resultData).pair;

                      const player = /Pair\s*Plus\s*A/i.test(bet.sectionName) ? "A" : "B";

                      const FIXED = {
                          Pair: 2,
                          Flush: 4,
                          Straight: 6,
                          Trio: 30,
                          "Straight Flush": 40,
                      };

                      const hand = handMap[player];

                      if (FIXED[hand]) {
                          bet.odds = bet.uRate;   // preserve original
                          bet.uRate = FIXED[hand];
                      }
                  }
                } else if (["teen9"].includes(bet?.gType)) {
                    const [winner, details] = rdesc;
                  const patterns = {};
                  if (details) {
                    details.split("|").forEach((part) => {
                      const [side, combo] = part
                        .split(":")
                        .map((s) => s.trim());
                      if (side && combo) patterns[side] = combo;
                    });
                  }
                  const normSection = bet.sectionName?.toLowerCase()?.trim();
                  if (normSection?.endsWith("winner")) {
                    const side = normSection.split(" ")[0];
                    updateStatus =
                      side === winner?.toLowerCase()?.trim() ? "won" : "lost";
                  } else {
                    const [side, ...rest] = normSection.split(" ");
                    const hand = rest.join(" ");
                    const dMatch = side === "dragon" && patterns["D"]?.toLowerCase() === hand;
                    const lMatch = side === "lion" && patterns["L"]?.toLowerCase() === hand;
                    const tMatch = side === "tiger" && patterns["T"]?.toLowerCase() === hand;

                    if (dMatch || lMatch || tMatch) {
                      updateStatus = "won";
                    } else {
                      updateStatus = "lost";
                    }
                  }
                } else if (["teen8"].includes(bet?.gType)) {
                  const [winners, pairPart, totalPart] =
                    resultData?.rdesc?.split("#");
                  const patterns = {
                    Player: winners ? winners.trim().split(/\s+/) : [],
                    Pair: (pairPart || "").split("|").reduce((acc, p) => {
                      const [id, type] = (p || "").split(":").map((s) => s.trim());
                      if (id && type) acc[id] = type;
                      return acc;
                    }, {}),
                    Total: (totalPart || "").split("~").flatMap((chunk) =>
                      (chunk || "").split("|").map((p) => {
                        const [id, val] = (p || "").split(":").map((s) => s.trim());
                        return { id, val };
                      })
                    ),
                  };
                  updateStatus = "lost";
                  if (bet.subType === "Player") {
                    const playerNum = bet.sectionName.split(" ")[1];
                    if (patterns.Player.includes(playerNum)) {
                      updateStatus = "won";
                    }
                  } else if (bet.subType === "Pair") {
                    const playerNum = bet.sectionName.split(" ")[2];
                    if (patterns.Pair[playerNum]) {
                      updateStatus = "won";
                    }
                  } else if (bet.subType === "Total") {
                    const playerNum = bet.sectionName.split(" ")[1];
                    const totalMatch = patterns.Total.find(
                      (t) => t.id === playerNum
                    );
                    if (totalMatch) {
                      updateStatus = "won";
                    }
                  }
                } else if (["poker20"].includes(bet?.gType)) {
                  const [winnerRaw, details] = resultData?.rdesc?.split("#") || [];
                  const winner = winnerRaw?.trim();
                  const patterns = {};

                  if (details) {
                    details.split("|").forEach((part) => {
                      const [side, combo] = part
                        .split(":")
                        .map((s) => s.trim());
                      if (side && combo) patterns[side] = combo;
                    });
                  }

                  updateStatus = "lost";

                  const normSection = bet.sectionName?.toLowerCase()?.trim();
                  if (
                    (normSection === "winner a" && winner?.toLowerCase()?.trim() === "player a") ||
                    (normSection === "winner b" && winner?.toLowerCase()?.trim() === "player b")
                  ) {
                    updateStatus = "won";
                  }

                  const isPlayerA = normSection?.endsWith("a");
                  const isPlayerB = normSection?.endsWith("b");

                  if (
                    (isPlayerA &&
                      patterns["A"] &&
                      normSection === `${patterns["A"].toLowerCase()} a`) ||
                    (isPlayerB &&
                      patterns["B"] &&
                      normSection === `${patterns["B"].toLowerCase()} b`)
                  ) {
                    updateStatus = "won";
                  }
                // } else if (
                //   ["baccarat", "baccarat2", "pbaccarat", "tbaccarat"].includes(
                //     bet?.gType
                //   )
                // ) {
                //   const [winner, pair, perfectPair, eitherPair, bigSmall] =
                //     resultData?.rdesc?.split("#").map((s) => s.trim()) || [];
                //   updateStatus = "lost";
                //   const { sectionName } = bet;

                //   const normSection = sectionName?.toLowerCase()?.trim();
                //   if (normSection === "perfect pair" && perfectPair?.toLowerCase() === "yes") {
                //     updateStatus = "won";
                //   } else if (normSection === "either pair" && eitherPair?.toLowerCase() === "yes") {
                //     updateStatus = "won";
                //   } else if (normSection === bigSmall?.toLowerCase()?.trim()) {
                //     updateStatus = "won";
                //   } else if (normSection === winner?.toLowerCase()?.trim()) {
                 
                //     updateStatus = "won";
                //   } else if (normSection === pair?.toLowerCase()?.trim()) {
                //     updateStatus = "won";
                //   }
                } else if (
                  ["baccarat", "pbaccarat", "tbaccarat"].includes(
                    bet?.gType
                  )
                ) {
                  const [winner, pair, perfectPair, eitherPair, bigSmall] =
                    resultData?.rdesc?.split("#").map((s) => s.trim()) || [];

                  updateStatus = "lost";

                  const sectionName = String(bet?.sectionName || "");
                  const normSection = sectionName.toLowerCase().trim();

                  // Ye variable isi block ke andar hona zaroori hai
                  const winnerText = String(winner || "").toLowerCase().trim();
                  const pairText = String(pair || "").toLowerCase().trim();
                  const perfectPairText = String(perfectPair || "").toLowerCase().trim();
                  const eitherPairText = String(eitherPair || "").toLowerCase().trim();
                  const bigSmallText = String(bigSmall || "").toLowerCase().trim();

                  if (
                    normSection === "perfect pair" &&
                    perfectPairText === "yes"
                  ) {
                    updateStatus = "won";
                  } else if (
                    normSection === "either pair" &&
                    eitherPairText === "yes"
                  ) {
                    updateStatus = "won";
                  } else if (
                    normSection === "big" &&
                    bigSmallText === "big"
                  ) {
                    updateStatus = "won";
                  } else if (
                    normSection === "small" &&
                    bigSmallText === "small"
                  ) {
                    updateStatus = "won";
                  } else if (
                    normSection === "tie" &&
                    winnerText.includes("tie")
                  ) {
                    updateStatus = "won";
                  } else if (
                    normSection === "player" &&
                    winnerText.includes("player")
                  ) {
                    updateStatus = "won";
                  } else if (
                    normSection === "banker" &&
                    winnerText.includes("banker")
                  ) {
                    updateStatus = "won";
                  } else if (
                    normSection === pairText
                  ) {
                    updateStatus = "won";
                  }

                  // console.log("BACCARAT SETTLEMENT DEBUG", {
                  //   sectionName,
                  //   winner,
                  //   pair,
                  //   perfectPair,
                  //   eitherPair,
                  //   bigSmall,
                  //   updateStatus,
                  // });
                
                  } else if (["baccarat2"].includes(bet?.gType)) {
                const normalize = (value) =>
                  String(value || "")
                    .toLowerCase()
                    .replace(/\s+/g, " ")
                    .trim();

                const resultParts = String(resultData?.rdesc || "")
                  .split("#")
                  .map((item) => item.trim());

                /*
                  Possible response:

                  "Player#Player Pair | Banker Pair#8"
                  "Tie Game##0"
                */
                const winnerResult = normalize(
                  resultParts[0] || resultData?.winnat
                );

                const pairResult = normalize(resultParts[1]);
                const scoreResult = String(resultParts[2] || "").trim();

                const sectionName = String(bet?.sectionName || "").trim();
                const normSection = normalize(sectionName);
                const subType = normalize(bet?.subType);
                const betType = normalize(bet?.betType);

                const pairResults = pairResult
                  .split("|")
                  .map((item) => normalize(item))
                  .filter(Boolean);

                let isBackWinner = false;

                /*
                * Winner markets
                * Player / Banker / Tie
                *
                * Subtype check intentionally required nahi hai,
                * kyunki DB mein subtype value different ho sakti hai.
                */
                if (normSection === "tie") {
                  isBackWinner =
                    winnerResult === "tie" ||
                    winnerResult === "tie game" ||
                    winnerResult.includes("tie");
                } else if (normSection === "player") {
                  isBackWinner =
                    winnerResult === "player" ||
                    winnerResult === "player win" ||
                    winnerResult.includes("player");
                } else if (normSection === "banker") {
                  isBackWinner =
                    winnerResult === "banker" ||
                    winnerResult === "banker win" ||
                    winnerResult.includes("banker");
                }

                /*
                * Pair markets
                */
                else if (
                  normSection === "player pair" ||
                  normSection === "banker pair"
                ) {
                  isBackWinner = pairResults.includes(normSection);
                }

                /*
                * Score markets:
                * Score 1-4
                * Score 5-6
                * Score 7
                * Score 8
                * Score 9
                */
                else if (normSection.startsWith("score")) {
                  isBackWinner = isScoreWin(sectionName, scoreResult);
                }

                /*
                * Back/Lay settlement
                */
                updateStatus =
                  betType === "lay"
                    ? isBackWinner
                      ? "lost"
                      : "won"
                    : isBackWinner
                      ? "won"
                      : "lost";

                // console.log("BACCARAT2 SETTLEMENT DEBUG", {
                //   sectionName,
                //   normSection,
                //   subType: bet?.subType,
                //   betType,
                //   rdesc: resultData?.rdesc,
                //   winnat: resultData?.winnat,
                //   winnerResult,
                //   pairResult,
                //   pairResults,
                //   scoreResult,
                //   isBackWinner,
                //   updateStatus,
                // });

                } else if (
                  [
                    "dt20",
                    "pdt20",
                    "tdt20",
                    "dt202",
                    "dt6",
                    "pdt6",
                    "tdt6",
                  ].includes(bet?.gType)
                ) {
                  const [
                    winner,
                    pairRes = "",
                    oddEventRes = "",
                    colorRes = "",
                    cardRes = "",
                  ] = resultData?.rdesc?.split("#").map((s) => s.trim()) || [];
                  const { sectionName } = bet;
                  const betMap = {
                    winner: ["Dragon", "Tiger", "Tie"],
                    pair: "Pair",
                    evenOdd: [
                      "Dragon Even",
                      "Dragon Odd",
                      "Tiger Even",
                      "Tiger Odd",
                    ],
                    color: [
                      "Dragon Red",
                      "Dragon Black",
                      "Tiger Red",
                      "Tiger Black",
                    ],
                    suit: [
                      "Dragon Club",
                      "Dragon Diamond",
                      "Dragon Heart",
                      "Dragon Spade",
                      "Tiger Club",
                      "Tiger Diamond",
                      "Tiger Heart",
                      "Tiger Spade",
                    ],
                    card: "Card",
                  };
                  updateStatus = "lost";
                  const normSection = sectionName?.toLowerCase()?.trim();
                  if (
                    betMap.winner.some((w) => w.toLowerCase() === normSection) &&
                    normSection === winner?.toLowerCase()?.trim()
                  )
                    updateStatus = "won";

                  if (normSection === betMap.pair?.toLowerCase() && pairRes?.toLowerCase() === "yes")
                    updateStatus = "won";

                  if (betMap.evenOdd.some((eo) => eo.toLowerCase() === normSection)) {
                    const [dragonPair, tigerPair] = oddEventRes
                      .split("|")
                      .map((s) => s.trim());
                    const target = normSection.split(" ")[1];
                    if (
                      (normSection.includes("dragon") &&
                        dragonPair?.toLowerCase()?.includes(target)) ||
                      (normSection.includes("tiger") &&
                        tigerPair?.toLowerCase()?.includes(target))
                    )
                      updateStatus = "won";
                  }

                  if (betMap.color.some((c) => c.toLowerCase() === normSection)) {
                    const [dragonColor, tigerColor] = colorRes
                      .split("|")
                      .map((s) => s.trim());
                    const target = normSection.split(" ")[1];
                    if (
                      (normSection.includes("dragon") &&
                        dragonColor?.toLowerCase()?.includes(target)) ||
                      (normSection.includes("tiger") &&
                        tigerColor?.toLowerCase()?.includes(target))
                    )
                      updateStatus = "won";
                  }

                  if (betMap.suit.some((s) => s.toLowerCase() === normSection)) {
                    const [dragonSuit, tigerSuit] = cardRes
                      .split("|")
                      .map((s) => s.trim());
                    const target = normSection.split(" ")[1];
                    if (
                      (normSection.includes("dragon") &&
                        dragonSuit?.toLowerCase()?.includes(target)) ||
                      (normSection.includes("tiger") &&
                        tigerSuit?.toLowerCase()?.includes(target))
                    )
                      updateStatus = "won";
                  }

                  if (normSection.includes(betMap.card?.toLowerCase())) {
                    const [dragonCard, tigerCard] = cardRes
                      .split("|")
                      .map((s) => s.trim());
                    const cardNum = normSection.split(" ")[2];
                    if (
                      (normSection.startsWith("dragon") &&
                        dragonCard?.toLowerCase()?.includes(cardNum)) ||
                      (normSection.startsWith("tiger") &&
                        tigerCard?.toLowerCase()?.includes(cardNum))
                    )
                      updateStatus = "won";
                  }
                } else if (["dtl20"].includes(bet?.gType)) {
                  const [
                    winner,
                    colorRes = "",
                    oddEventRes = "",
                    cardRes = "",
                  ] = resultData?.rdesc?.split("#").map((s) => s.trim()) || [];
                  const { sectionName } = bet;
                  updateStatus = "lost";
                  const normSection = sectionName?.toLowerCase()?.trim();
                  if (normSection === "winner d" && winner?.toLowerCase() === "dragon") {
                    updateStatus = "won";
                  } else if (normSection === "winner t" && winner?.toLowerCase() === "tiger") {
                    updateStatus = "won";
                  } else if (normSection === "winner l" && winner?.toLowerCase() === "lion") {
                    updateStatus = "won";
                  }
                  const [dOdd = "", tOdd = "", lOdd = ""] = oddEventRes
                    .split("|")
                    .map((s) => s.trim());
                  const [dCol = "", tCol = "", lCol = ""] = colorRes
                    .split("|")
                    .map((s) => s.trim());
                  const [dCard = "", tCard = "", lCard = ""] = cardRes
                    .split("|")
                    .map((s) => s.trim());

                  const conditions = {
                    "Odd D": dOdd?.toLowerCase()?.includes("odd"),
                    "Even D": dOdd?.toLowerCase()?.includes("even"),
                    "Odd T": tOdd?.toLowerCase()?.includes("odd"),
                    "Even T": tOdd?.toLowerCase()?.includes("even"),
                    "Odd L": lOdd?.toLowerCase()?.includes("odd"),
                    "Even L": lOdd?.toLowerCase()?.includes("even"),

                    "Red D": dCol?.toLowerCase()?.includes("red"),
                    "Black D": dCol?.toLowerCase()?.includes("black"),
                    "Red T": tCol?.toLowerCase()?.includes("red"),
                    "Black T": tCol?.toLowerCase()?.includes("black"),
                    "Red L": lCol?.toLowerCase()?.includes("red"),
                    "Black L": lCol?.toLowerCase()?.includes("black"),

                    [`Dragon ${dCard.split(":")[1]?.trim()}`]: true,
                    [`Tiger ${tCard.split(":")[1]?.trim()}`]: true,
                    [`Lion ${lCard.split(":")[1]?.trim()}`]: true,
                  };
                  if (conditions[sectionName]) {
                    updateStatus = "won";
                  }
                // } else if (
                //   [
                //     "lucky7eu2",
                //     "lucky7eu",
                //     "lucky7",
                //     "plucky7",
                //     "tlucky7",
                //   ].includes(bet?.gType)
                // ) {
                //   const [winner, oddEven, color, card, line] = rdesc;
                //   const { sectionName } = bet;
                //   updateStatus = "lost";
                //   const lineLabel = {
                //     "1 2 3": "1",
                //     "4 5 6": "2",
                //     "8 9 10": "3",
                //     "J Q K": "4",
                //   };
                //   const conditions = {
                //     [winner]: true,
                //     [oddEven]: true,
                //     [color]: true,
                //     [`Card ${card}`]: true,
                //     [`Line ${lineLabel?.[line]}`]: true,
                //   };

                //   const normalizedSection = sectionName?.toLowerCase()?.trim();
                //   const matchFound = Object.keys(conditions).some(
                //     (key) => key.toLowerCase().trim() === normalizedSection
                //   );

                //   if (matchFound) {
                //     updateStatus = "won";
                //   }///my changes
                } else if (
                  [
                    "lucky7eu2",
                    "lucky7eu",
                    "lucky7",
                    "plucky7",
                    "tlucky7",
                  ].includes(String(bet?.gType || "").toLowerCase())
                ) {
                  const normalize = (value) =>
                    String(value || "")
                      .toLowerCase()
                      .replace(/\s+/g, " ")
                      .trim();

                  const [winner, oddEven, color, card, line] = String(
                    resultData?.rdesc || ""
                  )
                    .split("#")
                    .map((item) => item.trim());

                  const sectionName = String(bet?.sectionName || "").trim();
                  const normalizedSection = normalize(sectionName);

                  const normalizedLine = normalize(line);

                  const lineLabel = {
                    "1 2 3": "1",
                    "4 5 6": "2",
                    "8 9 10": "3",
                    "j q k": "4",
                  };

                  const resultLineNumber = lineLabel[normalizedLine];

                  const normalizeCard = (value) => {
                    const cardValue = normalize(value);

                    if (cardValue === "a" || cardValue === "ace") return "1";
                    if (cardValue === "j") return "11";
                    if (cardValue === "q") return "12";
                    if (cardValue === "k") return "13";

                    return cardValue;
                  };

                  const resultCard = normalizeCard(card);

                  let isBackWinner = false;

                  // Low Card / High Card
                  if (normalizedSection === normalize(winner)) {
                    isBackWinner = true;
                  }

                  // Odd / Even
                  else if (normalizedSection === normalize(oddEven)) {
                    isBackWinner = true;
                  }

                  // Red / Black
                  else if (normalizedSection === normalize(color)) {
                    isBackWinner = true;
                  }

                  // Card A / Card 1 / Card J etc.
                  else if (normalizedSection.startsWith("card")) {
                    const selectedCard = normalizedSection
                      .replace(/^card\s*/i, "")
                      .trim();

                    isBackWinner =
                      normalizeCard(selectedCard) === resultCard;
                  }

                  // Line 1 / Line1
                  else if (normalizedSection.startsWith("line")) {
                    const selectedLine = normalizedSection
                      .replace(/^line\s*/i, "")
                      .trim();

                    isBackWinner =
                      selectedLine === String(resultLineNumber || "");
                  }

                  updateStatus =
                    String(bet?.betType || "").toLowerCase() === "lay"
                      ? isBackWinner
                        ? "lost"
                        : "won"
                      : isBackWinner
                        ? "won"
                        : "lost";

                  console.log("LUCKY7 SETTLEMENT DEBUG", {
                    sectionName,
                    betType: bet?.betType,
                    rdesc: resultData?.rdesc,
                    winner,
                    oddEven,
                    color,
                    card,
                    line,
                    resultCard,
                    normalizedLine,
                    resultLineNumber,
                    isBackWinner,
                    updateStatus,
                  });

                } else if (["card32eu"].includes(bet?.gType)) {
                  const [winner, oddEvenRes, colorRes, totalRes, singleRes] =
                    resultData?.rdesc?.split("#").map((s) => s.trim());
                  const { sectionName } = bet;
                  updateStatus = "lost";
                  const oddEvenMap = (oddEvenRes || "")
                    .split("~")
                    .reduce((acc, group) => {
                      (group || "").split("|").forEach((seg) => {
                        const [p, val] = (seg || "").split(":").map((s) => s.trim());
                        if (p && val) acc[`Player ${p} ${val}`] = true;
                      });
                      return acc;
                    }, {});

                  const conditions = {
                    ...oddEvenMap,
                    ...(totalRes === "8-9" && { "8 & 9 Total": true }),
                    ...(totalRes === "10-11" && { "10 & 11 Total": true }),
                    ...(colorRes === "2-2" && { "Two Black Two Red": true }),
                    ...(singleRes && { [`Single ${singleRes}`]: true }),
                  };

                  if (conditions[sectionName]) {
                    updateStatus = "won";
                  }
                } else if (["abj"].includes(bet?.gType)) {
                  // resultData.rdesc example: "Bahar#Club#Odd#K"
                  const parts = (resultData?.rdesc || "")
                    .split("#")
                    .map((s) => s.trim());
                  let [
                    winner = "",
                    colorRes = "",
                    oddEvenRes = "",
                    cardRes = "",
                  ] = parts;

                  const sectionNameRaw = (bet?.sectionName ?? "").toString();

                  // ensure updateStatus exists (don't redeclare if already declared outside)
                  try {
                    updateStatus = updateStatus;
                  } catch (e) {
                    updateStatus = "lost";
                  }
                  updateStatus = "lost";

                  const normalize = (s = "") =>
                    String(s || "")
                      .toLowerCase()
                      .replace(/\s+/g, " ")
                      .trim();

                  const winnerNorm = normalize(winner);
                  const colorNorm = normalize(colorRes);
                  const oddEvenNorm = normalize(oddEvenRes);
                  const cardNormRaw = normalize(cardRes);
                  const sectionNorm = normalize(sectionNameRaw);

                  // --- Card helpers ---
                  const extractCardValue = (token = "") => {
                    if (!token) return "";
                    const cleaned = token.replace(/,$/, "").trim();
                    const m = cleaned.match(/^([0-9]+|10|[ajqk]|ace|a)/i);
                    if (m && m[1]) {
                      const v = m[1].toLowerCase();
                      if (v === "1" || v === "ace") return "a";
                      return v;
                    }
                    const num = cleaned.match(/\d+/);
                    if (num && num[0]) return num[0].toLowerCase();
                    return cleaned.toLowerCase();
                  };

                  const normalizeCardKey = (c) => {
                    if (!c) return "";
                    const x = c.toString().toLowerCase();
                    if (x === "1" || x === "a" || x === "ace") return "a";
                    return x;
                  };

                  const seq = (resultData?.card || "")
                    .toString()
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean);

                  // Joker value: prefer seq[0] (joker place), fallback to rdesc card
                  const jokerFromSeq = seq[0]
                    ? normalizeCardKey(extractCardValue(seq[0]))
                    : "";
                  const jokerCardKey =
                    jokerFromSeq || normalizeCardKey(cardNormRaw);

                  // ---------------------------
                  //  SPECIAL SA / SB LOGIC
                  // ---------------------------
                  const isSA =
                    sectionNorm === "sa" || /\bsa\b/.test(sectionNorm);
                  const isSB =
                    sectionNorm === "sb" || /\bsb\b/.test(sectionNorm);

                  // mark whether we handled SA/SB to avoid running generic logic below
                  let handledSpecial = false;

                  if (isSA || isSB) {
                    handledSpecial = true;

                    // index mapping:
                    // seq[0] = Joker
                    // seq[1] = Bahar first card (SB checks this)
                    // seq[2] = Andar first card (SA checks this)
                    const firstBahar = seq[1]
                      ? normalizeCardKey(extractCardValue(seq[1]))
                      : "";
                    const firstAndar = seq[2]
                      ? normalizeCardKey(extractCardValue(seq[2]))
                      : "";

                    if (isSA) {
                      // SA -> check seq[2]
                      updateStatus =
                        jokerCardKey &&
                          firstAndar &&
                          jokerCardKey === firstAndar
                          ? "won"
                          : "lost";
                    } else if (isSB) {
                      // SB -> check seq[1]
                      updateStatus =
                        jokerCardKey &&
                          firstBahar &&
                          jokerCardKey === firstBahar
                          ? "won"
                          : "lost";
                    }

                    // Do NOT return here. We only mark handledSpecial and let the flow continue.
                    // That prevents overwriting updateStatus below.
                  }

                  // ---------------------------
                  // GENERIC LOGIC (only if SA/SB not handled)
                  // ---------------------------
                  if (!handledSpecial) {
                    // find index of first card that matches the joker value
                    let matchIndex = -1;
                    if (seq.length && jokerCardKey) {
                      for (let i = 0; i < seq.length; i++) {
                        const vNorm = normalizeCardKey(
                          extractCardValue(seq[i])
                        );
                        if (!vNorm) continue;
                        if (vNorm === jokerCardKey) {
                          matchIndex = i;
                          break;
                        }
                      }
                    }

                    // helper to infer side from section names like "1st Bet A" -> A => andar, B => bahar
                    const inferSideFromSection = (s) => {
                      const betLetMatch =
                        s.match(/\b([ab])\b$/i) || s.match(/\bbet\s*([ab])\b/i);
                      if (betLetMatch) {
                        const letter = String(betLetMatch[1]).toLowerCase();
                        return letter === "a" ? "andar" : "bahar";
                      }
                      if (s.includes("andar")) return "andar";
                      if (s.includes("bahar")) return "bahar";
                      return null;
                    };

                    const sideFromSection = inferSideFromSection(sectionNorm);

                    if (sideFromSection) {
                      updateStatus =
                        sideFromSection === winnerNorm ? "won" : "lost";
                    } else {
                      if (
                        sectionNorm === winnerNorm ||
                        sectionNorm.includes(winnerNorm)
                      ) {
                        updateStatus = "won";
                      } else {
                        const isJoker =
                          sectionNorm.startsWith("joker") ||
                          sectionNorm.includes("joker");
                        if (isJoker) {
                          let afterJoker = sectionNorm
                            .replace(/^joker\s*/i, "")
                            .trim();

                          if (colorNorm && afterJoker.includes(colorNorm)) {
                            updateStatus = "won";
                          } else if (
                            oddEvenNorm &&
                            afterJoker.includes(oddEvenNorm)
                          ) {
                            updateStatus = "won";
                          } else if (cardNormRaw) {
                            const nCard = Number(cardNormRaw);
                            const nAfter = Number(afterJoker);
                            if (
                              !Number.isNaN(nCard) &&
                              !Number.isNaN(nAfter) &&
                              nCard === nAfter
                            ) {
                              updateStatus = "won";
                            } else if (
                              afterJoker === cardNormRaw ||
                              afterJoker.includes(cardNormRaw)
                            ) {
                              updateStatus = "won";
                            } else {
                              updateStatus = "lost";
                            }
                          } else {
                            updateStatus = "lost";
                          }
                        } else {
                          const possibleKeys = new Set([
                            winnerNorm,
                            `joker ${colorNorm}`.trim(),
                            `joker ${oddEvenNorm}`.trim(),
                            `joker ${cardNormRaw}`.trim(),
                          ]);
                          if (
                            [...possibleKeys].some(
                              (k) => k && sectionNorm.includes(k)
                            )
                          ) {
                            updateStatus = "won";
                          } else {
                            updateStatus = "lost";
                          }
                        }
                      }
                    }
                  }
                } else if (["3cardj"].includes(bet?.gType)) {
                  const winner = resultData?.rdesc
                    .split(" ")
                    .map((s) => s.trim());

                  const { sectionName, selected } = bet;
                  const [yesNo] = sectionName?.split(" - ")?.map((s) => s?.trim());

                  const hasMatch = selected
                    ?.split(",")
                    .map((s) => s.trim())
                    .some((item) => winner?.some((w) => w.toLowerCase() === item?.toLowerCase()));

                  updateStatus = "lost";

                  if (
                    (yesNo?.toLowerCase() === "yes" && hasMatch) ||
                    (yesNo?.toLowerCase() === "no" && !hasMatch)
                  ) {
                    updateStatus = "won";
                  }
                } else if (["war"].includes(bet?.gType)) {
                  const [winner, ...otherPatten] =
                    resultData?.rdesc?.split("#").map((s) => s.trim()) || [];
                  const groups = otherPatten.flatMap((pat) => pat.split("~"));
                  const labels = groups.flatMap((group) =>
                    group.split("|").map((item) => {
                      const parts = item.split(":").map((p) => p.trim());
                      return `${parts[1]} ${parts[0]}`;
                    })
                  );
                  const { sectionName, betType } = bet;
                  const normSection = sectionName?.toLowerCase()?.trim();
                  const winnerArr = winner?.split(/[\s,]+/)?.map((s) => s?.toLowerCase()?.trim())?.filter(Boolean) || [];

                  let isWin = false;
                  if (normSection.startsWith("winner")) {
                    const sat = normSection?.split(" ")?.[1];
                    isWin = winnerArr.includes(sat);
                  } else {
                    isWin = labels?.some((l) => l.toLowerCase() === normSection);
                  }

                  updateStatus = (betType === "lay" ? !isWin : isWin) ? "won" : "lost";
                } else if (["aaa", "aaa2"].includes(bet?.gType)) {
                  const [winner, oddEven, color, underOver, card] =
                    resultData?.rdesc?.split("#").map((s) => s.trim());
                  const { sectionName } = bet;
                  updateStatus = "lost";

                  const conditions = {
                    [oddEven]: true,
                    [color]: true,
                    [underOver]: true,
                    [`Card ${card}`]: true,
                  };

                  if (conditions[sectionName]) {
                    updateStatus = "won";
                  }
                } else if (["teen6"].includes(bet?.gType)) {
                  const [winner, suit, oddEvent, card, underOver] =
                    resultData?.rdesc?.split("#").map((s) => s.trim()); //uo
                  const { sectionName, subType } = bet;
                  updateStatus = "lost";
                  const condition = {
                    cards: card
                      ?.split(" ")
                      ?.filter(Boolean)
                      ?.map((item, i) => `Card ${i + 1}/Card ${item}`),
                    oddeven: oddEvent
                      ?.split(" ")
                      ?.filter(Boolean)
                      ?.map((item, i) => `Card ${i + 1}/${item}`),
                    suit: suit
                      ?.split(" ")
                      ?.filter(Boolean)
                      ?.map((item, i) => `Card ${i + 1}/${item}`),
                    uo: underOver?.split("|")?.map((item) => {
                      const [player, val] = item
                        .split(":")
                        .map((x) => x.trim());
                      return `Player ${player} ${val
                        .replace(/\(\d+\)/, "")
                        .trim()}`;
                    }),
                  };

                  const normSection = sectionName?.toLowerCase()?.trim();
                  if (
                    condition?.[subType]?.some(
                      (c) => c?.toLowerCase()?.trim() === normSection
                    )
                  ) {
                    updateStatus = "won";
                  }
                } else if (["trap"].includes(bet?.gType)) {
                  const [winner, trap] = resultData?.rdesc
                    .split("#")
                    .map((s) => s.trim());
                  const { sectionName, subType } = bet;
                  updateStatus = "lost";
                  const condition = {
                    highlow: trap
                      ?.split(",")
                      ?.filter(Boolean)
                      ?.map((item, i) => `Card ${i + 1} ${item}`),
                  };
                  if (
                    condition?.[subType]?.includes(
                      sectionName?.replace(/High|Low/g, "Tie")
                    )
                  ) {
                    updateStatus = "tie";
                  } else if (condition?.[subType]?.includes(sectionName)) {
                    updateStatus = "won";
                  }
                } else if (["teen120"].includes(bet?.gType)) {
                  const [winner, pair] = resultData?.rdesc
                    .split("#")
                    .map((s) => s.trim());
                  const { sectionName, subType } = bet;
                  updateStatus = "lost";
                  if (
                    (subType === "pair" && pair?.toLowerCase() === "yes") ||
                    sectionName?.toLowerCase()?.trim() === winner?.toLowerCase()?.trim()
                  ) {
                    updateStatus = "won";
                  }
                } else if (["teen1"].includes(bet?.gType)) {

                  const [winner, updown] = resultData.rdesc
                      .split("#")
                      .map(s => s.trim());

                  const { sectionName, subType } = bet;

                  updateStatus = "lost";

                  // -----------------------------
                  // Main Player / Dealer
                  // -----------------------------
                  // if (subType === "teen1") {

                  //     if (
                  //         winner.toLowerCase() ===
                  //         sectionName.toLowerCase().trim()
                  //     ) {
                  //         updateStatus = "won";
                  //     }

                  // }
                    if (subType === "teen1") {
                      const isBackSelectionWinner =
                        winner?.toLowerCase()?.trim() ===
                        sectionName?.toLowerCase()?.trim();

                      updateStatus =
                        bet?.betType === "lay"
                          ? isBackSelectionWinner
                            ? "lost"
                            : "won"
                          : isBackSelectionWinner
                            ? "won"
                            : "lost";
                    }

                  // -----------------------------
                  // 7 Up / Down
                  // -----------------------------
                  else if (subType === "updown") {

                      const [playerCard, dealerCard] =
                          (resultData.card || "")
                              .split(",")
                              .map(s => s.trim());

                      const getValue = (card) => {
                          const m = card.match(/^(10|[2-9AJQK])/i);
                          return m ? m[1].toUpperCase() : "";
                      };

                      const playerValue = getValue(playerCard);
                      const dealerValue = getValue(dealerCard);

                      const isPlayerBet =
                          sectionName.toLowerCase().includes("player");

                      const cardValue =
                          isPlayerBet ? playerValue : dealerValue;

                      // Provider Rule:
                      // Card 7 => both Up & Down lose half
                      if (cardValue === "7") {
                          bet.isHalfLoss = true;
                          updateStatus = "lost";
                      } else {

                          const condition = updown
                              .split("|")
                              .map(item => {

                                  const [side, val] =
                                      item.split(":").map(x => x.trim());

                                  return `7 ${val} ${
                                      side === "P"
                                          ? "Player"
                                          : "Dealer"
                                  }`;
                              });

                          if (
                              condition.some(
                                  x =>
                                      x.toLowerCase() ===
                                      sectionName.toLowerCase().trim()
                              )
                          ) {
                              updateStatus = "won";
                          }

                      }

                  }
                } else if (["teenmuf"].includes(bet?.gType)) {
                  const [winner, top, baccarat] = resultData?.rdesc
                    .split("#")
                    .map((s) => s?.trim());
                  const { sectionName, subType } = bet;
                  updateStatus = "lost";
                  const payouts = {
                    "Card 9": 4,
                    "Card 8": 5,
                    "Card 7": 6,
                    "Card 6": 9,
                    "Card 5": 31,
                  };
                  const cards = top
                    .split("|")
                    .map(
                      (s) =>
                        `Top 9 ${s?.split(":")[0]?.trim()}/${s
                          .split(":")[1]
                          ?.trim()}`
                    );

                  const condition = {
                    teenmuf: winner,
                    top9: cards,
                    mbacc: (() => {
                      if (baccarat?.toLowerCase()?.includes("player a")) return "M Baccarat A";
                      if (baccarat?.toLowerCase()?.includes("player b")) return "M Baccarat B";
                      return null;
                    })(),
                  };

                  if (subType === "top9") {
                    const findResult = cards?.find((item) => {
                      const [section] = item?.split("/")?.map((s) => s?.trim());
                      return section?.toLowerCase()?.trim() === sectionName?.toLowerCase()?.trim();
                    });
                    if (findResult) {
                      const [, card] = findResult
                        ?.split("/")
                        ?.map((s) => s?.trim());
                      bet.odds = bet.uRate;
                      bet.uRate = payouts?.[card] ?? bet.uRate;
                      updateStatus = "won";
                    }
                  } else if (condition?.[subType]?.includes(sectionName)) {
                    updateStatus = "won";
                  }
                } else if (["cmeter1"].includes(bet?.gType)) {
                  const [winner, point] = resultData?.rdesc
                    .split("#")
                    .map((s) => s.trim());
                  const { sectionName } = bet;
                  if (winner?.toLowerCase()?.trim() === sectionName?.toLowerCase()?.trim()) {
                    updateStatus = "won";
                    bet.settledRate = Number(point ?? 1);
                  } else if (winner?.toLowerCase()?.trim() === "tie") {
                    updateStatus = "won";
                    bet.settledRate = 0;
                  } else {
                    updateStatus = "lost";
                    bet.settledRate = Number(point ?? 1);
                  }
                  bet.odds = bet.uRate; // Preserve original liability odds
               } else if (
                  [
                    "roulette11",
                    "ourroullete",
                    "roulette13",
                    "roulette12",
                  ].includes(bet?.gType)
                ) {
                  const winner = Number(resultData?.rdesc);
                  const { sectionName } = bet;
                  const [nat, type] = sectionName.split("/").map((s) => s.trim());
                
                  updateStatus = "lost";
                
                  const roulettePatten = rouletteNumbers();
                
                  const condition = {
                    Single: Number(nat) === winner,
                    Dozen: roulettePatten?.[winner]?.dozen === nat,
                    Half: ["Black", "Red"].includes(nat)
                      ? roulettePatten?.[winner]?.color === nat
                      : ["Odd", "Even"].includes(nat)
                      ? roulettePatten?.[winner]?.oddEven === nat
                      : ["1 to 18", "19 to 36"].includes(nat)
                      ? roulettePatten?.[winner]?.range === nat
                      : false,
                    Column: roulettePatten?.[winner]?.column === nat,
                    Corner: nat.split(",").map((s) => Number(s.trim())).includes(winner),
                    Split: nat.split(",").map((s) => Number(s.trim())).includes(winner),
                    Street: nat.split(",").map((s) => Number(s.trim())).includes(winner),
                  };
                
                  const isWin = !!condition?.[type];
                
                  updateStatus =
                    bet?.betType === "lay"
                      ? isWin ? "lost" : "won"
                      : isWin ? "won" : "lost";
                  // const winner = Number(resultData?.rdesc);
                  // const { sectionName } = bet;
                  // const [nat, type] = sectionName
                  //   .split("/")
                  //   .map((s) => s.trim());
                  // updateStatus = "lost";
                  // const roulettePatten = rouletteNumbers();

                  // const condition = {
                  //   Single: Number(nat) === winner,
                  //   Dozen: roulettePatten?.[winner]?.dozen === nat,
                  //   Half: ["Black", "Red"].includes(nat)
                  //     ? roulettePatten?.[winner]?.color === nat
                  //     : ["Odd", "Even"].includes(nat)
                  //       ? roulettePatten?.[winner]?.oddEven === nat
                  //       : ["1 to 18", "19 to 36"].includes(nat)
                  //         ? roulettePatten?.[winner]?.range === nat
                  //         : false,
                  //   Column: roulettePatten?.[winner]?.column === nat,
                  //   Corner: nat
                  //     ?.split(",")
                  //     ?.map((s) => Number(s.trim()))
                  //     .includes(Number(winner)),
                  //   Split: nat
                  //     ?.split(",")
                  //     ?.map((s) => Number(s.trim()))
                  //     .includes(Number(winner)),
                  //   Street: nat
                  //     ?.split(",")
                  //     ?.map((s) => Number(s.trim()))
                  //     .includes(Number(winner)),
                  // };

                  // if (
                  //   bet?.betType === "lay"
                  //     ? !condition?.[type]
                  //     : condition?.[type]
                  // ) {
                  //   updateStatus = "won";
                  // }
                } else if (["teenunique"].includes(bet?.gType)) {
                  const cards = resultData?.card
                    ?.split(",")
                    ?.map((s) => s.trim());
                  const { selected } = bet;
                  const selectedCard = selected
                    ?.split(",")
                    .map((s) => Number(s.trim()));

                  const player1 = [];
                  const player2 = [];
                  cards?.map((item, index) => {
                    if (selectedCard?.includes(index + 1)) {
                      player1?.push(item);
                    } else {
                      player2?.push(item);
                    }
                  });
                  updateStatus = "lost";
                  const winner = compareHands(player1, player2);
                  if (winner?.toLowerCase() === "player 1") {
                    updateStatus = "won";
                  }
                } else if (["sicbo2", "sicbo"].includes(bet?.gType)) {
                  const result = resultData?.rdesc
                    ?.split(",")
                    .map((s) => parseInt(s.trim()));
                    console.log("Casino API RESULT2:", result);
                  const total = parseInt(resultData?.win);
                  const triple = result.every((d) => d === result[0]);

                  const countNumber = (dice, number) =>
                    dice.filter((d) => d === number).length;
                  const isDouble = (dice, number) =>
                    countNumber(dice, number) >= 2;
                  const isCombination = (dice, n1, n2) =>
                    dice.includes(n1) && dice.includes(n2);

                  const { sectionName } = bet;

                  let isWin = false;

                  if (
                    triple &&
                    ["small", "big", "odd", "even"].includes(sectionName?.toLowerCase()?.trim())
                  ) {
                    isWin = false;
                  } else if (
                    ["small", "big"].includes(sectionName.toLowerCase())
                  ) {
                    isWin =
                      sectionName.toLowerCase() === "small"
                        ? total >= 4 && total <= 10
                        : total >= 11 && total <= 17;
                  } else if (
                    ["odd", "even"].includes(sectionName.toLowerCase())
                  ) {
                    isWin =
                      sectionName.toLowerCase() === "odd"
                        ? total % 2 === 1
                        : total % 2 === 0;
                  } else if (sectionName.toLowerCase() === "any triple") {
                    isWin = triple;
                  } else if (sectionName.toLowerCase()?.startsWith("double")) {
                    const num = parseInt(sectionName.split(" ")[1]);
                    isWin = isDouble(result, num);
                  } else if (sectionName.toLowerCase()?.startsWith("triple")) {
                    const num = parseInt(sectionName.split(" ")[1]);
                    isWin = triple && result[0] === num;
                  } else if (sectionName.toLowerCase()?.startsWith("total")) {
                    const t = parseInt(sectionName.split(" ")[1]);
                    isWin = total === t;
                  } else if (sectionName.toLowerCase()?.startsWith("single")) {
                    const num = parseInt(sectionName.split(" ")[1]);
                    isWin = countNumber(result, num) > 0;
                    bet.odds = bet.uRate;
                    bet.uRate = countNumber(result, num);
                  } else if (sectionName.toLowerCase()?.startsWith("combination")) {
                    const [n1, n2] = sectionName.match(/\d+/g).map(Number);
                    isWin = isCombination(result, n1, n2);
                    bet.odds = bet.uRate;
                  }

                  updateStatus = isWin ? "won" : "lost";
                } else if (["lottcard"].includes(bet?.gType)) {
                  const result = resultData?.rdesc
                    .split(" ")
                    .map((s) => s.trim())
                    .filter(Boolean);
                  console.log("Casino API RESULT3:", result);
                  const { sectionName, selected } = bet;

                  const type = sectionName.split(" ")[0];
                  const selectedArr =
                    selected?.split(",").map((s) => s.trim()) || [];

                  updateStatus = "lost";

                  const lMatch = (a, b) => (a || "").toLowerCase() === (b || "").toLowerCase();
                  const condition = {
                    Single: lMatch(selectedArr[0], result?.[0]),
                    Double:
                      lMatch(selectedArr[0], result?.[0]) &&
                      lMatch(selectedArr[1], result?.[1]),
                    Triple:
                      lMatch(selectedArr[0], result?.[0]) &&
                      lMatch(selectedArr[1], result?.[1]) &&
                      lMatch(selectedArr[2], result?.[2]),
                  };

                  if (condition[type]) {
                    updateStatus = "won";
                  }
                } else if (["race20"].includes(bet?.gType)) {
                  const [winner, points, cards] = resultData?.rdesc
                    .split("#")
                    .map((s) => s.trim());

                  const { sectionName, uRate } = bet;
                  updateStatus = "lost";
                  const nat = sectionName?.toLowerCase()?.replaceAll("win with", "")?.trim();
                  if (nat === "total points") {
                    const pointsNum = parseFloat(points) || 0;
                    const rateNum = parseFloat(uRate) || 0;

                    if (bet?.betType === "lay") {
                      updateStatus = pointsNum >= rateNum ? "lost" : "won";
                    } else {
                      updateStatus = pointsNum >= rateNum ? "won" : "lost";
                    }
                  } else if (nat === "total cards") {
                    const cardsNum = parseFloat(cards) || 0;
                    const rateNum = parseFloat(uRate) || 0;

                    if (bet?.betType === "lay") {
                      updateStatus = cardsNum >= rateNum ? "lost" : "won";
                    } else {
                      updateStatus = cardsNum >= rateNum ? "won" : "lost";
                    }
                  // } else if (nat === cards?.toLowerCase()?.trim()) {
                  //   updateStatus = "won";
                  // }

                    } else {
                    const normalizedWinner = String(winner || "")
                      .toLowerCase()
                      .replace(/\bof\b/g, "")
                      .replace(/\s+/g, " ")
                      .trim();

                    const normalizedSelection = String(sectionName || "")
                      .toLowerCase()
                      .replace(/\bof\b/g, "")
                      .replace(/^win with\s+/i, "")
                      .replace(/\s+/g, " ")
                      .trim();

                    const isBackWinner = normalizedSelection === normalizedWinner;
                    const betType = String(bet?.betType || "").toLowerCase().trim();

                    console.log("RACE20 CARD CHECKKKKKK+++", {
                      sectionName,
                      winner,
                      normalizedWinner,
                      normalizedSelection,
                      originalBetType: bet?.betType,
                      betType,
                      isBackWinner,
                    });

                    updateStatus =
                      betType === "lay"
                        ? isBackWinner
                          ? "lost"
                          : "won"
                        : isBackWinner
                        ? "won"
                        : "lost";
                  }
                } else if (["teensin"].includes(bet?.gType)) {
                  const [winner, highCard, pair, colorPlus, lucky9] =
                    resultData?.rdesc?.split("#").map((s) => s.trim());
                  const { sectionName, subType } = bet;
                  function extractWinner(str) {
                    if (!str) return "";
                    const match = str.match(/Player\s+[AB]/i);
                    return match ? match[0].trim() : str.trim();
                  }
                  updateStatus = "lost";
                  const condition = {
                    teensin: extractWinner(winner),

                    colorplus: colorPlus?.split("|")?.map((item) => {
                      const parts = item.split(":").map((p) => p.trim());
                      return `Color Plus ${parts[0]}`;
                    }),

                    pair: pair?.split("|")?.map((item) => {
                      const parts = item.split(":").map((p) => p.trim());
                      return `Pair ${parts[0].replace("Player ", "")}`;
                    }),

                    highcard: highCard
                      ? highCard.replace("Player", "High Card")
                      : null,
                  };
                  const normSection = sectionName?.toLowerCase()?.trim();
                  if (
                    condition?.[subType] &&
                    (Array.isArray(condition[subType]) 
                      ? condition[subType].some(c => c?.toLowerCase()?.trim() === normSection)
                      : condition[subType]?.toLowerCase()?.trim() === normSection)
                  ) {
                    updateStatus = "won";
                  }
                } else if (["ab3", "ab4"].includes(bet?.gType)) {
                  const allCards = resultData.card
                    .split(",")
                    .map((c) => c.trim());
                  const { sectionName } = bet;
                  const [type, count] = sectionName
                    ?.split("/")
                    .map((s) => s.trim());
                  const [anderBahar, card] = type
                    ?.split(" ")
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const cardPositions = allCards.map((c, idx) => {
                    const rank = mapValueToRank(parseCardValue(c));
                    return {
                      card: rank,
                      position: idx % 2 === 0 ? "Bahar" : "Andar",
                    };
                  });
                  updateStatus = "lost";
                  if (anderBahar === "Andar") {
                    const findCard = cardPositions
                      ?.slice(Number(count) - 1)
                      ?.find((item) => item?.card === card)?.position;
                    if (findCard === "Andar") {
                      updateStatus = "won";
                    }
                  }
                  if (anderBahar === "Bahar") {
                    const findCard = cardPositions
                      ?.slice(Number(count) - 1)
                      ?.find((item) => item?.card === card)?.position;
                    if (findCard === "Bahar") {
                      updateStatus = "won";
                    }
                  }
                } else if (["ab20"].includes(bet?.gType)) {
                  const allCards = resultData.card
                    .split(",")
                    .map((c) => c.trim());
                  const { sectionName } = bet;

                  const [anderBahar, card] = sectionName
                    ?.split(" ")
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const cardPositions = allCards.map((c, idx) => {
                    const rank = mapValueToRank(parseCardValue(c));
                    return {
                      card: rank,
                      position: idx % 2 === 0 ? "Bahar" : "Andar",
                    };
                  });
                  updateStatus = "lost";
                  if (anderBahar === "Andar") {
                    const findCard = cardPositions?.find(
                      (item) => item?.card === card
                    )?.position;
                    if (findCard === "Andar") {
                      updateStatus = "won";
                    }
                  }
                  if (anderBahar === "Bahar") {
                    const findCard = cardPositions?.find(
                      (item) => item?.card === card
                    )?.position;
                    if (findCard === "Bahar") {
                      updateStatus = "won";
                    }
                  }
                } else if (["patti2"].includes(bet?.gType)) {
                  const [, , , pattern] = resultData?.rdesc
                    ?.split("#")
                    .map((s) => s.trim());
                  const payoutRules = {
                    "Three card Sequence": 3,
                    "Four card color": 9,
                    "Four card Sequence": 9,
                    "Three of a kind": 12,
                    "Three card pure Sequence": 15,
                    "Four card pure Sequence": 150,
                    "Four of a kind": 200,
                  };
                  const { sectionName } = bet;
                  const normSection = sectionName?.toLowerCase()?.trim();
                  if (normSection === "color plus") {
                    if (payoutRules[pattern]) {
                      updateStatus = "won";
                      bet.odds = bet.uRate;
                      bet.uRate = payoutRules[pattern] + 1 || bet.uRate;
                    } else {
                      updateStatus = "lost";
                    }
                  }
                } else if (["trio"].includes(bet?.gType)) {
                  const [, , , , pattern] = resultData?.rdesc
                    .split("#")
                    .map((s) => s.trim());
                  const { sectionName } = bet;
                  const normSection = sectionName?.toLowerCase()?.trim();
                  updateStatus = "lost";
                  if (normSection === pattern?.toLowerCase()?.trim()) {
                    updateStatus = "won";
                  }
                } else if (["notenum"].includes(bet?.gType)) {
                  const [oddEven, blackRed, highLow, card, baccarat] = resultData?.rdesc
                    .split("#")
                    .map((s) => s.trim());

                  const { subType, sectionName, betType } = bet;
                  const normSection = sectionName?.toLowerCase()?.trim();
                  
                  const buildCardsFancy = (str) =>
                    str
                      ?.split(" ")
                      ?.filter(Boolean)
                      ?.map((item, index) => `${item} Card ${index + 1}`);

                  const buildCardsMatch = (str) =>
                    str
                      ?.split(" ")
                      ?.filter(Boolean)
                      ?.map((item, index) => `Card ${item}/Card ${index + 1}`);

                  const condition = {
                    bacc: baccarat
                      ?.split(",")
                      ?.map((s) => s.trim().toLowerCase())
                      ?.includes(normSection),
                    card: buildCardsMatch(card).some(
                      (s) => s.toLowerCase() === normSection
                    ),
                    even: buildCardsFancy(oddEven),
                    odd: buildCardsFancy(oddEven),
                    red: buildCardsFancy(blackRed),
                    black: buildCardsFancy(blackRed),
                    high: buildCardsFancy(highLow),
                    low: buildCardsFancy(highLow),
                  };

                  updateStatus = "lost";
                  const isWin = Array.isArray(condition?.[subType]) 
                    ? condition[subType].some(c => c?.toLowerCase()?.trim() === normSection)
                    : !!condition?.[subType];

                  if (betType === "lay" ? !isWin : isWin) {
                    updateStatus = "won";
                  }
                } else if (["mogambo"].includes(bet?.gType)) {
                  const section = bet?.sectionName
                    ?.replace(/\s+/g, "")
                    .toLowerCase();
                  const winner = resultData?.winnat
                    ?.replace(/\s+/g, "")
                    .toLowerCase();
                  const { subType, betType, uRate } = bet;

                  // Identify session style (Total/Line) vs Winner style
                  const isMogamboSession =
                    subType === "total" ||
                    section?.includes("total") ||
                    uRate > 10;

                  if (resultData?.rdesc?.includes("#")) {
                    const parts = resultData.rdesc
                      .split("#")
                      .map((s) => s.trim());
                    const totalResult = parseFloat(parts[1] || parts[0]);

                    if (isMogamboSession) {
                      updateStatus = (
                        betType === "lay"
                          ? totalResult < uRate
                          : totalResult >= uRate
                      )
                        ? "won"
                        : "lost";
                    } else if (winner) {
                      updateStatus =
                        betType === "lay"
                          ? winner === section
                            ? "lost"
                            : "won"
                          : winner === section
                          ? "won"
                          : "lost";
                    }
                  } else if (winner) {
                    updateStatus =
                      betType === "lay"
                        ? winner === section
                          ? "lost"
                          : "won"
                        : winner === section
                        ? "won"
                        : "lost";
                  }
                // } else if (["dolidana"].includes(bet?.gType)) {
                //   const { subType, sectionName, betType } = bet;
                //   const section = sectionName.trimEnd();
                //   const [
                //     player,
                //     anyPair,
                //     particularPair,
                //     sumTotal,
                //     oddEven,
                //     lucky7,
                //   ] = resultData?.rdesc?.split("#").map((s) => s.trim());
                //   const [a, b, c] = sectionName.split(" ").map((s) => s?.toLowerCase()?.trim());
                //   const condition = {
                //     anypair: anyPair?.toLowerCase() === "yes",
                //     sumpair: particularPair?.toLowerCase() === a,
                //     sumtotal: sumTotal === c,
                //     oddeven: oddEven?.toLowerCase() === section?.toLowerCase(),
                //     lucky7: lucky7?.toLowerCase() === section?.toLowerCase(),
                //   };
                //   updateStatus = "lost";
                //   if (
                //     betType === "lay"
                //       ? !condition?.[subType]
                //       : condition?.[subType]
                //   ) {
                //     updateStatus = "won";
                //   }
                } else if (["dolidana"].includes(bet?.gType)) {
                  updateStatus = getDoliDanaBetStatus(resultData, bet);
                
                } else if (["kbc"].includes(bet?.gType)) {
                  const odds = {
                    1: { odd: 101, even: 111 }, // Five Questions
                    2: { odd: 26.5, even: 29 }, // Four Questions Quit
                    3: { odd: 63.76, even: 69.65 }, // 50-50 Quit (all 5 correct)
                    "3_fail": { odd: 12.75, even: 14 }, // 50-50 Quit (fail 5th)
                  };
                  const [resQ1, resQ2, resQ3, resQ4, resQ5] = resultData?.rdesc
                    .split("#")
                    .map((s) => s.trim());

                  const { selected } = bet;
                  const betSelect = selected && JSON.parse(selected);
                  const bt = betSelect?.bt;

                  const chosenGroup = parseCardGroup(betSelect.Cardj?.nat);
                  const resultGroup = parseCardGroup(resQ4);
                  const answers = {
                    Q1:
                      betSelect.redblack?.nat?.toLowerCase() ===
                      resQ1.toLowerCase(),
                    Q2:
                      betSelect.oddeven?.nat?.toLowerCase() ===
                      resQ2.toLowerCase(),
                    Q3:
                      betSelect.updown?.nat?.toLowerCase() ===
                      resQ3.toLowerCase(),
                    Q4: resultGroup.some((card) => chosenGroup.includes(card)),
                    Q5:
                      betSelect.color?.nat?.toLowerCase() ===
                      resQ5.toLowerCase(),
                  };
                  updateStatus = "lost";
                  if (bt === 2) {
                    // Four Questions Quit
                    if (answers.Q1 && answers.Q2 && answers.Q3 && answers.Q4) {
                      updateStatus = "won";
                      const payout =
                        betSelect.oddeven.nat.toLowerCase() === "even"
                          ? odds[2].even
                          : odds[2].odd;

                      bet.odds = bet.uRate;
                      bet.uRate = payout + 1 || bet.uRate;
                    }
                  } else if (bt === 1) {
                    // Five Questions
                    if (
                      answers.Q1 &&
                      answers.Q2 &&
                      answers.Q3 &&
                      answers.Q4 &&
                      answers.Q5
                    ) {
                      updateStatus = "won";
                      const payout =
                        betSelect.oddeven.nat.toLowerCase() === "even"
                          ? odds[1].even
                          : odds[1].odd;
                      bet.odds = bet.uRate;
                      bet.uRate = payout + 1 || bet.uRate;
                    }
                  } else if (bt === 3) {
                    // 50-50 Quit
                    if (
                      answers.Q1 &&
                      answers.Q2 &&
                      answers.Q3 &&
                      answers.Q4 &&
                      answers.Q5
                    ) {
                      updateStatus = "won";
                      const payout =
                        betSelect.oddeven.nat.toLowerCase() === "even"
                          ? odds[3].even
                          : odds[3].odd;
                      bet.odds = bet.uRate;
                      bet.uRate = payout + 1 || bet.uRate;
                    } else if (
                      answers.Q1 &&
                      answers.Q2 &&
                      answers.Q3 &&
                      answers.Q4
                    ) {
                      updateStatus = "won";
                      const payout =
                        betSelect.oddeven.nat.toLowerCase() === "even"
                          ? odds["3_fail"].even
                          : odds["3_fail"].odd;
                      bet.odds = bet.uRate;
                      bet.uRate = payout + 1 || bet.uRate;
                    }
                  }
                } else if (["worli2", "worli", "worli3"].includes(bet?.gType)) {
                  const { subType, sectionName, betType, selected } = bet;
                  const section = sectionName.trimEnd();
                  const [pana, ocada] = resultData?.rdesc
                    .split("#")
                    .map((s) => s.trim());
                  const [a, b, c] = sectionName
                    .split(" ")
                    .map((s) => s?.toLowerCase().trim());
                  if (["56"].includes(a)) {
                    updateStatus = "lost";
                    const sortedWin = pana.split("").sort().join("");
                    const chart56Data = Object.values(chart56).flatMap(
                      (d) => d
                    );
                    if (
                      b?.toString() === "chart" &&
                      chart56Data?.includes(sortedWin)
                    ) {
                      updateStatus = "won";
                      bet.odds = bet.uRate;
                      bet.uRate = (bet.uRate - 56) / 56 + 1;
                    } else {
                      const condition = chart56?.[a?.toString()];
                      const isWin = condition?.includes(sortedWin);
                      if (isWin) {
                        updateStatus = "won";
                        bet.odds = bet.uRate;
                        bet.uRate = (bet.uRate - 6) / 6 + 1;
                      }
                    }
                  } else if (["64"].includes(a)) {
                    updateStatus = "lost";
                    const sortedWin = pana.split("").sort().join("");
                    const chart56Data = Object.values(chart64).flatMap(
                      (d) => d
                    );
                    if (
                      b?.toString() === "chart" &&
                      chart56Data?.includes(sortedWin)
                    ) {
                      updateStatus = "won";
                      bet.odds = bet.uRate;
                      bet.uRate = (bet.uRate - 64) / 64 + 1;
                    } else {
                      const condition = chart64?.[a?.toString()];
                      const isWin = condition?.includes(sortedWin);
                      if (isWin) {
                        updateStatus = "won";
                        bet.odds = bet.uRate;
                        bet.uRate = (bet.uRate - 6) / 6 + 1;
                      }
                    }
                  } else if (["common"].includes(b) && ["sp"].includes(c)) {
                    updateStatus = "lost";
                    const sortedWin = pana.split("").sort().join("");

                    const condition = commonSP?.[a?.toString()];
                    const isWin = condition?.includes(sortedWin);
                    if (isWin) {
                      updateStatus = "won";
                      bet.odds = bet.uRate;
                      bet.uRate = (bet.uRate - 36) / 36 + 1;
                    }
                  } else if (["common"].includes(b) && ["dp"].includes(c)) {
                    updateStatus = "lost";
                    const sortedWin = pana.split("").sort().join("");
                    const condition = commonDP?.[a?.toString()];
                    const isWin = condition?.includes(sortedWin);
                    if (isWin) {
                      updateStatus = "won";
                      bet.odds = bet.uRate;
                      bet.uRate = (bet.uRate - 18) / 18 + 1;
                    }
                  } else if (["color"].includes(b) && ["dp"].includes(c)) {
                    updateStatus = "lost";
                    const sortedWin = pana.split("").sort().join("");
                    const chart56Data = Object.values(colorDP).flatMap(
                      (d) => d
                    );
                    if (
                      a?.toString() === "all" &&
                      chart56Data?.includes(sortedWin)
                    ) {
                      updateStatus = "won";
                      bet.odds = bet.uRate;
                      bet.uRate = (bet.uRate - 40) / 40 + 1;
                    } else {
                      const condition = colorDP?.[a?.toString()];
                      const isWin = condition?.includes(sortedWin);
                      if (isWin) {
                        updateStatus = "won";
                        bet.odds = bet.uRate;
                        bet.uRate = (bet.uRate - 4) / 4 + 1;
                      }
                    }
                  } else if (["abr"].includes(b)) {
                    updateStatus = "lost";
                    const sortedWin = pana.split("").sort().join("");
                    if (
                      a?.toString() === "abr" &&
                      abr?.[a]?.includes(sortedWin)
                    ) {
                      updateStatus = "won";
                      bet.odds = bet.uRate;
                      bet.uRate = (bet.uRate - 30) / 30 + 1;
                    } else if (a?.toString() === "abrcut") {
                      const condition = abr?.[a];
                      const isWin = condition?.includes(sortedWin);
                      if (isWin) {
                        updateStatus = "won";
                        bet.odds = bet.uRate;
                        bet.uRate = (bet.uRate - 90) / 90 + 1;
                      }
                    } else if (a?.length === 1) {
                      const condition = abr?.[a];
                      const isWin = condition?.includes(sortedWin);
                      if (isWin) {
                        updateStatus = "won";
                        bet.odds = bet.uRate;
                        bet.uRate = (bet.uRate - 10) / 10 + 1;
                      }
                    } else if (a?.length === 2) {
                      const condition = abr?.[a];
                      const isWin = condition?.includes(sortedWin);
                      if (isWin) {
                        updateStatus = "won";
                        bet.odds = bet.uRate;
                        bet.uRate = (bet.uRate - 20) / 20 + 1;
                      }
                    }
                  } else if (["trio"].includes(b)) {
                    updateStatus = "lost";
                    const sortedWin = pana.split("").sort().join("");
                    const checkSp = await checkPannaType(sortedWin);
                    if (a?.toString() === "all" && checkSp === "tp") {
                      updateStatus = "won";
                      bet.odds = bet.uRate;
                      bet.uRate = (bet.uRate - 10) / 10 + 1;
                    }
                  } else if (["dp"].includes(b)) {
                    updateStatus = "lost";
                    const sortedWin = pana.split("").sort().join("");
                    const checkSp = await checkPannaType(sortedWin);
                    if (a?.toString() === "all" && checkSp === "dp") {
                      updateStatus = "won";
                      bet.odds = bet.uRate;
                      bet.uRate = (bet.uRate - 90) / 90 + 1;
                    } else if (checkSp === "dp") {
                      const condition = DPGroups?.[a?.toString()];
                      const isWin = condition?.some((pana) => {
                        return sortedWin === pana.split("").sort().join("");
                      });
                      if (isWin) {
                        updateStatus = "won";
                        bet.odds = bet.uRate;
                        bet.uRate = (bet.uRate - 9) / 9 + 1;
                      }
                    }
                  } else if (["sp"].includes(b)) {
                    updateStatus = "lost";
                    const sortedWin = pana.split("").sort().join("");
                    const checkSp = checkPannaType(sortedWin);
                    if (a?.toString() === "all" && checkSp === "sp") {
                      updateStatus = "won";
                      bet.odds = bet.uRate;
                      bet.uRate = (bet.uRate - 120) / 120 + 1;
                    } else if (checkSp === "sp") {
                      const condition = SPGroups?.[a?.toString()];
                      const isWin = condition?.some((pana) => {
                        return sortedWin === pana.split("").sort().join("");
                      });
                      if (isWin) {
                        updateStatus = "won";
                        bet.odds = bet.uRate;
                        bet.uRate = (bet.uRate - 12) / 12 + 1;
                      }
                    }
                  } else if (["pana"].includes(b)) {
                    updateStatus = "lost";
                    const sortedUser = selected.split("").sort().join("");
                    const sortedWin = pana.split("").sort().join("");
                    if (sortedUser === sortedWin) {
                      updateStatus = "won";
                    }
                  } else if (["even", "odd"].includes(a)) {
                    const condition = {
                      even: ["2", "4", "6", "8", "0"],
                      odd: ["1", "3", "5", "7", "9"],
                    };
                    updateStatus = "lost";
                    if (condition?.[a]?.includes(ocada?.toString())) {
                      updateStatus = "won";
                      bet.odds = bet.uRate;
                      bet.uRate = (bet.uRate - 5) / 5 + 1;
                    }
                  } else if (["line"].includes(a)) {
                    const condition = {
                      1: ["1", "2", "3", "4", "5"],
                      2: ["6", "7", "8", "9", "0"],
                    };
                    updateStatus = "lost";
                    if (condition?.[b]?.includes(ocada?.toString())) {
                      updateStatus = "won";
                      bet.odds = bet.uRate;
                      bet.uRate = (bet.uRate - 5) / 5 + 1;
                    }
                  } else if (b === "single") {
                    updateStatus = "lost";
                    if (a?.toString() === ocada?.toString()) {
                      updateStatus = "won";
                    }
                  }
                }

                if (["won", "lost", "tie"].includes(updateStatus)) {
                  if (
                    bet?.gType === "mogambo" &&
                    (bet?.subType === "total" ||
                      bet?.sectionName?.toLowerCase().includes("total") ||
                      bet?.uRate > 10)
                  ) {
                    // if (updateStatus === "won") {
                    //   profitLoss =
                    //     (parseFloat(bet?.bhav || 100) *
                    //       parseFloat(bet?.amount || 0)) /
                    //     100;
                    // } else {
                    //   profitLoss = -parseFloat(bet?.amount || 0);
                    // }
                       const amount = parseFloat(bet?.amount || 0);
                      const bhav = parseFloat(bet?.bhav || 100);
                      const betType = String(bet?.betType || "").toLowerCase();

                    if (betType === "lay") {
                      // LAY won: stake profit
                      if (updateStatus === "won") {
                        profitLoss = Number(amount.toFixed(2));
                      }

                      // LAY loss : bhav liability
                      else if (updateStatus === "lost") {
                        profitLoss = -Number(
                          ((bhav * amount) / 100).toFixed(2)
                        );
                      }
                    } else {
                      // Existing BACK logic — unchanged
                      if (updateStatus === "won") {
                        profitLoss = Number(
                          ((bhav * amount) / 100).toFixed(2)
                        );
                      } else if (updateStatus === "lost") {
                        profitLoss = -Number(amount.toFixed(2));
                      }
                    }

                  } else if (
                    resultData?.win == 0 &&
                    [
                      "lucky5",
                      "lucky7eu2",
                      "lucky7eu",
                      "lucky7",
                      "plucky7",
                      "tlucky7",
                    ].includes(bet?.gType) &&
                    tieGameCondition?.[bet?.gType].includes(bet?.sectionName)
                  ) {
                    profitLoss =
                      -1 *
                      Number(
                        (
                          ((parseFloat(bet?.uRate || 0) - 1) *
                         // ((parseFloat(bet?.uRate || 0)) *
                            parseFloat(bet?.amount || 0)) /
                          2
                        ).toFixed(2)
                      );
                  } else if (
                    resultData?.win == 0 &&
                    isTeenpatti20Bet(bet) &&
                    tieGameCondition?.[bet?.gType].includes(bet?.sectionName)
                  ) {
                    profitLoss = 0; 
                  } else if (isTeenpattiBet(bet)) {
                    profitLoss = getTeenpattiProfitLoss(bet, updateStatus);
                  } else if (
                      bet?.gType === "lucky5" &&
                      bet?.betType === "back" &&
                      updateStatus === "won"
                    ) {
                     profitLoss = Number(
                        (
                          Number(bet?.amount || 0) *
                         (Number(bet?.uRate || 0) - 1)
                         //(Number(bet?.uRate || 0))
                        ).toFixed(2)
                      );
                      console.log("+++++++++LUCKY5 BACK WIN5+++++++", profitLoss);
                  } else if (isJokerBet(bet)) {
                    profitLoss = getOddsProfitLoss(bet, updateStatus);
                  } else if (
                    bet?.subType === "race20fancy" &&
                    bet?.betType === "lay" &&
                    updateStatus === "won"

                  ) {
                  //  profitLoss = parseFloat(bet?.amount || 0);// layWon Changes
                    // profitLoss = Number(
                    //   (
                    //     //parseFloat(bet?.uRate || 0) *
                    //        (parseFloat(bet?.uRate || 0) - 1) *
                    //     parseFloat(bet?.amount || 0)
                    //   ).toFixed(2)
                    // );

                    profitLoss = Number(
                        parseFloat(bet?.amount || 0).toFixed(2)
                    );
                    
                  } else if (
                    bet?.subType === "race20fancy" &&
                    bet?.betType === "lay" &&
                    updateStatus === "lost"
                  ) {
                      profitLoss =
                        -1 *
                        ((parseFloat(bet?.bhav || 0) *
                          parseFloat(bet?.amount || 0)) /
                          100); //layLost change
                      //  profitLoss = applyTeenJokerProfitLoss(
                      //     bet,
                      //     updateStatus,
                      //     Number(
                      //       (
                      //         -1 *
                      //        // ((parseFloat(bet?.uRate || 0)) *
                      //        ((parseFloat(bet?.uRate || 0) - 1) *
                      //           parseFloat(bet?.amount || 0))
                      //       ).toFixed(2)
                      //     )
                      //   );
                  } else if (
                    bet?.subType === "race20fancy" &&
                    bet?.betType === "back" &&
                    updateStatus === "won"
                  ) {
                    profitLoss =
                      (parseFloat(bet?.bhav || 0) *
                        parseFloat(bet?.amount || 0)) /
                      100;
                  } else if (
                    bet?.subType === "race20fancy" &&
                    bet?.betType === "back" &&
                    updateStatus === "lost"
                  ) {
                    profitLoss = -parseFloat(bet?.amount || 0);
                  } else if (
                    [
                      "baccarat",
                      "baccarat2",
                      "pbaccarat",
                      "tbaccarat",
                      "sicbo2",
                      "sicbo",
                    ].includes(bet?.gType) &&
                    updateStatus === "won"
                  ) {
                    
                    // profitLoss =
                    //  // parseFloat(bet?.uRate || 0) *
                    //     (parseFloat(bet?.uRate || 0) - 1) *
                    //   parseFloat(bet?.amount || 0);
                     const uRate = parseFloat(bet?.uRate || 0);
                          const amount = parseFloat(bet?.amount || 0);

                          profitLoss =
                            (uRate > 1 ? (uRate - 1) : uRate) * amount;
                        
                  } else if (
                    bet?.gType === "cmeter1" &&
                    updateStatus === "won"
                  ) {
                    profitLoss =
                      (parseFloat(bet?.settledRate || 0) *
                      parseFloat(bet?.amount || 0)) * 0.98;
                  } else if (
                    bet?.gType === "cmeter1" &&
                    updateStatus === "lost"
                  ) {
                    profitLoss =
                      -1 *
                      (parseFloat(bet?.settledRate || 0) *
                        parseFloat(bet?.amount || 0));
                  } else if (
                    (bet?.betType === "lay" || bet?.gType === "cmeter1") &&
                    updateStatus === "won"
                  ) {
                    // profitLoss = applyTeenJokerProfitLoss(
                    //   bet,
                    //   updateStatus,
                    //   parseFloat(bet?.amount || 0)
                    // );//////layWon Changes
                      // profitLoss = applyTeenJokerProfitLoss(
                      //   bet,
                      //   updateStatus,
                      //   Number(
                      //     (
                      //       //parseFloat(bet?.uRate || 0) *
                      //          (parseFloat(bet?.uRate || 0) - 1) *
                      //       parseFloat(bet?.amount || 0)
                      //     ).toFixed(2)
                      //   )
                      // );
                       profitLoss = applyTeenJokerProfitLoss(
                        bet,
                        updateStatus,
                        Number(parseFloat(bet?.amount || 0).toFixed(2))
                      );
                  } else if (
                    (bet?.betType === "lay" || bet?.gType === "cmeter1") &&
                    updateStatus === "lost"
                  ) {
                    // profitLoss = applyTeenJokerProfitLoss(
                    //   bet,
                    //   updateStatus,
                    //   Number(
                    //     (
                    //       -1 *
                    //      // ((parseFloat(bet?.uRate || 0) - 1) *
                    //        ((parseFloat(bet?.uRate || 0)) *
                    //         parseFloat(bet?.amount || 0))
                    //     ).toFixed(2)
                    //   )
                    // );//layLost Changes
                      profitLoss = applyTeenJokerProfitLoss(
                    bet,
                    updateStatus,
                    Number(
                      (
                        -1 *
                      //  ((parseFloat(bet?.uRate || 0)) *
                      ((parseFloat(bet?.uRate || 0) - 1) *
                          parseFloat(bet?.amount || 0))
                      ).toFixed(2)
                    )
                  );

                  } else if (updateStatus === "won") {
                    profitLoss = Number(
                      (
                        (parseFloat(bet?.uRate || 0) - 1) *
                        //parseFloat(bet?.uRate || 0) *
                        parseFloat(bet?.amount || 0)
                      ).toFixed(2)
                    );
                  } else {
                    profitLoss = -parseFloat(bet?.amount || 0);
                  }

                  if (updateStatus === "tie") {
                    profitLoss = profitLoss / 2;
                    updateStatus = "lost";
                  }
                  profitLoss = applyTeenJokerProfitLoss(bet, updateStatus, profitLoss);
                  console.log("FINAL SETTLEMENT", {
                      betId: bet._id.toString(),
                      section: bet.sectionName,
                      betType: bet.betType,
                      odds: bet.uRate,
                      amount: bet.amount,
                      status: updateStatus,
                      finalProfit: profitLoss
                  });
                  if (updateStatus === "lost") {
                      casinoLostBets.push({
                        ...bet.toObject?.() ?? bet,
                        status: "lost",
                        eventName: resultData?.ename ?? bet.eventName,
                      });
                    }
                  bulkOps.push({
                    updateOne: {
                      filter: { _id: bet._id, status: "pending" },
                      update: {
                        $set: {
                          profit: profitLoss,
                          status: updateStatus,
                          eventName: resultData?.ename,
                          uRate: bet.settledRate || bet.uRate,
                          odds: bet.odds || bet.uRate,
                          cresult: resultData,
                        },
                      },
                    },
                  });
                  balance += profitLoss;
                  if (
                    bet?.subType === "race20fancy" &&
                    bet?.betType === "lay"
                  ) {
                    updateExp += Number(parseFloat(bet?.bhav).toFixed(2));
                  } else if (bet?.gType === "cmeter1") {
                    const originalRate = parseFloat(bet?.odds || bet?.uRate || 0);
                    const multiplier = Math.max(0, originalRate - 1);
                    updateExp += Number((multiplier * parseFloat(bet?.amount || 0)).toFixed(2));
                  } else if (
                    bet?.gType === "mogambo" &&
                    (bet?.subType === "total" ||
                      bet?.sectionName?.toLowerCase().includes("total") ||
                      bet?.uRate > 10)
                  ) {
                    const rate = parseFloat(bet?.bhav || bet?.odds || bet?.uRate || 0);
                    const amount = parseFloat(bet?.amount || 0);
                    // For Mogambo Total, exposure was (rate / 100) * amount
                    if (bet?.betType === "lay") {
                      updateExp += amount;
                      //updateExp += Number(((rate / 100) * amount).toFixed(2));
                    } else {
                     // updateExp += amount;
                      updateExp += Number(((rate / 100) * amount).toFixed(2));
                    }
                  } else if (
                    bet?.betType === "lay" &&
                    !(
                      bet?.gType === "mogambo" &&
                      (bet?.subType === "total" ||
                        bet?.sectionName?.toLowerCase().includes("total") ||
                        bet?.uRate > 10)
                    )
                  ) {
                    updateExp += Number(
                      (
                        (parseFloat(bet?.uRate || 0) - 1) *
                       //(parseFloat(bet?.uRate || 0)) *
                        parseFloat(bet?.amount || 0)
                      ).toFixed(2)
                    );
                  } else {
                    updateExp += bet?.amount;
                  }
                  const profitCal =
                    bet?.subType === "race20fancy"
                      ? bet?.betType === "lay"
                        ? bet?.amount
                        : bet?.bhav
                      : bet?.betType === "lay" || bet?.gType === "cmeter1"
                        ? bet?.amount
                        : Number(
                          ((parseFloat(bet?.uRate) - 1) * bet?.amount).toFixed(
                        // ((parseFloat(bet?.uRate)) * bet?.amount).toFixed(
                            2
                          )
                        );
                  updatePartnerExp += profitCal;
                }
              } catch (err) {
                console.error(
                  `Error processing bet (market ${markets._id}) betId:${bet._id || "unknown"
                  }`,
                  err
                );
              }
            }
            for (const betSubType of matchBetNestedArray) {
              for (const bet of betSubType) {
                try {
                   if (["roulette11", "roulette13", "roulette12", "ourroullete"].includes(bet?.gType)) {
                      console.log("🎰 MATCH LOOP HIT2", {
                        betId: bet?._id,
                        eType: bet?.eType,
                        gType: bet?.gType,
                        sectionName: bet?.sectionName,
                        betType: bet?.betType,
                        status: bet?.status,
                      });
                    }
                  let updateStatus = bet?.status;
                  let profitLoss = 0;
                  const replaceSection = {
                    joker20: "Joker ",
                    poison20: "Poison ",
                    poison: "Poison ",
                    teenjoker: "Joker ",
                  };

                  if (
                    String(bet?.gType || "").trim().toLowerCase() === "mogambo" &&
                    String(bet?.eType || "").trim().toLowerCase() === "match"
                  ) {
                    const normalizeMogambo = (value) =>
                      String(value || "")
                        .toLowerCase()
                        .replace(/\s*\/\s*/g, "/")
                        .replace(/\s+/g, "")
                        .trim();

                    const selectedSection = normalizeMogambo(
                      bet?.sectionName
                    );

                    const resultParts = String(resultData?.rdesc || "")
                      .split("#")
                      .map(normalizeMogambo)
                      .filter(Boolean);

                    const winnerCandidates = [
                      normalizeMogambo(resultData?.winnat),
                      ...resultParts,
                    ].filter(Boolean);

                    const isBackWinner = winnerCandidates.some(
                      (winner) =>
                        winner === selectedSection ||
                        winner.includes(selectedSection) ||
                        selectedSection.includes(winner)
                    );

                    updateStatus =
                      String(bet?.betType || "").toLowerCase() === "lay"
                        ? isBackWinner
                          ? "lost"
                          : "won"
                        : isBackWinner
                        ? "won"
                        : "lost";

                    console.log("MOGAMBO MATCH SETTLEMENT:", {
                      betId: bet?._id,
                      marketId: markets?._id,
                      sectionName: bet?.sectionName,
                      selectedSection,
                      betType: bet?.betType,
                      winnat: resultData?.winnat,
                      rdesc: resultData?.rdesc,
                      winnerCandidates,
                      isBackWinner,
                      updateStatus,
                    });

                } else if (["roulette11", "roulette13", "roulette12", "ourroullete"].includes(bet?.gType)) {
                      const winner = Number(resultData?.rdesc);
                      const sectionName = String(bet?.sectionName || "");
                      const [nat, type] = sectionName.split("/").map((s) => s.trim());

                      const nums = String(nat || "")
                        .split(",")
                        .map((s) => Number(s.trim()))
                        .filter((n) => !Number.isNaN(n));

                      const roulettePatten = rouletteNumbers();

                      const condition = {
                        Single: Number(nat) === winner,
                        Dozen: roulettePatten?.[winner]?.dozen === nat,
                        Half: ["Black", "Red"].includes(nat)
                          ? roulettePatten?.[winner]?.color === nat
                          : ["Odd", "Even"].includes(nat)
                          ? roulettePatten?.[winner]?.oddEven === nat
                          : ["1 to 18", "19 to 36"].includes(nat)
                          ? roulettePatten?.[winner]?.range === nat
                          : false,
                        Column: roulettePatten?.[winner]?.column === nat,
                        Corner: nums.includes(winner),
                        Split: nums.includes(winner),
                        Street: nums.includes(winner),
                      };

                      
                      const isWin = !!condition?.[type];

                      updateStatus =
                        bet?.betType === "lay"
                          ? isWin ? "lost" : "won"
                          : isWin ? "won" : "lost";

                      console.log("🎰 ====ROULETTE12 STATUS FIX2====", {
                        betId: bet?._id,
                        winner,
                        sectionName,
                        nat,
                        type,
                        betType: bet?.betType,
                        isWin,
                        updateStatus,
                      });
                    }

                  const replaceLayBetSection = {
                    "Player A": "Player B",
                    "Player B": "Player A",
                  };
                  if (
                    [
                      "lucky5",
                      "joker20",
                      "poison20",
                      "poison",
                      "teenjoker",
                      "joker1",
                      "joker120",
                      "goal",
                      "goal2",
                    ].includes(bet?.gType)
                  ) {
                    let section = bet?.sectionName?.replace(
                      replaceSection?.[bet?.gType] ?? "",
                      ""
                    );

                    if (bet?.betType === "lay") {
                      const laySection =
                        replaceLayBetSection[section] ?? section;
                      section = laySection;
                    }
                    if (bet?.gType === "joker1" && bet?.selected) {
                      updateStatus = checkJokerResult(resultData, bet, section);
                    } else if (
                      rdesc.length > 0 &&
                      rdesc.some(
                        (r) =>
                          r.toLowerCase().trim() === section?.toLowerCase()?.trim()
                      )
                    ) {
                      updateStatus = "won";
                    } else {
                      updateStatus = "lost";
                    }
                    if (isJokerBet(bet)) {
                      updateStatus = applyLayToBackStatus(bet, updateStatus);
                    }
                  } else if (["lucky15"].includes(bet?.gType)) {
                    const checkBet = {
                      "Extra Runs": [
                        "Wide",
                        "Leg Bye",
                        "Bye",
                        "No Ball",
                        "Extra Runs",
                      ],
                      Wicket: [
                        "Caught",
                        "Bowled",
                        "Run Out",
                        "LBW",
                        "Stumped",
                        "Wicket",
                      ],
                    };
                    const isWin =
                      checkBet?.[bet?.sectionName]?.some(
                        (b) => b?.toLowerCase()?.trim() === resultData?.rdesc?.toLowerCase()?.trim()
                      ) ||
                      rdesc?.some(
                        (r) => r?.toLowerCase()?.trim() === bet?.sectionName?.replace("Runs", "Run")?.toLowerCase()?.trim()
                      );
                    updateStatus = isWin ? "won" : "lost";
                  } else if (["btable2", "btable"].includes(bet?.gType)) {
                    const section =
                      bet?.sectionName === "Odd"
                        ? bet?.betType === "lay"
                          ? "No"
                          : "Yes"
                        : bet?.sectionName?.replaceAll(
                          /( K-Q| J-A|Card )/g,
                          ""
                        );

                    const normSection = section?.toLowerCase()?.trim();
                    const winNat = resultData?.winnat?.toLowerCase()?.trim();
                    if (bet?.betType === "lay") {
                      if (winNat === normSection) {
                        updateStatus = "lost";
                      } else {
                        updateStatus = "won";
                      }
                    } else {
                      if (rdesc.length > 0 && rdesc.some(r => r?.toLowerCase()?.trim() === normSection)) {
                        updateStatus = "won";
                      } else {
                        updateStatus = "lost";
                      }
                    }
                  } else if (isTeenpattiMatchBet(bet)) {
                    updateStatus = getTeenpattiBetStatus(resultData, bet);
                  } else if (
                    [
                      "teen42",
                      "teen41",
                      "teen3",
                      "teen33",
                      "card32",
                      "pcard32",
                      "tcard32",
                      "teen32",
                      "poker",
                      "dt6",
                      "pdt6",
                      "tdt6",
                      "card32eu",
                      "aaa",
                      "aaa2",
                      "teen6",
                      "queen",
                      "trap",
                      "teen1",
                      "race2",
                      "patti2",
                    ].includes(bet?.gType)
                  ) {
                    const section = bet?.sectionName
                      ?.replace("Main", "")
                      ?.toLowerCase()
                      ?.trim();
                    const winnat = resultData?.winnat?.toLowerCase()?.trim();

                    // if (bet?.betType === "lay") {
                    //   if (winnat === section) {
                    //     updateStatus = "lost";
                    //   } else {
                    //     updateStatus = "won";
                    //   }
                    // } else {
                    //   if (winnat === section) {
                    //     updateStatus = "won";
                    //   } else {
                    //     updateStatus = "lost";
                    //   }
                    // }
                    const clean = (val) => val?.toString().trim().toLowerCase();
                    const winNat = resultData?.winnat;
                    const rdesc = resultData?.rdesc;
                    const betValue = section || bet?.sectionName;
                    let isWin = false;

                    if (clean(winNat) === clean(betValue)) {
                      isWin = true;
                    } else if (
                      rdesc?.split("#")?.some((part) => clean(part) === clean(betValue))
                    ) {
                      isWin = true;
                    } else if (clean(winNat) === "result" && clean(rdesc) === clean(betValue)) {
                      isWin = true;
                    }

                    if (bet?.betType === "lay") {
                      updateStatus = isWin ? "lost" : "won";
                    } else {
                      updateStatus = isWin ? "won" : "lost";
                    }
                  // } else if (["dolidana"].includes(bet?.gType)) {
                  //   const section = (bet?.sectionName || "").toLowerCase()?.trim();
                  //   const parts = (resultData?.rdesc || "")
                  //     .split("#")
                  //     .map((s) => s.toLowerCase()?.trim());
                  //   const winner = parts[1] || "";
                  //   if (bet?.betType === "lay") {
                  //     updateStatus = winner === section ? "lost" : "won";
                  //   } else {
                  //     updateStatus = winner === section ? "won" : "lost";
                  //   }
                  } else if (["dolidana"].includes(bet?.gType)) {
                    updateStatus = getDoliDanaBetStatus(resultData, bet);

                  } else if (["race20"].includes(bet?.gType)) {
                    // const section = bet?.sectionName
                    //   ?.toLowerCase()
                    //   ?.replace(/\s+of\s+/g, " ")
                    //   ?.trim();
                    // const winnat = resultData?.winnat?.toLowerCase()?.trim();
                    // const clean = (val) => val?.toString().trim().toLowerCase();

                    // const winNat = resultData?.winnat;
                    // const rdesc = resultData?.rdesc;
                    // const betValue = bet?.sectionName;

                    // let isWin = false;

                    // // 1. direct match
                    // if (clean(winNat) === clean(betValue)) {
                    //   isWin = true;
                    // }

                    // // 2. rdesc multi match
                    // else if (clean(rdesc)?.includes(clean(betValue))) {
                    //   isWin = true;
                    // }

                    // // 3. joker case
                    // else if (clean(winNat) === "result" && clean(rdesc) === clean(betValue)) {
                    //   isWin = true;
                    // }

                    // // apply lay/back logic
                    // if (bet?.betType === "lay") {
                    //   updateStatus = isWin ? "lost" : "won";
                    // } else {
                    //   updateStatus = isWin ? "won" : "lost";
                    // }
                    const [winner, points, cards] = resultData?.rdesc
                          .split("#")
                          .map((s) => s.trim());

                        const { sectionName, uRate } = bet;
                        updateStatus = "lost";

                        const nat = sectionName
                          ?.toLowerCase()
                          ?.replaceAll("win with", "")
                          ?.trim();

                        if (nat === "total points") {
                          const pointsNum = parseFloat(points) || 0;
                          const rateNum = parseFloat(uRate) || 0;

                          if (bet?.betType === "lay") {
                            updateStatus = pointsNum >= rateNum ? "lost" : "won";
                          } else {
                            updateStatus = pointsNum >= rateNum ? "won" : "lost";
                          }
                        } else if (nat === "total cards") {
                          const cardsNum = parseFloat(cards) || 0;
                          const rateNum = parseFloat(uRate) || 0;

                          if (bet?.betType === "lay") {
                            updateStatus = cardsNum >= rateNum ? "lost" : "won";
                          } else {
                            updateStatus = cardsNum >= rateNum ? "won" : "lost";
                          }
                        } else {
                          const normalizedWinner = String(winner || "")
                            .toLowerCase()
                            .replace(/\bof\b/g, "")
                            .replace(/\s+/g, " ")
                            .trim();

                          const normalizedSelection = String(sectionName || "")
                            .toLowerCase()
                            .replace(/\bof\b/g, "")
                            .replace(/^win with\s+/i, "")
                            .replace(/\s+/g, " ")
                            .trim();

                          const isBackWinner =
                            normalizedSelection === normalizedWinner;

                          const betType = String(bet?.betType || "")
                            .toLowerCase()
                            .trim();

                          updateStatus =
                            betType === "lay"
                              ? isBackWinner
                                ? "lost"
                                : "won"
                              : isBackWinner
                              ? "won"
                              : "lost";

                          console.log("RACE20 FANCY CARD CHECK", {
                            sectionName,
                            winner,
                            normalizedWinner,
                            normalizedSelection,
                            betType,
                            isBackWinner,
                            updateStatus,
                          });
                        }

                  } else if (["dum10"].includes(bet?.gType)) {
                    const winNat = resultData?.winnat?.toLowerCase()?.trim();
                    if (bet?.betType === "lay") {
                      if (winNat === "yes") {
                        updateStatus = "lost";
                      } else {
                        updateStatus = "won";
                      }
                    } else {
                      if (rdesc.length > 0 && winNat === "yes") {
                        updateStatus = "won";
                      } else {
                        updateStatus = "lost";
                      }
                    }
                  } else if (["cmatch20"].includes(bet?.gType)) {
                    const [label, run] = bet?.sectionName
                      ?.split(" ")
                      ?.map((s) => s?.trim())
                      ?.filter(Boolean);

                    const runNum = Number(run);
                    const winNatNum = Number(resultData?.winnat);
                    const total = runNum + winNatNum;

                    if (bet?.betType === "lay") {
                      if (total >= 12) {
                        updateStatus = "lost";
                      } else {
                        updateStatus = "won";
                      }
                    } else {
                      if (total >= 12) {
                        updateStatus = "won";
                      } else {
                        updateStatus = "lost";
                      }
                    }
                  }
                  if (["won", "lost"].includes(updateStatus)) {
                    if (isTeenpattiBet(bet)) {
                      profitLoss = getTeenpattiProfitLoss(bet, updateStatus);

                    } else if (isJokerBet(bet)) {
                      profitLoss = getOddsProfitLoss(bet, updateStatus);
                    } else if (
                      bet?.gType === "lucky5" &&
                      bet?.betType === "back" &&
                      updateStatus === "won"
                    ) {
                     profitLoss = Number(
                        (
                          //Number(bet?.amount || 0) *
                           (Number(bet?.uRate || 0) - 1)
                            (Number(bet?.uRate || 0))
                        ).toFixed(2)
                      );

                    console.log("+++++++++ LUCKY5 BACK WIN+++++++", profitLoss);

                  //  } else if (
                  //     bet?.gType === "race20" &&
                  //     bet?.subType === "race20fancy" &&
                  //     ["Total points", "Total cards"].includes(bet?.sectionName)
                  //   ) {
                  //      console.log("+++++++++Race20 BACK LAY WIN+++++++");
                  //      console.log("RACE20 SPECIAL BLOCK", {
                  //       gType: bet.gType,
                  //       subType: bet.subType,
                  //       sectionName: bet.sectionName,
                  //       betType: bet.betType,
                  //       rate: bet.uRate,
                  //       amount: bet.amount,
                  //       bhav:bet.bhav,
                  //       updateStatus
                  //     });

                  //     ///Race20 chnges
                  //     const amount = Number(bet?.amount || 0);
                  //     const rate = Number(bet?.uRate || 0);

                  //     if (bet?.betType === "back") {
                  //       profitLoss =
                  //         updateStatus === "won"
                  //           ? Number((parseFloat(bet?.bhav || 0) *
                  //       parseFloat(bet?.amount || 0)) /
                  //     100)
                  //           : -amount;
                  //     } else if (bet?.betType === "lay") {
                  //       profitLoss =
                  //         updateStatus === "won"
                  //           ? amount
                  //           : -((parseFloat(bet?.bhav || 0) *
                  //       parseFloat(bet?.amount || 0)) /
                  //       100);
                            
                  //     }
                  //       console.log("RACE20 FINAL PROFIT", profitLoss);
                  //        console.log("+++++++++Race20 BACK WIN+++++++", profitLoss);
                      } else if (
                        String(bet?.gType || "").trim().toLowerCase() === "race20" &&
                        ["total points", "total cards"].includes(
                          String(bet?.sectionName || "").trim().toLowerCase()
                        )
                      ) {
                        const amount = Number(bet?.amount || 0);
                        const bhav = Number(bet?.bhav || 0);
                        const betType = String(bet?.betType || "")
                          .trim()
                          .toLowerCase();

                        if (!Number.isFinite(amount) || amount <= 0) {
                          profitLoss = 0;
                        } else if (!Number.isFinite(bhav) || bhav <= 0) {
                          console.error("INVALID RACE20 BHAV", {
                            betId: bet?._id,
                            sectionName: bet?.sectionName,
                            betType,
                            bhav: bet?.bhav,
                            amount: bet?.amount,
                          });

                          profitLoss = 0;
                        } else if (betType === "back") {
                          if (updateStatus === "won") {
                            // Example: bhav 90, amount 100 => +90
                            profitLoss = Number(
                              ((bhav * amount) / 100).toFixed(2)
                            );
                          } else {
                            // Back lost => full stake loss
                            profitLoss = -Number(amount.toFixed(2));
                          }
                        } else if (betType === "lay") {
                          if (updateStatus === "won") {
                            // Lay won => full stake profit
                            profitLoss = Number(amount.toFixed(2));
                          } else {
                            // Example: bhav 110, amount 100 => -110
                            profitLoss = -Number(
                              ((bhav * amount) / 100).toFixed(2)
                            );
                          }
                        }
                        // console.log("RACE20 TOTAL SETTLEMENT2+", {
                        //   betId: bet?._id,
                        //   sectionName: bet?.sectionName,
                        //   betType,
                        //   updateStatus,
                        //   bhav,
                        //   amount,
                        //   profitLoss,
                        // });

                    } else if (bet?.betType === "lay" && updateStatus === "won") {

                       if (["roulette11", "roulette13", "roulette12", "ourroullete"].includes(bet?.gType)) {
                     // if (["roulette11", "roulette13", "ourroullete"].includes(bet?.gType)) {
                       console.log("💰 =======ROULETTE12 PROFIT BLOCK FIX=====");
                          const amount = Number(bet?.amount || 0);
                          const rate = Number(bet?.uRate || 0);

                          if (updateStatus === "won") {
                            //profitLoss = Number((amount * (rate - 1)).toFixed(2)); ///layWon Changes
                           //profitLoss = Number((amount * rate).toFixed(2));
                           profitLoss = +amount;
                          } else {
                           // profitLoss = -amount;
                            profitLoss = - Number((amount * (rate - 1)).toFixed(2));
                          }

                          console.log("💰 =======ROULETTE12 PROFIT FIX=====", {
                            betId: bet?._id,
                            sectionName: bet?.sectionName,
                            betType: bet?.betType,
                            updateStatus,
                            rate,
                            amount,
                            profitLoss,
                          });

                        }else if (["btable2", "btable"].includes(bet?.gType)) {
                          // profitLoss = Number(
                          //   (
                          //      (Number(bet?.uRate || 0) - 1) *
                          //      //(Number(bet?.uRate || 0)) *
                          //     Number(bet?.amount || 0)
                          //   ).toFixed(2)
                          // );
                           profitLoss = Number(parseFloat(bet?.amount || 0).toFixed(2));

                           
                           console.log("+++++++++LAY WIN+++++++", profitLoss);
                         }else if ([""].includes(bet?.gType)) {
                          if (bet?.betType === "back" && updateStatus === "won") {
                            profitLoss = Number(
                              (Number(bet?.roulette12amount || 0) * Number(bet?.uRate || 0)).toFixed(2)
                            );
                          } else if (bet?.betType === "back" && updateStatus === "lost") {
                            profitLoss = -Number(bet?.amount || 0);
                          } else if (bet?.betType === "lay" && updateStatus === "won") {

                            profitLoss = Number(bet?.amount || 0);
                            
                          } else if (bet?.betType === "lay" && updateStatus === "lost") {
                            // profitLoss = Number(
                            //   (-1 * 
                            //     //((Number(bet?.uRate || 0) - 1) 
                            //         ((Number(bet?.uRate || 0)) 
                            //   * Number(bet?.amount || 0))).toFixed(2)
                            // ); //laylost changes
                              profitLoss = applyTeenJokerProfitLoss(
                                bet,
                                updateStatus,
                                Number(
                                  (
                                    -1 *
                                   // ((parseFloat(bet?.uRate || 0)) *
                                   ((parseFloat(bet?.uRate || 0) - 1) *
                                      parseFloat(bet?.amount || 0))
                                  ).toFixed(2)
                                )
                              );
                          }
                       
                        } else {
                          // profitLoss = applyTeenJokerProfitLoss(
                          //   bet,
                          //   updateStatus,
                          //   parseFloat(bet?.amount || 0)
                          // );
                          // layWon Changes
                            // profitLoss = applyTeenJokerProfitLoss(
                            //   bet,
                            //   updateStatus,
                            //   Number(
                            //     (
                            //       parseFloat(bet?.uRate || 0) *
                            //       parseFloat(bet?.amount || 0)
                            //     ).toFixed(2)
                            //   )
                            // );
                            profitLoss = applyTeenJokerProfitLoss(
                            bet,
                            updateStatus,
                            Number(parseFloat(bet?.amount || 0).toFixed(2))
                          );
                           console.log("+++++++++ELSE LAY WIN+++++++", profitLoss);
                        }
                    } else if (
                      bet?.betType === "lay" &&
                      updateStatus === "lost"
                    ) {
                      // profitLoss = applyTeenJokerProfitLoss(
                      //   bet,
                      //   updateStatus,
                      //   Number(
                      //     (
                      //       -1 *
                      //      ((parseFloat(bet?.uRate || 0) - 1) *
                      //       //((parseFloat(bet?.uRate || 0)) * //layLost Changes
                      //         parseFloat(bet?.amount || 0))
                      //     ).toFixed(2)
                      //   )
                      // );

                        profitLoss = applyTeenJokerProfitLoss(
                        bet,
                        updateStatus,
                        Number(
                          (
                            -1 *
                           // ((parseFloat(bet?.uRate || 0)) *
                           ((parseFloat(bet?.uRate || 0) - 1) *
                              parseFloat(bet?.amount || 0))
                          ).toFixed(2)
                        )
                      );
                    } else if (updateStatus === "won") {
                      // profitLoss = Number(
                      //   (
                      //     (parseFloat(bet?.uRate || 0) - 1) *
                      //      //(parseFloat(bet?.uRate || 0)) *
                      //     parseFloat(bet?.amount || 0)
                      //   ).toFixed(2)
                      // );
                        // profitLoss = Number(
                        //  parseFloat(bet?.amount || 0).toFixed(2)
                        // );
                          profitLoss = Number(
                            (
                              (parseFloat(bet?.uRate || 0) - 1) *
                              parseFloat(bet?.amount || 0)
                            ).toFixed(2)
                          );
                    } else {
                      if (bet.isHalfLoss) {
                          profitLoss = -parseFloat(bet?.amount || 0) / 2;
                      } else {
                          profitLoss = -parseFloat(bet?.amount || 0);
                      }
                    }

                    if (
                      resultData?.win == 0 &&
                      bet?.betType === "back" &&
                      ["poison", "poison20"].includes(bet?.gType) &&
                      tieGameCondition?.[bet?.gType].includes(bet?.sectionName)
                    ) {
                      profitLoss = Number((profitLoss / 2).toFixed(2));
                    }
                    profitLoss = applyTeenJokerProfitLoss(bet, updateStatus, profitLoss);
                    console.log("FINAL SETTLEMENT", {
                      betId: bet._id.toString(),
                      section: bet.sectionName,
                      betType: bet.betType,
                      odds: bet.uRate,
                      amount: bet.amount,
                      status: updateStatus,
                      finalProfit: profitLoss
                  });
                  if (updateStatus === "lost") {
                    casinoLostBets.push({
                      ...bet.toObject?.() ?? bet,
                      status: "lost",
                      eventName: resultData?.ename ?? bet.eventName,
                    });
                  }
                    bulkOps.push({
                      updateOne: {
                        filter: { _id: bet._id, status: "pending" },
                        update: {
                          $set: {
                            profit: profitLoss,
                            status: updateStatus,
                            eventName: resultData?.ename,
                            cresult: resultData,
                          },
                        },
                      },
                    });
                    // const expAmount =
                    //   (findSpotsData?.sdata.find(
                    //     (item) =>
                    //       item.sid === bet?.sectionId &&
                    //       item?.subId === bet?.subId
                    //   )?.amount ?? 0) * -1;
                    balance += profitLoss;
                  }
                } catch (err) {
                  console.error(
                    `Error processing bet (market ${markets._id}) betId:${bet._id || "unknown"
                    }`,
                    err
                  );
                }
              }
              if (betSubType?.[0]?.gType === "cmatch20") {
                const maxMinusAmt =
                  (Math.min(
                    ...(findSpotsData?.sdata || []).map((item) => item?.amount || 0)
                  ) || 0) * -1;
                updateExp += maxMinusAmt;

                const maxExp = Math.max(
                  0,
                  ...(findSpotsData?.sdata || [])
                    .map((r) => r?.amount || 0)
                    .filter((v) => v > 0)
                );
                updatePartnerExp += maxExp;
              } else {
                const checkExp = (betSubType?.[0]?.sections || []).map((s) =>
                  findSpotsData?.sdata?.find((exp) => exp?.sid === s?.sid) || { amount: 0 }
                );
                const maxMinusAmt =
                  (Math.min(...(checkExp.map((item) => item?.amount || 0))) || 0) * -1;
                updateExp += maxMinusAmt;

                const minMinusAmt = Math.max(
                  0,
                  ...(findSpotsData?.sdata || [])
                    .map((item) => item?.amount || 0)
                    .filter((v) => v > 0)
                );
                updatePartnerExp += minMinusAmt;
              }
            }
            // winning/loss wise update betting status and users balance
            if (bulkOps.length > 0 || balance !== 0 || updateExp !== 0) {
              const { isReplicaSet, getSessionIfReplicaSet } = require("./db-topology");
              const { atomicUpdateUserFinance } = require("./finance.helper");
              const session = await getSessionIfReplicaSet();

              try {
                // if (session) {
                //   // REPLICA SET: Use transaction for atomicity
                //   await session.withTransaction(async () => {
                //     // 1. Update Balance first (Profit/Loss)
                //     const updatedUser = await atomicUpdateUserFinance(
                //       user?.userId,
                //       { balance }, 
                //       { session, allowNegativeBuffer: true }
                //     );
                //     if (!updatedUser) throw new Error(`User ${user?.userId} not found`);

                //     // 2. SELF-HEALING: Recalculate true exposure from scratch
                //     // This eliminates all rounding errors and missed releases from previous bets.
                //     const expDelta = await recalculateUserExposureAndGetDelta(user?.userId, { session });

                //     if (bulkOps.length > 0) {
                //       await Bet.bulkWrite(bulkOps, { session, ordered: false });
                //     }

                //     const cacheKey = `user:${updatedUser._id}`;
                //     await setCache(cacheKey, updatedUser, 60);

                //     // 3. Propagate both Profit and the accurate Exposure Delta
                //     await distributeCommissionHierarchy(updatedUser, {
                //       exp: expDelta,
                //       profit: balance,
                //     }, { session });
                //   });
                // }
                //below latest 
                // if (session) {
                //   // REPLICA SET: Use transaction for atomicity
                //   await session.withTransaction(async () => {
                    
                //     if (bulkOps.length > 0) {
                //       await Bet.bulkWrite(
                //         bulkOps,
                //         {
                //           session,
                //           ordered: false,
                //         }
                //       );
                //     }

                //     /*
                //     * 2. User balance update
                //     */
                //     const updatedUser =
                //       await atomicUpdateUserFinance(
                //         user?.userId,
                //         {
                //           balance,
                //         },
                //         {
                //           session,
                //           allowNegativeBuffer: true,
                //         }
                //       );

                //     if (!updatedUser) {
                //       throw new Error(
                //         `User ${user?.userId} not found`
                //       );
                //     }

                   
                //     const expDelta =
                //       await recalculateUserExposureAndGetDelta(
                //         user?.userId,
                //         {
                //           session,
                //         }
                //       );

                 
                //     const refreshedUser = await User.findById(
                //       user?.userId
                //     )
                //       .session(session)
                //       .lean();

                //     if (!refreshedUser) {
                //       throw new Error(
                //         `Updated user ${user?.userId} not found`
                //       );
                //     }

                //     /*
                //     * 5. Cache latest balance aur exp save 
                //     */
                //     // const cacheKey = `user:${user?.userId}`;

                //     // await setCache(
                //     //   cacheKey,
                //     //   refreshedUser,
                //     //   60
                //     // );///my change

                //     /*
                //     * 6. Parent hierarchy update 
                //     */
                //     await distributeCommissionHierarchy(
                //       refreshedUser,
                //       {
                //         exp: expDelta,
                //         profit: balance,
                //       },
                //       {
                //         session,
                //       }
                //     );
                //   });
                // }

                if (session) {
                    await session.withTransaction(async () => {
                      if (bulkOps.length > 0) {
                        console.time("bulkwrite");
                        await Bet.bulkWrite(bulkOps, {
                          session,
                          ordered: false,
                        });
                        console.timeEnd("bulkwrite");
                      }
                      console.time("finance");
                      /////for preBal and currBal
                      const updatedUser = await atomicUpdateUserFinance(
                        user?.userId,
                        { balance },
                        {
                          session,
                          allowNegativeBuffer: true,
                        }
                      );
                      console.timeEnd("finance");

                      if (!updatedUser) {
                        throw new Error(`User ${user?.userId} not found`);
                      }

                         /////below for preBal and currBal

                        // ==========================================
                        // SAVE prevBal / currBal
                        // ==========================================
                        if (bulkOps.length > 0) {
                          const finalBalance = Number(updatedUser.balance || 0);

                          const totalProfit = bulkOps.reduce(
                            (sum, op) =>
                              sum + Number(op?.updateOne?.update?.$set?.profit || 0),
                            0
                          );

                          // First settled previous balance
                          let runningBalance = Number(
                            (finalBalance - totalProfit).toFixed(2)
                          );

                          const balanceOps = [];

                          for (const op of bulkOps) {
                            const profit = Number(
                              op?.updateOne?.update?.$set?.profit || 0
                            );

                            const prevBal = Number(
                              runningBalance.toFixed(2)
                            );

                            const currBal = Number(
                              (runningBalance + profit).toFixed(2)
                            );

                            balanceOps.push({
                              updateOne: {
                                filter: {
                                  _id: op?.updateOne?.filter?._id,
                                },
                                update: {
                                  $set: {
                                    prevBal,
                                    currBal,
                                  },
                                },
                              },
                            });

                            // Next bet ka prevBal = current bet currBal
                            runningBalance = currBal;
                          }

                          if (balanceOps.length > 0) {
                            await Bet.bulkWrite(balanceOps, {
                              session,
                              ordered: false,
                            });
                          }
                        }

                      /////end for preBal and currBal

                      console.time("exp");
                      const expDelta =
                        await recalculateUserExposureAndGetDelta(
                          user?.userId,
                          { session }
                        );
                      console.timeEnd("exp");

                      const refreshedUser = await User.findById(
                        user?.userId
                      )
                        .session(session)
                        .lean();

                      console.time("hierarchy");

                      await distributeCommissionHierarchy(
                        refreshedUser,
                        {
                          exp: expDelta,
                          profit: balance,
                        },
                        { session }
                      );

                      for (const lostBet of verifiedLostBets) {
                        await distributeCasinoCommissionHierarchy(
                          refreshedUser,
                          lostBet,
                          { session }
                        );
                      }

                      console.timeEnd("hierarchy");
                    });

                    const latestUserAfterCommit = await User.findById(
                      user?.userId
                    )
                      .select("username balance exp")
                      .lean();

                    if (latestUserAfterCommit) {
                      await setCache(
                        `user:${user?.userId}`,
                        latestUserAfterCommit,
                        60
                      );
                    }
                }
                else {
                  // STANDALONE: Run operations with individual safety checks (no double-execute risk)
                  let verifiedBalance = 0;
                  let verifiedLostBets = [];
                  let verifiedBetOps = [];
                  if (bulkOps.length > 0) {
                    for (const op of bulkOps) {
                      const res = await Bet.updateOne(op.updateOne.filter, op.updateOne.update);
                      // Only add to balance if this process actually performed the status change
                      if (res.modifiedCount > 0) {
                        verifiedBalance += (
                          op.updateOne.update.$set.profit || 0
                        );
                          verifiedBetOps.push(op);
                        const settledBetId = op.updateOne.filter?._id;

                        const lostBet = casinoLostBets.find(
                          (bet) =>
                            String(bet._id) === String(settledBetId)
                        );

                        if (lostBet) {
                          verifiedLostBets.push(lostBet);
                        }
                      }

                    }
                  }

                  // Only trigger finance update if we successfully settled bets OR have exposure to release
                  if (verifiedBalance !== 0 || updateExp !== 0) {
                    // 1. Update Balance
                    const updatedUser = await atomicUpdateUserFinance(
                      user?.userId,
                      { balance: verifiedBalance }, 
                      { allowNegativeBuffer: true }
                    );

                    if (updatedUser) {
                      // 2. SELF-HEALING: Recalculate true exposure
                      //const expDelta = await recalculateUserExposureAndGetDelta(user?.userId);


                        // ==========================================
                          // SAVE prevBal / currBal FOR STANDALONE
                          // ==========================================

                          if (verifiedBetOps.length > 0) {
                            const finalBalance = Number(updatedUser.balance || 0);

                            const totalProfit = verifiedBetOps.reduce(
                              (sum, op) =>
                                sum + Number(
                                  op?.updateOne?.update?.$set?.profit || 0
                                ),
                              0
                            );

                            let runningBalance = Number(
                              (finalBalance - totalProfit).toFixed(2)
                            );

                            const balanceOps = [];

                            for (const op of verifiedBetOps) {
                              const profit = Number(
                                op?.updateOne?.update?.$set?.profit || 0
                              );

                              const prevBal = Number(
                                runningBalance.toFixed(2)
                              );

                              const currBal = Number(
                                (runningBalance + profit).toFixed(2)
                              );

                              balanceOps.push({
                                updateOne: {
                                  filter: {
                                    _id: op?.updateOne?.filter?._id,
                                  },
                                  update: {
                                    $set: {
                                      prevBal,
                                      currBal,
                                    },
                                  },
                                },
                              });

                              runningBalance = currBal;
                            }

                            if (balanceOps.length > 0) {
                              await Bet.bulkWrite(balanceOps, {
                                ordered: false,
                              });
                            }
                          }

                          // ==========================================
                          // EXISTING CODE — NO CHANGE
                          // ==========================================

                      const expStart = Date.now();

                      const expDelta =
                        await recalculateUserExposureAndGetDelta(
                          user?.userId,
                          session ? { session } : {}
                        );

                      console.log("EXPOSURE RECALC TIME:", {
                        userId: String(user?.userId),
                        durationMs: Date.now() - expStart,
                        expDelta,
                      });

                      // const cacheKey = `user:${updatedUser._id}`;///my change
                      // await setCache(cacheKey, updatedUser, 60);
                    const latestUser = await User.findById(
                          user?.userId
                        )
                          .select("username balance exp")
                          .lean();

                        if (!latestUser) {
                          throw new Error(
                            `Updated user ${user?.userId} not found`
                          );
                        }

                        console.log("TEEN62 EXP UPDATED", {
                          userId: latestUser?._id,
                          username: latestUser?.username,
                          exp: latestUser?.exp,
                          balance: latestUser?.balance,
                          expDelta,
                          time: new Date().toISOString(),
                        });

                        await setCache(
                          `user:${user?.userId}`,
                          latestUser,
                          60
                        );
                      // 3. Propagate
                      // await distributeCommissionHierarchy(updatedUser, {
                      //   exp: expDelta,
                      //   profit: verifiedBalance,
                      // });
                      
                      console.time("distribute");
                      await distributeCommissionHierarchy(
                        latestUser,
                        {
                          exp: expDelta,
                          profit: verifiedBalance,
                        }
                      );
                      for (const lostBet of verifiedLostBets) {
                        await distributeCasinoCommissionHierarchy(
                          latestUser,
                          lostBet
                        );
                      }
                      console.timeEnd("distribute");
                    }
                  }
                }
              } catch (err) {
                console.error(`[CRITICAL] Settlement failed for user ${user?.userId}:`, err);
              } finally {
                if (session) await session.endSession();
              }
            }
          } catch (err) {
            console.error(
              `Error processing user ${user?.userId} for market ${markets._id}:`,
              err
            );
          }
        }
        await mongoose.model("SportsData").deleteMany({ mid: markets._id });
        // Market level cleanup of all ghost exposure for this market
        try {
          await mongoose.model("SportsData").deleteMany({ mid: markets._id });
        } catch (e) {
          console.error("Error cleaning up SportsData:", e);
        }

        inProcessMarket = inProcessMarket.filter(
          (item) => item._id !== markets._id || item.gType !== markets?.gType
        );
      } catch (error) {
        // console.error(`❌ Error checking (marketId: ${markets._id}):`, error);
        
        // Ensure cleanup even on error
        try {
          await mongoose.model("SportsData").deleteMany({ mid: markets._id });
        } catch (e) {}

        // Always clean up the lock so next cron tick can retry
        inProcessMarket = inProcessMarket.filter(
          (item) => item._id !== markets._id || item.gType !== markets?.gType
        );
      }
    }
  } catch (err) {
    console.error("Error while checking betting result:", err);
  } finally {
    // Only reset the flag if it was a marketId call
    if (marketId) isProcessingWithMarketId = false;
  }
}


// const autoDeletePendingCasinoBets = async () => {
//   try {
//     const sixHoursAgo = new Date(
//       Date.now() - 6 * 60 * 60 * 1000
//     );

//     // EXACT SAME CASINO IDENTIFICATION
//     // as betsGroupingByMarketIdAndUserId()
//     const sportGTypes = [
//       "match",
//       "match1",
//       "fancy",
//       "fancy1",
//       "meter",
//       "khado",
//       "oddeven",
//       "cricketcasino",
//     ];

//     const match = {
//       isActive: true,
//       status: "pending",

//       // Only casino bets
//       gType: {
//         $nin: sportGTypes,
//       },

//       // Older than 6 hours
//       createdAt: {
//         $lte: sixHoursAgo,
//       },
//     };

//     // First get only eligible casino pending bets
//     const bets = await Bet.find(match).lean();

//     if (!bets?.length) {
//       console.log(
//         "[AutoDeleteCasino] No casino pending bets older than 6 hours."
//       );
//       return;
//     }

//     console.log(
//       `[AutoDeleteCasino] Found ${bets.length} casino pending bets older than 6 hours`
//     );

//     // User wise grouping
//     const userWiseBets = new Map();

//     for (const bet of bets) {
//       const userId = String(bet.userId);

//       if (!userWiseBets.has(userId)) {
//         userWiseBets.set(userId, []);
//       }

//       userWiseBets.get(userId).push(bet);
//     }

//     for (const [userId, userBets] of userWiseBets.entries()) {
//       const lockKey = `lock:user:${userId}`;

//       const lockAcquired = await acquireLock(lockKey, 5000);

//       if (!lockAcquired) {
//         console.error(
//           `[AutoDeleteCasino] Failed to acquire lock for user ${userId}`
//         );
//         continue;
//       }

//       try {
//         let expBal = 0;
//         let partnerExpBal = 0;
//         let updateBalance = 0;

//         const updatedBets = [];

//         for (const bet of userBets) {
//           /*
//            * IMPORTANT:
//            * Re-check DB before deleting.
//            *
//            * Agar is duration ke beech bet settle ho gaya
//            * ya kisi aur process ne inactive kar diya,
//            * to usko delete nahi karenge.
//            */
//           const latestBet = await Bet.findOne({
//             _id: bet._id,
//             isActive: true,
//             status: "pending",

//             // Same casino-only condition
//             gType: {
//               $nin: sportGTypes,
//             },

//             // Same 6 hour condition
//             createdAt: {
//               $lte: sixHoursAgo,
//             },
//           }).lean();

//           if (!latestBet) {
//             console.log(
//               `[AutoDeleteCasino] Skipping bet ${bet._id} - no longer eligible`
//             );
//             continue;
//           }

//           /*
//            * DELETE ONLY PENDING CASINO BET
//            */
//           const updated = await updateBet(latestBet._id, {
//             isActive: false,
//             isDeleteBetShowUser: false,
//             // IMPORTANT:
//             // yahan apne system ka valid system/admin user id use karo.
//             // Agar updatedBy optional hai to is field ko hata sakte ho.
//             updatedBy: null,
//           });

//           if (!updated) {
//             continue;
//           }

//           updatedBets.push(latestBet);

//           console.log("[AutoDeleteCasino] Bet deleted:", {
//             betId: latestBet._id.toString(),
//             userId,
//             marketId: latestBet.marketId,
//             gType: latestBet.gType,
//             eType: latestBet.eType,
//             createdAt: latestBet.createdAt,
//           });
//         }

//         /*
//          * No eligible bets were actually deleted
//          */
//         if (!updatedBets.length) {
//           continue;
//         }

//         /*
//          * ============================================================
//          * PENDING BET EXPOSURE ROLLBACK
//          * Same logic as deleteBets()
//          * BUT ONLY CASINO BRANCHES
//          * ============================================================
//          */

//         for (const bet of updatedBets) {
//           const findSpotsData = await getSportsData({
//             mid: bet?.marketId,
//             userId,
//           });

//           const existingMap = {};

//           findSpotsData?.sdata?.forEach((s) => {
//             existingMap[s.sid] = s.amount;
//           });

//           let spotsData = [];

//           const eventType = bet?.eType;
//           const odds = bet?.uRate;

//           /*
//            * IMPORTANT:
//            *
//            * Yahan subType se casino identify nahi karna.
//            *
//            * Query already guarantee kar chuki hai ki
//            * gType sport list me nahi hai.
//            *
//            * Isliye ye bet casino hai.
//            */
//           const isCasino = true;

//           /*
//            * ========================================================
//            * CASINO: CMATCH20
//            * ========================================================
//            */
//           if (isCasino && bet?.gType === "cmatch20") {
//             const sportBet = [];

//             const findOldBackBet =
//               (await getBets({
//                 marketId: bet?.marketId,
//                 userId,
//                 isActive: true,
//                 _id: { $ne: bet?._id },
//               })) ?? [];

//             const oldBets = findOldBackBet;

//             for (let sid = 1; sid <= 10; sid++) {
//               let totalAmt = 0;

//               oldBets.forEach(
//                 ({ sectionName, uRate, amount, betType }) => {
//                   const selectedRun = parseInt(
//                     sectionName.replace("Run ", ""),
//                     10
//                   );

//                   let result = 0;

//                   if (betType === "back") {
//                     result = -amount;

//                     if (selectedRun + sid >= 12) {
//                       result = amount * (uRate - 1);
//                     }
//                   } else if (betType === "lay") {
//                     result = amount;

//                     if (selectedRun + sid >= 12) {
//                       result = -amount * (uRate - 1);
//                     }
//                   }

//                   totalAmt += result;
//                 }
//               );

//               sportBet.push({
//                 sid,
//                 subId: 0,
//                 amount: Math.round(totalAmt),
//               });
//             }

//             spotsData = sportBet;

//             if (findSpotsData?.sdata?.length > 0) {
//               const oldMaxMinusAmt = Math.min(
//                 ...findSpotsData.sdata.map(
//                   (item) => item.amount
//                 )
//               );

//               expBal += oldMaxMinusAmt;

//               const maxExp = Math.max(
//                 0,
//                 ...findSpotsData.sdata
//                   .map((r) => r.amount)
//                   .filter((v) => v > 0)
//               );

//               partnerExpBal += maxExp;
//             }

//             const maxMinusAmt = Math.min(
//               ...sportBet.map((item) => item.amount)
//             );

//             expBal -= maxMinusAmt;

//             const maxExp = Math.max(
//               0,
//               ...sportBet
//                 .map((r) => r.amount)
//                 .filter((v) => v > 0)
//             );

//             partnerExpBal -= maxExp;
//           }

//           /*
//            * ========================================================
//            * CASINO: FANCY
//            * ========================================================
//            */
//           else if (
//             isCasino &&
//             ["Fancy", "fancy"].includes(eventType)
//           ) {
//             spotsData = findSpotsData?.sdata
//               ? [...findSpotsData.sdata]
//               : [];

//             const idx = spotsData.findIndex(
//               (s) =>
//                 s.sid === bet?.sectionId &&
//                 s?.subId === bet?.subId
//             );

//             const oldAmt =
//               idx > -1 ? spotsData[idx].amount : 0;

//             const oldProfit =
//               idx > -1 ? spotsData[idx].profit : 0;

//             const amountCal =
//               bet?.subType === "race20fancy"
//                 ? bet?.betType === "lay"
//                   ? -bet?.bhav
//                   : -bet?.amount
//                 : bet?.betType === "lay" ||
//                   bet?.gType === "cmeter1"
//                 ? -Number(
//                     (
//                       (parseFloat(odds) - 1) *
//                       bet?.amount
//                     ).toFixed(2)
//                   )
//                 : -bet?.amount;

//             const profitCal =
//               bet?.subType === "race20fancy"
//                 ? bet?.betType === "lay"
//                   ? bet?.amount
//                   : bet?.bhav
//                 : bet?.betType === "lay" ||
//                   bet?.gType === "cmeter1"
//                 ? bet?.amount
//                 : Number(
//                     (
//                       (parseFloat(odds) - 1) *
//                       bet?.amount
//                     ).toFixed(2)
//                   );

//             const newEntry = {
//               sid: bet?.sectionId,
//               amount: oldAmt + amountCal,
//               profit: oldProfit + profitCal,
//               subId: bet?.subId,
//             };

//             if (idx > -1) {
//               expBal -= oldAmt;
//               partnerExpBal -= oldProfit;

//               spotsData[idx] = newEntry;
//             } else {
//               spotsData.push(newEntry);
//             }

//             partnerExpBal += newEntry.profit;
//             expBal += newEntry.amount;
//           }

//           /*
//            * ========================================================
//            * CASINO: FANCY1
//            * ========================================================
//            */
//           else if (
//             isCasino &&
//             ["fancy1", "Fancy1"].includes(eventType)
//           ) {
//             spotsData = findSpotsData?.sdata
//               ? [...findSpotsData.sdata]
//               : [];

//             const idx = spotsData.findIndex(
//               (s) => s.sid === bet?.sectionId
//             );

//             const oldAmt =
//               idx > -1 ? spotsData[idx].amount : 0;

//             if (idx > -1) {
//               const maxExp = Math.max(
//                 0,
//                 ...(spotsData[idx]?.calcTable || [])
//                   .map((r) => r.profitLoss)
//                   .filter((v) => v > 0)
//               );

//               partnerExpBal += maxExp;
//             }

//             const findOldBackBet = await getBets({
//               marketId: bet?.marketId,
//               userId,
//               sectionId: bet?.sectionId,
//               betType: "back",
//               isActive: true,
//               _id: { $ne: bet?._id },
//             });

//             const findOldLayBet = await getBets({
//               marketId: bet?.marketId,
//               userId,
//               sectionId: bet?.sectionId,
//               betType: "lay",
//               isActive: true,
//               _id: { $ne: bet?._id },
//             });

//             let backOdds = bet?.bRate;
//             let layOdds = bet?.lRate;

//             let backAmt =
//               findOldBackBet?.reduce(
//                 (sum, b) =>
//                   sum + Number(b.amount || 0),
//                 0
//               ) || 0;

//             let layAmt =
//               findOldLayBet?.reduce(
//                 (sum, b) =>
//                   sum + Number(b.amount || 0),
//                 0
//               ) || 0;

//             const targetRun = 1;

//             const calcTable = [];
//             let runCount = 1;

//             for (
//               let run = targetRun - runCount;
//               run <= targetRun + runCount;
//               run++
//             ) {
//               let profitLoss = 0;

//               if (backAmt > 0) {
//                 if (run >= targetRun) {
//                   profitLoss += Number(
//                     (
//                       parseFloat(backOdds - 1) *
//                       backAmt
//                     ).toFixed(2)
//                   );
//                 } else {
//                   profitLoss -= backAmt;
//                 }
//               }

//               if (layAmt > 0) {
//                 if (run < targetRun) {
//                   profitLoss += layAmt;
//                 } else {
//                   profitLoss -= Number(
//                     (
//                       parseFloat(layOdds - 1) *
//                       layAmt
//                     ).toFixed(2)
//                   );
//                 }
//               }

//               calcTable.push({
//                 run,
//                 back:
//                   backAmt > 0
//                     ? run >= targetRun
//                       ? Number(
//                           (
//                             parseFloat(backOdds - 1) *
//                             backAmt
//                           ).toFixed(2)
//                         )
//                       : -backAmt
//                     : 0,

//                 lay:
//                   layAmt > 0
//                     ? run < targetRun
//                       ? layAmt
//                       : -Number(
//                           (
//                             parseFloat(layOdds - 1) *
//                             layAmt
//                           ).toFixed(2)
//                         )
//                     : 0,

//                 profitLoss,
//               });
//             }

//             if (idx > -1) {
//               expBal += oldAmt;
//             }

//             const minExp = Math.min(
//               ...calcTable.map((r) => r.profitLoss)
//             );

//             expBal -= minExp;

//             const newEntry = {
//               sid: bet?.sectionId,
//               amount: minExp,
//               calcTable,
//             };

//             const maxExp = Math.max(
//               0,
//               ...calcTable
//                 .map((r) => r.profitLoss)
//                 .filter((v) => v > 0)
//             );

//             partnerExpBal -= maxExp;

//             if (idx > -1) {
//               spotsData[idx] = newEntry;
//             } else {
//               spotsData.push(newEntry);
//             }
//           }

//           /*
//            * ========================================================
//            * CASINO: FANCY2
//            * ========================================================
//            */
//           else if (
//             isCasino &&
//             ["Fancy2", "fancy2"].includes(eventType)
//           ) {
//             spotsData = findSpotsData?.sdata
//               ? [...findSpotsData.sdata]
//               : [];

//             const idx = spotsData.findIndex(
//               (s) => s.sid === bet?.sectionId
//             );

//             const oldAmt =
//               idx > -1 ? spotsData[idx].amount : 0;

//             if (idx > -1) {
//               const maxExp = Math.max(
//                 0,
//                 ...(spotsData[idx]?.calcTable || [])
//                   .map((r) => r.profitLoss)
//                   .filter((v) => v > 0)
//               );

//               partnerExpBal += maxExp;
//             }

//             const findOldBackBet = await getBets({
//               marketId: bet?.marketId,
//               userId,
//               sectionId: bet?.sectionId,
//               betType: "back",
//               isActive: true,
//               _id: { $ne: bet?._id },
//             });

//             const findOldLayBet = await getBets({
//               marketId: bet?.marketId,
//               userId,
//               sectionId: bet?.sectionId,
//               betType: "lay",
//               isActive: true,
//               _id: { $ne: bet?._id },
//             });

//             let backOdds = {
//               size: bet?.bsize,
//               odds: bet?.bRate,
//             };

//             let layOdds = {
//               size: bet?.lsize,
//               odds: bet?.lRate,
//             };

//             let backAmt =
//               findOldBackBet?.reduce(
//                 (sum, b) =>
//                   sum + Number(b.amount || 0),
//                 0
//               ) || 0;

//             let layAmt =
//               findOldLayBet?.reduce(
//                 (sum, b) =>
//                   sum + Number(b.amount || 0),
//                 0
//               ) || 0;

//             const targetRun = Number(odds);

//             const calcTable = [];
//             let runCount = 1;

//             if (backOdds?.odds !== layOdds?.odds) {
//               runCount +=
//                 backOdds?.odds - layOdds?.odds;
//             }

//             for (
//               let run = targetRun - runCount;
//               run <= targetRun + runCount;
//               run++
//             ) {
//               let profitLoss = 0;

//               if (backAmt > 0) {
//                 if (run >= backOdds?.odds) {
//                   profitLoss += Number(
//                     (
//                       (backAmt * backOdds?.size) /
//                       100
//                     ).toFixed(2)
//                   );
//                 } else {
//                   profitLoss -= backAmt;
//                 }
//               }

//               if (layAmt > 0) {
//                 if (run < layOdds?.odds) {
//                   profitLoss += layAmt;
//                 } else {
//                   profitLoss -= Number(
//                     (
//                       (layAmt * layOdds?.size) /
//                       100
//                     ).toFixed(2)
//                   );
//                 }
//               }

//               calcTable.push({
//                 run,

//                 back:
//                   backAmt > 0
//                     ? run >= backOdds?.odds
//                       ? Number(
//                           (
//                             (backAmt * backOdds?.size) /
//                             100
//                           ).toFixed(2)
//                         )
//                       : -backAmt
//                     : 0,

//                 lay:
//                   layAmt > 0
//                     ? run < layOdds?.odds
//                       ? layAmt
//                       : -Number(
//                           (
//                             (layAmt * layOdds?.size) /
//                             100
//                           ).toFixed(2)
//                         )
//                     : 0,

//                 profitLoss,
//               });
//             }

//             if (idx > -1) {
//               expBal -= oldAmt;
//             }

//             const minExp = Math.min(
//               ...calcTable.map((r) => r.profitLoss)
//             );

//             expBal += minExp;

//             const maxExp = Math.max(
//               0,
//               ...calcTable
//                 .map((r) => r.profitLoss)
//                 .filter((v) => v > 0)
//             );

//             partnerExpBal -= maxExp;

//             const newEntry = {
//               sid: bet?.sectionId,
//               amount: minExp,
//               calcTable,
//             };

//             if (idx > -1) {
//               spotsData[idx] = newEntry;
//             } else {
//               spotsData.push(newEntry);
//             }
//           }

//           /*
//            * ========================================================
//            * CASINO: MATCH
//            * ========================================================
//            */
//           else if (
//             isCasino &&
//             ["match", "Match"].includes(eventType)
//           ) {
//             const findOldBet = await getBets({
//               marketId: bet?.marketId,
//               userId,
//               isActive: true,
//               _id: { $ne: bet?._id },
//             });

//             const oldMaxMinusAmt = Math.min(
//               ...(findSpotsData?.sdata || []).map(
//                 (item) => item.amount
//               )
//             );

//             if (Number.isFinite(oldMaxMinusAmt)) {
//               expBal -= oldMaxMinusAmt;
//             }

//             const maxExp = Math.max(
//               0,
//               ...(findSpotsData?.sdata || [])
//                 .map((r) => r.amount)
//                 .filter((v) => v > 0)
//             );

//             partnerExpBal -= maxExp;

//             spotsData = [
//               ...(findSpotsData?.sdata || []),
//             ];

//             let oldSportData = [];

//             findOldBet?.forEach((oldBet) => {
//               const existingMap = {};

//               oldSportData?.forEach((s) => {
//                 existingMap[s.sid] = s.amount;
//               });

//               let newSportData = [];

//               oldBet?.sections?.forEach((item) => {
//                 const isBookmakerBet =
//                   oldBet?.gType === "match1" ||
//                   oldBet?.marketName === "Bookmaker";

//                 const newAmt = Number(
//                   (
//                     isBookmakerBet
//                       ? item?.sid === oldBet?.sectionId
//                         ? (oldBet?.betType === "lay"
//                             ? -1
//                             : 1) *
//                           (
//                             (oldBet?.amount *
//                               parseFloat(
//                                 oldBet?.uRate
//                               )) /
//                             100
//                           ).toFixed(2)
//                         : (oldBet?.betType === "lay"
//                             ? 1
//                             : -1) * oldBet?.amount
//                       : item?.sid === oldBet?.sectionId
//                       ? (oldBet?.betType === "lay"
//                           ? -1
//                           : 1) *
//                         (
//                           (parseFloat(
//                             oldBet?.uRate
//                           ) - 1) *
//                           oldBet?.amount
//                         ).toFixed(2)
//                       : (oldBet?.betType === "lay"
//                           ? 1
//                           : -1) *
//                         oldBet?.amount
//                   ).toFixed(2)
//                 );

//                 const oldAmt =
//                   existingMap[item?.sid] || 0;

//                 const updatedAmt =
//                   oldAmt + newAmt;

//                 const index = spotsData.findIndex(
//                   (s) => s.sid === item.sid
//                 );

//                 if (index > -1) {
//                   spotsData[index].amount =
//                     updatedAmt;
//                 } else {
//                   spotsData.push({
//                     sid: item.sid,
//                     amount: updatedAmt,
//                   });
//                 }

//                 newSportData.push({
//                   sid: item.sid,
//                   amount: updatedAmt,
//                 });
//               });

//               oldSportData = newSportData;
//             });

//             if (!findOldBet?.length > 0) {
//               spotsData.forEach((item) =>
//                 oldSportData.push({
//                   sid: item.sid,
//                   amount: 0,
//                 })
//               );
//             }

//             spotsData = oldSportData;

//             const maxMinusAmt = Math.min(
//               ...oldSportData.map(
//                 (item) => item.amount
//               )
//             );

//             if (Number.isFinite(maxMinusAmt)) {
//               expBal += maxMinusAmt;
//             }

//             const updateMaxExp = Math.max(
//               0,
//               ...oldSportData
//                 .map((r) => r.amount)
//                 .filter((v) => v > 0)
//             );

//             partnerExpBal -= updateMaxExp;
//           }

//           /*
//            * ========================================================
//            * SAVE EXPOSURE
//            * ========================================================
//            */

//           if (spotsData?.length) {
//             await updateSportsData(
//               bet?.marketId,
//               userId,
//               {
//                 mid: bet?.marketId,
//                 sdata: spotsData,
//                 userId,
//               }
//             );
//           }
//         }

//         /*
//          * Pending bet me updateBalance normally 0 hota hai,
//          * because pending branch profit/balance change nahi karta.
//          *
//          * Exposure rollback expBal / partnerExpBal se hota hai.
//          */
//         if (
//             updateBalance !== 0 ||
//             partnerExpBal !== 0 ||
//             expBal !== 0
//           ) {
//             const user = await User.findById(userId);

//           if (!user) {
//             console.error(
//               `[AutoDeleteCasino] User not found: ${userId}`
//             );
//             continue;
//           }

//           console.log(
//             "[AutoDeleteCasino] BALANCE/EXPOSURE UPDATE",
//             {
//               userId,
//               updateBalance,
//               expBal,
//               partnerExpBal,
//             }
//           );

//           const updatedUser =
//             await atomicUpdateUserBalanceExp(
//               userId,
//               -updateBalance,
//               expBal
//             );

//           if (updatedUser) {
//             await distributeCommissionHierarchy(
//               updatedUser,
//               {
//                 exp: partnerExpBal,
//               }
//             );
//           }
//         }

//         console.log(
//           `[AutoDeleteCasino] Completed for user ${userId}. Deleted: ${updatedBets.length}`
//         );
//       } catch (userErr) {
//         console.error(
//           `[AutoDeleteCasino] User processing error ${userId}:`,
//           userErr
//         );
//       } finally {
//         await releaseLock(lockKey);
//       }
//     }
//   } catch (error) {
//     console.error(
//       "[AutoDeleteCasino] Fatal error:",
//       error
//     );
//   }
// };



module.exports = {
  checkCasinoBettingResult,
  checkSportCasinoBettingResult,
  //autoDeletePendingCasinoBets,
};
