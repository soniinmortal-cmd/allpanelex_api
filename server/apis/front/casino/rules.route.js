const express = require("express");
const httpStatus = require("http-status");
const { apiRequest } = require("../../../helpers/utils");
const APIResponse = require("../../../helpers/APIResponse");

const router = express.Router();

const rulesData = async (req, res, next) => {
  try {
    const response = await apiRequest({
      url: `front/casino/rules`,
      apiAction: "POST",
      data: req.body,
      host: process.env.JSK_CASINO_SERVER_URL,
    });

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(response?.data, "rules fetched", httpStatus.OK)
      );
  } catch (err) {
    next(err);
  }
};

router.post("/", rulesData);

module.exports = router;
