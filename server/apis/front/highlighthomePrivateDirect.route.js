const express = require("express");
const httpStatus = require("http-status");
const { apiRequest } = require("../../helpers/utils");
const APIResponse = require("../../helpers/APIResponse");

const router = express.Router();

const highlighthomePrivateDirect = async (req, res, next) => {
  try {
    const { etid = 4, type = "all" } = req.body;
    const response = await apiRequest({
            url: "highlighthomePrivate",
            apiAction: "GET",
            data: { etid:etid, key: process.env.JSK_KEY },
            host: process.env.JSK_SERVER_URL,
            noEncrypt: true,
          });


    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          response?.data,
          "Match fetched",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(err);
  }
};

router.post("/", highlighthomePrivateDirect);

module.exports = router;
