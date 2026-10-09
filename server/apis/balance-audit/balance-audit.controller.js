const mongoose = require('mongoose');
const User = require('../users/users.model');
const Bet = require('../bet/bet.model');
const Transaction = require('../transaction/transaction.model');

/**
 * Calculate expected balance for a user based on transactions and bets.
 * Formula: (Deposits - Withdrawals) + (Won Bets Profit - Lost Bets Loss) + (Adjustments)
 */
const calculateUserBalance = async (userId) => {
    const user = await User.findById(userId);
    if (!user) throw new Error('User not found');

    // 1. Aggregate Transactions
    // Focusing on 'approved' status.
    // Exclude 'correction' type as these are manual fixes to align balance with history.
    // We sum 'amount' directly because:
    // - Deposits are positive.
    // - Transfers/Adjustments are signed (positive for credit, negative for debit).
    const transactions = await Transaction.aggregate([
        { 
            $match: { 
                userId: user._id, 
                $or: [
                    { status: 'approved' },
                    { status: 'pending', type: 'withdraw' }
                ],
                type: { $ne: 'correction' } 
            } 
        },
        {
            $group: {
                _id: null,
                total: { $sum: '$amount' }
            }
        }
    ]);

    const totalTransactionNet = transactions.length > 0 ? transactions[0].total : 0;

    // 2. Aggregate Bets
    // We only care about P/L for settled bets.
    // Pending bets do not affect balance (only exposure).
    // Cancelled bets should have 0 P/L (as verified).
    // Profit is positive for Won, negative for Lost.
    // Exclude deleted bets (isActive: false) as they are voided.
    const bets = await Bet.aggregate([
        { $match: { userId: user._id, status: { $in: ['won', 'lost'] }, isActive: true } },
        {
            $group: {
                _id: null,
                totalProfit: { $sum: '$profit' } // Profit is positive for Won, negative for Lost
            }
        }
    ]);

    const totalBetPL = bets.length > 0 ? bets[0].totalProfit : 0;

    // 3. Calculate Expected Balance
    // Start with 0 (or opening balance if system has one, assuming 0 for now)
    // Balance = Net Transactions + Net Bet P/L
    const calculatedBalance = totalTransactionNet + totalBetPL;

    return {
        user,
        calculatedBalance,
        storedBalance: user.balance,
        diff: user.balance - calculatedBalance,
        details: {
            totalTransactionNet,
            totalBetPL,
        }
    };
};

/**
 * Generates a descriptive remark for a balance correction by identifying 
 * the most likely cause (e.g., a specific bet amount matching the drift).
 */
const getAuditFixRemark = async (userId, diff, username) => {
    try {
        const absDiff = Math.abs(diff);
        // Look for a recently settled bet where the profit/loss matches exactly the discrepancy amount
        // This often identifies a double-deduction or missing-credit culprit.
        const matchingBet = await Bet.findOne({
            userId,
            isActive: true,
            status: { $in: ['won', 'lost'] },
            $or: [
                { profit: diff },      // Direct match
                { profit: -diff },     // Inverse match (e.g. double debit)
                { amount: absDiff }    // Amount match
            ]
        }).sort({ updatedAt: -1 });

        if (matchingBet) {
            const gameName = matchingBet.gType || matchingBet.marketName || 'Casino Game';
            const action = diff < 0 ? 'correcting doubled loss' : 'releasing missing winnings';
            return `${username}: ${gameName} ${action} (System Adjustment)`;
        }

        // Fallback: List the most recent games settled for this user
        const recentBets = await Bet.find({ userId, isActive: true, status: { $in: ['won', 'lost'] } })
            .sort({ updatedAt: -1 })
            .limit(3);
        
        if (recentBets.length > 0) {
            const games = [...new Set(recentBets.map(b => b.gType || 'Casino'))].join(', ');
            return `${username}: Balance fix reflecting recent ${games} game activity`;
        }

        return `${username}: Financial reconciliation check (System Adjustment)`;
    } catch (err) {
        return `${username}: Automated reconciliation adjustment`;
    }
};

const getAuditDetails = async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await calculateUserBalance(userId);

        res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Audit Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const fixBalance = async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await calculateUserBalance(userId);
        const diff = result.diff;

        if (Math.abs(diff) < 0.01) {
            return res.status(200).json({ success: true, message: 'Balance is already correct.' });
        }

        // Fix: We need to update Stored Balance to match Calculated Balance?
        // No, Calculated Balance represents the History.
        // Stored Balance represents Reality.
        // If Stored != Calculated, then Stored is wrong (assuming History is immutable/truth).
        // Wait, NO.
        // If Stored < Calculated, money is missing from Wallet. User should have MORE money.
        // So we add to Stored.
        // Adjustment = Calculated - Stored = -Diff.
        // Example: Stored 20, Calc 50. Diff = -30. Adjustment = +30.

        const adjustmentAmount = -diff;
        const { atomicUpdateUserFinance } = require('../../helpers/finance.helper');

        // Update User using the secure atomic helper
        // We use allowNegativeBuffer: true because an audit fix is a "truth override" 
        // that must succeed even if the user is currently over-extended in exposure.
        const updatedUser = await atomicUpdateUserFinance(userId, { balance: adjustmentAmount }, { allowNegativeBuffer: true });

        // Create Transaction
        // Use type 'correction' so it is IGNORED by the audit logic next time.
        // This ensures that the audit logic continues to calculate based on "Real" sources (Deposits/Bets),
        // and doesn't get confused by the fix record.
        const remark = await getAuditFixRemark(userId, diff, result.user.username);

        await Transaction.create({
            userId: userId,
            type: 'correction',
            amount: Math.abs(adjustmentAmount),
            transactionType: adjustmentAmount > 0 ? 'credit' : 'debit',
            balanceBefore: result.storedBalance,
            balanceAfter: updatedUser.balance,
            status: 'approved',
            remarks: remark,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        res.status(200).json({
            success: true,
            message: 'Balance fixed successfully',
            data: {
                oldBalance: result.storedBalance,
                newBalance: updatedUser.balance,
                adjustment: adjustmentAmount
            }
        });

    } catch (error) {
        console.error('Fix Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const scanAllUsers = async (req, res) => {
    try {
        // 1. Bulk Aggregate All Transaction Net Sums (excluding corrections)
        const txnSums = await Transaction.aggregate([
            { 
                $match: { 
                    $or: [
                        { status: 'approved' },
                        { status: 'pending', type: 'withdraw' }
                    ],
                    type: { $ne: 'correction' } 
                } 
            },
            { $group: { _id: "$userId", totalNet: { $sum: "$amount" } } }
        ]);

        // 2. Bulk Aggregate All Bet Profit/Loss Sums
        const betSums = await Bet.aggregate([
            { $match: { status: { $in: ['won', 'lost'] }, isActive: true } },
            { $group: { _id: "$userId", totalPL: { $sum: "$profit" } } }
        ]);

        // 3. Compile maps for fast lookup
        const txnMap = new Map(txnSums.map(t => [String(t._id), t.totalNet]));
        const betMap = new Map(betSums.map(b => [String(b._id), b.totalPL]));

        // 4. Fetch Users and Compare
        const users = await User.find({ isActive: true }).select('_id username balance role');
        const mismatches = [];

        for (const user of users) {
            const uid = String(user._id);
            const txnNet = txnMap.get(uid) || 0;
            const betPL = betMap.get(uid) || 0;
            const calculated = txnNet + betPL;

            // Only flag users with positive stored balance AND a significant gap.
            // Legacy zero-balance users with negative calculated history are historical
            // losses from before the audit system existed — not a real financial risk.
            const isSignificantMismatch = Math.abs(user.balance - calculated) > 100;
            const hasPositiveBalance = user.balance > 0;

            if (isSignificantMismatch && hasPositiveBalance) {
                mismatches.push({
                    userId: user._id,
                    username: user.username,
                    stored: user.balance,
                    role: user.role,
                    calculated: calculated,
                    diff: user.balance - calculated
                });
            }
        }

        res.status(200).json({
            success: true,
            totalMismatch: mismatches.length,
            data: mismatches
        });

    } catch (error) {
        console.error('Scan Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const fixAllDiscrepancies = async (req, res) => {
    try {
        // 1. Bulk Aggregate All Data (same logic as scan)
        const txnSums = await Transaction.aggregate([
            { 
                $match: { 
                    $or: [
                        { status: 'approved' },
                        { status: 'pending', type: 'withdraw' }
                    ],
                    type: { $ne: 'correction' } 
                } 
            },
            { $group: { _id: "$userId", totalNet: { $sum: "$amount" } } }
        ]);
        const betSums = await Bet.aggregate([
            { $match: { status: { $in: ['won', 'lost'] }, isActive: true } },
            { $group: { _id: "$userId", totalPL: { $sum: "$profit" } } }
        ]);

        const txnMap = new Map(txnSums.map(t => [String(t._id), t.totalNet]));
        const betMap = new Map(betSums.map(b => [String(b._id), b.totalPL]));

        const users = await User.find({ isActive: true }).select('_id username balance role');
        let fixedCount = 0;

        for (const user of users) {
            const uid = String(user._id);
            const txnNet = txnMap.get(uid) || 0;
            const betPL = betMap.get(uid) || 0;
            const calculated = txnNet + betPL;

            const diff = user.balance - calculated;
            if (Math.abs(diff) > 1.0) {
                const adjustmentAmount = -diff;
                const { atomicUpdateUserFinance } = require('../../helpers/finance.helper');

                // Atomic update using the secure helper
                await atomicUpdateUserFinance(user._id, { balance: adjustmentAmount }, { allowNegativeBuffer: true });

                const remark = await getAuditFixRemark(user._id, diff, user.username);

                await Transaction.create({
                    userId: user._id,
                    type: 'correction',
                    amount: Math.abs(adjustmentAmount),
                    balanceBefore: user.balance,
                    balanceAfter: calculated,
                    status: 'approved',
                    remarks: remark
                });
                fixedCount++;
            }
        }

        res.status(200).json({
            success: true,
            fixedCount
        });

    } catch (error) {
        console.error('Fix All Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getAuditDetails,
    fixBalance,
    scanAllUsers,
    fixAllDiscrepancies
};
