const express = require("express");
const httpStatus = require("http-status");
const { apiRequest } = require("../../../helpers/utils");
const APIResponse = require("../../../helpers/APIResponse");
const { getOrSetCache, getCache, setCache, delCache } = require("../../../helpers/cache");
const { JSKROUTES } = require("../../../helpers/jsk-routes");
const {
  checkCasinoBettingResult,
} = require("../../../helpers/bettingResultChecker");

const router = express.Router();

const data2 = async (req, res, next) => {
  try {

    // Sort parameters for deterministic cache keys
    const sortedQuery = Object.keys(req.query).sort().reduce((acc, key) => {
      acc[key] = req.query[key];
      return acc;
    }, {});
    const sortedBody = Object.keys(req.body).sort().reduce((acc, key) => {
      acc[key] = req.body[key];
      return acc;
    }, {});

    const queryString = new URLSearchParams(sortedQuery).toString();
    const reqBodyString = new URLSearchParams(sortedBody).toString();
    const cacheKey = `casinodata:data2${queryString || reqBodyString}`;

    const fetchData = async () => {
      const response = await apiRequest({
        url: `casino/data`,
        apiAction: "GET",
        data: { 
          gtype:req.body.type, 
          //key: process.env.JSK_KEY 
          key: process.env.JSK_CASINO_KEY,
        },
        //host: process.env.JSK_CASINO_SERVER_URL,
       host: process.env.JSK_CASINO_SERVER_URL,
        noEncrypt: true
      });

      // const casinodata = response?.data;
      // if (casinodata) {
      //   const marketId = casinodata?.mid ?? casinodata?.t1?.mid ?? casinodata?.t1?.oldgmid;
      //   const gType = casinodata?.gtype ?? casinodata?.t1?.gtype;
      //   const lastMarketKey = `lastMarket:${gType}`;
      //   const lastMarketId = await getCache(lastMarketKey);

      //   if (marketId && gType) {
      //     if (lastMarketId && lastMarketId !== marketId) {
      //       checkCasinoBettingResult(lastMarketId);
      //       await delCache(lastMarketKey);
      //     }
      //     await setCache(lastMarketKey, marketId, 1200);
      //   }

      //   const isLastResult = lastMarketId ? lastMarketId !== marketId : true;
      //   if (isLastResult) {
      //     await setCache(lastMarketKey, marketId, 1200);
      //   }
      //   casinodata.isLastResult = isLastResult;
      // }
      // return casinodata;
    
  const casinodata = response?.data;

if (Array.isArray(casinodata) && casinodata.length > 0) {
  // OPEN 
  const currentMarket =
    casinodata.find(item => item.mtype === "OPEN") || casinodata[0];

  const marketId = currentMarket?.mid;
  const gType = req.body.type;

  const lastMarketKey = `lastMarket:${gType}`;
  const lastMarketId = await getCache(lastMarketKey);

  if (marketId && gType) {
    if (lastMarketId && lastMarketId !== marketId) {
      checkCasinoBettingResult(lastMarketId);
      await delCache(lastMarketKey);
    }
    await setCache(lastMarketKey, marketId, 1200);
  }

  const isLastResult = lastMarketId ? lastMarketId !== marketId : true;

  // 🔥 IMPORTANT: 
  return casinodata.map(item => ({
    ...item,
    isLastResult 
  }));
}

return casinodata;
    console.log("FOR DATA2 Current casinodata Market:", casinodata);
    };

    // Use getOrSetCache with a 1 second TTL as originally specified
    const result = await getOrSetCache(cacheKey, fetchData, 1);

    res
      .status(httpStatus.OK)
      .send(new APIResponse(result, "casion data fetched", httpStatus.OK));
  } catch (err) {
    next(err);
  }
};

router.post("/", data2);

module.exports = router;
