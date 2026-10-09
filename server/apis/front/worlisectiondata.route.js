const express = require("express");
const httpStatus = require("http-status");
const { apiRequest } = require("../../helpers/utils");
const APIResponse = require("../../helpers/APIResponse");

const router = express.Router();

const worlisectionData = async (req, res, next) => {
  try {
    const gType=req.params.gType;
    const response = await apiRequest({
        url: `casino/tabdata`,
        apiAction: "GET",
        data: { key: "V67JKNJKMM8BOKJLMKN",type:gType },
        host: "https://diamond-sports-api-demo-s2.avrkhub.in",
        noEncrypt: true
      });

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(response?.data, "worli section data fetched", httpStatus.OK)
      );
  } catch (err) {
    next(err);
  }
};

router.post("/", worlisectionData);

module.exports = router;
