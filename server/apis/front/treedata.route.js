const express = require("express");
const httpStatus = require("http-status");
const { apiRequest } = require("../../helpers/utils");
const APIResponse = require("../../helpers/APIResponse");
const { getOrSetCache } = require("../../helpers/cache");

const router = express.Router();

const treedata = async (_, res, next) => {
  try {
    const cacheKey = `treedata`;

    const fetchTreeData = async () => {
      const response = await apiRequest({
        url: `treedata`,
        apiAction: "GET",
        data: { key: process.env.JSK_KEY },
        host: process.env.JSK_SERVER_URL,
        noEncrypt: true
      });
      
      return response?.data;
    };

    const result = await getOrSetCache(
      cacheKey,
      fetchTreeData,
      3000
    );

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(result, "Match fetched", httpStatus.OK)
      );
  } catch (err) {
    next(err);
  }
};

router.post("/", treedata);

module.exports = router;

