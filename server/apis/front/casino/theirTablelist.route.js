const express = require("express");
const httpStatus = require("http-status");
const { apiRequest } = require("../../../helpers/utils");
const APIResponse = require("../../../helpers/APIResponse");
const Game = require("../../../apis/games/games.model");
const TableId = require("./tableid.model");

const router = express.Router();

// const theirTablelist = async (req, res, next) => {
//   try {
//     const { gmid, domain } = req.body;

   
//     const table = await TableId.findOne({
//       gmid,
//     })
//       .select("-_id -__v -createdAt -updatedAt")
//       .lean();

//     const game = await Game.findOne({
//       gmid,
//       domain,
//       gtype: "casino",
//       isActive: true,
//     }).lean();

   
//     if (table) {
//       table.isAdded = !!game;
//     }

//     return res.status(httpStatus.OK).send(
//       new APIResponse(
//         table ? [table] : [],
//         "table list fetched",
//         httpStatus.OK
//       )
//     );
//   } catch (err) {
//     console.log("Their tablelist error:", err);
//     next(err);
//   }
// };

/////below  with daynmic our////
const theirTablelist = async (req, res, next) => {
  try {
    const { gmid, domain } = req.body;

    // ---------------------------------------------------
    // OUR VIRTUAL
    // 
    // ---------------------------------------------------
    if (gmid === "our_virtual") {
      const tables = await TableId.find({
        gmid: /^v/i,
      })
        .select("-_id -__v -createdAt -updatedAt")
        .lean();

      const virtualGmids = tables.map((table) => table.gmid);

      const games = await Game.find({
        gmid: { $in: virtualGmids },
        domain,
        gtype: "casino",
        isActive: true,
      })
        .select("gmid")
        .lean();

      const activeGmids = new Set(
        games.map((game) => game.gmid)
      );

      tables.forEach((table) => {
        table.isAdded = activeGmids.has(table.gmid);
      });

      return res.status(httpStatus.OK).send(
        new APIResponse(
          tables,
          "virtual table list fetched",
          httpStatus.OK
        )
      );
    }

    // ---------------------------------------------------
    // OUR PREMIUM
    // 
    // ---------------------------------------------------
    // if (gmid === "our_premium") {
    //   const tables = await TableId.find({
    //     gmid: /^p/i,
    //   })
    //     .select("-_id -__v -createdAt -updatedAt")
    //     .lean();

    //   const premiumGmids = tables.map((table) => table.gmid);

    //   const games = await Game.find({
    //     gmid: { $in: premiumGmids },
    //     domain,
    //     gtype: "casino",
    //     isActive: true,
    //   })
    //     .select("gmid")
    //     .lean();

    //   const activeGmids = new Set(
    //     games.map((game) => game.gmid)
    //   );

    //   tables.forEach((table) => {
    //     table.isAdded = activeGmids.has(table.gmid);
    //   });

    //   return res.status(httpStatus.OK).send(
    //     new APIResponse(
    //       tables,
    //       "premium table list fetched",
    //       httpStatus.OK
    //     )
    //   );
    // }

    // ---------------------------------------------------
  // OUR PREMIUM
  // gname me "Premium" wale games
  // ---------------------------------------------------
    if (gmid === "our_premium") {
      const tables = await TableId.find({
        gname: /^premium/i,
      })
        .select("-_id -__v -createdAt -updatedAt")
        .lean();

      const premiumGmids = tables.map((table) => table.gmid);

      const games = await Game.find({
        gmid: { $in: premiumGmids },
        domain,
        gtype: "casino",
        isActive: true,
      })
        .select("gmid")
        .lean();

      const activeGmids = new Set(
        games.map((game) => game.gmid)
      );

      tables.forEach((table) => {
        table.isAdded = activeGmids.has(table.gmid);
      });

      return res.status(httpStatus.OK).send(
        new APIResponse(
          tables,
          "premium table list fetched",
          httpStatus.OK
        )
      );
    }

    // ---------------------------------------------------
    // OUR CASINO
    // 
    // ---------------------------------------------------
    if (gmid === "our_casino") {
      const tables = await TableId.find({
        $nor: [
          { gmid: /^v/i },
          { gmid: /^p/i },
        ],
      })
        .select("-_id -__v -createdAt -updatedAt")
        .lean();

      const casinoGmids = tables.map((table) => table.gmid);

      const games = await Game.find({
        gmid: { $in: casinoGmids },
        domain,
        gtype: "casino",
        isActive: true,
      })
        .select("gmid")
        .lean();

      const activeGmids = new Set(
        games.map((game) => game.gmid)
      );

      tables.forEach((table) => {
        table.isAdded = activeGmids.has(table.gmid);
      });

      return res.status(httpStatus.OK).send(
        new APIResponse(
          tables,
          "casino table list fetched",
          httpStatus.OK
        )
      );
    }

    // ---------------------------------------------------
    // OLD CODE - NO CHANGE
    // Normal gmid 
    // ---------------------------------------------------
    const table = await TableId.findOne({
      gmid,
    })
      .select("-_id -__v -createdAt -updatedAt")
      .lean();

    const game = await Game.findOne({
      gmid,
      domain,
      gtype: "casino",
      isActive: true,
    }).lean();

    if (table) {
      table.isAdded = !!game;
    }

    return res.status(httpStatus.OK).send(
      new APIResponse(
        table ? [table] : [],
        "table list fetched",
        httpStatus.OK
      )
    );
  } catch (err) {
    console.log("Their tablelist error:", err);
    next(err);
  }
};






router.post("/", theirTablelist);

module.exports = router;
