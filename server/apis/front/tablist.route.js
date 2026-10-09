const express = require("express");
const httpStatus = require("http-status");
const { apiRequest } = require("../../helpers/utils");
const APIResponse = require("../../helpers/APIResponse");
const { getOrSetCache, setCache, getCache } = require("../../helpers/cache");
const sportModel = require("./sport.model");

const router = express.Router();


const tablist = async (_, res, next) => {
  try {
    const cacheKey = "tablist:all";

    let result = await getCache(cacheKey);
    //result = null;

    if (!result) {
      result = await sportModel.find({}, { _id: 0, eid: 1, ename: 1 })
        .sort({ eid: 1 })
        .lean();


      await setCache(cacheKey, result, 3000);
    }

    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          result,
          "tab list fetched",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(err);
  }
};

router.post("/", tablist);

module.exports = router;


