const express = require("express");
const {
  listBanners,
  removeBanner,
  createBanner,
  updateBanner,
  bannersByType,
} = require("./banner.controller");
const { requireAuth } = require("../../Middleware/auth.middleware");
const upload = require("../../Middleware/upload.middleware");

const router = express.Router();
router.route("/:type").get(bannersByType);
router.use([requireAuth]);
router.route("/banner-store").post(
  upload.fields([
    { name: "image_path", maxCount: 1 },
    { name: "mobile_image_path", maxCount: 1 },
  ]),
  createBanner
);
router.route("/banner-store/:id").put(
  upload.fields([
    { name: "image_path", maxCount: 1 },
    { name: "mobile_image_path", maxCount: 1 },
  ]),
  updateBanner
);
router.route("/banner-store/:id").delete(removeBanner);
router.route("/banner-list/:domain").get(listBanners);

module.exports = router;
