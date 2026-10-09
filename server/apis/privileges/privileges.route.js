const express = require("express");
const { updatePrivileges, getPrivileges } = require("./privileges.controller");
const { requireAuth } = require("../../Middleware/auth.middleware");

const router = express.Router();
router.use(requireAuth);
router.post("/", updatePrivileges);
router.get("/:role", getPrivileges);

module.exports = router;
