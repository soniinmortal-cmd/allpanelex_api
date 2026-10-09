const jwt = require("jsonwebtoken");
const { getUserById } = require("../../apis/users/users.helper");
const config = require("../../../config/config");

// function generateAccessToken(user) {
//   return jwt.sign({ id: user._id, role: user.role }, config?.jwtSecret, {
//     expiresIn: "1h",
//   });
// }

function generateAccessToken(user) {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
    },
    config?.jwtSecret,
    {
      expiresIn: "1h",
    }
  );
}

// function generateRefreshToken(user) {
//   return jwt.sign({ id: user._id, role: user.role }, config?.jwtRefreshSecret, {
//     expiresIn: user.role === "demo" ? "1h" : "24h",
//   });
// }



// function generateRefreshToken(user) {
//   const isSadmin =
//     user.username?.trim()?.toLowerCase() === "sadmin";

//   return jwt.sign(
//     {
//       id: user._id,
//       role: user.role,
//     },
//     config?.jwtRefreshSecret,
//     {
//       expiresIn: isSadmin
//         ? "1h"
//         : (user.role === "demo" ? "1h" : "24h"),
//     }
//   );
// }

function generateRefreshToken(user) {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
    },
    config?.jwtRefreshSecret,
    {
      expiresIn: "1h",
    }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, config?.jwtSecret);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, config?.jwtRefreshSecret);
}

function getData(token) {
  return jwt.decode(token.replace("Bearer ", ""));
}
const getAuthUser = async (token) => {
  try {
    const tokenData = getData(token);
    const user = await getUserById(tokenData._id);
    const resUser = JSON.parse(JSON.stringify(user));
    return resUser;
  } catch (e) {
    return {};
  }
};

module.exports = {
  getAuthUser,
  getData,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};
