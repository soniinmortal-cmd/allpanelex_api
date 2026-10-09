const express = require("express");
const {
  createOrUpdate,
  getDomains,
  removeDomain,
  getDomain,
  getDomainByDomainName,
} = require("./domain.controller");
const upload = require("../../Middleware/upload.middleware");

const router = express.Router();

router.post(
  "/",
  upload.fields([
    { name: "logo", maxCount: 1 },
    { name: "login_logo", maxCount: 1 },
    { name: "favicon", maxCount: 1 },
  ]),
  createOrUpdate
);
router.get("/all", getDomains);
// router.get("/domain-config", getDomain);
router.get("/domain-config", getDomains);
router.get("/:domain", getDomainByDomainName);
router.delete("/:id", removeDomain);

module.exports = router;
