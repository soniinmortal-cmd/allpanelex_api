const mongoose = require('mongoose');
const User = require('../users/users.model');
const Bet = require('../bet/bet.model');
const Transaction = require('../transaction/transaction.model');

/**
 * Get User Balance Sheet (Passbook)
 * Merges Transactions and Bets into a chronological timeline with running balance.
 */
const getUserBalanceSheet = async (req, res) => {
    try {
        const { userId } = req.params;
        const limit = parseInt(req.query.limit) || 50;
        const page = parseInt(req.query.page) || 1;
        const skip = (page - 1) * limit;

        if (!userId) {
            return res.status(400).json({ success: false, message: 'User ID is required' });
        }

        const userObjectId = new mongoose.Types.ObjectId(userId);

        // 1. Transaction Pipeline
        const transactionPipeline = [
            { $match: { userId: userObjectId, status: 'approved' } }, // Only approved transactions
            {
                $project: {
                    type: 'transaction',
                    date: '$createdAt',
                    description: {
                        $concat: [
                            { $toUpper: '$type' },
                            ' - ',
                            { $ifNull: ['$remarks', ''] }
                        ]
                    },
                    // Credit for Deposit/Transfer(In), Debit for Withdraw/Transfer(Out)
                    // Transfer logic: type='transfer' usually implies context. 
                    // Assuming 'amount' is absolute, and 'type' defines sign.
                    // Actually, let's rely on 'transactionType' if it exists (credit/debit), 
                    // OR infer from type.
                    // Checking existing code: Transaction has 'transactionType' enum: ['credit', 'debit']
                    amount: '$amount', // store absolute amount for display
                    credit: {
                        $cond: [
                            {
                                $or: [
                                    { $eq: ['$transactionType', 'credit'] },
                                    { $eq: ['$type', 'deposit'] } // Fallback
                                ]
                            },
                            '$amount',
                            0
                        ]
                    },
                    debit: {
                        $cond: [
                            {
                                $or: [
                                    { $eq: ['$transactionType', 'debit'] },
                                    { $eq: ['$type', 'withdraw'] } // Fallback
                                ]
                            },
                            '$amount',
                            0
                        ]
                    },
                    refId: '$_id'
                }
            }
        ];

        // 2. Bet Placement Pipeline (Debits)
        // Represents money leaving the wallet to be placed on a bet.
        const betPlacePipeline = [
            { $match: { userId: userObjectId } }, // Select all bets for user
            {
                $project: {
                    type: 'bet_placed',
                    date: '$createdAt',
                    description: {
                        $concat: [
                            'BET PLACED: ',
                            { $ifNull: ['$eventName', 'Unknown Event'] },
                            ' [',
                            { $ifNull: ['$marketName', 'Unknown Market'] },
                            ' - ',
                            { $ifNull: ['$sectionName', ''] },
                            { $ifNull: ['$selected', ''] },
                            ']'
                        ]
                    },
                    amount: '$amount',
                    credit: { $literal: 0 },
                    debit: '$amount', // Stake deducted
                    refId: '$_id'
                }
            }
        ];

        // 3. Bet Settlement Pipeline (Credits)
        // Represents money returning to wallet (Stake + Profit) if won, or 0 if lost.
        // Actually, if we deducted Stake on Placement, then on Win we return Stake + Profit.
        // On Loss, we return nothing.
        // On Cancel, we return Stake.
        const betSettlePipeline = [
            {
                $match: {
                    userId: userObjectId,
                    status: { $in: ['won', 'lost', 'cancelled'] } // Only settled/voided bets
                }
            },
            {
                $project: {
                    type: 'bet_settled',
                    date: '$updatedAt', // Settlement time
                    description: {
                        $concat: [
                            'BET SETTLED (', { $toUpper: '$status' }, '): ',
                            { $ifNull: ['$eventName', 'Unknown Event'] },
                            ' [',
                            { $ifNull: ['$marketName', 'Unknown Market'] },
                            ']'
                        ]
                    },
                    // Return Amount calculation:
                    // Won: Stake + Profit
                    // Lost: 0 (Stake is already gone)
                    // Cancelled: Stake (Refund)
                    amount: {
                        $switch: {
                            branches: [
                                { case: { $eq: ['$status', 'won'] }, then: { $add: ['$amount', '$profit'] } },
                                { case: { $eq: ['$status', 'cancelled'] }, then: '$amount' },
                                { case: { $eq: ['$status', 'lost'] }, then: 0 }
                            ],
                            default: 0
                        }
                    },
                    credit: {
                        $switch: {
                            branches: [
                                { case: { $eq: ['$status', 'won'] }, then: { $add: ['$amount', '$profit'] } },
                                { case: { $eq: ['$status', 'cancelled'] }, then: '$amount' },
                                { case: { $eq: ['$status', 'lost'] }, then: 0 }
                            ],
                            default: 0
                        }
                    },
                    debit: { $literal: 0 }, // Settlement is always defined as a return (or 0 return), not a debit.
                    refId: '$_id'
                }
            }
        ];

        // 4. Combine and Sort
        // We use Transaction as base and union bets
        const aggregate = await Transaction.aggregate([
            ...transactionPipeline,
            { $unionWith: { coll: 'bets', pipeline: betPlacePipeline } }, // Bets Placed
            { $unionWith: { coll: 'bets', pipeline: betSettlePipeline } }, // Bets Settled
            { $sort: { date: 1 } }, // Chronological sort (Oldest first for running balance)

            // 5. Calculate Running Balance
            {
                $setWindowFields: {
                    sortBy: { date: 1 },
                    output: {
                        runningBalance: {
                            $sum: { $subtract: ['$credit', '$debit'] },
                            window: { documents: ['unbounded', 'current'] }
                        }
                    }
                }
            },

            // 6. Sort
            // User requested Ascending (Oldest First). 
            // The pipeline is already sorted by date: 1 for window fields.
            // We can explicitly sort again if needed, or just leave it. 
            // Let's ensure it is 1.
            { $sort: { date: 1 } },

            // 7. Pagination & Stats
            {
                $facet: {
                    items: [
                        { $skip: skip },
                        { $limit: limit }
                    ],
                    totalCount: [
                        { $count: 'count' }
                    ],
                    stats: [
                        {
                            $group: {
                                _id: null,
                                totalCredit: { $sum: '$credit' },
                                totalDebit: { $sum: '$debit' }
                            }
                        }
                    ]
                }
            }
        ]);

        let items = aggregate[0].items;
        const totalCount = aggregate[0].totalCount[0] ? aggregate[0].totalCount[0].count : 0;
        const totalPages = Math.ceil(totalCount / limit);
        const stats = aggregate[0].stats[0] || { totalCredit: 0, totalDebit: 0 };

        // Fetch User details for header & balance reconciliation
        const user = await User.findById(userId).select('username balance exp');
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Calculate Implied Opening Balance (Reconciliation)
        // HistoryDelta = Sum(Credits) - Sum(Debits)
        // ImpliedOpening = ActualBalance - HistoryDelta
        const historyDelta = stats.totalCredit - stats.totalDebit;
        const impliedOpening = user.balance - historyDelta;

        // Adjust items running balance
        items = items.map(item => ({
            ...item,
            runningBalance: item.runningBalance + impliedOpening
        }));

        // Calculate Opening Balance for this page
        let openingBalance = impliedOpening; // Default if nothing found (page 1 start)
        if (items.length > 0) {
            const firstItem = items[0];
            // Since firstItem.runningBalance is now adjusted, 
            // PreviousBalance = CurrentRunning - (Credit - Debit)
            openingBalance = firstItem.runningBalance - (firstItem.credit - firstItem.debit);
        } else if (page > 1) {
            // Use the implied opening + accumulated delta up to skip?
            // Since we don't have the skipped items here, we can't easily calculate exact opening for empty page > 1.
            // But usually empty page means we are past end.
            // We can return the User.balance (Closing) as opening?
            openingBalance = user.balance;
        }

        res.status(200).json({
            success: true,
            data: {
                items,
                totalCount,
                totalPages,
                page,
                user,
                openingBalance
            }
        });

    } catch (error) {
        console.error('Balance Sheet Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getUserBalanceSheet
};
