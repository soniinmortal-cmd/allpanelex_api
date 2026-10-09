const httpStatus = require("http-status");
const APIError = require("../../helpers/APIError");
const APIResponse = require("../../helpers/APIResponse");
const Utils = require("../../helpers/utils");
const { createUser } = require("../../../config/param-validation");
const {
  User,
  getUser,
  getAllUsers,
  getUserById,
  updateUser,
  getUsersByPartnerId,
  bindUserDepositKey,
  getNestedChildren,
  updateUserLockRecursively,
  getSingleUserPartnershipData,
  getUsersByPartnerIdWithUserLock,
  getUsersByPartnerIdWithUserLockShotx
} = require("./users.helper");
const mongoose = require("mongoose");
const UserLockHistory = require("../users/userLockHistory.model");
const { delCache, getCache, setCache } = require("../../helpers/cache");
const {
  initUserPerformance,
} = require("../userPerformance/userPerformance.helper");
const { createUserLog } = require("../userLog/userLog.helper");
const { Settings } = require("../settings/settings.helper");
const { transferBalance } = require("../transaction/transaction.helper");
const { collectAllIds } = require("../bet/bet.helper");
const transactionModel = require("../transaction/transaction.model");
const {
  savaPartnerShip,
  updatePartnershipByUserAndPartner,
  findPartnershipByUserAndPartner,
} = require("../partnership/partnership.helper");
const { getDomainByDomain } = require("../domain/domain.helper");
const Partnership = require("../partnership/partnership.model");
const Bet = require("../bet/bet.model");
const Usermodel = require("./users.model.js");
const UserLog = require("../userLog/userLog.model");

const UserAccess = require("./userAccess.model");
const AccessPin = require("./pin.model.js");
const Domain = require("../domain/domain.model");
const {
  getAllSportsData,
} = require("../sports-data/sports-data.helper.js");

const SecureAuthUsers = require("../../apis/secureAuth/secureAuthUsers.model.js");
const GoogleAuthenticatorUsers = require("../../apis/secureAuth/googleAuthenticatorUsers.model.js");

const getUserLockHistory = async (req, res, next) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "userId is required",
            httpStatus.BAD_REQUEST
          )
        );
    }

    const history = await UserLockHistory.find({ userId })
      .sort({ createdAt: -1 })
      .lean();

    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          history,
          "User lock history fetched successfully",
          httpStatus.OK
        )
      );
  } catch (error) {
    next(error);
  }
};

const getDirectChildBettingReport = async (req, res, next) => {
  try {
    const {
      userId,
      fromDate,
      toDate,
      commissionType,
      fancycommissionType,
      search,
      casinoCommission,
      userLock = "false",
    } = req.query;

    // ------------------------------------------------------------
    // USER LOCK FILTER
    // Same flow as getUsersByPartnerWithUserLock
    // false = Active
    // true  = Deactive
    // ------------------------------------------------------------

    const selectedUserLock =
      userLock === true || userLock === "true";

    // ------------------------------------------------------------
    // VALIDATE USER ID
    // ------------------------------------------------------------

    if (!userId) {
      throw new APIError(
        "userId is required",
        httpStatus.BAD_REQUEST
      );
    }

    let startDate;
    let endDate;

    if (fromDate || toDate) {
      if (!fromDate || !toDate) {
        throw new APIError(
          "Both fromDate and toDate are required when using date filter",
          httpStatus.BAD_REQUEST
        );
      }

      const parseDate = (dateString, endOfDay = false) => {
        const [day, month, year] = String(dateString)
          .split("/")
          .map(Number);

        if (!day || !month || !year) {
          return null;
        }

        const date = new Date(year, month - 1, day);

        if (endOfDay) {
          date.setHours(23, 59, 59, 999);
        } else {
          date.setHours(0, 0, 0, 0);
        }

        return date;
      };

      startDate = parseDate(fromDate);
      endDate = parseDate(toDate, true);

      if (
        !startDate ||
        !endDate ||
        isNaN(startDate.getTime()) ||
        isNaN(endDate.getTime())
      ) {
        throw new APIError(
          "Invalid date format. Use DD/MM/YYYY",
          httpStatus.BAD_REQUEST
        );
      }

      if (startDate > endDate) {
        throw new APIError(
          "fromDate cannot be greater than toDate",
          httpStatus.BAD_REQUEST
        );
      }
    }

    // ------------------------------------------------------------
    // FIND DIRECT CHILDREN
    // USERLOCK BASED DATA
    // false = ACTIVE
    // true  = DEACTIVE
    // ------------------------------------------------------------

    const children = await Usermodel.find({
      parent: userId,
      isActive: true,
      userLock: selectedUserLock,
    })
      .select("_id username role parent userLock")
      .lean();

    if (!children.length) {
      return res
        .status(httpStatus.OK)
        .send(
          new APIResponse(
            [],
            "No direct children found",
            httpStatus.OK
          )
        );
    }

    // ------------------------------------------------------------
    // FIND COMPLETE HIERARCHY OF EACH DIRECT CHILD
    // ------------------------------------------------------------

    const descendantTopParentMap = new Map();
    const allHierarchyUserIds = [];
    const userMap = new Map();

    let currentLevel = children.map((child) => {
      const childId = String(child._id);

      descendantTopParentMap.set(childId, childId);
      allHierarchyUserIds.push(child._id);
      userMap.set(childId, child);

      return {
        _id: child._id,
        topParentId: childId,
      };
    });

    while (currentLevel.length) {
      const currentIds = currentLevel.map(
        (item) => item._id
      );

      const nextChildren = await Usermodel.find({
        parent: {
          $in: currentIds,
        },
      })
        .select("_id username role parent")
        .lean();

      if (!nextChildren.length) {
        break;
      }

      const currentTopMap = new Map();

      for (const item of currentLevel) {
        currentTopMap.set(
          String(item._id),
          item.topParentId
        );
      }

      const nextLevel = [];

      for (const child of nextChildren) {
        const childId = String(child._id);
        const parentId = String(child.parent);

        const topParentId =
          currentTopMap.get(parentId);

        if (!topParentId) {
          continue;
        }

        descendantTopParentMap.set(
          childId,
          topParentId
        );

        allHierarchyUserIds.push(child._id);

        userMap.set(
          childId,
          child
        );

        nextLevel.push({
          _id: child._id,
          topParentId,
        });
      }

      currentLevel = nextLevel;
    }

    const hierarchyParentIds = new Set();

    for (const user of userMap.values()) {
      if (user.parent) {
        hierarchyParentIds.add(String(user.parent));
      }
    }

    const leafUserIds = allHierarchyUserIds.filter(
      (userId) =>
        !hierarchyParentIds.has(String(userId))
    );

    // ------------------------------------------------------------
    // PARTNERSHIPS
    // ------------------------------------------------------------

    const partnerships = await Partnership
      .find({
        userId: {
          $in: allHierarchyUserIds,
        },
      })
      .select(
        "userId partnerId bookmakerCommission fancyCommission casinoCommission"
      )
      .lean();

    const partnershipMap = new Map();

    for (const partnership of partnerships) {
      partnershipMap.set(
        `${String(partnership.userId)}|${String(
          partnership.partnerId
        )}`,
        partnership
      );
    }

    // ------------------------------------------------------------
    // FIND ALL BETS OF DIRECT CHILDREN
    // IMPORTANT: profit added in select
    // ------------------------------------------------------------

    const betQuery = {
      userId: {
        //$in: childIds,
        $in: allHierarchyUserIds,
      },
    };

    if (startDate && endDate) {
      betQuery.createdAt = {
        $gte: startDate,
        $lte: endDate,
      };
    }

    const bets = await Bet.find(betQuery)
      .select(
        //"userId amount profit gType marketName sectionName"
        "userId amount profit gType cType marketName sectionName etid iscc"
      )
      .lean();

    // ------------------------------------------------------------
    // FIND ACTUAL COMMISSION PAYMENTS
    // ------------------------------------------------------------

    // const commissionQuery = {
    //   userId: {
    //    // $in: childIds,
    //    $in: allHierarchyUserIds,
    //   },
    //   type: "commission",
    //   status: "approved",
    //   amount: {
    //     $gt: 0,
    //   },
    // };

    const commissionQuery = {
      userId: {
        $in: leafUserIds,
      },
      type: "commission",
      status: "approved",
      amount: {
        $gt: 0,
      },
    };

    if (startDate && endDate) {
      commissionQuery.createdAt = {
        $gte: startDate,
        $lte: endDate,
      };
    }

    // const commissionTransactions =
    //   await transactionModel
    //     .find(commissionQuery)
    //     .select("userId amount remarks")
    //     .lean();

    const commissionTransactions =
      await transactionModel
        .find(commissionQuery)
        .select("_id userId amount remarks")
        .lean();

    // ------------------------------------------------------------
    // INITIALIZE REPORT
    // ------------------------------------------------------------

    const reportMap = new Map();

    for (const child of children) {
      reportMap.set(String(child._id), {
        userId: child._id,
        username: child.username,
        role: child.role,
        showCommission: false,

        bmAmount: 0,
        bmCommissionPaid: 0,

        fancyAmount: 0,
        fancyCommissionPaid: 0,

        casinoAmount: 0,
        casinoCommissionPaid: 0,
      });
    }

    // ------------------------------------------------------------
    // CALCULATE BET AMOUNTS
    // ------------------------------------------------------------

    for (const bet of bets) {
      const betUserId = String(bet.userId);

      const topParentId =
        descendantTopParentMap.get(betUserId);

      if (!topParentId) {
        continue;
      }

      const report =
        reportMap.get(topParentId);

      if (!report) {
        continue;
      }

      const bettingUser =
        userMap.get(betUserId);

      const immediateParentId =
        bettingUser?.parent
          ? String(bettingUser.parent)
          : null;

      const partnership =
        immediateParentId
          ? partnershipMap.get(
              `${betUserId}|${immediateParentId}`
            )
          : null;

      let showCommission = false;

      if (req.user?.role === "owner") {
        showCommission = true;
      } else {
        const casinoType =
          partnership?.casinoCommission?.type || "NONE";

        showCommission =
          casinoType !== "NONE";
      }

      const amount = Number(
        bet.amount || 0
      );

      const profit = Number(
        bet.profit || 0
      );

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

      const casinoGameTypes = [
        "superover3",
        "superover",
        "superover2",
        "cricketv3",
      ];

      const isCasinoGameType =
        casinoGameTypes.includes(cType);

      const sectionName = String(
        bet.sectionName || ""
      )
        .trim()
        .toLowerCase();

      // ----------------------------------------------------------
      // BOOKMAKER CHECK
      // ----------------------------------------------------------

      const isBookmaker =
        marketName === "bookmaker" ||
        marketName === "bookmaker 2";

      // ----------------------------------------------------------
      // FANCY CHECK
      // ----------------------------------------------------------

      const isFancy =
        gType === "fancy" ||
        (
          gType === "fancy1" &&
          !sectionName.includes("will win the toss")
        );

        if (isCasinoGameType) {
            const casinoType =
              partnership?.casinoCommission?.type || "NONE";

            if (casinoType === "ENTRY_LOOSING" && profit < 0) {
              report.casinoAmount += Math.abs(profit);
            }
          }

      if (isBookmaker && !isCasinoGameType && bet.etid === "4" && (bet.iscc === undefined || Number(bet.iscc) === 0)) {
        const bookmakerCommission =
          partnership?.bookmakerCommission || [];

        // Existing old logic
        const bookmakerType =
          bookmakerCommission?.[0]?.type || "NONE";

        const effectiveCommissionType =
          commissionType || bookmakerType;

        if (effectiveCommissionType === "NONE") {

        } else if (
          effectiveCommissionType === "ENTRY_WISE"
        ) {
          report.bmAmount += profit;

        } else if (
          effectiveCommissionType === "ENTRY_LOOSING" ||
          effectiveCommissionType === "NET_LOOSING"
        ) {
          if (profit < 0) {
            report.bmAmount += Math.abs(profit);
          }
        }
      }

      // ----------------------------------------------------------
      // FANCY BET AMOUNT
      // ----------------------------------------------------------

      // else if (isFancy) {
      //   const fancyType =
      //     partnership?.fancyCommission?.[0]?.type || "NONE";

      //   if (fancyType !== "NONE") {
      //     report.fancyAmount += Math.abs(profit);
      //   }
      // }

     // else if (isFancy) {
      else if (isFancy && !isCasinoGameType && bet.etid === "4" && (bet.iscc === undefined || Number(bet.iscc) === 0)) {
        const fancyType =
          partnership?.fancyCommission?.[0]?.type || "NONE";

        if (
          fancycommissionType &&
          fancycommissionType !== "NONE"
        ) {
          if (
            fancycommissionType === "ENTRY_WISE"
          ) {
            report.fancyAmount += Math.abs(profit);
          }
        } else {
          if (fancyType !== "NONE") {
            report.fancyAmount += Math.abs(profit);
          }
        }
      }

      // ----------------------------------------------------------
      // CASINO BET AMOUNT
      // ----------------------------------------------------------

      else if (!isBookmaker && !isFancy) {
        const casinoType =
          partnership?.casinoCommission?.type || "NONE";

        if (casinoType === "ENTRY_LOOSING") {
          if (profit < 0) {
            report.casinoAmount += Math.abs(profit);
          }
        }
      }
    }

    // ------------------------------------------------------------
    // CALCULATE ACTUAL COMMISSION PAID
    // ------------------------------------------------------------

    const processedCommissionTransactions =
      new Set();

    // for (const transaction of commissionTransactions) {
    //   // const childId = String(transaction.userId);

    //   // const report = reportMap.get(childId);

    //   // if (!report) {
    //   //   continue;
    //   // }

    //   const transactionUserId =
    //     String(transaction.userId);

    //   const topParentId =
    //     descendantTopParentMap.get(
    //       transactionUserId
    //     );

    //   if (!topParentId) {
    //     continue;
    //   }

    //   const report =
    //     reportMap.get(topParentId);

    //   if (!report) {
    //     continue;
    //   }

    //   const commissionAmount = Number(
    //     transaction.amount || 0
    //   );

    //   if (commissionAmount <= 0) {
    //     continue;
    //   }

    //   const remarks = String(
    //     transaction.remarks || ""
    //   ).toLowerCase();

    //   const isBookmakerCommission =
    //     remarks.includes("bookmaker") ||
    //     remarks.includes("bookmaker 2");

    //   if (isBookmakerCommission) {
    //     report.bmCommissionPaid += commissionAmount;
    //   } else {
    //     report.fancyCommissionPaid += commissionAmount;
    //   }
    // }

    for (const transaction of commissionTransactions) {
      const transactionId =
        String(transaction._id);


      if (
        processedCommissionTransactions.has(
          transactionId
        )
      ) {
        continue;
      }

      processedCommissionTransactions.add(
        transactionId
      );

      const transactionUserId =
        String(transaction.userId);

      const topParentId =
        descendantTopParentMap.get(
          transactionUserId
        );

      if (!topParentId) {
        continue;
      }

      const report =
        reportMap.get(topParentId);

      if (!report) {
        continue;
      }

      const commissionAmount =
        Number(transaction.amount || 0);

      if (commissionAmount <= 0) {
        continue;
      }

      const remarks = String(
        transaction.remarks || ""
      ).toLowerCase();

      const isBookmakerCommission =
        remarks.includes("bookmaker") ||
        remarks.includes("bookmaker 2");

      const isCasinoCommission =
        remarks.includes("casino");

      if (isBookmakerCommission) {
        report.bmCommissionPaid +=
          commissionAmount;
      } else if (isCasinoCommission) {
        report.casinoCommissionPaid +=
          commissionAmount;
      } else {
        report.fancyCommissionPaid +=
          commissionAmount;
      }
    }

    // ------------------------------------------------------------
    // FINAL RESPONSE
    // ------------------------------------------------------------

    const data = Array.from(
      reportMap.values()
    ).map((item) => ({
      userId: item.userId,
      username: item.username,
      role: item.role,

      bmAmount: Number(
        item.bmAmount.toFixed(2)
      ),

      // bmAmount: Number(
      //   Math.abs(item.bmAmount).toFixed(2)
      // ),

      bmCommissionPaid: Number(
        item.bmCommissionPaid.toFixed(2)
      ),

      fancyAmount: Number(
        item.fancyAmount.toFixed(2)
      ),

      fancyCommissionPaid: Number(
        item.fancyCommissionPaid.toFixed(2)
      ),

      casinoAmount: Number(
        item.casinoAmount.toFixed(2)
      ),

      casinoCommissionPaid: Number(
        item.casinoCommissionPaid.toFixed(2)
      ),
    }));

    const finalData = data.map((item) => {
      const bmCommission = Number(
        req.query.bmCommission || 0
      );

      const fancyCommission = Number(
        req.query.fancyCommission || 0
      );

      const casinoCommissionValue =
        Number(casinoCommission || 0);

      const casinoCommissionAmount =
        (Number(item.casinoAmount || 0) *
          casinoCommissionValue) /
        100;

      // const netCommission =
      //   -(
      //     Number(item.bmCommissionPaid || 0) +
      //     Number(item.fancyCommissionPaid || 0)
      //   );

      const netCommission =
        -(
          Number(item.bmCommissionPaid || 0) +
          Number(item.fancyCommissionPaid || 0) +
          Number(item.casinoCommissionPaid || 0)
        );

      return {
        ...item,

        // Commission column keys
        bmCommission,
        fancyCommission,

        casinoCommission: Number(
          casinoCommissionAmount.toFixed(2)
        ),

        // Net Commission key
        netCommission: Number(
          netCommission.toFixed(2)
        ),
      };
    });

    // =====================================================
    // ALL NUMERIC COLUMN TOTALS
    // =====================================================

    const totals = {
      totalBmAmount: 0,
      totalBmCommission: 0,
      totalBmCommissionPaid: 0,

      totalFancyAmount: 0,
      totalFancyCommission: 0,
      totalFancyCommissionPaid: 0,

      totalCasinoAmount: 0,
      totalCasinoCommission: 0,
      totalCasinoCommissionPaid: 0,

      totalNetCommission: 0,
    };

    finalData.forEach((item) => {
      totals.totalBmAmount +=
        Number(item.bmAmount || 0);

      totals.totalBmCommission +=
        Number(item.bmCommission || 0);

      totals.totalBmCommissionPaid +=
        Number(item.bmCommissionPaid || 0);

      totals.totalFancyAmount +=
        Number(item.fancyAmount || 0);

      totals.totalFancyCommission +=
        Number(item.fancyCommission || 0);

      totals.totalFancyCommissionPaid +=
        Number(item.fancyCommissionPaid || 0);

      totals.totalCasinoAmount +=
        Number(item.casinoAmount || 0);

      totals.totalCasinoCommission +=
        Number(item.casinoCommission || 0);

      totals.totalCasinoCommissionPaid +=
        Number(item.casinoCommissionPaid || 0);

      totals.totalNetCommission +=
        Number(item.netCommission || 0);
    });

    // Decimal formatting
    Object.keys(totals).forEach((key) => {
      totals[key] = Number(
        totals[key].toFixed(2)
      );
    });

    // ------------------------------------------------------------
    // FINAL API RESPONSE
    // ------------------------------------------------------------

    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          {
            data: data,
            total: totals,

            showCommission:
              req.user?.role === "owner"
                ? true
                : children.some((child) =>
                    partnershipMap.get(
                      `${String(child._id)}|${String(userId)}`
                    )?.casinoCommission?.type ===
                    "ENTRY_LOOSING"
                  ),
          },
          "Direct child betting report fetched successfully",
          httpStatus.OK
        )
      );

  } catch (e) {
    console.log("error+++", e);
    next(e);
  }
};


const getChildUserDetails = async (req, res, next) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      throw new APIError(
        "userId is required",
        httpStatus.BAD_REQUEST
      );
    }

    // ==========================================
    // GET PARENT USER
    // ==========================================

    const parentUser = await Usermodel.findOne({
      $or: [
        {
          _id: mongoose.isValidObjectId(userId)
            ? userId
            : null,
        },
        {
          username: userId,
        },
      ],
    })
      .select("_id username name role")
      .lean();

    if (!parentUser) {
      throw new APIError(
        "Parent user not found",
        httpStatus.NOT_FOUND
      );
    }

    // ==========================================
    // GET ALL DESCENDANTS
    //
    // Example:
    // sadmin
    //   -> x4
    //      -> testing123
    //         -> abc
    //
    // sadmin login => x4 + testing123 + abc
    // x4 login     => testing123 + abc
    // ==========================================

    // const users = await Usermodel.aggregate([
    //   {
    //     $match: {
    //       _id: parentUser._id,
    //     },
    //   },

    //   {
    //     $graphLookup: {
    //       from: Usermodel.collection.name,

    //       startWith: "$_id",

    //       connectFromField: "_id",
    //       connectToField: "parent",

    //       as: "children",

    //       restrictSearchWithMatch: {
    //         isActive: true,
    //       },
    //     },
    //   },

    //   {
    //     $unwind: {
    //       path: "$children",
    //       preserveNullAndEmptyArrays: false,
    //     },
    //   },

    //   {
    //     $replaceRoot: {
    //       newRoot: "$children",
    //     },
    //   },

    //   {
    //     $match: {
    //       isActive: true,
    //     },
    //   },

    //   {
    //     $project: {
    //       _id: 1,
    //       username: 1,
    //       name: 1,
    //       role: 1,
    //       parent: 1,
    //       userLock: 1,
    //       isActive: 1,

    //       balance: 1,
    //       coins: 1,
    //       userCR: 1,
    //       exp: 1,
    //       exp_limit: 1,
    //       partnerLevel: 1,

    //       commission: 1,
    //       partnershipValue: 1,
    //       domain: 1,

    //       shareType: 1,
    //       myMatchShare: 1,
    //       myCommType: 1,
    //       matchShare: 1,
    //       commType: 1,

    //       myCasinoShare: 1,
    //       casinoShare: 1,

    //       sessShare: 1,
    //       matkaShare: 1,

    //       createdAt: 1,
    //     },
    //   },

    //   {
    //     $sort: {
    //       createdAt: -1,
    //     },
    //   },
    // ]);

    const users = await Usermodel.find({
        parent: parentUser._id,
        isActive: true,
      })
        .select(
          "_id username name role parent userLock isActive " +
          "balance coins userCR exp exp_limit partnerLevel " +
          "commission partnershipValue domain " +
          "shareType myMatchShare myCommType matchShare commType " +
          "myCasinoShare casinoShare sessShare matkaShare createdAt"
        )
        .sort({
          createdAt: -1,
        })
        .lean();
    // ==========================================
    // NO CHILDREN
    // ==========================================

    if (!users.length) {
      return res
        .status(httpStatus.OK)
        .send(
          new APIResponse(
            {
              data: [],
              total: 0,
            },
            "No child users found",
            httpStatus.OK
          )
        );
    }

    // ==========================================
    // GET ALL USER IDS
    // ==========================================

    const userIds = users.map(
      (user) => user._id
    );

    // ==========================================
    // GET PARENT IDS OF ALL USERS
    //
    // Example:
    // x4.parent = sadmin
    // testing123.parent = x4
    // ==========================================

    const parentIds = [
      ...new Set(
        users
          .map((user) =>
            user.parent
              ? String(user.parent)
              : null
          )
          .filter(Boolean)
      ),
    ].map((id) => new mongoose.Types.ObjectId(id));

    // ==========================================
    // GET PARTNERSHIPS
    // ==========================================

    const partnerships = await Partnership.find({
      userId: {
        $in: userIds,
      },
      partnerId: {
        $in: [
          parentUser._id,
          ...parentIds,
        ],
      },
    })
      .select(
        "userId partnerId bookmakerCommission " +
        "fancyCommission casinoCommission"
      )
      .lean();

    // ==========================================
    // PARTNERSHIP MAP
    //
    // KEY = userId + partnerId
    //
    // This is important because:
    //
    // sadmin -> x4
    // partnership:
    // userId   = x4
    // partnerId = sadmin
    //
    // x4 -> testing123
    // partnership:
    // userId   = testing123
    // partnerId = x4
    // ==========================================

    const partnershipMap = new Map();

    for (const partnership of partnerships) {
      const key =
        `${String(partnership.userId)}_` +
        `${String(partnership.partnerId)}`;

      partnershipMap.set(key, partnership);
    }

    // ==========================================
    // GET PARENT USER DETAILS
    // ==========================================

    const parentIdsForUsers = [
      ...new Set(
        users
          .map((user) =>
            user.parent
              ? String(user.parent)
              : null
          )
          .filter(Boolean)
      ),
    ];

    const parentDetails =
      await Usermodel.find({
        _id: {
          $in: parentIdsForUsers,
        },
      })
        .select("_id username name role")
        .lean();

    const parentMap = new Map();

    for (const parent of parentDetails) {
      parentMap.set(
        String(parent._id),
        parent
      );
    }

    // ==========================================
    // FINAL RESPONSE
    // ==========================================

    const data = users.map((user) => {
      // ----------------------------------------
      // DIRECT PARENT
      // ----------------------------------------

      const directParent = user.parent
        ? parentMap.get(
            String(user.parent)
          )
        : null;

      // ----------------------------------------
      // PARTNERSHIP
      // ----------------------------------------

      const partnershipKey =
        `${String(user._id)}_` +
        `${String(user.parent)}`;

      const partnership =
        partnershipMap.get(partnershipKey);

      const bookmakerCommission =
        partnership?.bookmakerCommission || [];

      const fancyCommission =
        partnership?.fancyCommission || [];

      const casinoCommission =
        partnership?.casinoCommission || null;

      // ----------------------------------------
      // RESPONSE
      // ----------------------------------------

      return {
        userId: user._id,

        username: user.username || "",
        name: user.name || "",
        role: user.role || "",

        // Direct parent username
        parent: directParent?.username || "",

        userLock:
          user.userLock ?? false,

        isActive:
          user.isActive ?? false,

        // SHARE
        share: Number(
          user.partnershipValue || 0
        ),

        partnershipValue: Number(
          user.partnershipValue || 0
        ),

        matchShare: Number(
          user.matchShare || 0
        ),

        sessShare: Number(
          user.sessShare || 0
        ),

        casinoShare: Number(
          user.casinoShare || 0
        ),

        matkaShare: Number(
          user.matkaShare || 0
        ),

        // COMMISSION
        matchComm:
          bookmakerCommission,

        sessComm:
          fancyCommission,

        casinoComm:
          casinoCommission,

        matkaComm: 0,

        // ACCOUNT
        commission: Number(
          user.commission || 0
        ),

        coins: Number(
          user.coins || 0
        ),

        balance: Number(
          user.balance || 0
        ),

        userCR: Number(
          user.userCR || 0
        ),

        exposure: Number(
          user.exp || 0
        ),

        expLimit: Number(
          user.exp_limit || 0
        ),

        partnerLevel: Number(
          user.partnerLevel || 0
        ),

        domain: user.domain || [],

        createdAt: user.createdAt || null,
      };
    });

    // ==========================================
    // RESPONSE
    // ==========================================

    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          {
            data,
            total: data.length,
          },
          "All child user details fetched successfully",
          httpStatus.OK
        )
      );

  } catch (e) {
    console.log(
      "getChildUserDetails error+++",
      e
    );

    next(e);
  }
};

const create = async (req, res, next) => {
  try {
    const { transaction_pin, ...userData } = req.body;
    if (userData.username) userData.username = userData.username.trim();
   // const domain = userData?.domain;
   const domain = Array.isArray(userData?.domain)
  ? userData.domain
  : userData?.domain
    ? [userData.domain]
    : [];

    //const findDomains = await getDomainByDomain(domain);
    const findDomains =
  domain.length > 0
    ? await getDomainByDomain(domain[0])
    : null;
 
    const userId = await getUser({
      username: { $regex: `^${userData.username}$`, $options: "i" },
    });

    if (!userId) {
      const creator = await getUserById(req.user._id);
      const creatorBalance = Number(creator?.balance || 0);
      const requiredBalance = Number(userData?.balance || 0);
      if (requiredBalance > 0 && creatorBalance < requiredBalance) {
        return res
          .status(httpStatus.BAD_REQUEST)
          .json(new APIError("Insufficient balance.", httpStatus.BAD_REQUEST));
      }

      const parentPartnership = Number(creator?.partnershipValue || 0);
      const childPartnership = Number(userData?.partnershipValue || 0);

      if(childPartnership<0||childPartnership>(100-parentPartnership)){
        return res
          .status(httpStatus.BAD_REQUEST)
          .json(new APIError(`Partnership value must be between 0 and ${100 - parentPartnership}.`, httpStatus.BAD_REQUEST));
      }
      const encryptPWD = Utils.encryptPassword(userData.password);
      delete userData.password;
      const user = new User({
        ...userData,
        password: encryptPWD,
        parent: userData?.createdBy,
         ...(domain.length > 0 ? { domain } : {}),
        balance: 0,
        isLogin: !findDomains?.force_change_password,
      });
      await user.save();
      if (domain.length > 0) {
        await initUserPerformance(user?._id, domain[0]);
      }

      if (userData?.balance > 0) {
        await transferBalance(
          req.user._id,
          user?._id,
          userData?.balance,
          "Create User"
        );
      }
      if (creator.role === "owner") {
        await savaPartnerShip({
          userId: creator._id,
          commission: 100,
          downLineCommission: 100,
          partnerId: user._id,
        });
      }
      await delCache("users:all"); // invalidate all users cache

      res
        .status(httpStatus.OK)
        .send(
          new APIResponse(
            user.toObject(),
            Utils.messages.SUCCESS_MSG,
            httpStatus.OK
          )
        );
    } else {
      res
        .status(httpStatus.BAD_REQUEST)
        .json(new APIError("Username already exists.", httpStatus.BAD_REQUEST));
    }
  } catch (e) {
    next(e);
  }
};

const createSubUser = async (req, res, next) => {
  try {
    const { transaction_pin, ...userData } = req.body;
    if (userData.username) userData.username = userData.username.trim();
    const domain = userData?.domain;
  // const domain = userData?.domain;
    const existingUser = await getUser({
      username: { $regex: `^${userData.username}$`, $options: "i" },
    });
    if (existingUser) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(new APIError("Username already exists.", httpStatus.BAD_REQUEST));
    }
    const query = {
      _id: userData.createdBy,
      domain: { $elemMatch: { $in: domain } },
    };
    // const query = {
    //   _id: userData.createdBy,
    // };

    if (req?.user?.role === "owner") {
      delete query?.domain;
    }
//     if (domain && domain.length > 0 && req?.user?.role !== "owner") {
//   query.domain = { $elemMatch: { $in: domain } };
// }
    const creator = await getUser(query);
    if (!creator) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(new APIError("Creator not found.", httpStatus.BAD_REQUEST));
    }

    const encryptPWD = Utils.encryptPassword(userData.password);
    const user = new User({
      ...userData,
      password: encryptPWD,
      masterId: creator._id,
      role: "sub-user",
      phone: `sub-${userData.username}-${Date.now()}`,
      domain,
    //  ...(domain && domain.length > 0 ? { domain } : {}),
      isLogin: true,
    });
    await user.save();

    await delCache("users:all");

    return res.status(httpStatus.OK).send(
      new APIResponse(
        {
          ...user.toObject(),
        },
        Utils.messages.SUCCESS_MSG,
        httpStatus.OK
      )
    );
  } catch (e) {
    next(e);
  }
};
const register = async (req, res, next) => {
  try {
    const userData = req.body;
    if (userData.username) userData.username = userData.username.trim();
    const domain = req?.domainConfig?.domain;
    const userId = await getUser({
      username: { $regex: `^${userData.username}$`, $options: "i" },
    });

    if (!userId) {
      let creator = await getUser({
        domain: { $in: domain },
        registration_user_master: true,
        userLock: false,
      });

      if (!creator) {
        creator = await getUser({
          domain: { $in: domain },
          role: "super-admin",
          userLock: false,
        });
      }

      if (!creator) {
        creator = await getUser({
          role: "owner",
        });
      }
      const encryptPWD = Utils.encryptPassword(userData.password);
      delete userData.password;
      let user = new User({
        ...userData,
        password: encryptPWD,
        parent: creator?._id,
        domain: domain,
        balance: 0,
        isLogin: !req?.domainConfig?.force_change_password,
      });
      await user.save();
      await initUserPerformance(user?._id, domain?.[0]);
      if (creator.role === "owner") {
        await savaPartnerShip({
          userId: creator._id,
          commission: 100,
          downLineCommission: 100,
          partnerId: user._id,
        });
      }
      await delCache("users:all");

      user = await Utils.cleanUser(user);
      res
        .status(httpStatus.OK)
        .send(new APIResponse(user, Utils.messages.SUCCESS_MSG, httpStatus.OK));
    } else {
      res
        .status(httpStatus.BAD_REQUEST)
        .json(new APIError("Username already exists.", httpStatus.BAD_REQUEST));
    }
  } catch (e) {
    next(e);
  }
};

// Generate unique random username
const generateUsername = async (role) => {
  let username;
  let exists = true;

  const prefixMap = {
    "super-admin": "SA44",
    "admin": "AD55",
    "sub-admin": "SUA66",
    "super-master": "SM77",
    "master": "A88",
    "user": "U99",
  };

  const prefix = prefixMap[role];

  while (exists) {
    const randomNumber = Math.floor(1000 + Math.random() * 9000);;

    username = prefix
      ? `${prefix}${randomNumber}`
      : `AUTO${randomNumber}`;

    exists = await getUser({
      username,
    });
  }

  return username;
};





const registerWithShare = async (req, res, next) => {
  try {
    
    const userData = req.body;

    const domain = req?.body?.domain;

    // -----------------------------------------
    // Generate username from backend
    // -----------------------------------------
   // const username = await generateUsername();

   const username = await generateUsername(userData.role);

    console.log("++++++++ GENERATED USERNAME:", username);

    // -----------------------------------------
    // COMMISSION DATA
    // Only commission part added
    // -----------------------------------------
    const bookmakerCommission = Array.isArray(userData.bookmaker)
      ? userData.bookmaker
      : [];

    const fancyCommission = Array.isArray(userData.fancy)
      ? userData.fancy
      : [];

    const casinoCommission =
      userData.casino &&
      typeof userData.casino === "object" &&
      !Array.isArray(userData.casino)
        ? userData.casino
        : {
            type: "NONE",
            percentage: 0,
          };

    // -----------------------------------------
    // Remove commission fields from User data
    // Commission will be saved in Partnership
    // -----------------------------------------
    delete userData.bookmaker;
    delete userData.fancy;
    delete userData.casino;

    // -----------------------------------------
    // GET LOGGED-IN USER / CREATOR
    // Same old logic
    // -----------------------------------------
    if (!req.user?._id) {
      return res.status(httpStatus.UNAUTHORIZED).json(
        new APIError(
          "Logged-in user not found. Authentication middleware missing.",
          httpStatus.UNAUTHORIZED
        )
      );
    }

    const creator = await getUserById(req.user._id);

    if (!creator) {
      return res.status(httpStatus.BAD_REQUEST).json(
        new APIError(
          "Creator user not found.",
          httpStatus.BAD_REQUEST
        )
      );
    }

    // -----------------------------------------
    // CHECK CREATOR LOCK
    // Same old logic
    // -----------------------------------------
    if (creator.userLock) {
      return res.status(httpStatus.BAD_REQUEST).json(
        new APIError(
          "Creator user is locked.",
          httpStatus.BAD_REQUEST
        )
      );
    }

    // -----------------------------------------
    // ENCRYPT PASSWORD
    // Same old logic
    // -----------------------------------------
    // const encryptPWD = Utils.encryptPassword(userData.password);

    // delete userData.password;


        let encryptPWD;

    if (userData.password !== undefined && userData.password !== null && userData.password !== "") {
      encryptPWD = Utils.encryptPassword(userData.password);
      delete userData.password;
    }



    const balance =
      userData.balance !== undefined &&
      userData.balance !== null &&
      userData.balance !== ""
        ? Number(userData.balance)
        : 0;

    // -----------------------------------------
    // DEDUCT BALANCE FROM CREATOR
    // -----------------------------------------
    if (balance > creator.balance) {
      return res.status(httpStatus.BAD_REQUEST).json(
        new APIError(
          "Insufficient balance.",
          httpStatus.BAD_REQUEST
        )
      );
    }

    creator.balance -= balance;
    await creator.save();

    // -----------------------------------------
    // CREATE USER
    // Old fields / logic remain same
    // -----------------------------------------
    let user = new User({
      ...userData,

      username: username,

      password: encryptPWD,

      parent: creator._id,

      domain: domain,

      exp_limit: balance,

      balance:
        userData.balance !== undefined &&
        userData.balance !== null &&
        userData.balance !== ""
          ? Number(userData.balance)
          : 0,

      shareType:
        userData.shareType !== undefined &&
        userData.shareType !== null &&
        userData.shareType !== ""
          ? userData.shareType
          : 0,

      isLogin: !req?.domainConfig?.force_change_password,
    });

    // -----------------------------------------
    // SAVE USER
    // -----------------------------------------
    await user.save();

    // -----------------------------------------
    // INIT USER PERFORMANCE
    // Same old logic
    // -----------------------------------------
    await initUserPerformance(
      user?._id,
      domain?.[0]
    );

    // -----------------------------------------
    // PARTNERSHIP
    // Old logic same
    // Commission fields only added
    // -----------------------------------------
    // if (creator.role === "owner") {
    //   await savaPartnerShip({
    //     userId: creator._id,

    //     commission: 100,

    //     downLineCommission: 100,

    //     partnerId: user._id,

    //     // -----------------------------------------
    //     // NEW COMMISSION DATA
    //     // -----------------------------------------
    //     bookmakerCommission: bookmakerCommission,

    //     fancyCommission: fancyCommission,

    //     casinoCommission: casinoCommission,
    //   });
    // }



    // -----------------------------------------
    // PARTNERSHIP
    // Create partnership for every hierarchy level
    // -----------------------------------------
    await savaPartnerShip({
      userId: user._id,
      commission: 100,
      downLineCommission: 100,
      partnerId: creator._id,
    });

    // Save commission in Partnership
    await Partnership.updateOne(
      {
        userId: user._id,        // NEW USER
        partnerId: creator._id,  // CREATOR
      },
      {
        $set: {
          bookmakerCommission: bookmakerCommission,
          fancyCommission: fancyCommission,
          casinoCommission: casinoCommission,
        },
      }
    );

    // Add commission in API response
    user = user.toObject();

    user.bookmaker = bookmakerCommission;
    user.fancy = fancyCommission;
    user.casino = casinoCommission;






    // -----------------------------------------
    // CLEAR CACHE
    // Same old logic
    // -----------------------------------------
    await delCache("users:all");

    // -----------------------------------------
    // CLEAN USER
    // Same old logic
    // -----------------------------------------
    user = await Utils.cleanUser(user);

    // -----------------------------------------
    // RESPONSE
    // Same old logic
    // -----------------------------------------
    return res.status(httpStatus.OK).send(
      new APIResponse(
        user,
        Utils.messages.SUCCESS_MSG,
        httpStatus.OK
      )
    );
  } catch (e) {
    console.error(
      "******++++++++ REGISTER WITH SHARE ERROR:",
      e
    );

    next(e);
  }
};


const createPartner = async (req, res, next) => {
  try {
    const { transaction_pin, ...userData } = req.body;
    if (userData.username) userData.username = userData.username.trim();
    const domain = userData?.domain;
    const existingUser = await getUser({
      username: { $regex: `^${userData.username}$`, $options: "i" },
    });
    if (existingUser) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(new APIError("Username already exists.", httpStatus.BAD_REQUEST));
    }

    if (userData?.registration_user_master) {
      const existingUser = await getUser({
        domain: { $in: domain },
        registration_user_master: true,
        userLock: false,
      });
      if (existingUser) {
        return res
          .status(httpStatus.BAD_REQUEST)
          .json(
            new APIError(
              "Registration user (Master) already exists.",
              httpStatus.BAD_REQUEST
            )
          );
      }
    }
    const query = {
      _id: userData.createdBy,
      domain: { $elemMatch: { $in: domain } },
    };
    if (req?.user?.role === "owner") {
      delete query?.domain;
    }
    const creator = await getUser(query);
    if (!creator) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(new APIError("Creator not found.", httpStatus.BAD_REQUEST));
    }
    ///old working seat code
    // if (creator.role !== "owner" && userData?.seat > creator.seat) {
    //   return res
    //     .status(httpStatus.BAD_REQUEST)
    //     .json(
    //       new APIError(
    //         "New user's seat must be less than or equal to creator's seat.",
    //         httpStatus.BAD_REQUEST
    //       )
    //     );
    // }
          if (
        creator.role !== "owner" &&
        Number(creator.seat) > 0 &&
        Number(userData?.seat || 0) > Number(creator.seat)
      ) {
        return res
          .status(httpStatus.BAD_REQUEST)
          .json(
            new APIError(
              "New user's seat must be less than or equal to creator's seat.",
              httpStatus.BAD_REQUEST
            )
          );
      }
    const creatorBalance = Number(creator?.balance || 0);
    const requiredBalance = Number(userData?.balance || 0);
    if (requiredBalance > 0 && creatorBalance < requiredBalance) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(new APIError("Insufficient balance.", httpStatus.BAD_REQUEST));
    }
    if (!Utils.canCreateRole(creator.role, userData.role)) {
      return res
        .status(httpStatus.FORBIDDEN)
        .json(
          new APIError(
            "You can only create roles below your level.",
            httpStatus.FORBIDDEN
          )
        );
    }
    if (userData.commission < 0) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            `Commission and Downline Commission must be greater than 0. Received commission: ${userData.commission}, downLineCommission: ${userData.downLineCommission}`,
            httpStatus.BAD_REQUEST
          )
        );
    }
    if (!userData.downLineCommission) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            `Commission and Downline Commission must be greater than 0. Received commission: ${userData.commission}, downLineCommission: ${userData.downLineCommission}`,
            httpStatus.BAD_REQUEST
          )
        );
    }
        // Seat check
    // let usedSeats = 0;
    // if (creator.role !== "owner") {
    //   usedSeats = await User.countDocuments({
    //     parent: creator._id,
    //     role: { $ne: "user" },
    //     isActive: true,
    //     userLock: false,
    //   });
    // }

    // const availableSeats = creator.seat - usedSeats;
    // if (
    //   creator.role !== "owner" &&
    //   availableSeats <= 0 &&
    //   userData.role !== "user"
    // ) {
    //   return res
    //     .status(httpStatus.BAD_REQUEST)
    //     .json(
    //       new APIError("Insufficient seats to assign.", httpStatus.BAD_REQUEST)
    //     );
    // }

       if (
        creator.role !== "owner" &&
        Number(creator.seat) > 0
      ) {
        const usedSeats = await User.countDocuments({
          parent: creator._id,
          isActive: true,
          userLock: false,
        });

        const availableSeats =
          Number(creator.seat) - Number(usedSeats);

        if (availableSeats <= 0) {
          return res
            .status(httpStatus.BAD_REQUEST)
            .json(
              new APIError(
                "Insufficient seats to assign.",
                httpStatus.BAD_REQUEST
              )
            );
        }
      }

    const encryptPWD = Utils.encryptPassword(userData.password);

    const newRoleIndex = Utils.ROLE_HIERARCHY.indexOf(userData.role);
    const user = new User({
      ...userData,
      password: encryptPWD,
      parent: creator._id,
      balance: 0,
      partnerLevel: newRoleIndex,
      // commission: userData.downLineCommission,
      domain,
    });
    await user.save();

    await savaPartnerShip({
      userId: user._id,
      commission: userData.downLineCommission,
      downLineCommission: userData.downLineCommission,
      partnerId: creator._id,
    });

    if (creator.role === "owner") {
      await savaPartnerShip({
        userId: creator._id,
        commission: userData.commission,
        downLineCommission: 100,
        partnerId: user._id,
      });
    }

    // No longer manually incrementing usedSeats; we calculate it dynamically
    // await creator.save(); 

    await delCache("users:all");
    if (userData?.balance > 0) {
      await transferBalance(
        req.user._id,
        user?._id,
        userData?.balance,
        `Create ${userData?.role}`
      );
    }

    return res.status(httpStatus.OK).send(
      new APIResponse(
        {
          ...user.toObject(),
          // creatorRemainingCommission,
        },
        Utils.messages.SUCCESS_MSG,
        httpStatus.OK
      )
    );
  } catch (e) {
    next(e);
  }
};

// const updatePartnerSeat = async (req, res, next) => {
//   try {
//     const { userId, seat } = req.body;

//     if (!userId) {
//       return res
//         .status(httpStatus.BAD_REQUEST)
//         .json(
//           new APIError(
//             "userId is required",
//             httpStatus.BAD_REQUEST
//           )
//         );
//     }

//     if (seat === undefined || seat === null) {
//       return res
//         .status(httpStatus.BAD_REQUEST)
//         .json(
//           new APIError(
//             "seat is required",
//             httpStatus.BAD_REQUEST
//           )
//         );
//     }

//     if (typeof seat !== "number" || seat < 0) {
//       return res
//         .status(httpStatus.BAD_REQUEST)
//         .json(
//           new APIError(
//             "seat must be a non-negative number",
//             httpStatus.BAD_REQUEST
//           )
//         );
//     }

//     const user = await User.findById(userId);

//     if (!user) {
//       return res
//         .status(httpStatus.NOT_FOUND)
//         .json(
//           new APIError(
//             "User not found",
//             httpStatus.NOT_FOUND
//           )
//         );
//     }

//     if (!user.parent) {
//       return res
//         .status(httpStatus.BAD_REQUEST)
//         .json(
//           new APIError(
//             "User does not have a parent.",
//             httpStatus.BAD_REQUEST
//           )
//         );
//     }

//     const creator = await User.findById(user.parent);

//     if (!creator) {
//       return res
//         .status(httpStatus.BAD_REQUEST)
//         .json(
//           new APIError(
//             "Creator not found.",
//             httpStatus.BAD_REQUEST
//           )
//         );
//     }

//     // Same seat limit check as createPartner
//     if (
//       creator.role !== "owner" &&
//       seat > creator.seat
//     ) {
//       return res
//         .status(httpStatus.BAD_REQUEST)
//         .json(
//           new APIError(
//             "New user's seat must be less than or equal to creator's seat.",
//             httpStatus.BAD_REQUEST
//           )
//         );
//     }

//     // Same available seat check as createPartner
//     let usedSeats = 0;

//     if (creator.role !== "owner") {
//       usedSeats = await User.countDocuments({
//         parent: creator._id,
//         role: { $ne: "user" },
//         isActive: true,
//         userLock: false,
//       });
//     }

//     const availableSeats =
//       creator.seat - usedSeats;

//     if (
//       creator.role !== "owner" &&
//       availableSeats <= 0 &&
//       user.role !== "user"
//     ) {
//       return res
//         .status(httpStatus.BAD_REQUEST)
//         .json(
//           new APIError(
//             "Insufficient seats to assign.",
//             httpStatus.BAD_REQUEST
//           )
//         );
//     }

//     user.seat = seat;

//     await user.save();

//     await delCache("users:all");

//     return res.status(httpStatus.OK).send(
//       new APIResponse(
//         user,
//         "User seat updated successfully",
//         httpStatus.OK
//       )
//     );
//   } catch (e) {
//     next(e);
//   }
// };

const updatePartnerSeat = async (req, res, next) => {
  try {
    const { userId, seat } = req.body;

    if (!userId) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "userId is required",
            httpStatus.BAD_REQUEST
          )
        );
    }

    if (seat === undefined || seat === null) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "seat is required",
            httpStatus.BAD_REQUEST
          )
        );
    }

    if (typeof seat !== "number" || seat < 0) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "seat must be a non-negative number",
            httpStatus.BAD_REQUEST
          )
        );
    }

    const user = await User.findById(userId);

    if (!user) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(
          new APIError(
            "User not found",
            httpStatus.NOT_FOUND
          )
        );
    }

    if (!user.parent) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "User does not have a parent.",
            httpStatus.BAD_REQUEST
          )
        );
    }

    const creator = await User.findById(user.parent);

    if (!creator) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "Creator not found.",
            httpStatus.BAD_REQUEST
          )
        );
    }

    // Same seat limit check as createPartner
    // if (
    //   creator.role !== "owner" &&
    //   seat > creator.seat
    // ) {
    //   return res
    //     .status(httpStatus.BAD_REQUEST)
    //     .json(
    //       new APIError(
    //         "New user's seat must be less than or equal to creator's seat.",
    //         httpStatus.BAD_REQUEST
    //       )
    //     );
    // }

          if (
        creator.role !== "owner" &&
        Number(creator.seat) > 0 &&
        Number(seat) > Number(creator.seat)
      ) {
        return res
          .status(httpStatus.BAD_REQUEST)
          .json(
            new APIError(
              "New user's seat must be less than or equal to creator's seat.",
              httpStatus.BAD_REQUEST
            )
          );
      }

    // Same available seat check as createPartner
    let usedSeats = 0;

    // if (creator.role !== "owner") {
    //   usedSeats = await User.countDocuments({
    //     parent: creator._id,
    //     role: { $ne: "user" },
    //     isActive: true,
    //     userLock: false,
    //   });
    // }

    // const availableSeats =
    //   creator.seat - usedSeats;

    // if (
    //   creator.role !== "owner" &&
    //   availableSeats <= 0 &&
    //   user.role !== "user"
    // ) {
    //   return res
    //     .status(httpStatus.BAD_REQUEST)
    //     .json(
    //       new APIError(
    //         "Insufficient seats to assign.",
    //         httpStatus.BAD_REQUEST
    //       )
    //     );
    // }

    // creator.seat = 0 means unlimited
    if (
      creator.role !== "owner" &&
      Number(creator.seat) > 0 &&
      user.role !== "user"
    ) {
      const usedSeats = await User.countDocuments({
        parent: creator._id,
        role: { $ne: "user" },
        isActive: true,
        userLock: false,
      });

      const availableSeats =
        Number(creator.seat) - usedSeats;

      if (availableSeats <= 0) {
        return res
          .status(httpStatus.BAD_REQUEST)
          .json(
            new APIError(
              "Insufficient seats to assign.",
              httpStatus.BAD_REQUEST
            )
          );
      }
    }

    user.seat = seat;

    await user.save();

    await delCache("users:all");

    return res.status(httpStatus.OK).send(
      new APIResponse(
        user,
        "User seat updated successfully",
        httpStatus.OK
      )
    );
  } catch (e) {
    next(e);
  }
};

const getPartnerSeat = async (req, res, next) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "userId is required",
            httpStatus.BAD_REQUEST
          )
        );
    }

    const user = await User.findById(userId)
      .select("_id username seat")
      .lean();

    if (!user) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(
          new APIError(
            "User not found",
            httpStatus.NOT_FOUND
          )
        );
    }

    return res.status(httpStatus.OK).send(
      new APIResponse(
        {
          userId: user._id,
          username: user.username,
          seat: user.seat,
        },
        "User seat fetched successfully",
        httpStatus.OK
      )
    );
  } catch (e) {
    next(e);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const id = req.params.id;
    const response = await updateUser(
      { _id: id },
      { $set: { isActive: false } }
    );

    if (response) {
      await delCache("users:all");
      await delCache(`user:${id}`);

      res
        .status(httpStatus.OK)
        .send(
          new APIResponse(
            { ...response.toObject(), isActive: false },
            Utils.messages.SUCCESS_DELETE,
            httpStatus.OK
          )
        );
    } else {
      res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("Please Check user id", httpStatus.NOT_FOUND));
    }
  } catch (error) {
    next(error);
  }
};

const updateUserRequest = async (req, res, next) => {
  try {
    const id = req.params.id;
    const { transaction_pin, ...body } = req?.body;
    if (body.username) body.username = body.username.trim();

    const targetUser = await getUserById(id);
    if (!targetUser) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("User not found", httpStatus.NOT_FOUND));
    }

    // Seat check: If transition to (isActive: true AND userLock: false) happens, check seats.
    const newIsActive =
      body.isActive !== undefined ? body.isActive : targetUser.isActive;
    const newUserLock =
      body.userLock !== undefined ? body.userLock : targetUser.userLock;

    const oldUsesSeat =
      targetUser.isActive === true &&
      targetUser.userLock === false &&
      targetUser.role !== "user";
    const newUsesSeat =
      newIsActive === true && newUserLock === false && targetUser.role !== "user";

    if (newUsesSeat && !oldUsesSeat) {
      const parent = await getUserById(targetUser.parent);
      if (parent && parent.role !== "owner") {
        const usedSeatsCount = await User.countDocuments({
          parent: parent._id,
          role: { $ne: "user" },
          isActive: true,
          userLock: false,
        });

        if (usedSeatsCount >= parent.seat) {
          return res
            .status(httpStatus.BAD_REQUEST)
            .json(
              new APIError(
                `Insufficient seats available under ${parent.username}.`,
                httpStatus.BAD_REQUEST
              )
            );
        }
      }
    }

    const lockHistory = [];

    if (
      body.userLock !== undefined &&
      body.userLock !== targetUser.userLock
    ) {
      lockHistory.push({
        userId: targetUser._id,
        username: targetUser.username,
        lockType: "userLock",
        oldStatus: targetUser.userLock,
        newStatus: body.userLock,
        doneByUsername: req.user.username,
      });
    }

    if (
      body.betLock !== undefined &&
      body.betLock !== targetUser.betLock
    ) {
      lockHistory.push({
        userId: targetUser._id,
        username: targetUser.username,
        lockType: "betLock",
        oldStatus: targetUser.betLock,
        newStatus: body.betLock,
        doneByUsername: req.user.username,
      });
    }

    if (lockHistory.length > 0) {
      await UserLockHistory.insertMany(lockHistory);
    }
    

    const response = await updateUser({ _id: id }, { $set: body });

    if (body && Object.keys(body).includes("userLock")) {
      if (body.userLock === true) {
        await updateUserLockRecursively(id, body);
      }
    }
    if (body && Object.keys(body).includes("betLock")) {
        await updateUserLockRecursively(id, {
          betLock: body.betLock,
        });
    }

    if (response) {
      await delCache("users:all");
      await delCache(`user:${id}`);

      res
        .status(httpStatus.OK)
        .send(
          new APIResponse(
            { ...response.toObject(), ...body },
            Utils.messages.SUCCESS_MSG,
            httpStatus.OK
          )
        );
    } else {
      res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("Please Check user id", httpStatus.NOT_FOUND));
    }
  } catch (error) {
    next(error);
  }
};

const getAll = async (req, res, next) => {
  try {
    const cacheKey = "users:all";
    let users = await getCache(cacheKey);

    if (!users) {
      users = await getAllUsers({ domain: req?.domainConfig?.domain });
      await setCache(cacheKey, users, 60);
    }

    res
      .status(httpStatus.OK)
      .send(new APIResponse(users, "Users fetched", httpStatus.OK));
  } catch (err) {
    next(err);
  }
};

const getSubUser = async (req, res, next) => {
  try {
    let users = await getAllUsers({ masterId: req?.user?._id });

    res
      .status(httpStatus.OK)
      .send(new APIResponse(users, "Users fetched", httpStatus.OK));
  } catch (err) {
    next(err);
  }
};
///old and working getBYId


const getById = async (req, res, next) => {
  try {
    let id = req.user?._id;

    if (req?.user?.currentUserId) {
      id = req.user.currentUserId;
    }

    if (req.query?._id) {
      id = req.query._id;
    }

    const fields = req.query?.fields?.split(",");
    // const cacheKey = `user:${id}`;
    const cacheKey = `user:getById:${id}`;
    let user = await getCache(cacheKey);
    if (!user) {
      user = await User.findById(id).lean();

      if (!user) {
        return res
          .status(httpStatus.NOT_FOUND)
          .json(
            new APIError(
              "User not found",
              httpStatus.NOT_FOUND
            )
          );
      }

      
      if (user.role === "user") {
        delete user.privileges;
        delete user.depositRequestsCount;
        delete user.withdrawRequestsCount;
        delete user.usedSeats;
        delete user.seat;
        delete user.commission;
        delete user.transaction_pin;
        delete user.parent;
        delete user.currentToken;
        delete user.registration_user_master;
        delete user.remark;
        delete user.partnerLevel;
        delete user.masterId;
        delete user.createdAt;
        delete user.updatedAt;
        delete user.__v;
      }

      if (user.password) {
        delete user.password;
      }

      
      await setCache(cacheKey, user, 60);
    }

    
    const liveData = await User.findById(id)
      .select(
        "role balance exp isActive userLock betLock isLogin currentToken"
      )
      .lean();

    if (!liveData) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(
          new APIError(
            "User not found",
            httpStatus.NOT_FOUND
          )
        );
    }

    user.role = liveData.role;
    user.balance = liveData.balance;
    user.exp = liveData.exp;
    user.isActive = liveData.isActive;
    user.userLock = liveData.userLock;
    user.betLock = liveData.betLock;
    user.isLogin = liveData.isLogin;
    user.currentToken = liveData.currentToken;

    if (user?.domain) {
      const domainData = await Domain.findOne({
        domain: user.domain,
      })
        .select("isTransactionpassword isSeat isMatchLock  maintenance_mode isCasinoThirdParty")
        .lean();

      user.isTransactionpassword =
        domainData?.isTransactionpassword ?? true;

      user.isSeat =
        domainData?.isSeat ?? true;

      user.isMatchLock =
        domainData?.isMatchLock ?? true;

      user.isCasinoThirdParty =
        domainData?.isCasinoThirdParty ?? true;

       if (user.role === "demo" && domainData) {
        user.isMatchLock = domainData.isMatchLock;
      }

      user.maintenance_mode =
        domainData?.maintenance_mode ?? false;
    }

    if (req?.user?.currentUserId) {
      user.privileges_role = req.user.role;
      user.parent = req.user.parent;
    }

    const userAccess = await UserAccess.findOne({
      userId: id,
    }).lean();
    
    user = await Utils.cleanUser(user, fields);

     user.commission = userAccess?.commission ?? true;
     user.interCasino = userAccess?.interCasino ?? true;

     
    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          user,
          "User fetched",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(err);
  }
};

const getTransactionPassword = async (req, res, next) => {
  try {
    let id = req.user?._id;
    let user = await User.findById(id)?.select("transaction_pin").lean();
    if (!user) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("User not found", httpStatus.NOT_FOUND));
    }
    res
      .status(httpStatus.OK)
      .send(new APIResponse(user, "User fetched", httpStatus.OK));
  } catch (err) {
    next(err);
  }
};
const getByUsername = async (req, res, next) => {
  try {
    const username = req.params?.username?.trim();
    let user = await getUser({ username: username });
    if (!user) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("User not found", httpStatus.NOT_FOUND));
    }
    user = await Utils.cleanUser(user);
    res
      .status(httpStatus.OK)
      .send(new APIResponse(user, "User fetched", httpStatus.OK));
  } catch (err) {
    next(err);
  }
};
const update = async (req, res, next) => {
  try {
    const id = req.params.id;
    const updateData = req.body;
    if (updateData.username) updateData.username = updateData.username.trim();

    const updatedUser = await updateUser(id, updateData);
    if (!updatedUser) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("User not found", httpStatus.NOT_FOUND));
    }

    await delCache("users:all");
    await delCache(`user:${id}`);

    res
      .status(httpStatus.OK)
      .send(new APIResponse(updatedUser, "User updated", httpStatus.OK));
  } catch (err) {
    next(err);
  }
};



const getUsersByPartner = async (req, res, next) => {
  try {
    const partnerId = req.user?._id;
    const { search, page = 1, limit = 25 } = req?.query;

    const {
      users,
      totalRecords,
      totalPages,
      allDataTotals,
    } = await getUsersByPartnerId(
      partnerId,
      search,
      page,
      limit
    );
    

    const usersWithDeposit = await bindUserDepositKey(users);
     
    res.status(httpStatus.OK).send(
      new APIResponse(
        {
          users: usersWithDeposit,
          totalRecords,
          totalPages,
          allDataTotals,
        },
        "Users under this partner",
        httpStatus.OK
      )
    );
  } catch (err) {
    next(err);
  }
};

const getUsersByPartnerWithUserLock = async (req, res, next) => {
  try {
    const partnerId = req.user?._id;
    const {
      search,
      page = 1,
      limit = 25,
      userLock = "false",
    } = req?.query;

    const {
      users,
      totalRecords,
      totalPages,
      allDataTotals,
    } = await getUsersByPartnerIdWithUserLock(
      partnerId,
      search,
      page,
      limit,
      userLock
    );

    const usersWithDeposit = await bindUserDepositKey(users);

    res.status(httpStatus.OK).send(
      new APIResponse(
        {
          users: usersWithDeposit,
          totalRecords,
          totalPages,
          allDataTotals,
        },
        "Users under this partner",
        httpStatus.OK
      )
    );
  } catch (err) {
    console.log("erroror++++",err);
    next(err);
  }
};

//oldworking code
const getSingleUsersById = async (req, res, next) => {
  try {
    const userId = req?.params?.id;
    // Fetch single user data with partnership info matching the structure of getUsersByPartnerId items
    let userData = await getSingleUserPartnershipData(userId);
    if (!userData) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("User not found", httpStatus.NOT_FOUND));
    }
    let users = await bindUserDepositKey([userData]);

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          users[0],
          "User partnership data fetched",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(err);
  }
};




// const getPartners = async (req, res, next) => {
//   try {
//     const partnerId = req.params.id;
//     const { search, page = 1, limit = 25 } = req?.query;
//     const { users, totalRecords, totalPages } = await getUsersByPartnerId(
//       partnerId,
//       search,
//       page,
//       limit
//     );
//     const usersWithDeposit = await bindUserDepositKey(users);
//     res.status(httpStatus.OK).send(
//       new APIResponse(
//         {
//           users: usersWithDeposit,
//           totalRecords,
//           totalPages,
//         },
//         "Users under this partner",
//         httpStatus.OK
//       )
//     );
//   } catch (err) {
//     next(err);
//   }
// };

const getPartners = async (req, res, next) => {
  try {
    const partnerId = req.params.id;

    const { search, page = 1, limit = 25 } = req?.query;

    const {
      users,
      totalRecords,
      totalPages,
      allDataTotals,
    } = await getUsersByPartnerId(
      partnerId,
      search,
      page,
      limit
    );

    const usersWithDeposit = await bindUserDepositKey(users);

    res.status(httpStatus.OK).send(
      new APIResponse(
        {
          users: usersWithDeposit,
          totalRecords,
          totalPages,
          allDataTotals,
        },
        "Users under this partner",
        httpStatus.OK
      )
    );
  } catch (err) {
    next(err);
  }
};

const changePassword = async (req, res, next) => {
  try {
    // const { _id } = req.user;
    let _id = req.user?._id;
    if (req?.user?.currentUserId) {
      _id = req.user.currentUserId;
    }
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "Old and new passwords are required",
            httpStatus.BAD_REQUEST
          )
        );
    }

    if (newPassword.length < 8) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "Password must be at least 8 characters long",
            httpStatus.BAD_REQUEST
          )
        );
    }
    if (oldPassword === newPassword) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "Old and New Password cannot be same",
            httpStatus.BAD_REQUEST
          )
        );
    }

    const user = await getUserById(_id);
    if (!user) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("User not found", httpStatus.NOT_FOUND));
    }

    const isMatch = Utils.comparePassword(oldPassword, user.password);
    if (!isMatch) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError("Please enter correct old password", httpStatus.BAD_REQUEST)
        );
    }

    const hashedPassword = await Utils.encryptPassword(newPassword);
    const record = { password: hashedPassword, isLogin: true };
    if (user?.role !== "user" && !user?.isLogin) {
      const randomPass = Math.floor(100000 + Math.random() * 900000).toString();
      record.transaction_pin = randomPass;
    }
    await updateUser(user._id, record);

    await createUserLog({
      userId: user._id,
      username: user.username,
      ip: req.clientIp || "",
      browserDetails: req.headers["user-agent"] || "",
      type: "change_password",
    });
    await delCache("users:all");
    await delCache(`user:${user._id}`);
    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse({}, "Password changed successfully", httpStatus.OK)
      );
  } catch (err) {
    next(err);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const { _id } = req.user;
    const { password, userId } = req.body;

    if (!password) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError("New passwords are required", httpStatus.BAD_REQUEST)
        );
    }
    const user = await getUserById(userId);
    if (!user) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("User not found", httpStatus.NOT_FOUND));
    }
    const hashedPassword = await Utils.encryptPassword(password);
    const record = {
      password: hashedPassword,
      isLogin: false,
      transaction_pin: 0,
    };
    await updateUser(user._id, record);

    await SecureAuthUsers.updateMany(
      {
        userId: user._id,
        enabled: true,
      },
      {
        $set: {
          enabled: false,
        },
      }
    );

    await GoogleAuthenticatorUsers.updateMany(
      {
        userId: user._id,
        enabled: true,
      },
      {
        $set: {
          enabled: false,
        },
      }
    );

    await createUserLog({
      userId: user._id,
      username: user.username,
      ip: req.clientIp || "",
      browserDetails: req.headers["user-agent"] || "",
      type: "change_password",
    });
    await delCache("users:all");
    await delCache(`user:${user._id}`);
    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse({}, "Password changed successfully", httpStatus.OK)
      );
  } catch (err) {
    next(err);
  }
};
const forgotPassword = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    if (!password) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError("new passwords are required", httpStatus.BAD_REQUEST)
        );
    }

    const user = await getUserById(id);
    if (!user) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("User not found", httpStatus.NOT_FOUND));
    }

    const hashedPassword = await Utils.encryptPassword(password);
    await updateUser(user._id, { password: hashedPassword, isLogin: true });

    await createUserLog({
      userId: user._id,
      username: user.username,
      ip: req.clientIp || "",
      browserDetails: req.headers["user-agent"] || "",
      type: "change_password",
    });
    await delCache("users:all");
    await delCache(`user:${user._id}`);
    return res
      .status(httpStatus.OK)
      .send(new APIResponse({}, "Password forgot successfully", httpStatus.OK));
  } catch (err) {
    next(err);
  }
};
async function initialSetup(_, res, next) {
  try {
    const adminData = {
      name: "admin",
      role: "owner",
      username: "admin",
      isLogin: true,
      email: "admin@gmail.com",
      password: "Test@123",
      phone: "owner-9999999999",
      commission: 0,
      partnerLevel: 0,
      seat: 0,
      privileges: {
        settlement: true,
        createPartner: true,
        manageOdds: true,
        viewReports: true,
        manageCommission: true,
        withdrawRequests: true,
      },
    };

    const existingAdmin = await getUser({ username: adminData.username });

    if (!existingAdmin) {
      const encryptPWD = Utils.encryptPassword(adminData.password);
      const user = new User({
        ...adminData,
        password: encryptPWD,
        parent: null,
        domain: null,
      });
      await user.save();
      console.log("✅ Admin user created");
    } else {
      console.log("ℹ️ Admin user already exists");
    }
    const buttonCategory = "button";
    const buttonValues = [
      { value: 25, type: "casino", label: "25" },
      { value: 50, type: "casino", label: "50" },
      { value: 100, type: "casino", label: "100" },
      { value: 200, type: "casino", label: "200" },
      { value: 500, type: "casino", label: "500" },
      { value: 1000, type: "casino", label: "1000" },
      { value: 1000, type: "game", label: "1k" },
      { value: 2000, type: "game", label: "2k" },
      { value: 5000, type: "game", label: "5k" },
      { value: 10000, type: "game", label: "10k" },
      { value: 20000, type: "game", label: "20k" },
      { value: 25000, type: "game", label: "25k" },
      { value: 50000, type: "game", label: "50k" },
      { value: 75000, type: "game", label: "75k" },
      { value: 90000, type: "game", label: "90k" },
      { value: 95000, type: "game", label: "95k" },
    ];

    await Settings.findOneAndUpdate(
      { category: buttonCategory },
      { $set: { values: buttonValues } },
      { new: true, upsert: true }
    );

    const delayCategory = "bet-delay";
    const delayValues = [
      { value: 2000, type: "game", label: "Game" },
      { value: 1000, type: "casino", label: "Casino" },
    ];

    await Settings.findOneAndUpdate(
      { category: delayCategory },
      { $set: { values: delayValues } },
      { new: true, upsert: true }
    );
    console.log("✅ Bet-delay settings updated");

    // process.exit(0);
    res
      .status(httpStatus.OK)
      .send(new APIResponse({}, "Initial Setup successfully", httpStatus.OK));
  } catch (err) {
    console.error("❌ Setup error:", err);
    next(error);
    // process.exit(1);
  }
}

const accessRules = async (req, res, next) => {
  try {
    const id = req.params.id;
    const response = await updateUser(
      { _id: id },
      { $set: { isAcceptRules: true } }
    );

    if (response) {
      await delCache("users:all");
      await delCache(`user:${id}`);

      res
        .status(httpStatus.OK)
        .send(
          new APIResponse(
            { ...response.toObject(), isAcceptRules: true },
            "Accept Rules successfully",
            httpStatus.OK
          )
        );
    } else {
      res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("Please Check user id", httpStatus.NOT_FOUND));
    }
  } catch (error) {
    next(error);
  }
};

const getAccountDetails = async (req, res, next) => {
  try {
    const query = {
      _id: req?.user?._id,
    };

    const user = await getUser(query);
    if (!user) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(new APIError("User not found.", httpStatus.BAD_REQUEST));
    }

    let totalCommission = 0;
    let currentUser = user;
    if (currentUser?.role === "owner") {
      totalCommission = 100;
    } else {
      const partnerShit = await findPartnershipByUserAndPartner(
        currentUser?._id,
        currentUser?.parent
      );

      totalCommission = partnerShit?.downLineCommission || 0;
    }
    // while (currentUser) {
    //   totalCommission += currentUser.commission;
    //   if (!currentUser.parent) break;
    //   currentUser = await getUser({
    //     _id: currentUser.parent,
    //   });
    // }

    let partnershipValueShortx = 0;

    currentUser = user;

    while (currentUser) {
      partnershipValueShortx += Number(currentUser?.partnershipValue || 0);

      if (!currentUser?.parent) break;

      currentUser = await getUser({
        _id: currentUser.parent,
      });
    }

    res.status(httpStatus.OK).send(
      new APIResponse(
        {
          // totalCommission,
          // youCommission: user?.commission,
          // upperLineCommission: totalCommission - user?.commission,
          partnershipValue: user?.partnershipValue || 0,
          downLineCommission: totalCommission,
          partnershipValueShortx
        },
        "Fetch Account Details successfully",
        httpStatus.OK
      )
    );
  } catch (error) {
    next(error);
  }
};


///below working code
// const getDashboardDetails = async (req, res, next) => {
//   try {
//     const user = await getUser({
//       _id: req?.user?._id,
//     });

//     if (!user) {
//       return res
//         .status(httpStatus.BAD_REQUEST)
//         .json(
//           new APIError(
//             "User not found.",
//             httpStatus.BAD_REQUEST
//           )
//         );
//     }

   
//     const userBalance = Number(user.balance || 0);
//     const userExposure = Number(user.exp || 0);
//     const userCreditReference = Number(user.userCR || 0);

   
//     const downPtsTransactions = await transactionModel
//       .find({
//         type: "adjustment",
//         userId: user._id,
//       })
//       .lean();

//     const down_pts = downPtsTransactions.reduce(
//       (total, transaction) =>
//         total + (Number(transaction.amount) || 0),
//       0
//     );

   
//     const allIds = await collectAllIds(user);

//     const allDownlineUsers = await User.find({
//       isActive: true,
//       parent: { $in: allIds },
//     }).lean();

    
//     const directChildren = await User.find({
//       parent: user._id,
//       isActive: true,
//     }).lean();

    
//     const downLevelCreditReference = directChildren.reduce(
//       (total, child) =>
//         total + (Number(child.userCR) || 0),
//       0
//     );

   
//     const downLevelOccupyBalance = directChildren.reduce(
//       (total, child) =>
//         total + (Number(child.balance) || 0),
//       0
//     );

    
//     const downLevelProfitLoss = directChildren.reduce(
//       (total, child) => {
//         const childBalance = Number(child.balance || 0);
//         const childCreditReference = Number(child.userCR || 0);

//         const childClientPl =
//           childBalance - childCreditReference;

//         return total + childClientPl;
//       },
//       0
//     );

   
//     const usersTotal = allDownlineUsers.reduce(
//       (total, child) =>
//         total + (Number(child.balance) || 0),
//       0
//     );

//     const credit_pts = userCreditReference;
//     const balance = userBalance;
//     const all_pts = usersTotal + userBalance;
//     const settlement_pts = all_pts - credit_pts;
//     const upper_pts = 0;

   
//     const upperLevelCreditReference =
//       userCreditReference;

    
//     const totalMasterBalance =
//       userBalance;

   
//     const availableBalance =
//       totalMasterBalance - downLevelOccupyBalance;

   
//     // const upperLevel =
//     //   downLevelProfitLoss * -1;

//     const upperLevel =
//   upperLevelCreditReference - totalMasterBalance;

//     // const availableBalanceWithProfitLoss =
//     //   availableBalance - downLevelProfitLoss;

//     const availableBalanceWithProfitLoss =
//   availableBalance;

//     const myProfitLoss = 0;
  
//     return res.status(httpStatus.OK).send(
//       new APIResponse(
//         {
         
//           balance: userBalance,
//           exposure: userExposure,
//           credit_pts,
//           all_pts,
//           settlement_pts,
//           upper_pts,
//           down_pts,

         
//           upperLevelCreditReference,
//           totalMasterBalance,
//           availableBalance,
//           downLevelOccupyBalance,
//           upperLevel,
//           availableBalanceWithProfitLoss,
//           downLevelCreditReference,
//           downLevelProfitLoss,
//           myProfitLoss,
//         },
//         "Fetch Account Details successfully",
//         httpStatus.OK
//       )
//     );
//   } catch (error) {
//     next(error);
//   }
// };


const getDashboardDetails = async (req, res, next) => {
  try {
    const user = await getUser({
      _id: req?.user?._id,
    });

    if (!user) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "User not found.",
            httpStatus.BAD_REQUEST
          )
        );
    }
    const liveUserData = await User.findById(user._id)
      .select("balance")
      .lean();

    const liveAvailableBalance = Number(
      liveUserData?.balance || 0
    );

    const userBalance = Number(user.balance || 0);
    const userExposure = Number(user.exp || 0);
    const userCreditReference = Number(
      user.userCR || 0
    );

    const downPtsTransactions =
      await transactionModel
        .find({
          type: "adjustment",
          userId: user._id,
        })
        .lean();

    const down_pts = downPtsTransactions.reduce(
      (total, transaction) =>
        total +
        (Number(transaction.amount) || 0),
      0
    );

    const allIds = await collectAllIds(user);

    const allDownlineUsers = await User.find({
      isActive: true,
      parent: { $in: allIds },
    }).lean();

    const directChildren = await User.find({
      parent: user._id,
      isActive: true,
    }).lean();

    const directChildrenWithDeposit =
    await bindUserDepositKey(directChildren);

    /*
     * Down Level Credit Reference =
     * Direct children Credit Reference total
     */
    const downLevelCreditReference =
      directChildren.reduce(
        (total, child) =>
          total +
          (Number(child.userCR) || 0),
        0
      );

    /*
     * Down Level Occupy Balance =
     * Direct children Balance total
     */
      // const downLevelOccupyBalance =
      // directChildren.reduce(
      //   (total, child) =>
      //     total +
      //     (Number(child.balance) || 0),
      //   0
      // );
      const balanceHierarchyRoles = [
        "super-admin",
        "admin",
        "sub-admin",
        "super-master",
        "master",
      ];

      const directChildrenBalanceValues = await Promise.all(
        directChildren.map(async (child) => {
          const originalBalance = Number(child.balance) || 0;

          if (!balanceHierarchyRoles.includes(child.role)) {
            return originalBalance;
          }

          const descendantIds = await collectAllIds(child);

          const descendants = await User.find({
            parent: { $in: descendantIds },
            isActive: true,
          })
            .select("balance")
            .lean();

          const descendantsBalance = descendants.reduce(
            (total, descendant) =>
              total + (Number(descendant.balance) || 0),
            0
          );

          return originalBalance + descendantsBalance;
        })
      );

      const downLevelOccupyBalance =
        directChildrenBalanceValues.reduce(
          (total, balance) => total + balance,
          0
        );

    /*
     * Down Level P/L =
     * Client P/L total
     */
    // const downLevelProfitLoss =
    //   directChildren.reduce(
    //     (total, child) => {
    //       const childBalance = Number(
    //         child.balance || 0
    //       );

    //       const childCreditReference = Number(
    //         child.userCR || 0
    //       );

    //       const childClientPl =
    //         childBalance -
    //         childCreditReference;

    //       return total + childClientPl;
    //     },
    //     0
    //   );
      const downLevelProfitLoss =
        directChildren.reduce(
          (total, child, index) => {
            const originalBalance =
              Number(child.balance) || 0;

            const creditReference =
              Number(child.userCR) || 0;

          
            const displayBalance =
              balanceHierarchyRoles.includes(child.role)
                ? Number(
                    directChildrenBalanceValues[index] || 0
                  )
                : originalBalance;

            const clientPl =
              displayBalance - creditReference;

            return total + clientPl;
          },
        0
      );

    const usersTotal = allDownlineUsers.reduce(
      (total, child) =>
        total +
        (Number(child.balance) || 0),
      0
    );

    const credit_pts = userCreditReference;
    const balance = userBalance;
    const all_pts = usersTotal + userBalance;
    const settlement_pts = all_pts - credit_pts;
    const upper_pts = 0;

    /*
     * Upper Level Credit Reference
     */
    const upperLevelCreditReference =
      userCreditReference;

    /*
     * Available Balance =
     * Current Balance - Down Level Occupy Balance
     *
     * 
     */
    // const availableBalance = Math.abs(
    //   userBalance - downLevelOccupyBalance
    // );
      const availableBalance = liveAvailableBalance;
    /*
     * Upper Level =
     * Upper Level CR
     * - Down Level Occupy Balance
     * - Available Balance
     */
      const upperLevel =
        upperLevelCreditReference -
        availableBalance -
        downLevelOccupyBalance;

    /*
     * Total Master Balance =
     * Upper Level Credit Reference + Upper Level
     */
    // const totalMasterBalance =
    //   upperLevelCreditReference - upperLevel;

    const totalMasterBalance =
        upperLevel >= 0
        ? upperLevelCreditReference - upperLevel
        : upperLevelCreditReference + Math.abs(upperLevel);

    /*
     * Available Balance With Profit/Loss =
     * Available Balance
     *
     * 
     */
    const availableBalanceWithProfitLoss =
      Math.abs(availableBalance);

    const myProfitLoss = 0;

    return res.status(httpStatus.OK).send(
      new APIResponse(
        {
          balance: userBalance,
          exposure: userExposure,
          credit_pts,
          all_pts,
          settlement_pts,
          upper_pts,
          down_pts,

          upperLevelCreditReference,
          totalMasterBalance,
          availableBalance,
          downLevelOccupyBalance,
          upperLevel,
          availableBalanceWithProfitLoss,
          downLevelCreditReference,
          downLevelProfitLoss,
          myProfitLoss,
        },
        "Fetch Account Details successfully",
        httpStatus.OK
      )
    );
  } catch (error) {
    next(error);
  }
};

const updatePartnership = async (req, res, next) => {
  try {
    const { userId, partnership, transaction_pin } = req.body;
    const requester = req.user;

    // 1. Validate inputs
    if (!userId || partnership === undefined) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "userId and partnership are required",
            httpStatus.BAD_REQUEST
          )
        );
    }

    // 2. Get Target User
    const targetUser = await getUserById(userId);
    if (!targetUser) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("User not found", httpStatus.NOT_FOUND));
    }

    // 3. Hierarchy Check: Requester must be parent of target, UNLESS owner
    if (
      requester.role !== "owner" &&
      targetUser.parent.toString() !== requester._id.toString()
    ) {
      return res
        .status(httpStatus.FORBIDDEN)
        .json(
          new APIError(
            "You can only update direct downlines",
            httpStatus.FORBIDDEN
          )
        );
    }

    // Determine the actual partner ID to update (target user's parent)
    const actualPartnerId = targetUser.parent;

    // 4. Upline Validation: Max Limit is defined by the Parent's Level (downLineCommission)
    let uplineLevel = 100; // Default for Owner

    // Fetch partnership of the Parent (David)
    const parentUser = await getUserById(actualPartnerId);

    if (parentUser && parentUser.role !== "owner") {
      const uplinePartnership = await findPartnershipByUserAndPartner(
        parentUser._id,
        parentUser.parent
      );
      if (uplinePartnership) {
        uplineLevel = uplinePartnership.downLineCommission;
      }
    }

    if (partnership < 0 || partnership > uplineLevel) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            `Invalid partnership value. Must be between 0 and ${uplineLevel}`,
            httpStatus.BAD_REQUEST
          )
        );
    }

    // 5. Downline Validation: Check against Target's Children
    const childrenPartnerships = await Partnership.find({ partnerId: userId });
    let maxChildLevel = 0;

    // EXCLUDE Owner or non-downlines if the structure exists inverted there too?
    // Usually inverted structure is only for Owner creating direct partners.
    // For safety, we can strictly look at children whose parent is userId.
    // But Partnership model doesn't store parent explicitly (it relies on partnerId).
    // If we trust that only Owner has this inverted record, we can filter by userId=Owner.
    // But let's fetch users to be safe.

    if (childrenPartnerships && childrenPartnerships.length > 0) {
      const childUserIds = childrenPartnerships.map((p) => p.userId);
      const childUsers = await User.find({ _id: { $in: childUserIds } }).select(
        "_id role"
      );
      const validChildIds = childUsers
        .filter((u) => u.role !== "owner")
        .map((u) => u._id.toString());

      for (const p of childrenPartnerships) {
        if (validChildIds.includes(p.userId.toString())) {
          maxChildLevel = Math.max(maxChildLevel, p.downLineCommission);
        }
      }
    }

    // Ensure we don't drop below children
    if (partnership < maxChildLevel) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            `Cannot decrease partnership below ${maxChildLevel}% (limited by downline users). Update downline users first.`,
            httpStatus.BAD_REQUEST
          )
        );
    }

    // 6. Recursive Active Bet Check (Target User + All Descendants)
    const allDownlineIds = await collectAllIds(targetUser);
    const hasActiveBets = await Bet.exists({
      userId: { $in: allDownlineIds },
    });

    if (hasActiveBets) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "Bets found in user hierarchy. Cannot update partnership.",
            httpStatus.BAD_REQUEST
          )
        );
    }

    // Fetch old partnership for logging
    const oldPartnershipDoc = await findPartnershipByUserAndPartner(
      userId,
      actualPartnerId
    );
    const oldCommission = oldPartnershipDoc ? oldPartnershipDoc.commission : 0;
    const oldLevel = oldPartnershipDoc
      ? oldPartnershipDoc.downLineCommission
      : 0;

    // 7. Perform Updates

    // A. Update Target User (Radha): Level = partnership, Commission = Level - MaxChild
    const targetMargin = partnership - maxChildLevel;

    await updatePartnershipByUserAndPartner(userId, actualPartnerId, {
      commission: targetMargin,
      downLineCommission: partnership,
    });

    // B. Update Upline User (David) - Recalculate Margin based on updated siblings checks
    if (parentUser && parentUser.role !== "owner") {
      // Find David's siblings (other children of David) to recalculate David's margin correctly
      const siblingsPartnerships = await Partnership.find({
        partnerId: actualPartnerId,
      });

      // Filter out Owner or any inverted records
      const siblingUserIds = siblingsPartnerships.map((p) => p.userId);
      const siblingUsers = await User.find({
        _id: { $in: siblingUserIds },
      }).select("_id role");
      const validSiblingIds = siblingUsers
        .filter((u) => u.role !== "owner")
        .map((u) => u._id.toString());

      // Find the effective max level among all children (siblings + curr target)
      let maxSiblingLevel = 0;
      for (const sib of siblingsPartnerships) {
        // SKIP if not a valid child (e.g. Owner)
        if (!validSiblingIds.includes(sib.userId.toString())) continue;

        if (sib.userId.toString() === userId.toString()) {
          // Use the NEW partnership value for the user we are updating
          maxSiblingLevel = Math.max(maxSiblingLevel, partnership);
        } else {
          maxSiblingLevel = Math.max(maxSiblingLevel, sib.downLineCommission);
        }
      }

      // David's keeps: HisLevel - MaxChildLevel
      const uplineMargin = uplineLevel - maxSiblingLevel;

      // Update David's partnership with HIS parent
      await updatePartnershipByUserAndPartner(
        parentUser._id,
        parentUser.parent,
        {
          commission: uplineMargin,
        }
      );
    }

    // Log the update
    await createUserLog({
      userId: requester._id,
      username: requester.username,
      ip: req.clientIp || "",
      browserDetails: req.headers["user-agent"] || "",
      type: "partnership-update",
      remark: `${requester.username} updated ${targetUser.username} partnership: Level ${oldLevel}->${partnership}, Margin ${oldCommission}->${targetMargin}`,
      data: {
        targetUserId: userId,
        oldPartnership: oldLevel,
        newPartnership: partnership,
        oldMargin: oldCommission,
        newMargin: targetMargin,
      },
    });

    // Clear cache
    await delCache("users:all");
    await delCache(`user:${userId}`);
    await delCache(`user:${actualPartnerId}`);

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          { userId, partnership, commission: targetMargin },
          "Partnership updated successfully",
          httpStatus.OK
        )
      );
  } catch (e) {
    next(e);
  }
};

const revertPartnershipUpdate = async (req, res, next) => {
  try {
    const { logId } = req.params;
    const requester = req.user;

    // 1. Authorization: Admin/Owner only
    const allowedRoles = ["owner"];
    if (!allowedRoles.includes(requester.role)) {
      return res
        .status(httpStatus.FORBIDDEN)
        .json(
          new APIError("Access denied. Admins only.", httpStatus.FORBIDDEN)
        );
    }

    // 2. Fetch Log
    const log = await UserLog.findById(logId);
    if (!log) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("Log entry not found", httpStatus.NOT_FOUND));
    }

    if (log.type !== "partnership-update") {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "Invalid log type for partnership revert",
            httpStatus.BAD_REQUEST
          )
        );
    }

    if (
      !log.data ||
      !log.data.targetUserId ||
      log.data.oldPartnership === undefined
    ) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "Log data incomplete, cannot revert",
            httpStatus.BAD_REQUEST
          )
        );
    }

    const { targetUserId, oldPartnership, newPartnership } = log.data;
    // log.userId is the original Upline who made the change.
    // We are reverting the partnership between log.userId (upline) and targetUserId (downline).
    const uplineId = log.userId;

    // 3. Revert
    // Verify targetUser exists
    const targetUser = await getUserById(targetUserId);
    if (!targetUser) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(
          new APIError("Target user no longer exists", httpStatus.NOT_FOUND)
        );
    }

    // Update to old value
    await updatePartnershipByUserAndPartner(targetUserId, uplineId, {
      commission: oldPartnership,
      downLineCommission: oldPartnership,
    });

    // 4. Log the Revert
    await createUserLog({
      userId: requester._id,
      username: requester.username,
      ip: req.clientIp || "",
      browserDetails: req.headers["user-agent"] || "",
      type: "partnership-update",
      remark: `${requester.username} REVERTED partnership for ${targetUser.username} (updated by ${log.username}) from ${newPartnership} back to ${oldPartnership}`,
      data: {
        targetUserId: targetUserId,
        revertedLogId: logId,
        oldPartnership: newPartnership,
        newPartnership: oldPartnership,
      },
    });

    // Clear cache
    await delCache("users:all");
    await delCache(`user:${targetUserId}`);
    await delCache(`user:${uplineId}`);

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          { targetUserId, revertedTo: oldPartnership },
          "Partnership reverted successfully",
          httpStatus.OK
        )
      );
  } catch (e) {
    next(e);
  }
};

const getDisabledUsers = async (req, res, next) => {
  try {
    const { _id } = req.user;

    // 1. Get all downline IDs using collectAllIds
    const allIds = await collectAllIds(req.user);

    // 2. Query for disabled users within downline
    // Must be in downline AND (userLock=true OR betLock=true) AND isActive=true
    const query = {
      _id: { $in: allIds },
      isActive: true,
      $or: [{ userLock: true }, { betLock: true }],
    };

    let users = await User.find(query).populate("parent", "username").lean();

    // 3. Bind Credit (CR) data
    users = await bindUserDepositKey(users);

    // 4. Calculate additional fields
    // For totalPts, we need to sum balance of user + all their children
    // We can do this efficiently or loop. Given the structure in helper:
    const result = await Promise.all(
      users.map(async (u) => {
        const userIds = await collectAllIds(u);
        // Optimization: Using aggregate to sum balances of children
        const childrenBalance = await User.aggregate([
          { $match: { _id: { $in: userIds }, isActive: true } },
          { $group: { _id: null, total: { $sum: "$balance" } } },
        ]);
        const childrenTotal = childrenBalance[0]?.total || 0;
        const totalPts = childrenTotal + (Number(u.balance) || 0);

        // Map to frontend specified columns
        return {
          ...u,
          username: u.username,
          cr: u.cr || 0,
          pts: totalPts,
          clientPl: 0, // Not available in system currently
          exposure: u.exp || 0,
          availablePts: u.balance || 0,
          bst: u.betLock || false,
          ust: u.userLock || false,
          pname: u.parent ? u.parent.username : "", // handled by populate
          accountType: u.role,
        };
      })
    );

    res
      .status(httpStatus.OK)
      .send(new APIResponse(result, "Disabled users fetched", httpStatus.OK));
  } catch (err) {
    console.error(err);
    next(err);
  }
};

const updateUserCR = async (req, res, next) => {
  try {
    const id = req.params.id;
    const { userCR } = req.body;

    if (userCR === undefined || userCR === null) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(new APIError("User CR is required", httpStatus.BAD_REQUEST));
    }

    const response = await updateUser(id, { userCR: Number(userCR) });

    if (response) {
      await delCache("users:all");
      await delCache(`user:${id}`);

      res
        .status(httpStatus.OK)
        .send(
          new APIResponse(
            { ...response.toObject(), userCR: Number(userCR) },
            Utils.messages.SUCCESS_MSG,
            httpStatus.OK
          )
        );
    } else {
      res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("Please Check user id", httpStatus.NOT_FOUND));
    }
  } catch (error) {
    next(error);
  }
};

const updateExpLimit = async (req, res, next) => {
  try {
    console.log("+++updateExpLimit");
    const { userId, old_exp_limit, new_exp_limit } = req.body;

    if (!userId) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(new APIError("User ID is required", httpStatus.BAD_REQUEST));
    }

    if (old_exp_limit === undefined || old_exp_limit === null) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(new APIError("Old exp limit is required", httpStatus.BAD_REQUEST));
    }

    if (new_exp_limit === undefined || new_exp_limit === null) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(new APIError("New exp limit is required", httpStatus.BAD_REQUEST));
    }

    const user = await getUserById(userId);

    if (!user) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("User not found", httpStatus.NOT_FOUND));
    }

    const currentExpLimit = Number(user.exp_limit ?? 0);
    const oldExpLimit = Number(old_exp_limit);
    const newExpLimit = Number(new_exp_limit);

    if (Number.isNaN(oldExpLimit) || Number.isNaN(newExpLimit)) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(new APIError("Exp limit must be a valid number", httpStatus.BAD_REQUEST));
    }

    if (currentExpLimit !== oldExpLimit) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(new APIError("Old exp limit does not match", httpStatus.BAD_REQUEST));
    }

    await updateUser(
      { _id: user._id },
      {
        $set: {
          exp_limit: newExpLimit,
        },
      }
    );

    await createUserLog({
      userId: user._id,
      username: user.username,
      ip: req.clientIp || "",
      browserDetails: req.headers["user-agent"] || "",
      type: "change_password",
      remark: `Exp limit updated from ${oldExpLimit} to ${newExpLimit}`,
    });

    await delCache("users:all");
    await delCache(`user:${user._id}`);

    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          { exp_limit: newExpLimit },
          "Exp limit updated successfully",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(err);
  }
};

const filterByUser = async (req, res, next) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "userId is required",
            httpStatus.BAD_REQUEST
          )
        );
    }

    const user = await getUser({
      _id: userId,
    });

    if (!user) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "User not found.",
            httpStatus.BAD_REQUEST
          )
        );
    }

    //const credit = await bindUserDepositKey([user]);

    const parent = user.parent
      ? await getUser({
          _id: user.parent,
        })
      : null;


      // ===== NEW CODE START =====
      const getAllDownlineUserIds = async (parentIds) => {
        let allUserIds = [...parentIds];
        let currentParentIds = [...parentIds];

        while (currentParentIds.length > 0) {
          const children = await User.find({
            parent: { $in: currentParentIds },
          })
            .select("_id")
            .lean();

          if (!children.length) break;

          const childIds = children.map((child) => child._id);

          allUserIds.push(...childIds);
          currentParentIds = childIds;
        }

        return allUserIds;
      };

      const allUserIds = await getAllDownlineUserIds([user._id]);

      const creditUsers = await User.find({
        _id: { $in: allUserIds },
      }).lean();

      const credit = await bindUserDepositKey(creditUsers);

      const selectedUserCredit = (credit || []).find(
        (item) =>
          String(item._id || item.userId) === String(user._id)
      );
      const exposureResult = await User.aggregate([
        {
          $match: {
            _id: { $in: allUserIds },
          },
        },
        {
          $group: {
            _id: null,
            totalExposure: {
              $sum: {
                $ifNull: ["$exp", 0],
              },
            },
          },
        },
      ]);

      const totalExposure = Number(
        exposureResult?.[0]?.totalExposure || 0
      );
      // ===== NEW CODE END =====


      // const betFilter = {
      //   userId: user._id,
      //   isActive: true,
      //   isDeleteBetShowUser: { $ne: true },
      //   subType: { $exists: false },
      //   status: "pending",
      // };

      const betFilter = {
        userId: { $in: allUserIds },
        isActive: true,
        isDeleteBetShowUser: { $ne: true },
        subType: { $exists: false },
        status: "pending",
      };

      //  const bets = await Bet.find(betFilter)
      //   .sort({ createdAt: -1 })
      //   .lean();
      const rawBets = await Bet.find(betFilter)
          .sort({ createdAt: -1 })
          .lean();

        const tradeCountMap = {};

        for (const bet of rawBets) {
          const key = String(
            bet.gameId ||
            `${bet.eventName}-${bet.marketId}`
          );

          tradeCountMap[key] =
            (tradeCountMap[key] || 0) + 1;
        }

        const bets = rawBets.map((bet) => {
          const key = String(
            bet.gameId ||
            `${bet.eventName}-${bet.marketId}`
          );

          return {
            ...bet,
            tradeCount: tradeCountMap[key] || 0,
          };
        });

        // const marketIds = [...new Set(bets.map((bet) => bet.marketId))];

        // const sportsData = await getAllSportsData({
        //   mid: { $in: marketIds },
        //   userId: user._id,
        // });

        // const sportsDataMap = new Map();

        const marketIds = [...new Set(bets.map((bet) => bet.marketId))];

        const sportsData = await getAllSportsData({
          mid: { $in: marketIds },
        });

        const sportsDataMap = new Map();

        (sportsData || []).forEach((sd) => {
          const data = sd.toObject ? sd.toObject() : sd;
          sportsDataMap.set(String(data.mid), data);
        });

        const betsWithSportsData = bets.map((bet) => {
          const sports = sportsDataMap.get(String(bet.marketId));

          if (!sports) {
            return {
              ...bet,
              sportsData: null,
            };
          }

          const runnerMap = {};

          (bet.sections || []).forEach((runner) => {
            runnerMap[String(runner.sid)] = runner.nat;
          });

          return {
            ...bet,
            sportsData: {
              ...sports,
              sdata: (sports.sdata || []).map((item) => ({
                ...item,
                runnerName: runnerMap[String(item.sid)] || "",
              })),
            },
          };
        });

        const gameMap = new Map();

        for (const bet of betsWithSportsData) {
          const gameKey = String(
            bet.gameId ||
            `${bet.eventName}-${bet.marketId}`
          );

          if (!gameMap.has(gameKey)) {
            gameMap.set(gameKey, {
              gameId: bet.gameId || "",
              marketId: bet.marketId || "",
              eventType:
                bet.eventType ||
                bet.sportName ||
                bet.etid ||
                "",
              eventName:
                bet.eventName ||
                bet.matchName ||
                bet.gameName ||
                "",
              matchName:
                bet.matchName ||
                bet.marketName ||
                bet.gType ||
                "",
              trade: 0,
            });
          }

          gameMap.get(gameKey).trade += 1;
        }

      const exposureGames = Array.from(
        gameMap.values()
      ).map((game, index) => ({
        sNo: index + 1,
        masterName:
          parent?.username ||
          parent?.name ||
          "",
        betLock: Boolean(user.betLock),
        ...game,
      }));


    // return res.status(httpStatus.OK).send(
    //   new APIResponse(
    //     {
    //       gameDetail: {
    //         username: user.username || "",
    //         accountType: user.role || "",
    //         general: Number(user.balance || 0),
    //         exposure: Number(user.exp || 0),
    //         creditReference: Number(
    //           credit?.[0]?.cr ?? user.userCR ?? 0
    //         ),
    //       },

    //       userLock: {
    //         masterName:
    //           parent?.username ||
    //           parent?.name ||
    //           "",
    //         userAct: Boolean(user.isActive),
    //         betActive: !Boolean(user.betLock),
    //       },
    //       gameLock: exposureGames,
    //       myMarket: exposureGames,
    //        bets,
    //     },
    //     "User market analysis fetched successfully",
    //     httpStatus.OK
    //   )
    // );

    const uniqueMarkets = new Map();

    for (const bet of betsWithSportsData) {
      const key = String(bet.marketId);

      if (!uniqueMarkets.has(key)) {
        uniqueMarkets.set(key, bet);
      }
    }

   const marketBets = Array.from(uniqueMarkets.values());

    const responseData = {
      gameDetail: {
        username: user.username || "",
        accountType: user.role || "",
        general: Number(user.balance || 0),
        //exposure: Number(user.exp || 0),
        exposure: totalExposure,
        // creditReference: Number(
        //   credit?.[0]?.cr ?? user.userCR ?? 0
        // ),
        creditReference: Number(
          selectedUserCredit?.cr ?? user.userCR ?? 0
        ),
      },

      userLock: {
        masterName: parent?.username || parent?.name || "",
        userAct: Boolean(user.isActive),
        betActive: !Boolean(user.betLock),
      },

      bets: marketBets,
    };

    console.log(
      "Market Analysis Response:\n",
      JSON.stringify(responseData, null, 2)
    );

    return res.status(httpStatus.OK).send(
      new APIResponse(
        responseData,
        "User market analysis fetched successfully",
        httpStatus.OK
      )
    );
  } catch (error) {
    console.log("filterbyusererror",error);
    next(error);
  }
};


const updateUserAccessRecursively = async (parentId, updateData) => {
  const children = await User.find({ parent: parentId }).select("_id");

  if (!children.length) return;

  for (const child of children) {
    await UserAccess.findOneAndUpdate(
      { userId: child._id },
      {
        $set: updateData,
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    await updateUserAccessRecursively(child._id, updateData);
  }
};

const resetCommissionRecursively = async (parentId,enabled) => {
  // Find all direct children
  const children = await User.find({ parent: parentId }).select("_id");

  if (!children.length) return;

  for (const child of children) {
    // Reset this child's Partnership commissions
    await Partnership.findOneAndUpdate(
      {
        userId: child._id,
        partnerId: parentId,
      },
      {
        $set: {
          commissionEnabled: enabled,
        },
      },
      {
        new: true,
      }
    );

    // Continue down the hierarchy
    await resetCommissionRecursively(child._id,enabled);
  }
};

const saveUserAccess = async (req, res, next) => {
  try {
    const {
      userId,
      casino,
      sport,
      sports_type,
      commission,
      interCasino
    } = req.body;


    console.log("REQ BODY:+++++", req.body);
    console.log("COMMISSION:", commission);
    console.log("COMMISSION TYPE:++++++++", typeof commission);
 
    if (!userId) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "userId is required",
            httpStatus.BAD_REQUEST
          )
        );
    }
 
    const user = await getUserById(userId);
 
    if (!user) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(
          new APIError(
            "User not found",
            httpStatus.NOT_FOUND
          )
        );
    }
 
    if (
      casino !== undefined &&
      typeof casino !== "boolean"
    ) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "casino must be boolean",
            httpStatus.BAD_REQUEST
          )
        );
    }
 
    if (
      sport !== undefined &&
      typeof sport !== "boolean"
    ) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "sport must be boolean",
            httpStatus.BAD_REQUEST
          )
        );
    }
 
    if (
      commission !== undefined &&
      typeof commission !== "boolean"
    ) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "commission must be boolean",
            httpStatus.BAD_REQUEST
          )
        );
    }

    if (
        interCasino !== undefined &&
        typeof interCasino !== "boolean"
      ) {
        return res
          .status(httpStatus.BAD_REQUEST)
          .json(
            new APIError(
              "interCasino must be boolean",
              httpStatus.BAD_REQUEST
            )
          );
    }
 
    if (
      sports_type !== undefined &&
      !Array.isArray(sports_type)
    ) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "sports_type must be an array",
            httpStatus.BAD_REQUEST
          )
        );
    }
 
    if (
      sports_type !== undefined &&
      !sports_type.every(
        (item) => typeof item === "string"
      )
    ) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "Every sports_type value must be a string",
            httpStatus.BAD_REQUEST
          )
        );
    }
 
    if (
      casino === undefined &&
      sport === undefined &&
      commission === undefined &&
      interCasino === undefined &&
      sports_type === undefined
    ) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "casino, sport, commission interCasino or sports_type value is required",
            httpStatus.BAD_REQUEST
          )
        );
    }
 
    const updateData = {};
 
    if (casino !== undefined) {
      updateData.casino = casino;
    }
 
    if (sport !== undefined) {
      updateData.sport = sport;
 
      if (sport === false) {
        updateData.sports_type = [];
      }
    }
 
    if (commission !== undefined) {
      updateData.commission = commission;
    }

    if (interCasino !== undefined) {
      updateData.interCasino = interCasino;
    }
 
    if (sports_type !== undefined) {
      const formattedSports = [
        ...new Set(
          sports_type
            .map((item) =>
              item.trim().toLowerCase()
            )
            .filter(Boolean)
        ),
      ];
 
      updateData.sports_type = formattedSports;
    }
    console.log("UPDATE DATA:+++", updateData);
    const userAccess = await UserAccess.findOneAndUpdate(
      { userId: user._id },
      {
        $set: updateData,
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    await updateUserAccessRecursively(user._id, updateData);

    if (commission !== undefined && user.parent) {
      await Partnership.findOneAndUpdate(
        {
          userId: user._id,
          partnerId: user.parent,
        },
        {
          $set: {
            commissionEnabled: commission,
          },
        },
        {
          new: true,
        }
      );
    }

    if (commission !== undefined) {
      await resetCommissionRecursively(user._id, commission);
    }
 
    return res.status(httpStatus.OK).send(
      new APIResponse(
        userAccess,
        "User access saved successfully",
        httpStatus.OK
      )
    );
  } catch (error) {
    next(error);
  }
};


const generateOtp = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const generatePin = async (req, res, next) => {
  try {
    const otp = generateOtp();

    await AccessPin.deleteMany({});

    const savedPin = await AccessPin.create({
      pin: otp,
    });

    return res.status(httpStatus.OK).send(
      new APIResponse(
        savedPin,
        "Pin generated successfully",
        httpStatus.OK
      )
    );
  } catch (error) {
    next(error);
  }
};

//below old working code
// const getUserPartnershipValue = async (req, res, next) => {
//   try {
//     const { userId } = req.params;

//     if (!userId) {
//       return res
//         .status(httpStatus.BAD_REQUEST)
//         .json(
//           new APIError(
//             "userId is required",
//             httpStatus.BAD_REQUEST
//           )
//         );
//     }

//     const user = await User.findById(userId)
//       .select("_id username partnershipValue")
//       .lean();

//     if (!user) {
//       return res
//         .status(httpStatus.NOT_FOUND)
//         .json(
//           new APIError(
//             "User not found",
//             httpStatus.NOT_FOUND
//           )
//         );
//     }

//     return res.status(httpStatus.OK).send(
//       new APIResponse(
//         {
//           userId: user._id,
//           username: user.username,
//           partnershipValue: user.partnershipValue,
//         },
//         "Partnership value fetched successfully",
//         httpStatus.OK
//       )
//     );
//   } catch (e) {
//     next(e);
//   }
// };

const getUserPartnershipValue = async (req, res, next) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "userId is required",
            httpStatus.BAD_REQUEST
          )
        );
    }

    const user = await User.findById(userId)
      .select("_id username role parent partnershipValue")
      .lean();

    if (!user) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(
          new APIError(
            "User not found",
            httpStatus.NOT_FOUND
          )
        );
    }

    // Same existing calculation
    let totalCommission = 0;

    if (user?.role === "owner") {
      totalCommission = 100;
    } else {
      const partnerShit = await findPartnershipByUserAndPartner(
        user?._id,
        user?.parent
      );

      totalCommission = partnerShit?.downLineCommission || 0;
    }

    return res.status(httpStatus.OK).send(
      new APIResponse(
        {
          userId: user._id,
          username: user.username,

          // Existing value - no change
          partnershipValue: user.partnershipValue || 0,

          // Same Downline calculation
          downLineCommission: totalCommission,
        },
        "Partnership value fetched successfully",
        httpStatus.OK
      )
    );
  } catch (e) {
    next(e);
  }
};

const updateUserPartnershipValue = async (req, res, next) => {
  try {
    const { userId, partnershipValue } = req.body;

    if (!userId) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "userId is required",
            httpStatus.BAD_REQUEST
          )
        );
    }

    if (
      partnershipValue === undefined ||
      partnershipValue === null
    ) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "partnershipValue is required",
            httpStatus.BAD_REQUEST
          )
        );
    }

    if (
      typeof partnershipValue !== "number" ||
      partnershipValue < 0 ||
      partnershipValue > 100
    ) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "partnershipValue must be a number between 0 and 100.",
            httpStatus.BAD_REQUEST
          )
        );
    }

    const user = await User.findById(userId);

    if (!user) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(
          new APIError(
            "User not found",
            httpStatus.NOT_FOUND
          )
        );
    }

    if (!user.parent) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "User does not have a parent.",
            httpStatus.BAD_REQUEST
          )
        );
    }

    const creator = await User.findById(user.parent)
      .select("_id role partnershipValue")
      .lean();

    if (!creator) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "Creator not found.",
            httpStatus.BAD_REQUEST
          )
        );
    }

    const parentPartnership =
      Number(creator.partnershipValue || 0);

    if (
      partnershipValue >
      100 - parentPartnership
    ) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            `Partnership value must be between 0 and ${100 - parentPartnership}.`,
            httpStatus.BAD_REQUEST
          )
        );
    }

    user.partnershipValue = partnershipValue;

    await user.save();

    await delCache("users:all");

    return res.status(httpStatus.OK).send(
      new APIResponse(
        {
          userId: user._id,
          username: user.username,
          partnershipValue: user.partnershipValue,
        },
        "Partnership value updated successfully",
        httpStatus.OK
      )
    );
  } catch (e) {
    next(e);
  }
};


const getUsersByPartnerWithUserLockShotx = async (req, res, next) => {
  try {
    const partnerId = req.user?._id;

    const {
      search,
      page = 1,
      limit = 25,
      userLock = "false",
      targetRole,
    } = req?.query;

    if (!targetRole) {
      return res.status(httpStatus.BAD_REQUEST).send(
        new APIResponse(
          null,
          "targetRole is required",
          httpStatus.BAD_REQUEST
        )
      );
    }

    const {
      users,
      totalRecords,
      totalPages,
      allDataTotals,
    } = await getUsersByPartnerIdWithUserLockShotx(
      partnerId,
      targetRole,
      search,
      page,
      limit,
      userLock
    );

    const usersWithDeposit = await bindUserDepositKey(users);

    res.status(httpStatus.OK).send(
      new APIResponse(
        {
          users: usersWithDeposit,
          totalRecords,
          totalPages,
          allDataTotals,
        },
        "Users under this partner",
        httpStatus.OK
      )
    );
  } catch (err) {
    console.log("erroror++++", err);
    next(err);
  }
};

const getDirectChildBettingReportShotx = async (req, res, next) => {
  try {
    const {
      userId,
      fromDate,
      toDate,
      userLock = "false",
    } = req.query;

    // ------------------------------------------------------------
    // VALIDATE USER ID
    // ------------------------------------------------------------

    if (!userId) {
      throw new APIError(
        "userId is required",
        httpStatus.BAD_REQUEST
      );
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new APIError(
        "Invalid userId",
        httpStatus.BAD_REQUEST
      );
    }

    // ------------------------------------------------------------
    // USER LOCK FILTER
    // false = Active
    // true  = Deactive
    // ------------------------------------------------------------

    const selectedUserLock =
      userLock === true || userLock === "true";

    // ------------------------------------------------------------
    // DATE FILTER
    // ------------------------------------------------------------

    let startDate;
    let endDate;

    if (fromDate || toDate) {
      if (!fromDate || !toDate) {
        throw new APIError(
          "Both fromDate and toDate are required when using date filter",
          httpStatus.BAD_REQUEST
        );
      }

      const parseDate = (dateString, endOfDay = false) => {
        const [day, month, year] = String(dateString)
          .split("/")
          .map(Number);

        if (!day || !month || !year) {
          return null;
        }

        const date = new Date(year, month - 1, day);

        if (endOfDay) {
          date.setHours(23, 59, 59, 999);
        } else {
          date.setHours(0, 0, 0, 0);
        }

        return date;
      };

      startDate = parseDate(fromDate);
      endDate = parseDate(toDate, true);

      if (
        !startDate ||
        !endDate ||
        isNaN(startDate.getTime()) ||
        isNaN(endDate.getTime())
      ) {
        throw new APIError(
          "Invalid date format. Use DD/MM/YYYY",
          httpStatus.BAD_REQUEST
        );
      }

      if (startDate > endDate) {
        throw new APIError(
          "fromDate cannot be greater than toDate",
          httpStatus.BAD_REQUEST
        );
      }
    }

    // ------------------------------------------------------------
    // FIND REQUESTED USER
    // ------------------------------------------------------------

    const master = await Usermodel.findById(userId)
      .select("_id username role parent")
      .lean();

    if (!master) {
      throw new APIError(
        "User not found",
        httpStatus.NOT_FOUND
      );
    }

    // ------------------------------------------------------------
    // FIND DIRECT CHILDREN
    //
    // These are the rows returned by the API.
    // ------------------------------------------------------------

    const children = await Usermodel.find({
      parent: master._id,
      isActive: true,
      userLock: selectedUserLock,
    })
      .select("_id username role parent userLock")
      .lean();

    if (!children.length) {
      return res
        .status(httpStatus.OK)
        .send(
          new APIResponse(
            {
              data: [],
              total: {
                matchCommission: 0,
                sessionCommission: 0,
                casinoCommission: 0,
                total: 0,
              },
            },
            "No direct children found",
            httpStatus.OK
          )
        );
    }

    // ------------------------------------------------------------
    // FIND THE ONE PARTNERSHIP
    //
    // IMPORTANT:
    //
    // The partnership is NOT searched for every child.
    //
    // It is searched only between:
    //
    // userId   = requested user / master
    // partnerId = requested user's parent
    //
    // This same partnership configuration is used for
    // every user under this master.
    // ------------------------------------------------------------

    let partnership = null;

    if (master.parent) {
      partnership = await Partnership.findOne({
        userId: master._id,
        partnerId: master.parent,
      })
        .select(
          "userId partnerId bookmakerCommission fancyCommission casinoCommission"
        )
        .lean();
    }

    // ------------------------------------------------------------
    // FIND ALL USERS UNDER REQUESTED USER
    //
    // We need all descendants because a direct child's row
    // should include the bets of everyone below that child.
    // ------------------------------------------------------------

    const descendantTopParentMap = new Map();

    const allHierarchyUserIds = [];

    const userMap = new Map();

    // ------------------------------------------------------------
    // START FROM DIRECT CHILDREN
    // ------------------------------------------------------------

    let currentLevel = children.map((child) => {
      const childId = String(child._id);

      descendantTopParentMap.set(
        childId,
        childId
      );

      allHierarchyUserIds.push(child._id);

      userMap.set(
        childId,
        child
      );

      return {
        _id: child._id,
        topParentId: childId,
      };
    });

    // ------------------------------------------------------------
    // WALK COMPLETE DOWNLINE
    // ------------------------------------------------------------

    while (currentLevel.length) {
      const currentIds = currentLevel.map(
        (item) => item._id
      );

      const nextChildren = await Usermodel.find({
        parent: {
          $in: currentIds,
        },
        isActive: true,
      })
        .select("_id username role parent userLock")
        .lean();

      if (!nextChildren.length) {
        break;
      }

      const currentTopMap = new Map();

      for (const item of currentLevel) {
        currentTopMap.set(
          String(item._id),
          item.topParentId
        );
      }

      const nextLevel = [];

      for (const child of nextChildren) {
        const childId = String(child._id);
        const parentId = String(child.parent);

        const topParentId =
          currentTopMap.get(parentId);

        if (!topParentId) {
          continue;
        }

        descendantTopParentMap.set(
          childId,
          topParentId
        );

        allHierarchyUserIds.push(
          child._id
        );

        userMap.set(
          childId,
          child
        );

        nextLevel.push({
          _id: child._id,
          topParentId,
        });
      }

      currentLevel = nextLevel;
    }

    // ------------------------------------------------------------
    // FIND ALL BETS OF COMPLETE DOWNLINE
    // ------------------------------------------------------------

    const betQuery = {
      userId: {
        $in: allHierarchyUserIds,
      },
    };

    if (startDate && endDate) {
      betQuery.createdAt = {
        $gte: startDate,
        $lte: endDate,
      };
    }

    const bets = await Bet.find(betQuery)
      .select(
        "userId amount profit gType cType marketName sectionName etid iscc"
      )
      .lean();

    // ------------------------------------------------------------
    // INITIALIZE REPORT
    //
    // One row per DIRECT CHILD.
    //
    // Each direct child's row receives the accumulated
    // commission of its entire downline.
    // ------------------------------------------------------------

    const reportMap = new Map();

    for (const child of children) {
      reportMap.set(
        String(child._id),
        {
          userId: child._id,
          username: child.username,
          role: child.role,

          matchCommission: 0,
          sessionCommission: 0,
          casinoCommission: 0,
          total: 0,
        }
      );
    }

    // ------------------------------------------------------------
    // CASINO GAME TYPES
    // ------------------------------------------------------------

    const casinoGameTypes = [
      "superover3",
      "superover",
      "superover2",
      "cricketv3",
    ];

    // ------------------------------------------------------------
    // CALCULATE COMMISSION
    // ------------------------------------------------------------

    for (const bet of bets) {
      const betUserId = String(bet.userId);

      // ----------------------------------------------------------
      // FIND WHICH DIRECT CHILD THIS BET BELONGS TO
      // ----------------------------------------------------------

      const topParentId =
        descendantTopParentMap.get(
          betUserId
        );

      if (!topParentId) {
        continue;
      }

      const report =
        reportMap.get(topParentId);

      if (!report) {
        continue;
      }

      // ----------------------------------------------------------
      // USE THE ONE PARTNERSHIP FOR ALL BETS
      // ----------------------------------------------------------

      if (!partnership) {
        continue;
      }

      const profit = Number(
        bet.profit || 0
      );

      // ----------------------------------------------------------
      // NORMALIZE FIELDS
      // ----------------------------------------------------------

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

      // ----------------------------------------------------------
      // CASINO GAME TYPE
      // ----------------------------------------------------------

      const isCasinoGameType =
        casinoGameTypes.includes(cType);

      // ----------------------------------------------------------
      // BOOKMAKER / MATCH
      // ----------------------------------------------------------

      const isBookmaker =
        marketName === "bookmaker" ||
        marketName === "bookmaker 2";

      // ----------------------------------------------------------
      // FANCY / SESSION
      // ----------------------------------------------------------

      const isFancy =
        gType === "fancy" ||
        (
          gType === "fancy1" &&
          !sectionName.includes(
            "will win the toss"
          )
        );

      // ----------------------------------------------------------
      // SAME BET ELIGIBILITY AS EXISTING REPORT
      //
      // IMPORTANT:
      // etid/iscc restriction applies ONLY to
      // BOOKMAKER and FANCY.
      //
      // CASINO BETS MUST NOT BE FILTERED BY etid/iscc.
      // ----------------------------------------------------------

      const validCommissionBet =
        String(bet.etid) === "4" &&
        (
          bet.iscc === undefined ||
          Number(bet.iscc) === 0
        );

      // ==========================================================
      // MATCH / BOOKMAKER COMMISSION
      // ==========================================================

      if (
        isBookmaker &&
        !isCasinoGameType &&
        validCommissionBet
      ) {
        const bookmakerConfig =
          partnership.bookmakerCommission?.[0];

        const bookmakerType =
          bookmakerConfig?.type || "NONE";

        const bookmakerPercentage =
          Number(
            bookmakerConfig?.percentage || 0
          );

        if (
          bookmakerType === "NONE" ||
          bookmakerPercentage <= 0
        ) {
          continue;
        }

        let commissionBase = 0;

        // ENTRY_WISE
        if (
          bookmakerType === "ENTRY_WISE"
        ) {
          commissionBase =
            Math.abs(profit);
        }

        // ENTRY_LOOSING
        else if (
          bookmakerType ===
          "ENTRY_LOOSING"
        ) {
          if (profit < 0) {
            commissionBase =
              Math.abs(profit);
          }
        }

        // NET_LOOSING
        else if (
          bookmakerType ===
          "NET_LOOSING"
        ) {
          if (profit < 0) {
            commissionBase =
              Math.abs(profit);
          }
        }

        const commission =
          (
            commissionBase *
            bookmakerPercentage
          ) / 100;

        report.matchCommission +=
          commission;
      }

      // ==========================================================
      // SESSION / FANCY COMMISSION
      // ==========================================================

      else if (
        isFancy &&
        !isCasinoGameType &&
        validCommissionBet
      ) {
        const fancyConfig =
          partnership.fancyCommission?.[0];

        const fancyType =
          fancyConfig?.type || "NONE";

        const fancyPercentage =
          Number(
            fancyConfig?.percentage || 0
          );

        if (
          fancyType === "NONE" ||
          fancyPercentage <= 0
        ) {
          continue;
        }

        let commissionBase = 0;

        if (
          fancyType === "ENTRY_WISE"
        ) {
          commissionBase =
            Math.abs(profit);
        }

        const commission =
          (
            commissionBase *
            fancyPercentage
          ) / 100;

        report.sessionCommission +=
          commission;
      }

      // ==========================================================
      // CASINO COMMISSION
      //
      // IMPORTANT:
      // NO etid/iscc CHECK HERE.
      //
      // Casino bets are calculated independently.
      // ==========================================================

      else if (
        !isBookmaker &&
        !isFancy
      ) {
        const casinoConfig =
          partnership.casinoCommission;

        const casinoType =
          casinoConfig?.type || "NONE";

        const casinoPercentage =
          Number(
            casinoConfig?.percentage || 0
          );

        if (
          casinoType === "NONE" ||
          casinoPercentage <= 0
        ) {
          continue;
        }

        let commissionBase = 0;

        // ENTRY_LOOSING
        if (
          casinoType ===
            "ENTRY_LOOSING" &&
          profit < 0
        ) {
          commissionBase =
            Math.abs(profit);
        }

        const commission =
          (
            commissionBase *
            casinoPercentage
          ) / 100;

        report.casinoCommission +=
          commission;
      }
    }

    // ------------------------------------------------------------
    // FINAL DATA
    // ------------------------------------------------------------

    const data =
      Array.from(
        reportMap.values()
      ).map((item) => {
        const matchCommission =
          Number(
            item.matchCommission.toFixed(2)
          );

        const sessionCommission =
          Number(
            item.sessionCommission.toFixed(2)
          );

        const casinoCommission =
          Number(
            item.casinoCommission.toFixed(2)
          );

        const total =
          Number(
            (
              matchCommission +
              sessionCommission +
              casinoCommission
            ).toFixed(2)
          );

        return {
          userId: item.userId,
          username: item.username,
          role: item.role,

          matchCommission,
          sessionCommission,
          casinoCommission,
          total,
        };
      });

    // ------------------------------------------------------------
    // TOTALS
    // ------------------------------------------------------------

    const totals = {
      matchCommission: 0,
      sessionCommission: 0,
      casinoCommission: 0,
      total: 0,
    };

    for (const item of data) {
      totals.matchCommission +=
        Number(
          item.matchCommission || 0
        );

      totals.sessionCommission +=
        Number(
          item.sessionCommission || 0
        );

      totals.casinoCommission +=
        Number(
          item.casinoCommission || 0
        );

      totals.total +=
        Number(
          item.total || 0
        );
    }

    Object.keys(totals).forEach(
      (key) => {
        totals[key] = Number(
          totals[key].toFixed(2)
        );
      }
    );

    // ------------------------------------------------------------
    // FINAL API RESPONSE
    // ------------------------------------------------------------

    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          {
            data,
            total: totals,
          },
          "Direct child commission report fetched successfully",
          httpStatus.OK
        )
      );

  } catch (e) {
    console.log(
      "getDirectChildCOmmissionReportShotx error+++",
      e
    );

    next(e);
  }
};

module.exports = {
  getDirectChildBettingReportShotx,
  getUserPartnershipValue,
  updateUserPartnershipValue,
  getDirectChildBettingReport,
  deleteUser,
  create,
  createPartner,
  getAll,
  getById,
  update,
  getUsersByPartner,
  getPartners,
  changePassword,
  initialSetup,
  accessRules,
  getAccountDetails,
  getDashboardDetails,
  updateUserRequest,
  register,
  getByUsername,
  forgotPassword,
  resetPassword,
  createSubUser,
  getSubUser,
  getTransactionPassword,
  updatePartnership,
  getSingleUsersById,
  revertPartnershipUpdate,
  getDisabledUsers,
  updateUserCR,
  updateExpLimit,
  filterByUser,
 saveUserAccess,
 generatePin,
 getUsersByPartnerWithUserLock,
 updatePartnerSeat,
 getPartnerSeat,
 //listAllUsersCurrentBets,
 registerWithShare,
 getChildUserDetails,
 getUserLockHistory,
 getUsersByPartnerWithUserLockShotx

};

