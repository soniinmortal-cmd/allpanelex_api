const axios = require("axios");
const httpStatus = require("http-status");

const APIResponse = require("../../helpers/APIResponse");

const {
  encryptPayload,
} = require("./softapi.crypto");

const SoftApiTransaction = require("./softapi.model");
const SoftApiGames = require('./softapiGames.model');

const {
  atomicUpdateUserFinance,
} = require("../../helpers/finance.helper");

const transactionModel = require(
  "../transaction/transaction.model"
);

const crypto = require("crypto");

const User = require("../users/users.model");
const softapiGamesModel = require("./softapiGames.model");

function pkcs7Unpad(buf) {
  const pad = buf[buf.length - 1];

  if (pad < 1 || pad > 16) {
    return buf;
  }

  return buf.subarray(0, buf.length - pad);
}

function aes256EcbDecrypt(b64, key32) {
  const raw = Buffer.from(b64, "base64");

  const decipher = crypto.createDecipheriv(
    "aes-256-ecb",
    Buffer.from(key32),
    null
  );

  decipher.setAutoPadding(false);

  const plain = Buffer.concat([
    decipher.update(raw),
    decipher.final(),
  ]);

  return pkcs7Unpad(plain).toString("utf8");
}

// const launchGame = async (req, res, next) => {
//   try {
//     console.log("\n");
//     console.log("======================================");
//     console.log("SOFTAPI LAUNCH REQUEST");
//     console.log("======================================");

//     let user = await User.findById(req.user._id);

//     if (!user) {
//       return res.status(httpStatus.NOT_FOUND).send(
//         new APIResponse(null, "User not found", httpStatus.NOT_FOUND)
//       );
//     }

//     // Generate SoftAPI ID only on first launch
//     if (!user.softApiId) {
//       let softApiId;
//       let exists;

//       do {
//         softApiId = String(
//           Math.floor(
//             1000000000 + Math.random() * 9000000000
//           )
//         ); // 10 digit numeric string

//         exists = await User.exists({
//           softApiId,
//         });
//       } while (exists);

//       user.softApiId = softApiId;
//       await user.save();

//       console.log(
//         "Generated SoftAPI ID:",
//         user.softApiId
//       );
//     }

//     console.log({
//       userId: user._id,
//       username: user.username,
//       softApiId: user.softApiId,
//       balance: user.balance,
//       game_uid: req.query.game_uid,
//     });

//     const payload = {
//       user_id: user.softApiId,
//       balance: user.balance,
//       game_uid: req.query.game_uid,

//       token: process.env.SOFTAPI_TOKEN,

//       timestamp: Date.now(),

//       return: process.env.SOFTAPI_RETURN_URL,

//       callback: process.env.SOFTAPI_CALLBACK_URL,

//       currency_code: "INR",

//       language: "en",
//     };

//     console.log(
//       "SOFTAPI PAYLOAD:",
//       JSON.stringify(payload, null, 2)
//     );

//     const encryptedPayload =
//       encryptPayload(payload);

//     console.log(
//       "SOFTAPI ENCRYPTED PAYLOAD:",
//       encryptedPayload
//     );

//     const response = await axios.get(
//       process.env.SOFTAPI_URL,
//       {
//         params: {
//           payload: encryptedPayload,
//           token: process.env.SOFTAPI_TOKEN,
//         },
//       }
//     );

//     console.log(
//       "SOFTAPI RESPONSE:",
//       JSON.stringify(response.data, null, 2)
//     );

//     return res.status(httpStatus.OK).send(
//       new APIResponse(
//         response.data?.data,
//         "Game launched",
//         httpStatus.OK
//       )
//     );
//   } catch (err) {
//     console.error(
//       "SOFTAPI LAUNCH ERROR:",
//       err?.response?.data || err
//     );

//     next(err);
//   }
// };


const launchGame = async (req, res, next) => {

  try {
    console.log("\n");
    console.log("======================================");
    console.log("SOFTAPI LAUNCH REQUEST");
    console.log("======================================");

    let user = await User.findById(req.user._id);

    if (!user) {
      return res.status(httpStatus.NOT_FOUND).send(
        new APIResponse(null, "User not found", httpStatus.NOT_FOUND)
      );
    }

    // Generate SoftAPI ID only on first launch
    if (!user.softApiId) {
      let softApiId;
      let exists;

      do {
        softApiId = String(
          Math.floor(
            1000000000 + Math.random() * 9000000000
          )
        ); // 10 digit numeric string

        exists = await User.exists({
          softApiId,
        });
      } while (exists);

      user.softApiId = softApiId;
      await user.save();

      console.log(
        "Generated SoftAPI ID:",
        user.softApiId
      );
    }

    console.log({
      userId: user._id,
      username: user.username,
      softApiId: user.softApiId,
      balance: user.balance,
      game_uid: req.query.game_uid,
    });

    const payload = {
      user_id: user.softApiId,
      balance: user.balance,
      game_uid: req.query.game_uid,

      token: process.env.NEXXAPI_TOKEN,

      timestamp: Date.now(),

      return: process.env.NEXXAPI_RETURN_URL,
      callback: process.env.NEXXAPI_CALLBACK_URL,

      currency_code: "INR",

      language: "en",
    };

    console.log(
      "SOFTAPI PAYLOAD:",
      JSON.stringify(payload, null, 2)
    );

    const encryptedPayload =
      encryptPayload(payload);

    console.log(
      "SOFTAPI ENCRYPTED PAYLOAD:",
      encryptedPayload
    );

    const response = await axios.post(
      process.env.NEXXAPI_URL || "https://api.nexxapi.tech/api/v1",
      {
        token: process.env.NEXXAPI_TOKEN,
        payload: encryptedPayload,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    console.log(
      "SOFTAPI RESPONSE:",
      JSON.stringify(response.data, null, 2)
    );

    return res.status(httpStatus.OK).send(
      new APIResponse(
        response.data?.data,
        "Game launched",
        httpStatus.OK
      )
    );
  } catch (err) {
    console.error(
      "SOFTAPI LAUNCH ERROR:",
      err?.response?.data || err
    );

    next(err);
  }
};

const getGames = async (req, res, next) => {
  try {
    console.log("======================================");
    console.log("SOFTAPI GAMES REQUEST");
    console.log("======================================");

    const {
      page = 1,
      limit = 50,
      search = "",
      brandId,
      category,
    } = req.query;

    const filter = {};

    if (search) {
      filter.gameName = {
        $regex: search,
        $options: "i",
      };
    }

    if (brandId) {
      filter.brandId = brandId;
    }

    if (category) {
      filter.category = category;
    }

    console.log("FILTER:", filter);

    const games = await softapiGamesModel.find(filter)
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();

    const total = await softapiGamesModel.countDocuments(filter);

    console.log(
      `Fetched ${games.length} games out of ${total}`
    );

    return res.status(httpStatus.OK).send(
      new APIResponse(
        {
          games,
          total,
          page: Number(page),
          limit: Number(limit),
        },
        "Games fetched successfully",
        httpStatus.OK
      )
    );
  } catch (err) {
    console.error(
      "SOFTAPI GET GAMES ERROR:",
      err
    );

    next(err);
  }
};

const getFeaturedGames = async (
  req,
  res,
  next
) => {
  try {
    console.log(
      "======================================"
    );
    console.log(
      "SOFTAPI FEATURED GAMES REQUEST"
    );
    console.log(
      "======================================"
    );

    const games =
      await softapiGamesModel
        .find({
          isFeatured: true,
        })
        .lean();

    console.log(
      `Fetched ${games.length} featured games`
    );

    return res.status(httpStatus.OK).send(
      new APIResponse(
        {
          games,
          total: games.length,
        },
        "Featured games fetched successfully",
        httpStatus.OK
      )
    );
  } catch (err) {
    console.error(
      "SOFTAPI GET FEATURED GAMES ERROR:",
      err
    );

    next(err);
  }
};

const getBrands = async (req, res, next) => {
  try {
    console.log("SOFTAPI BRANDS REQUEST");

    const brands =
      await softapiGamesModel.aggregate([
        {
          $group: {
            _id: "$brandId",

            brandTitle: {
              $first: "$brandTitle",
            },

            totalGames: {
              $sum: 1,
            },
          },
        },

        {
          $sort: {
            brandTitle: 1,
          },
        },
      ]);

    console.log(
      `Found ${brands.length} brands`
    );

    return res.status(httpStatus.OK).send(
      new APIResponse(
        brands,
        "Brands fetched successfully",
        httpStatus.OK
      )
    );
  } catch (err) {
    console.error(
      "SOFTAPI GET BRANDS ERROR:",
      err
    );

    next(err);
  }
};

// const callback = async (
//   req,
//   res,
//   next
// ) => {
//   const startTime = Date.now();
//   try {

//     console.log(
//       `CALLBACK CALLED +++++++++++`
//     );

//     console.log("SOFTAPI CALLBACK BODY:", JSON.stringify(req.body, null, 2));

//     let event = req.body;

//     // Decrypt encrypted SoftAPI callback
//     if (
//       event &&
//       typeof event.payload === "string" &&
//       event.payload
//     ) {
//       const secret = process.env.SOFTAPI_AES_KEY;

//       if (!secret) {
//         throw new Error(
//           "SOFTAPI_API_SECRET is not configured"
//         );
//       }

//       event = JSON.parse(
//         aes256EcbDecrypt(
//           event.payload,
//           secret
//         )
//       );

//       console.log(
//         "SOFTAPI DECRYPTED EVENT:",
//         JSON.stringify(event, null, 2)
//       );
//     }

//     const {
//       game_uid,
//       game_round,
//       member_account,
//       bet_amount,
//       win_amount,
//     } = event;

//     const user =
//         await User.findOne({
//             softApiId: member_account,
//         });

//     if (!user) {
//     console.log('user not found')
//       return res.status(404).json({
//         success: false,
//         message:
//           "User not found",
//       });
//     }


//     const creditAmountsoftapi =
//       Number(win_amount) -
//       Number(bet_amount);
    
//     console.log({
//         bet_amount,
//         win_amount,
//         creditAmountsoftapi,
//     });

//     const before =
//       user.balance;

//     const creditAmount = before + creditAmountsoftapi;

//     console.log(
//         "BALANCE BEFORE:",
//         before
//     );

//     const updatedUser =
//       await atomicUpdateUserFinance(
//         user._id,
//         {
//           balance:
//             creditAmountsoftapi,
//         }
//       );
    
//     console.log(
//         "BALANCE AFTER:",
//         updatedUser.balance
//     );

//     const responseTime =
//       Date.now() - startTime;

//     console.log(
//       `CALLBACK RESPONSE TIME: ${responseTime}ms`
//     );

//     setImmediate(async () => {
//       try {
//         await SoftApiTransaction.create({
//           game_uid,
//           game_round,
//           member_account,

//           bet_amount,
//           win_amount,

//           credit_amount:
//             creditAmountsoftapi,

//           processed: true,

//           rawPayload: req.body,
//         });


//         const game = await SoftApiGames.findOne(
//           { gameUid: game_uid },
//           { gameName: 1 }
//         ).lean();

//         const gameName = game?.gameName || game_uid;        

//         await transactionModel.create({
//           userId: updatedUser._id,

//           type: "softapi",

//           amount:
//             creditAmountsoftapi,

//           balanceBefore:
//             before,

//           balanceAfter:
//             updatedUser.balance,

//           status: "approved",

//           remarks:Number(bet_amount)>0?`${gameName} Bet - ${game_uid}`:`${gameName} Win - ${game_uid}`
//         });

//         console.log(
//           `BACKGROUND LOGGING DONE IN ${
//             Date.now() - startTime
//           }ms`
//         );
//       } catch (err) {
//         console.error(
//           "BACKGROUND LOGGING ERROR:",
//           err
//         );
//       }
//     });

//     return res.status(200).json({
//         credit_amount: creditAmount,
//         timestamp: Date.now(),
//     });

//   } catch (err) {
//     console.error(
//         "SOFTAPI CALLBACK ERROR:",
//         err?.message || err
//     );

//     console.error(err);
//     next(err);
//   }
// };

const callback = async (req, res, next) => {
  const startTime = Date.now();

  try {
    const {
      game_id,
      game_uid,
      game_round,
      member_account,
      bet_amount,
      win_amount,
      credit_amount,
      timestamp,
      serial_number,
      game_name,
    } = req.body;

    // Validate required callback fields
    if (
      !member_account ||
      !serial_number ||
      credit_amount === undefined ||
      credit_amount === null ||
      !Number.isFinite(Number(credit_amount)) ||
      !Number.isFinite(Number(bet_amount)) ||
      !Number.isFinite(Number(win_amount))
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid callback payload",
      });
    }

    // Find user using the existing SoftAPI ID field
    const user = await User.findOne({
      softApiId: String(member_account),
    });

    if (!user) {
      console.log("User not found:", member_account);

      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const serialNumber = String(serial_number);
    const authoritativeBalance = Number(credit_amount);
    const betAmount = Number(bet_amount);
    const winAmount = Number(win_amount);
    const netAmount = winAmount - betAmount;
    const before = user.balance;

    console.log("NEXXAPI CALLBACK:", {
      userId: user._id,
      username: user.username,
      game_uid,
      game_round,
      serial_number: serialNumber,
      bet_amount: betAmount,
      win_amount: winAmount,
      credit_amount: authoritativeBalance,
    });

    // Ignore callbacks that have already been processed
    const existingTransaction = await SoftApiTransaction.findOne({
      serial_number: serialNumber,
    }).lean();

    if (existingTransaction) {
      console.log(
        "Duplicate callback ignored:",
        serialNumber
      );

      return res.status(200).json({
        success: true,
        credit_amount: authoritativeBalance,
        timestamp: Date.now(),
      });
    }

    // Store the callback before applying its balance.
    // A unique index on serial_number is required.
    try {
      await SoftApiTransaction.create({
        game_id,
        game_uid,
        game_round,
        member_account: String(member_account),
        bet_amount: betAmount,
        win_amount: winAmount,
        credit_amount: authoritativeBalance,
        serial_number: serialNumber,
        timestamp,
        processed: false,
        rawPayload: req.body,
      });
    } catch (err) {
      if (err.code === 11000) {
        console.log(
          "Duplicate callback detected:",
          serialNumber
        );

        return res.status(200).json({
          success: true,
          credit_amount: authoritativeBalance,
          timestamp: Date.now(),
        });
      }

      throw err;
    }

    // NexxAPI sends the final balance after the round.
    // Do not add win_amount - bet_amount to the current balance.
    let updatedUser;

    try {
      updatedUser = await User.findByIdAndUpdate(
        user._id,
        {
          $set: {
            balance: authoritativeBalance,
          },
        },
        {
          new: true,
          runValidators: true,
        }
      );

      if (!updatedUser) {
        throw new Error("Failed to update user balance");
      }
    } catch (err) {
      // Keep the transaction record unprocessed for reconciliation.
      throw err;
    }

    console.log("BALANCE BEFORE:", before);
    console.log("BALANCE AFTER:", updatedUser.balance);

    // Acknowledge after the balance update; do not wait for logging.
    const responseTime = Date.now() - startTime;

    console.log(
      `CALLBACK RESPONSE TIME: ${responseTime}ms`
    );

    res.status(200).json({
      success: true,
      credit_amount: updatedUser.balance,
      timestamp: Date.now(),
    });

    // Background transaction logging
    setImmediate(async () => {
      try {
        const game = await SoftApiGames.findOne(
          { gameUid: game_uid },
          { gameName: 1 }
        ).lean();

        const gameName =
          game_name || game?.gameName || game_uid;

        await transactionModel.create({
          userId: updatedUser._id,
          type: "softapi",
          amount: netAmount,
          balanceBefore: before,
          balanceAfter: updatedUser.balance,
          status: "approved",
          remarks:
            betAmount > 0
              ? `${gameName} Bet - ${game_uid}`
              : `${gameName} Win - ${game_uid}`,
        });

        await SoftApiTransaction.updateOne(
          { serial_number: serialNumber },
          { $set: { processed: true } }
        );

        console.log(
          `BACKGROUND LOGGING DONE IN ${
            Date.now() - startTime
          }ms`
        );
      } catch (err) {
        console.error(
          "BACKGROUND LOGGING ERROR:",
          err
        );
      }
    });
  } catch (err) {
    console.error(
      "SOFTAPI CALLBACK ERROR:",
      err?.message || err
    );

    next(err);
  }
};


module.exports = {
  launchGame,
  callback,
  getBrands,
  getGames,
  getFeaturedGames
};