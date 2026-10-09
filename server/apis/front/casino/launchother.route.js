// const express = require("express");
// const httpStatus = require("http-status");
// const { apiRequest } = require("../../../helpers/utils");
// const APIResponse = require("../../../helpers/APIResponse");

// const router = express.Router();

// const launchotherData = async (req, res, next) => {
//   try {
//       const type = req.params.type;
//     const response = await apiRequest({
//       //url: `front/casino/launchother`,
//       url: `casino_stream`,
//       apiAction: "GET",
//       //data: req.body,
//       //host: process.env.JSK_CASINO_SERVER_URL,
      
//        host: "https://diamond-casino-api-demo-s2.avrkhub.in",
//        data: {
//         //id:req.body.type, 
//          id: type,
//         key: "V67JKNJKMM8BOKJLMKN",
//       },
//       noEncrypt: true,
//     });
// console.log(response, "+++++++++++launchotherData++++++");

//     res
//       .status(httpStatus.OK)
//       .send(
//         new APIResponse(response?.data, "launchother fetched", httpStatus.OK)
//       );
//   } catch (err) {
//     next(err);
//   }
// };

// //router.post("/", launchotherData);
// router.post("/:type", launchotherData);

// module.exports = router;

const express = require("express");
const axios = require("axios");
const httpStatus = require("http-status");
const APIResponse = require("../../../helpers/APIResponse");

const router = express.Router();

const launchotherData = async (req, res, next) => {
  try {
    const type = req.params.type || req.body?.type;

    console.log("launchother requested type:", type);

    if (!type) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            null,
            "Casino type is required",
            httpStatus.BAD_REQUEST
          )
        );
    }

    const thirdPartyResponse = await axios.get(
      "https://diamond-casino-api-demo-s2.avrkhub.in/casino_stream",
      {
        params: {
          id: type,
          key: process.env.JSK_CASINO_KEY,
        },
        headers: {
          accept: "*/*",
        },
        timeout: 15000,
      }
    );

    console.log(
      "Third-party response:",
      JSON.stringify(thirdPartyResponse.data, null, 2)
    );

    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          thirdPartyResponse.data,
          "launchother fetched",
          httpStatus.OK
        )
      );
  } catch (err) {
    console.error(
      "launchotherData error:",
      err.response?.data || err.message
    );

    const statusCode = err.response?.status || 500;

    return res.status(statusCode).send({
      data: err.response?.data || null,
      message:
        err.response?.data?.message ||
        err.response?.data?.msg ||
        "Casino stream fetch failed",
    });
  }
};

router.get("/:type", launchotherData);
router.post("/:type", launchotherData);
router.post("/", launchotherData);

module.exports = router;