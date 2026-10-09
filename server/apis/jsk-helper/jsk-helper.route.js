const express = require("express");
const { encrypt, decrypt } = require("./jsk-helper.controller");

const router = express.Router();
router.route("/encrypt").post(encrypt);
router.route("/decrypt").post(decrypt);

module.exports = router;
