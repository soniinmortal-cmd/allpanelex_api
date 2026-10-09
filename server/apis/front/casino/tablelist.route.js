// const express = require("express");
// const httpStatus = require("http-status");
// const { apiRequest } = require("../../../helpers/utils");
// const APIResponse = require("../../../helpers/APIResponse");
// const { getCache, setCache } = require("../../../helpers/cache");
// const { getGameByGidAndType } = require("../../games/games.helper");
// const {
//   getBlockMarketByUserId,
// } = require("../../block-market/block-market.helper");
// const { getUser } = require("../../users/users.helper");
// const JSK_KEY = process.env.JSK_KEY;
 
// const router = express.Router();
 
// const tablelist = async (req, res, next) => {
//   try {
//     const { gmid = 35, ismob = 1, parent } = req.body;
//     const { domain = "" } = req.domainConfig;
//     const cacheKey = parent
//       ? `tablelist:${gmid}-${domain}-${parent}`
//       : `tablelist:${gmid}-${domain}`;

//    let tablelist = await getCache(cacheKey);
//     //let tablelist = null;
//     if (!tablelist) {
//       // const res = await apiRequest({
//       //   url: `casino/tableid`,
//       //   apiAction: "GET",
//       //   data: { key:JSK_KEY },
//       //   host: process.env.JSK_CASINO_SERVER_URL,
//       //   noEncrypt:true
//       // });
//       // tablelist = res?.data;

//       const apiRes = await apiRequest({
//   url: `casino/tableid`,
//   apiAction: "GET",
//   data: { key: JSK_KEY },
//   host: process.env.JSK_CASINO_SERVER_URL,
//   noEncrypt: true
// });

// tablelist = apiRes?.data;

//       let activeGames = await getGameByGidAndType(gmid, "casino", domain);
//       if (parent) {
//         const admin = await getUser({ _id: parent });
//         const blockMarket = await getBlockMarketByUserId(admin?.parent, domain);
//         activeGames = activeGames.filter((match) => {
//           return !blockMarket?.map((game) => game?.gmid)?.includes(match?.gmid);
//         });
//       }
 
//       if (tablelist?.t1) {
//         tablelist.t1 = tablelist?.t1
//           .map((item) => {
//             const match = activeGames.find(
//               (game) => game.gmid === item.gmid && game.isActive
//             );
//             return match || null;
//           })
//           .filter(Boolean);
 
//         if (parent) {
//           const blockMarket = await getBlockMarketByUserId(parent, domain);
//           tablelist.t1 = tablelist?.t1.filter((match) => {
//             return !blockMarket
//               ?.map((game) => game?.gmid)
//               ?.includes(match?.gmid);
//           });
//         }
//       }
 
//       await setCache(cacheKey, tablelist, 5000); // cache for 60s
//     }
 
//     res
//       .status(httpStatus.OK)
//       .send(new APIResponse(tablelist, "Match fetched", httpStatus.OK));
//   } catch (err) {
//     next(err);
//   }
// };
 
// router.post("/", tablelist);
 
// module.exports = router;
 
 

////////new without3rd party
const express = require("express");
const httpStatus = require("http-status");
const APIResponse = require("../../../helpers/APIResponse");
const { getCache, setCache } = require("../../../helpers/cache");
const { getGameByGidAndType } = require("../../games/games.helper");
const {
  getBlockMarketByUserId,
} = require("../../block-market/block-market.helper");
const { getUser } = require("../../users/users.helper");

const TableId = require("./tableid.model");

const router = express.Router();

const tablelist = async (req, res, next) => {
  try {
    const { gmid = 35, ismob = 1, parent } = req.body;
    const { domain = "" } = req.domainConfig;

    const cacheKey = parent
      ? `tablelist:${gmid}-${domain}-${parent}`
      : `tablelist:${gmid}-${domain}`;

     //let tablelist = await getCache(cacheKey);
    let tablelist = null;

    if (!tablelist) {
     
      const games = await TableId.find({})
        .sort({ _id: 1 })
        .select("-_id -__v -createdAt -updatedAt")
        .lean();

      // Old res.data structure same
      tablelist = {
        t1: games,
      };

      // console.log("Mongo tableid count:", tablelist.t1.length);
      // console.log(
      //   "Mongo first tableid:",
      //   tablelist.t1[0]
      // );

      let activeGames = await getGameByGidAndType(
        gmid,
        "casino",
        domain
      );

      // console.log(
      //   "Active games count:",
      //   activeGames?.length
      // );

      if (parent) {
        const admin = await getUser({ _id: parent });

        const blockMarket =
          await getBlockMarketByUserId(
            admin?.parent,
            domain
          );

        activeGames = activeGames.filter((match) => {
          return !blockMarket
            ?.map((game) => game?.gmid)
            ?.includes(match?.gmid);
        });
      }

      if (tablelist?.t1) {
        tablelist.t1 = tablelist.t1
       // .filter((item) => item?.gmid !== "joker1")
          .map((item) => {
            const match = activeGames.find(
              (game) =>
                game.gmid === item.gmid &&
                game.isActive
            );

            return match || null;
          })
          .filter(Boolean);

        // console.log(
        //   "Matched active table games:",
        //   tablelist.t1.length
        // );

        if (parent) {
          const blockMarket =
            await getBlockMarketByUserId(
              parent,
              domain
            );

          tablelist.t1 = tablelist.t1.filter(
            (match) => {
              return !blockMarket
                ?.map((game) => game?.gmid)
                ?.includes(match?.gmid);
            }
          );
        }
      }

      await setCache(
        cacheKey,
        tablelist,
        5000
      );
    }

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          tablelist,
          "Match fetched",
          httpStatus.OK
        )
      );
  } catch (err) {

    next(err);
  }
};

router.post("/", tablelist);

module.exports = router;