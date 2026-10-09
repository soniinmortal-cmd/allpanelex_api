const express = require("express");
const httpStatus = require("http-status");
const APIResponse = require("../../helpers/APIResponse");
const axios = require("axios");

const router = express.Router();

const sportScoreboard = async (req, res, next) => {
  try {
    const { etid, gmid } = req.params;

    const response = await axios.get(
      "https://diamond-sports-api-demo-s2.avrkhub.in/scorecard",
      {
        params: {
          key: "V67JKNJKMM8BOKJLMKN",
          etid,
          gmid,
        },
        timeout: 10000,
      }
    );


    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          response.data,
          "sport data fetched",
          httpStatus.OK
        )
      );
  } catch (err) {
    console.log("\n========== SCOREBOARD ERROR ==========");
    console.log("MESSAGE:", err.message);
    console.log("STATUS:", err.response?.status);
    console.log("RESPONSE:", err.response?.data);
    console.log("======================================\n");

    next(err);
  }
};

router.get("/:etid/:gmid", sportScoreboard);

module.exports = router;