const express = require("express");
const httpStatus = require("http-status");
const { apiRequest } = require("../../helpers/utils");
const APIResponse = require("../../helpers/APIResponse");
const { getOrSetCache } = require("../../helpers/cache");

const router = express.Router();

// const highlightproductdata = async (_, res, next) => {
//   try {
//     const cacheKey = "highlightproduct";

//     const fetchHighlightProductData = async () => {
//       const response = await apiRequest({
//         url: "casino/tableid",
//         apiAction: "GET",
//         data: {
//           key: process.env.JSK_KEY,
//         },
//         host: process.env.JSK_CASINO_SERVER_URL,
//         noEncrypt: true,
//       });

//       return (
//         response?.data?.t1?.slice(0, 1)?.map((game) => ({
//           ename: game.gmid,   // frontend uses this in /casino/:ename
//           fname: game.gname,  // frontend displays this
//         })) || []
//       );
//     };

//     const result = await getOrSetCache(
//       cacheKey,
//       fetchHighlightProductData,
//       300
//     );

//     res
//       .status(httpStatus.OK)
//       .send(
//         new APIResponse(
//           result,
//           "Highlight Product fetched",
//           httpStatus.OK
//         )
//       );
//   } catch (err) {
//     next(err);
//   }
// };




const highlightproductdata = async (_, res, next) => {
  try {
    const cacheKey = `highlightproduct`;

    const fetchHighlightProductData = async () => {
      const response = await apiRequest({
        url: `highlightproduct`,
        apiAction: "GET",
        data: {key: process.env.JSK_KEY},
        host: process.env.JSK_SERVER_URL,
        noEncrypt:true
      });
      return response?.data;
    };

    const result = await getOrSetCache(
      cacheKey,
      fetchHighlightProductData,
      30000
    );

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(result, "Highlight Product fetched", httpStatus.OK)
      );
  } catch (err) {
    next(err);
  }
};

router.post("/", highlightproductdata);

module.exports = router;
