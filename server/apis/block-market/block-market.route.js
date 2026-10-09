const express = require("express");
const { create, getBlockMarketById } = require("./block-market.controller");
const { requireAuth } = require("../../Middleware/auth.middleware");

const router = express.Router();
router.use(requireAuth);
router.route("/create").post(create);
router.route("/").get(getBlockMarketById);
// router
//   .route("/update-casino/:id")
//   .post(upload.fields([{ name: "imgUrl", maxCount: 1 }]), updateCasino);

// router.route("/:gmid").delete(deleteGame);
// router.route("/").get(getAll);
// router.route("/:gmid").get(getGamesBygmid);
// router.route("/:etid/:domain").get(getGamesBycid);
// router.route("/:gid/:type/:domain").get(getGamesBygid);
// router.route("/check").post(checkGame);
module.exports = router;
