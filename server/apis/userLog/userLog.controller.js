const httpStatus = require("http-status");
const APIError = require("../../helpers/APIError");
const APIResponse = require("../../helpers/APIResponse");
const {
  createUserLog,
  getAllUserLogs,
  getUserLogsByUserId,
  deleteUserLog,
  getUserLogs,
} = require("./userLog.helper");
const { collectAllIds } = require("../bet/bet.helper");

const createLog = async (req, res, next) => {
  try {
    const logDoc = await createUserLog(req.body);
    res
      .status(httpStatus.OK)
      .send(new APIResponse(logDoc, "UserLog created", httpStatus.OK));
  } catch (err) {
    next(err);
  }
};

const getLogs = async (req, res, next) => {
  try {
    const logs = await getAllUserLogs();
    res
      .status(httpStatus.OK)
      .send(new APIResponse(logs, "UserLogs fetched", httpStatus.OK));
  } catch (err) {
    next(err);
  }
};

const getLogsByUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const logs = await getUserLogsByUserId(userId);
    res
      .status(httpStatus.OK)
      .send(new APIResponse(logs, "UserLogs fetched by userId", httpStatus.OK));
  } catch (err) {
    next(err);
  }
};

const removeLog = async (req, res, next) => {
  try {
    const id = req.params.id;
    const log = await deleteUserLog(id);

    if (!log) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("UserLog not found", httpStatus.NOT_FOUND));
    }

    res
      .status(httpStatus.OK)
      .send(new APIResponse(log, "UserLog deleted", httpStatus.OK));
  } catch (err) {
    next(err);
  }
};
const fetchUserLogs = async (req, res, next) => {
  try {
    const {
      search = "",
      type = "",
      fromDate,
      toDate,
      page = 1,
      limit = 10,
    } = req.query;

    const filters = {
      search,
      type,
      fromDate,
      toDate,
      page: Number(page),
      limit: Number(limit),
      userId: req?.user?._id,
    };

    const { data, total } = await getUserLogs(filters);

    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse({ data, total }, "User logs fetched", httpStatus.OK)
      );
  } catch (err) {
    next(err);
  }
};

const fetchAdminUserLogs = async (req, res, next) => {
  try {
    const {
      search = "",
      type = "",
      fromDate,
      toDate,
      page = 1,
      limit = 10,
      clientId,
    } = req.query;

    let userIds = [];
    if (!clientId) {
      const allIds = await collectAllIds(req.user);
      // Exclude self (first element) to show ONLY downline
      userIds = allIds.slice(1);
    }

    const filters = {
      search,
      type,
      fromDate,
      toDate,
      page: Number(page),
      limit: Number(limit),
      clientId,
      userIds,
    };

    const { data, total } = await getUserLogs(filters);

    return res
      .status(httpStatus.OK)
      .send(
        new APIResponse({ data, total }, "Admin User logs fetched", httpStatus.OK)
      );
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createLog,
  getLogs,
  getLogsByUser,
  removeLog,
  fetchUserLogs,
  fetchAdminUserLogs,
};
