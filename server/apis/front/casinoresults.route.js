const express = require("express");
const httpStatus = require("http-status");
const { apiRequest } = require("../../helpers/utils");
const APIResponse = require("../../helpers/APIResponse");

const router = express.Router();

const casinoresultsData = async (req, res, next) => {
  try {
    const response = await apiRequest({
      // url: `front/casinoresults`,
      // apiAction: "POST",
      // data: req.body,
      // host: process.env.JSK_CASINO_SERVER_URL,
      // url: `casino/result`,
      url: `casino/lastresultsnew`,
      
      apiAction: "GET",
      //data: req.body,
        data: { 
          gType:req.body.type, 
          //key: process.env.JSK_KEY 
           key: process.env.JSK_CASINO_KEY,
        },
      //host: process.env.JSK_CASINO_SERVER_URL,
        host: process.env.JSK_CASINO_SERVER_URL,
      noEncrypt: true,
      
    });
    //console.log(response, "VIEW ALL casinoresultsData response");

    console.log(
  JSON.stringify(response, null, 2),
  "FULL casinoresultsData response"
);
     console.log(
      JSON.stringify(response?.data, null, 2),
      "VIEW ALL casinoresultsData response"
    );
    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(response?.data, "Results fetched", httpStatus.OK)
      );
  } catch (err) {
    next(err);
  }
};

router.post("/", casinoresultsData);

module.exports = router;
