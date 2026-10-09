const { verifyAccessToken } = require("../helpers/jwt/jwt.helper");
const httpStatus = require("http-status");
const APIError = require("../helpers/APIError");
const { getUser } = require("../apis/users/users.helper");

const requireAuth = async (req, res, next) => {
  const debugLaunch = req.originalUrl.includes("/launch");

  const log = (...args) => {
    if (debugLaunch) console.log(...args);
  };

  const domain = req?.domainConfig?.domain;
  log("\n=== LAUNCH AUTH DEBUG ===");
  log("URL:", req.originalUrl);
  log("Domain:", domain);

  const isAdminDomain = req.originalUrl.includes("/api/admin");
  const authHeader = req.headers.authorization;

  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : null;

  log("Auth Header Present:", !!authHeader);
  log("Token Present:", !!token);

  if (!token) {
    log("AUTH FAILED: No token");
    return res
      .status(httpStatus.UNAUTHORIZED)
      .send(new APIError("Access denied", httpStatus.UNAUTHORIZED));
  }

  try {
    const decoded = verifyAccessToken(token);

    log("Decoded:", {
      id: decoded.id,
      role: decoded.role,
    });

    const validAdminRoles = [
      "owner",
      "super-admin",
      "admin",
      "sub-admin",
      "super-master",
      "master",
      "sub-user",
    ];

    const isNotValid = isAdminDomain
      ? ["user", "demo"].includes(decoded.role)
      : validAdminRoles.includes(decoded.role);

    log({
      isAdminDomain,
      role: decoded.role,
      isNotValid,
    });

    if (isNotValid) {
      log("AUTH FAILED: Invalid role");
      return res
        .status(httpStatus.UNAUTHORIZED)
        .send(
          new APIError("Invalid or expired session", httpStatus.UNAUTHORIZED)
        );
    }

    const query = {
      _id: decoded.id,
      role: decoded.role,
      userLock: { $ne: true },
    };

    if (decoded.role === "user") {
      query.domain = { $in: [domain] };
    }

    log("User Query:", query);

    let user = await getUser(query);

    log("User Found:", !!user);

    if (user) {
      log({
        userId: user._id,
        role: user.role,
        tokenMatch: user.currentToken === token,
        masterId: user.masterId,
      });
    }

    if (!user) {
      log("AUTH FAILED: User not found");
      return res
        .status(httpStatus.UNAUTHORIZED)
        .send(
          new APIError(
            "Your session has expired. Please log in again.",
            httpStatus.UNAUTHORIZED
          )
        );
    }

    if (user.role === "user" && user.currentToken !== token) {
      log("AUTH FAILED: Token mismatch");
      return res
        .status(httpStatus.UNAUTHORIZED)
        .send(
          new APIError(
            "Your session has expired. Please log in again.",
            httpStatus.UNAUTHORIZED
          )
        );
    }

    if (user?.masterId) {
      const currentUserId = user._id;
      user = await getUser({ _id: user.masterId });
      user.currentUserId = currentUserId;
    }

    log("AUTH SUCCESS");

    req.user = user;
    next();
  } catch (err) {
    log("AUTH ERROR:", err.message);
    return res
      .status(httpStatus.UNAUTHORIZED)
      .send(new APIError("Invalid or expired token", httpStatus.UNAUTHORIZED));
  }
};

module.exports = {
  requireAuth,
};