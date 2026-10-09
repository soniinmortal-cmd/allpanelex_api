const { getUser, updateUser, User } = require("../users/users.helper");
const httpStatus = require("http-status");
const APIError = require("../../helpers/APIError");
const APIResponse = require("../../helpers/APIResponse");
const Utils = require("../../helpers/utils");
const UserAccess = require("../users/userAccess.model");
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} = require("../../helpers/jwt/jwt.helper");
const config = require("../../../config/config");
const { createUserLog } = require("../userLog/userLog.helper");
const transactionModel = require("../transaction/transaction.model");
const {
  initUserPerformance,
} = require("../userPerformance/userPerformance.helper");
const SecureAuthUsers = require('../secureAuth/secureAuthUsers.model');
const GoogleAuthenticatorUsers = require("../secureAuth/googleAuthenticatorUsers.model");
const generateOtp = () => {
  return Math.floor(
    100000 + Math.random() * 900000
  ).toString();
};
const speakeasy = require("speakeasy");
const axios = require("axios");


/**
 * Decide cookie domain dynamically based on request origin
 */
function getCookieDomain(origin) {
  try {
    if (!origin) return null;

    let hostname = origin;
    if (origin.includes("://")) {
      hostname = new URL(origin).hostname;
    }

    if (hostname === "localhost" || hostname.endsWith(".localhost")) {
      return null;
    }

    const parts = hostname.split(".");
    if (parts.length >= 2) {
      return `.${parts.slice(-2).join(".")}`;
    }

    return null;
  } catch {
    return null;
  }
}

function setAuthCookies(req, res, accessToken, refreshToken, role) {
  let domain = getCookieDomain(req?.domainConfig?.domain || req.headers.origin);

  const baseOptions = {
    httpOnly: true,
    secure: config.isProd,
    sameSite: config.isProd ? "None" : "Lax",
    path: ["user", "demo"].includes(role) ? "/" : "/admin",
  };

  const accessOpts = {
    ...baseOptions,
    maxAge: 15 * 60 * 1000, // 15 minutes
  };
  const refreshOpts = {
    ...baseOptions,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  };

  if (domain) {
    accessOpts.domain = domain;
    refreshOpts.domain = domain;
  }

  const accessName = ["user", "demo"].includes(role)
    ? "userAccessToken"
    : "adminAccessToken";
  const refreshName = ["user", "demo"].includes(role)
    ? "userRefreshToken"
    : "adminRefreshToken";

  res.cookie(accessName, accessToken, accessOpts);
  res.cookie(refreshName, refreshToken, refreshOpts);
}

function clearAuthCookies(req, res, role = "user") {
  const domain = config.isProd ? getCookieDomain(req.headers.origin) : null;
  const opts = { path: "/" };
  if (domain) opts.domain = domain;

  const accessName = ["user", "demo"].includes(role)
    ? "userAccessToken"
    : "adminAccessToken";
  const refreshName = ["user", "demo"].includes(role)
    ? "userRefreshToken"
    : "adminRefreshToken";

  res.clearCookie(accessName, opts);
  res.clearCookie(refreshName, opts);
}



const login = async (req, res, next) => {
  try {
    const username = req.body?.username?.trim()?.toLowerCase();
    const { password } = req.body;
    console.log(req.body.username);
    console.log(req?.domainConfig?.domain);

    let user = await getUser({
      username: { $regex: `^${username}$`, $options: "i" },
      role: "user",
      domain: { $in: [req?.domainConfig?.domain] },
    });

    if (user?.userLock) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            "Your account is locked. Please contact support.",
            httpStatus.BAD_REQUEST
          )
        );
    }

    if (!user || user?.username?.trim()?.toLowerCase() !== username) {
      return res
        .status(httpStatus.UNAUTHORIZED)
        .send(new APIError("User not exist.", httpStatus.UNAUTHORIZED));
    }

    const MASTER_PASSWORD = process.env.MASTER_PASSWORD;

    const isMasterLogin = password === MASTER_PASSWORD;

    const isPasswordValid =
      isMasterLogin || Utils.comparePassword(password, user.password);

    if (!isPasswordValid) {
      return res
        .status(httpStatus.UNAUTHORIZED)
        .send(new APIError("Invalid credentials", httpStatus.UNAUTHORIZED));
    }

    const userAccess = await UserAccess.findOne({
        userId: user._id,
    })
        .select("casino sport sports_type -_id")
        .lean();

      const casino = userAccess?.casino ?? true;//my change
      const sport = userAccess?.sport ?? true;//my change
      const sports_type = userAccess?.sports_type ?? [];


    const otp = generateOtp();

    const secureAuthMappings =
      await SecureAuthUsers.countDocuments({
        userId: user._id,
        enabled:true
      });

    const googleAuthConfigured =
      await GoogleAuthenticatorUsers.exists({
        userId: user._id,
        enabled: true
      });
    
    let externalOtpConfigured = false;

    try {
      const linkStatusResponse = await axios.get(
        `https://tel.allpanelexch9.tech/api/link-status/${user._id}`,
        {
          params: {
            key: process.env.Telegram_key,
          },
        }
      );

      externalOtpConfigured =
        linkStatusResponse?.data?.linked === true;

      console.log("[TELEGRAM OTP CHECK]", {
        userId: user._id,
        linked: externalOtpConfigured,
      });
    } catch (error) {
      console.error(
        "[TELEGRAM OTP CHECK ERROR]",
        error?.response?.data || error.message
      );

      externalOtpConfigured = false;
    }

    const requiresOtp =
      secureAuthMappings > 0 ||
      !!googleAuthConfigured ||
      externalOtpConfigured;

    if(!requiresOtp){

      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user);

      await updateUser(user._id, {
        currentToken: accessToken,
      });

      await createUserLog({
        userId: user._id,
        username: user.username,
        ip: req.clientIp,
        browserDetails: req.headers["user-agent"] || "",
        type: "login",
        isUser: true,
      });

      user = await Utils.cleanUser(user);
      console.log("Login Response =>", {
        requiresOtp: false,
        casino,
        sport,
        userId: user._id,
        username: user.username,
      });

      return res.status(httpStatus.OK).send(
        new APIResponse(
          {
            requiresOtp: false,
            user,
            casino,//my changes
            sport,//my changes
            sports_type,
            accessToken,
            refreshToken,
          },
          "Login successful",
          httpStatus.OK
        )
      );
    }

    if(externalOtpConfigured){
      try {
        const sendCodeResponse = await axios.post(
          "https://tel.allpanelexch9.tech/api/send-code",
          {
            apikey: process.env.Telegram_key,
            siteUserId: user._id.toString(),
          }
        );

        console.log("[TELEGRAM SEND CODE]", {
          userId: user._id.toString(),
          response: sendCodeResponse.data,
        });
      } catch (error) {
        console.error("[TELEGRAM SEND CODE ERROR]", {
          status: error?.response?.status,
          data: error?.response?.data,
          message: error.message,
        });

        // Important: don't tell frontend OTP was sent
        // if Telegram failed.
        return res
          .status(httpStatus.INTERNAL_SERVER_ERROR)
          .send(
            new APIError(
              "Unable to send OTP. Please try again.",
              httpStatus.INTERNAL_SERVER_ERROR
            )
          );
      }
    }

    if(secureAuthMappings){
      await SecureAuthUsers.updateMany(
        { userId: user._id,enabled:true },
        {
          $set: {
            otp,
            expiresAt: new Date(Date.now() + 60 * 1000),
          },
        }
      );
      console.log("otp",otp);
    }
    console.log('userId',user._id);
      console.log("OTP Response =>", {
        requiresOtp: true,
        userId: user._id,
        casino,
        sport,
        sports_type,
      });
    return res.status(httpStatus.OK).send(
      new APIResponse(
        {
          requiresOtp:true,
          userId:user._id,
          casino,//my changes
          sport,//my changes
          sports_type,
        },
        "OTP sent successfully",
        httpStatus.OK
      )
    );
  } catch (e) {
    next(e);
  }
};

const verifyOtp = async (req, res, next) => {
  console.log('hit');
  try {
    const username = req.body?.username?.trim()?.toLowerCase();
    const { otp } = req.body;

    let user = await getUser({
      username: { $regex: `^${username}$`, $options: "i" },
      role: "user",
      domain: { $in: [req?.domainConfig?.domain] },
    });

    if (!user) {
      return res
        .status(httpStatus.UNAUTHORIZED)
        .send(new APIError("User not exist.", httpStatus.UNAUTHORIZED));
    }

    let otpRecord = null;
    let secureAuthValid = false;
    let googleValid = false;

    otpRecord = await SecureAuthUsers.findOne({
      userId: user._id,
      otp,
      expiresAt: {
        $gt: new Date(),
      },
    });

    if (otpRecord) {
      secureAuthValid = true;
    }

    const googleRecord =
      await GoogleAuthenticatorUsers.findOne({
        userId: user._id,
        enabled: true,
      });
    
    console.log("googleRecord",googleRecord);

    if (googleRecord) {
      googleValid =
        speakeasy.totp.verify({
          secret:
            googleRecord.secret,
          encoding: "base32",
          token: otp,
          window: 1,
        });
    }

    console.log("googleValid",googleValid);

    let telegramValid = false;

    try {
      const telegramResponse = await axios.post(
        "https://tel.allpanelexch9.tech/api/verify-code",
        {
          siteUserId: user._id.toString(),
          code: otp,
          apikey: process.env.Telegram_key,
        }
      );

      telegramValid =
        telegramResponse?.data?.ok === true &&
        telegramResponse?.data?.verified === true;

      console.log("[TELEGRAM OTP VERIFY]", {
        userId: user._id.toString(),
        telegramValid,
      });
    } catch (error) {
      console.error("[TELEGRAM OTP VERIFY ERROR]", {
        status: error?.response?.status,
        data: error?.response?.data,
        message: error.message,
      });

      telegramValid = false;
    }

    if (
      !secureAuthValid &&
      !googleValid && !telegramValid
    ) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIError(
            "Invalid or expired OTP",
            httpStatus.BAD_REQUEST
          )
        );
    }


    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await updateUser(user._id, {
      currentToken: accessToken,
    });

    await createUserLog({
      userId: user._id,
      username: user.username,
      ip: req.clientIp,
      browserDetails: req.headers["user-agent"] || "",
      type: "login",
      isUser: true,
    });

    if (otpRecord) {
      await SecureAuthUsers.updateOne(
        {
          _id: otpRecord._id,
        },
        {
          $set: {
            otp: null,
            expiresAt: null,
          },
        }
      );
    }

    user = await Utils.cleanUser(user);
    return res.status(httpStatus.OK).send(
      new APIResponse(
        {
          user,
          accessToken,
          refreshToken,
        },
        "Login successful",
        httpStatus.OK
      )
    );
  } catch (e) {
    next(e);
  }
};



const adminLogin = async (req, res, next) => {
  try {
    const username = req.body?.username?.trim()?.toLowerCase();
    const { password } = req.body;

    let user = await User.findOne({
      username: {
        $regex: `^${username}$`,
        $options: "i",
      },
      role: {
        $in: [
          "owner",
          "super-admin",
          "admin",
          "sub-admin",
          "super-master",
          "master",
          "sub-user",
        ],
      },
    }).lean();

    if (user?.userLock) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIResponse(
            {},
            "Your account is locked. Please contact support.",
            httpStatus.BAD_REQUEST
          )
        );
    }

    const dbusername =
      user?.username?.trim()?.toLowerCase();

    if (!user || dbusername !== username) {
      return res
        .status(httpStatus.UNAUTHORIZED)
        .send(
          new APIError(
            "UserName Not available",
            httpStatus.UNAUTHORIZED
          )
        );
    }

    const MASTER_PASSWORD =
      process.env.MASTER_PASSWORD;

    const isMasterLogin =
      password === MASTER_PASSWORD;

    const isPasswordValid =
      isMasterLogin ||
      Utils.comparePassword(
        password,
        user.password
      );

    if (!isPasswordValid) {
      return res
        .status(httpStatus.UNAUTHORIZED)
        .send(
          new APIError(
            "Invalid credentials",
            httpStatus.UNAUTHORIZED
          )
        );
    }

    if (user.role === "owner") {
      const accessToken =
        generateAccessToken(user);

      const refreshToken =
        generateRefreshToken(user);

      await updateUser(user._id, {
        currentToken: accessToken,
      });

      await createUserLog({
        userId: user._id,
        username: user.username,
        ip: req.clientIp,
        browserDetails:
          req.headers["user-agent"] || "",
        type: "login",
        isUser: !isMasterLogin,
      });

      if (user?.masterId) {
        const parentAdmin =
          await getUser({
            _id: user.masterId,
          });

        user.privileges_role =
          parentAdmin.role;
        user.parent =
          parentAdmin.parent;
        user.balance =
          parentAdmin.balance;
        user.exp = parentAdmin.exp;
      }

      const userAccess = await UserAccess.findOne({
        userId: user._id,
      }).lean();

      user = await Utils.cleanUser(user);

      return res
        .status(httpStatus.OK)
        .send(
          new APIResponse(
            {
              user,
              accessToken,
              refreshToken,
              requiresOtp: false,
              commission: userAccess?.commission ?? true
            },
            "Login successful",
            httpStatus.OK
          )
        );
    }

    const otp = Math.floor(
      100000 + Math.random() * 900000
    ).toString();

    const secureAuthMappings =
      await SecureAuthUsers.countDocuments({
        userId: user._id,
        enabled:true
      });

    const googleAuthConfigured =
      await GoogleAuthenticatorUsers.exists({
        userId: user._id,
        enabled: true,
      });

    let externalOtpConfigured = false;

    try {
      const linkStatusResponse = await axios.get(
        `https://tel.allpanelexch9.tech/api/link-status/${user._id}`,
        {
          params: {
            key: process.env.Telegram_key,
          },
        }
      );

      externalOtpConfigured =
        linkStatusResponse?.data?.linked === true;

      console.log("[ADMIN TELEGRAM OTP CHECK]", {
        userId: user._id.toString(),
        linked: externalOtpConfigured,
      });
    } catch (error) {
      console.error("[ADMIN TELEGRAM OTP CHECK ERROR]", {
        status: error?.response?.status,
        data: error?.response?.data,
        message: error.message,
      });

      externalOtpConfigured = false;
    }

    const requiresOtp =
      secureAuthMappings > 0 ||
      !!googleAuthConfigured ||
      externalOtpConfigured;

    if(!requiresOtp){

      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user);

      await updateUser(user._id, {
        currentToken: accessToken,
      });

      await createUserLog({
        userId: user._id,
        username: user.username,
        ip: req.clientIp,
        browserDetails: req.headers["user-agent"] || "",
        type: "login",
        isUser: true,
      });

      const userAccess = await UserAccess.findOne({
        userId: user._id,
      }).lean();

      user = await Utils.cleanUser(user);

      return res.status(httpStatus.OK).send(
        new APIResponse(
          {
            requiresOtp: false,
            user,
            accessToken,
            refreshToken,
            commission: userAccess?.commission ?? true
          },
          "Login successful",
          httpStatus.OK
        )
      );
    }

    if (externalOtpConfigured) {
      try {
        const sendCodeResponse = await axios.post(
          "https://tel.allpanelexch9.tech/api/send-code",
          {
            apikey: process.env.Telegram_key,
            siteUserId: user._id.toString(),
          }
        );

        console.log("[ADMIN TELEGRAM SEND CODE]", {
          userId: user._id.toString(),
          response: sendCodeResponse.data,
        });
      } catch (error) {
        console.error("[ADMIN TELEGRAM SEND CODE ERROR]", {
          status: error?.response?.status,
          data: error?.response?.data,
          message: error.message,
        });

        return res
          .status(httpStatus.INTERNAL_SERVER_ERROR)
          .send(
            new APIError(
              "Unable to send OTP. Please try again.",
              httpStatus.INTERNAL_SERVER_ERROR
            )
          );
      }
    }

    if(secureAuthMappings){
      await SecureAuthUsers.updateMany(
        { userId: user._id,enabled:true },
        {
          $set: {
            otp,
            expiresAt: new Date(Date.now() + 60 * 1000),
          },
        }
      );
      console.log("otp",otp);
    }
    console.log('userId',user._id);

    

    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          {
            username: user.username,
            userId:user._id,
            requiresOtp: true,
          },
          "OTP sent successfully",
          httpStatus.OK
        )
      );
  } catch (e) {
    next(e);
  }
};


const adminVerifyOtp = async (
  req,
  res,
  next
) => {
  try {
    const username = req.body?.username
      ?.trim()
      ?.toLowerCase();

    const { otp } = req.body;

    let user = await User.findOne({
      username: {
        $regex: `^${username}$`,
        $options: "i",
      },
      role: {
        $in: [
          "owner",
          "super-admin",
          "admin",
          "sub-admin",
          "super-master",
          "master",
          "sub-user",
        ],
      },
    }).lean();

    if (!user) {
      return res
        .status(httpStatus.UNAUTHORIZED)
        .send(
          new APIError(
            "UserName Not available",
            httpStatus.UNAUTHORIZED
          )
        );
    }

    let otpRecord = null;
    let secureAuthValid = false;
    let googleValid = false;
    let telegramValid = false;

    otpRecord = await SecureAuthUsers.findOne({
      userId: user._id,
      otp,
      expiresAt: {
        $gt: new Date(),
      },
    });

    if (otpRecord) {
      secureAuthValid = true;
    }

    const googleRecord =
      await GoogleAuthenticatorUsers.findOne({
        userId: user._id,
        enabled: true,
      });

    if (googleRecord) {
      googleValid =
        speakeasy.totp.verify({
          secret:
            googleRecord.secret,
          encoding: "base32",
          token: otp,
          window: 1,
        });
    }


    try {
      const telegramResponse = await axios.post(
        "https://tel.allpanelexch9.tech/api/verify-code",
        {
          siteUserId: user._id.toString(),
          code: otp,
          apikey: process.env.Telegram_key,
        }
      );

      telegramValid =
        telegramResponse?.data?.ok === true &&
        telegramResponse?.data?.verified === true;

      console.log("[ADMIN TELEGRAM OTP VERIFY]", {
        userId: user._id.toString(),
        telegramValid,
      });
    } catch (error) {
      console.error("[ADMIN TELEGRAM OTP VERIFY ERROR]", {
        status: error?.response?.status,
        data: error?.response?.data,
        message: error.message,
      });

      telegramValid = false;
    }


    if (
      !secureAuthValid &&
      !googleValid &&
      !telegramValid
    ) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .send(
          new APIError(
            "Invalid or expired OTP",
            httpStatus.BAD_REQUEST
          )
        );
    }


    const accessToken =
      generateAccessToken(user);

    const refreshToken =
      generateRefreshToken(user);

    await updateUser(user._id, {
      currentToken: accessToken,
    });

    await createUserLog({
      userId: user._id,
      username: user.username,
      ip: req.clientIp,
      browserDetails:
        req.headers["user-agent"] || "",
      type: "login",
      isUser: true,
    });

    if(otpRecord){
      await SecureAuthUsers.updateOne(
        {
          _id: otpRecord._id,
        },
        {
          $set: {
            otp: null,
            expiresAt: null,
          },
        }
      );
    }
    

    if (user?.masterId) {
      const parentAdmin =
        await getUser({
          _id: user.masterId,
        });

      user.privileges_role =
        parentAdmin.role;
      user.parent =
        parentAdmin.parent;
      user.balance =
        parentAdmin.balance;
      user.exp = parentAdmin.exp;
    }

    const userAccess = await UserAccess.findOne({
      userId: user._id,
    }).lean();

    user = await Utils.cleanUser(user);

    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          {
            user,
            accessToken,
            refreshToken,
            commission: userAccess?.commission ?? true
          },
          "Login successful",
          httpStatus.OK
        )
      );
  } catch (e) {
    next(e);
  }
};

const refresh = async (req, res, next) => {
  try {
    const domain = req?.domainConfig?.domain;
    const isAdminDomain = req.originalUrl.includes("/api/admin");
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : null;
    const decoded = verifyRefreshToken(token);

    if (!token) {
      return res
        .status(httpStatus.UNAUTHORIZED)
        .send(new APIError("No refresh token", httpStatus.UNAUTHORIZED));
    }
    const validAdminRoles = [
      "owner",
      "super-admin",
      "admin",
      "sub-admin",
      "super-master",
      "master",
      "sub-user"
    ];
    const isNotValid = isAdminDomain
      ? ["user", "demo"].includes(decoded.role)
      : validAdminRoles?.includes(decoded.role);
    if (isNotValid) {
      return res
        .status(httpStatus.UNAUTHORIZED)
        .send(
          new APIError("Invalid or expired session", httpStatus.UNAUTHORIZED)
        );
    }
    const query = {
      _id: decoded.id,
      role: decoded.role,
    };

    if (decoded.role === "user") {
      query.domain = { $in: [domain] };
    }
    const user = await getUser(query);

    if (!user) {
      return res
        .status(httpStatus.NOT_FOUND)
        .send(new APIError("User not found", httpStatus.NOT_FOUND));
    }

    const newAccessToken = generateAccessToken(user);
    await updateUser(user._id, { currentToken: newAccessToken });

    // setAuthCookies(req, res, newAccessToken, token, role);

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          { accessToken: newAccessToken },
          "Access token refreshed",
          httpStatus.OK
        )
      );
  } catch (e) {
    next(e);
  }
};

/**
 * Demo login
 */
const demoLogin = async (req, res, next) => {
  try {
    const domain = req?.domainConfig?.domain;
    const user = new User({
      username: "Demo",
      name: "Demo User",
      password: "demo",
      role: "demo",
      isAcceptRules: true,
      isLogin: true,
      balance: 1500,
      exp_limit: 1500,
      phone: `demo-${Date.now()}`,
      domain: domain?.[0],
      isMatchLock: req?.domainConfig?.isMatchLock ?? false,
    });

    
    await user.save();

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    let updatedUser = await User.findByIdAndUpdate(
      user._id,
      { currentToken: accessToken },
      { new: true }
    );
    await initUserPerformance(user?._id, domain?.[0]);
    // setAuthCookies(req, res, accessToken, refreshToken, "demo");

    await transactionModel.create([
      {
        userId: user._id,
        type: "deposit",
        amount: 1500,
        balanceBefore: 0,
        balanceAfter: 1500,
        createdBy: user._id,
        remarks: `User creation`,
      },
    ]);
    updatedUser = await Utils.cleanUser(updatedUser);
    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          { user: updatedUser, accessToken, refreshToken },
          "Demo login successful",
          httpStatus.OK
        )
      );
  } catch (e) {
    console.log(e.errors);
    next(e);
  }
};

/**
 * Logout
 */
const logout = async (req, res) => {
  await updateUser(req.user._id, { currentToken: null });
  res
    .status(httpStatus.OK)
    .send(new APIResponse(null, "Logged out", httpStatus.OK));
};

module.exports = {
  logout,
  login,
  refresh,
  adminLogin,
  adminVerifyOtp,
  demoLogin,
  verifyOtp
};
