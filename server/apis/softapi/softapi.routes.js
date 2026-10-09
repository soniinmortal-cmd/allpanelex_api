const express = require("express");
const { requireAuth } = require("../../Middleware/auth.middleware");
const controller = require("./softapi.controller");
const { requireDomain } = require("../../Middleware/domain.middleware");
 
const router = express.Router();
 
router.get(
  "/games",
  controller.getGames
);
 
router.get(
  "/brands",
  controller.getBrands
);
 
router.post(
  "/launch",
  requireDomain,
  requireAuth,
  controller.launchGame
);
 
router.get(
  "/featuredGames",
  controller.getFeaturedGames
)
 
router.post(
  "/callback",
  controller.callback
);
 
module.exports = router;