/**
 * thirdPartyResult.service.js
 *
 * All interactions with the third-party result API (https://resultapi.live).
 * All functions are fire-and-forget safe — errors are caught internally and logged,
 * so failures never break bet placement or any calling context.
 *
 * Sport ID mapping:
 *   etid: 1 = Football
 *   etid: 2 = Tennis
 *   etid: 4 = Cricket
 */

const axios = require("axios");
const ThirdPartyFancyRegistry = require("../apis/third-party-result/thirdPartyFancyRegistry.model");
const ThirdPartyMatchRegistry = require("../apis/third-party-result/thirdPartyMatchRegistry.model");

const BASE_URL = 'https://dia-results.cricketid.xyz/api';
// Registration calls are fire-and-forget — allow more time for a slow third-party server.
const REGISTER_TIMEOUT_MS = process.env.TP_REGISTER_TIMEOUT_MS ? Number(process.env.TP_REGISTER_TIMEOUT_MS) : 20000;
// Result-polling calls run in a cron — keep them tighter so the cron doesn't stall.
const POLL_TIMEOUT_MS = process.env.TP_POLL_TIMEOUT_MS ? Number(process.env.TP_POLL_TIMEOUT_MS) : 10000;

// Feature flag — set ENABLE_TP_RESULT_API=true in .env to activate.
// When disabled, registration and result polling are fully skipped.
const TP_RESULT_API_ENABLED = process.env.ENABLE_TP_RESULT_API === "true";

/**
 * Builds the fancyKey string: "${marketId}_${sectionId}"
 */
function buildFancyKey(marketId, sectionId) {
  return `${marketId}_${sectionId}`;
}

/**
 * Register a fancy section with the third-party API.
 * Called once per unique marketId+sectionId combination.
 * Safe to call multiple times — internally deduplicates using the registry.
 *
 * Handles all response cases:
 *   - 200/201 success         → persist to local registry (resultDeclared: false)
 *   - "Fancy already exists"  → persist to local registry (another server already registered it on 3P side)
 *   - "FANCY_NAME_NOT_FOUND"  → persist with registrationFailed: true (stop retrying — 3P can't identify it)
 *   - Timeout / network error → log only, do NOT persist so we retry next time
 *
 * @param {number|string} marketId
 * @param {number|string} sectionId
 * @param {string} gameId
 * @param {number} etid - 1=football, 2=tennis, 4=cricket
 */
// async function registerFancyIfNeeded(marketId, sectionId, gameId, etid, fancyName) {
//   if (!TP_RESULT_API_ENABLED) return;
//   try {
//     const fancyKey = buildFancyKey(marketId, sectionId);

//     // Fast path — already in our registry (registered by us or another server previously)
//     const existing = await ThirdPartyFancyRegistry.findOne({ fancyKey });
//     if (existing) return;

//     let shouldPersist = false;
//     let nameNotFound = false;

//     try {
//       const response = await axios.post(
//         `${BASE_URL}/fancies`,
//         {
//           fancyId: fancyKey,
//           etid: Number(etid),
//           gameId: String(gameId),
//           ...(fancyName ? { comment: fancyName } : {}),
//         },
//         { timeout: REGISTER_TIMEOUT_MS }
//       );
//       shouldPersist = true;
//       console.log(
//         `[3P-Result] Fancy registered: fancyKey=${fancyKey}, gameId=${gameId}, etid=${etid}`,
//         response.data?.message || ""
//       );
//     } catch (apiErr) {
//       const errData = apiErr?.response?.data;
//       const errMsg = errData?.message || "";

//       if (errData?.fancy || errMsg.toLowerCase().includes("already exists")) {
//         // Another server already registered this fancy on the 3P side.
//         // Persist to our local registry so we stop re-attempting.
//         shouldPersist = true;
//         console.log(
//           `[3P-Result] Fancy already exists on 3P side — syncing to local registry: fancyKey=${fancyKey}, gameId=${gameId}`
//         );
//       } else if (errData?.error === "FANCY_NAME_NOT_FOUND" || errMsg.includes("FANCY_NAME_NOT_FOUND")) {
//         // 3P can't identify this fancy section — persist with failure flag so we never retry.
//         shouldPersist = true;
//         nameNotFound = true;
//         console.warn(
//           `[3P-Result] Fancy name not found on 3P side — marking as failed to prevent retries: fancyKey=${fancyKey}, gameId=${gameId}`
//         );
//       } else {
//         // Fallback: 3P API might return "No Record Found" if match is closed but fancy is managed.
//         try {
//           const getResponse = await axios.get(`${BASE_URL}/fancies/game/${gameId}`, { timeout: REGISTER_TIMEOUT_MS });
//           const fancies = getResponse.data?.fancies || [];
//           const matchedFancy = fancies.find(f => f.fancyId === fancyKey);
          
//           if (matchedFancy) {
//             shouldPersist = true;
//             console.log(
//               `[3P-Result] Fancy synced via GET fallback: fancyKey=${fancyKey}, gameId=${gameId}`
//             );
//           } else {
//             // Real error — do NOT persist; will retry on next bet or cron tick.
//             console.error(
//               `[3P-Result] Failed to register fancy marketId=${marketId} sectionId=${sectionId} gameId=${gameId}:`,
//               errData || apiErr.message
//             );
//           }
//         } catch (fallbackErr) {
//           console.error(
//             `[3P-Result] Failed to register fancy marketId=${marketId} sectionId=${sectionId} gameId=${gameId}:`,
//             errData || apiErr.message
//           );
//         }
//       }
//     }

//     if (shouldPersist) {
//       await ThirdPartyFancyRegistry.findOneAndUpdate(
//         { fancyKey },
//         {
//           fancyKey,
//           gameId: String(gameId),
//           marketId: Number(marketId),
//           sectionId: Number(sectionId),
//           etid: Number(etid),
//           resultDeclared: false,
//           // registrationFailed=true → cron will skip polling this fancy for results
//           ...(nameNotFound ? { registrationFailed: true } : {}),
//           // Store the fancy name so admin can see it in the registry table
//           ...(fancyName ? { comment: fancyName } : {}),
//         },
//         { upsert: true, new: true }
//       );
//     }
//   } catch (err) {
//     console.error(
//       `[3P-Result] Unexpected error registering fancy marketId=${marketId} sectionId=${sectionId} gameId=${gameId}:`,
//       err.message
//     );
//   }
// }

async function registerFancyIfNeeded(payload) {
  console.log('register fancy if needed');
  if (!TP_RESULT_API_ENABLED) return;

  try {
    const {
      event_id,
      event_name,
      market_id,
      originalMarketId,
      market_name,
      market_type,
      sectionId,
      sport_id,
      client_ref,
    } = payload;

    console.log(
      `[3P-Result][Fancy] Registration requested`,
      {
        event_id,
        event_name,
        market_id,
        market_name,
        market_type,
        sport_id,
        client_ref,
      }
    );

    const existing = await ThirdPartyFancyRegistry.findOne({
      gameId: String(event_id),
      marketId: String(market_id),
    });

    if (existing) {
      console.log(
        `[3P-Result][Fancy] Already registered locally`,
        {
          event_id,
          market_id,
        }
      );
      return;
    }

    let shouldPersist = false;
    let responseData = null;

    try {
      // const response = await axios.post(
      //   "https://dia-results.cricketid.xyz/api/bet-incoming",
      //   {
      //     event_id,
      //     event_name,
      //     market_id,
      //     market_name,
      //     market_type,
      //     sport_id,
      //     client_ref,
      //     api_key: process.env.JSK_KEY,
      //   },
      //   {
      //     timeout: REGISTER_TIMEOUT_MS,
      //   }
      // );

      // responseData = response.data;
      shouldPersist = true;

      // console.log(
      //   `[3P-Result][Fancy] Registration success`,
      //   {
      //     event_id,
      //     market_id,
      //     response: response.data,
      //   }
      // );
    } catch (apiErr) {
      console.error(
        `[3P-Result][Fancy] Registration failed`,
        {
          event_id,
          market_id,
          error:
            apiErr?.response?.data ||
            apiErr?.message ||
            "Unknown error",
        }
      );
    }

    if (!shouldPersist) {
      return;
    }

    const updateDoc = {
      gameId: String(event_id),
      marketId: String(market_id),
      originalMarketId:originalMarketId,
      sectionId:sectionId,

      eventName: event_name,
      marketName: market_name,
      marketType: market_type,

      etid: Number(sport_id),

      resultDeclared: false,
      registrationFailed: false,
    };

    await ThirdPartyFancyRegistry.findOneAndUpdate(
      {
        gameId: String(event_id),
        marketId: String(market_id),
      },
      updateDoc,
      {
        upsert: true,
        new: true,
      }
    );

    console.log(
      `[3P-Result][Fancy] Registry synced`,
      {
        event_id,
        market_id,
      }
    );

  } catch (err) {
    console.error(
      `[3P-Result][Fancy] Unexpected error`,
      err
    );
  }
}

/**
 * Register a match with the third-party API.
 * Called once per unique gameId.
 * Safe to call multiple times — internally deduplicates.
 *
 * Handles all response cases:
 *   - 200/201 success         → persist to local registry
 *   - 409 / "already exists"  → persist to local registry (another server registered it on 3P side)
 *   - Timeout / network error → log only, retry next time
 *
 * @param {string} gameId
 * @param {number} etid - 1=football, 2=tennis, 4=cricket
 */
// async function registerMatchIfNeeded(payload) {
//   const {
//     event_id,
//     event_name,
//     market_id,
//     market_name,
//     market_type,
//     sport_id,
//     client_ref,
//   } = payload;
//   console.log('register match called');
//   if (!TP_RESULT_API_ENABLED) return;
//   try {
//     const existing = await ThirdPartyMatchRegistry.findOne({
//       gameId: String(event_id),
//       marketId: String(market_id),
//     });
//     if (existing) return;

//     let shouldPersist = false;
//     let responseMessage = "";
//     let matchData = null;

//     try {
//       const response = await axios.post(
//         `${BASE_URL}/bet-incoming`,
//         {
//           event_id,
//           event_name,
//           market_id,
//           market_name,
//           market_type,
//           client_ref,
//           sport_id,
//           api_key: process.env.RESULT_API_KEY,
//         },
//         {
//           timeout: REGISTER_TIMEOUT_MS,
//         }
//       );

//       console.log(
//         `[3P-Result] Registered market event=${event_id} market=${market_id}`
//       );
//       shouldPersist = true;
//       responseMessage = response.data?.message || "";
//       matchData = response.data?.match || null;
//     } catch (apiErr) {
//       const errData = apiErr?.response?.data;
//       const errMsg = errData?.message || "";
//       const status = apiErr?.response?.status;

//       if (status === 409 || errData?.match || errMsg.toLowerCase().includes("already exists")) {
//         // Another server already registered this match on the 3P side.
//         // Persist to our local registry so we stop re-attempting.
//         shouldPersist = true;
//         responseMessage = errMsg;
//         matchData = errData?.match || null;
//         console.log(
//           `[3P-Result] Match already exists on 3P side — syncing to local registry: gameId=${gameId}`
//         );
//       } else {
//         // 3P API might return "No Record Found" if match is already closed but still managed.
//         // Fallback: Try fetching via GET to see if it actually exists.
//         try {
//           const getResponse = await axios.get(`${BASE_URL}/matches/game/${gameId}`, { timeout: REGISTER_TIMEOUT_MS });
//           if (getResponse.data && getResponse.data.gameId === String(gameId)) {
//             shouldPersist = true;
//             responseMessage = "Synced via GET fallback";
//             matchData = getResponse.data;
//             console.log(
//               `[3P-Result] Match synced via GET fallback: gameId=${gameId}`
//             );
//           } else {
//             // Real error — do NOT persist; retry on next bet or cron tick.
//             console.error(
//               `[3P-Result] Failed to register match gameId=${gameId}:`,
//               errData || apiErr.message
//             );
//           }
//         } catch (fallbackErr) {
//           // Real error — both POST and GET failed
//           console.error(
//             `[3P-Result] Failed to register match gameId=${gameId}:`,
//             errData || apiErr.message
//           );
//         }
//       }
//     }

//     if (shouldPersist) {
//       console.log(
//         `[3P-Result] Match registered/synced: gameId=${gameId}, etid=${etid}`,
//         responseMessage
//       );

//       const updateDoc = {
//         gameId: String(gameId),
//         etid: Number(etid),
//         resultDeclared: false,
//         registrationFailed: false,
//       };

//       if (matchData) {
//         if (matchData.name) updateDoc.name = matchData.name;
//         if (matchData.runners) updateDoc.runners = matchData.runners;
//       }

//       await ThirdPartyMatchRegistry.findOneAndUpdate(
//         {
//           gameId: String(event_id),
//           marketId: String(market_id)
//         },
//         updateDoc,
//         { upsert: true, new: true }
//       );
//     }
//   } catch (err) {
//     console.error(
//       `[3P-Result] Unexpected error registering match gameId=${gameId}:`,
//       err.message
//     );
//   }
// }


async function registerMatchIfNeeded(payload) {

  console.log('register match if needed');
  if (!TP_RESULT_API_ENABLED) return;

  try {
    const {
      event_id,
      event_name,
      market_id,
      originalMarketId,
      market_name,
      market_type,
      sport_id,
      client_ref,
    } = payload;

    console.log(
      `[3P-Result][Match] Registration requested`,
      {
        event_id,
        event_name,
        market_id,
        market_name,
        market_type,
        sport_id,
        client_ref,
      }
    );

    const existing = await ThirdPartyMatchRegistry.findOne({
      gameId: String(event_id),
      marketId: String(market_id),
    });

    if (existing) {
      console.log(
        `[3P-Result][Match] Already registered locally`,
        {
          event_id,
          market_id,
        }
      );
      return;
    }

    let shouldPersist = false;

    try {
      // const response = await axios.post(
      //   `${BASE_URL}/bet-incoming`,
      //   {
      //     event_id,
      //     event_name,
      //     market_id,
      //     market_name,
      //     market_type,
      //     sport_id,
      //     client_ref,
      //     api_key: process.env.JSK_KEY,
      //   },
      //   {
      //     timeout: REGISTER_TIMEOUT_MS,
      //   }
      // );

      // console.log(
      //   `[3P-Result][Match] Registration success`,
      //   {
      //     event_id,
      //     market_id,
      //     response: response.data,
      //   }
      // );

      shouldPersist = true;
    } catch (apiErr) {
      console.error(
        `[3P-Result][Match] Registration failed`,
        {
          event_id,
          market_id,
          error:
            apiErr?.response?.data ||
            apiErr?.message ||
            "Unknown error",
        }
      );
    }

    if (!shouldPersist) {
      return;
    }

    const updateDoc = {
      gameId: String(event_id),
      marketId: String(market_id),
      originalMarketId:originalMarketId,

      eventName: event_name,
      marketName: market_name,
      marketType: market_type,

      etid: Number(sport_id),

      resultDeclared: false,
      registrationFailed: false,
    };

    await ThirdPartyMatchRegistry.findOneAndUpdate(
      {
        gameId: String(event_id),
        marketId: String(market_id),
      },
      updateDoc,
      {
        upsert: true,
        new: true,
      }
    );

    console.log(
      `[3P-Result][Match] Registry synced`,
      {
        event_id,
        market_id,
      }
    );
  } catch (err) {
    console.error(
      `[3P-Result][Match] Unexpected error`,
      err
    );
  }
}

/**
 * Fetch all fancy results for a given gameId from the third-party API.
 *
 * @param {string} gameId
 * @returns {Array} Array of fancy result objects: { fancyId, name, status, result }
 */
async function getFancyResults(reg) {
  try {
    const response = await axios.get(
      "https://diamond-result-v2.avrkhub.in/get_result",
      {
        params: {
          sid: reg.etid,
          gmid: reg.gameId,
        },
        timeout: POLL_TIMEOUT_MS,
      }
    );

    return response.data || null;
  } catch (err) {
    console.log(
      "FANCY_RESULT_ERROR",
      err?.response?.data
    );
    throw err;
  }
}

async function getMatchResult(reg) {
  try {
    const response = await axios.get(
      `https://diamond-result-v2.avrkhub.in/get_result`,
      {
        params: {
          sid: reg.etid,
          gmid: reg.gameId,
        },
        timeout: POLL_TIMEOUT_MS,
      }
    );

    return response.data || null;
  } catch (err) {
    console.log("MATCH_RESULT_ERROR", err?.response?.data);
    throw err;
  }
}


// /**
//  * Fetch the match result for a given gameId from the third-party API.
//  *
//  * @param {string} gameId
//  * @returns {Object|null} Match result object: { status, result, runners }
//  */
// async function getMatchResult(reg) {
//   const response = await axios.get(
//     `${BASE_URL}/matches/game/${gameId}`,
//     { timeout: POLL_TIMEOUT_MS }
//   );
//   return response.data || null;
// }

module.exports = {
  registerFancyIfNeeded,
  registerMatchIfNeeded,
  getFancyResults,
  getMatchResult,
  buildFancyKey,
};
