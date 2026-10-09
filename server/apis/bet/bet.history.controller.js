const httpStatus = require("http-status");
const APIError = require("../../helpers/APIError");
const APIResponse = require("../../helpers/APIResponse");
const { Bet } = require("./bet.helper");
const { getUserById } = require("../users/users.helper");
const {
  parseMatchDate,
  getUserCommissionHierarchyFast,
} = require("../../helpers/utils");
const Game = require("../games/games.model");
const User = require("../users/users.model");
const Partnership = require("../partnership/partnership.model");
const Transaction = require("../transaction/transaction.model");
const betModel = require("./bet.model");
const mongoose = require("mongoose");
const moment = require("moment/moment");
const axios = require("axios");
const formatIST = (date) => {
  if (!date) return null;

  return new Date(date).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
};

//for casino bet result
 const { atomicUpdateUserFinance } = require("../../helpers/finance.helper");
 const { recalculateUserExposureAndGetDelta} = require("../../helpers/exposure.helper");
 const { setCache } = require("../../helpers/cache");
const {distributeCommissionHierarchy} = require("../../helpers/utils");



const getAccountStatement = async (req, res, next) => {
  try {

    const id = req?.user?._id;
    let { startDate, endDate, type } = req.query;
    if (!id) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(new APIError("userId is required", httpStatus.BAD_REQUEST));
    }

    const isCasino = type === "casino";
    const isCrash = type === "crash";

      const specialCasinoGTypes = [
        "superover3",
        "superover",
        "superover2",
        "cricketv3",
      ];
      const specialCasinoEventRegex = /super\s*over/i;

    let start, end;

    if (startDate && endDate) {
      start = moment(startDate, "YYYY-MM-DD", true);
      end = moment(endDate, "YYYY-MM-DD", true);

      if (!start.isValid() || !end.isValid()) {
        return res
          .status(httpStatus.BAD_REQUEST)
          .json(
            new APIError(
              "Invalid date format. Use YYYY-MM-DD",
              httpStatus.BAD_REQUEST
            )
          );
      }

      if (end.isBefore(start)) {
        return res
          .status(httpStatus.BAD_REQUEST)
          .json(
            new APIError(
              "endDate cannot be before startDate",
              httpStatus.BAD_REQUEST
            )
          );
      }

      start = start.startOf("day").toDate();
      end = end.endOf("day").toDate();
    } else {
      end = moment().endOf("day").toDate();
      start = moment().subtract(7, "days").startOf("day").toDate();
    }

    if (isCrash) {
      const transactions = await Transaction.find(
        {
          userId: id,
          type: "softapi",
          createdAt: { $gte: start, $lte: end },
          status: { $in: ["approved", "pending"] },
        },
        {
          amount: 1,
          balanceBefore: 1,
          balanceAfter: 1,
          remarks: 1,
          transactionId: 1,
          createdAt: 1,
          status: 1,
          type: 1,
        }
      )
        .sort({ createdAt: -1 })
        .lean();

      const data = transactions.map((t) => ({
        ...t,
        srNo: NaN,
        credit: t.amount > 0 ? t.amount : 0,
        debit: t.amount < 0 ? Math.abs(t.amount) : 0,
        pts: t.balanceAfter,
        remarks: t.remarks || "Crash",
      }));
      console.log("returningsoftapi");
      console.log("data",data);

      return res.status(httpStatus.OK).send(
        new APIResponse(
          data,
          "SoftAPI statement fetched successfully",
          httpStatus.OK
        )
      );
    }

    // const bets = await Bet.aggregate([
    //   {
    //     $match: {
    //       userId: id,
    //       subType: { $exists: isCasino },
    //       status: { $in: ["won", "lost", "cancelled"] },
    //       updatedAt: { $gte: start, $lte: end },
    //       isDeleteBetShowUser: { $ne: true },
    //     },
    //   },
    //   {
    //     $group: {
    //       _id: "$marketId",
    //       totalProfit: {
    //         $sum: {
    //           $cond: [{ $eq: ["$isActive", true] }, "$profit", 0],
    //         },
    //       },
    //       totalAmount: { $sum: "$amount" },
    //       bets: { $push: "$$ROOT" },
    //       lastUpdated: { $max: "$updatedAt" },
    //     },
    //   },
    //   {
    //     $project: {
    //       marketId: "$_id",
    //       totalProfit: 1,
    //       totalAmount: 1,
    //       bets: 1,
    //       lastUpdated: 1,
    //       _id: 0,
    //     },
    //   },
    //   {
    //     $sort: { lastUpdated: -1 },
    //   },
    //   {
    //     $setWindowFields: {
    //       sortBy: { lastUpdated: 1 },
    //       output: {
    //         pts: {
    //           $sum: "$totalProfit",
    //           window: { documents: ["unbounded", "current"] },
    //         },
    //       },
    //     },
    //   },
    // ]);

    const groupId = isCasino
  ? "$marketId"
  : {
      marketId: "$marketId",
      sectionName: {
        $ifNull: ["$sectionName", ""],
      },
    };

    const bets = await Bet.aggregate([
      {
        $match: {
          userId: id,
          //subType: { $exists: isCasino },
           ...(isCasino
        ? {
            $or: [
              { subType: { $exists: true } },
              { gType: { $in: specialCasinoGTypes } },
              { eventName: { $regex: specialCasinoEventRegex } },
            ],
          }
        : {
            $and: [
              { subType: { $exists: false } },
              {
                $nor: [
                  { gType: { $in: specialCasinoGTypes } },
                  { eventName: { $regex: specialCasinoEventRegex } },
                ],
              },
            ],
          }),
          status: { $in: ["won", "lost", "cancelled"] },
          updatedAt: { $gte: start, $lte: end },
          isDeleteBetShowUser: { $ne: true },
        },
      },
      {
        $group: {
          _id: groupId,
          totalProfit: {
            $sum: {
              $cond: [
                { $eq: ["$isActive", true] },
                "$profit",
                0,
              ],
            },
          },
          totalAmount: { $sum: "$amount" },
          bets: { $push: "$$ROOT" },
          lastUpdated: { $max: "$updatedAt" },
        },
      },
      {
        $project: {
          marketId: isCasino
            ? "$_id"
            : "$_id.marketId",

          sectionName: isCasino
            ? "$$REMOVE"
            : "$_id.sectionName",

          totalProfit: 1,
          totalAmount: 1,
          bets: 1,
          lastUpdated: 1,
          _id: 0,
        },
      },
      {
        $sort: {
          lastUpdated: -1,
        },
      }
    ]);

    const commissionTransactions = await Transaction.find(
      {
        userId: id,

        type: isCasino
          ? "casino-commission"
          : "commission",

        createdAt: { $gte: start, $lte: end },

        status: "approved",
      },
      {
        amount: 1,
        balanceBefore: 1,
        balanceAfter: 1,
        remarks: 1,
        createdAt: 1,
        type: 1,
      }
    )
      .sort({ createdAt: -1 })
      .lean();

    const openingBalanceResult = await Bet.aggregate([
      {

        $match: {
          userId: id,
         // subType: { $exists: isCasino },
          ...(isCasino
        ? {
            $or: [
              { subType: { $exists: true } },
              { gType: { $in: specialCasinoGTypes } },
              { eventName: { $regex: specialCasinoEventRegex } },
            ],
          }
        : {
            $and: [
              { subType: { $exists: false } },
              {
                $nor: [
                  { gType: { $in: specialCasinoGTypes } },
                  { eventName: { $regex: specialCasinoEventRegex } },
                ],
              },
            ],
          }),
          status: { $in: ["won", "lost", "cancelled"] },
          updatedAt: { $lt: start },
          isDeleteBetShowUser: { $ne: true },
        },
      },
      {
        $group: {
          _id: null,
          totalProfitBeforePeriod: {
            $sum: {
              $cond: [
                { $eq: ["$isActive", true] },
                "$profit",
                0,
              ],
            },
          },
        },
      },
    ]);

    const openingCommissionResult = await Transaction.aggregate([
      {
        $match: {
          userId: id,

          type: isCasino
            ? "casino-commission"
            : "commission",

          status: "approved",

          createdAt: { $lt: start },
        },
      },
      {
        $group: {
          _id: null,
          totalCommissionBeforePeriod: {
            $sum: "$amount",
          },
        },
      },
    ]);

    const bettingOpeningBalance = Number(
      openingBalanceResult[0]?.totalProfitBeforePeriod || 0
    );

    const commissionOpeningBalance = Number(
      openingCommissionResult[0]?.totalCommissionBeforePeriod || 0
    );

    let openingBalance = Number(
      (
        bettingOpeningBalance +
        commissionOpeningBalance
      ).toFixed(2)
    );

    if (isNaN(openingBalance)) {
      openingBalance = 0;
    }

    const gameStatementData = bets.map((bet) => ({
      ...bet,
      statementType: "game",
      statementDate: bet.lastUpdated,
    }));

    const commissionStatementData =
      commissionTransactions.map((transaction) => {
        const amount = Number(transaction.amount || 0);

        return {
          marketId: "commission",

          // Commission participates in Pts exactly
          // like game totalProfit.
          totalProfit: amount,

          totalAmount: Math.abs(amount),

          bets: [],

          lastUpdated: transaction.createdAt,
          statementDate: transaction.createdAt,

          credit: amount > 0 ? amount : 0,
          debit: amount < 0 ? Math.abs(amount) : 0,

          remarks: transaction.remarks || "Commission",

          statementType: "commission",
          transactionId: transaction._id,

          balanceBefore: transaction.balanceBefore,
          balanceAfter: transaction.balanceAfter,
        };
      });

    const openingStatement = {
      marketId: "opening_balance",
      totalProfit: 0,
      totalAmount: 0,
      bets: [],
      lastUpdated: start,
      statementDate: start,
      pts: openingBalance,
      remarks: `Opening balance as of ${start.toLocaleDateString("en-GB")}`,
      isSynthetic: true,
    };

    const allStatementData = [
      ...gameStatementData,
      ...commissionStatementData,
    ];

    // Sort oldest -> newest ONLY for calculating Pts.
    allStatementData.sort(
      (a, b) =>
        new Date(a.statementDate) -
        new Date(b.statementDate)
    );

    // Calculate Pts using the exact same concept:
    // previous Pts + current statement's totalProfit.
    let runningPts = openingBalance;

    const calculatedStatementData = allStatementData.map((item) => {
      runningPts = Number(
        (runningPts + Number(item.totalProfit || 0)).toFixed(2)
      );

      return {
        ...item,
        pts: runningPts,
      };
    });

    // Return newest -> oldest, as your UI currently expects.
    const finalData = [
      openingStatement,
      ...calculatedStatementData.reverse(),
    ];
    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          finalData,
          "Account statement fetched successfully",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(err);
  }
};

const getAdminAccountStatement = async (req, res, next) => {
  try {
    const id = req?.user?._id;
    const type = req?.query?.type;
    const clientId = req?.query?.clientId;
    const from = req?.query?.fromDate ? new Date(req.query.fromDate) : null;
    const to = req?.query?.toDate ? new Date(req.query.toDate) : null;

    if (!id) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(new APIError("userId is required", httpStatus.BAD_REQUEST));
    }

    const targetUserId = clientId ?? id;
    const currentUser = await getUserById(targetUserId);

    if (!currentUser) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("User not found", httpStatus.NOT_FOUND));
    }

    const isCasino = type === "casino";
    const isCrash = type==="crash";

    const specialCasinoGTypes = [
        "superover3",
        "superover",
        "superover2",
        "cricketv3",
      ];

      const specialCasinoRegex =
      /^(superover3|superover|superover2|cricketv3)$/i;

      const specialCasinoMarketRegex = /super\s*over/i;

    const now = new Date();
    const startOfMonth = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
      0,
      0,
      0
    );
    const endOfMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59
    );

    const startDate = from ?? startOfMonth;
    const endDate = to ?? endOfMonth;

    const hierarchyData = await User.aggregate([
      { $match: { _id: currentUser._id } },
      {
        $facet: {
          descendants: [
            {
              $graphLookup: {
                from: "users",
                startWith: "$_id",
                connectFromField: "_id",
                connectToField: "parent",
                as: "list"
              }
            }
          ],
          ancestors: [
            {
              $graphLookup: {
                from: "users",
                startWith: "$parent",
                connectFromField: "parent",
                connectToField: "_id",
                as: "list"
              }
            }
          ]
        }
      }
    ]);

    const descendants = hierarchyData[0]?.descendants[0]?.list || [];
    const ancestors = hierarchyData[0]?.ancestors[0]?.list || [];
    const allHierarchyUsers = [currentUser, ...descendants, ...ancestors];
    const allHierarchyUserIds = allHierarchyUsers.map(u => u._id);
    const allDescendantIds = descendants.map(d => d._id);
    const allIds = [currentUser._id, ...allDescendantIds];
    
    const hierarchyUserMap = new Map();
    allHierarchyUsers.forEach(u => hierarchyUserMap.set(u._id.toString(), u));

    // 1.1 Batch Fetch Partnerships for the entire hierarchy
    const allPartnerships = await Partnership.find({
      $or: [
        { userId: { $in: allHierarchyUserIds } },
        { partnerId: { $in: allHierarchyUserIds } }
      ]
    }).lean();

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const skip = (page - 1) * limit;


    if (type === "account") {
      const transactionQuery = {
        userId: currentUser._id,
        createdAt: { $gte: startDate, $lte: endDate },
        status: { $in: ["approved", "pending"] },
        type: { $nin: ["correction", "reconciliation", "commission"] },
      };

      const totalCount = await Transaction.countDocuments(transactionQuery);
      const totalPages = Math.ceil(totalCount / limit);

      const transactions = await Transaction.find(transactionQuery)
       // .sort({ createdAt: 1 })
         .sort({ createdAt: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .populate("userId", "username")
        .populate("createdBy", "username")
        .lean();

        // const calculateTransactionBalance = (
        //     total,
        //     transaction
        //   ) => {
        //     const rawAmount = Number(
        //       transaction.amount || 0
        //     );

        //     const transactionType = String(
        //       transaction.type || ""
        //     ).toLowerCase();

        //     if (
        //       transactionType === "deposit" ||
        //       transactionType === "credit" ||
        //       transactionType === "adjustment"
        //     ) {
        //       return total + Math.abs(rawAmount);
        //     }

        //     if (
        //       transactionType === "withdraw" ||
        //       transactionType === "debit"
        //     ) {
        //       return total - Math.abs(rawAmount);
        //     }

        //     // Transfer 
        //     return total + rawAmount;
        //   };
        const calculateTransactionBalance = (total, transaction) => {
          const rawAmount = Number(transaction.amount || 0);

          return total + rawAmount;
        };

         
          const historicalTransactions =
            await Transaction.find({
              userId: currentUser._id,
              createdAt: { $lt: startDate },
              status: { $in: ["approved", "pending"] },
              type: {
                $nin: ["correction", "reconciliation" ,"commission"],
              },
            })
              .select("amount type")
              .lean();

          let openingClosing =
            historicalTransactions.reduce(
              calculateTransactionBalance,
              0
            );

         
          if (skip > 0) {
            const previousPageTransactions =
              await Transaction.find(transactionQuery)
                .sort({ createdAt: 1, _id: 1 })
                .limit(skip)
                .select("amount type")
                .lean();

            openingClosing =
              previousPageTransactions.reduce(
                calculateTransactionBalance,
                openingClosing
              );
          }

          // const transferTransactions = transactions.filter(
          //   (t) => String(t.type || "").toLowerCase() === "transfer"
          // );
          
              const transferTransactions = transactions.filter((t) => {
              const txType = String(t.type || "").toLowerCase();

              const txRemarks = String(
                t.remarks || t.adminRemarks || ""
              ).toLowerCase();

              return (
                txType === "transfer" ||
                (
                  txType === "adjustment" &&
                  txRemarks.includes("transferred to user")
                )
              );
            });


          const senderIds = [
            ...new Set(
              transferTransactions
                .map((t) => t.createdBy?._id || t.createdBy)
                .filter(Boolean)
                .map(String)
            ),
          ];

      const transferAmounts = [
        ...new Set(
          transferTransactions.map((t) => Math.abs(Number(t.amount || 0)))
        ),
      ];

      const receiverTransactions =
        senderIds.length > 0
          ? await Transaction.find({
             // type: "deposit",
             type: { $in: ["deposit", "adjustment"] },
              status: { $in: ["approved", "pending"] },
              createdBy: { $in: senderIds },
              amount: { $in: transferAmounts },
            })
              .populate("userId", "username role")
              .populate("createdBy", "username role")
              .lean()
          : [];
              const specialAmounts = [
        ...new Set(
          transactions
            .filter((tx) => {
              const remarks = String(
                tx.remarks || tx.adminRemarks || ""
              ).toLowerCase();

              return (
                remarks.includes("received from user") ||
                remarks.includes("transferred to super-admin")
              );
            })
            .map((tx) => Math.abs(Number(tx.amount || 0)))
        ),
      ];

      const specialAmountValues = [
        ...specialAmounts,
        ...specialAmounts.map((amount) => -amount),
      ];

      const specialCounterTransactions =
        specialAmountValues.length > 0
          ? await Transaction.find({
              status: { $in: ["approved", "pending"] },

              amount: {
                $in: specialAmountValues,
              },

              createdAt: {
                $gte: startDate,
                $lte: endDate,
              },
            })
              .populate("userId", "username role")
              .populate("createdBy", "username role")
              .lean()
          : [];
          const ownerUser = await User.findOne({
            role: "owner",
            isActive: true,
          })
        .select("username")
        .lean(); //new added
          ///my changes

      // let runningClosing = 0;

      let runningClosing = Number(
          openingClosing || 0
      );

        const data = transactions.map((t) => {
        const rawAmount = Number(t.amount || 0);
        const transactionType = String(t.type || "").toLowerCase();

      //   let credit = 0;
      //   let debit = 0;
      //   let signedAmount = 0;

      //  if (
      //     transactionType === "deposit" ||
      //     transactionType === "credit" ||
      //     transactionType === "adjustment"
      //   ) {
      //     credit = Math.abs(rawAmount);
      //     signedAmount = Math.abs(rawAmount);
      //   } else if (
      //     transactionType === "withdraw" ||
      //     transactionType === "debit"
      //   ) {
      //     debit = Math.abs(rawAmount);
      //     signedAmount = -Math.abs(rawAmount);
      //   } else if (rawAmount > 0) {
      //     credit = rawAmount;
      //     signedAmount = rawAmount;
      //   } else if (rawAmount < 0) {
      //     debit = Math.abs(rawAmount);
      //     signedAmount = -Math.abs(rawAmount);
      //   }

        let credit = 0;
        let debit = 0;
        let signedAmount = rawAmount;

        if (rawAmount > 0) {
          credit = rawAmount;
        } else if (rawAmount < 0) {
          debit = Math.abs(rawAmount);
        }

        runningClosing += signedAmount;

        const userName = t.userId?.username || "";
        const createdByName = t.createdBy?.username || "";

        let fromTo = "";

        switch (transactionType) {
          // case "deposit":
          //   fromTo = `${createdByName}/${userName}`;
          //   break;
          case "deposit": {
                  const transactionRemarks = String(
                    t.remarks || t.adminRemarks || ""
                  ).toLowerCase();

                  // ONLY Received from user
                  if (transactionRemarks.includes("received from user")) {
                    const currentAmount = Math.abs(Number(t.amount || 0));
                    const currentTime = new Date(t.createdAt).getTime();

                    const matchedSender = specialCounterTransactions
                      .filter((tx) => {
                        const txRemarks = String(
                          tx.remarks || tx.adminRemarks || ""
                        ).toLowerCase();

                        const txUserId = String(
                          tx.userId?._id || tx.userId || ""
                        );

                        const currentUserId = String(
                          t.userId?._id || t.userId || ""
                        );

                        const txAmount = Math.abs(
                          Number(tx.amount || 0)
                        );

                        return (
                          txUserId !== currentUserId &&
                          txAmount === currentAmount &&
                          txRemarks.startsWith("transferred to ")
                        );
                      })
                      .sort((a, b) => {
                        const aTime = new Date(
                          a.updatedAt || a.createdAt
                        ).getTime();

                        const bTime = new Date(
                          b.updatedAt || b.createdAt
                        ).getTime();

                        return (
                          Math.abs(aTime - currentTime) -
                          Math.abs(bTime - currentTime)
                        );
                      })[0];

                    const actualSenderName =
                      matchedSender?.userId?.username || "";

                    fromTo = actualSenderName
                      ? `${actualSenderName}/${userName}`
                      : `${createdByName}/${userName}`;

                    break;
                  }
                  fromTo = `${createdByName}/${userName}`;
                  break;
                }
          case "transfer": {
            const transactionRemarks = String(
              t.remarks || t.adminRemarks || ""
            ).toLowerCase();
            const originalRemarks = String(
                  t.remarks || t.adminRemarks || ""
                );

                if (
                  transactionRemarks.startsWith("transferred to ") &&
                  !transactionRemarks.includes("transferred to user") &&
                  !transactionRemarks.includes("transferred to sadmin") &&
                  !transactionRemarks.includes("transferred to owner") &&
                  !transactionRemarks.includes("transferred to admin") &&
                  !transactionRemarks.includes("transferred to master") &&
                  !transactionRemarks.includes("transferred to super-admin") &&
                  !transactionRemarks.includes("transferred to sub-admin") &&
                  !transactionRemarks.includes("transferred to super-master")
                ) {
                  // const targetName = originalRemarks
                  //   .replace(/^transferred to\s+/i, "")
                  //   .trim();
                  const targetName = originalRemarks
                          .replace(/^transferred to\s+/i, "")
                          .split(":")[0]
                          .trim();

                  if (targetName) {
                    fromTo = `${userName}/${targetName}`;
                    break;
                  }
                }
            // Transferred to sadmin
              if (transactionRemarks.includes("transferred to sadmin")) {
                fromTo = `${userName}/sadmin`;
                break;
              }
            if (transactionRemarks.includes("transferred to master")) {
              const originalRemarks = String(
                t.remarks || t.adminRemarks || ""
              );

              const masterName =
                originalRemarks.includes(":")
                  ? originalRemarks.split(":")[1]?.trim()
                  : "";

              fromTo = masterName
                ? `${userName}/${masterName}`
                : `${userName}/master`;

              break;
            }
            if (transactionRemarks.includes("transferred to owner")) {
              const ownerName = ownerUser?.username || "owner";
                    fromTo = `${userName}/${ownerName}`;
                    break;
            }


            if (transactionRemarks.includes("transferred to admin")) {
              const parentId = String(
                currentUser?.parent?._id ||
                currentUser?.parent ||
                ""
              );

              const adminName =
                hierarchyUserMap.get(parentId)?.username ||
                "admin";

              fromTo = `${userName}/${adminName}`;
              break;
            }

          // if (
          //     transactionRemarks.includes("transferred to super-admin") ||
          //     transactionRemarks.includes("transferred to sub-admin") ||
          //     transactionRemarks.includes("transferred to super-master")
          //   ) {
          //     let targetName = "";

          //     if (transactionRemarks.includes("transferred to super-admin")) {
          //       targetName = "super-admin";
          //     } else if (transactionRemarks.includes("transferred to sub-admin")) {
          //       targetName = "sub-admin";
          //     } else if (transactionRemarks.includes("transferred to super-master")) {
          //       targetName = "super-master";
          //     }

          //     fromTo = `${userName}/${targetName}`;
          //     break;
          //   }

          if (
              transactionRemarks.includes("transferred to super-admin") ||
              transactionRemarks.includes("transferred to sub-admin") ||
              transactionRemarks.includes("transferred to super-master")
            ) {
              let targetName = "";

              // ===================================================
              // ONLY super-admin -> actual username
              // ===================================================
              if (transactionRemarks.includes("transferred to super-admin")) {
                const currentAmount = Math.abs(Number(t.amount || 0));
                const currentTime = new Date(t.createdAt).getTime();

                const matchedSuperAdmin = specialCounterTransactions
                  .filter((tx) => {
                    const txRemarks = String(
                      tx.remarks || tx.adminRemarks || ""
                    ).toLowerCase();

                    const txAmount = Math.abs(
                      Number(tx.amount || 0)
                    );

                    return (
                      txAmount === currentAmount &&
                      txRemarks.includes("received from super-admin")
                    );
                  })
                  .sort((a, b) => {
                    const aTime = new Date(
                      a.updatedAt || a.createdAt
                    ).getTime();

                    const bTime = new Date(
                      b.updatedAt || b.createdAt
                    ).getTime();

                    return (
                      Math.abs(aTime - currentTime) -
                      Math.abs(bTime - currentTime)
                    );
                  })[0];

                targetName =
                  matchedSuperAdmin?.createdBy?.username ||
                  matchedSuperAdmin?.userId?.username ||
                  "super-admin";
              }

              // ===================================================
              // SUB-ADMIN - existing logic SAME
              // ===================================================
              else if (
                transactionRemarks.includes("transferred to sub-admin")
              ) {
                targetName = "sub-admin";
              }

              // ===================================================
              // SUPER-MASTER - existing logic SAME
              // ===================================================
              else if (
                transactionRemarks.includes("transferred to super-master")
              ) {
                targetName = "super-master";
              }

              fromTo = `${userName}/${targetName}`;
              break;
            }

            
          if (transactionRemarks.includes("transferred to user")) {
            const senderId = String(
            t.createdBy?._id || t.createdBy || ""
          );
          const transferAmount = Math.abs(rawAmount);
          const transferTime = new Date(t.createdAt).getTime();

          const matchedReceiver = receiverTransactions
            .filter((receiverTransaction) => {
              const receiverCreatedById = String(
                receiverTransaction.createdBy?._id ||
                  receiverTransaction.createdBy ||
                  ""
              );

              const receiverUserId = String(
                receiverTransaction.userId?._id ||
                  receiverTransaction.userId ||
                  ""
              );

              const receiverRole =
                receiverTransaction.userId?.role || "";

              const receiverAmount = Math.abs(
                Number(receiverTransaction.amount || 0)
              );

              return (
                receiverCreatedById === senderId &&
                receiverUserId !== senderId &&
                receiverRole === "user" &&
                receiverAmount === transferAmount
              );
            })
            .sort((a, b) => {
              const aTime = new Date(
                a.updatedAt || a.createdAt
              ).getTime();

              const bTime = new Date(
                b.updatedAt || b.createdAt
              ).getTime();

              return (
                Math.abs(aTime - transferTime) -
                Math.abs(bTime - transferTime)
              );
            })[0];

          const receiverName =
            matchedReceiver?.userId?.username || "";

            const remarkUserName = originalRemarks.includes(":")
                  ? originalRemarks.split(":")[1]?.trim()
                  : "";

          // fromTo = receiverName
          //   ? `${userName}/${receiverName}`
          //   : `${userName}/${createdByName}`;

          fromTo = receiverName
                ? `${userName}/${receiverName}`
                : remarkUserName
                ? `${userName}/${remarkUserName}`
                : `${userName}/${createdByName}`;

          break;
        }

        // fromTo = `${userName}/${createdByName}`;
        //   break;
        if (!fromTo) {
          fromTo = `${userName}/${createdByName}`;
        }
        break;
        }
        case "adjustment": {
              const transactionRemarks = String(
                t.remarks || t.adminRemarks || ""
              ).toLowerCase();

              const originalRemarks = String(
                t.remarks || t.adminRemarks || ""
              );

              if (transactionRemarks.includes("transferred to user")) {
                  const senderId = String(
                    t.createdBy?._id || t.createdBy || ""
                  );

                  const transferAmount = Math.abs(Number(t.amount || 0));
                  const transferTime = new Date(t.createdAt).getTime();

                  const matchedReceiver = receiverTransactions
                    .filter((receiverTransaction) => {
                      const receiverCreatedById = String(
                        receiverTransaction.createdBy?._id ||
                        receiverTransaction.createdBy ||
                        ""
                      );

                      const receiverUserId = String(
                        receiverTransaction.userId?._id ||
                        receiverTransaction.userId ||
                        ""
                      );

                      const receiverRole = String(
                        receiverTransaction.userId?.role || ""
                      ).toLowerCase();

                      const receiverAmount = Math.abs(
                        Number(receiverTransaction.amount || 0)
                      );

                      return (
                        receiverCreatedById === senderId &&
                        receiverUserId !== String(t.userId?._id || t.userId || "") &&
                        receiverRole === "user" &&
                        receiverAmount === transferAmount
                      );
                    })
                    .sort((a, b) => {
                      const aTime = new Date(
                        a.updatedAt || a.createdAt
                      ).getTime();

                      const bTime = new Date(
                        b.updatedAt || b.createdAt
                      ).getTime();

                      return (
                        Math.abs(aTime - transferTime) -
                        Math.abs(bTime - transferTime)
                      );
                    })[0];

                  const receiverName =
                    matchedReceiver?.userId?.username || "";

                  if (receiverName) {
                    fromTo = `${userName}/${receiverName}`;
                    break;
                  }
                }

              // Generic username transfer
              if (
                transactionRemarks.startsWith("transferred to ") &&
                  !transactionRemarks.includes("transferred to user") &&
                !transactionRemarks.includes("transferred to super-admin") &&
                !transactionRemarks.includes("transferred to sub-admin") &&
                !transactionRemarks.includes("transferred to super-master") &&
                !transactionRemarks.includes("transferred to master") &&
                !transactionRemarks.includes("transferred to admin") &&
                !transactionRemarks.includes("transferred to owner") &&
                !transactionRemarks.includes("transferred to sadmin")
              ) {
                const targetName = originalRemarks
                  .replace(/^transferred to\s+/i, "")
                  .split(":")[0]
                  .trim();

                if (targetName) {
                  fromTo = `${userName}/${targetName}`;
                  break;
                }
              }

              const roleNames = [
                "super-admin",
                "sub-admin",
                "super-master",
                "master",
                "admin",
                "owner",
                "sadmin"
              ];

              const matchedRole = roleNames.find((role) =>
                transactionRemarks.includes(`transferred to ${role}`)
              );

              if (matchedRole) {
                const targetUser = allHierarchyUsers.find(
                  (u) => String(u.role || "").toLowerCase() === matchedRole
                );

                const targetName = targetUser?.username || matchedRole;

                fromTo = `${userName}/${targetName}`;
              } else {
                fromTo = `${createdByName}/${userName}`;
              }

              break;
          }
        case "withdraw":
          fromTo = `${userName}/${createdByName}`;
          break;
        default:
          fromTo = `${createdByName}/${userName}`;
      }

        return {
          ...t,
          amount: rawAmount,
          credit,
          debit,

            pts: runningClosing,
            closing: runningClosing,

              // pts: Math.abs(runningClosing),
              // closing: Math.abs(runningClosing),
          fromTo,
          remarks: t.remarks || t.adminRemarks || t.type,
        };
      });
      return res.status(httpStatus.OK).send(
        new APIResponse(
          {
            data,
            totalCount,
            totalPages,
            currentPage: page,
          },
          "Account statement fetched successfully",
          httpStatus.OK
        )
      );
    }

    if (type === "crash") {
        const transactionQuery = {
            userId: currentUser._id,
            createdAt: {
                $gte: startDate,
                $lte: endDate,
            },
            status: { $in: ["approved", "pending"] },
            type: "softapi",
        };

        const totalCount = await Transaction.countDocuments(transactionQuery);
        const totalPages = Math.ceil(totalCount / limit);

        const transactions = await Transaction.find(transactionQuery)
           // .sort({ createdAt: -1 })
           .sort({ createdAt: 1, _id: 1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const data = transactions.map((t) => ({
            ...t,
            srNo: null,
            credit: t.amount > 0 ? t.amount : 0,
            debit: t.amount < 0 ? Math.abs(t.amount) : 0,
            pts: t.balanceAfter,
            remarks: t.remarks || "Crash",
        }));

        console.log("returningsoftapi");
        console.log("data",data);

        return res.status(httpStatus.OK).send(
            new APIResponse(
                {
                    data,
                    totalCount,
                    totalPages,
                    currentPage: page,
                },
                "Crash statement fetched successfully",
                httpStatus.OK
            )
        );
    }

    

        if (type === "All") {
              const betQuery = {
                userId: { $in: allIds },
                //status: { $in: ["won", "lost", "cancelled"] },
                  status: { $in: ["won", "lost", "cancelled"] },
                updatedAt: {
                  $gte: startDate,
                  $lte: endDate,
                },
                isDeleteBetShowUser: { $ne: true },
              };

              const transactionQuery = {
                userId: currentUser._id,
                createdAt: {
                  $gte: startDate,
                  $lte: endDate,
                },
                status: { $in: ["approved", "pending"] },
                type: {
                  $nin: ["correction", "reconciliation"],
                },
              };


              const historicalBetQuery = {
                userId: { $in: allIds },
                status: { $in: ["won", "lost", "cancelled"] },
                updatedAt: {
                  $lt: startDate,
                },
                isDeleteBetShowUser: { $ne: true },
              };

              const historicalTransactionQuery = {
                userId: currentUser._id,
                createdAt: {
                  $lt: startDate,
                },
                status: { $in: ["approved", "pending"] },
                type: {
                  $nin: ["correction", "reconciliation"],
                },
              };
              const [
                bets,
                transactions,
                historicalBets,
                historicalTransactions,
              ] = await Promise.all([
                Bet.find(betQuery)
                  .populate("userId", "username")
                  .lean(),

                  Transaction.find(transactionQuery)
                    .populate("userId", "username")
                    .populate("createdBy", "username")
                    .lean(),

                  Bet.find(historicalBetQuery)
                    .select("profit")
                    .lean(),

                  Transaction.find(historicalTransactionQuery)
                    .select("amount type")
                    .lean(),
              ]);



              const uniqueIps = [
                    ...new Set(
                      bets
                        .map((bet) => bet.ipAddress || bet.ip)
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
                    uniqueIps.map(async (ip) => {
                      try {
                        const response = await axios.get(
                          `http://ip-api.com/json/${encodeURIComponent(ip)}`,
                          {
                            params: {
                              fields:
                                "status,message,query,city,country,mobile",
                            },
                            timeout: 5000,
                          }
                        );

                        if (response.data?.status === "success") {
                          ipDetailsMap.set(ip, {
                            ip: response.data.query || ip,
                            city: response.data.city || "",
                            country: response.data.country || "",
                            mobile: Boolean(response.data.mobile),
                          });
                        }
                      } catch (error) {
                      }
                    })
                  );

                  bets.forEach((bet) => {
                    const ip = bet.ipAddress || bet.ip || "";

                    bet.ipAddress = ip;

                    bet.ipDetails =
                      ipDetailsMap.get(ip) || {
                        ip,
                        city:
                          ip === "127.0.0.1" || ip === "::1"
                            ? "Localhost"
                            : "",
                        country: "",
                        mobile: false,
                      };
                  });

                const historicalBetBalance = historicalBets.reduce(
                  (total, bet) => {
                    return total + Number(bet.profit || 0);
                  },
                  0
                );


              // const historicalTransactionBalance =
              //   historicalTransactions.reduce(
              //     (total, transaction) => {
              //       const amount = Number(transaction.amount || 0);

              //       const transactionType = String(
              //         transaction.type || ""
              //       ).toLowerCase();

                   
              //       if (
              //         transactionType === "withdraw" ||
              //         transactionType === "debit" ||
              //         transactionType === "adjustment"
              //       ) {
              //         return total - Math.abs(amount);
              //       }

              //       if (
              //         transactionType === "deposit" ||
              //         transactionType === "credit"
              //       ) {
              //         return total + Math.abs(amount);
              //       }

              //       return total + amount;
              //     },
              //     0
              //   );

              const historicalTransactionBalance =
                historicalTransactions.reduce(
                  (total, transaction) => {
                    const amount = Number(transaction.amount || 0);

                    return total + amount;
                  },
                  0
                );


              // const isSelectedClientUser =
              //     String(currentUser?.role || "").toLowerCase() === "user";
              //   const openingBalance = isSelectedClientUser
              // ? Number(historicalBetBalance || 0) +
              //   Number(historicalTransactionBalance || 0)
              // : Number(historicalTransactionBalance || 0);

              const openingBalance =
                Number(historicalBetBalance || 0) +
                Number(historicalTransactionBalance || 0);

              /*
              * Sport + Casino bets
              */
              // const betData = bets.map((bet) => {
              //   const profit = Number(bet.profit || 0);

              //   const statementDate =
              //     bet.updatedAt || bet.createdAt;

              //   return {
              //     ...bet,
              //       username: bet.userId?.username || "",
              //   userName: bet.userId?.username || "",

              //     statementType: bet.subType
              //       ? "casino"
              //       : "sport",

              //     statementDate,

              //     createdAt: statementDate,
              //     updatedAt: statementDate,
              //     lastUpdated: statementDate,

              //     credit: profit > 0 ? Math.abs(profit) : 0,
              //     debit: profit < 0 ? Math.abs(profit) : 0,

              //     //amount: profit,
              //     amount: Number(bet.amount || 0),

              //     remarks:
              //       bet.eventName ||
              //       bet.marketName ||
              //       bet.gType ||
              //       "Bet",
              //   };
              // });
            const groupedBetData = {};
 
              for (const bet of bets) {

                const marketId = bet.marketId;

                const sectionName = String(
                  bet.sectionName || ""
                ).trim();

                const marketType = String(
                  bet.marketName || bet.gType || ""
                ).toLowerCase();

                const isBookmaker = marketType.includes("bookmaker");

                const groupKey = isBookmaker
                  ? String(marketId)
                  : bet.subType
                    ? String(marketId) // Casino
                    : `${String(marketId)}__${sectionName}`; // Sport

 
                if (!groupedBetData[groupKey]) {
                  groupedBetData[groupKey] = {
                    ...bet,
 
                    marketId,
                    sectionName,
 
                    username: bet.userId?.username || "",
                    userName: bet.userId?.username || "",
 
                    // statementType: bet.subType
                    //   ? "casino"
                    //   : "sport",
                  statementType:
                    bet.subType ||
                    specialCasinoGTypes.includes(
                      String(bet.gType || "").toLowerCase()
                    ) ||
                    specialCasinoMarketRegex.test(
                      String(bet.marketName || "")
                    ) ||
                    specialCasinoMarketRegex.test(
                      String(bet.eventName || "")
                    )
                      ? "casino"
                      : "sport",

 
                    statementDate:
                      bet.updatedAt || bet.createdAt,
 
                    createdAt:
                      bet.updatedAt || bet.createdAt,
 
                    updatedAt:
                      bet.updatedAt || bet.createdAt,
 
                    lastUpdated:
                      bet.updatedAt || bet.createdAt,
 
                    totalProfit: 0,
                    totalAmount: 0,
 
                    bets: [],
                  };
                }
 
                const originalProfit = Number(
                  bet.profit || 0
                );
 
                // const displayProfit = isSelectedClientUser
                //   ? originalProfit
                //   : 0;
                const displayProfit = originalProfit;
 
                const betAmount = Number(
                  bet.amount || 0
                );
 
                groupedBetData[groupKey].totalProfit +=
                  displayProfit;
 
                groupedBetData[groupKey].totalAmount +=
                  betAmount;
 
                groupedBetData[groupKey].bets.push({
                  ...bet,
 
                  username: bet.userId?.username || "",
                  userName: bet.userId?.username || "",
 
                  statementType: bet.subType
                    ? "casino"
                    : "sport",
 
                  statementDate:
                    bet.updatedAt || bet.createdAt,
 
                  createdAt:
                    bet.updatedAt || bet.createdAt,
 
                  updatedAt:
                    bet.updatedAt || bet.createdAt,
 
                  lastUpdated:
                    bet.updatedAt || bet.createdAt,
                 
                  newCreatedAt: bet.createdAt,
 
                  profit: displayProfit,
                  totalProfit: displayProfit,
 
                  credit:
                    displayProfit > 0
                      ? Math.abs(displayProfit)
                      : 0,
 
                  debit:
                    displayProfit < 0
                      ? Math.abs(displayProfit)
                      : 0,
 
                  amount: betAmount,
 
                  remarks:
                    bet.eventName ||
                    bet.marketName ||
                    bet.gType ||
                    "Bet",
                });
 
                // Keep latest bet date for the grouped row
                const currentUpdatedAt = new Date(
                  bet.updatedAt || bet.createdAt
                ).getTime();
 
                const groupedUpdatedAt = new Date(
                  groupedBetData[groupKey].lastUpdated
                ).getTime();
 
                if (currentUpdatedAt > groupedUpdatedAt) {
                  groupedBetData[groupKey].lastUpdated =
                    bet.updatedAt || bet.createdAt;
 
                  groupedBetData[groupKey].statementDate =
                    bet.updatedAt || bet.createdAt;
 
                  groupedBetData[groupKey].createdAt =
                    bet.updatedAt || bet.createdAt;
 
                  groupedBetData[groupKey].updatedAt =
                    bet.updatedAt || bet.createdAt;
                }
              }
 
              const betData = Object.values(
                groupedBetData
              );

              const specialAmounts = [
                ...new Set(
                  transactions
                    .filter((tx) => {
                      const remarks = String(
                        tx.remarks || tx.adminRemarks || ""
                      ).toLowerCase();

                      return (
                        remarks.includes("received from user") ||
                        remarks.includes("transferred to super-admin")
                      );
                    })
                    .map((tx) => Math.abs(Number(tx.amount || 0)))
                ),
              ];

              const specialAmountValues = [
                ...specialAmounts,
                ...specialAmounts.map((amount) => -amount),
              ];

              const specialCounterTransactions =
                specialAmountValues.length > 0
                  ? await Transaction.find({
                      status: { $in: ["approved", "pending"] },
                      amount: {
                        $in: specialAmountValues,
                      },
                      createdAt: {
                        $gte: startDate,
                        $lte: endDate,
                      },
                    })
                      .populate("userId", "username role")
                      .populate("createdBy", "username role")
                      .lean()
                  : [];

              const transactionData = transactions.map(
                (transaction) => {
                  const rawAmount = Number(
                    transaction.amount || 0
                  );

                  const transactionType = String(
                    transaction.type || ""
                  ).toLowerCase();

                  let credit = 0;
                  let debit = 0;

                  // if (
                  //   transactionType === "deposit" ||
                  //   transactionType === "credit" ||
                  //   transactionType === "adjustment"
                  // ) {
                  //   credit = Math.abs(rawAmount);
                  // } else if (
                  //   transactionType === "withdraw" ||
                  //   transactionType === "debit" ||
                  //   transactionType === "transfer"
                  // ) {
                  //   debit = Math.abs(rawAmount);
                  // } else if (rawAmount > 0) {
                  //   credit = Math.abs(rawAmount);
                  // } else if (rawAmount < 0) {
                  //   debit = Math.abs(rawAmount);
                  // }

                  // if (
                  //     transactionType === "deposit" ||
                  //     transactionType === "credit"
                  //   ) {
                  //     credit = Math.abs(rawAmount);
                  //   } else if (
                  //     transactionType === "withdraw" ||
                  //     transactionType === "debit" ||
                  //     transactionType === "transfer" ||
                  //     transactionType === "adjustment"
                  //   ) {
                  //     debit = Math.abs(rawAmount);
                  //   } else if (rawAmount > 0) {
                  //     credit = Math.abs(rawAmount);
                  //   } else if (rawAmount < 0) {
                  //     debit = Math.abs(rawAmount);
                  //   }

                  if (rawAmount > 0) {
                    credit = rawAmount;
                  } else if (rawAmount < 0) {
                    debit = Math.abs(rawAmount);
                  }

                  

                  const statementDate =
                    transaction.createdAt ||
                    transaction.updatedAt;


                  const userName =
                    transaction.userId?.username || "";

                  const createdByName =
                    transaction.createdBy?.username || "";

                      let fromTo = "";

                      switch (transactionType) {
                        case "deposit": {
                          const transactionRemarks = String(
                            transaction.remarks || transaction.adminRemarks || ""
                          ).toLowerCase();

                          // ONLY Received from user
                          if (transactionRemarks.includes("received from user")) {
                            const currentAmount = Math.abs(
                              Number(transaction.amount || 0)
                            );

                            const currentTime = new Date(
                              transaction.createdAt
                            ).getTime();

                            const matchedSender = specialCounterTransactions
                              .filter((tx) => {
                                const txRemarks = String(
                                  tx.remarks || tx.adminRemarks || ""
                                ).toLowerCase();

                                const txUserId = String(
                                  tx.userId?._id || tx.userId || ""
                                );

                                const currentUserId = String(
                                  transaction.userId?._id ||
                                  transaction.userId ||
                                  ""
                                );

                                const txAmount = Math.abs(
                                  Number(tx.amount || 0)
                                );

                                return (
                                  txUserId !== currentUserId &&
                                  txAmount === currentAmount &&
                                  txRemarks.startsWith("transferred to ")
                                );
                              })
                              .sort((a, b) => {
                                const aTime = new Date(
                                  a.updatedAt || a.createdAt
                                ).getTime();

                                const bTime = new Date(
                                  b.updatedAt || b.createdAt
                                ).getTime();

                                return (
                                  Math.abs(aTime - currentTime) -
                                  Math.abs(bTime - currentTime)
                                );
                              })[0];

                            const actualSenderName =
                              matchedSender?.userId?.username || "";

                            fromTo = actualSenderName
                              ? `${actualSenderName}/${userName}`
                              : `${createdByName}/${userName}`;

                            break;
                          }
                          fromTo = `${createdByName}/${userName}`;
                          break;
                        }

                        case "transfer": {
                          const transactionRemarks = String(
                            transaction.remarks ||
                            transaction.adminRemarks ||
                            ""
                          ).toLowerCase();

                          const originalRemarks = String(
                            transaction.remarks ||
                            transaction.adminRemarks ||
                            ""
                          );

                          if (
                            transactionRemarks.startsWith("transferred to ") &&
                            !transactionRemarks.includes("transferred to user") &&
                            !transactionRemarks.includes("transferred to sadmin") &&
                            !transactionRemarks.includes("transferred to owner") &&
                            !transactionRemarks.includes("transferred to admin") &&
                            !transactionRemarks.includes("transferred to master") &&
                            !transactionRemarks.includes("transferred to super-admin") &&
                            !transactionRemarks.includes("transferred to sub-admin") &&
                            !transactionRemarks.includes("transferred to super-master")
                          ) {

                            const targetName = originalRemarks
                              .replace(/^transferred to\s+/i, "")
                              .split(":")[0]
                              .trim();

                            if (targetName) {
                              fromTo = `${userName}/${targetName}`;
                              break;
                            }
                          }

                          if (
                            transactionRemarks.includes("transferred to sadmin")
                          ) {
                            fromTo = `${userName}/sadmin`;
                            break;
                          }

                          if (
                            transactionRemarks.includes("transferred to master")
                          ) {
                            const masterName =
                              originalRemarks.includes(":")
                                ? originalRemarks.split(":")[1]?.trim()
                                : "";

                            fromTo = masterName
                              ? `${userName}/${masterName}`
                              : `${userName}/master`;

                            break;
                          }

                          if (
                            transactionRemarks.includes("transferred to owner")
                          ) {
                            const ownerName =
                              ownerUser?.username || "owner";

                            fromTo = `${userName}/${ownerName}`;
                            break;
                          }

                          if (
                            transactionRemarks.includes("transferred to admin")
                          ) {
                            const parentId = String(
                              currentUser?.parent?._id ||
                              currentUser?.parent ||
                              ""
                            );

                            const adminName =
                              hierarchyUserMap.get(parentId)?.username ||
                              "admin";

                            fromTo = `${userName}/${adminName}`;
                            break;
                          }

                          if (
                            transactionRemarks.includes("transferred to super-admin") ||
                            transactionRemarks.includes("transferred to sub-admin") ||
                            transactionRemarks.includes("transferred to super-master")
                          ) {
                            let targetName = "";

                            if (
                              transactionRemarks.includes(
                                "transferred to super-admin"
                              )
                            ) {
                              const currentAmount = Math.abs(
                                Number(transaction.amount || 0)
                              );

                              const currentTime = new Date(
                                transaction.createdAt
                              ).getTime();

                              const matchedSuperAdmin =
                                specialCounterTransactions
                                  .filter((tx) => {
                                    const txRemarks = String(
                                      tx.remarks ||
                                      tx.adminRemarks ||
                                      ""
                                    ).toLowerCase();

                                    const txAmount = Math.abs(
                                      Number(tx.amount || 0)
                                    );

                                    return (
                                      txAmount === currentAmount &&
                                      txRemarks.includes(
                                        "received from super-admin"
                                      )
                                    );
                                  })
                                  .sort((a, b) => {
                                    const aTime = new Date(
                                      a.updatedAt || a.createdAt
                                    ).getTime();

                                    const bTime = new Date(
                                      b.updatedAt || b.createdAt
                                    ).getTime();

                                    return (
                                      Math.abs(aTime - currentTime) -
                                      Math.abs(bTime - currentTime)
                                    );
                                  })[0];

                              targetName =
                                matchedSuperAdmin?.createdBy?.username ||
                                matchedSuperAdmin?.userId?.username ||
                                "super-admin";
                            } else if (
                              transactionRemarks.includes(
                                "transferred to sub-admin"
                              )
                            ) {
                              targetName = "sub-admin";
                            } else if (
                              transactionRemarks.includes(
                                "transferred to super-master"
                              )
                            ) {
                              targetName = "super-master";
                            }

                            fromTo = `${userName}/${targetName}`;
                            break;
                          }

                          if (
                            transactionRemarks.includes("transferred to user")
                          ) {
                            const senderId = String(
                              transaction.createdBy?._id ||
                              transaction.createdBy ||
                              ""
                            );

                            const transferAmount = Math.abs(
                              rawAmount
                            );

                            const transferTime = new Date(
                              transaction.createdAt
                            ).getTime();

                            const matchedReceiver =
                              receiverTransactions
                                .filter((receiverTransaction) => {
                                  const receiverCreatedById = String(
                                    receiverTransaction.createdBy?._id ||
                                    receiverTransaction.createdBy ||
                                    ""
                                  );

                                  const receiverUserId = String(
                                    receiverTransaction.userId?._id ||
                                    receiverTransaction.userId ||
                                    ""
                                  );

                                  const receiverRole =
                                    receiverTransaction.userId?.role || "";

                                  const receiverAmount = Math.abs(
                                    Number(
                                      receiverTransaction.amount || 0
                                    )
                                  );

                                  return (
                                    receiverCreatedById === senderId &&
                                    receiverUserId !== senderId &&
                                    receiverRole === "user" &&
                                    receiverAmount === transferAmount
                                  );
                                })
                                .sort((a, b) => {
                                  const aTime = new Date(
                                    a.updatedAt || a.createdAt
                                  ).getTime();

                                  const bTime = new Date(
                                    b.updatedAt || b.createdAt
                                  ).getTime();

                                  return (
                                    Math.abs(aTime - transferTime) -
                                    Math.abs(bTime - transferTime)
                                  );
                                })[0];

                            const receiverName =
                              matchedReceiver?.userId?.username || "";

                            const originalRemarks = String(
                              transaction.remarks ||
                              transaction.adminRemarks ||
                              ""
                            );

                            const remarkUserName =
                              originalRemarks.includes(":")
                                ? originalRemarks.split(":")[1]?.trim()
                                : "";

                            fromTo = receiverName
                              ? `${userName}/${receiverName}`
                              : remarkUserName
                              ? `${userName}/${remarkUserName}`
                              : `${userName}/${
                                  transaction.createdBy?.username || ""
                                }`;

                            break;
                          }


                          if (!fromTo) {
                            fromTo = `${userName}/${createdByName}`;
                          }

                          break;
                        }

                        case "adjustment": {
                          const transactionRemarks = String(
                            transaction.remarks ||
                            transaction.adminRemarks ||
                            ""
                          ).toLowerCase();

                          const originalRemarks = String(
                            transaction.remarks ||
                            transaction.adminRemarks ||
                            ""
                          );

                          if (
                            transactionRemarks.includes("transferred to user")
                          ) {
                            const senderId = String(
                              transaction.createdBy?._id ||
                              transaction.createdBy ||
                              ""
                            );

                            const transferAmount = Math.abs(
                              Number(transaction.amount || 0)
                            );

                            const transferTime = new Date(
                              transaction.createdAt
                            ).getTime();

                            const matchedReceiver =
                              receiverTransactions
                                .filter((receiverTransaction) => {
                                  const receiverCreatedById = String(
                                    receiverTransaction.createdBy?._id ||
                                    receiverTransaction.createdBy ||
                                    ""
                                  );

                                  const receiverUserId = String(
                                    receiverTransaction.userId?._id ||
                                    receiverTransaction.userId ||
                                    ""
                                  );

                                  const receiverRole = String(
                                    receiverTransaction.userId?.role || ""
                                  ).toLowerCase();

                                  const receiverAmount = Math.abs(
                                    Number(
                                      receiverTransaction.amount || 0
                                    )
                                  );

                                  return (
                                    receiverCreatedById === senderId &&
                                    receiverUserId !==
                                      String(
                                        transaction.userId?._id ||
                                        transaction.userId ||
                                        ""
                                      ) &&
                                    receiverRole === "user" &&
                                    receiverAmount === transferAmount
                                  );
                                })
                                .sort((a, b) => {
                                  const aTime = new Date(
                                    a.updatedAt || a.createdAt
                                  ).getTime();

                                  const bTime = new Date(
                                    b.updatedAt || b.createdAt
                                  ).getTime();

                                  return (
                                    Math.abs(aTime - transferTime) -
                                    Math.abs(bTime - transferTime)
                                  );
                                })[0];

                            const receiverName =
                              matchedReceiver?.userId?.username || "";


                            if (receiverName) {
                              fromTo = `${userName}/${receiverName}`;
                              break;
                            }
                          }

                          if (
                            transactionRemarks.startsWith("transferred to ") &&
                            !transactionRemarks.includes("transferred to user") &&
                            !transactionRemarks.includes("transferred to super-admin") &&
                            !transactionRemarks.includes("transferred to sub-admin") &&
                            !transactionRemarks.includes("transferred to super-master") &&
                            !transactionRemarks.includes("transferred to master") &&
                            !transactionRemarks.includes("transferred to admin") &&
                            !transactionRemarks.includes("transferred to owner") &&
                            !transactionRemarks.includes("transferred to sadmin")
                          ) {
                            const targetName = originalRemarks
                              .replace(/^transferred to\s+/i, "")
                              .split(":")[0]
                              .trim();

                            if (targetName) {
                              fromTo = `${userName}/${targetName}`;
                              break;
                            }
                          }

                          const roleNames = [
                            "super-admin",
                            "sub-admin",
                            "super-master",
                            "master",
                            "admin",
                            "owner",
                            "sadmin"
                          ];

                          const matchedRole = roleNames.find((role) =>
                            transactionRemarks.includes(
                              `transferred to ${role}`
                            )
                          );

                          if (matchedRole) {
                            const targetUser =
                              allHierarchyUsers.find(
                                (u) =>
                                  String(u.role || "").toLowerCase() ===
                                  matchedRole
                              );

                            const targetName =
                              targetUser?.username || matchedRole;

                            fromTo = `${userName}/${targetName}`;
                          } else {
                            fromTo = `${createdByName}/${userName}`;
                          }

                          break;
                        }

                        case "withdraw": {

                          fromTo = `${userName}/${createdByName}`;
                          break;
                        }

                        default: {
                          fromTo = `${createdByName}/${userName}`;
                        }
                      }

                  return {
                    ...transaction,

                    statementType:
                      transactionType === "softapi"
                        ? "crash"
                        : "account",

                    statementDate,


                    createdAt: statementDate,
                    updatedAt: statementDate,
                    lastUpdated: statementDate,

                    credit,
                    debit,
                    amount: rawAmount,

                    fromTo,

                    remarks:
                      transaction.remarks ||
                      transaction.adminRemarks ||
                      transaction.type ||
                      "Account",
                  };
                }
              );


              const mergedDataDescending = [
                ...betData,
                ...transactionData,
              ].sort((a, b) => {
                const dateA = new Date(
                  a.statementDate
                ).getTime();

                const dateB = new Date(
                  b.statementDate
                ).getTime();

                if (dateA !== dateB) {
                  //return dateB - dateA;
                  return dateA - dateB;
                }

                // return String(b._id || "").localeCompare(
                //   String(a._id || "")
                // );
                return String(a._id || "").localeCompare(String(b._id || ""));
              });


             
                let runningBalance = Number(
                    openingBalance || 0
                );

              // const dataWithClosing =
              //   mergedDataDescending.map((item) => {
              //     const statementType = String(
              //       item.statementType || ""
              //     ).toLowerCase();

              //     const isBetStatement =
              //       statementType === "sport" ||
              //       statementType === "casino";

              //     /*
              //     * Non-user ke Sport/Casino rows:
              //     * Credit/Debit zero aur Closing unchanged.
              //     *
              //     * User ke liye existing calculation.
              //     * Account transaction ke liye existing calculation.
              //     */
              //     const shouldIgnoreBetAmount =
              //       !isSelectedClientUser &&
              //       isBetStatement;

              //     const credit = shouldIgnoreBetAmount
              //       ? 0
              //       : Math.abs(Number(item.credit || 0));

              //     const debit = shouldIgnoreBetAmount
              //       ? 0
              //       : Math.abs(Number(item.debit || 0));

              //     if (!shouldIgnoreBetAmount) {
              //       runningBalance =
              //         runningBalance + credit - debit;
              //     }

              //     const closing = Number(
              //       runningBalance.toFixed(2)
              //     );

              //     return {
              //       ...item,

              //       statementDate: item.statementDate,
              //       createdAt: item.statementDate,
              //       updatedAt: item.statementDate,
              //       lastUpdated: item.statementDate,

              //       credit,
              //       debit,

              //       // Frontend kisi bhi key se Closing le sakta hai
              //       pts: closing,
              //       closing,

              //       // Non-user Sport/Casino ke frontend calculation ko bhi zero rakhega
              //       ...(shouldIgnoreBetAmount
              //         ? {
              //             profit: 0,
              //             totalProfit: 0,
              //           }
              //         : {}),
              //     };
              //   });

                const dataWithClosing = mergedDataDescending.map((item) => {

                  const statementType = String(
                    item.statementType || ""
                  ).toLowerCase();

                  const isBetStatement =
                    statementType === "sport" ||
                    statementType === "casino";

                  let credit = 0;
                  let debit = 0;

                  if (isBetStatement) {

                    // SPORT / CASINO
                    // Use grouped totalProfit
                    const profit = Number(
                      item.totalProfit || 0
                    );

                    credit =
                      profit > 0
                        ? Math.abs(profit)
                        : 0;

                    debit =
                      profit < 0
                        ? Math.abs(profit)
                        : 0;

                  } else {

                    // COMMISSION / ACCOUNT TRANSACTIONS
                    // Their credit/debit were already calculated
                    credit = Math.abs(
                      Number(item.credit || 0)
                    );

                    debit = Math.abs(
                      Number(item.debit || 0)
                    );
                  }

                  // EVERY type affects closing
                  runningBalance =
                    runningBalance + credit - debit;

                  const closing = Number(
                    runningBalance.toFixed(2)
                  );

                  return {
                    ...item,

                    credit,
                    debit,

                    pts: closing,
                    closing,
                  };
                });


              const openingBalanceRow = {
                _id: "opening_balance",
                marketId: "opening_balance",

                statementType: "opening",

                statementDate: startDate,
                createdAt: startDate,
                updatedAt: startDate,
                lastUpdated: startDate,

                credit: 0,
                debit: 0,
                amount: 0,

                pts: Number(
                  openingBalance.toFixed(2)
                ),

                remarks: `Opening Balance as of ${startDate.toLocaleDateString(
                  "en-GB"
                )}`,

                description: `Opening Balance as of ${startDate.toLocaleDateString(
                  "en-GB"
                )}`,

                totalProfit: 0,
                totalAmount: 0,
                bets: [],

                isSynthetic: true,
              };


              const completeData = [
                openingBalanceRow,
                ...dataWithClosing,
              ];

              const totalCount = completeData.length;

              const totalPages = Math.ceil(
                totalCount / limit
              );

              const paginatedData = completeData.slice(
                skip,
                skip + limit
              );

              const formattedData = paginatedData.map((item) => ({
                ...item,

                statementDate: formatIST(item.statementDate),
                createdAt: formatIST(item.createdAt),
                updatedAt: formatIST(item.updatedAt),
                lastUpdated: formatIST(item.lastUpdated),

                bets: item.bets?.map((bet) => ({
                  ...bet,

                  statementDate: formatIST(bet.statementDate),
                  createdAt: formatIST(bet.createdAt),
                  updatedAt: formatIST(bet.updatedAt),
                  lastUpdated: formatIST(bet.lastUpdated),
                  newCreatedAt: formatIST(bet.newCreatedAt),
                })),
              }));

                return res.status(httpStatus.OK).send(
                  new APIResponse(
                    {
                      data: formattedData,
                      totalCount,
                      totalPages,
                      currentPage: page,
                    },
                    "All account statement fetched successfully",
                    httpStatus.OK
                  )
                );
        }
        // 2. Market Aggregation for Pagination
        // const matchQuery = {
        //   userId: { $in: allIds },
        //   subType: { $exists: isCasino },
        //   status: { $in: ["won", "lost"] },
        //   updatedAt: { $gte: startDate, $lte: endDate },
        //   isDeleteBetShowUser: { $ne: true },
        // };
        const matchQuery = {
            userId: { $in: allIds },

            // ...(isCasino
            //   ? {
            //       $or: [
            //         { subType: { $exists: true } },
            //         { gType: { $in: specialCasinoGTypes } },
            //       ],
            //     }

            ...(isCasino
              ? {
                  $or: [
                    { subType: { $exists: true } },
                    { gType: { $in: specialCasinoGTypes } },
                    { gType: { $regex: specialCasinoRegex } },
                    { marketName: { $regex: specialCasinoMarketRegex } },
                    { eventName: { $regex: specialCasinoMarketRegex } },
                  ],
                }
             : {
                $and: [
                  { subType: { $exists: false } },

                  // Special Casino games ko Sports se completely exclude karo
                  {
                    $nor: [
                      { gType: { $regex: specialCasinoRegex } },
                      { marketName: { $regex: specialCasinoMarketRegex } },
                      { eventName: { $regex: specialCasinoMarketRegex } },
                    ],
                  },
                ],
              }),

            status: { $in: ["won", "lost","cancelled"] },
            updatedAt: { $gte: startDate, $lte: endDate },
            isDeleteBetShowUser: { $ne: true },
          };

        const marketAggregation = await Bet.aggregate([
          { $match: matchQuery },
          {
            $group: {
              _id: "$marketId",
              lastUpdated: { $max: "$updatedAt" }
            }
          },//popup chnage
        
          //{ $sort: { lastUpdated: -1 } },
          { $sort: { lastUpdated: 1 } },
          {
            $facet: {
              metadata: [{ $count: "total" }],
              data: [{ $skip: skip }, { $limit: limit }]
            }
          }
        ]);

        const totalCount = marketAggregation[0]?.metadata[0]?.total || 0;
        const totalPages = Math.ceil(totalCount / limit);

        // // Get the marketIds for this page
        const targetMarketIds = marketAggregation[0]?.data.map(m => m._id) || [];

        // Fetch bets ONLY for these markets
        const bets = targetMarketIds.length > 0 ? await Bet.find({
          ...matchQuery,
          marketId: { $in: targetMarketIds }
       // }).sort({ updatedAt: -1 }).lean() : [];//popup change
       }).sort({ updatedAt: 1, _id: 1 }).lean() : [];


        const uniqueIps = [
          ...new Set(
            bets
              .map((bet) => bet.ipAddress || bet.ip)
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
          uniqueIps.map(async (ip) => {
            try {
              const response = await axios.get(
                `http://ip-api.com/json/${encodeURIComponent(ip)}`,
                {
                  params: {
                    fields:
                      "status,message,query,city,country,mobile",
                  },
                  timeout: 5000,
                }
              );

              if (response.data?.status === "success") {
                ipDetailsMap.set(ip, {
                  ip: response.data.query || ip,
                  city: response.data.city || "",
                  country: response.data.country || "",
                  mobile: Boolean(response.data.mobile),
                });
              }
            } catch (error) {
              console.log(
                `IP details not found for ${ip}:`,
                error.message
              );
            }
          })
        );

        bets.forEach((bet) => {
          const ip = bet.ipAddress || bet.ip || "";

          bet.ipAddress = ip;

          bet.ipDetails =
            ipDetailsMap.get(ip) || {
              ip,
              city:
                ip === "127.0.0.1" || ip === "::1"
                  ? "Localhost"
                  : "",
              country: "",
              mobile: false,
            };
        });

              

        const historicalAgg = await Bet.aggregate([
          {
            $match: {
              userId: { $in: allIds },
             // subType: { $exists: isCasino },
             ...(isCasino
                ? {
                    // $or: [
                    //   { subType: { $exists: true } },
                    //   { gType: { $in: specialCasinoGTypes } },
                    // ],
                    $or: [
                      { subType: { $exists: true } },
                      { gType: { $in: specialCasinoGTypes } },
                      { gType: { $regex: specialCasinoRegex } },
                      { marketName: { $regex: specialCasinoMarketRegex } },
                      { eventName: { $regex: specialCasinoMarketRegex } },
                    ],
                  }
               : {
                  $and: [
                    { subType: { $exists: false } },
                    {
                      $nor: [
                        { gType: { $regex: specialCasinoRegex } },
                        { marketName: { $regex: specialCasinoMarketRegex } },
                        { eventName: { $regex: specialCasinoMarketRegex } },
                      ],
                    },
                  ],
                }),
              status: { $in: ["won", "lost"] },
              updatedAt: { $lt: startDate },
              isDeleteBetShowUser: { $ne: true },
            }
          },
          {
            $group: {
              _id: "$userId",
              totalProfit: { $sum: "$profit" }
            }
          }
        ]);

        const skippedAgg = [];
        if (skip > 0) {
          const skippedMarketsPipeline = [
            { $match: matchQuery },
            {
              $group: {
                _id: "$marketId",
                lastUpdated: { $max: "$updatedAt" }
              }
            },
            //{ $sort: { lastUpdated: -1 } },
            { $sort: { lastUpdated: 1 } },
            { $limit: skip },
            { $project: { _id: 1 } }
          ];
            const skippedMarketIdsResult = await Bet.aggregate(skippedMarketsPipeline);
            
            const skippedMarketIds = skippedMarketIdsResult.map(m => m._id);

            if (skippedMarketIds.length > 0) {
              const skipBetsAgg = await Bet.aggregate([
                // {
                //   $match: {
                //     marketId: { $in: skippedMarketIds },
                //     userId: { $in: allIds },
                //     status: { $in: ["won", "lost"] }
                //   }
                // },//popup change
                  {
                    $match: {
                      marketId: { $in: skippedMarketIds },
                      userId: { $in: allIds },
                     // subType: { $exists: isCasino },
                     ...(isCasino
                      ? {
                          // $or: [
                          //   { subType: { $exists: true } },
                          //   { gType: { $in: specialCasinoGTypes } },
                          // ],
                          $or: [
                            { subType: { $exists: true } },
                            { gType: { $in: specialCasinoGTypes } },
                            { gType: { $regex: specialCasinoRegex } },
                            { marketName: { $regex: specialCasinoMarketRegex } },
                            { eventName: { $regex: specialCasinoMarketRegex } },
                          ],
                        }
                     : {
                        $and: [
                          { subType: { $exists: false } },
                          {
                            $nor: [
                              { gType: { $regex: specialCasinoRegex } },
                              { marketName: { $regex: specialCasinoMarketRegex } },
                              { eventName: { $regex: specialCasinoMarketRegex } },
                            ],
                          },
                        ],
                      }),
                      status: { $in: ["won", "lost"] },
                      updatedAt: {
                        $gte: startDate,
                        $lte: endDate,
                      },
                      isDeleteBetShowUser: { $ne: true },
                    }
                  },

          
                {
                  $group: {
                    _id: "$userId",
                    totalProfit: { $sum: "$profit" }
                  }
                }
              ]);
              skippedAgg.push(...skipBetsAgg);
            }
          }

        // Collect all relevant user IDs with safety checks
        const currentBetUserIds = [...new Set(bets.filter(b => b.userId).map(b => b.userId.toString()))];
        const historicalUserIds = historicalAgg.filter(u => u._id).map(u => u._id.toString());
        const skippedUserIds = skippedAgg.filter(u => u._id).map(u => u._id.toString());
        const allRelevantUserIds = [...new Set([...currentBetUserIds, ...historicalUserIds, ...skippedUserIds])];

        const usersList = await User.find({ _id: { $in: allRelevantUserIds } }).lean();
        const uniqueUserMap = new Map();
        usersList.forEach(u => uniqueUserMap.set(u._id.toString(), u));

        bets.forEach(bet => {
          if (bet.userId) bet.user = uniqueUserMap.get(bet.userId.toString());
        });

        const userCommissionMap = new Map();
        const memoizedCommissionList = new Map();

        usersList.forEach((userObj) => {
          const uId = userObj._id.toString();
          let commission = 0;

          // --- In-Memory version of getUserCommissionHierarchyFast ---
          if (!memoizedCommissionList.has(uId)) {
            const commissionList = [];
            let child = userObj;
            while (child && child.parent) {
              const parent = hierarchyUserMap.get(child.parent.toString());
              if (!parent) break;

              let pRec;
              if (parent.role === "owner") {
                pRec = allPartnerships.find(p => p.userId.toString() === parent._id.toString() && p.partnerId.toString() === child._id.toString());
              } else {
                pRec = allPartnerships.find(p => p.userId.toString() === parent._id.toString() && p.partnerId.toString() === (parent.parent ? parent.parent.toString() : ""));
              }

              commissionList.push({
                parentId: parent._id,
                role: parent.role,
                parentName: parent.username,
                childId: child._id,
                childName: child.username,
                commission: pRec?.commission ?? (child.role === "user" ? 100 : 0),
                downLineCommission: pRec?.downLineCommission || 0,
              });
              child = parent;
            }
            memoizedCommissionList.set(uId, commissionList);
          }

          const commissionList = memoizedCommissionList.get(uId);
          // -----------------------------------------------------------

          const isOwnBet = userObj._id.toString() === currentUser._id.toString();

          if (isOwnBet) {
            // POV user's own bets: what they keep
            commission = commissionList.length > 0 ? commissionList[0].commission : 100;
          } else if (currentUser.role === "owner") {
            const ownerEntry = commissionList.find((item) => item?.role === "owner");
            if (ownerEntry) {
              const childEntry = commissionList.find(
                (c) => c.parentId.toString() === ownerEntry.childId.toString()
              );
              const childReceive = childEntry ? childEntry.downLineCommission : 0;
              commission = 100 - childReceive;
            } else {
              const adminEntry = commissionList.find((c) => c.role === "admin");
              if (adminEntry) {
                commission = 100 - (adminEntry.downLineCommission || 0);
              } else {
                commission = 100;
              }
            }
          } else {
            const myEntry = commissionList?.find((item) => item?.role === currentUser.role);
            if (myEntry) {
              const myReceive = myEntry.downLineCommission || 0;
              const childEntry = commissionList.find(
                (c) => c.parentId.toString() === myEntry.childId.toString()
              );
              const childReceive = childEntry ? childEntry.downLineCommission : 0;
              commission = myReceive - childReceive;
            }
          }

          if (commission < 0) commission = 0;
          commission = Number(commission.toFixed(2));
          userCommissionMap.set(uId, commission);
        });

        const calculateWeightedTotal = (aggArray) => {
          return aggArray.reduce((acc, item) => {
            if (!item._id) return acc;
            const userId = item._id.toString();
            const commission = userCommissionMap.get(userId) || 0;
            const profit = item.totalProfit || 0;

            // Own bet: win is win. Downline bet: their win is our loss.
            const isOwnBet = userId === currentUser._id.toString();
            const actualProfit = isOwnBet ? profit : -1 * profit;

            const commissionApplied = Number((actualProfit * (commission / 100)).toFixed(2));
            return acc + commissionApplied;
          }, 0);
        };


        const historicalTotal = historicalAgg.reduce(
          (total, item) =>
            total + Number(item.totalProfit || 0),
          0
        );

        const skippedTotal = skippedAgg.reduce(
          (total, item) =>
            total + Number(item.totalProfit || 0),
          0
        );

        const openingBalance =
          Number(historicalTotal || 0) +
          Number(skippedTotal || 0);
            
            let openingBalanceDate = startDate;
            if (skip > 0) {
              const previousLastMarket = await Bet.aggregate([
                { $match: matchQuery },
                {
                  $group: {
                    _id: "$marketId",
                    lastUpdated: { $max: "$updatedAt" },
                  },
                },
                { $sort: { lastUpdated: 1 } },
                { $limit: skip },
                { $sort: { lastUpdated: -1 } },
                { $limit: 1 },
              ]);

              if (previousLastMarket.length > 0) {
                openingBalanceDate =
                  previousLastMarket[0].lastUpdated;
              }
            }

        const groupedByMarket = {};

          for (const bet of bets) {
            if (!bet.user) continue;

            const marketId = bet.marketId;

              const sectionName = String(
                bet.sectionName || ""
              ).trim();

              const marketType = String(
                bet.marketName || bet.gType || ""
              ).toLowerCase();

              const isBookmaker = marketType.includes("bookmaker");

              // Bookmaker -> same marketId ki ek row
              // Baaki sab -> OLD logic same
              const groupKey = isBookmaker
                ? String(marketId)
                : isCasino
                  ? String(marketId)
                  : `${String(marketId)}__${sectionName}`;

            if (!groupedByMarket[groupKey]) {
              groupedByMarket[groupKey] = {
                marketId,
                sectionName,
                totalProfit: 0,
                totalAmount: 0,
                bets: [],
                lastUpdated:
                  bet.updatedAt || bet.createdAt,
              };
            }

            const actualProfit = Number(bet.profit || 0);
            const betAmount = Number(bet.amount || 0);

            groupedByMarket[groupKey].totalProfit += actualProfit;
            groupedByMarket[groupKey].totalAmount += betAmount;

            bet.partnershipProfit = actualProfit;

            if (bet.user?.parent) {
              const parentUser = uniqueUserMap.get(
                bet.user.parent.toString()
              );

              if (parentUser) {
                bet.parentUsername = parentUser.username;
              }
            }

            groupedByMarket[groupKey].bets.push(bet);

            const currentUpdatedAt = new Date(
              bet.updatedAt || bet.createdAt
            ).getTime();

            const groupedUpdatedAt = new Date(
              groupedByMarket[groupKey].lastUpdated
            ).getTime();

            if (currentUpdatedAt > groupedUpdatedAt) {
              groupedByMarket[groupKey].lastUpdated =
                bet.updatedAt || bet.createdAt;
            }
          }


        
        let finalData = Object.values(groupedByMarket);

        const commissionTransactions = await Transaction.find({
          userId: currentUser._id,
          createdAt: {
            $gte: startDate,
            $lte: endDate,
          },
          status: { $in: ["approved", "pending"] },
          type: isCasino ? "casino-commission" : "commission",
        }).lean();

        const commissionData = commissionTransactions.map((transaction) => {
          const amount = Number(transaction.amount || 0);

          return {
            ...transaction,

            marketId: `commission_${transaction._id}`,
            statementType: "account",

            statementDate:
              transaction.createdAt || transaction.updatedAt,

            createdAt:
              transaction.createdAt || transaction.updatedAt,

            updatedAt:
              transaction.createdAt || transaction.updatedAt,

            lastUpdated:
              transaction.createdAt || transaction.updatedAt,

            totalProfit: amount,
            totalAmount: 0,

            credit: amount > 0 ? Math.abs(amount) : 0,
            debit: amount < 0 ? Math.abs(amount) : 0,

            amount,

            pts: 0,
            closing: 0,

            bets: [],

            remarks:
              transaction.remarks ||
              transaction.adminRemarks ||
              "Commission",
          };
        });

        finalData.push(...commissionData);

        // if (type !== "casino" ) {
        //     finalData.push(...commissionData);
        // }

        // finalData.sort(
        //   (a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated)
        // );
        finalData.sort(
          (a, b) => new Date(a.lastUpdated) - new Date(b.lastUpdated)
        );

        // let runningTotal = openingBalance;
        // finalData = finalData.map((item) => {
        //   runningTotal += item.totalProfit;

        //   return {
        //     ...item,
        //     pts: Number(runningTotal.toFixed(2)),
        //   };
        // });

      //  let runningTotal = Number(openingBalance || 0);

      //   const shouldShowZero =
      //     String(currentUser?.role || "").toLowerCase() !== "user";

      //   finalData = finalData.map((item) => {
      //     const profit = Number(item.totalProfit || 0);

      //     runningTotal += profit;

      //     return {
      //       ...item,
      //       totalProfit: shouldShowZero ? 0 : profit,

      //       credit: shouldShowZero
      //         ? 0
      //         : profit > 0
      //         ? Math.abs(profit)
      //         : 0,

      //       debit: shouldShowZero
      //         ? 0
      //         : profit < 0
      //         ? Math.abs(profit)
      //         : 0,

      //       pts: shouldShowZero
      //         ? 0
      //         : Number(runningTotal.toFixed(2)),

      //       closing: shouldShowZero
      //         ? 0
      //         : Number(runningTotal.toFixed(2)),
      //     };
      //   });
      
        const shouldShowZero =
          String(currentUser?.role || "").toLowerCase() !== "user";

       let runningTotal = Number(openingBalance || 0);

        finalData = finalData.map((item) => {
          const profit = Number(item.totalProfit || 0);

          runningTotal += profit;

          return {
            ...item,

            totalProfit: profit,

            credit:
              profit > 0
                ? Math.abs(profit)
                : 0,

            debit:
              profit < 0
                ? Math.abs(profit)
                : 0,

            pts: Number(runningTotal.toFixed(2)),

            closing: Number(runningTotal.toFixed(2)),
          };
        });

        finalData.sort(
          (a, b) => new Date(a.lastUpdated) - new Date(b.lastUpdated)
        );

        finalData = [
          {
            marketId: "opening_balance",
            totalProfit: 0,
            totalAmount: 0,
            bets: [],
            //lastUpdated: startDate,
            lastUpdated: openingBalanceDate,
            //pts: Number(openingBalance.toFixed(2)),
           credit: 0,
            debit: 0,

            pts: shouldShowZero
              ? 0
              : Number(openingBalance.toFixed(2)),

            closing: shouldShowZero
              ? 0
              : Number(openingBalance.toFixed(2)),
            remarks: `Opening Balance as of ${new Date(
                openingBalanceDate
              ).toLocaleString("en-GB", {
                timeZone: "Asia/Kolkata",
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
              })}`,
            isSynthetic: true,
          },
          ...finalData,
        ];

        const formattedFinalData = finalData.map((item) => ({
          ...item,

          statementDate: formatIST(item.statementDate),
          createdAt: formatIST(item.createdAt),
          updatedAt: formatIST(item.updatedAt),
          lastUpdated: formatIST(item.lastUpdated),

          bets: item.bets?.map((bet) => ({
            ...bet,

            statementDate: formatIST(bet.statementDate),
            createdAt: formatIST(bet.createdAt),
            updatedAt: formatIST(bet.updatedAt),
            lastUpdated: formatIST(bet.lastUpdated),
            newCreatedAt: formatIST(bet.newCreatedAt),
          })),
        }));

        res.status(httpStatus.OK).send(
          new APIResponse(
            { data: formattedFinalData, totalCount, totalPages, currentPage: page },
            "Admin account statement fetched successfully",
            httpStatus.OK
          )
        );
      } catch (err) {
        next(err);
      }
};


const getShortxAdminAccountStatement = async (req, res, next) => {
  try {
    const id = req?.user?._id;
    const type = req?.query?.type;
    const clientId = req?.query?.clientId;

    const from = req?.query?.fromDate
      ? new Date(req.query.fromDate)
      : null;

    const to = req?.query?.toDate
      ? new Date(req.query.toDate)
      : null;

    const targetUserId = clientId ?? id;

    const currentUser = await User.findById(targetUserId).lean();

    if (!currentUser) {
      return res
        .status(httpStatus.NOT_FOUND)
        .send(
          new APIResponse(
            {},
            "User not found",
            httpStatus.NOT_FOUND
          )
        );
    }

    const isCasino = type === "casino";
    const isCrash = type === "crash";

    // =====================================================
    // SPECIAL CASINO GAMES
    // =====================================================
    const specialCasinoGTypes = [
      "superover3",
      "superover",
      "superover2",
      "cricketv3",
    ];

    const specialCasinoRegex =
      /^(superover3|superover|superover2|cricketv3)$/i;

    const specialCasinoMarketRegex =
      /super\s\*over/i;

    // =====================================================
    // DATE RANGE
    // =====================================================
    const now = new Date();

    const startDate =
      from ||
      new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
        0,
        0,
        0,
        0
      );

    const endDate =
      to ||
      new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999
      );

    // =====================================================
    // HIERARCHY
    // =====================================================
    const hierarchyResult = await User.aggregate([
      {
        $match: {
          _id: currentUser._id,
        },
      },
      {
        $graphLookup: {
          from: "users",
          startWith: "$_id",
          connectFromField: "_id",
          connectToField: "parent",
          as: "descendants",
        },
      },
      {
        $graphLookup: {
          from: "users",
          startWith: "$parent",
          connectFromField: "parent",
          connectToField: "_id",
          as: "ancestors",
        },
      },
    ]);

    const hierarchyData = hierarchyResult[0] || {};

    const descendants =
      hierarchyData.descendants || [];

    const ancestors =
      hierarchyData.ancestors || [];

    const allHierarchyUsers = [
      currentUser,
      ...descendants,
      ...ancestors,
    ];

    const allHierarchyUserIds =
      allHierarchyUsers.map((u) => u._id);

    const allDescendantIds =
      descendants.map((d) => d._id);

    const allIds = [
      currentUser._id,
      ...allDescendantIds,
    ];

    const hierarchyUserMap = new Map();

    allHierarchyUsers.forEach((u) => {
      hierarchyUserMap.set(
        u._id.toString(),
        u
      );
    });

    // =====================================================
    // PARTNERSHIPS
    // =====================================================
    const allPartnerships =
      await Partnership.find({
        $or: [
          {
            userId: {
              $in: allHierarchyUserIds,
            },
          },
          {
            partnerId: {
              $in: allHierarchyUserIds,
            },
          },
        ],
      }).lean();

    // =====================================================
    // PAGINATION
    // =====================================================
    const page =
      parseInt(req.query.page) || 1;

    const limit =
      parseInt(req.query.limit) || 25;

    const skip =
      (page - 1) * limit;

    // =====================================================
    // ACCOUNT
    // =====================================================
    if (type === "account") {
      const transactionQuery = {
        userId: currentUser._id,

        createdAt: {
          $gte: startDate,
          $lte: endDate,
        },

        status: {
          $in: [
            "approved",
            "pending",
          ],
        },

        type: {
          $nin: [
            "correction",
            "reconciliation",
            "commission",
            "casino-commission",
          ],
        },
      };

      const totalCount =
        await Transaction.countDocuments(
          transactionQuery
        );

      const transactions =
        await Transaction.find(
          transactionQuery
        )
          .sort({
            createdAt: 1,
            _id: 1,
          })
          .skip(skip)
          .limit(limit)
          .populate(
            "userId",
            "username role parent"
          )
          .populate(
            "createdBy",
            "username role"
          )
          .lean();

      // =====================================================
      // OPENING BALANCE
      // =====================================================
      const openingTransactions =
        await Transaction.find({
          userId: currentUser._id,

          createdAt: {
            $lt: startDate,
          },

          status: {
            $in: [
              "approved",
              "pending",
            ],
          },

          type: {
            $nin: [
              "correction",
              "reconciliation",
              "commission",
              "casino-commission",
            ],
          },
        }).lean();

      let openingBalance = 0;

      for (const transaction of openingTransactions) {
        openingBalance += Number(
          transaction.amount || 0
        );
      }

      // =====================================================
      // PREVIOUS PAGE TRANSACTIONS
      // =====================================================
      if (skip > 0) {
        const previousTransactions =
          await Transaction.find(
            transactionQuery
          )
            .sort({
              createdAt: 1,
              _id: 1,
            })
            .limit(skip)
            .lean();

        for (const transaction of previousTransactions) {
          openingBalance += Number(
            transaction.amount || 0
          );
        }
      }

      // =====================================================
      // TRANSACTION DATA
      // =====================================================
      const receiverTransactions =
        await Transaction.find({
          receiverId: currentUser._id,
        }).lean();

      const specialCounterTransactions =
        await Transaction.find({
          $or: [
            {
              senderId: currentUser._id,
            },
            {
              receiverId: currentUser._id,
            },
          ],
        }).lean();

      const statementData =
        transactions.map((transaction) => {
          const amount = Number(
            transaction.amount || 0
          );

          let fromTo = "";

          const sender =
            transaction.senderId
              ? hierarchyUserMap.get(
                  transaction.senderId.toString()
                )
              : null;

          const receiver =
            transaction.receiverId
              ? hierarchyUserMap.get(
                  transaction.receiverId.toString()
                )
              : null;

          if (sender) {
            fromTo = sender.username;
          }

          if (receiver) {
            fromTo = receiver.username;
          }

          return {
            ...transaction,

            marketId:
              `transaction_${transaction._id}`,

            statementType: "account",

            statementDate:
              transaction.createdAt ||
              transaction.updatedAt,

            lastUpdated:
              transaction.createdAt ||
              transaction.updatedAt,

            totalProfit: amount,

            totalAmount: 0,

            credit:
              amount > 0
                ? Math.abs(amount)
                : 0,

            debit:
              amount < 0
                ? Math.abs(amount)
                : 0,

            amount,

            pts: 0,

            closing: 0,

            bets: [],

            fromTo,

            remarks:
              transaction.remarks ||
              transaction.adminRemarks ||
              transaction.type ||
              "Account",
          };
        });

      let runningTotal =
        Number(openingBalance || 0);

      const finalData =
        statementData.map((item) => {
          const profit =
            Number(item.totalProfit || 0);

          runningTotal += profit;

          return {
            ...item,

            totalProfit: profit,

            credit:
              profit > 0
                ? Math.abs(profit)
                : 0,

            debit:
              profit < 0
                ? Math.abs(profit)
                : 0,

            pts: Number(
              runningTotal.toFixed(2)
            ),

            closing: Number(
              runningTotal.toFixed(2)
            ),
          };
        });

      finalData.unshift({
        marketId: "opening_balance",

        totalProfit: 0,

        totalAmount: 0,

        bets: [],

        lastUpdated: startDate,

        credit: 0,

        debit: 0,

        pts: Number(
          openingBalance.toFixed(2)
        ),

        closing: Number(
          openingBalance.toFixed(2)
        ),

        remarks:
          `Opening Balance as of ${new Date(
            startDate
          ).toLocaleString("en-GB", {
            timeZone: "Asia/Kolkata",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          })}`,

        isSynthetic: true,
      });

      const formattedFinalData =
        finalData.map((item) => ({
          ...item,

          statementDate: item.statementDate
            ? formatIST(item.statementDate)
            : null,

          createdAt: item.createdAt
            ? formatIST(item.createdAt)
            : null,

          updatedAt: item.updatedAt
            ? formatIST(item.updatedAt)
            : null,

          lastUpdated: item.lastUpdated
            ? formatIST(item.lastUpdated)
            : null,
        }));

      return res
        .status(httpStatus.OK)
        .send(
          new APIResponse(
            {
              data: formattedFinalData,
              totalCount,
              totalPages:
                Math.ceil(
                  totalCount / limit
                ),
              currentPage: page,
            },
            "Account statement fetched successfully",
            httpStatus.OK
          )
        );
    }

    // =====================================================
    // CRASH
    // =====================================================
    if (isCrash) {
      const crashQuery = {
        userId: currentUser._id,

        createdAt: {
          $gte: startDate,
          $lte: endDate,
        },

        status: {
          $in: [
            "approved",
            "pending",
          ],
        },

        type: "softapi",
      };

      const totalCount =
        await Transaction.countDocuments(
          crashQuery
        );

      const transactions =
        await Transaction.find(
          crashQuery
        )
          .sort({
            createdAt: 1,
            _id: 1,
          })
          .skip(skip)
          .limit(limit)
          .lean();

      const data =
        transactions.map((t) => {
          const amount =
            Number(t.amount || 0);

          return {
            ...t,

            marketId:
              `crash_${t._id}`,

            statementType: "account",

            statementDate:
              t.createdAt ||
              t.updatedAt,

            lastUpdated:
              t.createdAt ||
              t.updatedAt,

            totalProfit: amount,

            totalAmount: 0,

            credit:
              amount > 0
                ? Math.abs(amount)
                : 0,

            debit:
              amount < 0
                ? Math.abs(amount)
                : 0,

            amount,

            pts: Number(
              t.balanceAfter || 0
            ),

            closing: Number(
              t.balanceAfter || 0
            ),

            bets: [],

            remarks:
              t.remarks ||
              t.adminRemarks ||
              "Crash",
          };
        });

      return res
        .status(httpStatus.OK)
        .send(
          new APIResponse(
            {
              data,
              totalCount,
              totalPages:
                Math.ceil(
                  totalCount / limit
                ),
              currentPage: page,
            },
            "Crash statement fetched successfully",
            httpStatus.OK
          )
        );
    }

    // =====================================================
    // ALL
    // =====================================================
    if (type === "All") {
      const betQuery = {
        userId: {
          $in: allIds,
        },

        status: {
          $in: [
            "won",
            "lost",
            "cancelled",
          ],
        },

        updatedAt: {
          $gte: startDate,
          $lte: endDate,
        },

        isDeleteBetShowUser: {
          $ne: true,
        },
      };

      const transactionQuery = {
        userId: currentUser._id,

        createdAt: {
          $gte: startDate,
          $lte: endDate,
        },

        status: {
          $in: [
            "approved",
            "pending",
          ],
        },

        type: {
          $nin: [
            "correction",
            "reconciliation",
             "commission",
            "casino-commission",
          ],
        },
      };

      const historicalBetQuery = {
        ...betQuery,

        updatedAt: {
          $lt: startDate,
        },

        status: {
          $in: [
            "won",
            "lost",
          ],
        },
      };

      const historicalTransactionQuery = {
        ...transactionQuery,

        createdAt: {
          $lt: startDate,
        },
      };

      const [
        bets,
        transactions,
        historicalBets,
        historicalTransactions,
      ] = await Promise.all([
        Bet.find(betQuery)
          .populate(
            "userId",
            "username role parent"
          )
          .sort({
            updatedAt: 1,
            _id: 1,
          })
          .lean(),

        Transaction.find(
          transactionQuery
        )
          .sort({
            createdAt: 1,
            _id: 1,
          })
          .lean(),

        Bet.find(
          historicalBetQuery
        )
          .lean(),

        Transaction.find(
          historicalTransactionQuery
        )
          .lean(),
      ]);

      // =====================================================
      // OPENING BALANCE
      // =====================================================
      let openingBalance = 0;

      for (const bet of historicalBets) {
        openingBalance += Number(
          bet.profit || 0
        );
      }

      for (const transaction of historicalTransactions) {
        openingBalance += Number(
          transaction.amount || 0
        );
      }

      // =====================================================
        // TOTAL PARTNERSHIP VALUE
        // CURRENT USER + UPPER PARENT HIERARCHY
        // =====================================================

        let totalPartnershipValue = 0;

        let partnershipUser = currentUser;

        while (partnershipUser) {
          totalPartnershipValue += Number(
            partnershipUser.partnershipValue || 0
          );

          if (!partnershipUser.parent) {
            break;
          }

          partnershipUser = hierarchyUserMap.get(
            partnershipUser.parent.toString()
          );
        }

        console.log(
          "ALL TOTAL PARTNERSHIP VALUE:",
          totalPartnershipValue
        );



      // =====================================================
      // GROUP ALL BETS
      // =====================================================
      const groupedBetData = {};

      for (const bet of bets) {
        const marketId = bet.marketId;

        const sectionName =
          String(
            bet.sectionName || ""
          ).trim();

        // const marketType =
        //   String(
        //     bet.marketName ||
        //       bet.gType ||
        //       ""
        //   ).toLowerCase();

        // const isBookmaker =
        //   marketType.includes(
        //     "bookmaker"
        //   );

        // const groupKey =
        //   isBookmaker
        //     ? String(marketId)
        //     : bet.subType
        //       ? String(marketId)
        //       : `${String(
        //           marketId
        //         )}__${sectionName}`;

        const marketType = String(
          bet.marketName ||
          bet.gType ||
          ""
        ).toLowerCase();

        const isCasinoBet =
          Boolean(bet.subType) ||
          specialCasinoGTypes.includes(
            String(bet.gType || "").toLowerCase()
          ) ||
          specialCasinoRegex.test(
            String(bet.gType || "")
          ) ||
          specialCasinoMarketRegex.test(
            String(bet.marketName || "")
          ) ||
          specialCasinoMarketRegex.test(
            String(bet.eventName || "")
          );

        const etid = bet.etid ?? "";
        const gameId = bet.gameId ?? "";

        const groupKey = isCasinoBet
          ? String(marketId)
          : `${String(etid)}__${String(gameId)}`;

        if (
          !groupedBetData[groupKey]
        ) {
          groupedBetData[groupKey] = {
            ...bet,

            marketId,

            sectionName,
            eventName:
            bet.eventName ||
            bet.sectionName ||
            "",

            totalProfit: 0,

            totalAmount: 0,

            bets: [],

            lastUpdated:
              bet.updatedAt ||
              bet.createdAt,
          };
        }

        // const actualProfit =
        //   Number(
        //     bet.profit || 0
        //   );

            const originalProfit = Number(
              bet.profit || 0
            );

            const actualProfit = Number(
              (
                originalProfit *
                totalPartnershipValue /
                100
              ).toFixed(2)
            );

        const betAmount =
          Number(
            bet.amount || 0
          );

        groupedBetData[
          groupKey
        ].totalProfit +=
          actualProfit;

        groupedBetData[
          groupKey
        ].totalAmount +=
          betAmount;

        bet.partnershipProfit =
          actualProfit;

        if (bet.user?.parent) {
          const parentUser =
            hierarchyUserMap.get(
              bet.user.parent.toString()
            );

          if (parentUser) {
            bet.parentUsername =
              parentUser.username;
          }
        }

        groupedBetData[
          groupKey
        ].bets.push(bet);

        const currentUpdatedAt =
          new Date(
            bet.updatedAt ||
              bet.createdAt
          ).getTime();

        const groupedUpdatedAt =
          new Date(
            groupedBetData[
              groupKey
            ].lastUpdated
          ).getTime();

        if (
          currentUpdatedAt >
          groupedUpdatedAt
        ) {
          groupedBetData[
            groupKey
          ].lastUpdated =
            bet.updatedAt ||
            bet.createdAt;
        }
      }

      let finalData =
        Object.values(
          groupedBetData
        );

      // =====================================================
      // TRANSACTIONS
      // =====================================================
      const transactionData =
        transactions.map(
          (transaction) => {
            const amount =
              Number(
                transaction.amount ||
                  0
              );

            return {
              ...transaction,

              marketId:
                `transaction_${transaction._id}`,

              statementType:
                "account",

              statementDate:
                transaction.createdAt ||
                transaction.updatedAt,

              lastUpdated:
                transaction.createdAt ||
                transaction.updatedAt,

              totalProfit: amount,

              totalAmount: 0,

              credit:
                amount > 0
                  ? Math.abs(amount)
                  : 0,

              debit:
                amount < 0
                  ? Math.abs(amount)
                  : 0,

              amount,

              pts: 0,

              closing: 0,

              bets: [],

              remarks:
                transaction.remarks ||
                transaction.adminRemarks ||
                transaction.type ||
                "Account",
            };
          }
        );

      finalData.push(
        ...transactionData
      );

      // =====================================================
  // REMOVE ITEMS HAVING NO TITLE
  // =====================================================

  const getTitle = (item) => {
    return String(
      item.eventName ||
      item.sectionName ||
      item.marketName ||
      ""
    ).trim();
  };

    // Check and log items where title is missing
    const missingTitleItems = finalData.filter((item) => {
      return !getTitle(item);
    });

    finalData = finalData.filter((item) => {
      return getTitle(item) !== "";
      });



      finalData.sort(
        (a, b) =>
          new Date(
            a.lastUpdated
          ) -
          new Date(
            b.lastUpdated
          )
      );

      // let runningTotal =
      //   Number(
      //     openingBalance || 0
      //   );

      // =====================================================
      // PAGINATION FOR ALL
      // =====================================================
      const allTotalCount = finalData.length;

      // Previous page ka profit running balance me include rahe
      const previousPageProfit = finalData
        .slice(0, skip)
        .reduce(
          (sum, item) =>
            sum + Number(item.totalProfit || 0),
          0
        );

      let runningTotal =
        Number(openingBalance || 0) +
        previousPageProfit;

      // Current page only
      finalData = finalData.slice(
        skip,
        skip + limit
      );

      finalData =
        finalData.map((item) => {
          const profit =
            Number(
              item.totalProfit || 0
            );

          runningTotal +=
            profit;

          return {
            ...item,

            totalProfit:
              profit,

            credit:
              profit > 0
                ? Math.abs(profit)
                : 0,

            debit:
              profit < 0
                ? Math.abs(profit)
                : 0,

            pts: Number(
              runningTotal.toFixed(
                2
              )
            ),

            closing: Number(
              runningTotal.toFixed(
                2
              )
            ),
          };
        });

      finalData.unshift({
        marketId:
          "opening_balance",

        totalProfit: 0,

        totalAmount: 0,

        bets: [],

        lastUpdated:
          startDate,

        credit: 0,

        debit: 0,

        pts: Number(
          openingBalance.toFixed(
            2
          )
        ),

        closing: Number(
          openingBalance.toFixed(
            2
          )
        ),

        remarks:
          `Opening Balance as of ${new Date(
            startDate
          ).toLocaleString(
            "en-GB",
            {
              timeZone:
                "Asia/Kolkata",
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            }
          )}`,

        isSynthetic: true,
      });

      const formattedFinalData =
        finalData.map((item) => ({
          ...item,

          statementDate:
            item.statementDate
              ? formatIST(
                  item.statementDate
                )
              : null,

          createdAt:
            item.createdAt
              ? formatIST(
                  item.createdAt
                )
              : null,

          updatedAt:
            item.updatedAt
              ? formatIST(
                  item.updatedAt
                )
              : null,

          lastUpdated:
            item.lastUpdated
              ? formatIST(
                  item.lastUpdated
                )
              : null,

          bets:
            item.bets?.map(
              (bet) => ({
                ...bet,

                statementDate:
                  bet.statementDate
                    ? formatIST(
                        bet.statementDate
                      )
                    : null,

                createdAt:
                  bet.createdAt
                    ? formatIST(
                        bet.createdAt
                      )
                    : null,

                updatedAt:
                  bet.updatedAt
                    ? formatIST(
                        bet.updatedAt
                      )
                    : null,

                lastUpdated:
                  bet.lastUpdated
                    ? formatIST(
                        bet.lastUpdated
                      )
                    : null,

                newCreatedAt:
                  bet.newCreatedAt
                    ? formatIST(
                        bet.newCreatedAt
                      )
                    : null,
              })
            ),
        }));

      return res
        .status(httpStatus.OK)
        .send(
          new APIResponse(
            {
              data:
                formattedFinalData,

              // totalCount:
              //   finalData.length,

              // totalPages:
              //   Math.ceil(
              //     finalData.length /
              //       limit
              //   ),


              totalCount:
                allTotalCount,

              totalPages:
                Math.ceil(
                  allTotalCount /
                    limit
                ),

              currentPage: page,
            },
            "Account statement fetched successfully",
            httpStatus.OK
          )
        );
    }

    // =====================================================
    // SPORT / CASINO
    // =====================================================

    const matchQuery = {
      userId: {
        $in: allIds,
      },

      ...(isCasino
        ? {
            $or: [
              {
                subType: {
                  $exists: true,
                },
              },
              {
                gType: {
                  $in:
                    specialCasinoGTypes,
                },
              },
              {
                gType: {
                  $regex:
                    specialCasinoRegex,
                },
              },
              {
                marketName: {
                  $regex:
                    specialCasinoMarketRegex,
                },
              },
              {
                eventName: {
                  $regex:
                    specialCasinoMarketRegex,
                },
              },
            ],
          }
        : {
            $and: [
              {
                subType: {
                  $exists: false,
                },
              },
              {
                $nor: [
                  {
                    gType: {
                      $regex:
                        specialCasinoRegex,
                    },
                  },
                  {
                    marketName: {
                      $regex:
                        specialCasinoMarketRegex,
                    },
                  },
                  {
                    eventName: {
                      $regex:
                        specialCasinoMarketRegex,
                    },
                  },
                ],
              },
            ],
          }),

      status: {
        $in: [
          "won",
          "lost",
          "cancelled",
        ],
      },

      updatedAt: {
        $gte: startDate,
        $lte: endDate,
      },

      isDeleteBetShowUser: {
        $ne: true,
      },
    };

    // =====================================================
    // MARKET / MATCH AGGREGATION
    //
    // CASINO    -> marketId
    // BOOKMAKER -> marketId
    // SPORT     -> etid + gmid
    // =====================================================
    const marketAggregation =
      await Bet.aggregate([
        {
          $match: matchQuery,
        },

        {
          $group: {
            // _id: isCasino
            //   ? "$marketId"
            //   : {
            //       etid: "$etid",
            //       gmid: "$gmid",
            //     },
            _id: isCasino
            ? "$marketId"
            : {
                etid: "$etid",
                gameId: "$gameId",
              },

            lastUpdated: {
              $max: "$updatedAt",
            },
          },
        },

        {
          $sort: {
            lastUpdated: 1,
          },
        },

        {
          $facet: {
            metadata: [
              {
                $count: "total",
              },
            ],

            data: [
              {
                $skip: skip,
              },

              {
                $limit: limit,
              },
            ],
          },
        },
      ]);

    const totalCount =
      marketAggregation[0]
        ?.metadata?.[0]?.total ||
      0;

    const targetGroups =
      marketAggregation[0]
        ?.data || [];

    // =====================================================
    // TARGET MATCH / MARKET FILTER
    // =====================================================
    let targetFilter = {};

    if (targetGroups.length > 0) {
      if (isCasino) {
        // Casino remains market-wise
        targetFilter = {
          marketId: {
            $in: targetGroups.map(
              (item) => item._id
            ),
          },
        };
      } else {
        // Sport remains match-wise
        targetFilter = {
          $or: targetGroups.map(
            (item) => ({
              etid: item._id.etid,
              gmid: item._id.gmid,
            })
          ),
        };
      }
    }

    // =====================================================
    // FETCH BETS
    // =====================================================
    const bets =
      targetGroups.length > 0
        ? await Bet.find({
            ...matchQuery,
            ...targetFilter,
          })
            .populate(
              "userId",
              "username role parent"
            )
            .sort({
              updatedAt: 1,
              _id: 1,
            })
            .lean()
        : [];

    // =====================================================
    // HISTORICAL AGGREGATION
    // =====================================================
    const historicalAgg =
      await Bet.aggregate([
        {
          $match: {
            ...matchQuery,

            updatedAt: {
              $lt: startDate,
            },

            status: {
              $in: [
                "won",
                "lost",
              ],
            },
          },
        },

        {
          $group: {
            _id: "$userId",

            totalProfit: {
              $sum: {
                $toDouble: {
                  $ifNull: [
                    "$profit",
                    0,
                  ],
                },
              },
            },
          },
        },
      ]);

    // =====================================================
    // SKIPPED MATCHES / MARKETS
    // IMPORTANT:
    // Sport -> etid + gmid
    // Casino -> marketId
    // =====================================================
    let skippedAgg = [];

    if (skip > 0) {
      const skippedAggregation =
        await Bet.aggregate([
          {
            $match: matchQuery,
          },

          {
            $group: {
              // _id: isCasino
              //   ? "$marketId"
              //   : {
              //       etid: "$etid",
              //       gmid: "$gmid",
              //     },

              _id: isCasino
                ? "$marketId"
                : {
                    etid: "$etid",
                    gameId: "$gameId",
                  },

              lastUpdated: {
                $max: "$updatedAt",
              },
            },
          },

          {
            $sort: {
              lastUpdated: 1,
            },
          },

          {
            $limit: skip,
          },
        ]);

      if (
        skippedAggregation.length > 0
      ) {
        let skippedFilter = {};

        if (isCasino) {
          skippedFilter = {
            marketId: {
              $in:
                skippedAggregation.map(
                  (item) =>
                    item._id
                ),
            },
          };
        } else {
          skippedFilter = {
            $or:
              skippedAggregation.map(
                (item) => ({
                  etid:
                    item._id.etid,

                  gmid:
                    item._id.gmid,
                })
              ),
          };
        }

        skippedAgg =
          await Bet.aggregate([
            {
              $match: {
                ...matchQuery,
                ...skippedFilter,
              },
            },

            {
              $group: {
                _id: "$userId",

                totalProfit: {
                  $sum: {
                    $toDouble: {
                      $ifNull: [
                        "$profit",
                        0,
                      ],
                    },
                  },
                },
              },
            },
          ]);
      }
    }

    // =====================================================
    // USERS
    // =====================================================
    const allRelevantUserIds =
      [
        ...new Set(
          bets
            .map(
              (bet) =>
                bet.userId?._id ||
                bet.userId
            )
            .filter(Boolean)
            .map((userId) =>
              userId.toString()
            )
        ),
      ];

    const usersList =
      await User.find({
        _id: {
          $in: allRelevantUserIds,
        },
      }).lean();

    const uniqueUserMap =
      new Map();

    usersList.forEach((u) => {
      uniqueUserMap.set(
        u._id.toString(),
        u
      );
    });

    // =====================================================
    // COMMISSION MAP
    // =====================================================
    const userCommissionMap =
      new Map();

    const memoizedCommissionList =
      new Map();

    usersList.forEach(
      (userObj) => {
        const uId =
          userObj._id.toString();

        let commission = 0;

        if (
          !memoizedCommissionList.has(
            uId
          )
        ) {
          const commissionList =
            [];

          let child =
            userObj;

          while (
            child &&
            child.parent
          ) {
            const parent =
              hierarchyUserMap.get(
                child.parent.toString()
              );

            if (!parent) break;

            let pRec;

            if (
              parent.role ===
              "owner"
            ) {
              pRec =
                allPartnerships.find(
                  (p) =>
                    p.userId.toString() ===
                      parent._id.toString() &&
                    p.partnerId.toString() ===
                      child._id.toString()
                );
            } else {
              pRec =
                allPartnerships.find(
                  (p) =>
                    p.userId.toString() ===
                      parent._id.toString() &&
                    p.partnerId.toString() ===
                      (parent.parent
                        ? parent.parent.toString()
                        : "")
                );
            }

            commissionList.push({
              parentId:
                parent._id,

              role:
                parent.role,

              parentName:
                parent.username,

              childId:
                child._id,

              childName:
                child.username,

              commission:
                pRec?.commission ??
                (child.role ===
                "user"
                  ? 100
                  : 0),

              downLineCommission:
                pRec?.downLineCommission ||
                0,
            });

            child =
              parent;
          }

          memoizedCommissionList.set(
            uId,
            commissionList
          );
        }

        const commissionList =
          memoizedCommissionList.get(
            uId
          );

        const isOwnBet =
          userObj._id.toString() ===
          currentUser._id.toString();

        if (isOwnBet) {
          commission =
            commissionList.length >
            0
              ? commissionList[0]
                  .commission
              : 100;
        } else if (
          currentUser.role ===
          "owner"
        ) {
          const ownerEntry =
            commissionList.find(
              (item) =>
                item?.role ===
                "owner"
            );

          if (ownerEntry) {
            const childEntry =
              commissionList.find(
                (c) =>
                  c.parentId.toString() ===
                  ownerEntry.childId.toString()
              );

            const childReceive =
              childEntry
                ? childEntry.downLineCommission
                : 0;

            commission =
              100 -
              childReceive;
          } else {
            const adminEntry =
              commissionList.find(
                (c) =>
                  c.role ===
                  "admin"
              );

            commission =
              adminEntry
                ? 100 -
                  (adminEntry.downLineCommission ||
                    0)
                : 100;
          }
        } else {
          const myEntry =
            commissionList?.find(
              (item) =>
                item?.role ===
                currentUser.role
            );

          if (myEntry) {
            const myReceive =
              myEntry.downLineCommission ||
              0;

            const childEntry =
              commissionList.find(
                (c) =>
                  c.parentId.toString() ===
                  myEntry.childId.toString()
              );

            const childReceive =
              childEntry
                ? childEntry.downLineCommission
                : 0;

            commission =
              myReceive -
              childReceive;
          }
        }

        if (commission < 0) {
          commission = 0;
        }

        commission =
          Number(
            commission.toFixed(2)
          );

        userCommissionMap.set(
          uId,
          commission
        );
      }
    );

    // =====================================================
    // OPENING BALANCE
    // =====================================================
    const historicalTotal =
      historicalAgg.reduce(
        (total, item) =>
          total +
          Number(
            item.totalProfit || 0
          ),
        0
      );

    const skippedTotal =
      skippedAgg.reduce(
        (total, item) =>
          total +
          Number(
            item.totalProfit || 0
          ),
        0
      );

    const openingBalance =
      Number(
        historicalTotal || 0
      ) +
      Number(
        skippedTotal || 0
      );

    // =====================================================
    // OPENING BALANCE DATE
    // =====================================================
    let openingBalanceDate =
      startDate;

    if (skip > 0) {
      const openingAggregation =
        await Bet.aggregate([
          {
            $match: matchQuery,
          },

          {
            $group: {
              // _id: isCasino
              //   ? "$marketId"
              //   : {
              //       etid: "$etid",
              //       gmid: "$gmid",
              //     },

              _id: isCasino
                ? "$marketId"
                : {
                    etid: "$etid",
                    gameId: "$gameId",
                  },

              lastUpdated: {
                $max: "$updatedAt",
              },
            },
          },

          {
            $sort: {
              lastUpdated: 1,
            },
          },

          {
            $limit: skip,
          },
        ]);

      if (
        openingAggregation.length >
        0
      ) {
        const lastSkipped =
          openingAggregation[
            openingAggregation.length -
              1
          ];

        openingBalanceDate =
          lastSkipped.lastUpdated ||
          startDate;
      }
    }
    // =====================================================
      // TOTAL PARTNERSHIP VALUE
      // CURRENT USER + UPPER PARENT HIERARCHY
      // =====================================================

      let totalPartnershipValue = 0;

      let partnershipUser = currentUser;

      while (partnershipUser) {
        totalPartnershipValue += Number(
          partnershipUser.partnershipValue || 0
        );

        if (!partnershipUser.parent) {
          break;
        }

        partnershipUser =
          hierarchyUserMap.get(
            partnershipUser.parent.toString()
          );
      }

      console.log(
        "TOTAL PARTNERSHIP VALUE:",
        totalPartnershipValue
      );

    // =====================================================
    // GROUP BETS
    // =====================================================
    const groupedByMarket = {};

    // for (const bet of bets) {
    //   if (!bet.user) continue;
    for (const bet of bets) {
      if (!bet.userId) continue;

      bet.user = bet.userId;

      const marketId = bet.marketId;

      const sectionName =
        String(
          bet.sectionName || ""
        ).trim();

      const marketType =
        String(
          bet.marketName ||
            bet.gType ||
            ""
        ).toLowerCase();

      const isBookmaker =
        marketType.includes(
          "bookmaker"
        );

      // =====================================================
      // MATCH IDENTIFICATION
      // =====================================================
      const etid =
        bet.etid ?? "";

      // const gmid =
      //   bet.gmid ?? "";
      const gmid = bet.gameId ?? "";

      let groupKey;

      // =====================================================
      // CASINO
      // Existing market-wise logic
      // =====================================================
      // if (isCasino) {
      //   groupKey =
      //     String(marketId);
      // }

      // // =====================================================
      // // BOOKMAKER
      // // Existing market-wise logic
      // // =====================================================
      // else if (isBookmaker) {
      //   groupKey =
      //     String(marketId);
      // }

      // // =====================================================
      // // SPORT
      // // MATCH-WISE: etid + gmid
      // // =====================================================
      // else {
      //   groupKey =
      //     `${String(
      //       etid
      //     )}__${String(
      //       gmid
      //     )}`;
      // }


      if (isCasino) {
          groupKey = String(marketId);
        } else {
          groupKey = `${String(etid)}__${String(gmid)}`;
        }

      // =====================================================
      // CREATE GROUP
      // =====================================================
      if (
        !groupedByMarket[
          groupKey
        ]
      ) {
        groupedByMarket[
          groupKey
        ] = {
          ...bet,

          marketId,

          etid,

          gmid,

          sectionName,

          eventName:
          bet.eventName ||
          bet.sectionName ||
          "",
          totalProfit: 0,

          totalAmount: 0,

          bets: [],

          lastUpdated:
            bet.updatedAt ||
            bet.createdAt,
        };
      }

      // const originalProfit = Number(
      //   bet.profit || 0
      // );

      // const actualProfit = originalProfit;

      const originalProfit = Number(
          bet.profit || 0
        );

        const actualProfit = Number(
          (
            originalProfit *
            totalPartnershipValue /
            100
          ).toFixed(2)
        );

      const betAmount =
        Number(
          bet.amount || 0
        );

      groupedByMarket[
        groupKey
      ].totalProfit +=
        actualProfit;

      groupedByMarket[
        groupKey
      ].totalAmount +=
        betAmount;

      // =====================================================
      // PARTNERSHIP PROFIT
      // =====================================================
      bet.partnershipProfit =
        actualProfit;

      // =====================================================
      // PARENT USER
      // =====================================================
      if (bet.user?.parent) {
        const parentUser =
          uniqueUserMap.get(
            bet.user.parent.toString()
          );

        if (parentUser) {
          bet.parentUsername =
            parentUser.username;
        }
      }

      // =====================================================
      // PUSH BET
      // =====================================================
      groupedByMarket[
        groupKey
      ].bets.push(bet);

      // =====================================================
      // LAST UPDATED
      // =====================================================
      const currentUpdatedAt =
        new Date(
          bet.updatedAt ||
            bet.createdAt
        ).getTime();

      const groupedUpdatedAt =
        new Date(
          groupedByMarket[
            groupKey
          ].lastUpdated
        ).getTime();

      if (
        currentUpdatedAt >
        groupedUpdatedAt
      ) {
        groupedByMarket[
          groupKey
        ].lastUpdated =
          bet.updatedAt ||
          bet.createdAt;
      }
    }


    // =====================================================
    // DEBUG - SLZ XI v TKR XI GAME PROFIT
    // =====================================================

      if (!isCasino) {
        console.log("\n========================================");
        console.log("DEBUG: SLZ XI v TKR XI");
        console.log("========================================");

        const slzBets = bets.filter((bet) => {
          const eventName = String(
            bet.eventName ||
            bet.sectionName ||
            ""
          ).toLowerCase();

          return eventName.includes("slz xi") &&
                eventName.includes("tkr xi");
        });

        console.log("SLZ BET COUNT:", slzBets.length);

        let slzBetProfit = 0;
        

        for (const bet of slzBets) {
          const profit = Number(bet.profit || 0);

          slzBetProfit += profit;

          console.log("SLZ BET:", {
            _id: bet._id,
            userId: bet.userId?._id || bet.userId,
            gmid: bet.gameId,
            etid: bet.etid,
            eventName: bet.eventName,
            sectionName: bet.sectionName,
            marketName: bet.marketName,
            amount: bet.amount,
            profit: profit,
            status: bet.status,
            updatedAt: bet.updatedAt,
          });
        }

        console.log("----------------------------------------");
        console.log("SLZ BET TOTAL PROFIT:", slzBetProfit);
        console.log("----------------------------------------");

        // GROUPED DATA
        for (const [groupKey, group] of Object.entries(
          groupedByMarket
        )) {
          const eventName = String(
            group.eventName ||
            group.sectionName ||
            group.marketName ||
            ""
          );

          if (
            eventName.toLowerCase().includes("slz xi") &&
            eventName.toLowerCase().includes("tkr xi")
          ) {
            console.log("SLZ GROUP FOUND:", {
              groupKey,
              gmid: group.gmid,
              etid: group.etid,
              eventName: group.eventName,
              sectionName: group.sectionName,
              marketName: group.marketName,
              totalProfit: group.totalProfit,
              totalAmount: group.totalAmount,
            });
          }
        }
      }
      
      // if (!isCasino) {
      //   // =====================================================
      //   // SPORT GAME TRANSACTIONS
      //   // =====================================================

      //   const sportTransactionQuery = {
      //     userId: currentUser._id,

      //     createdAt: {
      //       $gte: startDate,
      //       $lte: endDate,
      //     },

      //     status: {
      //       $in: ["approved", "pending"],
      //     },

      //     type: {
      //       $nin: [
      //         "correction",
      //         "reconciliation",
      //         "commission",
      //         "casino-commission",
      //       ],
      //     },
      //   };

      //   const transactions = await Transaction.find(
      //     sportTransactionQuery
      //   )
      //     .sort({
      //       createdAt: 1,
      //       _id: 1,
      //     })
      //     .lean();

      //   // =====================================================
      //   // MERGE SPORT TRANSACTIONS INTO SAME MATCH
      //   // =====================================================

      //   for (const transaction of transactions) {
      //     const amount = Number(transaction.amount || 0);

      //     // Check all possible remark fields
      //     const remarks = String(
      //       transaction.remarks ||
      //       transaction.remark ||
      //       transaction.adminRemarks ||
      //       transaction.type ||
      //       ""
      //     ).trim();

      //     // Only Cricket game transactions
      //     // Commission transactions must NOT be included
      //     if (!/^Cricket\s*\|/i.test(remarks)) {
      //       continue;
      //     }

      //     if (/^Commission\s*\|/i.test(remarks)) {
      //       continue;
      //     }

      //     const lowerRemarks = remarks.toLowerCase();

      //     // =====================================================
      //     // FIND SAME EVENT
      //     // =====================================================

      //     for (const [groupKey, item] of Object.entries(
      //       groupedByMarket
      //     )) {
      //       const eventName = String(
      //         item.eventName ||
      //         item.event ||
      //         item.marketName ||
      //         item.sectionName ||
      //         ""
      //       ).trim();

      //       if (!eventName) continue;

      //       const lowerEventName = eventName.toLowerCase();

      //       // Exact event name exists inside transaction remark
      //       if (lowerRemarks.includes(lowerEventName)) {
      //         groupedByMarket[groupKey].totalProfit =
      //           Number(
      //             groupedByMarket[groupKey].totalProfit || 0
      //           ) + amount;

      //         const transactionDate =
      //           transaction.createdAt ||
      //           transaction.updatedAt;

      //         if (
      //           transactionDate &&
      //           new Date(transactionDate) >
      //             new Date(
      //               groupedByMarket[groupKey].lastUpdated
      //             )
      //         ) {
      //           groupedByMarket[groupKey].lastUpdated =
      //             transactionDate;
      //         }

      //         break;
      //       }
      //     }
      //   }
      // }

    // =====================================================
    // FINAL DATA
    // =====================================================
    let finalData =
      Object.values(
        groupedByMarket
      );

    // =====================================================
    // SORT
    // =====================================================
    finalData.sort(
      (a, b) =>
        new Date(
          a.lastUpdated
        ) -
        new Date(
          b.lastUpdated
        )
    );

    // =====================================================
    // RUNNING BALANCE
    // =====================================================
    let runningTotal =
      Number(
        openingBalance || 0
      );

    finalData =
      finalData.map((item) => {
        const profit =
          Number(
            item.totalProfit || 0
          );

        runningTotal +=
          profit;

        return {
          ...item,

          totalProfit:
            profit,

          credit:
            profit > 0
              ? Math.abs(profit)
              : 0,

          debit:
            profit < 0
              ? Math.abs(profit)
              : 0,

          pts: Number(
            runningTotal.toFixed(
              2
            )
          ),

          closing: Number(
            runningTotal.toFixed(
              2
            )
          ),
        };
      });

    // =====================================================
    // SORT AGAIN
    // =====================================================
    finalData.sort(
      (a, b) =>
        new Date(
          a.lastUpdated
        ) -
        new Date(
          b.lastUpdated
        )
    );

    // =====================================================
    // OPENING BALANCE ROW
    // =====================================================
    finalData = [
      {
        marketId:
          "opening_balance",

        totalProfit: 0,

        totalAmount: 0,

        bets: [],

        lastUpdated:
          openingBalanceDate,

        credit: 0,

        debit: 0,

        pts: Number(
          openingBalance.toFixed(
            2
          )
        ),

        closing: Number(
          openingBalance.toFixed(
            2
          )
        ),

        remarks:
          `Opening Balance as of ${new Date(
            openingBalanceDate
          ).toLocaleString(
            "en-GB",
            {
              timeZone:
                "Asia/Kolkata",
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            }
          )}`,

        isSynthetic: true,
      },

      ...finalData,
    ];

    // =====================================================
    // FORMAT DATES
    // =====================================================
    const formattedFinalData =
      finalData.map((item) => ({
        ...item,

        statementDate:
          item.statementDate
            ? formatIST(
                item.statementDate
              )
            : null,

        createdAt:
          item.createdAt
            ? formatIST(
                item.createdAt
              )
            : null,

        updatedAt:
          item.updatedAt
            ? formatIST(
                item.updatedAt
              )
            : null,

        lastUpdated:
          item.lastUpdated
            ? formatIST(
                item.lastUpdated
              )
            : null,

        bets:
          item.bets?.map(
            (bet) => ({
              ...bet,

              statementDate:
                bet.statementDate
                  ? formatIST(
                      bet.statementDate
                    )
                  : null,

              createdAt:
                bet.createdAt
                  ? formatIST(
                      bet.createdAt
                    )
                  : null,

              updatedAt:
                bet.updatedAt
                  ? formatIST(
                      bet.updatedAt
                    )
                  : null,

              lastUpdated:
                bet.lastUpdated
                  ? formatIST(
                      bet.lastUpdated
                    )
                  : null,

              newCreatedAt:
                bet.newCreatedAt
                  ? formatIST(
                      bet.newCreatedAt
                    )
                  : null,
            })
          ),
      }));

    // =====================================================
    // RESPONSE
    // =====================================================
    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          {
            data:
              formattedFinalData,

            totalCount,

            totalPages:
              Math.ceil(
                totalCount /
                  limit
              ),

            currentPage:
              page,
          },

          "Account statement fetched successfully",

          httpStatus.OK
        )
      );
  } catch (error) {
    console.error(
      "getShortxAdminAccountStatement error:",
      error
    );

    return next(error);
  }
};


const manageCasino = async (req, res, next) => {
  try {
    const { betId, userId, sportStatus } = req.body;

    if (!betId) {
      return res.status(400).json({
        success: false,
        message: "betId is required",
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    const manualStatus = String(sportStatus || "")
      .trim()
      .toLowerCase();

    if (!["won", "lost"].includes(manualStatus)) {
      return res.status(400).json({
        success: false,
        message: "sportStatus must be won or lost",
      });
    }

  
    const bet = await Bet.findOne({
      _id: betId,
      userId: userId,
      status: "pending",
      isActive: true,
    });

    if (!bet) {
      return res.status(200).json({
        success: false,
        message:
          "Pending casino bet not found for this betId and userId",
      });
    }

    
    const updateStatus = manualStatus;

    let profitLoss = 0;

    const amount = Number(bet?.amount || 0);
    const uRate = Number(bet?.uRate || 0);
    const bhav = Number(bet?.bhav || 0);

    const betType = String(
      bet?.betType || ""
    )
      .trim()
      .toLowerCase();

    const gType = String(
      bet?.gType || ""
    )
      .trim()
      .toLowerCase();

    const eType = String(
      bet?.eType || ""
    )
      .trim()
      .toLowerCase();

    const subType = String(
      bet?.subType || ""
    )
      .trim()
      .toLowerCase();

    const sectionName = String(
      bet?.sectionName || ""
    )
      .trim()
      .toLowerCase();

    /*
     * Same automatic-style profit calculation
     */

    if (
      typeof isTeenpattiBet === "function" &&
      isTeenpattiBet(bet)
    ) {
      profitLoss =
        getTeenpattiProfitLoss(
          bet,
          updateStatus
        );
    }

    else if (
      typeof isJokerBet === "function" &&
      isJokerBet(bet)
    ) {
      profitLoss =
        getOddsProfitLoss(
          bet,
          updateStatus
        );
    }

    else if (
      gType === "race20" &&
      ["total points", "total cards"].includes(
        sectionName
      )
    ) {
      if (betType === "back") {
        profitLoss =
          updateStatus === "won"
            ? Number(
                (
                  (bhav * amount) /
                  100
                ).toFixed(2)
              )
            : -amount;
      } else {
        profitLoss =
          updateStatus === "won"
            ? amount
            : -Number(
                (
                  (bhav * amount) /
                  100
                ).toFixed(2)
              );
      }
    }

    else if (
      subType === "race20fancy"
    ) {
      if (
        betType === "lay" &&
        updateStatus === "won"
      ) {
        profitLoss = amount;
      } else if (
        betType === "lay" &&
        updateStatus === "lost"
      ) {
        profitLoss = -Number(
          (
            (bhav * amount) /
            100
          ).toFixed(2)
        );
      } else if (
        betType === "back" &&
        updateStatus === "won"
      ) {
        profitLoss = Number(
          (
            (bhav * amount) /
            100
          ).toFixed(2)
        );
      } else {
        profitLoss = -amount;
      }
    }

    else if (
      eType === "fancy2" &&
      betType === "lay" &&
      updateStatus === "won"
    ) {
      profitLoss = amount;
    }

    else if (
      eType === "fancy2" &&
      betType === "lay" &&
      updateStatus === "lost"
    ) {
      profitLoss = -Number(
        (
          (uRate - 1) *
          amount
        ).toFixed(2)
      );
    }

    else if (
      eType === "fancy2" &&
      betType === "back" &&
      updateStatus === "won"
    ) {
      profitLoss = Number(
        (
          Number(
            bet?.uRate ||
            bet?.bhav ||
            0
          ) *
          amount
        ).toFixed(2)
      );
    }

    else if (
      eType === "fancy2" &&
      betType === "back" &&
      updateStatus === "lost"
    ) {
      profitLoss = -amount;
    }

    else if (
      betType === "lay" &&
      updateStatus === "won"
    ) {
      profitLoss = amount;
    }

    else if (
      betType === "lay" &&
      updateStatus === "lost"
    ) {
      profitLoss = -Number(
        (
          (uRate - 1) *
          amount
        ).toFixed(2)
      );
    }

    else if (
      updateStatus === "won"
    ) {
      profitLoss = Number(
        (
          (uRate - 1) *
          amount
        ).toFixed(2)
      );
    }

    else {
      profitLoss = -amount;
    }

    if (
      typeof applyTeenJokerProfitLoss ===
      "function"
    ) {
      profitLoss =
        applyTeenJokerProfitLoss(
          bet,
          updateStatus,
          profitLoss
        );
    }

    profitLoss = Number(
      Number(profitLoss || 0).toFixed(2)
    );

   
    const updatedBet =
      await Bet.findOneAndUpdate(
        {
          _id: betId,
          userId: userId,
          status: "pending",
          isActive: true,
        },
        {
          $set: {
            status: updateStatus,
            profit: profitLoss,
            manualResult: true,
            manualStatus: updateStatus,
            manualSettledAt: new Date(),
          },
        },
        {
          new: true,
        }
      );

    
    if (!updatedBet) {
      return res.status(200).json({
        success: false,
        message:
          "Bet is no longer pending, settlement skipped",
      });
    }

    /*
     * User balance update
     */
    const updatedUser =
      await atomicUpdateUserFinance(
        userId,
        {
          balance: profitLoss,
        },
        {
          allowNegativeBuffer: true,
        }
      );

    if (!updatedUser) {
      throw new Error(
        `User ${userId} not found`
      );
    }

    /*
     * Exposure recalculate
     */
    const expDelta =
      await recalculateUserExposureAndGetDelta(
        userId
      );

    /*
     * Fresh user
     */
    const latestUser =
      await User.findById(userId)
        .select(
          "username balance exp"
        )
        .lean();

    if (latestUser) {
      await setCache(
        `user:${userId}`,
        latestUser,
        60
      );

      await distributeCommissionHierarchy(
        latestUser,
        {
          exp: expDelta,
          profit: profitLoss,
        }
      );
    }

    return res.status(200).json({
      success: true,
      message: `Casino bet manually settled as ${updateStatus}`,
      betId,
      userId,
      status: updateStatus,
      profit: profitLoss,
      balance: latestUser?.balance,
      exp: latestUser?.exp,
    });

  } catch (error) {
    console.error(
      "manageCasino error:",
      error
    );

    next(error);
  }
};

const getSportMatchFancyHistory = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, search, etid } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    // 1. Identify target gameIds from Games collection ONLY if search or etid is provided
    let filteredGameIds = null;
    if (search || etid) {
        const gQuery = {}; 
        if (etid) gQuery.etid = Number(etid);
        if (search) gQuery.ename = { $regex: search, $options: "i" };

        const matchedGames = await Game.find(gQuery).select("gmid").lean();
        filteredGameIds = matchedGames.map(g => String(g.gmid));

        if (filteredGameIds.length === 0) {
            return res.status(httpStatus.OK).json({
                success: true,
                data: { docs: [], totalDocs: 0, limit: Number(limit), page: Number(page), totalPages: 0 }
            });
        }
    }

    const initialMatch = {
      isActive: true,
      subType: { $exists: false },
      status: "pending",
      gType: { $in: ["fancy", "fancy1", "meter", "khado", "oddeven"] },
      cType: { $nin: ["superover", "superover2", "superover3", "cricketv3"] },
    };
    if (filteredGameIds) {
        initialMatch.gameId = { $in: filteredGameIds };
    }

    const pipeline = [
      { $match: initialMatch },
      {
        $group: {
          _id: "$gameId",
          doc: { $first: "$$ROOT" },
          betCount: { $sum: 1 },
          lastBetAt: { $max: "$createdAt" }
        },
      },
      {
        $facet: {
            metadata: [{ $count: "total" }],
            data: [
                { $sort: { lastBetAt: -1 } },
                { $skip: skip },
                { $limit: Number(limit) || 1000 },
                {
                    $replaceRoot: {
                      newRoot: { $mergeObjects: ["$doc", { gameIdString: "$_id", betCount: "$betCount" }] },
                    },
                },
                {
                  $addFields: {
                    lookupOid: { $convert: { input: "$gameIdString", to: "objectId", onError: null, onNull: null } },
                    lookupGmid: { $convert: { input: "$gameIdString", to: "double", onError: null, onNull: null } },
                  },
                },
                {
                  $lookup: {
                    from: "games",
                    localField: "lookupOid",
                    foreignField: "_id",
                    as: "gameMatchById",
                  },
                },
                {
                  $lookup: {
                    from: "games",
                    localField: "lookupGmid",
                    foreignField: "gmid",
                    as: "gameMatchByGmid",
                  },
                },
                {
                  $addFields: {
                    game: {
                      $ifNull: [
                        { $arrayElemAt: ["$gameMatchById", 0] },
                        { $arrayElemAt: ["$gameMatchByGmid", 0] },
                      ],
                    },
                  },
                },
                {
                  $addFields: {
                    "game.matchDateStr": "$game.stime",
                  },
                },
                {
                  $project: {
                    gameMatchById: 0,
                    gameMatchByGmid: 0,
                    lookupOid: 0,
                    lookupGmid: 0,
                  },
                },
            ]
        }
      }
    ];

    const results = await betModel.aggregate(pipeline);
    const totalDocs = results[0]?.metadata[0]?.total || 0;
    const paginatedBets = results[0]?.data || [];
    const totalPages = Math.ceil(totalDocs / (Number(limit) || totalDocs || 1));

    const responseData = {
      docs: paginatedBets,
      totalDocs,
      limit: Number(limit),
      page: Number(page),
      totalPages,
    };

    if (!req.query.page && !req.query.limit) {
      return res
        .status(httpStatus.OK)
        .send(
          new APIResponse(
            paginatedBets,
            "Match fetched successfully",
            httpStatus.OK
          )
        );
    }

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          responseData,
          "Sport match fancy history fetched successfully",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(err);
  }
};
const getSportMatchFancyBet = async (req, res, next) => {
  try {
    const gameId = req.params.gameId;
    let pipeline = [
      {
        $match: {
          isActive: true,
          subType: { $exists: false },
          status: "pending",
          gType: {
            $in: [
              "fancy",
              "fancy1",
              "meter",
              "khado",
              "oddeven",
              // "cricketcasino",
            ],
          }, //, cricketcasino
          gameId: gameId,
        },
      },
      {
        $group: {
          _id: {
            marketId: "$marketId",
            sectionId: "$sectionId",
          },
          doc: { $first: "$$ROOT" },
        },
      },
      { $replaceRoot: { newRoot: "$doc" } },
      {
        $sort: { createdAt: 1 },
      },
    ];
    let bets = await betModel.aggregate(pipeline);

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(bets, "Fancy Bet fetched successfully", httpStatus.OK)
      );
  } catch (err) {
    next(err);
  }
};


// const getFancyMatchHistory = async (req, res, next) => {
//   try {
//     console.time("FANCY TOTAL");
//     const { etid, startDate, endDate, search, page = 1, limit = 10 } = req?.query;
//     const skip = (Number(page) - 1) * Number(limit);

//     const sDate = startDate ? moment(startDate, "YYYY-MM-DD").startOf("day").toDate() : null;
//     const eDate = endDate ? moment(endDate, "YYYY-MM-DD").endOf("day").toDate() : null;

//     // 1. Identify target gameIds from Games collection
//     const gQuery = { isActive: true };
//     if (etid) gQuery.etid = Number(etid);

//     console.time("FANCY Game.find");

//     const matchedGames = await Game.find(gQuery)
//       .select({
//         gmid: 1,
//         stime: 1,
//         ename: 1,
//         _id: 0,
//       })
//       .lean();


//     console.timeEnd("FANCY Game.find");
//     console.log("FANCY matchedGames:", matchedGames.length);

//     console.time("FANCY Game.filter");
    
//     const filteredGameIds = matchedGames.filter(g => {
//         const gDate = parseMatchDate(g.stime);
//         const matchesDate = (!sDate || (gDate && gDate >= sDate)) && (!eDate || (gDate && gDate <= eDate));
//         const matchesSearch = !search || (g.ename && g.ename.toLowerCase().includes(search.toLowerCase()));
//         return matchesDate && matchesSearch;
//     }).map(g => String(g.gmid));

//     console.timeEnd("FANCY Game.filter");
//     console.log("FANCY filteredGameIds:", filteredGameIds.length);

//     if (filteredGameIds.length === 0 && (sDate || eDate || search || etid)) {
//         return res.status(httpStatus.OK).json({
//           success: true,
//           data: { docs: [], totalDocs: 0, limit: Number(limit), page: Number(page), totalPages: 0 }
//         });
//     }

//     const initialMatch = {
//       isActive: true,
//       subType: { $exists: false },
//       status: { $in: ["lost", "won"] },
//       cType: { $exists: false },
//       gType: { $in: ["fancy", "fancy1", "meter", "khado", "oddeven"] },
//     };
//     if (filteredGameIds.length > 0) {
//         initialMatch.gameId = { $in: filteredGameIds };
//     }
    

//     const pipeline = [
//       { $match: initialMatch },
//       {
//         $group: {
//           _id: "$gameId",
//           doc: { $first: "$$ROOT" },
//           betCount: { $sum: 1 },
//           lastBetAt: { $max: "$createdAt" }
//         },
//       },
//       {
//         $facet: {
//             metadata: [{ $count: "total" }],
//             data: [
//                 { $sort: { lastBetAt: -1 } },
//                 { $skip: skip },
//                 { $limit: Number(limit) || 1000 }, // Default to a large number if no pagination
//                 {
//                     $replaceRoot: {
//                       newRoot: { $mergeObjects: ["$doc", { gameIdString: "$_id", betCount: "$betCount" }] },
//                     },
//                 },
//                 {
//                   $addFields: {
//                     lookupOid: { $convert: { input: "$gameIdString", to: "objectId", onError: null, onNull: null } },
//                     lookupGmid: { $convert: { input: "$gameIdString", to: "double", onError: null, onNull: null } },
//                   },
//                 },
//                 {
//                   $lookup: {
//                     from: "games",
//                     localField: "lookupOid",
//                     foreignField: "_id",
//                     as: "gameMatchById",
//                   },
//                 },
//                 {
//                   $lookup: {
//                     from: "games",
//                     localField: "lookupGmid",
//                     foreignField: "gmid",
//                     as: "gameMatchByGmid",
//                   },
//                 },
//                 {
//                   $addFields: {
//                     finalGame: {
//                       $ifNull: [
//                         { $arrayElemAt: ["$gameMatchById", 0] },
//                         { $arrayElemAt: ["$gameMatchByGmid", 0] },
//                       ],
//                     },
//                   },
//                 },
//                 {
//                   $addFields: {
//                     matchDate: "$finalGame.stime",
//                   },
//                 },
//                 {
//                   $project: {
//                     gameMatchById: 0,
//                     gameMatchByGmid: 0,
//                     lookupOid: 0,
//                     lookupGmid: 0,
//                     finalGame: 0,
//                   },
//                 },
//             ]
//         }
//       }
//     ];

//     console.time("FANCY Aggregate");

//     const results = await betModel.aggregate(pipeline);

//     console.timeEnd("FANCY Aggregate");

//     const totalDocs = results[0]?.metadata[0]?.total || 0;
//     const paginatedBets = results[0]?.data || [];
//     const totalPages = Math.ceil(totalDocs / (Number(limit) || totalDocs || 1));

//     const responseData = {
//       docs: paginatedBets,
//       totalDocs,
//       limit: Number(limit),
//       page: Number(page),
//       totalPages,
//     };

//     // Support legacy response (array directly) if no page/limit provided to avoid breaking other consumers
//     if (!req.query.page && !req.query.limit) {
//       return res
//         .status(httpStatus.OK)
//         .send(
//           new APIResponse(
//             paginatedBets,
//             "Match fetched successfully",
//             httpStatus.OK
//           )
//         );
//     }

//     console.timeEnd("FANCY TOTAL");

//     res
//       .status(httpStatus.OK)
//       .send(
//         new APIResponse(
//           responseData,
//           "Fancy match history fetched successfully",
//           httpStatus.OK
//         )
//       );
//   } catch (err) {
//     next(err);
//   }
// };

//optimized

const getFancyMatchHistory = async (req, res, next) => {
  try {
    console.time("FANCY TOTAL");

    const {
      etid,
      startDate,
      endDate,
      search,
      page = 1,
      limit = 10,
    } = req?.query;

    const pageNumber = Number(page);
    const limitNumber = Number(limit);
    const skip = (pageNumber - 1) * limitNumber;

    const sDate = startDate
      ? moment(startDate, "YYYY-MM-DD").startOf("day").toDate()
      : null;

    const eDate = endDate
      ? moment(endDate, "YYYY-MM-DD").endOf("day").toDate()
      : null;

    // =========================================================
    // 1. Find matching bets FIRST
    // =========================================================
    const initialMatch = {
      isActive: true,
      subType: { $exists: false },
      status: { $in: ["lost", "won"] },
      cType: { $exists: false },
      gType: {
        $in: ["fancy", "fancy1", "meter", "khado", "oddeven"],
      },
    };

    console.time("FANCY Bet.aggregate");

    const groupedResults = await betModel.aggregate([
      {
        $match: initialMatch,
      },

      {
        $group: {
          _id: "$gameId",
          doc: { $first: "$$ROOT" },
          betCount: { $sum: 1 },
          lastBetAt: { $max: "$createdAt" },
        },
      },
    ]);

    console.timeEnd("FANCY Bet.aggregate");

    console.log(
      "FANCY grouped games:",
      groupedResults.length
    );

    // =========================================================
    // 2. Extract only gameIds that actually have matching bets
    // =========================================================
    const candidateGmids = groupedResults
      .map((item) => Number(item._id))
      .filter((id) => Number.isFinite(id));

    console.log(
      "FANCY candidateGmids:",
      candidateGmids.length
    );

    // No matching bets at all
    if (candidateGmids.length === 0) {
      console.timeEnd("FANCY TOTAL");

      const responseData = {
        docs: [],
        totalDocs: 0,
        limit: Number(limit),
        page: Number(page),
        totalPages: 0,
      };

      if (!req.query.page && !req.query.limit) {
        return res
          .status(httpStatus.OK)
          .send(
            new APIResponse(
              [],
              "Match fetched successfully",
              httpStatus.OK
            )
          );
      }

      return res
        .status(httpStatus.OK)
        .send(
          new APIResponse(
            responseData,
            "Fancy match history fetched successfully",
            httpStatus.OK
          )
        );
    }

    // =========================================================
    // 3. Fetch ONLY games that actually appear in the bets
    // =========================================================
    const gQuery = {
      isActive: true,
      gmid: { $in: candidateGmids },
    };

    if (etid) {
      gQuery.etid = Number(etid);
    }

    console.time("FANCY Game.find");

    const matchedGames = await Game.find(gQuery)
      .select({
        gmid: 1,
        stime: 1,
        ename: 1,
        _id: 1,
      })
      .lean();

    console.timeEnd("FANCY Game.find");

    console.log(
      "FANCY matchedGames:",
      matchedGames.length
    );

    // =========================================================
    // 4. Apply the SAME date/search filtering as before
    // =========================================================
    console.time("FANCY Game.filter");

    const searchTerm = search
      ? search.toLowerCase()
      : null;

    const filteredGameIds = new Set();

    const gameMap = new Map();

    for (const game of matchedGames) {
      const gameId = String(game.gmid);

      const gDate = parseMatchDate(game.stime);

      const matchesDate =
        (!sDate || (gDate && gDate >= sDate)) &&
        (!eDate || (gDate && gDate <= eDate));

      const matchesSearch =
        !searchTerm ||
        (game.ename &&
          game.ename
            .toLowerCase()
            .includes(searchTerm));

      if (matchesDate && matchesSearch) {
        filteredGameIds.add(gameId);

        gameMap.set(gameId, game);
      }
    }

    console.timeEnd("FANCY Game.filter");

    console.log(
      "FANCY filteredGameIds:",
      filteredGameIds.size
    );

    // Preserve old behavior:
    // if filters were supplied and no matching games exist
    if (
      filteredGameIds.size === 0 &&
      (sDate || eDate || search || etid)
    ) {
      console.timeEnd("FANCY TOTAL");

      return res.status(httpStatus.OK).json({
        success: true,
        data: {
          docs: [],
          totalDocs: 0,
          limit: Number(limit),
          page: Number(page),
          totalPages: 0,
        },
      });
    }

    // =========================================================
    // 5. Keep only bet groups belonging to matching games
    // =========================================================
    const filteredGroups = groupedResults.filter((item) =>
      filteredGameIds.has(String(item._id))
    );

    // =========================================================
    // 6. Same sorting as old aggregation
    // =========================================================
    filteredGroups.sort((a, b) => {
      const aTime = a.lastBetAt
        ? new Date(a.lastBetAt).getTime()
        : 0;

      const bTime = b.lastBetAt
        ? new Date(b.lastBetAt).getTime()
        : 0;

      return bTime - aTime;
    });

    // =========================================================
    // 7. Same total count
    // =========================================================
    const totalDocs = filteredGroups.length;

    // =========================================================
    // 8. Same pagination
    // =========================================================
    const paginatedGroups = filteredGroups.slice(
      skip,
      skip + (limitNumber || 1000)
    );

    // =========================================================
    // 9. Build EXACT same response documents
    // =========================================================
    const paginatedBets = paginatedGroups.map((item) => {
      const gameIdString = String(item._id);

      const game = gameMap.get(gameIdString);

      const doc = {
        ...item.doc,

        gameIdString,
        betCount: item.betCount,

        matchDate: game?.stime,
      };

      return doc;
    });

    // =========================================================
    // 10. Same total pages
    // =========================================================
    const totalPages = Math.ceil(
      totalDocs /
        (Number(limit) || totalDocs || 1)
    );

    const responseData = {
      docs: paginatedBets,
      totalDocs,
      limit: Number(limit),
      page: Number(page),
      totalPages,
    };

    console.timeEnd("FANCY TOTAL");

    // =========================================================
    // 11. Same legacy response
    // =========================================================
    if (!req.query.page && !req.query.limit) {
      return res
        .status(httpStatus.OK)
        .send(
          new APIResponse(
            paginatedBets,
            "Match fetched successfully",
            httpStatus.OK
          )
        );
    }

    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          responseData,
          "Fancy match history fetched successfully",
          httpStatus.OK
        )
      );
  } catch (err) {
    console.timeEnd("FANCY TOTAL");
    next(err);
  }
};

const getSportMatchFancyBetHistory = async (req, res, next) => {
  try {
    const gameId = req.params.gameId;
    let pipeline = [
      {
        $match: {
          isActive: true,
          subType: { $exists: false },
          cType: { $exists: false },
          status: { $in: ["lost", "won", "cancelled"] },
          gType: {
            $in: [
              "fancy",
              "fancy1",
              "meter",
              "khado",
              "oddeven",
              // "cricketcasino",
            ],
          },
          gameId: gameId,
        },
      },
      {
        $group: {
          _id: {
            marketId: "$marketId",
            sectionId: "$sectionId",
          },
          doc: { $first: "$$ROOT" },
        },
      },
      { $replaceRoot: { newRoot: "$doc" } },
      {
        $sort: { createdAt: -1 },
      },
    ];
    let bets = await betModel.aggregate(pipeline);

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(bets, "Fancy Bet fetched successfully", httpStatus.OK)
      );
  } catch (err) {
    next(err);
  }
};

// const getSportMatch = async (req, res, next) => {
//   try {
//     const { etid, startDate, endDate, search, page = 1, limit = 10 } = req?.query;
//     const skip = (Number(page) - 1) * Number(limit);

//     const sDate = startDate ? moment(startDate, "YYYY-MM-DD").startOf("day").toDate() : null;
//     const eDate = endDate ? moment(endDate, "YYYY-MM-DD").endOf("day").toDate() : null;

//     // 1. Identify target gameIds from Games collection based on etid, search and date
//     const gQuery = { isActive: true };
//     if (etid) gQuery.etid = Number(etid);

//     const matchedGames = await Game.find(gQuery).lean();
    
//     const filteredGameIds = matchedGames.filter(g => {
//         const gDate = parseMatchDate(g.stime);
//         const matchesDate = (!sDate || (gDate && gDate >= sDate)) && (!eDate || (gDate && gDate <= eDate));
//         const matchesSearch = !search || (g.ename && g.ename.toLowerCase().includes(search.toLowerCase()));
//         return matchesDate && matchesSearch;
//     }).map(g => String(g.gmid));

//     if (filteredGameIds.length === 0 && (sDate || eDate || search || etid)) {
//         return res.status(httpStatus.OK).json({
//           success: true,
//           data: { docs: [], totalDocs: 0, limit: Number(limit), page: Number(page), totalPages: 0 }
//         });
//     }

//     // 2. Build pipeline for Bets
//     const initialMatch = {
//       isActive: true,
//       subType: { $exists: false },
//       status: "pending",
//       gType: { $in: ["match", "match1", "cricketcasino"] },
//     };

//     // if (filteredGameIds.length > 0) {
//     //     initialMatch.gameId = { $in: filteredGameIds };
//     // }

//     if (etid) {
//       initialMatch.etid = String(etid);

//       // ETID 8: Bets collection se direct gameId use karo
//       if (String(etid) === "8") {
//         delete initialMatch.gameId;
//       }
//     }

//     const pipeline = [
//       { $match: initialMatch },
//       {
//         $group: {
//           _id: "$gameId",
//           doc: { $first: "$$ROOT" },
//           betCount: { $sum: 1 },
//           lastBetAt: { $max: "$createdAt" }
//         },
//       },
//       {
//         $facet: {
//             metadata: [{ $count: "total" }],
//             data: [
//                 { $sort: { lastBetAt: -1 } },
//                 { $skip: skip },
//                 { $limit: Number(limit) },
//                 {
//                     $replaceRoot: {
//                       newRoot: { $mergeObjects: ["$doc", { gameIdString: "$_id", betCount: "$betCount" }] },
//                     },
//                 },
//                 {
//                   $addFields: {
//                     lookupOid: { $convert: { input: "$gameIdString", to: "objectId", onError: null, onNull: null } },
//                     lookupGmid: { $convert: { input: "$gameIdString", to: "double", onError: null, onNull: null } },
//                   },
//                 },
//                 {
//                   $lookup: {
//                     from: "games",
//                     localField: "lookupOid",
//                     foreignField: "_id",
//                     as: "gameMatchById",
//                   },
//                 },
//                 {
//                   $lookup: {
//                     from: "games",
//                     localField: "lookupGmid",
//                     foreignField: "gmid",
//                     as: "gameMatchByGmid",
//                   },
//                 },
//                 // {
//                 //   $addFields: {
//                 //     matchData: {
//                 //       $ifNull: [
//                 //         { $arrayElemAt: ["$gameMatchById", 0] },
//                 //         { $arrayElemAt: ["$gameMatchByGmid", 0] },
//                 //       ],
//                 //     },
//                 //   },
//                 // },
//                   {
//                     $addFields: {
//                       matchData: {
//                         $cond: [
//                           { $eq: ["$etid", "8"] },
//                           {
//                             $ifNull: [
//                               { $arrayElemAt: ["$gameMatchById", 0] },
//                               {
//                                 $ifNull: [
//                                   { $arrayElemAt: ["$gameMatchByGmid", 0] },
//                                   // {
//                                   //   ename: "$eventName",
//                                   //   stime: "$createdAt",
//                                   //   gmid: "$gameId",
//                                   // },
//                                   {
//                                     ename: "$eventName",
//                                     stime: "$createdAt",
//                                     gmid: "$gameId",
//                                   }
//                                 ],
//                               },
//                             ],
//                           },
//                           {
//                             $ifNull: [
//                               { $arrayElemAt: ["$gameMatchById", 0] },
//                               { $arrayElemAt: ["$gameMatchByGmid", 0] },
//                             ],
//                           },
//                         ],
//                       },
//                     },
//                   },
//                 {
//                   $project: {
//                       gameMatchById: 0,
//                       gameMatchByGmid: 0,
//                       lookupOid: 0,
//                       lookupGmid: 0
//                   }
//                 }
//             ]
//         }
//       }
//     ];

//     const results = await betModel.aggregate(pipeline);
//     const totalDocs = results[0]?.metadata[0]?.total || 0;
//     const paginatedBets = results[0]?.data || [];
//     const totalPages = Math.ceil(totalDocs / Number(limit));

//     res.status(httpStatus.OK).json({
//       success: true,
//       message: "Manage matches fetched successfully",
//       data: {
//         docs: paginatedBets,
//         totalDocs,
//         limit: Number(limit),
//         page: Number(page),
//         totalPages,
//       }
//     });

//   } catch (err) {
//     next(err);
//   }
// };



//optimized

const getSportMatch = async (req, res, next) => {
  try {
    const {
      etid,
      startDate,
      endDate,
      search,
      page = 1,
      limit = 10,
    } = req?.query;

    const pageNumber = Math.max(Number(page) || 1, 1);
    const pageLimit = Math.max(Number(limit) || 10, 1);
    const skip = (pageNumber - 1) * pageLimit;

    const sDate = startDate
      ? moment(startDate, "YYYY-MM-DD")
          .startOf("day")
          .toDate()
      : null;

    const eDate = endDate
      ? moment(endDate, "YYYY-MM-DD")
          .endOf("day")
          .toDate()
      : null;

    // =========================================================
    // 1. IDENTIFY TARGET GAMES
    // SAME OLD LOGIC
    // =========================================================

    const gQuery = {
      isActive: true,
    };

    if (etid) {
      gQuery.etid = Number(etid);
    }

    const matchedGames = await Game.find(gQuery)
      .select({
        gmid: 1,
        stime: 1,
        ename: 1,
      })
      .lean();

    const searchLower = search
      ? String(search).toLowerCase()
      : null;

    const filteredGameIds = [];

    /*
     * Keep this map because it is useful for games that
     * already passed the Games-side filter.
     */
    const gameMap = new Map();

    for (const game of matchedGames) {
      const gDate = parseMatchDate(game.stime);

      const matchesDate =
        (!sDate || (gDate && gDate >= sDate)) &&
        (!eDate || (gDate && gDate <= eDate));

      const matchesSearch =
        !searchLower ||
        (
          game.ename &&
          String(game.ename)
            .toLowerCase()
            .includes(searchLower)
        );

      if (matchesDate && matchesSearch) {
        const gmidString = String(game.gmid);

        filteredGameIds.push(gmidString);

        gameMap.set(
          gmidString,
          game
        );
      }
    }

    // =========================================================
    // 2. OLD EMPTY-GAME BEHAVIOUR
    //
    // IMPORTANT:
    // filteredGameIds are NOT added to initialMatch.
    //
    // This preserves the old behaviour where a bet such as
    // gameId 30 can still appear even if 30 is not present
    // inside filteredGameIds.
    // =========================================================

    if (
      filteredGameIds.length === 0 &&
      (sDate || eDate || search || etid)
    ) {
      return res.status(httpStatus.OK).json({
        success: true,

        message:
          "Manage matches fetched successfully",

        data: {
          docs: [],

          totalDocs: 0,

          limit: pageLimit,

          page: pageNumber,

          totalPages: 0,
        },
      });
    }

    // =========================================================
    // 3. INITIAL BET CONDITION
    // SAME OLD BET FILTER
    // =========================================================

    const initialMatch = {
      isActive: true,

      subType: {
        $exists: false,
      },

      status: "pending",

      gType: {
        $in: [
          "match",
          "match1",
          "cricketcasino",
        ],
      },
    };

    // =========================================================
    // 4. ETID
    //
    // SAME OLD BEHAVIOUR
    //
    // ETID 8 does not use gameId.
    //
    // IMPORTANT:
    // We intentionally DO NOT do:
    //
    // initialMatch.gameId = {
    //   $in: filteredGameIds
    // };
    //
    // because that changes the old behaviour.
    // =========================================================

    if (etid) {
      initialMatch.etid = String(etid);

      if (String(etid) === "8") {
        delete initialMatch.gameId;
      }
    }

    // =========================================================
    // 5. FETCH RECENT BET CANDIDATES
    //
    // OLD:
    //
    // $match
    //   ↓
    // $group ALL bets
    //   ↓
    // $facet
    //   ↓
    // $sort
    //   ↓
    // $skip
    //   ↓
    // $limit
    //
    // NEW:
    //
    // indexed find
    //   ↓
    // latest bets first
    //   ↓
    // small candidate set
    //   ↓
    // group in Node
    //   ↓
    // pagination
    // =========================================================

    const candidateBatchSize = Math.max(
      500,
      (skip + pageLimit) * 20
    );

    const candidates = await betModel
      .find(initialMatch)
      .sort({
        createdAt: -1,
        _id: -1,
      })
      .select({
        gameId: 1,
        etid: 1,
        eventName: 1,
        createdAt: 1,
        _id: 1,
      })
      .limit(candidateBatchSize)
      .lean();

    // =========================================================
    // 6. GROUP BY GAME
    // =========================================================

    const groupedGames = new Map();

    for (const bet of candidates) {
      const gameId = String(
        bet.gameId
      );

      /*
       * Candidates are sorted newest first.
       * Therefore the first bet encountered for a game
       * is its latest bet.
       */
      if (!groupedGames.has(gameId)) {
        groupedGames.set(gameId, {
          gameId,

          doc: bet,

          lastBetAt:
            bet.createdAt,
        });
      }
    }

    const groupedArray =
      Array.from(
        groupedGames.values()
      );

    // =========================================================
    // 7. SORT GROUPS
    // SAME OLD ORDER
    // =========================================================

    groupedArray.sort((a, b) => {
      const aTime = a.lastBetAt
        ? new Date(
            a.lastBetAt
          ).getTime()
        : 0;

      const bTime = b.lastBetAt
        ? new Date(
            b.lastBetAt
          ).getTime()
        : 0;

      return bTime - aTime;
    });

    // =========================================================
    // 8. PAGINATION
    // =========================================================

    const paginatedGroups =
      groupedArray.slice(
        skip,
        skip + pageLimit
      );

    // =========================================================
    // 9. BET COUNT
    //
    // Only count bets for games appearing on the current page.
    // =========================================================

    const pageGameIds =
      paginatedGroups.map(
        (group) =>
          group.gameId
      );

    let countResults = [];

    if (pageGameIds.length > 0) {
      countResults =
        await betModel.aggregate([
          {
            $match: {
              ...initialMatch,

              gameId: {
                $in: pageGameIds,
              },
            },
          },

          {
            $group: {
              _id: "$gameId",

              betCount: {
                $sum: 1,
              },
            },
          },
        ]);
    }

    const countMap =
      new Map();

    for (const item of countResults) {
      countMap.set(
        String(item._id),
        item.betCount
      );
    }

    // =========================================================
    // 10. TOTAL UNIQUE GAMES
    //
    // Separate count instead of using $facet.
    // =========================================================

    const totalResult =
      await betModel.aggregate([
        {
          $match: initialMatch,
        },

        {
          $group: {
            _id: "$gameId",
          },
        },

        {
          $count: "total",
        },
      ]);

    const totalDocs =
      totalResult?.[0]?.total || 0;

    // =========================================================
    // 11. BUILD PAGINATED DOCUMENTS
    // =========================================================

    const paginatedBets =
      paginatedGroups.map(
        (group) => ({
          ...group.doc,

          gameIdString:
            group.gameId,

          betCount:
            countMap.get(
              group.gameId
            ) || 0,
        })
      );

    // =========================================================
    // 12. FETCH GAME DATA FOR CURRENT PAGE
    //
    // OLD BEHAVIOUR:
    //
    // 1. games._id
    // 2. if not found -> games.gmid
    //
    // We preserve that priority but only query games
    // for the current page.
    // =========================================================

    const pageGameIdStrings =
      paginatedBets.map(
        (doc) =>
          String(
            doc.gameIdString
          )
      );

    // ---------------------------------------------------------
    // OBJECT ID VALUES
    // ---------------------------------------------------------

    const pageObjectIds = [];

    for (
      const gameId
      of pageGameIdStrings
    ) {
      if (
        mongoose.Types.ObjectId.isValid(
          gameId
        )
      ) {
        pageObjectIds.push(
          new mongoose.Types.ObjectId(
            gameId
          )
        );
      }
    }

    // ---------------------------------------------------------
    // GMID VALUES
    // ---------------------------------------------------------

    const pageGmids = [];

    for (
      const gameId
      of pageGameIdStrings
    ) {
      const numericGmid =
        Number(gameId);

      if (
        Number.isFinite(
          numericGmid
        )
      ) {
        pageGmids.push(
          numericGmid
        );
      }
    }

    // ---------------------------------------------------------
    // BUILD GAME QUERY
    // ---------------------------------------------------------

    const gameOrConditions = [];

    if (
      pageObjectIds.length > 0
    ) {
      gameOrConditions.push({
        _id: {
          $in: pageObjectIds,
        },
      });
    }

    if (
      pageGmids.length > 0
    ) {
      gameOrConditions.push({
        gmid: {
          $in: pageGmids,
        },
      });
    }

    let pageGames = [];

    if (
      gameOrConditions.length > 0
    ) {
      pageGames =
        await Game.find({
          $or: gameOrConditions,
        }).lean();
    }

    // ---------------------------------------------------------
    // CREATE LOOKUP MAPS
    // ---------------------------------------------------------

    const gameByObjectId =
      new Map();

    const gameByGmid =
      new Map();

    for (
      const game
      of pageGames
    ) {
      if (game._id) {
        gameByObjectId.set(
          String(game._id),
          game
        );
      }

      if (
        game.gmid !== undefined &&
        game.gmid !== null
      ) {
        gameByGmid.set(
          String(game.gmid),
          game
        );
      }
    }

    // =========================================================
    // 13. RESTORE MATCH DATA
    // =========================================================

    for (
      const doc
      of paginatedBets
    ) {
      const gameId =
        String(
          doc.gameIdString
        );

      /*
       * IMPORTANT:
       *
       * Same priority as old aggregation:
       *
       * games._id
       *      ↓
       * games.gmid
       */

      let matchData =
        gameByObjectId.get(
          gameId
        ) || null;

      if (!matchData) {
        matchData =
          gameByGmid.get(
            gameId
          ) || null;
      }

      // =======================================================
      // ETID 8 FALLBACK
      // =======================================================

      if (
        !matchData &&
        String(doc.etid) === "8"
      ) {
        matchData = {
          ename:
            doc.eventName,

          stime:
            doc.createdAt,

          gmid:
            doc.gameId,
        };
      }

      doc.matchData =
        matchData;
    }

    // =========================================================
    // 14. PAGINATION DETAILS
    // =========================================================

    const totalPages =
      Math.ceil(
        totalDocs /
          pageLimit
      );

    // =========================================================
    // 15. RESPONSE
    // EXACT SAME STRUCTURE
    // =========================================================

    return res
      .status(httpStatus.OK)
      .json({
        success: true,

        message:
          "Manage matches fetched successfully",

        data: {
          docs:
            paginatedBets,

          totalDocs,

          limit:
            pageLimit,

          page:
            pageNumber,

          totalPages,
        },
      });

  } catch (err) {
    next(err);
  }
};


const getSportMatchByGameId = async (req, res, next) => {
  try {
    const gameId = req.params.gameId;
    const { search } = req?.query;

    const matchStage = {};
    if (search && typeof search === "string") {
      matchStage.$or = [
        { "matchData.ename": { $regex: search, $options: "i" } },
        { marketName: { $regex: search, $options: "i" } },
        { gameId: { $regex: search, $options: "i" } },
      ];
    }

    const pipeline = [
      {
        $match: {
          gameId,
          subType: { $exists: false },
          gType: { $in: ["match", "match1", "cricketcasino"] },
        },
      },
      // ensure $first picks latest per market
      { $sort: { createdAt: -1 } },
      // group bets by marketId (keeps latest bet per market)
      {
        $group: {
          _id: "$marketId",
          doc: { $first: "$$ROOT" },
          pendingBetsCount: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
          },
        },
      },
      // restore doc fields and keep betCount
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [
              "$doc",
              { marketId: "$_id", pendingBetsCount: "$pendingBetsCount" },
            ],
          },
        },
      },

      // Lookup a single games document — convert gameId to int inside the lookup (safe)
      {
        $lookup: {
          from: "games",
          let: { gidStr: "$gameId" },
          pipeline: [
            // convert the incoming string to int on the lookup side,
            // so we match numeric gmid exactly even if gameId is a string
            { $addFields: { _tmpGid: { $toInt: "$$gidStr" } } },
            { $match: { $expr: { $eq: ["$gmid", "$_tmpGid"] } } },
            // choose the newest games doc if multiple exist
            { $sort: { _id: -1 } },
            { $limit: 1 },
            // remove temp field
            { $project: { _tmpGid: 0 } },
          ],
          as: "matchData",
        },
      },
      // unwind (matchData will have 0 or 1 element due to $limit:1)
      { $unwind: { path: "$matchData", preserveNullAndEmptyArrays: true } },
      // Optional: if matchStage depends on fields from matchData or doc
      { $match: matchStage },
      // Final dedupe guard: if for any reason multiple docs still exist, group by marketId again
      {
        $group: {
          _id: "$marketId",
          doc: { $first: "$$ROOT" }, // keep the first (latest) doc
        },
      },
      { $replaceRoot: { newRoot: "$doc" } },
      // Final sort by createdAt so API always returns newest first
      { $sort: { createdAt: -1 } },

      {
        $project: {
          gameId: 1,
          winner: 1,
          run: 1,
          sections: 1,
          sectionName: 1,
          marketName: 1,
          marketId: 1,
          createdAt: 1,
          gType: 1,
          status: 1,
          pendingBetsCount: 1,
          "matchData.ename": 1,
          "matchData.stime": 1,
          "matchData.section": 1,
          "matchData.isActive": 1,
        },
      },
    ];

    let bets = await betModel.aggregate(pipeline);
    res
      .status(httpStatus.OK)
      .send(new APIResponse(bets, "Match fetched successfully", httpStatus.OK));
  } catch (err) {
    next(err);
  }
};



// const getMatchHistory = async (req, res, next) => {
//   try {
//     const {
//       etid,
//       startDate,
//       endDate,
//       search,
//       page = 1,
//       limit = 10
//     } = req?.query;

//     const skip =
//       (Number(page) - 1) * Number(limit);

//     const sDate = startDate
//       ? moment(
//           startDate,
//           "YYYY-MM-DD"
//         )
//           .startOf("day")
//           .toDate()
//       : null;

//     const eDate = endDate
//       ? moment(
//           endDate,
//           "YYYY-MM-DD"
//         )
//           .endOf("day")
//           .toDate()
//       : null;


//     // =========================================================
//     // 1. EXISTING GAME FILTER LOGIC
//     // DO NOT CHANGE
//     // =========================================================

//     const gQuery = {
//       isActive: true
//     };

//     if (etid) {
//       gQuery.etid = Number(etid);
//     }

//     const matchedGames =
//       await Game.find(gQuery).lean();

//     const filteredGameIds =
//       matchedGames
//         .filter((g) => {

//           const gDate =
//             parseMatchDate(g.stime);

//           const matchesDate =
//             (!sDate ||
//               (gDate &&
//                 gDate >= sDate)) &&
//             (!eDate ||
//               (gDate &&
//                 gDate <= eDate));

//           const matchesSearch =
//             !search ||
//             (
//               g.ename &&
//               g.ename
//                 .toLowerCase()
//                 .includes(
//                   search.toLowerCase()
//                 )
//             );

//           return (
//             matchesDate &&
//             matchesSearch
//           );
//         })
//         .map((g) => String(g.gmid));


//     // =========================================================
//     // 2. NORMAL MATCH CONDITION
//     // OLD LOGIC - DO NOT CHANGE
//     // =========================================================

//     const normalMatchCondition = {

//       gType: {
//         $in: [
//           "match",
//           "match1",
//           "cricketcasino"
//         ]
//       },

//       gameId: {
//         $in: filteredGameIds
//       }
//     };


//     // =========================================================
//     // 3. SUPER OVER CONDITION
//     // ONLY SUPER OVER
//     // =========================================================

//     const superOverCondition = {

//       cType: {
//         $regex: /^superover/i
//       }
//     };


//     // =========================================================
//     // SUPER OVER DATE FILTER
//     // ONLY SUPER OVER
//     // =========================================================

//     if (sDate || eDate) {

//       superOverCondition.createdAt = {};

//       if (sDate) {
//         superOverCondition.createdAt.$gte =
//           sDate;
//       }

//       if (eDate) {
//         superOverCondition.createdAt.$lte =
//           eDate;
//       }
//     }


//     // =========================================================
//     // SUPER OVER SEARCH
//     // ONLY SUPER OVER
//     // =========================================================

//     if (search) {

//       superOverCondition.eventName = {
//         $regex: search,
//         $options: "i"
//       };
//     }


//     // =========================================================
//     // 4. INITIAL MATCH
//     // OLD LOGIC + SUPER OVER
//     // =========================================================

//     const initialMatch = {

//       isActive: true,

//       subType: {
//         $exists: false
//       },

//       status: {
//         $in: [
//           "lost",
//           "won",
//           "cancelled"
//         ]
//       },

//       $or: [

//         // =====================================================
//         // NORMAL GAMES
//         // EXISTING LOGIC
//         // =====================================================

//         normalMatchCondition,


//         // =====================================================
//         // SUPER OVER
//         // NEW LOGIC ONLY
//         // =====================================================

//         superOverCondition
//       ]
//     };


//     // =========================================================
//     // 5. AGGREGATION
//     // =========================================================

//     const pipeline = [

//       // -------------------------------------------------------
//       // MATCH
//       // -------------------------------------------------------

//       {
//         $match: initialMatch
//       },


//       // -------------------------------------------------------
//       // GROUP
//       //
//       // NORMAL GAME:
//       //   same gameId => same group
//       //
//       // SUPER OVER:
//       //   same gameId + cType => separate group
//       //
//       // IMPORTANT:
//       // OLD NORMAL GAME GROUPING REMAINS SAME
//       // -------------------------------------------------------

//       {
//         $group: {

//           _id: {

//             gameId:
//               "$gameId",

//             cType: {

//               $cond: [

//                 {
//                   $regexMatch: {

//                     input: {
//                       $ifNull: [
//                         "$cType",
//                         ""
//                       ]
//                     },

//                     regex:
//                       /^superover/i
//                   }
//                 },

//                 // ---------------------------------------------
//                 // SUPER OVER
//                 // Keep actual cType
//                 // ---------------------------------------------

//                 "$cType",


//                 // ---------------------------------------------
//                 // NORMAL GAME
//                 // OLD BEHAVIOUR
//                 // ---------------------------------------------

//                 "normal"
//               ]
//             }
//           },


//           // ---------------------------------------------------
//           // FIRST DOCUMENT
//           // ---------------------------------------------------

//           doc: {
//             $first:
//               "$$ROOT"
//           },


//           // ---------------------------------------------------
//           // BET COUNT
//           // ---------------------------------------------------

//           betCount: {
//             $sum: 1
//           },


//           // ---------------------------------------------------
//           // LAST BET TIME
//           // ---------------------------------------------------

//           lastBetAt: {
//             $max:
//               "$createdAt"
//           }
//         }
//       },


//       // =====================================================
//       // 6. FACET
//       // =====================================================

//       {
//         $facet: {

//           // ---------------------------------------------------
//           // TOTAL
//           // ---------------------------------------------------

//           metadata: [

//             {
//               $count:
//                 "total"
//             }
//           ],


//           // ---------------------------------------------------
//           // DATA
//           // ---------------------------------------------------

//           data: [

//             // -------------------------------------------------
//             // SORT
//             // EXISTING LOGIC
//             // -------------------------------------------------

//             {
//               $sort: {
//                 lastBetAt: -1
//               }
//             },


//             // -------------------------------------------------
//             // PAGINATION
//             // EXISTING LOGIC
//             // -------------------------------------------------

//             {
//               $skip:
//                 skip
//             },

//             {
//               $limit:
//                 Number(limit)
//             },


//             // -------------------------------------------------
//             // RESTORE ORIGINAL DOCUMENT
//             // -------------------------------------------------

//             {
//               $replaceRoot: {

//                 newRoot: {

//                   $mergeObjects: [

//                     "$doc",

//                     {

//                       gameIdString:
//                         "$_id.gameId",

//                       betCount:
//                         "$betCount"
//                     }
//                   ]
//                 }
//               }
//             },


//             // -------------------------------------------------
//             // GAME ID CONVERSION
//             // EXISTING LOGIC
//             // -------------------------------------------------

//             {
//               $addFields: {

//                 lookupOid: {

//                   $convert: {

//                     input:
//                       "$gameIdString",

//                     to:
//                       "objectId",

//                     onError:
//                       null,

//                     onNull:
//                       null
//                   }
//                 },


//                 lookupGmid: {

//                   $convert: {

//                     input:
//                       "$gameIdString",

//                     to:
//                       "double",

//                     onError:
//                       null,

//                     onNull:
//                       null
//                   }
//                 }
//               }
//             },


//             // -------------------------------------------------
//             // LOOKUP BY OBJECT ID
//             // EXISTING LOGIC
//             // -------------------------------------------------

//             {
//               $lookup: {

//                 from:
//                   "games",

//                 localField:
//                   "lookupOid",

//                 foreignField:
//                   "_id",

//                 as:
//                   "gameMatchById"
//               }
//             },


//             // -------------------------------------------------
//             // LOOKUP BY GMID
//             // EXISTING LOGIC
//             // -------------------------------------------------

//             {
//               $lookup: {

//                 from:
//                   "games",

//                 localField:
//                   "lookupGmid",

//                 foreignField:
//                   "gmid",

//                 as:
//                   "gameMatchByGmid"
//               }
//             },


//             // =================================================
//             // MATCH DATA
//             //
//             // NORMAL GAME:
//             //   EXACT OLD LOGIC
//             //
//             // SUPER OVER:
//             //   fallback only for Super Over
//             // =================================================

//             {
//               $addFields: {

//                 matchData: {

//                   $ifNull: [

//                     // -----------------------------------------
//                     // OLD LOOKUP BY _id
//                     // -----------------------------------------

//                     {
//                       $arrayElemAt: [
//                         "$gameMatchById",
//                         0
//                       ]
//                     },


//                     // -----------------------------------------
//                     // OLD LOOKUP BY gmid
//                     // -----------------------------------------

//                     {
//                       $ifNull: [

//                         {
//                           $arrayElemAt: [
//                             "$gameMatchByGmid",
//                             0
//                           ]
//                         },


//                         // =====================================
//                         // SUPER OVER FALLBACK ONLY
//                         // =====================================

//                         {
//                           $cond: [

//                             {
//                               $regexMatch: {

//                                 input: {
//                                   $ifNull: [
//                                     "$cType",
//                                     ""
//                                   ]
//                                 },

//                                 regex:
//                                   /^superover/i
//                               }
//                             },


//                             // ---------------------------------
//                             // SUPER OVER matchData
//                             // ---------------------------------

//                             {

//                               gmid:
//                                 "$gameIdString",

//                               ename: {

//                                 $ifNull: [

//                                   "$eventName",

//                                   {
//                                     $ifNull: [

//                                       "$name",

//                                       "Super Over"
//                                     ]
//                                   }
//                                 ]
//                               },

//                               stime:
//                                 "$createdAt"
//                             },


//                             // ---------------------------------
//                             // NORMAL GAME
//                             // NO FALLBACK
//                             // ---------------------------------

//                             null
//                           ]
//                         }
//                       ]
//                     }
//                   ]
//                 }
//               }
//             },


//             // -------------------------------------------------
//             // REMOVE TEMP FIELDS
//             // EXISTING LOGIC
//             // -------------------------------------------------

//             {
//               $project: {

//                 gameMatchById:
//                   0,

//                 gameMatchByGmid:
//                   0,

//                 lookupOid:
//                   0,

//                 lookupGmid:
//                   0
//               }
//             }
//           ]
//         }
//       }
//     ];


//     // =========================================================
//     // 7. EXECUTE
//     // =========================================================

//     const results =
//       await betModel.aggregate(
//         pipeline
//       );


//     // =========================================================
//     // 8. PAGINATION
//     // =========================================================

//     const totalDocs =
//       results[0]
//         ?.metadata[0]
//         ?.total || 0;

//     const paginatedBets =
//       results[0]
//         ?.data || [];

//     const totalPages =
//       Math.ceil(
//         totalDocs /
//         Number(limit)
//       );


//     // =========================================================
//     // 9. RESPONSE
//     // =========================================================

//     res
//       .status(httpStatus.OK)
//       .json({

//         success:
//           true,

//         message:
//           "Match history fetched successfully",

//         data: {

//           docs:
//             paginatedBets,

//           totalDocs,

//           limit:
//             Number(limit),

//           page:
//             Number(page),

//           totalPages
//         }
//       });

//   } catch (err) {

//     next(err);
//   }
// };

//optimized
const getMatchHistory = async (req, res, next) => {
  try {
    const {
      etid,
      startDate,
      endDate,
      search,
      page = 1,
      limit = 10,
    } = req?.query;

    const pageNumber = Math.max(Number(page) || 1, 1);
    const pageLimit = Math.max(Number(limit) || 10, 1);
    const skip = (pageNumber - 1) * pageLimit;

    const sDate = startDate
      ? moment(startDate, "YYYY-MM-DD")
          .startOf("day")
          .toDate()
      : null;

    const eDate = endDate
      ? moment(endDate, "YYYY-MM-DD")
          .endOf("day")
          .toDate()
      : null;

    // =========================================================
    // 1. GAME FILTER
    // SAME REQUEST / SAME GAME FILTER BEHAVIOUR
    // =========================================================

    const gQuery = {
      isActive: true,
    };

    if (etid) {
      gQuery.etid = Number(etid);
    }

    /*
     * Only fetch fields actually required.
     *
     * Previously we were loading the complete Game documents.
     */
    const matchedGames = await Game.find(gQuery)
      .select({
        gmid: 1,
        stime: 1,
        ename: 1,
      })
      .lean();

    const searchLower = search
      ? String(search).toLowerCase()
      : null;

    const filteredGameIds = [];

    /*
     * Map is also useful later for matchData.
     */
    const gameMap = new Map();

    for (const game of matchedGames) {
      const gDate = parseMatchDate(game.stime);

      const matchesDate =
        (!sDate || (gDate && gDate >= sDate)) &&
        (!eDate || (gDate && gDate <= eDate));

      const matchesSearch =
        !searchLower ||
        (
          game.ename &&
          String(game.ename)
            .toLowerCase()
            .includes(searchLower)
        );

      if (matchesDate && matchesSearch) {
        const gmidString = String(game.gmid);

        filteredGameIds.push(gmidString);

        gameMap.set(gmidString, game);
      }
    }

    // =========================================================
    // 2. BET CONDITIONS
    // =========================================================

    const baseBetCondition = {
      isActive: true,

      subType: {
        $exists: false,
      },

      status: {
        $in: [
          "lost",
          "won",
          "cancelled",
        ],
      },
    };

    const normalCondition = {
      ...baseBetCondition,

      gType: {
        $in: [
          "match",
          "match1",
          "cricketcasino",
        ],
      },

      gameId: {
        $in: filteredGameIds,
      },
    };

    const superOverCondition = {
      ...baseBetCondition,

      cType: {
        $regex: /^superover/i,
      },
    };

    if (sDate || eDate) {
      superOverCondition.createdAt = {};

      if (sDate) {
        superOverCondition.createdAt.$gte = sDate;
      }

      if (eDate) {
        superOverCondition.createdAt.$lte = eDate;
      }
    }

    if (search) {
      superOverCondition.eventName = {
        $regex: search,
        $options: "i",
      };
    }

    // =========================================================
    // 3. IF THERE ARE NO POSSIBLE NORMAL GAMES AND NO SEARCH
    //    MATCHES, DON'T HIT BET DB UNNECESSARILY
    // =========================================================

    const hasNormalGames = filteredGameIds.length > 0;

    // =========================================================
    // 4. TOTAL COUNT
    //
    // IMPORTANT:
    // We calculate this separately instead of using $facet.
    //
    // This allows the page query and total query to run
    // independently / in parallel.
    // =========================================================

    const normalTotalPromise = hasNormalGames
      ? betModel.aggregate([
          {
            $match: normalCondition,
          },

          {
            $group: {
              _id: "$gameId",
            },
          },

          {
            $count: "total",
          },
        ])
      : Promise.resolve([]);

    const superOverTotalPromise = betModel.aggregate([
      {
        $match: superOverCondition,
      },

      {
        $group: {
          _id: {
            gameId: "$gameId",
            cType: "$cType",
          },
        },
      },

      {
        $count: "total",
      },
    ]);

    // =========================================================
    // 5. FETCH RECENT BETS
    //
    // Instead of GROUPING the entire collection first,
    // fetch recent bets ordered by createdAt.
    //
    // We deduplicate game groups in Node.
    //
    // This is especially effective for page 1 because the
    // newest bets usually give us the first few games quickly.
    // =========================================================

    const candidateBatchSize = Math.max(
      500,
      (skip + pageLimit) * 20
    );

    const normalBetsPromise = hasNormalGames
      ? betModel
          .find(normalCondition)
          .sort({
            createdAt: -1,
            _id: -1,
          })
          .select({
            gameId: 1,
            cType: 1,
            createdAt: 1,
            eventName: 1,
            name: 1,
            _id: 1,
          })
          .limit(candidateBatchSize)
          .lean()
      : Promise.resolve([]);

    const superOverBetsPromise = betModel
      .find(superOverCondition)
      .sort({
        createdAt: -1,
        _id: -1,
      })
      .select({
        gameId: 1,
        cType: 1,
        createdAt: 1,
        eventName: 1,
        name: 1,
        _id: 1,
      })
      .limit(candidateBatchSize)
      .lean();

    const [
      normalCandidates,
      superOverCandidates,
      normalTotalResult,
      superOverTotalResult,
    ] = await Promise.all([
      normalBetsPromise,
      superOverBetsPromise,
      normalTotalPromise,
      superOverTotalPromise,
    ]);

    // =========================================================
    // 6. MERGE NORMAL + SUPER OVER BETS
    //
    // Same grouping behaviour as old aggregation:
    //
    // NORMAL:
    //   gameId
    //
    // SUPER OVER:
    //   gameId + cType
    // =========================================================

    const allCandidates = [
      ...normalCandidates,
      ...superOverCandidates,
    ];

    allCandidates.sort((a, b) => {
      const aTime = a.createdAt
        ? new Date(a.createdAt).getTime()
        : 0;

      const bTime = b.createdAt
        ? new Date(b.createdAt).getTime()
        : 0;

      if (bTime !== aTime) {
        return bTime - aTime;
      }

      return String(b._id).localeCompare(
        String(a._id)
      );
    });

    // =========================================================
    // 7. GROUP IN MEMORY
    // =========================================================

    const groupedGames = new Map();

    for (const bet of allCandidates) {
      const isSuperOver =
        typeof bet.cType === "string" &&
        /^superover/i.test(bet.cType);

      const groupKey = isSuperOver
        ? `${String(bet.gameId)}::superover::${bet.cType}`
        : `${String(bet.gameId)}::normal`;

      if (!groupedGames.has(groupKey)) {
        groupedGames.set(groupKey, {
          gameId: String(bet.gameId),
          cType: isSuperOver
            ? bet.cType
            : "normal",

          /*
           * This is the latest bet because candidates
           * were sorted descending by createdAt.
           */
          doc: bet,

          lastBetAt: bet.createdAt,
        });
      }
    }

    const groupedArray = Array.from(
      groupedGames.values()
    );

    groupedArray.sort((a, b) => {
      const aTime = a.lastBetAt
        ? new Date(a.lastBetAt).getTime()
        : 0;

      const bTime = b.lastBetAt
        ? new Date(b.lastBetAt).getTime()
        : 0;

      return bTime - aTime;
    });

    // =========================================================
    // 8. PAGE
    // =========================================================

    const paginatedGroups = groupedArray.slice(
      skip,
      skip + pageLimit
    );

    // =========================================================
    // 9. GET EXACT BET COUNT FOR ONLY THE DISPLAYED GROUPS
    //
    // Instead of counting every bet for every game in the
    // original $group, we only count the games that are
    // actually going to be returned.
    // =========================================================

    const normalPageGameIds = paginatedGroups
      .filter(
        (group) => group.cType === "normal"
      )
      .map((group) => group.gameId);

    const superOverPageGroups = paginatedGroups
      .filter(
        (group) => group.cType !== "normal"
      )
      .map((group) => ({
        gameId: group.gameId,
        cType: group.cType,
      }));

    const countPromises = [];

    if (normalPageGameIds.length > 0) {
      countPromises.push(
        betModel.aggregate([
          {
            $match: {
              ...baseBetCondition,

              gType: {
                $in: [
                  "match",
                  "match1",
                  "cricketcasino",
                ],
              },

              gameId: {
                $in: normalPageGameIds,
              },
            },
          },

          {
            $group: {
              _id: "$gameId",
              betCount: {
                $sum: 1,
              },
            },
          },
        ])
      );
    } else {
      countPromises.push(
        Promise.resolve([])
      );
    }

    if (superOverPageGroups.length > 0) {
      countPromises.push(
        betModel.aggregate([
          {
            $match: {
              ...baseBetCondition,

              cType: {
                $regex: /^superover/i,
              },

              $or: superOverPageGroups.map(
                (group) => ({
                  gameId: group.gameId,
                  cType: group.cType,
                })
              ),
            },
          },

          {
            $group: {
              _id: {
                gameId: "$gameId",
                cType: "$cType",
              },

              betCount: {
                $sum: 1,
              },
            },
          },
        ])
      );
    } else {
      countPromises.push(
        Promise.resolve([])
      );
    }

    const [
      normalCounts,
      superOverCounts,
    ] = await Promise.all(
      countPromises
    );

    // =========================================================
    // 10. BUILD COUNT MAPS
    // =========================================================

    const normalCountMap = new Map();

    for (const item of normalCounts) {
      normalCountMap.set(
        String(item._id),
        item.betCount
      );
    }

    const superOverCountMap = new Map();

    for (const item of superOverCounts) {
      superOverCountMap.set(
        `${String(item._id.gameId)}::${item._id.cType}`,
        item.betCount
      );
    }

    // =========================================================
    // 11. BUILD FINAL DOCUMENTS
    //
    // SAME RESPONSE DOCUMENT STRUCTURE
    // =========================================================

    const paginatedBets = paginatedGroups.map(
      (group) => {
        const doc = {
          ...group.doc,

          gameIdString: group.gameId,

          betCount:
            group.cType === "normal"
              ? (
                  normalCountMap.get(
                    group.gameId
                  ) || 0
                )
              : (
                  superOverCountMap.get(
                    `${group.gameId}::${group.cType}`
                  ) || 0
                ),
        };

        // =====================================================
        // MATCH DATA
        // =====================================================

        let matchData = null;

        /*
         * First: same idea as old lookup by gmid.
         */
        const game =
          gameMap.get(group.gameId);

        if (game) {
          matchData = game;
        }

        /*
         * Existing normal behaviour had another lookup
         * against games._id using ObjectId(gameId).
         *
         * We preserve that fallback only when the game
         * wasn't found by gmid.
         */
        if (!matchData) {
          const isValidObjectId =
            mongoose.Types.ObjectId.isValid(
              group.gameId
            );

          if (isValidObjectId) {
            /*
             * This lookup is handled below in bulk.
             */
          }
        }

        /*
         * Super-over fallback exactly as before.
         */
        if (
          !matchData &&
          group.cType !== "normal"
        ) {
          matchData = {
            gmid: group.gameId,

            ename:
              group.doc.eventName ||
              group.doc.name ||
              "Super Over",

            stime:
              group.doc.createdAt,
          };
        }

        doc.matchData = matchData;

        return doc;
      }
    );

    // =========================================================
    // 12. OBJECT ID GAME FALLBACK
    //
    // Existing code also searched games._id.
    // Do this ONCE for all returned documents rather than
    // performing a $lookup pipeline for every aggregation row.
    // =========================================================

    const objectIds = [];

    for (const doc of paginatedBets) {
      if (
        !doc.matchData &&
        mongoose.Types.ObjectId.isValid(
          doc.gameIdString
        )
      ) {
        objectIds.push(
          new mongoose.Types.ObjectId(
            doc.gameIdString
          )
        );
      }
    }

    if (objectIds.length > 0) {
      const objectIdGames =
        await Game.find({
          _id: {
            $in: objectIds,
          },
        })
          .lean();

      const objectIdGameMap =
        new Map(
          objectIdGames.map(
            (game) => [
              String(game._id),
              game,
            ]
          )
        );

      for (const doc of paginatedBets) {
        if (!doc.matchData) {
          doc.matchData =
            objectIdGameMap.get(
              doc.gameIdString
            ) || null;
        }
      }
    }

    // =========================================================
    // 13. TOTAL
    // =========================================================

    const normalTotal =
      normalTotalResult?.[0]?.total || 0;

    const superOverTotal =
      superOverTotalResult?.[0]?.total || 0;

    const totalDocs =
      normalTotal +
      superOverTotal;

    const totalPages = Math.ceil(
      totalDocs / pageLimit
    );

    // =========================================================
    // 14. RESPONSE
    // EXACT SAME RESPONSE STRUCTURE
    // =========================================================

    return res
      .status(httpStatus.OK)
      .json({
        success: true,

        message:
          "Match history fetched successfully",

        data: {
          docs: paginatedBets,

          totalDocs,

          limit: pageLimit,

          page: pageNumber,

          totalPages,
        },
      });

  } catch (err) {
    next(err);
  }
};



const getMatchHistoryByGameId = async (req, res, next) => {
  try {
    const { search } = req?.query;
    const gameId = req.params.gameId;

    const matchStage = {};

    if (search && typeof search === "string") {
      matchStage.$or = [
        {
          "matchData.ename": {
            $regex: search,
            $options: "i",
          },
        },
        {
          marketName: {
            $regex: search,
            $options: "i",
          },
        },
        {
          gameId: {
            $regex: search,
            $options: "i",
          },
        },

        // Super Over search
        {
          eventName: {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

    const pipeline = [
      // =====================================================
      // MATCH
      // =====================================================
      {
        $match: {
          gameId,

          isActive: true,

          subType: {
            $exists: false,
          },

          status: {
            $in: [
              "lost",
              "won",
              "cancelled",
              "pending",
            ],
          },

          $or: [
            // =================================================
            // OLD LOGIC
            // Normal games remain exactly same
            // =================================================
            {
              gType: {
                $in: [
                  "match",
                  "match1",
                  "cricketcasino",
                ],
              },
            },

            // =================================================
            // SUPER OVER ONLY
            // =================================================
            {
              cType: {
                $regex: /^superover/i,
              },
            },
          ],
        },
      },

      // =====================================================
      // OLD SORT
      // =====================================================
      {
        $sort: {
          createdAt: -1,
        },
      },

      // =====================================================
      // OLD GROUP
      // =====================================================
      {
        $group: {
          _id: "$marketId",

          doc: {
            $first: "$$ROOT",
          },

          pendingBetsCount: {
            $sum: {
              $cond: [
                {
                  $eq: [
                    "$status",
                    "pending",
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },

      // =====================================================
      // OLD REPLACE ROOT
      // =====================================================
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: [
              "$doc",

              {
                marketId: "$_id",

                pendingBetsCount:
                  "$pendingBetsCount",
              },
            ],
          },
        },
      },

      // =====================================================
      // GAME ID NUMBER
      // OLD LOGIC
      // =====================================================
      {
        $addFields: {
          gameIdNum: {
            $convert: {
              input: "$gameId",
              to: "int",
              onError: null,
              onNull: null,
            },
          },
        },
      },

      // =====================================================
      // OLD GAMES LOOKUP
      // =====================================================
      {
        $lookup: {
          from: "games",

          localField: "gameIdNum",

          foreignField: "gmid",

          as: "gameMatchData",
        },
      },

      // =====================================================
      // CREATE MATCH DATA
      //
      // NORMAL GAME:
      // Existing games collection logic EXACTLY SAME
      //
      // SUPER OVER:
      // eventName + createdAt + sections se data
      //
      // IMPORTANT:
      // Super Over ke liye games collection ka
      // incomplete matchData use nahi hoga.
      // =====================================================
      {
        $addFields: {
          matchData: {
            $cond: [

              // =================================================
              // SUPER OVER
              // =================================================
              {
                $regexMatch: {
                  input: {
                    $ifNull: [
                      "$cType",
                      "",
                    ],
                  },

                  regex: /^superover/i,
                },
              },

              // =================================================
              // SUPER OVER MATCH DATA
              // =================================================
              {
                gmid: "$gameId",

                // -----------------------------------------------
                // EVENT NAME
                // -----------------------------------------------
                ename: {
                  $ifNull: [
                    "$eventName",

                    {
                      $ifNull: [
                        "$name",
                        "Super Over",
                      ],
                    },
                  ],
                },

                // -----------------------------------------------
                // DATE / TIME
                //
                // First games.stime
                // If games.stime missing then bet.createdAt
                // -----------------------------------------------
                stime: {
                  $ifNull: [

                    {
                      $arrayElemAt: [
                        "$gameMatchData.stime",
                        0,
                      ],
                    },

                    "$createdAt",
                  ],
                },

                // -----------------------------------------------
                // SECTION
                //
                // Agar games collection me proper section
                // available hai to use karo.
                //
                // Agar games section empty hai to
                // Super Over bet ke sections use karo.
                // -----------------------------------------------
                section: {
                  $cond: [

                    // Check games section
                    {
                      $gt: [
                        {
                          $size: {
                            $ifNull: [

                              {
                                $arrayElemAt: [
                                  "$gameMatchData.section",
                                  0,
                                ],
                              },

                              [],
                            ],
                          },
                        },

                        0,
                      ],
                    },

                    // -----------------------------------------
                    // games collection section
                    // -----------------------------------------
                    {
                      $arrayElemAt: [
                        "$gameMatchData.section",
                        0,
                      ],
                    },

                    // -----------------------------------------
                    // Super Over bet sections
                    // -----------------------------------------
                    {
                      $ifNull: [
                        "$sections",
                        [],
                      ],
                    },
                  ],
                },

                // -----------------------------------------------
                // ACTIVE STATUS
                // -----------------------------------------------
                isActive: "$isActive",
              },

              // =================================================
              // NORMAL GAME
              //
              // OLD LOGIC EXACTLY SAME
              // =================================================
              {
                $cond: [

                  {
                    $gt: [
                      {
                        $size:
                          "$gameMatchData",
                      },

                      0,
                    ],
                  },

                  // -------------------------------------------
                  // Existing games collection data
                  // -------------------------------------------
                  {
                    $arrayElemAt: [
                      "$gameMatchData",
                      0,
                    ],
                  },

                  // -------------------------------------------
                  // Existing normal-game behavior
                  // -------------------------------------------
                  null,
                ],
              },
            ],
          },
        },
      },

      // =====================================================
      // SEARCH
      // =====================================================
      {
        $match: matchStage,
      },

      // =====================================================
      // PROJECT
      // =====================================================
      {
        $project: {
          gameId: 1,

          winner: 1,

          run: 1,

          sections: 1,

          marketName: 1,

          sectionName: 1,

          marketId: 1,

          pendingBetsCount: 1,

          // Super Over
          cType: 1,

          eventName: 1,

          // Match Data
          "matchData.ename": 1,

          "matchData.stime": 1,

          "matchData.section": 1,

          "matchData.isActive": 1,
        },
      },
    ];

    // =====================================================
    // EXECUTE
    // =====================================================

    const bets =
      await betModel.aggregate(
        pipeline
      );

    // =====================================================
    // RESPONSE
    // =====================================================

    // res
    //   .status(httpStatus.OK)
    //   .send(
    //     new APIResponse(
    //       bets,
    //       "Match fetched successfully",
    //       httpStatus.OK
    //     )
    //   );

    const response = new APIResponse(
        bets,
        "Match fetched successfully",
        httpStatus.OK
      );

      console.log("********========================================");
      console.log("FRONTEND RESPONSE - getMatchHistoryByGameId");
      console.log("GAME ID:", gameId);
      console.log("FULL RESPONSE:");
      console.dir(response, {
        depth: null,
        colors: false
      });
      console.log("========================================");

      res
        .status(httpStatus.OK)
        .send(response);

  } catch (err) {
    next(err);
  }
};

const removeDeletedBet = async (req, res, next) => {
  try {
    const { betId } = req.body;

    if (!betId) {
      return res.status(400).json({
        success: false,
        message: "betId is required",
      });
    }

    const updatedBet = await Bet.findByIdAndUpdate(
      betId,
      {
        $set: {
          deleteBetStatus: true,
        },
      },
      {
        new: true,
      }
    );

    if (!updatedBet) {
      return res.status(404).json({
        success: false,
        message: "Bet not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Bet deleted successfully!",
    });

  } catch (error) {
    console.error("removeDeletedBet error:", error);
    next(error);
  }
};

const getBetsProfit = async (req, res, next) => {
  try {
    const { gType } = req.body;

    if (!gType) {
      return res.status(400).json({
        success: false,
        message: "gType is required",
      });
    }

    const result = await betModel.aggregate([
      {
        $match: {
          gType: gType,
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt",
            },
          },
          profit: {
            $sum: { $ifNull: ["$profit", 0] },
          },
        },
      },
      {
        $project: {
          _id: 0,
          date: "$_id",
          profit: 1,
        },
      },
      {
        $sort: {
          date: 1,
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.log("+++++****getBetsProfit****",error);
    next(error);
  }
};

module.exports = {
  getAccountStatement,
  getAdminAccountStatement,
  getSportMatchFancyHistory,
  getSportMatchFancyBet,
  getFancyMatchHistory,
  getSportMatchFancyBetHistory,
  getSportMatch,
  getSportMatchByGameId,
  getMatchHistory,
  getMatchHistoryByGameId,
  manageCasino,
  removeDeletedBet,
  getBetsProfit,
  getShortxAdminAccountStatement,
 
};
