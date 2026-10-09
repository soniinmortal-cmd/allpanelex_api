const express = require("express");
const httpStatus = require("http-status");
const { apiRequest } = require("../../../helpers/utils");
const APIResponse = require("../../../helpers/APIResponse");
const { getCache, setCache } = require("../../../helpers/cache");

const router = express.Router();

const tablist = async (req, res, next) => {
  try {
    const { type } = req.body;
    const cacheKey = `casinotablist:${type}`;
    let tablelist = await getCache(cacheKey);
    if (!tablelist) {
      const res = await apiRequest({
        url: `front/casino/tablist`,
        apiAction: "POST",
        data: { type },
        host: process.env.JSK_CASINO_SERVER_URL,
      });
      tablelist = res?.data;
      await setCache(cacheKey, tablelist, 5000); // cache for 60s
    }

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(tablelist, "casion tab list fetched", httpStatus.OK)
      );
  } catch (err) {
    next(err);
  }
};

router.post("/", tablist);

module.exports = router;
