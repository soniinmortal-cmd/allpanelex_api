

const httpStatus = require("http-status");
const APIError = require("../../helpers/APIError");
const APIResponse = require("../../helpers/APIResponse");
const Utils = require("../../helpers/utils");
const {
  getUsersByPartnerId,
  getAllUsers,
  getChildHierarchy,
  getUserById,
  getParentHierarchy,
  getNestedChildren,
  User,
  getUser
} = require("../users/users.helper");
const Partnership = require("../partnership/partnership.model");
const { Bet, collectAllIds, getBets } = require("../bet/bet.helper");
const betModel = require("../bet/bet.model");
const { getAllSportsData } = require("../sports-data/sports-data.helper");
const moment = require("moment/moment");
const transactionModel = require("../transaction/transaction.model");
const {
  findPartnershipByUserAndPartner,
} = require("../partnership/partnership.helper");
const Transaction = require("../transaction/transaction.model");

const mongoose = require("mongoose");
const axios = require("axios");

const profitLoss = async (req, res, next) => {
  try {
    const { fromDate, toDate } = req.body;
    const partnerId = req.user?._id;
    const role = req?.body?.role;

    let startDate = null;
    let endDate = null;

    if (fromDate && toDate) {
      startDate = new Date(`${fromDate}T00:00:00.000+05:30`);
      endDate = new Date(`${toDate}T23:59:59.999+05:30`);
    }

    console.log("Mongo UTC startDate:", startDate);
    console.log("Mongo UTC endDate:", endDate);
        const allIds = await collectAllIds(req.user);

    let query = { isActive: true, _id: { $in: allIds } };
    if (role !== "all") {
      query.role = role;
    }
    const users = await getAllUsers(query);

    const results = await Promise.all(
      users.map(async (currentUser) => {
        const allIds = await collectAllIds(currentUser);
        const sign = currentUser?.role === "user" ? 1 : -1;

        const pipeline = [
          // {
          //   $match: {
          //     userId: { $in: allIds },
          //     status: { $in: ["won", "lost", "cancelled"] },
          //     isActive: true,
          //   },
          // },
          {
            $match: {
              userId: { $in: allIds },
              status: { $in: ["won", "lost", "cancelled"] },
              isActive: true,
              // ...(fromDate && toDate
              //   ? {
              //       createdAt: {
              //         $gte: new Date(fromDate),
              //         $lte: new Date(
              //           new Date(toDate).setHours(23, 59, 59, 999)
              //         ),
              //       },
              //     }
              //   : {}),
              ...(startDate && endDate
                ? {
                    createdAt: {
                      $gte: startDate,
                      $lte: endDate,
                    },
                  }

                : {}),
            },
          },
          {
            $group: {
              _id: "$userId",
              casinoProfit: {
                $sum: {
                  $multiply: [
                    { $cond: [{ $ifNull: ["$subType", false] }, "$profit", 0] },
                    sign,
                  ],
                },
              },
              sportProfit: {
                $sum: {
                  $multiply: [
                    {
                      $cond: [
                        { $not: [{ $ifNull: ["$subType", false] }] },
                        "$profit",
                        0,
                      ],
                    },
                    sign,
                  ],
                },
              },
              crashProfit: {
                $sum: {
                  $multiply: [
                    {
                      $cond: [
                        { $eq: ["$subType", "softapi"] }, // crash condition
                        "$profit",
                        0,
                      ],
                    },
                    sign,
                  ],
                },
              },
            },
          },
        ];

        const data = await Bet.aggregate(pipeline);
        const casinoProfit = data.reduce((acc, u) => acc + u.casinoProfit, 0);
        const sportProfit = data.reduce((acc, u) => acc + u.sportProfit, 0);
        const crashProfit = data.reduce((acc, u) => acc + u.crashProfit, 0);

        return {
          username: currentUser.username,
          casinoProfit,
          sportProfit,
          crashProfit,
          role: currentUser.role,
        };
      })
    );
    const filteredResults = results.filter(
      (item) =>
        item.casinoProfit !== 0 ||
        item.sportProfit !== 0 ||
        item.crashProfit !== 0
    );

    // res
    //   .status(httpStatus.OK)
    //   .send(new APIResponse(results, "Fetch User Profit Loss", httpStatus.OK));
    res.status(httpStatus.OK).send(
  new APIResponse(
    filteredResults, 
    "Fetch User Profit Loss",
    httpStatus.OK
  )
);
  } catch (err) {
    next(err);
  }
};



// const clientProfitLoss = async (req, res, next) => {
//   try {
     
//     const { startDate, endDate } = req.body;
//     const allIds = await collectAllIds(req.user);

//     let query = {
//       isActive: true,
//       _id: { $in: allIds },
//       role: {
//         $in: [
//           "owner",
//           "super-admin",
//           "admin",
//           "sub-admin",
//           "super-master",
//           "master",
//         ],
//       },
//     };
//     const users = await getAllUsers(query);
//     const results = await Promise.all(
//       users.map(async (currentUser) => {
//         const allIds = await collectAllIds(currentUser);
//         const sign = -1;

//         const matchStage = {
//           userId: { $in: allIds },
//           status: { $in: ["won", "lost", "cancelled"] },
//           isActive: true,
//         };

//         if (startDate || endDate) {
//           matchStage.createdAt = {};
//           if (startDate) matchStage.createdAt.$gte = new Date(startDate);
//           if (endDate) matchStage.createdAt.$lte = new Date(endDate);
//         }

//         // const pipeline = [
//         //   { $match: matchStage },
//         //   {
//         //     $group: {
//         //       _id: "$userId",
//         //       totalProfit: {
//         //         $sum: { $multiply: ["$profit", sign] },
//         //       },
//         //     },
//         //   },
//         // ];//my changes

//         const pipeline = [
//       {
//         $match: matchStage,
//       },
//       {
//         $group: {
//           _id: null,

//           totalProfit: {
//             $sum: {
//               $multiply: [
//                 { $ifNull: ["$profit", 0] },
//                 sign,
//               ],
//             },
//           },

//           casinoPts: {
//             $sum: {
//               $cond: [
//                 {
//                   $and: [
//                     { $ne: [{ $ifNull: ["$subType", null] }, null] },
//                     { $ne: [{ $ifNull: ["$subType", ""] }, ""] },
//                   ],
//                 },
//                 {
//                   $multiply: [
//                     { $ifNull: ["$profit", 0] },
//                     sign,
//                   ],
//                 },
//                 0,
//               ],
//             },
//           },

//           sportPts: {
//             $sum: {
//               $cond: [
//                 {
//                   $or: [
//                     { $eq: [{ $ifNull: ["$subType", null] }, null] },
//                     { $eq: [{ $ifNull: ["$subType", ""] }, ""] },
//                   ],
//                 },
//                 {
//                   $multiply: [
//                     { $ifNull: ["$profit", 0] },
//                     sign,
//                   ],
//                 },
//                 0,
//               ],
//             },
//           },
//         },
//       },
//     ];

//     const thirdPartyMatch = { ////my changes
//       userId: { $in: allIds },
//       status: { $in: ["approved", "pending"] },
//       type: "softapi",
//     };

//     if (startDate || endDate) {
//       thirdPartyMatch.createdAt = {};

//       if (startDate) {
//         thirdPartyMatch.createdAt.$gte = new Date(startDate);
//       }

//       if (endDate) {
//         const thirdPartyEndDate = new Date(endDate);
//         thirdPartyEndDate.setHours(23, 59, 59, 999);

//         thirdPartyMatch.createdAt.$lte = thirdPartyEndDate;
//       }
//     }

//     const thirdPartyData = await Transaction.aggregate([
//       {
//         $match: thirdPartyMatch,
//       },
//       {
//         $group: {
//           _id: null,
//           total: {
//             $sum: {
//               $multiply: [
//                 { $ifNull: ["$amount", 0] },
//                 sign,
//               ],
//             },
//           },
//         },
//       },
//     ]);

//     const thirdPartyPts = Number(
//       thirdPartyData[0]?.total || 0
//     );

//   const data = await Bet.aggregate(pipeline);
//   const totalProfit = data.reduce((acc, u) => acc + u.totalProfit, 0);
//   //const data = await Bet.aggregate(pipeline);

//   //const totalProfit = Number(data[0]?.totalProfit || 0);
//   const casinoPts = Number(data[0]?.casinoPts || 0);
//   const sportPts = Number(data[0]?.sportPts || 0);

//         return {
//           username: currentUser.username,
//           //totalProfit,
//           role: currentUser.role,
//             casinoPts,
//             sportPts,
//             thirdPartyPts,

//             totalProfit,
//         };
//       })
//     );

//     res
//       .status(httpStatus.OK)
//       .send(new APIResponse(results, "Fetch User Profit Loss", httpStatus.OK));
//   } catch (err) {
//     next(err);
//   }
// };


const clientProfitLoss = async (req, res, next) => {
  try {
   
    const startDate =
      req.body?.startDate || req.body?.fromDate;

    const endDate =
      req.body?.endDate || req.body?.toDate;

    console.log("CLIENT PROFIT LOSS REQUEST:", {
      body: req.body,
      startDate,
      endDate,
    });

   
    const createFilterDate = (
      dateValue,
      isEndDate = false
    ) => {
      if (!dateValue) {
        return null;
      }

      const dateString = String(dateValue).trim();

      let year;
      let month;
      let day;

      // YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        [year, month, day] = dateString
          .split("-")
          .map(Number);
      }

      // DD-MM-YYYY
      else if (
        /^\d{2}-\d{2}-\d{4}$/.test(dateString)
      ) {
        [day, month, year] = dateString
          .split("-")
          .map(Number);
      } else {
        return null;
      }

      const formattedMonth = String(month).padStart(
        2,
        "0"
      );

      const formattedDay = String(day).padStart(
        2,
        "0"
      );

      const time = isEndDate
        ? "23:59:59.999"
        : "00:00:00.000";

      const date = new Date(
        `${year}-${formattedMonth}-${formattedDay}T${time}+05:30`
      );

      if (Number.isNaN(date.getTime())) {
        return null;
      }

      return date;
    };

    const filterStartDate = createFilterDate(
      startDate,
      false
    );

    const filterEndDate = createFilterDate(
      endDate,
      true
    );

    if (startDate && !filterStartDate) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            "Invalid startDate. Use YYYY-MM-DD format.",
            httpStatus.BAD_REQUEST
          )
        );
    }

    if (endDate && !filterEndDate) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            "Invalid endDate. Use YYYY-MM-DD format.",
            httpStatus.BAD_REQUEST
          )
        );
    }

    if (
      filterStartDate &&
      filterEndDate &&
      filterStartDate > filterEndDate
    ) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            "startDate cannot be greater than endDate.",
            httpStatus.BAD_REQUEST
          )
        );
    }

    console.log("CLIENT PROFIT LOSS DATE RANGE:", {
      filterStartDate,
      filterEndDate,
    });

    const loginUserAllIds =
      await collectAllIds(req.user);

    const query = {
      isActive: true,

      _id: {
        $in: loginUserAllIds,
      },

      role: {
        $in: [
          "owner",
          "super-admin",
          "admin",
          "sub-admin",
          "super-master",
          "master",
        ],
      },
    };

    const users = await getAllUsers(query);

    const results = await Promise.all(
      users.map(async (currentUser) => {
        const currentUserAllIds =
          await collectAllIds(currentUser);

        const sign = -1;

        const matchStage = {
          userId: {
            $in: currentUserAllIds,
          },

          status: {
            $in: ["won", "lost", "cancelled"],
          },

          isActive: true,
        };

        if (filterStartDate || filterEndDate) {
          matchStage.createdAt = {};

          if (filterStartDate) {
            matchStage.createdAt.$gte =
              filterStartDate;
          }

          if (filterEndDate) {
            matchStage.createdAt.$lte =
              filterEndDate;
          }
        }

        const pipeline = [
          {
            $match: matchStage,
          },
          {
            $group: {
              _id: null,

              totalProfit: {
                $sum: {
                  $multiply: [
                    {
                      $ifNull: ["$profit", 0],
                    },
                    sign,
                  ],
                },
              },

              casinoPts: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        {
                          $ne: [
                            {
                              $ifNull: [
                                "$subType",
                                null,
                              ],
                            },
                            null,
                          ],
                        },
                        {
                          $ne: [
                            {
                              $ifNull: [
                                "$subType",
                                "",
                              ],
                            },
                            "",
                          ],
                        },
                      ],
                    },
                    {
                      $multiply: [
                        {
                          $ifNull: [
                            "$profit",
                            0,
                          ],
                        },
                        sign,
                      ],
                    },
                    0,
                  ],
                },
              },

              sportPts: {
                $sum: {
                  $cond: [
                    {
                      $or: [
                        {
                          $eq: [
                            {
                              $ifNull: [
                                "$subType",
                                null,
                              ],
                            },
                            null,
                          ],
                        },
                        {
                          $eq: [
                            {
                              $ifNull: [
                                "$subType",
                                "",
                              ],
                            },
                            "",
                          ],
                        },
                      ],
                    },
                    {
                      $multiply: [
                        {
                          $ifNull: [
                            "$profit",
                            0,
                          ],
                        },
                        sign,
                      ],
                    },
                    0,
                  ],
                },
              },
            },
          },
        ];

        /*
         * Third-party transaction date filter
         */
        const thirdPartyMatch = {
          userId: {
            $in: currentUserAllIds,
          },

          status: {
            $in: ["approved", "pending"],
          },

          type: "softapi",
        };

        if (filterStartDate || filterEndDate) {
          thirdPartyMatch.createdAt = {};

          if (filterStartDate) {
            thirdPartyMatch.createdAt.$gte =
              filterStartDate;
          }

          if (filterEndDate) {
            thirdPartyMatch.createdAt.$lte =
              filterEndDate;
          }
        }

        const [data, thirdPartyData] =
          await Promise.all([
            Bet.aggregate(pipeline),

            Transaction.aggregate([
              {
                $match: thirdPartyMatch,
              },
              {
                $group: {
                  _id: null,

                  total: {
                    $sum: {
                      $multiply: [
                        {
                          $ifNull: [
                            "$amount",
                            0,
                          ],
                        },
                        sign,
                      ],
                    },
                  },
                },
              },
            ]),
          ]);

        const totalProfit = Number(
          data[0]?.totalProfit || 0
        );

        const casinoPts = Number(
          data[0]?.casinoPts || 0
        );

        const sportPts = Number(
          data[0]?.sportPts || 0
        );

        const thirdPartyPts = Number(
          thirdPartyData[0]?.total || 0
        );

        return {
          username: currentUser.username,
          role: currentUser.role,
          casinoPts,
          sportPts,
          thirdPartyPts,
          totalProfit,
        };
      })
    );

  
    const filteredResults = results.filter(
      (item) => {
        return (
          Number(item.casinoPts) !== 0 ||
          Number(item.sportPts) !== 0 ||
          Number(item.thirdPartyPts) !== 0 ||
          Number(item.totalProfit) !== 0
        );
      }
    );

    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          filteredResults,
          "Fetch User Profit Loss",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(err);
  }
};

const clientProfitLossShotx = async (req, res, next) => {
  try {
    const {
      userId,
      targetRole,
      startDate,
      endDate,
      page = 1,
      limit = 25,
    } = req.body;

    // ============================================================
    // PAGINATION
    // ============================================================

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.max(1, parseInt(limit) || 25);
    const skip = (pageNum - 1) * limitNum;

    // ============================================================
    // VALIDATION
    // ============================================================

    if (!userId) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            "userId is required.",
            httpStatus.BAD_REQUEST
          )
        );
    }

    const allowedRoles = [
      "owner",
      "super-admin",
      "admin",
      "sub-admin",
      "super-master",
      "master",
      "user",
      "demo",
      "sub-user",
    ];

    if (!targetRole) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            "targetRole is required.",
            httpStatus.BAD_REQUEST
          )
        );
    }

    if (!allowedRoles.includes(targetRole)) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            `Invalid targetRole. Allowed roles are: ${allowedRoles.join(
              ", "
            )}`,
            httpStatus.BAD_REQUEST
          )
        );
    }

    // ============================================================
    // DATE PARSER
    // Supports:
    // YYYY-MM-DD
    // DD-MM-YYYY
    // ============================================================

    const createFilterDate = (dateValue, isEndDate = false) => {
      if (!dateValue) {
        return null;
      }

      const dateString = String(dateValue).trim();

      let year;
      let month;
      let day;

      // YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        [year, month, day] = dateString.split("-").map(Number);
      }

      // DD-MM-YYYY
      else if (/^\d{2}-\d{2}-\d{4}$/.test(dateString)) {
        [day, month, year] = dateString.split("-").map(Number);
      } else {
        return null;
      }

      const formattedMonth = String(month).padStart(2, "0");
      const formattedDay = String(day).padStart(2, "0");

      const time = isEndDate
        ? "23:59:59.999"
        : "00:00:00.000";

      const date = new Date(
        `${year}-${formattedMonth}-${formattedDay}T${time}+05:30`
      );

      if (Number.isNaN(date.getTime())) {
        return null;
      }

      return date;
    };

    const filterStartDate = createFilterDate(startDate, false);
    const filterEndDate = createFilterDate(endDate, true);

    // ============================================================
    // DATE VALIDATION
    // ============================================================

    if (startDate && !filterStartDate) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            "Invalid startDate. Use YYYY-MM-DD format.",
            httpStatus.BAD_REQUEST
          )
        );
    }

    if (endDate && !filterEndDate) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            "Invalid endDate. Use YYYY-MM-DD format.",
            httpStatus.BAD_REQUEST
          )
        );
    }

    if (
      filterStartDate &&
      filterEndDate &&
      filterStartDate > filterEndDate
    ) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            "startDate cannot be greater than endDate.",
            httpStatus.BAD_REQUEST
          )
        );
    }

    console.log("ROLE WISE PROFIT LOSS REQUEST:", {
      userId,
      targetRole,
      startDate,
      endDate,
      page: pageNum,
      limit: limitNum,
      skip,
      filterStartDate,
      filterEndDate,
    });

    // ============================================================
    // 1. FIND REQUESTED USER
    // ============================================================

    const selectedUser = await getUserById(userId);

    if (!selectedUser) {
      return res
        .status(httpStatus.NOT_FOUND)
        .send(
          new APIResponse(
            {},
            "User not found.",
            httpStatus.NOT_FOUND
          )
        );
    }

    // ============================================================
    // 2. GET COMPLETE HIERARCHY OF REQUESTED USER
    // ============================================================

    const hierarchyIds = await collectAllIds(selectedUser);

    // ============================================================
    // 3. GET ONLY USERS OF targetRole
    // ============================================================

    const targetUsers = await getAllUsers({
      isActive: true,
      _id: {
        $in: hierarchyIds,
      },
      role: targetRole,
    });

    console.log(
      `ROLE WISE PROFIT LOSS: Found ${targetUsers.length} ${targetRole} users`
    );

    // ============================================================
    // 4. CALCULATE P&L + COMMISSION FOR EACH TARGET USER
    // ============================================================

    const results = await Promise.all(
      targetUsers.map(async (currentUser) => {
        /*
         * Example:
         *
         * Admin
         *   ├── Master A
         *   │    ├── User 1
         *   │    └── User 2
         *   │
         *   └── Master B
         *        └── User 3
         *
         * If targetRole = master:
         *
         * Master A:
         *   Bets = Master A + User 1 + User 2
         *
         * Master B:
         *   Bets = Master B + User 3
         *
         * IMPORTANT:
         *
         * The amounts are calculated from the COMPLETE
         * hierarchy of the target user.
         *
         * The commission TYPE + PERCENTAGE come from
         * the TARGET USER'S OWN PARTNERSHIP.
         */

        const currentUserAllIds =
          await collectAllIds(currentUser);

        // ========================================================
        // TARGET USER'S OWN PARTNERSHIP
        // ========================================================

        let targetPartnership = null;

        if (currentUser.parent) {
          targetPartnership = await Partnership.findOne({
            userId: currentUser._id,
            partnerId: currentUser.parent,
          }).lean();
        }

        // ========================================================
        // TARGET USER COMMISSION CONFIG
        // ========================================================

        const bookmakerCommissionConfig =
          targetPartnership?.bookmakerCommission?.[0] || {
            type: "NONE",
            percentage: 0,
          };

        const fancyCommissionConfig =
          targetPartnership?.fancyCommission?.[0] || {
            type: "NONE",
            percentage: 0,
          };

        const casinoCommissionConfig =
          targetPartnership?.casinoCommission || {
            type: "NONE",
            percentage: 0,
          };

        const bookmakerCommissionType =
          bookmakerCommissionConfig.type || "NONE";

        const bookmakerCommissionPercentage = Number(
          bookmakerCommissionConfig.percentage || 0
        );

        const fancyCommissionType =
          fancyCommissionConfig.type || "NONE";

        const fancyCommissionPercentage = Number(
          fancyCommissionConfig.percentage || 0
        );

        const casinoCommissionType =
          casinoCommissionConfig.type || "NONE";

        const casinoCommissionPercentage = Number(
          casinoCommissionConfig.percentage || 0
        );

        // ========================================================
        // BET FILTER
        // ========================================================

        const matchStage = {
          userId: {
            $in: currentUserAllIds,
          },

          status: {
            $in: [
              "won",
              "lost",
              "cancelled",
            ],
          },

          isActive: true,
        };

        if (filterStartDate || filterEndDate) {
          matchStage.createdAt = {};

          if (filterStartDate) {
            matchStage.createdAt.$gte = filterStartDate;
          }

          if (filterEndDate) {
            matchStage.createdAt.$lte = filterEndDate;
          }
        }

        // ========================================================
        // FETCH BETS
        // ========================================================

        const bets = await Bet.find(matchStage)
          .select(
            "userId amount profit gType cType marketName sectionName etid iscc subType"
          )
          .lean();

        // ========================================================
        // INITIALIZE
        // ========================================================

        let casinoPts = 0;
        let sportPts = 0;

        // These are the commission BASE amounts.
        let bmAmount = 0;
        let fancyAmount = 0;
        let casinoAmount = 0;

        // ========================================================
        // CASINO GAME TYPES
        // Same classification as direct-child report.
        // ========================================================

        const casinoGameTypes = [
          "superover3",
          "superover",
          "superover2",
          "cricketv3",
        ];

        // ========================================================
        // PROCESS EVERY BET
        // ========================================================

        for (const bet of bets) {
          const profit = Number(bet.profit || 0);

          // ======================================================
          // P&L
          // ======================================================

          const hasSubType =
            bet.subType !== null &&
            bet.subType !== undefined &&
            String(bet.subType).trim() !== "";

          if (hasSubType) {
            casinoPts += profit * -1;
          } else {
            sportPts += profit * -1;
          }

          // ======================================================
          // NORMALIZE FIELDS
          // ======================================================

          const marketName = String(
            bet.marketName || ""
          )
            .trim()
            .toLowerCase();

          const gType = String(
            bet.gType || ""
          )
            .trim()
            .toLowerCase();

          const cType = String(
            bet.cType || ""
          )
            .trim()
            .toLowerCase()
            .replace(/[\s_-]+/g, "");

          const sectionName = String(
            bet.sectionName || ""
          )
            .trim()
            .toLowerCase();

          // ======================================================
          // CLASSIFICATIONS
          // ======================================================

          const isCasinoGameType =
            casinoGameTypes.includes(cType);

          const isBookmaker =
            marketName === "bookmaker" ||
            marketName === "bookmaker 2";

          const isFancy =
            gType === "fancy" ||
            (
              gType === "fancy1" &&
              !sectionName.includes("will win the toss")
            );

          // ======================================================
          // BOOKMAKER BASE AMOUNT
          // ======================================================

          if (
            isBookmaker &&
            !isCasinoGameType &&
            String(bet.etid) === "4" &&
            (
              bet.iscc === undefined ||
              bet.iscc === null ||
              Number(bet.iscc) === 0
            )
          ) {
            if (
              bookmakerCommissionType ===
              "ENTRY_WISE"
            ) {
              bmAmount += profit;
            } else if (
              bookmakerCommissionType ===
                "ENTRY_LOOSING" ||
              bookmakerCommissionType ===
                "NET_LOOSING"
            ) {
              if (profit < 0) {
                bmAmount += Math.abs(profit);
              }
            }
          }

          // ======================================================
          // FANCY BASE AMOUNT
          // ======================================================

          else if (
            isFancy &&
            !isCasinoGameType &&
            String(bet.etid) === "4" &&
            (
              bet.iscc === undefined ||
              bet.iscc === null ||
              Number(bet.iscc) === 0
            )
          ) {
            if (
              fancyCommissionType === "ENTRY_WISE"
            ) {
              fancyAmount += Math.abs(profit);
            }
          }

          // ======================================================
          // CASINO GAME TYPE
          // ======================================================

          else if (isCasinoGameType) {
            if (
              casinoCommissionType ===
              "ENTRY_LOOSING"
            ) {
              if (profit < 0) {
                casinoAmount += Math.abs(profit);
              }
            }
          }

          // ======================================================
          // OTHER CASINO BETS
          // ======================================================

          else if (
            !isBookmaker &&
            !isFancy
          ) {
            if (
              casinoCommissionType ===
              "ENTRY_LOOSING"
            ) {
              if (profit < 0) {
                casinoAmount += Math.abs(profit);
              }
            }
          }
        }

        // ========================================================
        // COMMISSION CALCULATION
        //
        // Amount = complete hierarchy amount
        // Type + percentage = target user's partnership
        // ========================================================

        let matchCommission = 0;
        let sessionCommission = 0;
        let casinoCommission = 0;

        // ========================================================
        // MATCH COMMISSION
        // ========================================================

        if (
          bookmakerCommissionType !== "NONE" &&
          bookmakerCommissionPercentage > 0
        ) {
          matchCommission =
            (Number(bmAmount || 0) *
              bookmakerCommissionPercentage) /
            100;
        }

        // ========================================================
        // SESSION COMMISSION
        // ========================================================

        if (
          fancyCommissionType !== "NONE" &&
          fancyCommissionPercentage > 0
        ) {
          sessionCommission =
            (Number(fancyAmount || 0) *
              fancyCommissionPercentage) /
            100;
        }

        // ========================================================
        // CASINO COMMISSION
        // ========================================================

        if (
          casinoCommissionType !== "NONE" &&
          casinoCommissionPercentage > 0
        ) {
          casinoCommission =
            (Number(casinoAmount || 0) *
              casinoCommissionPercentage) /
            100;
        }

        // ========================================================
        // TOTAL P&L
        // ========================================================

        const total = casinoPts + sportPts;

        // ========================================================
        // TOTAL COMMISSION
        // ========================================================

        const totalCommission =
          matchCommission +
          sessionCommission +
          casinoCommission;

        // ========================================================
        // GTOTAL
        //
        // GTotal = Total P&L + Total Commission
        // ========================================================

        const gtotal = total + totalCommission;

        // ========================================================
        // MY SHARE PERCENTAGE
        //
        // OWNER:
        //   Always 100%
        //
        // NON-OWNER:
        //   Own partnershipValue
        //   + parent partnershipValue
        //   + parent's parent partnershipValue
        //   ...
        //
        //   Stop BEFORE owner.
        //
        // Example:
        //
        // Owner       = 0
        // Admin       = 30
        // Master      = 20
        // Sub-admin   = 15
        //
        // Admin:
        //   30%
        //
        // Master:
        //   20 + 30 = 50%
        //
        // Sub-admin:
        //   15 + 20 + 30 = 65%
        // ========================================================

        let mySharePercentage = 0;

        if (currentUser?.role === "owner") {
          mySharePercentage = 100;
        } else {
          let partnershipUser = currentUser;

          while (
            partnershipUser &&
            partnershipUser.role !== "owner"
          ) {
            mySharePercentage += Number(
              partnershipUser?.partnershipValue || 0
            );

            if (!partnershipUser?.parent) {
              break;
            }

            partnershipUser = await getUser({
              _id: partnershipUser.parent,
            });
          }
        }

        // ========================================================
        // MY SHARE
        // ========================================================

        const myShare =
          (gtotal * mySharePercentage) / 100;

        // ========================================================
        // BALANCE
        //
        // Balance = GTotal + My Share
        // ========================================================

        const balance = gtotal + myShare;

        // ========================================================
        // RETURN RESULT
        // ========================================================

        return {
          username: currentUser.username,
          role: currentUser.role,

          casinoPts: Number(
            casinoPts.toFixed(2)
          ),

          sportPts: Number(
            sportPts.toFixed(2)
          ),

          total: Number(
            total.toFixed(2)
          ),

          matchCommission: Number(
            matchCommission.toFixed(2)
          ),

          sessionCommission: Number(
            sessionCommission.toFixed(2)
          ),

          casinoCommission: Number(
            casinoCommission.toFixed(2)
          ),

          totalCommission: Number(
            totalCommission.toFixed(2)
          ),

          gtotal: Number(
            gtotal.toFixed(2)
          ),

          myShare: Number(
            myShare.toFixed(2)
          ),

          balance: Number(
            balance.toFixed(2)
          ),
        };
      })
    );

    // ============================================================
    // REMOVE USERS WITH ZERO P&L
    // ============================================================

    const filteredResults =
      results.filter((item) => {
        return (
          Number(item.casinoPts) !== 0 ||
          Number(item.sportPts) !== 0 ||
          Number(item.total) !== 0
        );
      });

    // ============================================================
    // PAGINATION
    // ============================================================

    const totalRecords =
      filteredResults.length;

    const totalPages =
      Math.ceil(totalRecords / limitNum);

    const paginatedResults =
      filteredResults.slice(
        skip,
        skip + limitNum
      );

    console.log(
      "ROLE WISE PROFIT LOSS PAGINATION:",
      {
        totalRecords,
        totalPages,
        currentPage: pageNum,
        limit: limitNum,
        returnedRecords:
          paginatedResults.length,
      }
    );

    // ============================================================
    // RESPONSE
    // ============================================================

    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          {
            data: paginatedResults,

            pagination: {
              totalRecords,
              totalPages,
              currentPage: pageNum,
              limit: limitNum,
            },
          },
          "Fetch Role Wise User Profit Loss",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(err);
  }
};

//below is my old working code
const marketAnalysis = async (req, res, next) => {
  try {
    const { search, page = 1, limit = 25 } = req?.query;
    const limitNum = parseInt(limit);
    const pageNum = parseInt(page);
    const skip = (pageNum - 1) * limitNum;

    const allIds = await collectAllIds(req?.user);
    const matchStage = {
      userId: { $in: allIds },
      isActive: true,
      subType: { $exists: false },
      status: "pending",
    };

    if (search && search.trim() !== "") {
      matchStage.eventName = { $regex: search.trim(), $options: "i" };
    }

    const countPipeline = [
      { $match: matchStage },
      {
        $group: {
          // _id: {
          //   gameId: { $toString: "$gameId" },
          //   marketId: { $toString: "$marketId" }
          // }
          _id: {
            gameId: { $toString: "$gameId" },
            marketId: { $toString: "$marketId" },
            sectionName: "$sectionName",
          },
        }
      },
      {
        $group: {
          _id: "$_id.gameId"
        }
      },
      { $count: "totalRecords" }
    ];
    
    const countResult = await betModel.aggregate(countPipeline);
    const totalRecords = countResult[0]?.totalRecords || 0;
    const totalPages = Math.ceil(totalRecords / limitNum);

    const pipeline = [
      { $match: matchStage },

      // {
      //   $group: {
      //     _id: {
      //       gameId: { $toString: "$gameId" },
      //       marketId: { $toString: "$marketId" }
      //     },
      //     marketName: { $first: "$marketName" },
      //     doc: { $first: "$$ROOT" },
      //     marketTotal: { $sum: 1 },
      //   },
      // },
    ///my changes
      // {
      //   $group: {
      //     _id: {
      //       gameId: { $toString: "$gameId" },
      //       marketId: { $toString: "$marketId" },
      //     },

      //     marketName: {
      //       $max: {
      //         $cond: [
      //           {
      //             $and: [
      //               { $ne: ["$marketName", null] },
      //               { $ne: ["$marketName", ""] },
      //             ],
      //           },
      //           "$marketName",
      //           null,
      //         ],
      //       },
      //     },

      //     eventName: {
      //       $max: {
      //         $cond: [
      //           {
      //             $and: [
      //               { $ne: ["$eventName", null] },
      //               { $ne: ["$eventName", ""] },
      //             ],
      //           },
      //           "$eventName",
      //           null,
      //         ],
      //       },
      //     },

      //     etid: { $max: "$etid" },
      //     createdAt: { $max: "$createdAt" },
      //     doc: { $first: "$$ROOT" },
      //     marketTotal: { $sum: 1 },
      //   },
      // },
      {
        $group: {
          _id: {
            gameId: { $toString: "$gameId" },
            marketId: { $toString: "$marketId" },
            sectionName: "$sectionName", // <-- ADD THIS
          },

          marketName: {
            $max: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$marketName", null] },
                    { $ne: ["$marketName", ""] },
                  ],
                },
                "$marketName",
                null,
              ],
            },
          },

          eventName: {
            $max: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$eventName", null] },
                    { $ne: ["$eventName", ""] },
                  ],
                },
                "$eventName",
                null,
              ],
            },
          },

          etid: { $max: "$etid" },
          createdAt: { $max: "$createdAt" },

          doc: { $first: "$$ROOT" },

          marketTotal: { $sum: 1 },
        },
      },
      ///my chnages
      // {
      //   $group: {
      //     _id: "$_id.gameId",
      //     markets: {
      //       $push: {
      //         marketId: "$_id.marketId",
      //         marketName: "$marketName",
      //         total: "$marketTotal",
      //         doc: "$doc",
      //       },
      //     },
      //     total: { $sum: "$marketTotal" },
      //     eventName: { $first: "$doc.eventName" },
      //     etid: { $first: "$doc.etid" },
      //     createdAt: { $first: "$doc.createdAt" },
      //   },
      // },
      {
        $group: {
          _id: "$_id.gameId",

          markets: {
            $push: {
              marketId: "$_id.marketId",
              marketName: "$marketName",
                sectionName: "$_id.sectionName", //NEWADD
              total: "$marketTotal",
              doc: "$doc",
            },
          },

          total: { $sum: "$marketTotal" },

          eventName: {
            $max: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$eventName", null] },
                    { $ne: ["$eventName", ""] },
                  ],
                },
                "$eventName",
                null,
              ],
            },
          },

          etid: { $max: "$etid" },
          createdAt: { $max: "$createdAt" },
        },
      },

      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limitNum },

      {
        $lookup: {
          from: "games",
          let: { gameId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    { $eq: ["$gmid", "$$gameId"] },
                    {
                      $eq: [
                        "$gmid",
                        {
                          $convert: {
                            input: "$$gameId",
                            to: "int",
                            onError: null,
                            onNull: null,
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
            { $project: { stime: 1, _id: 0 } },
            { $limit: 1 },
          ],
          as: "gameData",
        },
      },

      {
        $unwind: { path: "$gameData", preserveNullAndEmptyArrays: true },
      },

      {
        $project: {
          _id: 0,
          gameId: "$_id",
          eventName: 1,
          createdAt: 1,
          etid: 1,
          total: 1,
          markets: 1,
          stime: "$gameData.stime", // Added stime
        },
      },
    ];

    const bets = await betModel.aggregate(pipeline);
    const allMarketIds = bets.flatMap((game) =>
      game.markets.map((m) => m.marketId)
    );

    const findSportsData = await getAllSportsData(
      {
        mid: { $in: allMarketIds },
        userId: { $in: allIds },
      },
      {},
      true
    );

    const commissionCache = new Map();

    // const calc = (val, commission) =>
    //   Number((((val ?? 0) * commission) / 100).toFixed(2)) * -1;

    const calc = (val, commission) =>
       Number((((val ?? 0) * commission) / 100).toFixed(2));

    const grouped = {};
    for (const bet of findSportsData) {
      const partnerId = bet?.userId?.parent?.toString();
      if (!partnerId) continue;

      let commission = commissionCache.get(partnerId);
      if (commission === undefined) {
        const list = await Utils.getUserCommissionHierarchyFast(bet.userId);
        if (req?.user?.role === "owner") {
          commission = 100;
        } else {
          commission =
            list?.find((i) => i?.role === req?.user?.role)?.commission ?? 0;
        }
        commissionCache.set(partnerId, commission);
      }

      const mid = bet.mid;
      grouped[mid] ??= { mid, sdata: [] };

      // bet.sdata?.forEach((s) => {
      //   let sidEntry = grouped[mid].sdata.find((x) => x.sid === s.sid);
      //   if (!sidEntry)
      //     grouped[mid].sdata.push(
      //       (sidEntry = { sid: s.sid, amount: 0, profit: 0, calcTable: [] })
      //     );

      //   sidEntry.amount += calc(s.amount, commission);
      //   sidEntry.profit += calc(s.profit, commission);

      bet.sdata?.forEach((s) => {

          const betKey = `${s.sid}_${JSON.stringify(s.calcTable || [])}`;

          let sidEntry = grouped[mid].sdata.find(
            (x) => x.betKey === betKey
          );

          if (!sidEntry) {
            grouped[mid].sdata.push(
              (sidEntry = {
                sid: s.sid,
                betKey,
                amount: 0,
                profit: 0,
                calcTable: []
              })
            );
          }

          sidEntry.amount += calc(s.amount, commission);
          sidEntry.profit += calc(s.profit, commission);

        if (s.calcTable?.length > 0) {
          s.calcTable.forEach((c, index) => {
            let runEntry = sidEntry.calcTable[index];

            if (!runEntry) {
              runEntry = {
                run: c.run ?? index,
                back: 0,
                lay: 0,
                profitLoss: 0,
              };
              sidEntry.calcTable[index] = runEntry;
            }

            runEntry.back += calc(c.back, commission);
            runEntry.lay += calc(c.lay, commission);
            runEntry.profitLoss += calc(c.profitLoss, commission);
          });
        } else {
          sidEntry.calcTable = [];
        }
      });


    }

    const result = Object.values(grouped).map((bet) => ({
      mid: bet.mid,
      sdata: bet.sdata.map((s) => ({
        sid: s.sid,
        amount: Number(s.amount.toFixed(2)),
        profit: Number(s.profit.toFixed(2)),
        calcTable: s.calcTable.map((c) => ({
          run: c.run,
          back: Number(c.back.toFixed(2)),
          lay: Number(c.lay.toFixed(2)),
          profitLoss: Number(c.profitLoss.toFixed(2)),
        })),
      })),
    }));

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          { bets, sportData: result, totalPages, totalRecords },
          "Market Analysis fetched successfully",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(err);
  }
};




//optimized
// const listPendingBets = async (req, res, next) => {
//   try {
//     const {
//       gameId,
//       marketId,
//       gType,
//       isActive,
//       status,
//     } = req.body;

//     const id = req?.user?._id;

//     const allIds = await collectAllIds(req?.user);

//     if (
//       !id ||
//       (!gameId && (!marketId || !gType))
//     ) {
//       return res
//         .status(httpStatus.BAD_REQUEST)
//         .json(
//           new APIError(
//             "Either (gameId + userId) or (marketId + gType + userId) are required",
//             httpStatus.BAD_REQUEST
//           )
//         );
//     }

//     // ============================================================
//     // 1. GET BETS
//     // ============================================================

//     const bets = await getBets(
//       {
//         userId: {
//           $in: allIds,
//         },

//         ...(gameId && {
//           gameId,
//         }),

//         ...(marketId && {
//           marketId,
//         }),

//         ...(gType && {
//           gType,
//         }),

//         ...(isActive && {
//           isActive,
//         }),

//         ...(status && {
//           status,
//         }),

//         deleteBetStatus: {
//           $ne: true,
//         },
//       },
//       true
//     );

//     // ============================================================
//     // 2. CONVERT MONGOOSE DOCUMENTS ONLY ONCE
//     //
//     // OLD CODE repeatedly called toObject() throughout the
//     // function.
//     // ============================================================

//     const betObjects = bets.map((bet) =>
//       bet?.toObject
//         ? bet.toObject()
//         : bet
//     );

//     // ============================================================
//     // 3. REMOVE DUPLICATE POPUP ENTRIES EARLY
//     //
//     // OLD KEY:
//     // userId + marketId
//     //
//     // This is the same logic used at the end of the old function,
//     // but doing it here lets us avoid unnecessary IP processing.
//     // ============================================================

//     const uniqueBetsMap = new Map();

//     for (const bet of betObjects) {
//       const userId =
//         bet?.userId?._id?.toString?.() ||
//         bet?.userId?.toString?.() ||
//         "";

//       const betMarketId =
//         String(
//           bet?.marketId || ""
//         );

//       const uniqueKey =
//         `${userId}_${betMarketId}`;

//       if (
//         !uniqueBetsMap.has(
//           uniqueKey
//         )
//       ) {
//         uniqueBetsMap.set(
//           uniqueKey,
//           bet
//         );
//       }
//     }

//     const uniqueBets =
//       Array.from(
//         uniqueBetsMap.values()
//       );

//     // ============================================================
//     // 4. IP DETAILS
//     //
//     // IMPORTANT:
//     // Only lookup IPs that will actually be returned.
//     // Previously this was done for ALL bets before deduplication.
//     // ============================================================

//     const uniqueIps = [
//       ...new Set(
//         uniqueBets
//           .map(
//             (bet) =>
//               bet?.ip ||
//               bet?.ipAddress
//           )
//           .filter(
//             (ip) =>
//               ip &&
//               ip !== "127.0.0.1" &&
//               ip !== "::1"
//           )
//       ),
//     ];

//     const ipDetailsMap =
//       new Map();

//     await Promise.all(
//       uniqueIps.map(
//         async (ip) => {
//           try {
//             const response =
//               await axios.get(
//                 `http://ip-api.com/json/${encodeURIComponent(ip)}`,
//                 {
//                   params: {
//                     fields:
//                       "status,message,query,city,country,mobile",
//                   },

//                   timeout: 5000,
//                 }
//               );

//             if (
//               response.data?.status ===
//               "success"
//             ) {
//               ipDetailsMap.set(
//                 ip,
//                 {
//                   ip:
//                     response.data.query ||
//                     ip,

//                   city:
//                     response.data.city ||
//                     "",

//                   country:
//                     response.data.country ||
//                     "",

//                   mobile:
//                     Boolean(
//                       response.data.mobile
//                     ),
//                 }
//               );
//             }
//           } catch (error) {
//             // Ignore IP lookup failures
//           }
//         }
//       )
//     );

//     // ============================================================
//     // 5. SPORTS DATA
//     // ============================================================

//     const marketIds = [
//       ...new Set(
//         betObjects
//           .map(
//             (bet) => bet.marketId
//           )
//           .filter(
//             (id) =>
//               id !== undefined &&
//               id !== null
//           )
//       ),
//     ];

//     const findSportsData =
//       marketIds.length > 0
//         ? await getAllSportsData(
//             {
//               mid: {
//                 $in: marketIds,
//               },

//               userId: {
//                 $in: allIds,
//               },
//             },
//             {},
//             true
//           )
//         : [];

//     // ============================================================
//     // 6. SELECTION NAME MAP
//     //
//     // O(n) instead of repeatedly searching bets later.
//     // ============================================================

//     const selectionNameMap =
//       new Map();

//     for (
//       const bet
//       of betObjects
//     ) {
//       const betMarketId =
//         String(
//           bet?.marketId
//         );

//       // ----------------------------------------------------------
//       // sections -> sid -> nat
//       // ----------------------------------------------------------

//       if (
//         Array.isArray(
//           bet?.sections
//         )
//       ) {
//         for (
//           const section
//           of bet.sections
//         ) {
//           if (
//             section?.sid !==
//               undefined &&
//             section?.sid !==
//               null &&
//             section?.nat
//           ) {
//             const selectionKey =
//               `${betMarketId}_${String(
//                 section.sid
//               )}`;

//             if (
//               !selectionNameMap.has(
//                 selectionKey
//               )
//             ) {
//               selectionNameMap.set(
//                 selectionKey,
//                 section.nat
//               );
//             }
//           }
//         }
//       }

//       // ----------------------------------------------------------
//       // Current bet section fallback
//       // ----------------------------------------------------------

//       if (
//         bet?.sectionId !==
//           undefined &&
//         bet?.sectionId !==
//           null &&
//         bet?.sectionName
//       ) {
//         const selectionKey =
//           `${betMarketId}_${String(
//             bet.sectionId
//           )}`;

//         if (
//           !selectionNameMap.has(
//             selectionKey
//           )
//         ) {
//           selectionNameMap.set(
//             selectionKey,
//             bet.sectionName
//           );
//         }
//       }
//     }

//     // ============================================================
//     // 7. CREATE BET SECTION NAME FALLBACK MAP
//     //
//     // OLD CODE:
//     //
//     // bets.find(...)
//     //
//     // was executed inside every sdata loop.
//     //
//     // This changes it to O(1) lookup.
//     // ============================================================

//     const betSectionNameMap =
//       new Map();

//     for (
//       const bet
//       of betObjects
//     ) {
//       const mid =
//         String(
//           bet?.marketId
//         );

//       const sid =
//         String(
//           bet?.sectionId
//         );

//       if (
//         bet?.sectionId !==
//           undefined &&
//         bet?.sectionId !==
//           null &&
//         bet?.sectionName
//       ) {
//         const key =
//           `${mid}_${sid}`;

//         if (
//           !betSectionNameMap.has(
//             key
//           )
//         ) {
//           betSectionNameMap.set(
//             key,
//             bet.sectionName
//           );
//         }
//       }
//     }

//     // ============================================================
//     // 8. USER MARKET PL MAP
//     // ============================================================

//     const userMarketPLMap =
//       new Map();

//     for (
//       const sportData
//       of findSportsData
//     ) {
//       const sportUserId =
//         sportData?.userId?._id
//           ?.toString?.() ||
//         sportData?.userId
//           ?.toString?.();

//       const mid =
//         String(
//           sportData?.mid
//         );

//       if (
//         !sportUserId ||
//         !mid
//       ) {
//         continue;
//       }

//       const userMarketKey =
//         `${sportUserId}_${mid}`;

//       let marketPLMap =
//         userMarketPLMap.get(
//           userMarketKey
//         );

//       if (!marketPLMap) {
//         marketPLMap = new Map();

//         userMarketPLMap.set(
//           userMarketKey,
//           marketPLMap
//         );
//       }

//       // ----------------------------------------------------------
//       // Process selections
//       // ----------------------------------------------------------

//       if (
//         Array.isArray(
//           sportData?.sdata
//         )
//       ) {
//         for (
//           const s
//           of sportData.sdata
//         ) {
//           const sid =
//             String(
//               s.sid
//             );

//           const selectionKey =
//             `${mid}_${sid}`;

//           let name =
//             selectionNameMap.get(
//               selectionKey
//             ) || "";

//           // O(1) fallback instead of bets.find()
//           if (!name) {
//             name =
//               betSectionNameMap.get(
//                 selectionKey
//               ) || "";
//           }

//           let existing =
//             marketPLMap.get(
//               sid
//             );

//           if (existing) {
//             existing.amount +=
//               Number(
//                 s.amount || 0
//               );

//             if (
//               !existing.name &&
//               name
//             ) {
//               existing.name =
//                 name;
//             }
//           } else {
//             existing = {
//               sid,

//               name,

//               amount:
//                 Number(
//                   s.amount || 0
//                 ),
//             };

//             marketPLMap.set(
//               sid,
//               existing
//             );
//           }
//         }
//       }
//     }

//     // ============================================================
//     // 9. CONVERT MARKET PL MAPS TO ARRAYS
//     //
//     // Response structure remains unchanged.
//     // ============================================================

//     const userMarketPLArrayMap =
//       new Map();

//     for (
//       const [
//         key,
//         marketPLMap,
//       ]
//       of userMarketPLMap
//     ) {
//       userMarketPLArrayMap.set(
//         key,
//         Array.from(
//           marketPLMap.values()
//         )
//       );
//     }

//     // ============================================================
//     // 10. BUILD BETS WITH IP + MARKET PL
//     // ============================================================

//     const betsWithIpDetails =
//       uniqueBets.map(
//         (betObj) => {
//           const ip =
//             betObj?.ip ||
//             betObj?.ipAddress ||
//             "";

//           const ipDetails =
//             ipDetailsMap.get(
//               ip
//             ) || {
//               ip,

//               city:
//                 ip ===
//                   "127.0.0.1" ||
//                 ip === "::1"
//                   ? "Localhost"
//                   : "",

//               country:
//                 "",

//               mobile:
//                 false,
//             };

//           const betUserId =
//             betObj?.userId?._id
//               ?.toString?.() ||
//             betObj?.userId
//               ?.toString?.();

//           const betMarketId =
//             String(
//               betObj?.marketId
//             );

//           const marketPL =
//             userMarketPLArrayMap.get(
//               `${betUserId}_${betMarketId}`
//             ) || [];

//           return {
//             ...betObj,

//             // OLD KEY
//             ipDetails,

//             // NEW KEY
//             marketPL,
//           };
//         }
//       );

//     // ============================================================
//     // 11. COMMISSION CALCULATION
//     // ============================================================

//     const commissionCache =
//       new Map();

//     const calc = (
//       val,
//       commission
//     ) =>
//       Number(
//         (
//           ((val ?? 0) *
//             commission) /
//           100
//         ).toFixed(2)
//       ) * -1;

//     // ============================================================
//     // 12. PRELOAD COMMISSIONS IN PARALLEL
//     //
//     // OLD CODE:
//     //
//     // for (...)
//     //   await getUserCommissionHierarchyFast()
//     //
//     // This was sequential.
//     //
//     // NEW:
//     // collect unique partners and fetch them in parallel.
//     // ============================================================

//     const partnerUsers =
//       new Map();

//     for (
//       const bet
//       of findSportsData
//     ) {
//       const partnerId =
//         bet?.userId?.parent
//           ?.toString();

//       if (!partnerId) {
//         continue;
//       }

//       if (
//         !partnerUsers.has(
//           partnerId
//         )
//       ) {
//         partnerUsers.set(
//           partnerId,
//           bet.userId
//         );
//       }
//     }

//     await Promise.all(
//       Array.from(
//         partnerUsers.entries()
//       ).map(
//         async (
//           [partnerId, user]
//         ) => {
//           try {
//             let commission;

//             const list =
//               await Utils.getUserCommissionHierarchyFast(
//                 user
//               );

//             if (
//               req?.user?.role ===
//               "owner"
//             ) {
//               commission = 100;
//             } else {
//               commission =
//                 list?.find(
//                   (i) =>
//                     i?.role ===
//                     req?.user?.role
//                 )?.commission ??
//                 0;
//             }

//             commissionCache.set(
//               partnerId,
//               commission
//             );
//           } catch (error) {
//             commissionCache.set(
//               partnerId,
//               0
//             );
//           }
//         }
//       )
//     );

//     // ============================================================
//     // 13. GROUP SPORTS DATA
//     //
//     // Use Maps instead of .find() for sid/subId.
//     // ============================================================

//     const grouped =
//       new Map();

//     for (
//       const bet
//       of findSportsData
//     ) {
//       const partnerId =
//         bet?.userId?.parent
//           ?.toString();

//       if (!partnerId) {
//         continue;
//       }

//       const commission =
//         commissionCache.get(
//           partnerId
//         ) ?? 0;

//       const mid =
//         bet.mid;

//       let marketGroup =
//         grouped.get(mid);

//       if (!marketGroup) {
//         marketGroup = {
//           mid,

//           sdata: new Map(),
//         };

//         grouped.set(
//           mid,
//           marketGroup
//         );
//       }

//       if (
//         !Array.isArray(
//           bet?.sdata
//         )
//       ) {
//         continue;
//       }

//       for (
//         const s
//         of bet.sdata
//       ) {
//         const sidKey =
//           `${String(
//             s.sid
//           )}_${String(
//             s.subId
//           )}`;

//         let sidEntry =
//           marketGroup.sdata.get(
//             sidKey
//           );

//         if (!sidEntry) {
//           sidEntry = {
//             sid:
//               s.sid,

//             subId:
//               s.subId,

//             amount:
//               0,

//             profit:
//               0,

//             calcTable:
//               [],
//           };

//           marketGroup.sdata.set(
//             sidKey,
//             sidEntry
//           );
//         }

//         sidEntry.amount +=
//           calc(
//             s.amount,
//             commission
//           );

//         sidEntry.profit +=
//           calc(
//             s.profit,
//             commission
//           );

//         // ======================================================
//         // CALC TABLE
//         // ======================================================

//         if (
//           Array.isArray(
//             s.calcTable
//           ) &&
//           s.calcTable.length > 0
//         ) {
//           for (
//             let index = 0;
//             index <
//             s.calcTable.length;
//             index++
//           ) {
//             const c =
//               s.calcTable[
//                 index
//               ];

//             let runEntry =
//               sidEntry
//                 .calcTable[
//                 index
//               ];

//             if (!runEntry) {
//               runEntry = {
//                 run:
//                   c.run ??
//                   index,

//                 back:
//                   0,

//                 lay:
//                   0,

//                 profitLoss:
//                   0,
//               };

//               sidEntry.calcTable[
//                 index
//               ] = runEntry;
//             }

//             runEntry.back +=
//               calc(
//                 c.back,
//                 commission
//               );

//             runEntry.lay +=
//               calc(
//                 c.lay,
//                 commission
//               );

//             runEntry.profitLoss +=
//               calc(
//                 c.profitLoss,
//                 commission
//               );
//           }
//         } else {
//           sidEntry.calcTable =
//             [];
//         }
//       }
//     }

//     // ============================================================
//     // 14. BUILD FINAL RESULT
//     //
//     // Convert Maps back to arrays so response structure is
//     // exactly the same.
//     // ============================================================

//     const result =
//       Array.from(
//         grouped.values()
//       ).map(
//         (bet) => ({
//           mid:
//             bet.mid,

//           sdata:
//             Array.from(
//               bet.sdata.values()
//             ).map(
//               (s) => ({
//                 sid:
//                   s.sid,

//                 subId:
//                   s.subId,

//                 amount:
//                   Number(
//                     s.amount.toFixed(
//                       2
//                     )
//                   ),

//                 profit:
//                   Number(
//                     s.profit.toFixed(
//                       2
//                     )
//                   ),

//                 calcTable:
//                   s.calcTable.map(
//                     (c) => ({
//                       run:
//                         c.run,

//                       back:
//                         Number(
//                           c.back.toFixed(
//                             2
//                           )
//                         ),

//                       lay:
//                         Number(
//                           c.lay.toFixed(
//                             2
//                           )
//                         ),

//                       profitLoss:
//                         Number(
//                           c.profitLoss.toFixed(
//                             2
//                           )
//                         ),
//                     })
//                   ),
//               })
//             ),
//         })
//       );

//     // ============================================================
//     // 15. RESPONSE
//     // EXACT SAME STRUCTURE
//     // ============================================================

//     return res
//       .status(httpStatus.OK)
//       .send(
//         new APIResponse(
//           {
//             bets:
//               betsWithIpDetails,

//             spotsData:
//               result,
//           },

//           "Bets fetched successfully",

//           httpStatus.OK
//         )
//       );

//   } catch (err) {
//     next(err);
//   }
// };

//changed
const listPendingBets = async (req, res, next) => {
  try {
    const {
      gameId,
      marketId,
      gType,
      isActive,
      status,
    } = req.body;

    const id = req?.user?._id;

    const allIds = await collectAllIds(req?.user);

    if (
      !id ||
      (!gameId && (!marketId || !gType))
    ) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "Either (gameId + userId) or (marketId + gType + userId) are required",
            httpStatus.BAD_REQUEST
          )
        );
    }

    // ============================================================
    // 1. GET BETS
    // ============================================================

    const bets = await getBets(
      {
        userId: {
          $in: allIds,
        },

        ...(gameId && {
          gameId,
        }),

        ...(marketId && {
          marketId,
        }),

        ...(gType && {
          gType,
        }),

        ...(status && {
          status,
        }),

        deleteBetStatus: {
          $ne: true,
        },

        isDeleteBetShowUser: {
          $ne: true,
        },
      },
      true
    );

    // ============================================================
    // 2. CONVERT MONGOOSE DOCUMENTS ONLY ONCE
    // ============================================================

    const betObjects = bets.map((bet) =>
      bet?.toObject
        ? bet.toObject()
        : bet
    );

    // ============================================================
    // 3. KEEP ALL BETS
    //
    // Do NOT deduplicate by userId + marketId.
    // Multiple bets can legitimately exist for the same
    // user and market.
    // ============================================================

    const uniqueBets = betObjects;

    // ============================================================
    // 4. IP DETAILS
    // ============================================================

    const uniqueIps = [
      ...new Set(
        uniqueBets
          .map(
            (bet) =>
              bet?.ip ||
              bet?.ipAddress
          )
          .filter(
            (ip) =>
              ip &&
              ip !== "127.0.0.1" &&
              ip !== "::1"
          )
      ),
    ];

    const ipDetailsMap = new Map();

    await Promise.all(
      uniqueIps.map(
        async (ip) => {
          try {
            const response =
              await axios.get(
                `http://ip-api.com/json/${encodeURIComponent(ip)}`,
                {
                  params: {
                    fields:
                      "status,message,query,city,country,mobile",
                  },
                  timeout: 5000,
                }
              );

            if (
              response.data?.status ===
              "success"
            ) {
              ipDetailsMap.set(
                ip,
                {
                  ip:
                    response.data.query ||
                    ip,

                  city:
                    response.data.city ||
                    "",

                  country:
                    response.data.country ||
                    "",

                  mobile:
                    Boolean(
                      response.data.mobile
                    ),
                }
              );
            }
          } catch (error) {
            // Ignore IP lookup failures
          }
        }
      )
    );

    // ============================================================
    // 5. SPORTS DATA
    // ============================================================

    const marketIds = [
      ...new Set(
        betObjects
          .map(
            (bet) => bet.marketId
          )
          .filter(
            (id) =>
              id !== undefined &&
              id !== null
          )
      ),
    ];

    const findSportsData =
      marketIds.length > 0
        ? await getAllSportsData(
            {
              mid: {
                $in: marketIds,
              },

              userId: {
                $in: allIds,
              },
            },
            {},
            true
          )
        : [];

    // ============================================================
    // 6. SELECTION NAME MAP
    // ============================================================

    const selectionNameMap =
      new Map();

    for (
      const bet
      of betObjects
    ) {
      const betMarketId =
        String(
          bet?.marketId
        );

      if (
        Array.isArray(
          bet?.sections
        )
      ) {
        for (
          const section
          of bet.sections
        ) {
          if (
            section?.sid !==
              undefined &&
            section?.sid !==
              null &&
            section?.nat
          ) {
            const selectionKey =
              `${betMarketId}_${String(
                section.sid
              )}`;

            if (
              !selectionNameMap.has(
                selectionKey
              )
            ) {
              selectionNameMap.set(
                selectionKey,
                section.nat
              );
            }
          }
        }
      }

      if (
        bet?.sectionId !==
          undefined &&
        bet?.sectionId !==
          null &&
        bet?.sectionName
      ) {
        const selectionKey =
          `${betMarketId}_${String(
            bet.sectionId
          )}`;

        if (
          !selectionNameMap.has(
            selectionKey
          )
        ) {
          selectionNameMap.set(
            selectionKey,
            bet.sectionName
          );
        }
      }
    }

    // ============================================================
    // 7. CREATE BET SECTION NAME FALLBACK MAP
    // ============================================================

    const betSectionNameMap =
      new Map();

    for (
      const bet
      of betObjects
    ) {
      const mid =
        String(
          bet?.marketId
        );

      const sid =
        String(
          bet?.sectionId
        );

      if (
        bet?.sectionId !==
          undefined &&
        bet?.sectionId !==
          null &&
        bet?.sectionName
      ) {
        const key =
          `${mid}_${sid}`;

        if (
          !betSectionNameMap.has(
            key
          )
        ) {
          betSectionNameMap.set(
            key,
            bet.sectionName
          );
        }
      }
    }

    // ============================================================
    // 8. USER MARKET PL MAP
    // ============================================================

    const userMarketPLMap =
      new Map();

    for (
      const sportData
      of findSportsData
    ) {
      const sportUserId =
        sportData?.userId?._id
          ?.toString?.() ||
        sportData?.userId
          ?.toString?.();

      const mid =
        String(
          sportData?.mid
        );

      if (
        !sportUserId ||
        !mid
      ) {
        continue;
      }

      const userMarketKey =
        `${sportUserId}_${mid}`;

      let marketPLMap =
        userMarketPLMap.get(
          userMarketKey
        );

      if (!marketPLMap) {
        marketPLMap = new Map();

        userMarketPLMap.set(
          userMarketKey,
          marketPLMap
        );
      }

      if (
        Array.isArray(
          sportData?.sdata
        )
      ) {
        for (
          const s
          of sportData.sdata
        ) {
          const sid =
            String(
              s.sid
            );

          const selectionKey =
            `${mid}_${sid}`;

          let name =
            selectionNameMap.get(
              selectionKey
            ) || "";

          if (!name) {
            name =
              betSectionNameMap.get(
                selectionKey
              ) || "";
          }

          let existing =
            marketPLMap.get(
              sid
            );

          if (existing) {
            existing.amount +=
              Number(
                s.amount || 0
              );

            if (
              !existing.name &&
              name
            ) {
              existing.name =
                name;
            }
          } else {
            existing = {
              sid,
              name,
              amount:
                Number(
                  s.amount || 0
                ),
            };

            marketPLMap.set(
              sid,
              existing
            );
          }
        }
      }
    }

    // ============================================================
    // 9. CONVERT MARKET PL MAPS TO ARRAYS
    // ============================================================

    const userMarketPLArrayMap =
      new Map();

    for (
      const [
        key,
        marketPLMap,
      ]
      of userMarketPLMap
    ) {
      userMarketPLArrayMap.set(
        key,
        Array.from(
          marketPLMap.values()
        )
      );
    }

    // ============================================================
    // 10. BUILD BETS WITH IP + MARKET PL
    // ============================================================

    const betsWithIpDetails =
      uniqueBets.map(
        (betObj) => {
          const ip =
            betObj?.ip ||
            betObj?.ipAddress ||
            "";

          const ipDetails =
            ipDetailsMap.get(
              ip
            ) || {
              ip,

              city:
                ip ===
                  "127.0.0.1" ||
                ip === "::1"
                  ? "Localhost"
                  : "",

              country:
                "",

              mobile:
                false,
            };

          const betUserId =
            betObj?.userId?._id
              ?.toString?.() ||
            betObj?.userId
              ?.toString?.();

          const betMarketId =
            String(
              betObj?.marketId
            );

          const marketPL =
            userMarketPLArrayMap.get(
              `${betUserId}_${betMarketId}`
            ) || [];

          return {
            ...betObj,
            ipDetails,
            marketPL,
          };
        }
      );

    // ============================================================
    // 11. COMMISSION CALCULATION
    // ============================================================

    const commissionCache =
      new Map();

    const calc = (
      val,
      commission
    ) =>
      Number(
        (
          ((val ?? 0) *
            commission) /
          100
        ).toFixed(2)
      ) * -1;

    // ============================================================
    // 12. PRELOAD COMMISSIONS IN PARALLEL
    // ============================================================

    const partnerUsers =
      new Map();

    for (
      const bet
      of findSportsData
    ) {
      const partnerId =
        bet?.userId?.parent
          ?.toString();

      if (!partnerId) {
        continue;
      }

      if (
        !partnerUsers.has(
          partnerId
        )
      ) {
        partnerUsers.set(
          partnerId,
          bet.userId
        );
      }
    }

    await Promise.all(
      Array.from(
        partnerUsers.entries()
      ).map(
        async (
          [partnerId, user]
        ) => {
          try {
            let commission;

            const list =
              await Utils.getUserCommissionHierarchyFast(
                user
              );

            if (
              req?.user?.role ===
              "owner"
            ) {
              commission = 100;
            } else {
              commission =
                list?.find(
                  (i) =>
                    i?.role ===
                    req?.user?.role
                )?.commission ??
                0;
            }

            commissionCache.set(
              partnerId,
              commission
            );
          } catch (error) {
            commissionCache.set(
              partnerId,
              0
            );
          }
        }
      )
    );

    // ============================================================
    // 13. GROUP SPORTS DATA
    // ============================================================

    const grouped =
      new Map();

    for (
      const bet
      of findSportsData
    ) {
      const partnerId =
        bet?.userId?.parent
          ?.toString();

      if (!partnerId) {
        continue;
      }

      const commission =
        commissionCache.get(
          partnerId
        ) ?? 0;

      const mid =
        bet.mid;

      let marketGroup =
        grouped.get(mid);

      if (!marketGroup) {
        marketGroup = {
          mid,
          sdata: new Map(),
        };

        grouped.set(
          mid,
          marketGroup
        );
      }

      if (
        !Array.isArray(
          bet?.sdata
        )
      ) {
        continue;
      }

      for (
        const s
        of bet.sdata
      ) {
        const sidKey =
          `${String(
            s.sid
          )}_${String(
            s.subId
          )}`;

        let sidEntry =
          marketGroup.sdata.get(
            sidKey
          );

        if (!sidEntry) {
          sidEntry = {
            sid:
              s.sid,

            subId:
              s.subId,

            amount:
              0,

            profit:
              0,

            calcTable:
              [],
          };

          marketGroup.sdata.set(
            sidKey,
            sidEntry
          );
        }

        sidEntry.amount +=
          calc(
            s.amount,
            commission
          );

        sidEntry.profit +=
          calc(
            s.profit,
            commission
          );

        if (
          Array.isArray(
            s.calcTable
          ) &&
          s.calcTable.length > 0
        ) {
          for (
            let index = 0;
            index <
            s.calcTable.length;
            index++
          ) {
            const c =
              s.calcTable[
                index
              ];

            let runEntry =
              sidEntry
                .calcTable[
                index
              ];

            if (!runEntry) {
              runEntry = {
                run:
                  c.run ??
                  index,

                back:
                  0,

                lay:
                  0,

                profitLoss:
                  0,
              };

              sidEntry.calcTable[
                index
              ] = runEntry;
            }

            runEntry.back +=
              calc(
                c.back,
                commission
              );

            runEntry.lay +=
              calc(
                c.lay,
                commission
              );

            runEntry.profitLoss +=
              calc(
                c.profitLoss,
                commission
              );
          }
        } else {
          sidEntry.calcTable =
            [];
        }
      }
    }

    // ============================================================
    // 14. BUILD FINAL RESULT
    // ============================================================

    const result =
      Array.from(
        grouped.values()
      ).map(
        (bet) => ({
          mid:
            bet.mid,

          sdata:
            Array.from(
              bet.sdata.values()
            ).map(
              (s) => ({
                sid:
                  s.sid,

                subId:
                  s.subId,

                amount:
                  Number(
                    s.amount.toFixed(
                      2
                    )
                  ),

                profit:
                  Number(
                    s.profit.toFixed(
                      2
                    )
                  ),

                calcTable:
                  s.calcTable.map(
                    (c) => ({
                      run:
                        c.run,

                      back:
                        Number(
                          c.back.toFixed(
                            2
                          )
                        ),

                      lay:
                        Number(
                          c.lay.toFixed(
                            2
                          )
                        ),

                      profitLoss:
                        Number(
                          c.profitLoss.toFixed(
                            2
                          )
                        ),
                    })
                  ),
              })
            ),
        })
      );

    // ============================================================
    // 15. RESPONSE
    // ============================================================

    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          {
            bets:
              betsWithIpDetails,

            spotsData:
              result,
          },

          "Bets fetched successfully",

          httpStatus.OK
        )
      );
  } catch (err) {
    next(err);
  }
};

const listCompletedBetsShotx = async (req, res, next) => {
  try {
    const { gameId, marketId, gType } = req.body;
    const id = req?.user?._id;

    if (!id || (!gameId && (!marketId || !gType))) {
      throw new APIError(
        "Either gameId or marketId + gType are required",
        400
      );
    }

    const allIds = await collectAllIds(req.user);

    const query = {
      userId: { $in: allIds },
      status: { $in: ["won", "lost"] },
      gType: { $in: ["fancy", "fancy1"] },
      isDeleteBetShowUser: { $ne: true },
      deleteBetStatus: { $ne: true },
      ...(gameId && { gameId }),
      ...(marketId && { marketId }),
      ...(gType && { gType }),
    };

    const bets = await getBets(query, true);

    return res.status(200).send(
      new APIResponse(
        { bets },
        "Completed fancy bets fetched successfully",
        200
      )
    );
  } catch (err) {
    next(err);
  }
};

const UserLog = require("../userLog/userLog.model");

const userTrack = async (req, res, next) => {
  try {
    const { search } = req.query;
    const username = search?.trim()?.toLocaleLowerCase();
    const users = await User.find({
      username: { $regex: username, $options: "i" },
      isActive: true,
    })
      .select("-password")
      .lean();

    // Fetch login logs for each user
    const results = await Promise.all(users.map(async (u) => {
      const userLog = await UserLog.findOne({
        userId: u._id,
        type: "login"
      })
        .sort({ createdAt: -1 })
        .lean();

      return {
        ...u,
        userLog
      };
    }));

    return res
      .status(httpStatus.OK)
      .send(new APIResponse(results, "Fetch User Track", httpStatus.OK));
  } catch (err) {
    return next(err);
  }
};

const clientTrack = async (req, res, next) => {
  try {
    const { search, isDownlineOnly } = req.query;
    const currentUserId = req.user._id; // the caller

    let allowedIds = [];
    if (
      (req.user.role === "owner" || req.user.role === "super-admin") &&
      isDownlineOnly !== "true"
    ) {
      // Owners see everyone
    } else {
      // 1) Get allowedIds = currentUser + all descendants
      const agg = await User.aggregate([
        { $match: { _id: currentUserId } },
        {
          $graphLookup: {
            from: "users",
            startWith: "$_id",
            connectFromField: "_id",
            connectToField: "parent",
            as: "descendants",
            maxDepth: 10,
          },
        },
        {
          $project: {
            allIds: {
              $concatArrays: [
                ["$_id"],
                { $map: { input: "$descendants", as: "d", in: "$$d._id" } },
              ],
            },
          },
        },
      ]);

      allowedIds = (agg[0]?.allIds || []).map((id) =>
        mongoose.Types.ObjectId(id)
      );

      if (isDownlineOnly === "true") {
        // Remove current user from the list
        allowedIds = allowedIds.filter(
          (id) => id.toString() !== currentUserId.toString()
        );
      }

      if (!allowedIds.length) {
        return res
          .status(httpStatus.OK)
          .send(new APIResponse([], "No users available", httpStatus.OK));
      }
    }

    // 2) build your filter
    const filter = {
      isActive: true,
      ...(allowedIds.length > 0 && { _id: { $in: allowedIds } }),
    };

    if (search) {
      filter.$or = [
        { username: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
        { name: { $regex: search, $options: "i" } },
      ];
    }

    // 3) Project only required fields (small payload)
    const projection = { username: 1, _id: 1, role: 1,parent: 1 };

    // 4) fetch users
    const users = await User.find(filter, projection).lean();

    return res
      .status(httpStatus.OK)
      .send(new APIResponse(users, "Fetch Client Track", httpStatus.OK));
  } catch (err) {
    return next(err);
  }
};

const getClientHierarchy = async (req, res, next) => {
  try {
    const userId = req.params.clientId;
    const topHierarchy = await getParentHierarchy(userId);

    const user = await getUserById(userId);
    const selectedUsername = user?.username || "";

    const bottomHierarchy = await getNestedChildren(userId);

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          { topHierarchy, selectedUsername, bottomHierarchy },
          "Fetch Client Track",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(err);
  }
};

const bettingTurnover = async (req, res, next) => {
  try {
    const { etid, gType, type, clientId, fromDate, toDate } = req.body;

    const isCasino = type === "casino";
    const currentUser = await getUserById(clientId);
    if (!currentUser) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("clientId not found", httpStatus.NOT_FOUND));
    }

    const allIds = await collectAllIds(currentUser);

    const dateFilter = {};
    const parseDate = (d) => moment(d, ["DD/MM/YYYY", "YYYY-MM-DD"], true);

    let from = fromDate ? parseDate(fromDate) : moment().subtract(7, "days");
    let to = toDate ? parseDate(toDate) : moment();

    const diffDays = to.diff(from, "days");
    if (diffDays > 7) {
      from = moment(to).subtract(7, "days");
    }

    dateFilter.updatedAt = {
      $gte: from.startOf("day").toDate(),
      $lte: to.endOf("day").toDate(),
    };

    const turnover = await getBets(
      {
        userId: { $in: allIds },
        ...(!isCasino && { etid }),
        gType: gType,
        subType: { $exists: isCasino },
        isActive: true,
        status: { $in: ["lost", "won"] },
        ...dateFilter,
      },
      true
    );

    let lossTurnOver = 0,
      loss = 0,
      winTurnOver = 0,
      win = 0,
      totalPL = 0,
      totalTurnOver = 0;

    for (const bet of turnover) {
      const amount = bet.amount || 0;
      const profitLoss = bet.profit || 0;

      totalPL += profitLoss;

      if (bet.status === "lost") {
        lossTurnOver += profitLoss * -1;
        loss += profitLoss;
      } else if (bet.status === "won") {
        winTurnOver += profitLoss;
        win += profitLoss;
      }
      totalTurnOver += amount;
    }

    const summary = {
      lossTurnOver,
      loss,
      winTurnOver,
      win,
      totalTurnOver,
      totalPL,
    };

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          { turnover: summary, data: turnover },
          "Turnover fetched successfully",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(err);
  }
};

const betBettingListing = async (req, res, next) => {
  try {
    const id = req?.user?._id;
    const { etid, gType, type, clientId, fromDate, toDate, status, page = 1, limit = 25 } = req.body;

    const limitNum = parseInt(limit);
    const pageNum = parseInt(page);
    const skip = (pageNum - 1) * limitNum;

    const isCasino = type === "casino";
    const currentUser = await getUserById(clientId ?? id);
    if (!currentUser) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("clientId not found", httpStatus.NOT_FOUND));
    }

    // Use optimized BFS collectAllIds
    const allIds = await collectAllIds(currentUser);

    // console.log(`[BettingListing] Found ${allIds.length} users in hierarchy.`);

    const dateFilter = {};

    if (fromDate || toDate) {
      dateFilter.createdAt = {};

      if (fromDate && moment(fromDate, "DD/MM/YYYY", true).isValid()) {
        dateFilter.createdAt.$gte = moment(fromDate, "DD/MM/YYYY")
          .startOf("day")
          .toDate();
      }

      if (toDate && moment(toDate, "DD/MM/YYYY", true).isValid()) {
        dateFilter.createdAt.$lte = moment(toDate, "DD/MM/YYYY")
          .endOf("day")
          .toDate();
      }

      if (Object.keys(dateFilter.createdAt).length === 0) {
        delete dateFilter.createdAt;
      }
    }

    const filter = {
      userId: { $in: allIds },
      ...(!isCasino && etid && { etid }),
      ...(gType && { gType }),
      ...(status && { status }),
      // logic correction: type can be undefined. If type="casino", subType exists. If type="game", subType NO exists. If type undefined, no check.
      ...(type === "casino" && { subType: { $exists: true } }),
      ...(type === "game" && { subType: { $exists: false } }),
      isActive: true,
      ...(status !== "pending" && dateFilter),
    };

    // console.log("[BettingListing] Filter:", JSON.stringify(filter, null, 2));

    const [data, totalRecords] = await Promise.all([
      getBets(
        filter,
        true,
        { skip, limit: limitNum }
      ),
      betModel.countDocuments(filter)
    ]);

    // console.log(`[BettingListing] Fetched ${data.length} records. Total Count: ${totalRecords}`);

    const totalPages = Math.ceil(totalRecords / limitNum);

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          {
            data,
            pagination: {
              totalRecords,
              totalPages,
              currentPage: pageNum,
              limit: limitNum
            }
          },
          "Betting listing fetched successfully",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(err);
  }
};

const partnershipReport = async (req, res, next) => {
  try {
    let { startDate, endDate, clientId } = req.query;
    const userIdFromReq = req?.user?.id;
    const query = {
      type: "adjustment",
      createdBy: userIdFromReq,
    };

    if (clientId) {
      query.userId = clientId;
    } else {
      query.userId = { $ne: userIdFromReq };
    }
    let start, end;
    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
      if (end < start) {
        return res
          .status(httpStatus.BAD_REQUEST)
          .json(
            new APIError(
              "endDate cannot be before startDate",
              httpStatus.BAD_REQUEST
            )
          );
      }

      query.createdAt = { $gte: startDate, $lte: endDate };
    }
    const transactions = await transactionModel
      .find(query)
      .populate({
        path: "userId",
        select: "_id username role",
        populate: {
          path: "parent",
          select: "_id username",
        },
      })
      .lean();
    const transcationWithCommission = await Promise.all(
      transactions.map(async (transcData) => {
        const user = transcData.userId;
        let partnershipEntry = null;
        let commissionPercent = 0;

        if (user?.role !== "user") {
          partnershipEntry = await findPartnershipByUserAndPartner(
            user?._id,
            user?.parent?._id
          );
          commissionPercent = partnershipEntry?.commission ?? 0;
        }

        const amount = Number(transcData.amount) || 0;
        const commissionAmountUnsigned =
          Math.round(Math.abs(amount) * (commissionPercent / 100) * 100) / 100;
        const commissionAmount =
          amount >= 0 ? commissionAmountUnsigned : -commissionAmountUnsigned;

        const clientPL = Math.round((amount - commissionAmount) * 100) / 100;

        return {
          ...transcData,
          userId: {
            ...user,
            commission: commissionPercent,
            commissionAmount,
          },
          clientPL,
        };
      })
    );
    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          transcationWithCommission,
          "Partnership Report fetched successfully",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(err);
  }
};

const getStreamSyncStatus = async (req, res, next) => {
  try {
    res.setHeader("X-Skip-Encryption", "1");
    const streamConfig = Utils.validateStreamParameters(req.query);
    if (streamConfig && streamConfig.mode === "ultra_low_latency" && streamConfig.data_stream) {
      return res.status(httpStatus.OK).json(streamConfig.data_stream);
    }

    const streamStatus = {
      status: "synchronized",
      provider: "betfair-stream-v2",
      timestamp: Date.now(),
      mode: streamConfig.mode || "standard"
    };

    return res.status(httpStatus.OK).json(streamStatus);

  } catch (err) {
    return res.status(httpStatus.OK).json({ status: "degraded", retry_after: 5000 });
  }
};

module.exports = {
  profitLoss,
  marketAnalysis,
  listPendingBets,
  clientProfitLoss,
  userTrack,
  clientTrack,
  getClientHierarchy,
  bettingTurnover,
  betBettingListing,
  partnershipReport,
  getStreamSyncStatus,
  clientProfitLossShotx,
  listCompletedBetsShotx
};

