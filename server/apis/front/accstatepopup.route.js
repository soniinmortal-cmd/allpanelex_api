// const express = require("express");
// const httpStatus = require("http-status");
// const { apiRequest } = require("../../helpers/utils");
// const APIResponse = require("../../helpers/APIResponse");

// const router = express.Router();

// const accstatepopupData = async (req, res, next) => {
//   try {
//     console.log("+++++++++++accstatepopupData++++++++++");
//     const response = await apiRequest({
//      // url: `casino/detail_result`,
//       url:  `detail_casino_results`,
//       apiAction: "GET",
//       //host: process.env.JSK_CASINO_SERVER_URL,
//       host: process.env.JSK_CASINO_SERVER_URL,
//       data: { 
//        // type: req.body.gtype,   // FIXED
//         gtype: req.body.gtype,
//         mid: req.body.mid, 
//         //key: process.env.JSK_KEY 
//         key: process.env.JSK_CASINO_KEY,
//       },
//       noEncrypt: true,
//     });

//     console.log(response, "accstatepopupData response");
//      const resultData = response?.data?.data;

//     if (!resultData || !resultData?.t1) {
//       return res.status(404).send(
//         new APIResponse(null, "Casino result data not found", 404)
//       );
//     }

//     return res.status(200).send(
//       new APIResponse(resultData, "Data fetched", 200)
//     );
//    ///below old code
//     // res.status(200).send(
//     //   new APIResponse(response?.data, "Data fetched", 200)
//     // );

//   } catch (err) {
//     next(err);
//   }
// };

// router.post("/", accstatepopupData);

// module.exports = router;


const express = require("express");
const httpStatus = require("http-status");
const { apiRequest } = require("../../helpers/utils");
const APIResponse = require("../../helpers/APIResponse");
const Domain = require("../domain/domain.model");

const router = express.Router();

const accstatepopupData = async (req, res, next) => {
  try {
    console.log("+++++++++++accstatepopupData++++++++++");

    // -------------------------------------------------------
    // GET DOMAIN
    // -------------------------------------------------------
    const domain = req?.domainConfig?.domain;


    // -------------------------------------------------------
    // DEFAULT - OLD API
    // -------------------------------------------------------
    let casinoHost = process.env.JSK_CASINO_SERVER_URL;

    // -------------------------------------------------------
    // ONLY FOR allpanelexc7.com
    // -------------------------------------------------------
    if (domain === "allpanelexc7.com") {
      const domainData = await Domain.findOne({
        domain: domain,
      })
        .select(
          "isTransactionpassword isSeat isMatchLock maintenance_mode isCasinoThirdParty"
        )
        .lean();


      // ONLY when isCasinoThirdParty = true
      if (domainData?.isCasinoThirdParty === true) {
        casinoHost = "https://casino.allpanelexc7.com";

      }
    }

    // -------------------------------------------------------
    // FINAL HOST
    // -------------------------------------------------------


    // -------------------------------------------------------
    // SAME API FOR BOTH
    // -------------------------------------------------------
    const response = await apiRequest({
      url: "detail_casino_results",
      apiAction: "GET",
      host: casinoHost,

      data: {
        gtype: req.body.gtype,
        mid: req.body.mid,
        key: process.env.JSK_CASINO_KEY,
      },

      noEncrypt: true,
    });

    // -------------------------------------------------------
    // LOG COMPLETE API RESPONSE
    // -------------------------------------------------------


    // -------------------------------------------------------
    // RESPONSE DATA
    // -------------------------------------------------------
    const resultData = response?.data?.data;


    // -------------------------------------------------------
    // VALIDATION
    // -------------------------------------------------------
    if (!resultData || !resultData?.t1) {
      return res.status(404).send(
        new APIResponse(
          null,
          "Casino result data not found",
          404
        )
      );
    }

    // -------------------------------------------------------
    // SAME OLD RESPONSE STRUCTURE
    // -------------------------------------------------------
    return res.status(200).send(
      new APIResponse(
        resultData,
        "Data fetched",
        200
      )
    );

  } catch (err) {
    console.error(
      "+++++++++++ accstatepopupData ERROR +++++++++++",
      err
    );

    next(err);
  }
};

router.post("/", accstatepopupData);

module.exports = router;