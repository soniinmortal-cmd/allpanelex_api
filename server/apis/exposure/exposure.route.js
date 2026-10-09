const express = require("express");
const router = express.Router();
const {
    getExposureAnalysis,
    fixUserExposure,
    getUserBalanceSheet,
    getAccountingSummary,
    scanExposure,
    fixAllExposure,
    getUserExposureProof
} = require("./exposure.controller");
const { requireAuth } = require("../../Middleware/auth.middleware");

// Middleware to check if user is owner
const isOwner = (req, res, next) => {
    if (req.user && req.user.role === "owner") {
        next();
    } else {
        res.status(403).json({ message: "Access denied. Owners only." });
    }
};

router.post("/analysis", requireAuth, isOwner, getExposureAnalysis);
router.post("/proof", requireAuth, isOwner, getUserExposureProof);
router.post("/fix", requireAuth, isOwner, fixUserExposure);
router.get("/scan", requireAuth, isOwner, scanExposure);
router.post("/fix-all", requireAuth, isOwner, fixAllExposure);
router.route("/balance-sheet").post(getUserBalanceSheet);
router.route("/accounting-summary").post(getAccountingSummary);

module.exports = router;
