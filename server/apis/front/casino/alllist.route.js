// // const express = require("express");
// // const httpStatus = require("http-status");
// // const { apiRequest } = require("../../../helpers/utils");
// // const APIResponse = require("../../../helpers/APIResponse");
// // const { getCache, setCache } = require("../../../helpers/cache");

// // const router = express.Router();

// // const alllist = async (_, res, next) => {
// //   try {
// //     const cacheKey = "casinoalllist:all";
// //     let tablelist = await getCache(cacheKey);
// //     if (!tablelist) {
// //       const res = await apiRequest({
// //         url: `front/casino/alllist`,
// //         apiAction: "POST",
// //         data: {},
// //         host: process.env.JSK_CASINO_SERVER_URL,
// //       });
// //       tablelist = res?.data;
// //       await setCache(cacheKey, tablelist, 5000); // cache for 60s
// //     }

// //     res
// //       .status(httpStatus.OK)
// //       .send(new APIResponse(tablelist, "casion list fetched", httpStatus.OK));
// //   } catch (err) {
// //     next(err);
// //   }
// // };

// // router.post("/", alllist);

// // module.exports = router;



// const express = require("express");
// const httpStatus = require("http-status");
// const { apiRequest } = require("../../../helpers/utils");
// const APIResponse = require("../../../helpers/APIResponse");
// const { getCache, setCache } = require("../../../helpers/cache");
 
// const router = express.Router();
 
// const alllist = async (_, res, next) => {
//   try {
//     console.log("1 route hit");
//     const cacheKey = "casinoalllist:all";
//      let tablelist = await getCache(cacheKey);
//      tablelist = null;
//     if (!tablelist) {
//       const apiRes = await apiRequest({
//         url: `casino/tableid`,
//         apiAction: "GET",
//         data: { key:process.env.JSK_KEY },
//         host: process.env.JSK_CASINO_SERVER_URL,
//         noEncrypt:true
//       });
//       tablelist = apiRes?.data;
//       await setCache(cacheKey, tablelist, 5000); // cache for 60s
 
//     }
//     console.log(
//       "tablelist:",
//       JSON.stringify(tablelist, null, 2).substring(0, 2000)
//     );
//       res
//         .status(httpStatus.OK)
//         .send(new APIResponse(tablelist, "casion list fetched", httpStatus.OK));
 
//   } catch (err) {
//     console.log("errorrrrr",err);
//     next(err);
//   }
// };
 
// router.post("/", alllist);
 
// module.exports = router;



const express = require("express");
const httpStatus = require("http-status");
const APIResponse = require("../../../helpers/APIResponse");
const { getCache, setCache } = require("../../../helpers/cache");

const TableId = require("./tableid.model");

const router = express.Router();

const alllist = async (req, res, next) => {
  try {
    console.log("Alllist route hit");

    const cacheKey = "casinoalllist:all";

   
    let tablelist = await getCache(cacheKey);

    //tablelist=null;

   
    if (!tablelist) {
    
      const games = await TableId.find({})
        .sort({ _id: 1 })
        .select("-_id -__v -createdAt -updatedAt")
        .lean();

     
      tablelist = {
        t1: games,
      };

      console.log(
        "Mongo all list count:",
        tablelist.t1.length
      );

      console.log(
        "Mongo first all list game:",
        tablelist.t1[0] || null
      );

      await setCache(
        cacheKey,
        tablelist,
        5000
      );
    }

    console.log(
      "Alllist response:",
      JSON.stringify(tablelist, null, 2).substring(
        0,
        2000
      )
    );

    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          tablelist,
          "Casino list fetched",
          httpStatus.OK
        )
      );
  } catch (err) {
    console.log("Alllist error:", err);
    next(err);
  }
};

router.post("/", alllist);

module.exports = router;

