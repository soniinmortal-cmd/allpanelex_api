const express = require("express");
const httpStatus = require("http-status");
const { apiRequest } = require("../../../helpers/utils");
const APIResponse = require("../../../helpers/APIResponse");
const { getCache, setCache } = require("../../../helpers/cache");
const { JSKROUTES } = require("../../../helpers/jsk-routes");

const router = express.Router();

const lastresults2 = async (req, res, next) => {
  try {
    const queryString = new URLSearchParams(req.query).toString();
    const domain = req?.domainConfig?.domain;

    let casinoHost = process.env.JSK_CASINO_SERVER_URL;
    let casinoUrl = "casino/lastresultsnew";
    let casinoData = {
      gType: req.body.gType,
      key: process.env.JSK_CASINO_KEY,
    };

    //domain === "allpanelexc7.com"
    if (domain === "allpanelexc7.com") {
      casinoHost = "https://casino.allpanelexc7.com";
      casinoUrl = "lastresult";

      casinoData = {
        gtype: req.body.gType,
        key: process.env.JSK_CASINO_KEY,
      };

    }

    console.log(
      "+++++++++++ REQUEST DOMAIN +++++++++++",
      domain
    );
    const response = await apiRequest({
      // url: `front/casinoresults`,
      // apiAction: "POST",
      // data: req.body,
      // host: process.env.JSK_CASINO_SERVER_URL,
      // url: `casino/result`,
      url: casinoUrl,
      
      apiAction: "GET",
      //data: req.body,
        data: casinoData,
      //host: process.env.JSK_CASINO_SERVER_URL,
        host: casinoHost,
      noEncrypt: true,
      
    });
  
    const casinodata = response?.data;
    
    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(casinodata, "lastresults list fetched", httpStatus.OK),
      );
  } catch (err) {
    next(err);
  }
};

router.post("/", lastresults2);

module.exports = router;
