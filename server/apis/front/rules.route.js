const express = require("express");
const httpStatus = require("http-status");
const { apiRequest } = require("../../helpers/utils");
const APIResponse = require("../../helpers/APIResponse");
const { getOrSetCache } = require("../../helpers/cache");

const router = express.Router();

const fs = require("fs");
const path = require("path");

const rulesdata = async (_, res, next) => {
  try {
    const rules = fs.readFileSync(
      path.join(__dirname, "./rules.txt"),
      "utf8"
    );

    res.status(200).send(
      new APIResponse(
        rules,
        "Rules fetched",
        200
      )
    );
  } catch (err) {
    next(err);
  }
};

// const rulesdata = async (_, res, next) => {
//   try {
//     const cacheKey = `rules`;

//     const fetchRulesData = async () => {
//       const response = await apiRequest({
//         url: `front/rules`,
//         apiAction: "POST",
//         data: {},
//         host: process.env.JSK_CASINO_SERVER_URL,
//       });
//       return response?.data;
//     };

//     const result = await getOrSetCache(
//       cacheKey,
//       fetchRulesData,
//       3000000
//     );

//     res
//       .status(httpStatus.OK)
//       .send(
//         new APIResponse(result, "Rules fetched", httpStatus.OK)
//       );
//   } catch (err) {
//     next(err);
//   }
// };

router.post("/", rulesdata);

module.exports = router;
