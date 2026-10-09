const { collectAllIds } = require("../bet/bet.helper");
const {
  findPartnershipByUserAndPartner,
} = require("../partnership/partnership.helper");
const partnershipModel = require("../partnership/partnership.model");
const transactionModel = require("../transaction/transaction.model");
const mongoose = require("mongoose");
const User = require("./users.model");
const UserAccess = require("./userAccess.model");
async function getUser(query) {
  return User.findOne(query);
}
async function getUserById(id) {
  return User.findById(id);
}

async function deleteUser(id) {
  return User.deleteOne({ _id: id });
}
async function getAllUsers(filter = { isActive: true }, projection = {}) {
  return User.find(filter, projection);
}


///below is my working code without active deactive

async function getUsersByPartnerId(partnerId, search, page = 1, limit = 25) {
  const limitNum = parseInt(limit);
  const pageNum = parseInt(page);
  const skip = (pageNum - 1) * limitNum;
  const balanceHierarchyRoles = [
      "super-admin",
      "admin",
      "sub-admin",
      "super-master",
      "master",
  ];
  const filter = { isActive: true, parent: partnerId };
    if (search && search.trim()) {
      const regex = new RegExp(search, "i");
      filter.$or = [
        { username: regex },
        { phone: regex },
        { name: regex },
        { role: regex },
      ];
    }

    //[users, totalRecords, partnerUser, totalResult, allUsersForBalance]
    const [
      users,
      totalRecords,
      partnerUser,
      activeResult,
      deactiveResult,
      activeUsersForBalance,
      deactiveUsersForBalance,
    ] = await Promise.all([
      // Pagination wala data same rahega
      User.find(filter)
        .sort({ createdAt: -1 })
        .populate("parent", "_id username")
        .skip(skip)
        .limit(limitNum)
        .lean(),

        User.countDocuments(filter),
        User.findById(partnerId)
          .select("role parent")
          .lean(),

        User.aggregate([
          {
            $match: {
              ...filter,
              userLock: false,
            },
          },
          {
            $group: {
              _id: null,

              totalCreditReference: {
                $sum: {
                  $convert: {
                    input: "$userCR",
                    to: "double",
                    onError: 0,
                    onNull: 0,
                  },
                },
              },

              totalBalance: {
                $sum: {
                  $convert: {
                    input: "$balance",
                    to: "double",
                    onError: 0,
                    onNull: 0,
                  },
                },
              },

              totalExposure: {
                $sum: {
                  $convert: {
                    input: "$exp",
                    to: "double",
                    onError: 0,
                    onNull: 0,
                  },
                },
              },

              totalExposureLimit: {
                $sum: {
                  $convert: {
                    input: "$exp_limit",
                    to: "double",
                    onError: 0,
                    onNull: 0,
                  },
                },
              },
            },
          },
        ]),

        User.aggregate([
          {
            $match: {
              ...filter,
              userLock: true,
            },
          },
          {
            $group: {
              _id: null,

              totalCreditReference: {
                $sum: {
                  $convert: {
                    input: "$userCR",
                    to: "double",
                    onError: 0,
                    onNull: 0,
                  },
                },
              },

              totalBalance: {
                $sum: {
                  $convert: {
                    input: "$balance",
                    to: "double",
                    onError: 0,
                    onNull: 0,
                  },
                },
              },

              totalExposure: {
                $sum: {
                  $convert: {
                    input: "$exp",
                    to: "double",
                    onError: 0,
                    onNull: 0,
                  },
                },
              },

              totalExposureLimit: {
                $sum: {
                  $convert: {
                    input: "$exp_limit",
                    to: "double",
                    onError: 0,
                    onNull: 0,
                  },
                },
              },
            },
          },
        ]),

        // User.find(filter)
        // .select("_id role balance")
        // .lean(),

        User.find({
            ...filter,
            userLock:false
        })
        .select("_id role balance userCR exp")
        .lean(),

        User.find({
            ...filter,
            userLock:true
        })
        .select("_id role balance userCR exp")
        .lean(),
    ]);



      const activeBalanceValues = await Promise.all(
        activeUsersForBalance.map(async (currentUser) => {

          const ownBalance = Number(currentUser.balance) || 0;

          // if (!balanceHierarchyRoles.includes(currentUser.role)) {
          //     return {
          //         displayBalance: ownBalance,
          //         clientPl: ownBalance - (Number(currentUser.userCR) || 0),
          //     };
          // }

            if (!balanceHierarchyRoles.includes(currentUser.role)) {
              return {
                  displayBalance: ownBalance,
                  clientPl: ownBalance - (Number(currentUser.userCR) || 0),
                  displayExposure: Number(currentUser.exp) || 0,
              };
            }

          const allIds = await collectAllIds(currentUser);

          const childUsers = await User.find({
              parent: { $in: allIds },
              isActive: true,
          }).lean();

          // const directChildUsers = await User.find({
          //             parent: currentUser._id,
          //             isActive: true,
          //         })
          //         .select("exp")
          //         .lean();

          // const usersTotal = childUsers.reduce(
          //     (t, u) => t + (Number(u.balance) || 0),
          //     0
          // );
         
          // const displayBalance = balanceHierarchyRoles.includes(currentUser.role)
          //     ? ownBalance + usersTotal
          //     : ownBalance;

          // const clientPl = balanceHierarchyRoles.includes(currentUser.role)
          //     ? displayBalance - (Number(currentUser.userCR) || 0)
          //     : ownBalance - (Number(currentUser.userCR) || 0);

          // return {
          //     displayBalance,
          //     clientPl,
          //     //  displayExposure:
          //     //   balanceHierarchyRoles.includes(currentUser.role)
          //     //     ? childUsers.reduce(
          //     //         (total, child) => total + (Number(child.exp) || 0),
          //     //         0
          //     //       )
          //     //     : Number(currentUser.exp) || 0,

          //     displayExposure:
          //       balanceHierarchyRoles.includes(currentUser.role)
          //         ? directChildUsers.reduce(
          //             (total, child) => total + (Number(child.exp) || 0),
          //             0
          //           )
          //         : Number(currentUser.exp) || 0,
          // };

          const directChildUsers = await User.find({
              parent: currentUser._id,
              isActive: true,
          })
          .select("_id exp role")
          .lean();

          const usersTotal = childUsers.reduce(
              (t, u) => t + (Number(u.balance) || 0),
              0
          );

            const getChildDisplayedExposure = async (currentUser) => {
              // USER = only own exposure
              if (currentUser.role === "user") {
                  return Number(currentUser.exp) || 0;
              }

              const children = await User.find({
                  parent: currentUser._id,
                  isActive: true,
              })
                  .select("_id role exp")
                  .lean();

              // No children = own exposure
              if (!children.length) {
                  return Number(currentUser.exp) || 0;
              }

              // Parent = total of children's displayed exposure
              const childExposureValues = await Promise.all(
                  children.map((child) =>
                      getChildDisplayedExposure(child)
                  )
              );

              return childExposureValues.reduce(
                  (total, exposure) =>
                      total + (Number(exposure) || 0),
                  0
              );
          };

          const usersExposureTotal = await Promise.all(
              directChildUsers.map((child) =>
                  getChildDisplayedExposure(child)
              )
          ).then((values) =>
              values.reduce(
                  (total, exposure) =>
                      total + (Number(exposure) || 0),
                  0
              )
          );
          const displayBalance = balanceHierarchyRoles.includes(currentUser.role)
              ? ownBalance + usersTotal
              : ownBalance;

          const clientPl = balanceHierarchyRoles.includes(currentUser.role)
              ? displayBalance - (Number(currentUser.userCR) || 0)
              : ownBalance - (Number(currentUser.userCR) || 0);

          return {
              displayBalance,
              clientPl,
              displayExposure:
                  balanceHierarchyRoles.includes(currentUser.role)
                      ? usersExposureTotal
                      : Number(currentUser.exp) || 0,
          };
        })
      );

    const activeDisplayBalance = activeBalanceValues.reduce(
      (total, item) => total + item.displayBalance,
      0
    );

    const activeClientPl = activeBalanceValues.reduce(
      (total, item) => total + item.clientPl,
      0
    );

    const deactiveBalanceValues = await Promise.all(
      deactiveUsersForBalance.map(async (currentUser) => {
        const ownBalance = Number(currentUser.balance) || 0;

        // User role ka balance same rahega
        // if (!balanceHierarchyRoles.includes(currentUser.role)) {
        //       return {
        //           displayBalance: ownBalance,
        //           clientPl: ownBalance - (Number(currentUser.userCR) || 0),
        //       };
        //   }

          if (!balanceHierarchyRoles.includes(currentUser.role)) {
            return {
                displayBalance: ownBalance,
                clientPl: ownBalance - (Number(currentUser.userCR) || 0),
                displayExposure: Number(currentUser.exp) || 0,
            };
          }
        
        const allIds = await collectAllIds(currentUser);

          const childUsers = await User.find({
              parent: { $in: allIds },
              isActive: true,
          }).lean();

          const directChildUsers = await User.find({
                  parent: currentUser._id,
                  isActive: true,
              })
              .select("exp")
              .lean();

          const usersTotal = childUsers.reduce(
              (t, u) => t + (Number(u.balance) || 0),
              0
          );

          // return balanceHierarchyRoles.includes(currentUser.role)
          //     ? ownBalance + usersTotal
          //     : ownBalance;

          const displayBalance = balanceHierarchyRoles.includes(currentUser.role)
              ? ownBalance + usersTotal
              : ownBalance;

          const clientPl = balanceHierarchyRoles.includes(currentUser.role)
              ? displayBalance - (Number(currentUser.userCR) || 0)
              : ownBalance - (Number(currentUser.userCR) || 0);

          return {
              displayBalance,
              clientPl,

              //  displayExposure:
              //   balanceHierarchyRoles.includes(currentUser.role)
              //     ? childUsers.reduce(
              //         (total, child) => total + (Number(child.exp) || 0),
              //         0
              //       )
              //     : Number(currentUser.exp) || 0,
              displayExposure:
                balanceHierarchyRoles.includes(currentUser.role)
                  ? directChildUsers.reduce(
                      (total, child) => total + (Number(child.exp) || 0),
                      0
                    )
                  : Number(currentUser.exp) || 0,
          };
      })
    );

    // const deactiveDisplayBalance = deactiveBalanceValues.reduce(
    //   (total, balance) => total + balance,
    //   0
    // );

    const deactiveDisplayBalance = deactiveBalanceValues.reduce(
      (total, item) => total + item.displayBalance,
      0
    );

    const deactiveClientPl = deactiveBalanceValues.reduce(
      (total, item) => total + item.clientPl,
      0
    );

    // const totalExposure = Number(
    //   totalResult?.[0]?.totalExposure || 0
    // );

    // const totalExposureLimit = Number(
    //   totalResult?.[0]?.totalExposureLimit || 0
    // );

    const activeCreditReference =
    Number(activeResult?.[0]?.totalCreditReference || 0);

    const activeBalance =
    Number(activeResult?.[0]?.totalBalance || 0);

    // const activeExposure =
    // Number(activeResult?.[0]?.totalExposure || 0);
    const activeExposure = activeBalanceValues.reduce(
      (total, item) => total + (Number(item.displayExposure) || 0),
      0
    );

    const activeCreditReferenceTotal =
  activeUsersForBalance.reduce(
    (total, user) => total + (Number(user.userCR) || 0),
    0
  );

      // const activeExposureTotal =
      //   activeUsersForBalance.reduce(
      //     (total, user) => total + (Number(user.exp) || 0),
      //     0
      //   );

      // const deactiveExposureTotal =
      //   deactiveUsersForBalance.reduce(
      //     (total, user) => total + (Number(user.exp) || 0),
      //     0
      //   );

        const activeExposureTotal = activeBalanceValues.reduce(
          (total, item) => total + (Number(item.displayExposure) || 0),
          0
        );

        const deactiveExposureTotal = deactiveBalanceValues.reduce(
          (total, item) => total + (Number(item.displayExposure) || 0),
          0
        );

           const deactiveCreditReferenceTotal =
        deactiveUsersForBalance.reduce(
          (total, user) => total + (Number(user.userCR) || 0),
          0
        );

    const activeExposureLimit =
    Number(activeResult?.[0]?.totalExposureLimit || 0);

    const deactiveCreditReference =
    Number(deactiveResult?.[0]?.totalCreditReference || 0);

    const deactiveBalance =
    Number(deactiveResult?.[0]?.totalBalance || 0);

    // const deactiveExposure =
    // Number(deactiveResult?.[0]?.totalExposure || 0);

    const deactiveExposure = deactiveBalanceValues.reduce(
      (total, item) => total + (Number(item.displayExposure) || 0),
      0
    );

    const deactiveExposureLimit =
    Number(deactiveResult?.[0]?.totalExposureLimit || 0);

    const loggedInUser = await User.findById(partnerId)
      .select("partnershipValue")
      .lean();

    const partnershipValue = Number(loggedInUser?.partnershipValue || 0);

    const clientPercentagePL = (activeClientPl * partnershipValue) / 100;

    const deactiveClientPercentagePL = (deactiveClientPl * partnershipValue) / 100;

    const finalActiveExposureTotal = activeBalanceValues.reduce(
        (total, item) => total + (Number(item.displayExposure) || 0),
        0
      );

      const finalDeactiveExposureTotal = deactiveBalanceValues.reduce(
        (total, item) => total + (Number(item.displayExposure) || 0),
        0
      );

    const allDataTotals = {
      // Active
      //creditReference: activeCreditReference,
      creditReference: activeCreditReferenceTotal,
      balance: activeDisplayBalance,
      // clientPl: activeBalance - activeCreditReference,
      clientPl: activeClientPl,
      //exposure: activeExposure,
       //exposure: activeExposureTotal,
       exposure: finalActiveExposureTotal,
      availableBalance: activeBalance + activeExposure,
      exposureLimit: activeExposureLimit,
      clientPercentagePL:clientPercentagePL,

      // Deactive
      //deactiveCreditReference: deactiveCreditReference,
      deactiveCreditReference: deactiveCreditReferenceTotal,
      deactiveBalance: deactiveDisplayBalance,
      // deactiveClientPl: deactiveBalance - deactiveCreditReference,
      deactiveClientPl: deactiveClientPl,
      //deactiveExposure: deactiveExposure,
      //deactiveExposure: deactiveExposureTotal,
      deactiveExposure: finalDeactiveExposureTotal,
      deactiveAvailableBalance: deactiveBalance + deactiveExposure,
      deactiveExposureLimit: deactiveExposureLimit,
      deactiveClientPercentagePL:deactiveClientPercentagePL
    };

  // if (!users || users.length === 0)
  //   return { users: [], totalRecords: 0, totalPages: 0 };
    if (!users || users.length === 0) {
      return {
        users: [],
        totalRecords,
        totalPages: Math.ceil(totalRecords / limitNum),
        allDataTotals,
      };
    }

  const totalPages = Math.ceil(totalRecords / limitNum);
  let partnerTotalShare = 100;
  if (partnerUser && partnerUser.role !== "owner" && partnerUser.parent) {
    const partnerPartnership = await partnershipModel
      .findOne({
        userId: partnerUser._id,
        partnerId: partnerUser.parent,
      })
      .lean();
    if (partnerPartnership) {
      partnerTotalShare = partnerPartnership.downLineCommission;
    }
  }

  // batch partnership fetch for all users
    const userIds = users.map((u) => u._id);

      const userAccessList = await UserAccess.find({
      userId: { $in: userIds },
    })
      .select("userId casino sport commission interCasino")
      .lean();

  const userAccessMap = new Map(
    userAccessList.map((access) => [
      String(access.userId),
      {
        casino: access.casino,
        sport: access.sport,
        commission: access.commission,
        interCasino: access.interCasino,
      },
    ])
  );
  const parentIds = users
    .map((u) => (u.parent ? u.parent._id : null))
    .filter(Boolean);

  const orConditions = [];
  if (userIds.length && parentIds.length) {
    orConditions.push({
      $and: [{ userId: { $in: userIds } }, { partnerId: { $in: parentIds } }],
    });
  }
  // also fetch partnership docs where partnerId is any of the users (for downline logic if needed)
  if (userIds.length) orConditions.push({ partnerId: { $in: userIds } });

  const partnerships = orConditions.length
    ? await partnershipModel.find({ $or: orConditions }).lean()
    : [];

  // map for quick lookup: key = `${userId}|${partnerId}` -> partnership doc
  const uplineMap = new Map();
  partnerships.forEach((p) => {
    if (p.userId && p.partnerId) {
      uplineMap.set(`${String(p.userId)}|${String(p.partnerId)}`, p);
    }
  });

  // Calculate dynamic usedSeats for each user in the list
  // A seat is used if the child is NOT a "user" role AND isActive is true AND userLock is false
  const seatCounts = await User.aggregate([
    {
      $match: {
        parent: { $in: userIds },
        role: { $ne: "user" },
        isActive: true,
        userLock: false,
      },
    },
    { $group: { _id: "$parent", count: { $sum: 1 } } },
  ]);

  const seatMap = new Map();
  seatCounts.forEach((s) => seatMap.set(String(s._id), s.count));
  const getHierarchyPartnershipValue = async (currentUser) => {
    let totalPartnershipValue =
      Number(currentUser.partnershipValue || 0);

    let parentId = currentUser.parent
      ? currentUser.parent._id || currentUser.parent
      : null;

    while (parentId) {
      const parentUser = await User.findById(parentId)
        .select("_id parent role partnershipValue")
        .lean();

      if (!parentUser) break;

      if (parentUser.role === "owner") break;

      totalPartnershipValue +=
        Number(parentUser.partnershipValue || 0);

      parentId = parentUser.parent
        ? parentUser.parent._id || parentUser.parent
        : null;
    }

    return totalPartnershipValue;
  };

  // build result
  const usersWithParts = await Promise.all(
    users.map(async (user) => {
      // find partnership entry for (user, user.parent)
      const key = user.parent
        ? `${String(user._id)}|${String(user.parent._id)}`
        : null;
      const partnershipEntry = key ? uplineMap.get(key) || null : null;

      // partner/our percent (what upline receives from this user)
      let userShare = partnershipEntry?.downLineCommission ?? 0;
      if (typeof userShare !== "number") userShare = Number(userShare) || 0;

      // clamp to sensible range 0..100
      if (userShare < 0) userShare = 0;
      if (userShare > 100) userShare = 100;

      const userPartPercent = Math.round(userShare * 100) / 100;
      const partnerPartPercent = Math.max(
        0,
        Math.round((100 - userShare) * 100) / 100
      );

      // (optional) compute totalPts or other fields as you already do
      // const allIds = await collectAllIds(user);
      // const childUsers = await User.find({
      //   parent: { $in: allIds },
      //   isActive: true,
      // }).lean();


      // const usersTotal = childUsers.reduce(
      //   (t, u) => t + (Number(u.balance) || 0),
      //   0
      // );

      //    const usersExposureTotal =
      //     childUsers.reduce(
      //       (t, u) =>
      //         t +
      //         (Number(u.exp) || 0),
      //       0
      //     );

      // const allIds = await collectAllIds(user);

      // const childUsers = await User.find({
      //   parent: { $in: allIds },
      //   isActive: true,
      // }).lean();

      // const directChildUsers = await User.find({
      //   parent: user._id,
      //   isActive: true,
      // })
      // .select("exp")
      // .lean();

      // const usersTotal = childUsers.reduce(
      //   (t, u) => t + (Number(u.balance) || 0),
      //   0
      // );

      // const usersExposureTotal =
      //   directChildUsers.reduce(
      //     (t, u) =>
      //       t +
      //       (Number(u.exp) || 0),
      //     0
      //   );

      const allIds = await collectAllIds(user);

      const childUsers = await User.find({
        parent: { $in: allIds },
        isActive: true,
      }).lean();

      const directChildUsers = await User.find({
        parent: user._id,
        isActive: true,
      })
      .select("_id exp role")
      .lean();

      const usersTotal = childUsers.reduce(
        (t, u) => t + (Number(u.balance) || 0),
        0
      );

     // Recursive displayed exposure
        const getChildDisplayedExposure = async (currentUser) => {
          // USER = only own exposure
          if (currentUser.role === "user") {
            return Number(currentUser.exp) || 0;
          }

          // Get direct active children
          const children = await User.find({
            parent: currentUser._id,
            isActive: true,
          })
            .select("_id role exp")
            .lean();

          // If no children, use own exposure
          if (!children.length) {
            return Number(currentUser.exp) || 0;
          }

          // Parent exposure = total of children's displayed exposure
          const childExposureValues = await Promise.all(
            children.map((child) =>
              getChildDisplayedExposure(child)
            )
          );

          return childExposureValues.reduce(
            (total, exposure) =>
              total + (Number(exposure) || 0),
            0
          );
        };

        const usersExposureTotal = await Promise.all(
          directChildUsers.map((child) =>
            getChildDisplayedExposure(child)
          )
        ).then((values) =>
          values.reduce(
            (total, exposure) =>
              total + (Number(exposure) || 0),
            0
          )
        );
      const players = childUsers.filter((u) => u.role === "user");


      if (user.role === "user") {
        players.push(user);
      }

      const totalPlayerPts = players.reduce(
        (t, u) => t + (Number(u.balance) || 0),
        0
      );
      // const originalBalance = Number(user.balance) || 0;
      // const displayBalance = balanceHierarchyRoles.includes(user.role)
      //   ? originalBalance + totalPlayerPts
      //   : originalBalance;
     const originalBalance = Number(user.balance) || 0;
      const displayBalance = balanceHierarchyRoles.includes(user.role)
      ? originalBalance + usersTotal
      : originalBalance;

      const totalPlayerCR = players.reduce(
        (t, u) => t + (Number(u.userCR) || 0),
        0
      );
        const ownClientPl =
            (Number(user.balance) || 0) - (Number(user.userCR) || 0);

          const descendantsClientPl = childUsers.reduce(
            (total, child) => {
              const childBalance = Number(child.balance) || 0;
              const childCreditReference = Number(child.userCR) || 0;

              return total + (childBalance - childCreditReference);
            },
            0
        );

          const totalPts = usersTotal + (Number(user.balance) || 0);
          let clientPl;

          if (balanceHierarchyRoles.includes(user.role)) {
            clientPl =
              displayBalance - (Number(user.userCR) || 0);
          } else {
            clientPl =
              originalBalance - (Number(user.userCR) || 0);
          }

          //const clientPercentagePL = (clientPl * (Number(user.partnershipValue || 0) / 100));
          const hierarchyPartnershipValue =
          await getHierarchyPartnershipValue(user);

        const clientPercentagePL =
          clientPl * (hierarchyPartnershipValue / 100);

      // The margin kept by the viewing parent (partnerId)
      // const myMarginPercent = Math.max(0, partnerTotalShare - userPartPercent);
      // const clientPlPercent =
      //   user.role === "user"
      //     ? "-"
      //     : (clientPl * (myMarginPercent / 100)).toFixed(2);


          const clientPlPercent =
            user.role === "user"
              ? "-"
              : Number(user.partnershipValue || 0);

          const access = userAccessMap.get(String(user._id));

          // const displayExposure =
          //     balanceHierarchyRoles.includes(user.role)
          //       ? (Number(user.exp) || 0) +
          //         usersExposureTotal
          //       : Number(user.exp) || 0;


          const displayExposure =
          user.role === "user"
            ? Number(user.exp) || 0
            : usersExposureTotal;

      return {
        ...user,
        
          balance: displayBalance,
           //exp: Number(user.exp ?? 0),
          exp: displayExposure,
          availableBal: originalBalance,
          casino: access?.casino ?? true,
          sport: access?.sport ?? true,
          commissionvalue: access?.commission ?? true,
          interCasino: access?.interCasino ?? true,
          exp_limit: Number(user.exp_limit ?? 0),
          usedSeats: seatMap.get(String(user._id)) || 0, // Override with dynamic count
          commission: userShare, // use the correct user share
          userPartPercent,
          partnerPartPercent,
          totalPts: totalPts,
          clientPl,
          clientPlPercent,
          clientPercentagePL,
        pnr: partnerPartPercent,

      };
    })
  );

  
  // return { users: usersWithParts, totalRecords, totalPages };
  return {
    users: usersWithParts,
    totalRecords,
    totalPages,
    allDataTotals,
  };
}



// async function getUsersByPartnerIdWithUserLock(
//   partnerId,
//   search,
//   page = 1,
//   limit = 25,
//   userLock = "false"
//   ) {
//   const limitNum = parseInt(limit);
//   const pageNum = parseInt(page);
//   const skip = (pageNum - 1) * limitNum;

//   const balanceHierarchyRoles = [
//     "super-admin",
//     "admin",
//     "sub-admin",
//     "super-master",
//     "master",
//   ];
//   const baseFilter = {
//     isActive: true,
//     parent: partnerId,
//   };

//   if (search && search.trim()) {
//     const regex = new RegExp(search, "i");

//     baseFilter.$or = [
//       { username: regex },
//       { phone: regex },
//       { name: regex },
//       { role: regex },
//     ];
//   }

//   const selectedUserLock =
//     userLock === true || userLock === "true";

//   const paginationFilter = {
//     ...baseFilter,
//     userLock: selectedUserLock,
//   };


//   const activeFilter = {
//     ...baseFilter,
//     userLock: false,
//   };

//   const deactiveFilter = {
//     ...baseFilter,
//     userLock: true,
//   };
//      const getDisplayedExposure = async (currentUser) => {
//     // USER = only own exposure
//     if (currentUser.role === "user") {
//       return Number(currentUser.exp) || 0;
//     }

//     // Parent = total of its children's DISPLAYED exposure
//     const childUsers = await User.find({
//       parent: currentUser._id,
//       isActive: true,
//     })
//       .select("_id role exp")
//       .lean();

//     const childExposureValues = await Promise.all(
//       childUsers.map(async (child) => {
//         return await getDisplayedExposure(child);
//       })
//     );

//     return childExposureValues.reduce(
//       (total, exposure) => total + (Number(exposure) || 0),
//       0
//     );
//   };


//    const getHierarchyPartnershipValue = async (currentUser) => {
//       let totalPartnershipValue =
//         Number(currentUser.partnershipValue || 0);

//       let parentId = currentUser.parent
//         ? currentUser.parent._id || currentUser.parent
//         : null;

//       while (parentId) {
//         const parentUser = await User.findById(parentId)
//           .select("_id parent role partnershipValue")
//           .lean();

//         if (!parentUser) break;

//         if (parentUser.role === "owner") break;

//         totalPartnershipValue +=
//           Number(parentUser.partnershipValue || 0);

//         parentId = parentUser.parent
//           ? parentUser.parent._id || parentUser.parent
//           : null;
//       }

//       return totalPartnershipValue;
//     };
//   const [
//     users,
//     totalRecords,
//     partnerUser,
//     activeResult,
//     deactiveResult,
//     activeUsersForBalance,
//     deactiveUsersForBalance,
//   ] = await Promise.all([

//     User.find(paginationFilter)
//       .sort({ createdAt: -1 })
//       .populate("parent", "_id username")
//       .skip(skip)
//       .limit(limitNum)
//       .lean(),

//     User.countDocuments(paginationFilter),
//     User.findById(partnerId)
//       .select("role parent")
//       .lean(),

//     User.aggregate([
//       {
//         $match: activeFilter,
//       },
//       {
//         $group: {
//           _id: null,

//           totalCreditReference: {
//             $sum: {
//               $convert: {
//                 input: "$userCR",
//                 to: "double",
//                 onError: 0,
//                 onNull: 0,
//               },
//             },
//           },

//           totalBalance: {
//             $sum: {
//               $convert: {
//                 input: "$balance",
//                 to: "double",
//                 onError: 0,
//                 onNull: 0,
//               },
//             },
//           },

//           totalExposure: {
//             $sum: {
//               $convert: {
//                 input: "$exp",
//                 to: "double",
//                 onError: 0,
//                 onNull: 0,
//               },
//             },
//           },

//           totalExposureLimit: {
//             $sum: {
//               $convert: {
//                 input: "$exp_limit",
//                 to: "double",
//                 onError: 0,
//                 onNull: 0,
//               },
//             },
//           },
//           totalPartnershipValue: {
//             $sum: {
//               $convert: {
//                 input: "$partnershipValue",
//                 to: "double",
//                 onError: 0,
//                 onNull: 0,
//               },
//             },
//           },
//         },
//       },
//     ]),

//     User.aggregate([
//       {
//         $match: deactiveFilter,
//       },
//       {
//         $group: {
//           _id: null,

//           totalCreditReference: {
//             $sum: {
//               $convert: {
//                 input: "$userCR",
//                 to: "double",
//                 onError: 0,
//                 onNull: 0,
//               },
//             },
//           },

//           totalBalance: {
//             $sum: {
//               $convert: {
//                 input: "$balance",
//                 to: "double",
//                 onError: 0,
//                 onNull: 0,
//               },
//             },
//           },

//           totalExposure: {
//             $sum: {
//               $convert: {
//                 input: "$exp",
//                 to: "double",
//                 onError: 0,
//                 onNull: 0,
//               },
//             },
//           },

//           totalExposureLimit: {
//             $sum: {
//               $convert: {
//                 input: "$exp_limit",
//                 to: "double",
//                 onError: 0,
//                 onNull: 0,
//               },
//             },
//           },

//           totalPartnershipValue: {
//             $sum: {
//               $convert: {
//                 input: "$partnershipValue",
//                 to: "double",
//                 onError: 0,
//                 onNull: 0,
//               },
//             },
//           },
//         },
//       },
//     ]),

//     /*
//      * OLD LOGIC SAME
//      */
//     User.find(activeFilter)
//       .select("_id role balance userCR partnershipValue parent exp")
//       .lean(),

//     User.find(deactiveFilter)
//       .select("_id role balance userCR partnershipValue parent exp")
//       .lean(),
//   ]);

//   const activeBalanceValues = await Promise.all(
//     activeUsersForBalance.map(async (currentUser) => {
//       const ownBalance = Number(currentUser.balance) || 0;

//       if (!balanceHierarchyRoles.includes(currentUser.role)) {
//         return {
//           displayBalance: ownBalance,
//           clientPl:
//             ownBalance -
//             (Number(currentUser.userCR) || 0),
//           clientPercentagePL:
//             (
//               ownBalance -
//               (Number(currentUser.userCR) || 0)
//             ) *
//             (
//               (Number(currentUser.partnershipValue) || 0) / 100
//             ),
//           displayExposure:
//             Number(currentUser.exp) || 0,
//         };
//       }

//       const allIds = await collectAllIds(currentUser);

//       const childUsers = await User.find({
//         parent: { $in: allIds },
//         isActive: true,
//       }).lean();

//       const usersTotal = childUsers.reduce(
//         (t, u) =>
//           t + (Number(u.balance) || 0),
//         0
//       );

//       const displayBalance =
//         balanceHierarchyRoles.includes(currentUser.role)
//           ? ownBalance + usersTotal
//           : ownBalance;

//       const clientPl =
//         balanceHierarchyRoles.includes(currentUser.role)
//           ? displayBalance -
//             (Number(currentUser.userCR) || 0)
//           : ownBalance -
//             (Number(currentUser.userCR) || 0);

//             const hierarchyPartnershipValue =
//               await getHierarchyPartnershipValue(currentUser);

//             const clientPercentagePL =
//               clientPl * (hierarchyPartnershipValue / 100);

//               // const displayExposure =
//               //   balanceHierarchyRoles.includes(currentUser.role)
//               //     ? (Number(currentUser.exp) || 0) +
//               //       childUsers.reduce(
//               //         (t, u) => t + (Number(u.exp) || 0),
//               //         0
//               //       )
//               //     : Number(currentUser.exp) || 0;

//               // const displayExposure =
//               //           currentUser.role === "user"
//               //             ? Number(currentUser.exp) || 0
//               //             : childUsers.reduce(
//               //                 (t, u) => t + (Number(u.exp) || 0),
//               //                 0
//               //               );

//               const displayExposure =
//              await getDisplayedExposure(currentUser);

//       return {
//         displayBalance,
//         clientPl,
//         clientPercentagePL,
//          displayExposure,
//       };
//     })
//   );

//   const activeDisplayBalance =
//     activeBalanceValues.reduce(
//       (total, item) =>
//         total + item.displayBalance,
//       0
//     );

//   const activeClientPl =
//     activeBalanceValues.reduce(
//       (total, item) =>
//         total + item.clientPl,
//       0
//     );
//     const activeClientPercentagePL =
//     activeBalanceValues.reduce(
//       (total, item) =>
//         total + (Number(item.clientPercentagePL) || 0),
//       0
//     );
//     // const activeDisplayExposure =
//     //   activeBalanceValues.reduce(
//     //     (total, item) =>
//     //       total + (Number(item.displayExposure) || 0),
//     //     0
//     //   );

//       const activeDisplayExposure = activeBalanceValues.reduce(
//         (total, item) => {
//           return total + (Number(item.displayExposure) || 0);
//         },
//         0
//       );

//   const deactiveBalanceValues = await Promise.all(
//     deactiveUsersForBalance.map(async (currentUser) => {
//       const ownBalance = Number(currentUser.balance) || 0;

//       if (!balanceHierarchyRoles.includes(currentUser.role)) {
//         return {
//           displayBalance: ownBalance,
//           clientPl:
//             ownBalance -
//             (Number(currentUser.userCR) || 0),
//           clientPercentagePL:
//               (
//                 ownBalance -
//                 (Number(currentUser.userCR) || 0)
//               ) *
//               (
//                 (Number(currentUser.partnershipValue) || 0) / 100
//               ),
//           displayExposure:
//               Number(currentUser.exp) || 0,
//         };
//       }

//       const allIds = await collectAllIds(currentUser);

//       const childUsers = await User.find({
//         parent: { $in: allIds },
//         isActive: true,
//       }).lean();

//       const usersTotal = childUsers.reduce(
//         (t, u) =>
//           t + (Number(u.balance) || 0),
//         0
//       );

//       const displayBalance =
//         balanceHierarchyRoles.includes(currentUser.role)
//           ? ownBalance + usersTotal
//           : ownBalance;

//       const clientPl =
//         balanceHierarchyRoles.includes(currentUser.role)
//           ? displayBalance -
//             (Number(currentUser.userCR) || 0)
//           : ownBalance -
//             (Number(currentUser.userCR) || 0);

//             const hierarchyPartnershipValue =
//               await getHierarchyPartnershipValue(currentUser);

//             const clientPercentagePL =
//               clientPl * (hierarchyPartnershipValue / 100);
              
//           //     const displayExposure =
//           // balanceHierarchyRoles.includes(currentUser.role)
//           //   ? (Number(currentUser.exp) || 0) +
//           //     childUsers.reduce(
//           //       (t, u) => t + (Number(u.exp) || 0),
//           //       0
//           //     )
//           //   : Number(currentUser.exp) || 0;

//           // const displayExposure =
//           //     currentUser.role === "user"
//           //       ? Number(currentUser.exp) || 0
//           //       : childUsers.reduce(
//           //           (t, u) => t + (Number(u.exp) || 0),
//           //           0
//           //         );

//           const displayExposure =
//             await getDisplayedExposure(currentUser);


//       return {
//         displayBalance,
//         clientPl,
//         clientPercentagePL,
//          displayExposure,
//       };
//     })
//   );

//   const deactiveDisplayBalance =
//     deactiveBalanceValues.reduce(
//       (total, item) =>
//         total + item.displayBalance,
//       0
//     );

//   const deactiveClientPl =
//     deactiveBalanceValues.reduce(
//       (total, item) =>
//         total + item.clientPl,
//       0
//     );

//     const deactiveClientPercentagePL =
//       deactiveBalanceValues.reduce(
//         (total, item) =>
//           total + (Number(item.clientPercentagePL) || 0),
//         0
//       );

//       // const deactiveDisplayExposure =
//       // deactiveBalanceValues.reduce(
//       //   (total, item) =>
//       //     total + (Number(item.displayExposure) || 0),
//       //   0
//       // );
      

//     const deactiveDisplayExposure = deactiveBalanceValues.reduce(
//       (total, item) => {
//         return total + (Number(item.displayExposure) || 0);
//       },
//       0
//     );

//     const activeCreditReference = Number(
//       activeResult?.[0]?.totalCreditReference || 0
//     );

//   const activeBalance = Number(
//     activeResult?.[0]?.totalBalance || 0
//   );

//   const activeExposure = Number(
//     activeResult?.[0]?.totalExposure || 0
//   );

//   const activeExposureLimit = Number(
//     activeResult?.[0]?.totalExposureLimit || 0
//   );

//   const activePartnershipValue = Number(
//     activeResult?.[0]?.totalPartnershipValue || 0
//   );

//   const deactiveCreditReference = Number(
//     deactiveResult?.[0]?.totalCreditReference || 0
//   );

//   const deactiveBalance = Number(
//     deactiveResult?.[0]?.totalBalance || 0
//   );

//   const deactiveExposure = Number(
//     deactiveResult?.[0]?.totalExposure || 0
//   );

//   const deactiveExposureLimit = Number(
//     deactiveResult?.[0]?.totalExposureLimit || 0
//   );
//   const deactivePartnershipValue = Number(
//     deactiveResult?.[0]?.totalPartnershipValue || 0
//   );

//   // const loggedInUser = await User.findById(partnerId)
//   //   .select("partnershipValue")
//   //   .lean();

//   // const partnershipValue = Number(
//   //   loggedInUser?.partnershipValue || 0
//   // );

//   // const clientPercentagePL =
//   //   (activeClientPl * partnershipValue) / 100;

//   // const deactiveClientPercentagePL =
//   //   (deactiveClientPl * partnershipValue) / 100;

//   const allDataTotals = {
//     // Active
//     creditReference: activeCreditReference,

//     balance: activeDisplayBalance,

//     clientPl: activeClientPl,

//     //exposure: activeExposure,
//     exposure: activeDisplayExposure,

//     availableBalance:
//       activeBalance + activeExposure,

//     exposureLimit:
//       activeExposureLimit,

//     // clientPercentagePL:
//     //   clientPercentagePL,
//       clientPercentagePL:
//         activeClientPercentagePL,

//     //defaultPercentage: activePartnershipValue,
//     defaultPercentage:0,
//     // Deactive
//     deactiveCreditReference:
//       deactiveCreditReference,

//     deactiveBalance:
//       deactiveDisplayBalance,

//     deactiveClientPl:
//       deactiveClientPl,

//     //deactiveExposure:deactiveExposure,
//     deactiveExposure: deactiveDisplayExposure,

//     deactiveAvailableBalance:
//       deactiveBalance + deactiveExposure,

//     deactiveExposureLimit:
//       deactiveExposureLimit,
      

//     deactiveClientPercentagePL:
//       deactiveClientPercentagePL,

//     //deactiveDefaultPercentage:deactivePartnershipValue,
//     deactiveDefaultPercentage:0,
//   };


//   if (!users || users.length === 0) {
//     return {
//       users: [],
//       totalRecords,
//       totalPages:
//         Math.ceil(totalRecords / limitNum),
//       allDataTotals,
//     };
//   }


//   const totalPages =
//     Math.ceil(totalRecords / limitNum);


//   let partnerTotalShare = 100;

//   if (
//     partnerUser &&
//     partnerUser.role !== "owner" &&
//     partnerUser.parent
//   ) {
//     const partnerPartnership =
//       await partnershipModel
//         .findOne({
//           userId: partnerUser._id,
//           partnerId: partnerUser.parent,
//         })
//         .lean();

//     if (partnerPartnership) {
//       partnerTotalShare =
//         partnerPartnership.downLineCommission;
//     }
//   }

//   const userIds = users.map(
//     (u) => u._id
//   );

//   // const userAccessList =
//   //   await UserAccess.find({
//   //     userId: { $in: userIds },
//   //   })
//   //     .select("userId casino sport")
//   //     .lean();

//   const userAccessList =
//   await UserAccess.find({
//     userId: { $in: userIds },
//   })
//     .select("userId casino sport commission")
//     .lean();

//   const userAccessMap = new Map(
//     userAccessList.map((access) => [
//       String(access.userId),
//       {
//         casino: access.casino,
//         sport: access.sport,
//         commission: access.commission,
//       },
//     ])
//   );

//   const parentIds = users
//     .map((u) =>
//       u.parent ? u.parent._id : null
//     )
//     .filter(Boolean);

//   const orConditions = [];

//   if (
//     userIds.length &&
//     parentIds.length
//   ) {
//     orConditions.push({
//       $and: [
//         {
//           userId: {
//             $in: userIds,
//           },
//         },
//         {
//           partnerId: {
//             $in: parentIds,
//           },
//         },
//       ],
//     });
//   }

//   if (userIds.length) {
//     orConditions.push({
//       partnerId: {
//         $in: userIds,
//       },
//     });
//   }

//   const partnerships =
//     orConditions.length
//       ? await partnershipModel
//           .find({
//             $or: orConditions,
//           })
//           .lean()
//       : [];

//   const uplineMap = new Map();

//   partnerships.forEach((p) => {
//     if (p.userId && p.partnerId) {
//       uplineMap.set(
//         `${String(p.userId)}|${String(
//           p.partnerId
//         )}`,
//         p
//       );
//     }
//   });


//   const seatCounts = await User.aggregate([
//     {
//       $match: {
//         parent: { $in: userIds },
//         role: { $ne: "user" },
//         isActive: true,
//         userLock: false,
//       },
//     },
//     {
//       $group: {
//         _id: "$parent",
//         count: { $sum: 1 },
//       },
//     },
//   ]);

//   const seatMap = new Map();

//   seatCounts.forEach((s) =>
//     seatMap.set(
//       String(s._id),
//       s.count
//     )
//   );
   

//   const usersWithParts = await Promise.all(
//     users.map(async (user) => {
//       /*
//        * Partnership entry for user-parent
//        */
//       const key = user.parent
//         ? `${String(user._id)}|${String(
//             user.parent._id
//           )}`
//         : null;

//       const partnershipEntry = key
//         ? uplineMap.get(key) || null
//         : null;

//       /*
//        * User share
//        */
//       let userShare =
//         partnershipEntry?.downLineCommission ??
//         0;

//       if (typeof userShare !== "number") {
//         userShare =
//           Number(userShare) || 0;
//       }

//       /*
//        * Clamp 0-100
//        */
//       if (userShare < 0) {
//         userShare = 0;
//       }

//       if (userShare > 100) {
//         userShare = 100;
//       }

//       const userPartPercent =
//         Math.round(userShare * 100) /
//         100;

//       const partnerPartPercent =
//         Math.max(
//           0,
//           Math.round(
//             (100 - userShare) * 100
//           ) / 100
//         );

//       const allIds =
//         await collectAllIds(user);

//       const childUsers =
//         await User.find({
//           parent: {
//             $in: allIds,
//           },
//           isActive: true,
//         }).lean();

//       /*
//        * Descendant balance
//        */
//       const usersTotal =
//         childUsers.reduce(
//           (t, u) =>
//             t +
//             (Number(u.balance) || 0),
//           0
//         );

//         // const usersExposureTotal =
//         //   childUsers.reduce(
//         //     (t, u) =>
//         //       t +
//         //       (Number(u.exp) || 0),
//         //     0
//         //   );

//     // const usersExposureTotal =
//     //     childUsers.reduce(
//     //       (total, child) =>
//     //         total + (Number(child.exp) || 0),
//     //       0
//     //     );

//     const usersExposureTotal =
//   await getDisplayedExposure(user);


//       /*
//        * Players
//        */
//       const players =
//         childUsers.filter(
//           (u) => u.role === "user"
//         );

//       if (user.role === "user") {
//         players.push(user);
//       }

//       /*
//        * Total player PTS
//        */
//       const totalPlayerPts =
//         players.reduce(
//           (t, u) =>
//             t +
//             (Number(u.balance) || 0),
//           0
//         );

//       /*
//        * Original balance
//        */
//       const originalBalance =
//         Number(user.balance) || 0;

//       /*
//        * OLD DISPLAY BALANCE LOGIC
//        */
//       const displayBalance =
//         balanceHierarchyRoles.includes(
//           user.role
//         )
//           ? originalBalance + usersTotal
//           : originalBalance;

//       /*
//        * Total Player CR
//        */
//       const totalPlayerCR =
//         players.reduce(
//           (t, u) =>
//             t +
//             (Number(u.userCR) || 0),
//           0
//         );

//       /*
//        * Own client PL
//        */
//       const ownClientPl =
//         (Number(user.balance) || 0) -
//         (Number(user.userCR) || 0);

//       /*
//        * Descendants PL
//        */
//       const descendantsClientPl =
//         childUsers.reduce(
//           (total, child) => {
//             const childBalance =
//               Number(child.balance) || 0;

//             const childCreditReference =
//               Number(child.userCR) || 0;

//             return (
//               total +
//               (childBalance -
//                 childCreditReference)
//             );
//           },
//           0
//         );

//       /*
//        * Total PTS
//        */
//       const totalPts =
//         usersTotal +
//         (Number(user.balance) || 0);

//       let clientPl;

//       if (
//         balanceHierarchyRoles.includes(
//           user.role
//         )
//       ) {
//         clientPl =
//           displayBalance -
//           (Number(user.userCR) || 0);
//       } else {
//         clientPl =
//           originalBalance -
//           (Number(user.userCR) || 0);
//       }

//       // const clientPercentagePL =
//       //   clientPl *
//       //   (Number(
//       //     user.partnershipValue || 0
//       //   ) /
//       //     100);
//       const hierarchyPartnershipValue =
//         await getHierarchyPartnershipValue(user);

//       const clientPercentagePL =
//         clientPl * (hierarchyPartnershipValue / 100);

//       // const myMarginPercent =
//       //   Math.max(
//       //     0,
//       //     partnerTotalShare -
//       //       userPartPercent
//       //   );

//       // const clientPlPercent =
//       //   user.role === "user"
//       //     ? "-"
//       //     : (
//       //         clientPl *
//       //         (myMarginPercent / 100)
//       //       ).toFixed(2);


//         const clientPlPercent =
//           user.role === "user"
//             ? "-"
//             : Number(user.partnershipValue || 0);

           
//       /*
//        * Access
//        */
//       const access =userAccessMap.get(String(user._id));

//       // const displayExposure =
//       //     balanceHierarchyRoles.includes(user.role)
//       //       ? (Number(user.exp) || 0) +
//       //         usersExposureTotal
//       //       : Number(user.exp) || 0;

//       const displayExposure =
//           user.role === "user"
//             ? Number(user.exp) || 0
//             : usersExposureTotal;

//       return {
//         ...user,

//         balance: displayBalance,

//         //exp: Number(user.exp ?? 0),
//         exp: displayExposure,
//         availableBal: originalBalance,

//         casino:
//           access?.casino ?? true,

//         sport:
//           access?.sport ?? true,

//         commissionvalue:
//           access?.commission ?? true,

//         exp_limit:
//           Number(
//             user.exp_limit ?? 0
//           ),

//         usedSeats:
//           seatMap.get(
//             String(user._id)
//           ) || 0,

//         commission:
//           userShare,

//         userPartPercent,

//         partnerPartPercent,

//         totalPts,

//         clientPl,

//         clientPlPercent,

//         clientPercentagePL,

//         pnr:
//           partnerPartPercent,
//       };
//     })
//   );

//   return {
//     users: usersWithParts,
//     totalRecords,
//     totalPages,
//     allDataTotals,
//   };
// }

//optimized
async function getUsersByPartnerIdWithUserLock(
  partnerId,
  search,
  page = 1,
  limit = 25,
  userLock = "false"
) {
  const limitNum = parseInt(limit);
  const pageNum = parseInt(page);
  const skip = (pageNum - 1) * limitNum;

  const balanceHierarchyRoles = [
    "super-admin",
    "admin",
    "sub-admin",
    "super-master",
    "master",
  ];

  const baseFilter = {
    isActive: true,
    parent: partnerId,
  };

  if (search && search.trim()) {
    const regex = new RegExp(search, "i");

    baseFilter.$or = [
      { username: regex },
      { phone: regex },
      { name: regex },
      { role: regex },
    ];
  }

  const selectedUserLock =
    userLock === true || userLock === "true";

  const paginationFilter = {
    ...baseFilter,
    userLock: selectedUserLock,
  };

  const activeFilter = {
    ...baseFilter,
    userLock: false,
  };

  const deactiveFilter = {
    ...baseFilter,
    userLock: true,
  };

  /*
   * ============================================================
   * LOAD PARTNER + ENTIRE HIERARCHY ONCE
   * ============================================================
   *
   * collectAllIds() previously performed one DB query per
   * hierarchy level for every user.
   *
   * graphLookup gets the same complete descendant tree once.
   *
   * IMPORTANT:
   * We intentionally do NOT restrict isActive here because
   * the old collectAllIds() also included inactive users.
   */
  const hierarchyResult = await User.aggregate([
    {
      $match: {
        _id: partnerId,
      },
    },
    {
      $graphLookup: {
        from: User.collection.name,
        startWith: "$_id",
        connectFromField: "_id",
        connectToField: "parent",
        as: "descendants",
      },
    },
    {
      $graphLookup: {
        from: User.collection.name,
        startWith: "$parent",
        connectFromField: "parent",
        connectToField: "_id",
        as: "ancestors",
      },
    },
    {
      $project: {
        _id: 1,
        username: 1,
        role: 1,
        parent: 1,
        partnershipValue: 1,
        descendants: 1,
        ancestors: 1,
      },
    },
  ]);

  const hierarchyRoot = hierarchyResult[0] || null;

  /*
   * ============================================================
   * USER MAP
   * ============================================================
   */

  const userMap = new Map();

  if (hierarchyRoot) {
    userMap.set(
      String(hierarchyRoot._id),
      hierarchyRoot
    );

    for (const user of hierarchyRoot.descendants || []) {
      userMap.set(String(user._id), user);
    }

    for (const ancestor of hierarchyRoot.ancestors || []) {
      userMap.set(String(ancestor._id), ancestor);
    }
  }

  /*
   * ============================================================
   * CHILDREN MAP
   * ============================================================
   *
   * Same hierarchy relationship as:
   *
   * User.find({ parent: currentUser._id })
   */

  const childrenMap = new Map();

  for (const user of hierarchyRoot?.descendants || []) {
    const parentId = user.parent
      ? String(user.parent)
      : null;

    if (!parentId) continue;

    if (!childrenMap.has(parentId)) {
      childrenMap.set(parentId, []);
    }

    childrenMap.get(parentId).push(user);
  }

  /*
   * ============================================================
   * ACTIVE CHILDREN MAP
   * ============================================================
   */

  const activeChildrenMap = new Map();

  for (const [parentId, children] of childrenMap.entries()) {
    activeChildrenMap.set(
      parentId,
      children.filter((child) => child.isActive === true)
    );
  }

  /*
   * ============================================================
   * collectAllIds() EQUIVALENT
   * ============================================================
   *
   * Original:
   *
   * const allIds = [user._id];
   *
   * while (...) {
   *   User.find({ parent: { $in: currentLevelIds } })
   * }
   *
   * Here we already have the entire tree in memory.
   *
   * IMPORTANT:
   * This includes inactive descendants exactly like the
   * original collectAllIds().
   */

  const allDescendantsCache = new Map();

  function getAllDescendants(currentUserId) {
    const key = String(currentUserId);

    if (allDescendantsCache.has(key)) {
      return allDescendantsCache.get(key);
    }

    const result = [];
    const queue = [key];
    const visited = new Set([key]);

    while (queue.length > 0) {
      const currentId = queue.shift();

      const children =
        childrenMap.get(String(currentId)) || [];

      for (const child of children) {
        const childId = String(child._id);

        if (visited.has(childId)) {
          continue;
        }

        visited.add(childId);
        result.push(child);
        queue.push(childId);
      }
    }

    allDescendantsCache.set(key, result);

    return result;
  }

  /*
   * ============================================================
   * ACTIVE DESCENDANTS
   * ============================================================
   *
   * Equivalent to:
   *
   * const allIds = await collectAllIds(user);
   *
   * User.find({
   *   parent: { $in: allIds },
   *   isActive: true
   * })
   *
   * Since allIds contains every descendant, this becomes all
   * active descendants of the current user.
   */

  const activeDescendantsCache = new Map();

  function getActiveDescendants(currentUserId) {
    const key = String(currentUserId);

    if (activeDescendantsCache.has(key)) {
      return activeDescendantsCache.get(key);
    }

    const descendants = getAllDescendants(currentUserId);

    const activeDescendants = descendants.filter(
      (user) => user.isActive === true
    );

    activeDescendantsCache.set(
      key,
      activeDescendants
    );

    return activeDescendants;
  }

  /*
   * ============================================================
   * DISPLAYED EXPOSURE
   * ============================================================
   *
   * This intentionally preserves the OLD behavior.
   *
   * USER:
   *   own exposure only
   *
   * NON USER:
   *   sum displayed exposure of ACTIVE children
   *
   * Notice that inactive users stop the exposure traversal.
   * This matches the old recursive DB implementation.
   */

  const displayedExposureCache = new Map();

  function getDisplayedExposureSync(currentUser) {
    const key = String(currentUser._id);

    if (displayedExposureCache.has(key)) {
      return displayedExposureCache.get(key);
    }

    if (currentUser.role === "user") {
      const exposure =
        Number(currentUser.exp) || 0;

      displayedExposureCache.set(key, exposure);

      return exposure;
    }

    const activeChildren =
      activeChildrenMap.get(key) || [];

    let total = 0;

    for (const child of activeChildren) {
      total +=
        Number(getDisplayedExposureSync(child)) || 0;
    }

    displayedExposureCache.set(key, total);

    return total;
  }

  /*
   * ============================================================
   * HIERARCHY PARTNERSHIP VALUE
   * ============================================================
   *
   * Original behavior:
   *
   * current user's partnershipValue
   * +
   * parent partnershipValue
   * +
   * grandparent partnershipValue
   * ...
   *
   * STOP BEFORE OWNER.
   */

  const hierarchyPartnershipCache = new Map();

  function getHierarchyPartnershipValueSync(currentUser) {
    const key = String(currentUser._id);

    if (hierarchyPartnershipCache.has(key)) {
      return hierarchyPartnershipCache.get(key);
    }

    let totalPartnershipValue =
      Number(currentUser.partnershipValue || 0);

    let parentId = currentUser.parent
      ? currentUser.parent._id || currentUser.parent
      : null;

    while (parentId) {
      const parentKey = String(parentId);

      const parentUser = userMap.get(parentKey);

      if (!parentUser) {
        break;
      }

      if (parentUser.role === "owner") {
        break;
      }

      totalPartnershipValue +=
        Number(parentUser.partnershipValue || 0);

      parentId = parentUser.parent
        ? parentUser.parent._id || parentUser.parent
        : null;
    }

    hierarchyPartnershipCache.set(
      key,
      totalPartnershipValue
    );

    return totalPartnershipValue;
  }

  /*
   * ============================================================
   * MAIN QUERIES
   * ============================================================
   */

  const [
    users,
    totalRecords,
    activeResult,
    deactiveResult,
    directUsersForBalance,
  ] = await Promise.all([
    User.find(paginationFilter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),

    User.countDocuments(paginationFilter),

    User.aggregate([
      {
        $match: activeFilter,
      },
      {
        $group: {
          _id: null,

          totalCreditReference: {
            $sum: {
              $convert: {
                input: "$userCR",
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
          },

          totalBalance: {
            $sum: {
              $convert: {
                input: "$balance",
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
          },

          totalExposure: {
            $sum: {
              $convert: {
                input: "$exp",
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
          },

          totalExposureLimit: {
            $sum: {
              $convert: {
                input: "$exp_limit",
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
          },

          totalPartnershipValue: {
            $sum: {
              $convert: {
                input: "$partnershipValue",
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
          },
        },
      },
    ]),

    User.aggregate([
      {
        $match: deactiveFilter,
      },
      {
        $group: {
          _id: null,

          totalCreditReference: {
            $sum: {
              $convert: {
                input: "$userCR",
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
          },

          totalBalance: {
            $sum: {
              $convert: {
                input: "$balance",
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
          },

          totalExposure: {
            $sum: {
              $convert: {
                input: "$exp",
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
          },

          totalExposureLimit: {
            $sum: {
              $convert: {
                input: "$exp_limit",
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
          },

          totalPartnershipValue: {
            $sum: {
              $convert: {
                input: "$partnershipValue",
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
          },
        },
      },
    ]),

    /*
     * Instead of two queries:
     *
     * activeUsersForBalance
     * deactiveUsersForBalance
     *
     * load all direct active users once.
     */
    User.find(baseFilter)
      .select(
        "_id role balance userCR partnershipValue parent exp isActive userLock"
      )
      .lean(),
  ]);

  /*
   * ============================================================
   * PARTNER USER
   * ============================================================
   */

  let partnerUser = hierarchyRoot
    ? {
        _id: hierarchyRoot._id,
        username: hierarchyRoot.username,
        role: hierarchyRoot.role,
        parent: hierarchyRoot.parent,
      }
    : null;

  /*
   * ============================================================
   * RESTORE POPULATED PARENT SHAPE
   * ============================================================
   *
   * Frontend still receives:
   *
   * parent: {
   *   _id,
   *   username
   * }
   *
   * exactly like populate("parent", "_id username").
   */

  if (partnerUser) {
    for (const user of users) {
      if (
        user.parent &&
        String(user.parent) === String(partnerUser._id)
      ) {
        user.parent = {
          _id: partnerUser._id,
          username: partnerUser.username,
        };
      }
    }
  }

  /*
   * ============================================================
   * ACTIVE BALANCE CALCULATIONS
   * ============================================================
   */

  const activeUsersForBalance =
    directUsersForBalance.filter(
      (user) => user.userLock === false
    );

  const deactiveUsersForBalance =
    directUsersForBalance.filter(
      (user) => user.userLock === true
    );

  function calculateBalanceValues(currentUser) {
    const ownBalance =
      Number(currentUser.balance) || 0;

    /*
     * NON-HIERARCHY ROLE
     *
     * Exact old behavior.
     */
    if (
      !balanceHierarchyRoles.includes(
        currentUser.role
      )
    ) {
      const clientPl =
        ownBalance -
        (Number(currentUser.userCR) || 0);

      return {
        displayBalance: ownBalance,

        clientPl,

        clientPercentagePL:
          clientPl *
          ((Number(currentUser.partnershipValue) || 0) /
            100),

        displayExposure:
          Number(currentUser.exp) || 0,
      };
    }

    /*
     * HIERARCHY ROLE
     */

    const childUsers =
      getActiveDescendants(currentUser._id);

    const usersTotal =
      childUsers.reduce(
        (total, user) =>
          total +
          (Number(user.balance) || 0),
        0
      );

    const displayBalance =
      ownBalance + usersTotal;

    const clientPl =
      displayBalance -
      (Number(currentUser.userCR) || 0);

    const hierarchyPartnershipValue =
      getHierarchyPartnershipValueSync(
        currentUser
      );

    const clientPercentagePL =
      clientPl *
      (hierarchyPartnershipValue / 100);

    const displayExposure =
      getDisplayedExposureSync(currentUser);

    return {
      displayBalance,
      clientPl,
      clientPercentagePL,
      displayExposure,
    };
  }

  /*
   * Calculate both active and deactive values.
   *
   * All hierarchy calculations now use memory.
   */

  const activeBalanceValues =
    activeUsersForBalance.map(
      calculateBalanceValues
    );

  const activeDisplayBalance =
    activeBalanceValues.reduce(
      (total, item) =>
        total + item.displayBalance,
      0
    );

  const activeClientPl =
    activeBalanceValues.reduce(
      (total, item) =>
        total + item.clientPl,
      0
    );

  const activeClientPercentagePL =
    activeBalanceValues.reduce(
      (total, item) =>
        total +
        (Number(item.clientPercentagePL) || 0),
      0
    );

  const activeDisplayExposure =
    activeBalanceValues.reduce(
      (total, item) =>
        total +
        (Number(item.displayExposure) || 0),
      0
    );

  /*
   * ============================================================
   * DEACTIVE
   * ============================================================
   */

  const deactiveBalanceValues =
    deactiveUsersForBalance.map(
      calculateBalanceValues
    );

  const deactiveDisplayBalance =
    deactiveBalanceValues.reduce(
      (total, item) =>
        total + item.displayBalance,
      0
    );

  const deactiveClientPl =
    deactiveBalanceValues.reduce(
      (total, item) =>
        total + item.clientPl,
      0
    );

  const deactiveClientPercentagePL =
    deactiveBalanceValues.reduce(
      (total, item) =>
        total +
        (Number(item.clientPercentagePL) || 0),
      0
    );

  const deactiveDisplayExposure =
    deactiveBalanceValues.reduce(
      (total, item) =>
        total +
        (Number(item.displayExposure) || 0),
      0
    );

  /*
   * ============================================================
   * RAW AGGREGATE VALUES
   * ============================================================
   */

  const activeCreditReference = Number(
    activeResult?.[0]?.totalCreditReference || 0
  );

  const activeBalance = Number(
    activeResult?.[0]?.totalBalance || 0
  );

  const activeExposure = Number(
    activeResult?.[0]?.totalExposure || 0
  );

  const activeExposureLimit = Number(
    activeResult?.[0]?.totalExposureLimit || 0
  );

  const activePartnershipValue = Number(
    activeResult?.[0]?.totalPartnershipValue || 0
  );

  const deactiveCreditReference = Number(
    deactiveResult?.[0]?.totalCreditReference || 0
  );

  const deactiveBalance = Number(
    deactiveResult?.[0]?.totalBalance || 0
  );

  const deactiveExposure = Number(
    deactiveResult?.[0]?.totalExposure || 0
  );

  const deactiveExposureLimit = Number(
    deactiveResult?.[0]?.totalExposureLimit || 0
  );

  const deactivePartnershipValue = Number(
    deactiveResult?.[0]?.totalPartnershipValue || 0
  );

  /*
   * ============================================================
   * ALL DATA TOTALS
   * ============================================================
   *
   * RESPONSE STRUCTURE UNCHANGED.
   */

  const allDataTotals = {
    creditReference:
      activeCreditReference,

    balance:
      activeDisplayBalance,

    clientPl:
      activeClientPl,

    exposure:
      activeDisplayExposure,

    availableBalance:
      activeBalance + activeExposure,

    exposureLimit:
      activeExposureLimit,

    clientPercentagePL:
      activeClientPercentagePL,

    defaultPercentage: 0,

    deactiveCreditReference:
      deactiveCreditReference,

    deactiveBalance:
      deactiveDisplayBalance,

    deactiveClientPl:
      deactiveClientPl,

    deactiveExposure:
      deactiveDisplayExposure,

    deactiveAvailableBalance:
      deactiveBalance + deactiveExposure,

    deactiveExposureLimit:
      deactiveExposureLimit,

    deactiveClientPercentagePL:
      deactiveClientPercentagePL,

    deactiveDefaultPercentage: 0,
  };

  /*
   * ============================================================
   * EMPTY RESULT
   * ============================================================
   */

  if (!users || users.length === 0) {
    return {
      users: [],
      totalRecords,
      totalPages:
        Math.ceil(totalRecords / limitNum),
      allDataTotals,
    };
  }

  const totalPages =
    Math.ceil(totalRecords / limitNum);

  /*
   * ============================================================
   * PARTNER TOTAL SHARE
   * ============================================================
   */

  let partnerTotalShare = 100;

  if (
    partnerUser &&
    partnerUser.role !== "owner" &&
    partnerUser.parent
  ) {
    const partnerPartnership =
      await partnershipModel
        .findOne({
          userId: partnerUser._id,
          partnerId: partnerUser.parent,
        })
        .lean();

    if (partnerPartnership) {
      partnerTotalShare =
        partnerPartnership.downLineCommission;
    }
  }

  /*
   * ============================================================
   * USER IDS
   * ============================================================
   */

  const userIds = users.map(
    (u) => u._id
  );

  /*
   * ============================================================
   * USER ACCESS
   * ============================================================
   */

  const userAccessList =
    await UserAccess.find({
      userId: { $in: userIds },
    })
      .select(
        "userId casino sport commission"
      )
      .lean();

  const userAccessMap = new Map(
    userAccessList.map((access) => [
      String(access.userId),
      {
        casino: access.casino,
        sport: access.sport,
        commission: access.commission,
      },
    ])
  );

  /*
   * ============================================================
   * PARTNERSHIPS
   * ============================================================
   */

  const parentIds = users
    .map((u) =>
      u.parent
        ? u.parent._id
        : null
    )
    .filter(Boolean);

  const orConditions = [];

  if (
    userIds.length &&
    parentIds.length
  ) {
    orConditions.push({
      $and: [
        {
          userId: {
            $in: userIds,
          },
        },
        {
          partnerId: {
            $in: parentIds,
          },
        },
      ],
    });
  }

  if (userIds.length) {
    orConditions.push({
      partnerId: {
        $in: userIds,
      },
    });
  }

  const partnerships =
    orConditions.length
      ? await partnershipModel
          .find({
            $or: orConditions,
          })
          .lean()
      : [];

  const uplineMap = new Map();

  partnerships.forEach((p) => {
    if (
      p.userId &&
      p.partnerId
    ) {
      uplineMap.set(
        `${String(p.userId)}|${String(
          p.partnerId
        )}`,
        p
      );
    }
  });

  /*
   * ============================================================
   * SEAT COUNTS
   * ============================================================
   */

  const seatCounts =
    await User.aggregate([
      {
        $match: {
          parent: {
            $in: userIds,
          },
          role: {
            $ne: "user",
          },
          isActive: true,
          userLock: false,
        },
      },
      {
        $group: {
          _id: "$parent",
          count: {
            $sum: 1,
          },
        },
      },
    ]);

  const seatMap = new Map();

  seatCounts.forEach((s) =>
    seatMap.set(
      String(s._id),
      s.count
    )
  );

  /*
   * ============================================================
   * FINAL USER DATA
   * ============================================================
   */

  const usersWithParts =
    users.map((user) => {
      /*
       * --------------------------------------------------------
       * Partnership entry
       * --------------------------------------------------------
       */

      const key = user.parent
        ? `${String(user._id)}|${String(
            user.parent._id
          )}`
        : null;

      const partnershipEntry = key
        ? uplineMap.get(key) || null
        : null;

      /*
       * --------------------------------------------------------
       * User share
       * --------------------------------------------------------
       */

      let userShare =
        partnershipEntry?.downLineCommission ??
        0;

      if (
        typeof userShare !==
        "number"
      ) {
        userShare =
          Number(userShare) || 0;
      }

      /*
       * --------------------------------------------------------
       * Clamp 0-100
       * --------------------------------------------------------
       */

      if (userShare < 0) {
        userShare = 0;
      }

      if (userShare > 100) {
        userShare = 100;
      }

      const userPartPercent =
        Math.round(
          userShare * 100
        ) / 100;

      const partnerPartPercent =
        Math.max(
          0,
          Math.round(
            (100 - userShare) *
              100
          ) / 100
        );

      /*
       * --------------------------------------------------------
       * ALL ACTIVE DESCENDANTS
       * --------------------------------------------------------
       */

      const childUsers =
        getActiveDescendants(
          user._id
        );

      /*
       * --------------------------------------------------------
       * Descendant balance
       * --------------------------------------------------------
       */

      const usersTotal =
        childUsers.reduce(
          (total, child) =>
            total +
            (Number(child.balance) || 0),
          0
        );

      /*
       * --------------------------------------------------------
       * Exposure
       * --------------------------------------------------------
       */

      const usersExposureTotal =
        getDisplayedExposureSync(
          user
        );

      /*
       * --------------------------------------------------------
       * Players
       * --------------------------------------------------------
       */

      const players =
        childUsers.filter(
          (u) =>
            u.role === "user"
        );

      if (
        user.role === "user"
      ) {
        players.push(user);
      }

      /*
       * --------------------------------------------------------
       * Total player PTS
       * --------------------------------------------------------
       */

      const totalPlayerPts =
        players.reduce(
          (total, player) =>
            total +
            (Number(player.balance) || 0),
          0
        );

      /*
       * --------------------------------------------------------
       * Original balance
       * --------------------------------------------------------
       */

      const originalBalance =
        Number(user.balance) || 0;

      /*
       * --------------------------------------------------------
       * Display balance
       * --------------------------------------------------------
       */

      const displayBalance =
        balanceHierarchyRoles.includes(
          user.role
        )
          ? originalBalance +
            usersTotal
          : originalBalance;

      /*
       * --------------------------------------------------------
       * Total Player CR
       *
       * Kept because it exists in the original business logic,
       * even though it isn't returned.
       * --------------------------------------------------------
       */

      const totalPlayerCR =
        players.reduce(
          (total, player) =>
            total +
            (Number(player.userCR) || 0),
          0
        );

      /*
       * --------------------------------------------------------
       * Own client PL
       * --------------------------------------------------------
       */

      const ownClientPl =
        (Number(user.balance) || 0) -
        (Number(user.userCR) || 0);

      /*
       * --------------------------------------------------------
       * Descendants PL
       * --------------------------------------------------------
       */

      const descendantsClientPl =
        childUsers.reduce(
          (total, child) => {
            const childBalance =
              Number(child.balance) || 0;

            const childCreditReference =
              Number(child.userCR) || 0;

            return (
              total +
              (childBalance -
                childCreditReference)
            );
          },
          0
        );

      /*
       * --------------------------------------------------------
       * Total PTS
       * --------------------------------------------------------
       */

      const totalPts =
        usersTotal +
        (Number(user.balance) || 0);

      /*
       * --------------------------------------------------------
       * Client PL
       * --------------------------------------------------------
       */

      let clientPl;

      if (
        balanceHierarchyRoles.includes(
          user.role
        )
      ) {
        clientPl =
          displayBalance -
          (Number(user.userCR) || 0);
      } else {
        clientPl =
          originalBalance -
          (Number(user.userCR) || 0);
      }

      /*
       * --------------------------------------------------------
       * Hierarchy partnership value
       * --------------------------------------------------------
       */

      const hierarchyPartnershipValue =
        getHierarchyPartnershipValueSync(
          user
        );

      const clientPercentagePL =
        clientPl *
        (hierarchyPartnershipValue /
          100);

      /*
       * --------------------------------------------------------
       * Client PL percent
       * --------------------------------------------------------
       */

      const clientPlPercent =
        user.role === "user"
          ? "-"
          : Number(
              user.partnershipValue ||
                0
            );

      /*
       * --------------------------------------------------------
       * Access
       * --------------------------------------------------------
       */

      const access =
        userAccessMap.get(
          String(user._id)
        );

      /*
       * --------------------------------------------------------
       * FINAL OBJECT
       *
       * EXACT SAME RESPONSE FIELDS.
       * --------------------------------------------------------
       */

      return {
        ...user,

        balance:
          displayBalance,

        exp:
          user.role === "user"
            ? Number(user.exp) || 0
            : usersExposureTotal,

        availableBal:
          originalBalance,

        casino:
          access?.casino ?? true,

        sport:
          access?.sport ?? true,

        commissionvalue:
          access?.commission ?? true,

        exp_limit:
          Number(
            user.exp_limit ?? 0
          ),

        usedSeats:
          seatMap.get(
            String(user._id)
          ) || 0,

        commission:
          userShare,

        userPartPercent,

        partnerPartPercent,

        totalPts,

        clientPl,

        clientPlPercent,

        clientPercentagePL,

        pnr:
          partnerPartPercent,
      };
    });

  /*
   * ============================================================
   * FINAL RESPONSE
   * ============================================================
   */

  return {
    users: usersWithParts,
    totalRecords,
    totalPages,
    allDataTotals,
  };
}



async function bindUserDepositKey(users) {
  const userIds = users.map((u) => u._id);
  const crTotals = await transactionModel.aggregate([
    { $match: { userId: { $in: userIds }, type: "deposit" } },
    {
      $group: {
        _id: "$userId",
        totalCR: { $sum: "$amount" },
      },
    },
  ]);
  const crMap = crTotals.reduce((acc, t) => {
    acc[t._id.toString()] = t.totalCR;
    return acc;
  }, {});

  return users.map((u) => {
    const user = u;
    delete user.password;
    delete user.__v;
    delete user.transaction_pin;
    return {
      ...user,
      cr: crMap[u._id.toString()] || 0,
    };
  });
}

async function updateUser(id, update) {
  return User.findByIdAndUpdate(id, update, { new: true });
}

async function getParentHierarchy(userId) {
  const path = [];
  let current = await getUserById(userId);
  while (current && current.parent) {
    const parentUser = await getUserById(current.parent);
    if (!parentUser) break;
    path.unshift(parentUser.username);
    current = parentUser;
  }
  return path;
}

async function getChildHierarchy(userId) {
  const result = [];
  async function getChildren(id) {
    const children = await User.find({ parent: id, isActive: true });
    for (const child of children) {
      result.push(child.username);
      await getChildren(child._id);
    }
  }
  await getChildren(userId);
  return result;
}

async function getNestedChildren(userId) {
  const children = await User.find({ parent: userId, isActive: true });
  const result = [];

  for (const child of children) {
    const nested = await getNestedChildren(child._id);
    result.push({
      username: child.username,
      role: child.role,
      _id: child._id,
      children: nested.length > 0 ? nested : [],
    });
  }

  return result;
}
const updateUserLockRecursively = async (userId, body) => {
  await User.updateOne({ _id: userId }, { $set: body });

  const children = await User.find({ parent: userId, isActive: true });

  for (const child of children) {
    await updateUserLockRecursively(child._id, body);
  }
};

async function getNestedChildrenData(userId) {
  const children = await User.find({ parent: userId, isActive: true });
  const result = [];

  for (const child of children) {
    const nested = await getNestedChildren(child._id);
    result.push({
      users: child.username,
      children: nested.length > 0 ? nested : [],
    });
  }

  return result;
}

async function getSingleUserPartnershipData(targetUserId) {
  const user = await User.findById(targetUserId)
    .populate("parent", "_id username role parent")
    .lean();
  if (!user) return null;

  let userShare = 0;

  if (user.role === "owner") {
    userShare = 100;
  } else if (user.parent) {
    const partnershipEntry = await partnershipModel
      .findOne({
        userId: user._id,
        partnerId: user.parent._id,
      })
      .lean();

    if (partnershipEntry) {
      userShare = Number(partnershipEntry.downLineCommission) || 0;
    }
  }

  // clamp to sensible range 0..100
  if (userShare < 0) userShare = 0;
  if (userShare > 100) userShare = 100;

  const userPartPercent = Math.round(userShare * 100) / 100;
  const partnerPartPercent = Math.max(
    0,
    Math.round((100 - userShare) * 100) / 100,
  );

  // Fetch parent's total share to calculate margin
  let parentTotalShare = 100;
  if (user.parent && user.parent.role !== "owner" && user.parent.parent) {
    const parentPartnership = await partnershipModel
      .findOne({
        userId: user.parent._id,
        partnerId: user.parent.parent,
      })
      .lean();
    if (parentPartnership) {
      parentTotalShare = parentPartnership.downLineCommission;
    }
  }

  const allIds = await collectAllIds(user);
  const childUsers = await User.find({
    parent: { $in: allIds },
    isActive: true,
  }).lean();
  const usersTotal = childUsers.reduce(
    (t, u) => t + (Number(u.balance) || 0),
    0,
  );

  const players = childUsers.filter((u) => u.role === "user");
  if (user.role === "user") {
    players.push(user);
  }

  const totalPlayerPts = players.reduce(
    (t, u) => t + (Number(u.balance) || 0),
    0,
  );
  const totalPlayerCR = players.reduce(
    (t, u) => t + (Number(u.userCR) || 0),
    0,
  );

  const totalPts = usersTotal + (Number(user.balance) || 0);
  const clientPl = totalPlayerPts - totalPlayerCR;

  // Dynamic usedSeats for target user
  const usedSeats = await User.countDocuments({
    parent: user._id,
    role: { $ne: "user" },
    isActive: true,
    userLock: false,
  });

  const myMarginPercent = Math.max(0, parentTotalShare - userPartPercent);
  const clientPlPercent =
    user.role === "user"
      ? "-"
      : (clientPl * (myMarginPercent / 100)).toFixed(2);

  return {
    ...user,
    usedSeats,
    commission: userShare,
    userPartPercent,
    partnerPartPercent,
    totalPts: totalPts,
    clientPl,
    clientPlPercent,
    pnr: partnerPartPercent,
  };
}


const getUsersByPartnerIdWithUserLockShotx = async (
  partnerId,
  targetRole,
  search,
  page = 1,
  limit = 25,
  userLock = "false"
) => {
  const limitNum = parseInt(limit);
  const pageNum = parseInt(page);
  const skip = (pageNum - 1) * limitNum;

  const balanceHierarchyRoles = [
    "super-admin",
    "admin",
    "sub-admin",
    "super-master",
    "master",
  ];

  const selectedUserLock =
    userLock === true || userLock === "true";

  /*
   * ============================================================
   * LOAD PARTNER + ENTIRE HIERARCHY
   * ============================================================
   */

  const hierarchyResult = await User.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(partnerId),
      },
    },
    {
      $graphLookup: {
        from: User.collection.name,
        startWith: "$_id",
        connectFromField: "_id",
        connectToField: "parent",
        as: "descendants",
      },
    },
    {
      $graphLookup: {
        from: User.collection.name,
        startWith: "$parent",
        connectFromField: "parent",
        connectToField: "_id",
        as: "ancestors",
      },
    },
    {
      $project: {
        _id: 1,
        username: 1,
        role: 1,
        parent: 1,
        partnershipValue: 1,
        descendants: 1,
        ancestors: 1,
      },
    },
  ]);

  const hierarchyRoot = hierarchyResult[0] || null;

  /*
   * ============================================================
   * USER MAP
   * ============================================================
   */

  const userMap = new Map();

  if (hierarchyRoot) {
    userMap.set(
      String(hierarchyRoot._id),
      hierarchyRoot
    );

    for (const user of hierarchyRoot.descendants || []) {
      userMap.set(String(user._id), user);
    }

    for (const ancestor of hierarchyRoot.ancestors || []) {
      userMap.set(String(ancestor._id), ancestor);
    }
  }

  /*
   * ============================================================
   * CHILDREN MAP
   * ============================================================
   */

  const childrenMap = new Map();

  for (const user of hierarchyRoot?.descendants || []) {
    const parentId = user.parent
      ? String(user.parent)
      : null;

    if (!parentId) continue;

    if (!childrenMap.has(parentId)) {
      childrenMap.set(parentId, []);
    }

    childrenMap.get(parentId).push(user);
  }

  /*
   * ============================================================
   * ACTIVE CHILDREN MAP
   * ============================================================
   */

  const activeChildrenMap = new Map();

  for (const [parentId, children] of childrenMap.entries()) {
    activeChildrenMap.set(
      parentId,
      children.filter(
        (child) => child.isActive === true
      )
    );
  }

  /*
   * ============================================================
   * ALL DESCENDANTS
   * ============================================================
   */

  const allDescendantsCache = new Map();

  function getAllDescendants(currentUserId) {
    const key = String(currentUserId);

    if (allDescendantsCache.has(key)) {
      return allDescendantsCache.get(key);
    }

    const result = [];
    const queue = [key];
    const visited = new Set([key]);

    while (queue.length > 0) {
      const currentId = queue.shift();

      const children =
        childrenMap.get(String(currentId)) || [];

      for (const child of children) {
        const childId = String(child._id);

        if (visited.has(childId)) {
          continue;
        }

        visited.add(childId);
        result.push(child);
        queue.push(childId);
      }
    }

    allDescendantsCache.set(key, result);

    return result;
  }

  /*
   * ============================================================
   * ACTIVE DESCENDANTS
   * ============================================================
   */

  const activeDescendantsCache = new Map();

  function getActiveDescendants(currentUserId) {
    const key = String(currentUserId);

    if (activeDescendantsCache.has(key)) {
      return activeDescendantsCache.get(key);
    }

    const descendants =
      getAllDescendants(currentUserId);

    const activeDescendants =
      descendants.filter(
        (user) => user.isActive === true
      );

    activeDescendantsCache.set(
      key,
      activeDescendants
    );

    return activeDescendants;
  }

  /*
   * ============================================================
   * DISPLAYED EXPOSURE
   * ============================================================
   */

  const displayedExposureCache = new Map();

  function getDisplayedExposureSync(currentUser) {
    const key = String(currentUser._id);

    if (displayedExposureCache.has(key)) {
      return displayedExposureCache.get(key);
    }

    if (currentUser.role === "user") {
      const exposure =
        Number(currentUser.exp) || 0;

      displayedExposureCache.set(key, exposure);

      return exposure;
    }

    const activeChildren =
      activeChildrenMap.get(key) || [];

    let total = 0;

    for (const child of activeChildren) {
      total +=
        Number(
          getDisplayedExposureSync(child)
        ) || 0;
    }

    displayedExposureCache.set(key, total);

    return total;
  }

  /*
   * ============================================================
   * HIERARCHY PARTNERSHIP VALUE
   * ============================================================
   */

  const hierarchyPartnershipCache = new Map();

  function getHierarchyPartnershipValueSync(currentUser) {
    const key = String(currentUser._id);

    if (hierarchyPartnershipCache.has(key)) {
      return hierarchyPartnershipCache.get(key);
    }

    let totalPartnershipValue =
      Number(currentUser.partnershipValue || 0);

    let parentId = currentUser.parent
      ? currentUser.parent._id || currentUser.parent
      : null;

    while (parentId) {
      const parentKey = String(parentId);

      const parentUser =
        userMap.get(parentKey);

      if (!parentUser) {
        break;
      }

      if (parentUser.role === "owner") {
        break;
      }

      totalPartnershipValue +=
        Number(parentUser.partnershipValue || 0);

      parentId = parentUser.parent
        ? parentUser.parent._id ||
          parentUser.parent
        : null;
    }

    hierarchyPartnershipCache.set(
      key,
      totalPartnershipValue
    );

    return totalPartnershipValue;
  }

  /*
   * ============================================================
   * TARGET ROLE USERS
   *
   * IMPORTANT:
   * We are NOT using:
   *
   * parent: partnerId
   *
   * anymore.
   *
   * We take the ENTIRE subtree of partnerId and then
   * select only users having targetRole.
   * ============================================================
   */

  let targetUsers =
    hierarchyRoot?.descendants?.filter(
      (user) =>
        user.role === targetRole &&
        user.isActive === true &&
        user.userLock === selectedUserLock
    ) || [];

  /*
   * ============================================================
   * SEARCH
   * ============================================================
   */

  if (search && search.trim()) {
    const regex = new RegExp(search.trim(), "i");

    targetUsers = targetUsers.filter(
      (user) =>
        regex.test(user.username || "") ||
        regex.test(user.phone || "") ||
        regex.test(user.name || "") ||
        regex.test(user.role || "")
    );
  }

  /*
   * ============================================================
   * TOTAL RECORDS + PAGINATION
   * ============================================================
   */

  const totalRecords = targetUsers.length;

  const totalPages =
    Math.ceil(totalRecords / limitNum);

  const users = targetUsers
    .sort(
      (a, b) =>
        new Date(b.createdAt || 0) -
        new Date(a.createdAt || 0)
    )
    .slice(skip, skip + limitNum);

  /*
   * ============================================================
   * ACTIVE / DEACTIVE TARGET ROLE USERS
   * ============================================================
   *
   * These totals are now based on ALL matching targetRole
   * users inside the accessible hierarchy, not just direct
   * children.
   * ============================================================
   */

  const allTargetUsers =
    hierarchyRoot?.descendants?.filter(
      (user) =>
        user.role === targetRole
    ) || [];

  const activeTargetUsers =
    allTargetUsers.filter(
      (user) =>
        user.isActive === true &&
        user.userLock === false
    );

  const deactiveTargetUsers =
    allTargetUsers.filter(
      (user) =>
        user.isActive === true &&
        user.userLock === true
    );

  /*
   * ============================================================
   * BALANCE CALCULATION
   * ============================================================
   */

  function calculateBalanceValues(currentUser) {
    const ownBalance =
      Number(currentUser.balance) || 0;

    /*
     * NON-HIERARCHY ROLE
     */

    if (
      !balanceHierarchyRoles.includes(
        currentUser.role
      )
    ) {
      const clientPl =
        ownBalance -
        (Number(currentUser.userCR) || 0);

      return {
        displayBalance: ownBalance,

        clientPl,

        clientPercentagePL:
          clientPl *
          (
            (Number(
              currentUser.partnershipValue
            ) || 0) / 100
          ),

        displayExposure:
          Number(currentUser.exp) || 0,
      };
    }

    /*
     * HIERARCHY ROLE
     *
     * Calculation is still hierarchy-wide.
     */

    const childUsers =
      getActiveDescendants(currentUser._id);

    const usersTotal =
      childUsers.reduce(
        (total, user) =>
          total +
          (Number(user.balance) || 0),
        0
      );

    const displayBalance =
      ownBalance + usersTotal;

    const clientPl =
      displayBalance -
      (Number(currentUser.userCR) || 0);

    const hierarchyPartnershipValue =
      getHierarchyPartnershipValueSync(
        currentUser
      );

    const clientPercentagePL =
      clientPl *
      (hierarchyPartnershipValue / 100);

    const displayExposure =
      getDisplayedExposureSync(
        currentUser
      );

    return {
      displayBalance,
      clientPl,
      clientPercentagePL,
      displayExposure,
    };
  }

  /*
   * ============================================================
   * ALL DATA TOTALS
   * ============================================================
   */

  const activeBalanceValues =
    activeTargetUsers.map(
      calculateBalanceValues
    );

  const activeDisplayBalance =
    activeBalanceValues.reduce(
      (total, item) =>
        total + item.displayBalance,
      0
    );

  const activeClientPl =
    activeBalanceValues.reduce(
      (total, item) =>
        total + item.clientPl,
      0
    );

  const activeClientPercentagePL =
    activeBalanceValues.reduce(
      (total, item) =>
        total +
        (Number(
          item.clientPercentagePL
        ) || 0),
      0
    );

  const activeDisplayExposure =
    activeBalanceValues.reduce(
      (total, item) =>
        total +
        (Number(
          item.displayExposure
        ) || 0),
      0
    );

  const deactiveBalanceValues =
    deactiveTargetUsers.map(
      calculateBalanceValues
    );

  const deactiveDisplayBalance =
    deactiveBalanceValues.reduce(
      (total, item) =>
        total + item.displayBalance,
      0
    );

  const deactiveClientPl =
    deactiveBalanceValues.reduce(
      (total, item) =>
        total + item.clientPl,
      0
    );

  const deactiveClientPercentagePL =
    deactiveBalanceValues.reduce(
      (total, item) =>
        total +
        (Number(
          item.clientPercentagePL
        ) || 0),
      0
    );

  const deactiveDisplayExposure =
    deactiveBalanceValues.reduce(
      (total, item) =>
        total +
        (Number(
          item.displayExposure
        ) || 0),
      0
    );

  const activeCreditReference =
    activeTargetUsers.reduce(
      (total, user) =>
        total +
        (Number(user.userCR) || 0),
      0
    );

  const activeBalance =
    activeTargetUsers.reduce(
      (total, user) =>
        total +
        (Number(user.balance) || 0),
      0
    );

  const activeExposure =
    activeTargetUsers.reduce(
      (total, user) =>
        total +
        (Number(user.exp) || 0),
      0
    );

  const activeExposureLimit =
    activeTargetUsers.reduce(
      (total, user) =>
        total +
        (Number(user.exp_limit) || 0),
      0
    );

  const activePartnershipValue =
    activeTargetUsers.reduce(
      (total, user) =>
        total +
        (Number(user.partnershipValue) || 0),
      0
    );

  const deactiveCreditReference =
    deactiveTargetUsers.reduce(
      (total, user) =>
        total +
        (Number(user.userCR) || 0),
      0
    );

  const deactiveBalance =
    deactiveTargetUsers.reduce(
      (total, user) =>
        total +
        (Number(user.balance) || 0),
      0
    );

  const deactiveExposure =
    deactiveTargetUsers.reduce(
      (total, user) =>
        total +
        (Number(user.exp) || 0),
      0
    );

  const deactiveExposureLimit =
    deactiveTargetUsers.reduce(
      (total, user) =>
        total +
        (Number(user.exp_limit) || 0),
      0
    );

  const deactivePartnershipValue =
    deactiveTargetUsers.reduce(
      (total, user) =>
        total +
        (Number(user.partnershipValue) || 0),
      0
    );

  const allDataTotals = {
    creditReference:
      activeCreditReference,

    balance:
      activeDisplayBalance,

    clientPl:
      activeClientPl,

    exposure:
      activeDisplayExposure,

    availableBalance:
      activeBalance + activeExposure,

    exposureLimit:
      activeExposureLimit,

    clientPercentagePL:
      activeClientPercentagePL,

    defaultPercentage: 0,

    deactiveCreditReference:
      deactiveCreditReference,

    deactiveBalance:
      deactiveDisplayBalance,

    deactiveClientPl:
      deactiveClientPl,

    deactiveExposure:
      deactiveDisplayExposure,

    deactiveAvailableBalance:
      deactiveBalance + deactiveExposure,

    deactiveExposureLimit:
      deactiveExposureLimit,

    deactiveClientPercentagePL:
      deactiveClientPercentagePL,

    deactiveDefaultPercentage: 0,
  };

  /*
   * ============================================================
   * EMPTY RESULT
   * ============================================================
   */

  if (!users || users.length === 0) {
    return {
      users: [],
      totalRecords,
      totalPages,
      allDataTotals,
    };
  }

  /*
   * ============================================================
   * PARTNER USER
   * ============================================================
   */

  const partnerUser = hierarchyRoot
    ? {
        _id: hierarchyRoot._id,
        username: hierarchyRoot.username,
        role: hierarchyRoot.role,
        parent: hierarchyRoot.parent,
      }
    : null;

  /*
   * ============================================================
   * USER IDS
   * ============================================================
   */

  const userIds = users.map(
    (u) => u._id
  );

  /*
   * ============================================================
   * USER ACCESS
   * ============================================================
   */

  const userAccessList =
    await UserAccess.find({
      userId: { $in: userIds },
    })
      .select(
        "userId casino sport commission"
      )
      .lean();

  const userAccessMap = new Map(
    userAccessList.map((access) => [
      String(access.userId),
      {
        casino: access.casino,
        sport: access.sport,
        commission: access.commission,
      },
    ])
  );

  /*
   * ============================================================
   * PARTNERSHIPS
   * ============================================================
   */

  const parentIds = users
    .map((u) =>
      u.parent
        ? u.parent._id || u.parent
        : null
    )
    .filter(Boolean);

  const orConditions = [];

  if (
    userIds.length &&
    parentIds.length
  ) {
    orConditions.push({
      $and: [
        {
          userId: {
            $in: userIds,
          },
        },
        {
          partnerId: {
            $in: parentIds,
          },
        },
      ],
    });
  }

  if (userIds.length) {
    orConditions.push({
      partnerId: {
        $in: userIds,
      },
    });
  }

  const partnerships =
    orConditions.length
      ? await partnershipModel
          .find({
            $or: orConditions,
          })
          .lean()
      : [];

  const uplineMap = new Map();

  partnerships.forEach((p) => {
    if (
      p.userId &&
      p.partnerId
    ) {
      uplineMap.set(
        `${String(p.userId)}|${String(
          p.partnerId
        )}`,
        p
      );
    }
  });

  /*
   * ============================================================
   * SEAT COUNTS
   * ============================================================
   */

  const seatCounts =
    await User.aggregate([
      {
        $match: {
          parent: {
            $in: userIds,
          },
          role: {
            $ne: "user",
          },
          isActive: true,
          userLock: false,
        },
      },
      {
        $group: {
          _id: "$parent",
          count: {
            $sum: 1,
          },
        },
      },
    ]);

  const seatMap = new Map();

  seatCounts.forEach((s) =>
    seatMap.set(
      String(s._id),
      s.count
    )
  );

  /*
   * ============================================================
   * FINAL USER DATA
   * ============================================================
   */

  const usersWithParts =
    users.map((user) => {
      /*
       * --------------------------------------------------------
       * Restore parent object
       * --------------------------------------------------------
       */

      const parentId = user.parent
        ? String(
            user.parent._id ||
            user.parent
          )
        : null;

      if (parentId) {
        const parentUser =
          userMap.get(parentId);

        if (parentUser) {
          user.parent = {
            _id: parentUser._id,
            username: parentUser.username,
          };
        }
      }

      /*
       * --------------------------------------------------------
       * Partnership entry
       * --------------------------------------------------------
       */

      const key = user.parent
        ? `${String(user._id)}|${String(
            user.parent._id
          )}`
        : null;

      const partnershipEntry = key
        ? uplineMap.get(key) || null
        : null;

      /*
       * --------------------------------------------------------
       * User share
       * --------------------------------------------------------
       */

      let userShare =
        partnershipEntry?.downLineCommission ??
        0;

      if (
        typeof userShare !==
        "number"
      ) {
        userShare =
          Number(userShare) || 0;
      }

      /*
       * --------------------------------------------------------
       * Clamp 0-100
       * --------------------------------------------------------
       */

      if (userShare < 0) {
        userShare = 0;
      }

      if (userShare > 100) {
        userShare = 100;
      }

      const userPartPercent =
        Math.round(
          userShare * 100
        ) / 100;

      const partnerPartPercent =
        Math.max(
          0,
          Math.round(
            (100 - userShare) *
              100
          ) / 100
        );

      /*
       * --------------------------------------------------------
       * ALL ACTIVE DESCENDANTS
       * --------------------------------------------------------
       */

      const childUsers =
        getActiveDescendants(
          user._id
        );

      /*
       * --------------------------------------------------------
       * Descendant balance
       * --------------------------------------------------------
       */

      const usersTotal =
        childUsers.reduce(
          (total, child) =>
            total +
            (Number(child.balance) || 0),
          0
        );

      /*
       * --------------------------------------------------------
       * Exposure
       * --------------------------------------------------------
       */

      const usersExposureTotal =
        getDisplayedExposureSync(
          user
        );

      /*
       * --------------------------------------------------------
       * Players
       * --------------------------------------------------------
       */

      const players =
        childUsers.filter(
          (u) =>
            u.role === "user"
        );

      if (
        user.role === "user"
      ) {
        players.push(user);
      }

      /*
       * --------------------------------------------------------
       * Total player PTS
       * --------------------------------------------------------
       */

      const totalPlayerPts =
        players.reduce(
          (total, player) =>
            total +
            (Number(player.balance) || 0),
          0
        );

      /*
       * --------------------------------------------------------
       * Original balance
       * --------------------------------------------------------
       */

      const originalBalance =
        Number(user.balance) || 0;

      /*
       * --------------------------------------------------------
       * Display balance
       * --------------------------------------------------------
       */

      const displayBalance =
        balanceHierarchyRoles.includes(
          user.role
        )
          ? originalBalance +
            usersTotal
          : originalBalance;

      /*
       * --------------------------------------------------------
       * Total Player CR
       * --------------------------------------------------------
       */

      const totalPlayerCR =
        players.reduce(
          (total, player) =>
            total +
            (Number(player.userCR) || 0),
          0
        );

      /*
       * --------------------------------------------------------
       * Own client PL
       * --------------------------------------------------------
       */

      const ownClientPl =
        (Number(user.balance) || 0) -
        (Number(user.userCR) || 0);

      /*
       * --------------------------------------------------------
       * Descendants PL
       * --------------------------------------------------------
       */

      const descendantsClientPl =
        childUsers.reduce(
          (total, child) => {
            const childBalance =
              Number(child.balance) || 0;

            const childCreditReference =
              Number(child.userCR) || 0;

            return (
              total +
              (
                childBalance -
                childCreditReference
              )
            );
          },
          0
        );

      /*
       * --------------------------------------------------------
       * Total PTS
       * --------------------------------------------------------
       */

      const totalPts =
        usersTotal +
        (Number(user.balance) || 0);

      /*
       * --------------------------------------------------------
       * Client PL
       * --------------------------------------------------------
       */

      let clientPl;

      if (
        balanceHierarchyRoles.includes(
          user.role
        )
      ) {
        clientPl =
          displayBalance -
          (Number(user.userCR) || 0);
      } else {
        clientPl =
          originalBalance -
          (Number(user.userCR) || 0);
      }

      /*
       * --------------------------------------------------------
       * Hierarchy partnership value
       * --------------------------------------------------------
       */

      const hierarchyPartnershipValue =
        getHierarchyPartnershipValueSync(
          user
        );

      const clientPercentagePL =
        clientPl *
        (hierarchyPartnershipValue / 100);

      /*
       * --------------------------------------------------------
       * Client PL percent
       * --------------------------------------------------------
       */

      const clientPlPercent =
        user.role === "user"
          ? "-"
          : Number(
              user.partnershipValue || 0
            );

      /*
       * --------------------------------------------------------
       * Access
       * --------------------------------------------------------
       */

      const access =
        userAccessMap.get(
          String(user._id)
        );

      /*
       * --------------------------------------------------------
       * FINAL OBJECT
       * --------------------------------------------------------
       */

      return {
        ...user,

        balance:
          displayBalance,

        exp:
          user.role === "user"
            ? Number(user.exp) || 0
            : usersExposureTotal,

        availableBal:
          originalBalance,

        casino:
          access?.casino ?? true,

        sport:
          access?.sport ?? true,

        commissionvalue:
          access?.commission ?? true,

        exp_limit:
          Number(
            user.exp_limit ?? 0
          ),

        usedSeats:
          seatMap.get(
            String(user._id)
          ) || 0,

        commission:
          userShare,

        userPartPercent,

        partnerPartPercent,

        totalPts,

        clientPl,

        clientPlPercent,

        clientPercentagePL,

        pnr:
          partnerPartPercent,
      };
    });

  /*
   * ============================================================
   * FINAL RESPONSE
   * ============================================================
   */

  return {
    users: usersWithParts,
    totalRecords,
    totalPages,
    allDataTotals,
  };
};




module.exports = {
  getUsersByPartnerIdWithUserLockShotx,
  User,
  getUser,
  getUserById,
  getAllUsers,
  updateUser,
  getUsersByPartnerId,
  bindUserDepositKey,
  getParentHierarchy,
  getChildHierarchy,
  getNestedChildren,
  deleteUser,
  updateUserLockRecursively,
  getSingleUserPartnershipData,
  getUsersByPartnerIdWithUserLock
};
