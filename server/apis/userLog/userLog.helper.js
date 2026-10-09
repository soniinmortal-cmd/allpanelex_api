const UserLog = require("./userLog.model");
const axios = require("axios");
UserLog.enableCache();

async function createUserLog(data) {
  return UserLog.create(data);
}

async function getAllUserLogs() {
  return UserLog.find({ isUser: true }).sort({ createdAt: -1 }).limit(500);
}

async function getUserLogsByUserId(userId) {
  return UserLog.find({ userId, isUser: true })
    .sort({ createdAt: -1 })
    .limit(100);
}

async function deleteUserLog(id) {
  return UserLog.findByIdAndDelete(id);
}
const mongoose = require("mongoose");

// const getUserLogs = async ({
//   search,
//   type,
//   fromDate,
//   toDate,
//   page,
//   limit,
//   userId,
//   clientId,
//   userIds, // Added support for array of IDs
// }) => {
//   let query = {};

//   const toObjectId = (id) => {
//     try {
//       return mongoose.Types.ObjectId(id);
//     } catch (e) {
//       return id;
//     }
//   };

//   if (clientId) {
//     query.userId = toObjectId(clientId);
//   } else if (userIds && Array.isArray(userIds)) {
//     query.userId = { $in: userIds.map(toObjectId) };
//   } else if (userId) {
//     query.userId = toObjectId(userId);
//   }

//   if (search) {
//     query.username = { $regex: search, $options: "i" };
//   }

//   if (type) {
//     query.type = type;
//   }

//   if (fromDate || toDate) {
//     query.createdAt = {};
//     if (fromDate) query.createdAt.$gte = new Date(fromDate);
//     if (toDate) query.createdAt.$lte = new Date(toDate);
//   }

//   const total = await UserLog.countDocuments(query);

//   const data = await UserLog.find(query)
//     .sort({ createdAt: -1 })
//     .skip((page - 1) * limit)
//     .limit(limit);

//   return { data, total };
// };

const getUserLogs = async ({
  search,
  type,
  fromDate,
  toDate,
  page,
  limit,
  userId,
  clientId,
  userIds, // Added support for array of IDs
}) => {
  let query = {};

  const toObjectId = (id) => {
    try {
      return mongoose.Types.ObjectId(id);
    } catch (e) {
      return id;
    }
  };

  if (clientId) {
    query.userId = toObjectId(clientId);
  } else if (userIds && Array.isArray(userIds)) {
    query.userId = { $in: userIds.map(toObjectId) };
  } else if (userId) {
    query.userId = toObjectId(userId);
  }

  if (search) {
    query.username = { $regex: search, $options: "i" };
  }

  if (type) {
    query.type = type;
  }

  if (fromDate || toDate) {
    query.createdAt = {};
    if (fromDate) query.createdAt.$gte = new Date(fromDate);
    if (toDate) query.createdAt.$lte = new Date(toDate);
  }

  const total = await UserLog.countDocuments(query);

  const data = await UserLog.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();
  
  if (type === "login") {
    const ips = [
      ...new Set(
        data
          .map((log) => log.ip)
          .filter((ip) => ip && ip !== "127.0.0.1" && ip !== "::1")
      ),
    ];

    const ipDetailsMap = new Map();

    await Promise.all(
      ips.map(async (ip) => {
        try {
          const response = await axios.get(
            `http://ip-api.com/json/${encodeURIComponent(ip)}`,
            {
              params: {
                fields:
                  "status,message,query,country,regionName,city,isp",
              },
              timeout: 5000,
            }
          );

          if (response.data.status === "success") {
            ipDetailsMap.set(ip, {
              ip: response.data.query || ip,
              country: response.data.country || "",
              region: response.data.regionName || "",
              city: response.data.city || "",
              isp: response.data.isp || "",
            });
          }
        } catch (error) {
          console.error(`Failed to fetch IP details for ${ip}:`, error.message);
        }
      })
    );

    data.forEach((log) => {
      const ip = log.ip || "";

      log.ipDetails =
        ipDetailsMap.get(ip) || {
          ip,
          country: "",
          region: "",
          city:
            ip === "127.0.0.1" || ip === "::1"
              ? "Localhost"
              : "",
          isp: "",
        };
    });
  }

  return { data, total };
};

const ExposureLog = require("./exposureLog.model");

async function createExposureLog(data) {
  try {
    // await ExposureLog.create(data);
  } catch (err) {
    console.error("Failed to create exposure log", err);
  }
}

async function getExposureLogs(query, limit = 50) {
  return ExposureLog.find(query).sort({ createdAt: -1 }).limit(limit).populate("userId", "username role");
}

module.exports = {
  createUserLog,
  getAllUserLogs,
  getUserLogsByUserId,
  deleteUserLog,
  getUserLogs,
  createExposureLog,
  getExposureLogs
};
