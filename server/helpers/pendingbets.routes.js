const mongoose = require("mongoose");
const express = require("express");
const router = express.Router();
const betModel = require("../apis/bet/bet.model");



const getCurrentBet = async (req, res, next) => {
  try {
    const matchQuery = {
      status: "pending",
      deleteBetStatus: { $ne: true },


      gType: { $nin: ["match1", "match"] },
    };

    const pipeline = [
      {
        $match: matchQuery,
      },

      {
        $lookup: {
          from: "users",
          let: {
            uid: "$userId",
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ["$_id", "$$uid"],
                },
              },
            },
            {
              $project: {
                _id: 1,
                name: 1,
                username: 1,
              },
            },
          ],
          as: "user",
        },
      },

      {
        $unwind: {
          path: "$user",
          preserveNullAndEmptyArrays: true,
        },
      },

      {
        $lookup: {
          from: "games",
          let: {
            currentGameId: {
              $toString: "$gameId",
            },
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $or: [
                    {
                      $eq: [
                        {
                          $toString: "$gmid",
                        },
                        "$$currentGameId",
                      ],
                    },
                    {
                      $eq: [
                        {
                          $toString: "$gameId",
                        },
                        "$$currentGameId",
                      ],
                    },
                  ],
                },
              },
            },

            {
              $project: {
                _id: 0,
                eventName: {
                  $ifNull: [
                    "$eventName",
                    {
                      $ifNull: [
                        "$ename",
                        {
                          $ifNull: [
                            "$name",
                            "$event",
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            },

            {
              $limit: 1,
            },
          ],
          as: "gameData",
        },
      },

      {
        $unwind: {
          path: "$gameData",
          preserveNullAndEmptyArrays: true,
        },
      },

      {
        $project: {
          _id: 1,
          userId: 1,
          betType: 1,
          marketId: 1,
          etid: 1,

          eventName: {
            $cond: [
              {
                $and: [
                  {
                    $ne: ["$eventName", null],
                  },
                  {
                    $ne: [
                      {
                        $trim: {
                          input: {
                            $ifNull: [
                              "$eventName",
                              "",
                            ],
                          },
                        },
                      },
                      "",
                    ],
                  },
                ],
              },

              "$eventName",

              {
                $ifNull: [
                  "$gameData.eventName",
                  "",
                ],
              },
            ],
          },

          marketName: 1,
          sectionName: 1,
          uRate: 1,
          bhav: 1,
          bsize: 1,
          lsize: 1,
          bRate: 1,
          lRate: 1,
          amount: 1,
          ip: 1,
          gameId: 1,
          gType: 1,
          isActive: 1,
          createdAt: 1,
          user: 1,
          betDate: "$createdAt",
        },
      },

      {
        $sort: {
          createdAt: -1,
        },
      },
    ];

    const bets = await betModel.aggregate(pipeline);
    return res.status(200).json({
        data: bets,
        total: bets.length,
        message: "Pending Bets fetched successfully",
    });
  } catch (err) {
    console.log(err, "err");
    next(err);
  }
};

router.get(
  "/",
 getCurrentBet
);

module.exports = router;