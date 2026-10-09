const express = require("express");
const { logout, login, refresh, adminLogin, demoLogin, verifyOtp, adminVerifyOtp } = require("./auth.controller");
const { requireAuth } = require("../../Middleware/auth.middleware");

const router = express.Router();
router.route("/admin/login").post(adminLogin);
router.route("/admin/verifyOtp").post(adminVerifyOtp);
router.route("/login").post(login);
router.route("/verifyOtp").post(verifyOtp);
router.route("/refresh/login").get(refresh);
router.route("/logout").get(requireAuth, logout);
router.route("/demo-login").post(demoLogin);


module.exports = router;

