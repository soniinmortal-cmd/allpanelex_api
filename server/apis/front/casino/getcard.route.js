const express = require("express");
const httpStatus = require("http-status");
const { apiRequest } = require("../../../helpers/utils");
const APIResponse = require("../../../helpers/APIResponse");

const router = express.Router();

const getCard = async (req, res, next) => {
  try {
    console.log("GETCARD Query:", JSON.stringify(req.query, null, 2));

    const { gtype } = req.query;

    if (!gtype) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            null,
            "gtype is required",
            httpStatus.BAD_REQUEST
          )
        );
    }

    // Third-party API call
    const response = await apiRequest({
      url: `getcard`,
      apiAction: "GET",
      data: {
        gtype: gtype,
      },
      host: process.env.JSK_CASINO_SERVER_URL,
      noEncrypt: true,
    });

    console.log("GETCARD Third Party Response:", response?.data);

    // Third-party ka response return
    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          response?.data,
          "card data fetched",
          httpStatus.OK
        )
      );

  } catch (err) {
    console.error("GETCARD ERROR:", err);
    next(err);
  }
};

router.get("/", getCard);

module.exports = router;