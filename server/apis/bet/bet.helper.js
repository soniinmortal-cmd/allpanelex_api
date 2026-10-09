const usersModel = require("../users/users.model");
const Bet = require("./bet.model");

async function createBet(data) {
  const bet = new Bet(data);
  return bet.save();
}

async function generateUniqueMarketId() {
  while (true) {
    const marketId = Math.floor(
      1000000000 + Math.random() * 9000000000
    ).toString();

    const exists = await Bet.exists({
      thirdPartyMarketId: marketId,
    });

    if (!exists) {
      return marketId;
    }
  }
}

async function getBets(filter = { isActive: true }, populateUser = false, pagination = null) {
  let query = Bet.find(filter).sort({ createdAt: -1 });

  if (pagination) {
    const { skip, limit } = pagination;
    if (limit > 0) {
      query = query.skip(skip).limit(limit);
    }
  }

  if (populateUser) {
    query = query.populate({
      path: "userId",
      select: "username balance",
    });
  }
  return query;
}
async function getBetsByMarketID(userId, marketId, sectionId) {
  return Bet.findOne({ userId, marketId, sectionId });
}
async function getBetById(id) {
  return Bet.findById(id);
}

async function updateBet(id, update, options = {}) {
  // CRITICAL: Filter by status: 'pending' to prevent double-settlement in standalone Mongo
  return Bet.findOneAndUpdate({ _id: id, status: "pending" }, update, { new: true, ...options });
}
async function collectAllIds(user) {
  const allIds = [user._id];
  let currentLevelIds = [user._id];

  while (currentLevelIds.length > 0) {
    const children = await usersModel.find({ parent: { $in: currentLevelIds } }, "_id");
    
    if (children.length === 0) {
      break;
    }

    const childIds = children.map(c => c._id);
    allIds.push(...childIds);
    currentLevelIds = childIds;
  }
  
  return allIds;
}

const betsGroupingByMarketIdAndUserId = async (
  marketId = false,
  inProcessMarket = []
 ) => {
  const match = {
    isActive: true,
    status: "pending",
    // Only process casino game bets (not sport match/fancy bets which have their own cron).
    // Previously used `subType: { $exists: true }` but that silently dropped casino bets
    // where subType was not set in the DB (e.g. poison bets placed without subType field).
    gType: {
      $nin: [
        "match", "match1", "fancy", "fancy1", "meter", "khado", "oddeven",
        "cricketcasino",
      ],
    },
  };

  if (marketId) {
    match.marketId = marketId;
  }

  if (Array.isArray(inProcessMarket) && inProcessMarket.length > 0) {
    const excludeConditions = inProcessMarket.map((m) => ({
      marketId: m._id,
      gType: m.gType,
    }));

    match.$nor = excludeConditions;
  }
  return await Bet.aggregate([
    {
      $match: match,
    },
    {
      $group: {
        _id: {
          marketId: "$marketId",
          userId: "$userId",
        },
        gType: { $first: "$gType" },
        bets: { $push: "$$ROOT" },
      },
    },
    {
      $group: {
        _id: "$_id.marketId",
        gType: { $first: "$gType" },
        users: {
          $push: {
            userId: "$_id.userId",
            bets: "$bets",
          },
        },
      },
    },
  ]);
};

const betsSportGroupingByMarketIdAndUserId = async (
  marketId = false,
  inProcessMarket = []
) => {
  const match = {
    isActive: true,
    status: "pending",
    cType: { $in: ["superover3", "superover", "superover2", "cricketv3"] },
  };

  // if (marketId) {
  //   match.gameId = marketId;
  // }
  if(!["superover3", "superover", "superover2", "cricketv3"].includes(match.cType))
{
  if (marketId) {
    match.gameId = marketId; 
  }
}else{
  if (marketId) {
    match.marketId = marketId;
  }
 ///=========mychange
}

  if (Array.isArray(inProcessMarket) && inProcessMarket.length > 0) {
    // const excludeConditions = inProcessMarket.map((m) => ({
    //   gameId: m._id,
    //   cType: m.cType,
    // }));

     const excludeConditions = inProcessMarket.map((m) => {
      const condition = {
        cType: m.cType,
      };

      if (["superover3", "superover", "superover2", "cricketv3"].includes(m.cType)) {
        condition.marketId = m._id;
      } else {
        condition.gameId = m._id;
      }
      return condition;
    });


    match.$nor = excludeConditions;
  }
  // return await Bet.aggregate([
  //   {
  //     $match: match,
  //   },
  //   {
  //     $group: {
  //       _id: {
  //         gameId: "$gameId",
  //         userId: "$userId",
  //       },
  //       cType: { $first: "$cType" },
  //       bets: { $push: "$$ROOT" },
  //     },
  //   },
  //   {
  //     $group: {
  //       _id: "$_id.gameId",
  //       cType: { $first: "$cType" },
  //       users: {
  //         $push: {
  //           userId: "$_id.userId",
  //           bets: "$bets",
  //         },
  //       },
  //     },
  //   },
  // ]);
  const isMarketIdGame =
  match?.cType &&
  ["superover3", "superover", "superover2", "cricketv3"].includes(match.cType);

const groupStages = isMarketIdGame
  ? [
      {
        $group: {
          _id: {
            marketId: "$marketId",
            userId: "$userId",
          },
          gameId: { $first: "$gameId" },
          cType: { $first: "$cType" },
          bets: { $push: "$$ROOT" },
        },
      },
      {
        $group: {
          _id: "$_id.marketId",
          gameId: { $first: "$gameId" },
          cType: { $first: "$cType" },
          users: {
            $push: {
              userId: "$_id.userId",
              bets: "$bets",
            },
          },
        },
      },
    ]
  : [
      {
        $group: {
          _id: {
            gameId: "$gameId",
            userId: "$userId",
          },
          cType: { $first: "$cType" },
          bets: { $push: "$$ROOT" },
        },
      },
      {
        $group: {
          _id: "$_id.gameId",
          cType: { $first: "$cType" },
          users: {
            $push: {
              userId: "$_id.userId",
              bets: "$bets",
            },
          },
        },
      },
    ];

return await Bet.aggregate([
  {
    $match: match,
  },
  ...groupStages,
]);
};

async function deleteManyBet(userId) {
  return Bet.deleteMany({ userId: userId });
}

async function findDuplicateBet({ delayTime, allIds }) {
  const duplicates = await Bet.aggregate([
    {
      $match: {
        isActive: true,
        userId: { $in: allIds },
        subType: { $exists: false },
      },
    },
    {
      $sort: {
        userId: 1,
        etid: 1,
        sectionId: 1,
        marketId: 1,
        gameId: 1,
        createdAt: 1,
      },
    },
    {
      $group: {
        _id: {
          userId: "$userId",
          etid: "$etid",
          sectionId: "$sectionId",
          marketId: "$marketId",
          gameId: "$gameId",
          winner: "$winner",
          ip: "$ip",
          domain: "$domain",
          browserDetails: "$browserDetails",
          status: "$status",
          gType: "$gType",
          sectionName: "$sectionName",
          marketName: "$marketName",
          eventName: "$eventName",
          amount: "$amount",
          uRate: "$uRate",
        },
        bets: {
          $push: {
            _id: "$_id",
            createdAt: "$createdAt",
            amount: "$amount",
            betType: "$betType",
          },
        },
      },
    },
    { $unwind: "$bets" },
    {
      $setWindowFields: {
        partitionBy: {
          userId: "$_id.userId",
          etid: "$_id.etid",
          sectionId: "$_id.sectionId",
          marketId: "$_id.marketId",
          gameId: "$_id.gameId",
        },
        sortBy: { "bets.createdAt": 1 },
        output: {
          prevCreatedAt: { $shift: { output: "$bets.createdAt", by: -1 } },
        },
      },
    },
    {
      $addFields: {
        timeDiffMs: { $subtract: ["$bets.createdAt", "$prevCreatedAt"] },
      },
    },
    {
      $addFields: {
        delayValue: {
          $switch: {
            branches: [
              { case: { $eq: ["$_id.gType", "match"] }, then: delayTime.match },
              {
                case: { $eq: ["$_id.gType", "match1"] },
                then: delayTime.match1,
              },
              { case: { $eq: ["$_id.gType", "fancy"] }, then: delayTime.fancy },
              {
                case: { $eq: ["$_id.gType", "fancy1"] },
                then: delayTime.fancy1,
              },
              { case: { $eq: ["$_id.gType", "khado"] }, then: delayTime.khado },
              {
                case: { $eq: ["$_id.gType", "oddeven"] },
                then: delayTime.oddeven,
              },
              {
                case: { $eq: ["$_id.gType", "cricketcasino"] },
                then: delayTime.cricketcasino,
              },
              { case: { $eq: ["$_id.gType", "meter"] }, then: delayTime.meter },
            ],
            default: 1000,
          },
        },
      },
    },
    {
      $match: {
        $expr: {
          $and: [
            { $gte: ["$timeDiffMs", 0] },
            { $lte: ["$timeDiffMs", "$delayValue"] },
          ],
        },
      },
    },
    {
      $group: {
        _id: "$_id",
        duplicateBets: { $push: "$bets" },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gte: 1 } } },
    {
      $lookup: {
        from: "users",
        localField: "_id.userId",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
    {
      $project: {
        _id: 1,
        duplicateBets: 1,
        count: 1,
        username: "$user.username",
      },
    },
  ]);
  return duplicates;
}
module.exports = {
  Bet,
  createBet,
  getBets,
  getBetById,
  updateBet,
  getBetsByMarketID,
  collectAllIds,
  betsGroupingByMarketIdAndUserId,
  betsSportGroupingByMarketIdAndUserId,
  deleteManyBet,
  findDuplicateBet,
  generateUniqueMarketId
};
