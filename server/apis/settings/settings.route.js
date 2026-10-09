const express = require("express");
const { updateSettings, getSettings, updateSpecificCategorySetting, addSettings, getSettingList, getCommissionOptions,setCommission, updateSettingMarket, getSettingMarket, getLoginUserCommission, getCommissionConfig,getGameSchemaList } = require("./settings.controller");
const { requireAuth } = require("../../Middleware/auth.middleware");

const {
  transactionPassword,
} = require("../../Middleware/transaction.middleware");

const router = express.Router();

router.post("/", updateSettings);
router.post("/update-category", updateSpecificCategorySetting);
router.post("/add-setting", addSettings);
router.get("/", getSettings);
router.post("/all", getSettingList);
router.get("/bookmaker-options/:adminId", getCommissionOptions);
router.get("/commission-config/:userId", getCommissionConfig);

router.get("/game-list", getGameSchemaList);

router.post("/update-setting-market",updateSettingMarket);
router.post("/get-setting-market", getSettingMarket);
router.get( "/parent-commission/:adminId",getLoginUserCommission);

router.use(requireAuth);
router.post("/bookmaker-commission/:userId", transactionPassword, setCommission);
// router.post("/bookmaker-commission/:userId", setCommission);

module.exports = router;
