const express = require("express");
const controller = require("./secureAuth.controller");
const googleController = require('./googleAuthenticator.controller');

const router = express.Router();

router.post("/login", controller.login);

router.post("/users-device", controller.getUsersByDevice);

router.post("/refresh-otp", controller.refreshOtp);

router.delete("/user", controller.removeUser);

router.post('/googleQrCode', googleController.setupGoogleAuthenticator);

router.post('/twoFactor',controller.toggleTwoFactor);

router.post(
  "/setup-telegram-2fa",
  controller.setupTelegramTwoFactor
);

module.exports = router;

