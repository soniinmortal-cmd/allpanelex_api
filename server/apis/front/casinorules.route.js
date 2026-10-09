// const express = require("express");
// const httpStatus = require("http-status");
// const { apiRequest } = require("../../helpers/utils");
// const APIResponse = require("../../helpers/APIResponse");

// const casinoRules = require("./casinoRulesvalue");

// const router = express.Router();

// const casinorulesdata = async (req, res, next) => {
//   try {
//     const response = await apiRequest({
//       url: `front/casinorules`,
//       apiAction: "POST",
//       data: req.body,
//       host: process.env.JSK_CASINO_SERVER_URL,
//     });

//     res
//       .status(httpStatus.OK)
//       .send(
//         new APIResponse(response?.data, "Rules fetched", httpStatus.OK)
//       );
//   } catch (err) {
//     next(err);
//   }
// };

// router.post("/", casinorulesdata);

// module.exports = router;


const express = require("express");
const httpStatus = require("http-status");
const { apiRequest } = require("../../helpers/utils");
const APIResponse = require("../../helpers/APIResponse");
const casinoRules = require("./casinoRulesvalue");

console.log("CASINO RULES ROUTE LOADED");
const router = express.Router();


const casinorulesdata = async (req, res, next) => {
  try {
    const { gtype } = req.body;

    if (!gtype) {
      return res.status(httpStatus.BAD_REQUEST).send(
        new APIResponse(
          null,
          "gtype is required",
          httpStatus.BAD_REQUEST
        )
      );
    }

    const rules = casinoRules[gtype];

    if (!rules) {
      return res.status(httpStatus.NOT_FOUND).send(
        new APIResponse(
          null,
          `Rules not found for gtype: ${gtype}`,
          httpStatus.NOT_FOUND
        )
      );
    }

    return res.status(httpStatus.OK).send(
      new APIResponse(
        rules,
        "Rules fetched",
        httpStatus.OK
      )
    );
  } catch (err) {
    console.log("err+++++",err);
    next(err);
  }
};

router.post("/", casinorulesdata);

module.exports = router;

