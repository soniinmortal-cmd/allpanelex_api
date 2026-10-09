// const express = require("express");
// const httpStatus = require("http-status");
// const { apiRequest } = require("../../helpers/utils");
// const APIResponse = require("../../helpers/APIResponse");
// const { getOrSetCache } = require("../../helpers/cache");
// const { default: axios } = require("axios");

// const router = express.Router();

// const cricketvData = async (req, res, next) => {
//   try {
//     const { gmid } = req.body;

//     console.log("\n========== CRICKET TV REQUEST ==========");
//     console.log("BODY:", req.body);
//     console.log("GMID:", gmid);
//     console.log("========================================\n");

//     const cacheKey = `cricketvdata:${gmid}`;

//     const fetchTablist = async () => {
//       const res = await axios.get(
//         "https://diamond-sports-api-demo-s2.avrkhub.in/sports_stream",
//         {
//           params: {
//             key: "V67JKNJKMM8BOKJLMKN",
//             id: gmid,
//           },
//           timeout: 10000,
//         }
//       );

//       console.log("\n========== CRICKET TV RESPONSE ==========");
//       console.log(JSON.stringify(res, null, 2));
//       console.log("=========================================\n");

//       return res;
//     };

//     const result = await getOrSetCache(
//       cacheKey,
//       fetchTablist,
//       1
//     );


//     res
//       .status(httpStatus.OK)
//       .send(
//         new APIResponse(
//           result,
//           "cricketTV data fetched",
//           httpStatus.OK
//         )
//       );
//   } catch (err) {
//     console.log("\n========== CRICKET TV ERROR ==========");
//     console.log("MESSAGE:", err?.message);
//     console.log("STACK:", err?.stack);
//     console.log("BODY:", req.body);
//     console.log("======================================\n");

//     next(err);
//   }
// };


const express = require("express");
const httpStatus = require("http-status");
const APIResponse = require("../../helpers/APIResponse");
const axios = require("axios");

const router = express.Router();

const cricketvData = async (req, res, next) => {
  try {
    const { gmid } = req.body;

    console.log("\n========== CRICKET TV REQUEST ==========");
    console.log("BODY:", req.body);
    console.log("GMID:", gmid);
    console.log("========================================\n");

    const response = await axios.get(
      "https://diamond-sports-api-demo-s2.avrkhub.in/sports_stream",
      {
        params: {
          key: process.env.JSK_KEY,
          id: gmid,
        },
        timeout: 10000,
      }
    );

    console.log("\n========== CRICKET TV RESPONSE ==========");
    console.log(response.data); // Don't stringify the whole response
    console.log("=========================================\n");

    return res.status(httpStatus.OK).send(
      new APIResponse(
        response.data,
        "cricketTV data fetched",
        httpStatus.OK
      )
    );
  } catch (err) {
    console.log("\n========== CRICKET TV ERROR ==========");
    console.log("MESSAGE:", err?.message);
    console.log("STATUS:", err?.response?.status);
    console.log("RESPONSE:", err?.response?.data);
    console.log("======================================\n");

    next(err);
  }
};

router.post("/", cricketvData);

module.exports = router;