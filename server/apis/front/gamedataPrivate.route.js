const express = require("express");
const httpStatus = require("http-status");
const { apiRequest } = require("../../helpers/utils");
const APIResponse = require("../../helpers/APIResponse");
const { getOrSetCache } = require("../../helpers/cache");
const Game = require("../games/games.model");
const axios = require("axios");
 
const router = express.Router();
 
const gamedataPrivate = async (req, res, next) => {
  try {

    const sortedQuery = Object.keys(req.query).sort().reduce((acc, key) => {
      acc[key] = req.query[key];
      return acc;
    }, {});
    const {etid,gmid}=req.query;


    const queryString = new URLSearchParams(sortedQuery).toString();
    const cacheKey = `gamedataPrivate:${queryString}`;
 
    // Define the fetch function
     const fetchGameData = async () => {
      const response = await axios.get(
        `${process.env.JSK_SERVER_URL}/gamedataPrivate`,
        {
          params: {
            etid,
            gmid,
            key: process.env.JSK_KEY,
          },
        }
      );
 
      let data = response?.data;

      if (data?.lastUpdatedAt == null) {
        console.log("⚠️ lastUpdatedAt MISSING:", {
          etid,
          gmid,
          response: data,
        });
      }

 
      const game = await Game.findOne({
        gmid: Number(gmid),
        domain: req?.domainConfig?.domain,
      }).lean();

      if (game && Array.isArray(data?.data?.data)) {
        data.data.data = data.data.data
          .filter((market) => {
            let configKey = market.gtype;
 
            if (market.gtype === "fancy") {
              switch (market.mname) {
                case "Ball By Ball":
                  configKey = "fancyBallByBall";
                  break;
           
                case "Over By Over":
                  configKey = "fancyOverByOver";
                  break;
           
                default:
                  configKey = "fancy"; // Normal
              }
            } else if (market.gtype === "match") {
              switch (market.mname) {
                case "TIED_MATCH":
                  configKey = "tiedMatch";
                  break;
           
                default:
                  configKey = "match"; // MATCH_ODDS
              }
            }
            const enabled = game.bet_config?.[configKey];
            // Hide market if disabled
            return enabled === undefined ? true : enabled;
          })
          .map((market) => {
            let configKey = market.gtype;
 
            if (market.gtype === "fancy") {
              switch (market.mname) {
                case "Ball By Ball":
                  configKey = "fancyBallByBall";
                  break;
           
                case "Over By Over":
                  configKey = "fancyOverByOver";
                  break;
           
                default:
                  configKey = "fancy";
              }
            } else if (market.gtype === "match") {
              switch (market.mname) {
                case "TIED_MATCH":
                  configKey = "tiedMatch";
                  break;
           
                default:
                  configKey = "match";
              }
            }
          const limit = game.bet_limit?.[configKey];

          // Override only if admin has configured a non-default limit
          if (
            limit &&
            (
              Number(limit.min) !== 0 ||
              Number(limit.max) !== 0
            )
          ) {
            // Override market-level limits
            market.min = limit.min;
            market.max = limit.max;

            // Only MATCH_ODDS: override third-party maxB with admin max
              if (market.mname === "MATCH_ODDS") {
                 market.maxb = limit.max;
              }
 
            // Override section-level limits (used by Fancy and some other markets)
            if (Array.isArray(market.section)) {
              market.section = market.section.map((section) => ({
                ...section,
                min: limit.min,
                max: limit.max,
              }));
            }
          }

 
          return market;
        });
      }
      // Handle admin-specific logic
      if (data?.status === 300 && req?.baseUrl?.includes("/api/admin")) {
        if (game) {
          data.gameDetails = game;
        }
      }

      return data;
    };
 
    // Use getOrSetCache with 1 second TTL
    const result = await fetchGameData();

    const finalResponse = new APIResponse(
      result.data,
      "Match fetched",
      httpStatus.OK
    );

    // Add lastUpdatedAt alongside msg, status and success
    if (finalResponse?.data && typeof finalResponse.data === "object") {
      finalResponse.data.lastUpdatedAt2 = result?.lastUpdatedAt;
    }

    const responseString = JSON.stringify(finalResponse);

    res.status(httpStatus.OK).send(finalResponse);
 
  } catch (err) {
    next(err);
  }
};
 
router.post("/", gamedataPrivate);
 
module.exports = router;
 