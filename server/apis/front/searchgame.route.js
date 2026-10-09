const express = require("express");
const httpStatus = require("http-status");
const { apiRequest } = require("../../helpers/utils");
const APIResponse = require("../../helpers/APIResponse");
const { getOrSetCache } = require("../../helpers/cache");

const router = express.Router();

const searchgame = async (req, res, next) => {
  try {
    const response = await apiRequest({
      url: `front/searchgame`,
      apiAction: "POST",
      data: req.body,
      host: process.env.JSK_CASINO_SERVER_URL,
    });

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(response?.data, "search result fetched", httpStatus.OK)
      );
  } catch (err) {
    next(err);
  }
};

router.post("/", searchgame);

module.exports = router;
