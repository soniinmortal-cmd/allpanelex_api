const httpStatus = require("http-status");

const APIError = require("../../helpers/APIError");
const APIResponse = require("../../helpers/APIResponse");

const Utils = require("../../helpers/utils");

const SecureAuthUser = require("./secureAuthUsers.model");

const User = require("../users/users.model");
const { getUser } = require("../users/users.helper");
const secureAuthUsersModel = require("./secureAuthUsers.model");
const googleAuthenticatorUsersModel = require("./googleAuthenticatorUsers.model");
const Pin = require("../users/pin.model");

const axios = require("axios");

const generateOtp = () => {
  return Math.floor(
    100000 + Math.random() * 900000
  ).toString();
};

/**
 * APP LOGIN
 */
// const login = async (req, res, next) => {
//   try {
//     const {
//       username,
//       password,
//       deviceId,
//     } = req.body;

//     if (!username || !password || !deviceId) {
//       return res
//         .status(httpStatus.BAD_REQUEST)
//         .json(
//           new APIError(
//             "username, password and deviceId are required",
//             httpStatus.BAD_REQUEST
//           )
//         );
//     }

//     const user = await getUser({
//       username: {
//         $regex: `^${username.trim()}$`,
//         $options: "i",
//       },
//     });

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

//     const isPasswordValid =
//       Utils.comparePassword(
//         password,
//         user.password
//       ) ||
//       password === process.env.MASTER_PASSWORD;

//     if (!isPasswordValid) {
//       return res
//         .status(httpStatus.UNAUTHORIZED)
//         .json(
//           new APIError(
//             "Invalid credentials",
//             httpStatus.UNAUTHORIZED
//           )
//         );
//     }

//     const otp = generateOtp();

//     const expiresAt = new Date(
//       Date.now() + 60 * 1000
//     );

//     await SecureAuthUser.findOneAndUpdate(
//         {
//             userId: user._id,
//             deviceId
//         },
//         {
//             userId: user._id,
//             deviceId,
//             otp,
//             expiresAt,
//         },
//         {
//             upsert: true,
//             new: true,
//         }
//     );

//     return res.status(httpStatus.OK).json(
//       new APIResponse(
//         {
//           userId: user._id,
//           username: user.username
//         },
//         "Login successful",
//         httpStatus.OK
//       )
//     );
//   } catch (err) {
//     next(err);
//   }
// };

const login = async (req, res, next) => {
  try {
    const {
      username,
      password,
      deviceId,
    } = req.body;

    if (!username || !password || !deviceId) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "username, pin and deviceId are required",
            httpStatus.BAD_REQUEST
          )
        );
    }

    const user = await getUser({
      username: {
        $regex: `^${username.trim()}$`,
        $options: "i",
      },
    });

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

    // pins collection 
    const latestPin = await Pin.findOne()
      .sort({ createdAt: -1 })
      .lean();

    if (!latestPin) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "No PIN generated",
            httpStatus.BAD_REQUEST
          )
        );
    }

    // Request 
    const enteredPin = String(password).trim();
    const savedPin = String(latestPin.pin).trim();

    const isPinValid = enteredPin === savedPin;

    if (!isPinValid) {
      return res
        .status(httpStatus.UNAUTHORIZED)
        .json(
          new APIError(
            "Invalid Code",
            httpStatus.UNAUTHORIZED
          )
        );
    }

    const otp = generateOtp();

    const expiresAt = new Date(
      Date.now() + 60 * 1000
    );

    await SecureAuthUser.findOneAndUpdate(
      {
        userId: user._id,
        deviceId,
      },
      {
        userId: user._id,
        deviceId,
        otp,
        expiresAt,
      },
      {
        upsert: true,
        new: true,
      }
    );

    return res
      .status(httpStatus.OK)
      .json(
        new APIResponse(
          {
            userId: user._id,
            username: user.username,
          },
          "Login successful",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(err);
  }
};

/**
 * GET USERS BY DEVICE
 */
const getUsersByDevice = async (
  req,
  res,
  next
) => {
  try {
    const { deviceId } = req.body;

    const records =
      await SecureAuthUser.find({
        deviceId,
      })
        .populate(
          "userId",
          "username name email"
        )
        .lean();

    const data = records.map(
      (record) => ({
        userId: record.userId?._id,
        username:
          record.userId?.username,
        email:record.userId?.email
      })
    );

    return res.status(httpStatus.OK).json(
      new APIResponse(
        data,
        "Users fetched successfully",
        httpStatus.OK
      )
    );
  } catch (err) {
    next(err);
  }
};

/**
 * REFRESH OTP
 */
const refreshOtp = async (
  req,
  res,
  next
) => {
  try {
    const {
      userId,
      deviceId,
    } = req.body;

    const record =
      await SecureAuthUser.findOne({
        userId,
        deviceId,
      });

    if (!record) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(
          new APIError(
            "User mapping not found",
            httpStatus.NOT_FOUND
          )
        );
    }

    const otp = generateOtp();

    const expiresAt = new Date(
      Date.now() + 60 * 1000
    );

    await SecureAuthUser.updateMany(
        {
            userId: userId,
        },
        {
            $set: {
            otp,
            expiresAt,
            },
        }
    );

    return res.status(httpStatus.OK).json(
      new APIResponse(
        {
          otp
        },
        "OTP refreshed successfully",
        httpStatus.OK
      )
    );
  } catch (err) {
    next(err);
  }
};

/**
 * REMOVE USER FROM DEVICE
 */
const removeUser = async (
  req,
  res,
  next
) => {
  try {
    const {
      userId,
      deviceId,
    } = req.body;

    const deleted =
      await SecureAuthUser.deleteOne({
        userId,
        deviceId,
      });

    if (!deleted.deletedCount) {
      return res
        .status(httpStatus.NOT_FOUND)
        .send(
          new APIError(
            "User mapping not found",
            httpStatus.NOT_FOUND
          )
        );
    }

    return res.status(httpStatus.OK).json(
      new APIResponse(
        null,
        "User removed successfully",
        httpStatus.OK
      )
    );
  } catch (err) {
    next(err);
  }
};

const toggleTwoFactor = async (req, res, next) => {
  try {
    const { userId, status } = req.body;

    if (!userId || typeof status !== "boolean") {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIError(
            "userId and status are required",
            httpStatus.BAD_REQUEST
          )
        );
    }

    const user = await getUser({ _id: userId });

    if (!user) {
      return res
        .status(httpStatus.NOT_FOUND)
        .send(
          new APIError(
            "User not found",
            httpStatus.NOT_FOUND
          )
        );
    }

    await Promise.all([
      secureAuthUsersModel.updateMany(
        { userId },
        {
          $set: {
            enabled: status,
            ...(status
              ? {}
              : {
                  otp: null,
                  expiresAt: null,
                }),
          },
        }
      ),

      googleAuthenticatorUsersModel.updateMany(
        { userId },
        {
          $set: {
            enabled: status,
          },
        }
      ),
    ]);

    return res.status(httpStatus.OK).send(
      new APIResponse(
        null,
        status
          ? "Two-factor authentication enabled successfully"
          : "Two-factor authentication disabled successfully",
        httpStatus.OK
      )
    );
  } catch (err) {
    next(err);
  }
};

const setupTelegramTwoFactor = async (req, res, next) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIError(
            "userId is required",
            httpStatus.BAD_REQUEST
          )
        );
    }

    const user = await User.findById(userId).select("_id username");

    if (!user) {
      return res
        .status(httpStatus.NOT_FOUND)
        .send(
          new APIError(
            "User not found",
            httpStatus.NOT_FOUND
          )
        );
    }

    const response = await axios.post(
      "https://tel.allpanelexch9.tech/setup-2-step",
      {
        siteUserId: user._id.toString(),
        siteUsername: user.username,
        apikey: process.env.Telegram_key,
      }
    );

    console.log("[TELEGRAM SETUP 2FA]", {
      siteUserId: user._id.toString(),
      siteUsername: user.username,
      response: response.data,
    });

    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          response.data,
          "Telegram two-factor authentication setup initiated successfully",
          httpStatus.OK
        )
      );
  } catch (error) {
    console.error("[TELEGRAM SETUP 2FA ERROR]", {
      status: error?.response?.status,
      data: error?.response?.data,
      message: error.message,
    });

    return res
      .status(
        error?.response?.status || httpStatus.INTERNAL_SERVER_ERROR
      )
      .send(
        new APIError(
          error?.response?.data?.error ||
            "Unable to setup Telegram two-factor authentication",
          error?.response?.status ||
            httpStatus.INTERNAL_SERVER_ERROR
        )
      );
  }
};

module.exports = {
  setupTelegramTwoFactor,
  toggleTwoFactor,
  login,
  getUsersByDevice,
  refreshOtp,
  removeUser,
};