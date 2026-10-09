const express = require("express");
const {
  createLog,
  getLogs,
  getLogsByUser,
  removeLog,
  fetchUserLogs,
  fetchAdminUserLogs,
} = require("./userLog.controller");
const { requireAuth } = require("../../Middleware/auth.middleware");
const router = express.Router();

router.post("/", createLog);
router.get("/all", getLogs);
router.get("/admin-logs", requireAuth, fetchAdminUserLogs);
router.get("/", requireAuth, fetchUserLogs);
router.delete("/:id", removeLog);

module.exports = router;
