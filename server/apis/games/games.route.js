const express = require("express");
const {
  deleteGame,
  create,
  getAll,
  getGamesBycid,
  getGamesBygid,
  getGamesBygmid,
  updateCasino,
  checkGame,
 autoEnableCricket,
} = require("./games.controller");
const upload = require("../../Middleware/upload.middleware");

const router = express.Router();
router.route("/create").post(create);

 router.route("/autoEnableCricket").post(autoEnableCricket);

router
  .route("/update-casino/:id")
  .post(upload.fields([{ name: "imgUrl", maxCount: 1 }]), updateCasino);

router.route("/:gmid").delete(deleteGame);
router.route("/").get(getAll);
router.route("/:gmid").get(getGamesBygmid);
router.route("/:etid/:domain").get(getGamesBycid);
router.route("/:gid/:type/:domain").get(getGamesBygid);
router.route("/check").post(checkGame);
module.exports = router;
