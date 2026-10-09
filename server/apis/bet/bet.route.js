const express = require("express");
const {
  placeBet,
  listBets,
  settleBet,
  listBetsAll,
  casinoPlaceBet,
  getCurrentBet,
  getAccountStatement,
  getAdminAccountStatement,
  getShortxAdminAccountStatement,
  getSportMatchFancyHistory,
  getSportMatchFancyBet,
  declareFancyResult,
  cancelFancyResult,
  fancyResultRoleBack,
  getSportMatchFancyBetHistory,
  getFancyMatchHistory,
  matchResultRoleBack,
  getMatchHistory,
  declareMatchResult,
  getSportMatch,
  getChitBets,
  deleteBets,
  rollBackBets,
  getSportMatchByGameId,
  getMatchHistoryByGameId,
  recalculateUserExposure,
  applyExposureFix,
  retroactiveRegisterGame,
  manageCasino,
  removeDeletedBet,
  getBetsProfit,
  getChitBetsShotx
} = require("./bet.controller");
const { requireAuth } = require("../../Middleware/auth.middleware");
const { transactionPassword } = require("../../Middleware/transaction.middleware");


const router = express.Router();
router.use(requireAuth);
router.post("/place", placeBet);
router.post("/place/casino", casinoPlaceBet);
router.get("/", listBets);
router.post("/all", listBetsAll);
router.patch("/:id/settle", settleBet);
router.post("/current-bets", getCurrentBet);
router.get("/account-statement", getAccountStatement);
router.get("/account-statement/admin", getAdminAccountStatement);

router.get("/getShortxAdminAccountStatement", getShortxAdminAccountStatement);

router.post("/manage-casino/admin", manageCasino);

router.post("/removeDeletedBet", removeDeletedBet);

//router.get("/manage-casino/admin", manageCasino);
// fancy result
router.get("/fancy-match", getSportMatchFancyHistory);
router.get("/fancy-match-bet/:gameId", getSportMatchFancyBet);
router.post("/fancy-result-declare", declareFancyResult);
router.post("/fancy-cancel", cancelFancyResult);
router.get("/fancy-match-history", getFancyMatchHistory);
router.get("/fancy-match-bet-history/:gameId", getSportMatchFancyBetHistory);
router.post("/fancy-result-role-back", fancyResultRoleBack);
// match result
router.get("/manage-match", getSportMatch);
router.get("/manage-match/:gameId", getSportMatchByGameId);
router.post("/match-result-declare", declareMatchResult);
router.get("/match-history", getMatchHistory);
router.get("/match-history/:gameId", getMatchHistoryByGameId);
router.post("/match-result-role-back", matchResultRoleBack);
router.get("/cheat-bets", getChitBets);
router.get("/chit-bets-shotx", getChitBetsShotx);
router.delete("/delete", transactionPassword, deleteBets);

router.post("/rollBackBets", transactionPassword, rollBackBets);

router.post("/recalculate-exposure", transactionPassword, recalculateUserExposure);
router.post("/apply-exposure-fix", transactionPassword, applyExposureFix);
// Third-party result registration
router.post("/register-tp-game", retroactiveRegisterGame);
// Third-party registry listing (owner only)

router.post("/getBetsProfit", getBetsProfit);

const {
  getThirdPartyRegistry,
  getThirdPartyRegistryStats,
  retryThirdPartyRegistration,
} = require("../third-party-result/thirdPartyRegistry.controller");
router.get("/tp-registry/stats", getThirdPartyRegistryStats);
router.get("/tp-registry", getThirdPartyRegistry);
router.post("/tp-registry/retry", retryThirdPartyRegistration);
module.exports = router;
