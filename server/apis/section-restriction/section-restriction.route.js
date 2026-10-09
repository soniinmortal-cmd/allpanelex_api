const express = require("express");
const { getSectionRestriction, updateSectionRestriction } = require("./section-restriction.controller");
const { requireAuth } = require("../../Middleware/auth.middleware");
const { transactionPassword } = require("../../Middleware/transaction.middleware");

const router = express.Router();

router.get("/", requireAuth, getSectionRestriction);
router.post("/update", requireAuth, transactionPassword, updateSectionRestriction);

module.exports = router;
