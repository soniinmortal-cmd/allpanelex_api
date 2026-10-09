const express = require("express");
const router = express.Router();
const {
  getPerformance,
  updatePerformance,
} = require("./userPerformance.controller");
const { requireAuth } = require("../../Middleware/auth.middleware");

router.use(requireAuth);
router.get("/:type", getPerformance);
router.put("/", updatePerformance);

module.exports = router;
