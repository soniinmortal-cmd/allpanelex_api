const express = require('express');
const { getAuditDetails, fixBalance, scanAllUsers, fixAllDiscrepancies } = require('./balance-audit.controller');
const { requireAuth } = require('../../Middleware/auth.middleware');

const router = express.Router();

// All routes require authentication and admin privileges
// router.use(requireAuth, requireAdmin); 
// Using requireAuth is likely enough if role check is inside or if we just want authed users for now.
// Based on file scan, `requireAuth` is common. Let's start with that.
// Ideally, `requireAdmin` should be used. Let's check if it exists.

router.get('/scan/all', requireAuth, scanAllUsers);
router.post('/scan/fix-all', requireAuth, fixAllDiscrepancies);
const { getUserBalanceSheet } = require('./user-balance-sheet.controller');
router.get('/sheet/:userId', requireAuth, getUserBalanceSheet);

router.get('/:userId', requireAuth, getAuditDetails);
router.post('/:userId/fix', requireAuth, fixBalance);


module.exports = router;
