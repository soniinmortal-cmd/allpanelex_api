const User = require("../users/users.model");
const Bet = require("../bet/bet.model");
const { createExposureLog } = require("../userLog/userLog.helper");
const APIResponse = require("../../helpers/APIResponse");
const httpStatus = require("http-status");

const {
    calculateMarketExposure
} = require("../../helpers/exposure.helper");


// --------------------------------------------------------------------------------
// API Handlers
// --------------------------------------------------------------------------------

const getExposureAnalysis = async (req, res, next) => {
    try {
        const { username, userId } = req.body;
        let targetUser = null;

        if (userId) {
            targetUser = await User.findById(userId).lean();
        } else if (username) {
            targetUser = await User.findOne({ username }).lean();
        }

        if (!targetUser) {
            return res.status(httpStatus.NOT_FOUND).send(new APIResponse({}, "User not found", httpStatus.NOT_FOUND));
        }

        // --- Step 1: Bulk Fetch Hierarchy (Aggregation) ---
        // Fetch all descendants in one go
        const hierarchyData = await User.aggregate([
            { $match: { _id: targetUser._id } },
            {
                $graphLookup: {
                    from: "users",
                    startWith: "$_id",
                    connectFromField: "_id",
                    connectToField: "parent",
                    as: "descendants"
                }
            }
        ]);

        const descendants = hierarchyData[0]?.descendants || [];
        const allUsers = [targetUser, ...descendants];
        const allUserIds = allUsers.map(u => u._id);

        // Map for quick user lookup and children lookup
        const userMap = new Map();
        const childrenMap = new Map();

        allUsers.forEach(u => {
            userMap.set(u._id.toString(), u);
            if (u.parent) {
                const pid = u.parent.toString();
                if (!childrenMap.has(pid)) childrenMap.set(pid, []);
                childrenMap.get(pid).push(u);
            }
        });

        // --- Step 2: Bulk Fetch Bets ---
        const allBets = await Bet.find({
            userId: { $in: allUserIds },
            status: "pending",
            isActive: true,
            isDeleteBetShowUser: { $ne: true }
        }).lean();

        // Group bets by userId
        const betsByUser = new Map();
        allBets.forEach(b => {
            const uid = b.userId.toString();
            if (!betsByUser.has(uid)) betsByUser.set(uid, []);
            betsByUser.get(uid).push(b);
        });

        // --- Step 3: Bulk Fetch Partnerships ---
        const Partnership = require("../partnership/partnership.model");
        const allPartnerships = await Partnership.find({
            $or: [
                { userId: { $in: allUserIds } }, // child
                { partnerId: { $in: allUserIds } } // parent
            ]
        }).lean();

        // Map partnership by childId-parentId key for precise lookup
        // Assuming unique partnership between two users
        const partnershipMap = new Map();
        allPartnerships.forEach(p => {
            // Store only direct key to avoid overwriting correct data with inverted duplicates
            partnershipMap.set(`${p.userId}-${p.partnerId}`, p);
        });

        // --- Step 4: Process Hierarchy in Memory ---
        // We iterate specifically in the same logical order (BFS from target) to maintain response structure
        // Or just map 'allUsers' but sorted by level/lineage? 
        // The original code used BFS queue. We can replicate that in-memory for consistent ordering.

        const hierarchy = [];
        const queue = [targetUser];
        const visited = new Set([targetUser._id.toString()]);
        const processedUsers = new Set(); // To avoid duplicates in output if graph has cycles (unlikely in tree)

        while (queue.length > 0) {
            const u = queue.shift();
            const uIdString = u._id.toString();

            if (processedUsers.has(uIdString)) continue;
            processedUsers.add(uIdString);

            // 1. Calculate Direct Exposure
            const myBets = betsByUser.get(uIdString) || [];
            const betsByMarket = {};
            myBets.forEach(b => {
                const key = `${b.gameId}-${b.marketId}`;
                if (!betsByMarket[key]) betsByMarket[key] = [];
                betsByMarket[key].push(b);
            });

            let calculatedExp = 0;
            const details = [];

            for (const key in betsByMarket) {
                const marketBets = betsByMarket[key];
                const mExp = calculateMarketExposure(marketBets[0].marketId, marketBets);
                calculatedExp += mExp;
                details.push({
                    key,
                    exp: mExp,
                    count: marketBets.length,
                    gType: marketBets[0].gType,
                    marketName: marketBets[0].marketName
                });
            }

            // 2. Calculate Downline Liability
            // Existing logic iterates children and calculates share
            // We need to look up children from our in-memory map.
            // Note: 'descendants' fetched via graphLookup might technically include children of children etc.
            // But for 'u', we only strictly care about direct children for the downline calculation sum.

            // However, our `childrenMap` is built from the complete set of fetched users.
            // The `childrenMap` only contains users that are IN the `allUsers` list.
            // If the target user is deep in tree, `allUsers` correctly contains only downline.
            // So `childrenMap.get(u._id)` should return correct direct children that are relevant.

            const myChildren = childrenMap.get(uIdString) || [];
            let downlineExp = 0;

            for (const child of myChildren) {
                const childIdString = child._id.toString();
                // Partnership Lookup (Try Direct, then Fallback Reverse)
                let partnership = partnershipMap.get(`${childIdString}-${uIdString}`);
                if (!partnership) {
                    partnership = partnershipMap.get(`${uIdString}-${childIdString}`);
                }
                let comm = 0;
                if (partnership) {
                    comm = partnership.commission;
                } else {
                    // Fallback for missing partnership matches scanExposureDiscrepancies
                    // If leaf user, Parent takes 100% risk if no partnership defined
                    if (child.role === 'user') {
                        comm = 100;
                    } else {
                        comm = 0;
                    }
                }


                let childContribution = 0;
                if (child.role === 'user') {
                    // Leaf User Logic: Inverted Exposure Calculation
                    const { calculateInvertedMarketExposure } = require("../../helpers/exposure.helper");
                    const childBets = betsByUser.get(childIdString) || [];

                    if (childBets.length > 0) {
                        const childBetsByMarket = {};
                        childBets.forEach(b => {
                            const key = `${b.gameId}-${b.marketId}`;
                            if (!childBetsByMarket[key]) childBetsByMarket[key] = [];
                            childBetsByMarket[key].push(b);
                        });

                        let invExp = 0;
                        for (const key in childBetsByMarket) {
                            const mBets = childBetsByMarket[key];
                            invExp += calculateInvertedMarketExposure(mBets[0].marketId, mBets);
                        }
                        childContribution = invExp;
                    }
                } else {
                    // Intermediate Node: Use Stored Exposure
                    // IMPORTANT: The original code used `child.exp`.
                    // Is this 'child' the fresh object from DB? Yes (from aggregation).
                    childContribution = Number(child.exp || 0);
                }

                let parentSharePercent = comm;
                if (child.role !== 'user') {
                    parentSharePercent = 100 - comm;
                }

                const share = (childContribution * parentSharePercent) / 100;
                downlineExp += share;

                // Add child to queue for traversal
                if (!visited.has(childIdString)) {
                    visited.add(childIdString);
                    queue.push(child);
                }
            }

            // Total & Compare
            let totalCalculated = calculatedExp + downlineExp;
            if (totalCalculated > 0) totalCalculated = 0;
            totalCalculated = Number(totalCalculated.toFixed(2));

            const storedExp = Number((u.exp || 0).toFixed(2));
            const diff = Math.abs(storedExp - totalCalculated);
            const tolerance = 0.5;
            const isMismatch = diff > tolerance;

            hierarchy.push({
                user: {
                    _id: u._id,
                    username: u.username,
                    role: u.role,
                    balance: u.balance,
                    parent: u.parent
                },
                storedExp,
                calculatedExp: totalCalculated,
                diff,
                isMismatch,
                hasChildError: false,
                details,
                breakdown: { direct: calculatedExp, downline: downlineExp }
            });
        }

        // --- Post-Processing: Propagate Child Errors Upwards ---
        const userEntryMap = new Map();
        hierarchy.forEach(item => {
            if (item.user && item.user._id) {
                userEntryMap.set(item.user._id.toString(), item);
            }
        });

        for (let i = hierarchy.length - 1; i >= 0; i--) {
            const item = hierarchy[i];
            const parentId = item.user.parent;

            if (item.isMismatch || item.hasChildError) {
                if (parentId && userEntryMap.has(parentId.toString())) {
                    const parentEntry = userEntryMap.get(parentId.toString());
                    parentEntry.hasChildError = true;
                }
            }
        }

        res.status(httpStatus.OK).send(new APIResponse({ hierarchy }, "Exposure Analysis Fetched", httpStatus.OK));

    } catch (err) {
        next(err);
    }
};

const fixUserExposure = async (req, res, next) => {
    try {
        const { userId } = req.body;
        const { verifyAndFixUserExposure } = require("../../helpers/exposure.helper");

        // Use the robust helper which correctly handles Direct + Downline (Inverted) matches
        const result = await verifyAndFixUserExposure(userId);

        if (!result) {
            return res.status(httpStatus.NOT_FOUND).send(new APIResponse({}, "User not found or no fix needed", httpStatus.NOT_FOUND));
        }

        const oldExp = result.oldExp;
        const newExp = result.newExp;

        // Log if fixed
        if (result.fixed) {
            // await createExposureLog({
            //     userId: userId,
            //     oldExp: oldExp,
            //     newExp: newExp,
            //     diff: newExp - oldExp,
            //     action: "fix",
            //     remark: "Manual Exposure Fix via Admin Panel",
            //     createdBy: req.user?._id || userId // fallback
            // });
        }

        res.status(httpStatus.OK).send(new APIResponse({ oldExp, newExp, fixed: result.fixed }, "Exposure Fixed Successfully", httpStatus.OK));

    } catch (err) {
        next(err);
    }
};


const getUserBalanceSheet = async (req, res, next) => {
    try {
        const { userId, fromDate, toDate } = req.body;
        const user = await User.findById(userId);
        if (!user) {
            return res.status(httpStatus.NOT_FOUND).send(new APIResponse({}, "User not found", httpStatus.NOT_FOUND));
        }

        // --- 1. Date Filter Construction ---
        let dateFilter = {};
        if (fromDate || toDate) {
            dateFilter.updatedAt = {};
            if (fromDate) {
                // assume Format YYYY-MM-DD or use moment if imported, here strictly JS Date or string
                const start = new Date(fromDate);
                start.setHours(0, 0, 0, 0);
                dateFilter.updatedAt.$gte = start;
            }
            if (toDate) {
                const end = new Date(toDate);
                end.setHours(23, 59, 59, 999);
                dateFilter.updatedAt.$lte = end;
            }
        } else {
            // Default to last 30 days if no date provided? Or fetch all?
            // Fetching all might be heavy. Let's default to last 30 days if completely empty, 
            // but user requested "Balance Sheet" which implies all time usually. 
            // Let's NOT default restrict unless performance hits.
            // (Optional: restrict to last 6 months if needed)
        }

        // --- 2. Fetch Bets (ALL Status: Won, Lost, Pending) ---
        // Filters: userId, isActive: true, isDeleteBetShowUser: false
        const query = {
            userId: user._id,
            isActive: true,
            isDeleteBetShowUser: { $ne: true },
            ...dateFilter
        };

        const bets = await Bet.find(query).sort({ updatedAt: -1 }).lean();

        // --- 3. Calculate Summary ---
        let totalWon = 0;
        let totalLost = 0;
        let totalPendingExp = 0;
        let netPL = 0;

        // Note: For 'lost' bets, profit is negative (usually liability * -1). 
        // For 'won' bets, profit is positive.
        // Pending bets contribute to Exposure (use existing 'calculateMarketExposure' logic or simpler sum?)
        // The detailed exposure logic is complex (marketwise). For simple balance sheet liability, 
        // we can use the stored 'exp' in user or recalculate. 
        // Since we want "Open Liability" for *these specific bets* if filtered by date, handled carefully.
        // Actually, Balance Sheet usually focuses on Settled Bets (P/L). 
        // Exposure is a snapshot of NOW. 
        // We will separate Settled (History) vs Pending (Open Bets).

        bets.forEach(b => {
            if (b.status === "won") {
                const p = Number(b.profit || 0);
                totalWon += p;
                netPL += p;
            } else if (b.status === "lost") {
                const p = Number(b.profit || 0); // usually negative
                totalLost += p; // adding negative number
                netPL += p;
            }
            // Ignore 'pending' or 'cancelled' for P/L sum
            // We can calculate Pending Liability separately if needed, but strictly P/L sheet is settled.
        });

        // Current Exposure (Snapshot from User DB - safest "Live" number)
        const currentExposure = user.exp || 0;

        const summary = {
            totalWon,
            totalLost,
            netPL,
            currentExposure
        };

        res.status(httpStatus.OK).send(new APIResponse({ summary, bets, user: { username: user.username, role: user.role } }, "User Balance Sheet Fetched", httpStatus.OK));

    } catch (err) {
        next(err);
    }
};

const getAccountingSummary = async (req, res, next) => {
    try {
        const { userId } = req.body;
        const user = await User.findById(userId);
        if (!user) {
            return res.status(httpStatus.NOT_FOUND).send(new APIResponse({}, "User not found", httpStatus.NOT_FOUND));
        }

        const selfBalance = user.balance || 0;
        const selfExposure = user.exp || 0;

        const children = await User.find({ parent: user._id });
        let totalDistributed = 0;
        children.forEach(child => {
            totalDistributed += (child.balance || 0);
        });

        const bets = await Bet.find({
            userId: user._id,
            status: { $in: ["won", "lost"] },
            isActive: true
        }).lean();

        let totalSettledPL = 0;
        bets.forEach(b => {
            totalSettledPL += Number(b.profit || 0);
        });

        const summary = {
            selfBalance,
            selfExposure,
            totalDistributed,
            totalSettledPL
        };

        res.status(httpStatus.OK).send(new APIResponse(summary, "Accounting Summary Fetched", httpStatus.OK));

    } catch (err) {
        next(err);
    }
};

const scanExposure = async (req, res, next) => {
    try {
        const { scanExposureDiscrepancies } = require("../../helpers/exposure.helper");
        const discrepancies = await scanExposureDiscrepancies();
        res.status(200).json(new APIResponse(discrepancies, "Scan Completed", 200));
    } catch (error) {
        next(error);
    }
};

const fixAllExposure = async (req, res, next) => {
    try {
        const { fixHierarchyExposure } = require("../../helpers/exposure.helper");

        // Trigger full hierarchy fix regardless of input
        // This ensures parents/agents are corrected even if not passed in request
        const result = await fixHierarchyExposure();

        res.status(200).json(new APIResponse(result, "Full System Exposure & Hierarchy Fix Completed", 200));
    } catch (error) {
        next(error);
    }
};

const getUserExposureProof = async (req, res, next) => {
    try {
        const { username, userId } = req.body;
        let targetUser = null;

        if (userId) {
            targetUser = await User.findById(userId).lean();
        } else if (username) {
            targetUser = await User.findOne({ username }).lean();
        }

        if (!targetUser) {
            return res.status(httpStatus.NOT_FOUND).send(new APIResponse({}, "User not found", httpStatus.NOT_FOUND));
        }

        const uIdString = targetUser._id.toString();

        // Fetch Parents Hierarchy (Breadcrumbs)
        const parents = [];
        let currParentId = targetUser.parent;
        while (currParentId) {
            const p = await User.findById(currParentId).select("username role parent").lean();
            if (!p) break;
            parents.unshift({
                _id: p._id.toString(),
                username: p.username,
                role: p.role
            });
            currParentId = p.parent;
        }

        // 1. Calculate Direct Exposure
        const myBets = await Bet.find({
            userId: targetUser._id,
            status: "pending",
            isActive: true,
            isDeleteBetShowUser: { $ne: true }
        }).lean();

        const betsByMarket = {};
        myBets.forEach(b => {
            const key = `${b.gameId}-${b.marketId}`;
            if (!betsByMarket[key]) betsByMarket[key] = [];
            betsByMarket[key].push(b);
        });

        let directExposure = 0;
        const directDetails = [];

        for (const key in betsByMarket) {
            const marketBets = betsByMarket[key];
            const mExp = calculateMarketExposure(marketBets[0].marketId, marketBets);
            directExposure += mExp;
            directDetails.push({
                key,
                marketName: marketBets[0].marketName,
                exp: mExp,
                count: marketBets.length,
                gType: marketBets[0].gType,
                bets: marketBets.map(b => ({
                    _id: b._id,
                    betType: b.betType,
                    amount: b.amount,
                    uRate: b.uRate || b.oRate,
                    status: b.status,
                    sectionName: b.sectionName,
                    createdAt: b.createdAt
                }))
            });
        }

        // 2. Calculate Downline Liability
        const children = await User.find({ parent: targetUser._id }).lean();
        const Partnership = require("../partnership/partnership.model");
        const allPartnerships = await Partnership.find({
            $or: [
                { userId: { $in: children.map(c => c._id) }, partnerId: targetUser._id },
                { userId: targetUser._id, partnerId: { $in: children.map(c => c._id) } }
            ]
        }).lean();

        const pMap = new Map();
        allPartnerships.forEach(p => pMap.set(`${p.userId}-${p.partnerId}`, p));

        let downlineExposure = 0;
        const downlineDetails = [];

        for (const child of children) {
            const childIdString = child._id.toString();
            let partnership = pMap.get(`${childIdString}-${uIdString}`);
            if (!partnership) partnership = pMap.get(`${uIdString}-${childIdString}`);

            let comm = 0;
            if (partnership) {
                comm = partnership.commission;
            } else if (child.role === 'user') {
                comm = 100;
            }

            let parentSharePercent = child.role === 'user' ? comm : (100 - comm);

            let childContribution = 0;
            let childInternalExp = 0;

            if (child.role === 'user') {
                const { calculateInvertedMarketExposure } = require("../../helpers/exposure.helper");
                const childBets = await Bet.find({
                    userId: child._id,
                    status: "pending",
                    isActive: true,
                    isDeleteBetShowUser: { $ne: true }
                }).lean();

                if (childBets.length > 0) {
                    const childBetsByMarket = {};
                    childBets.forEach(b => {
                        const k = `${b.gameId}-${b.marketId}`;
                        if (!childBetsByMarket[k]) childBetsByMarket[k] = [];
                        childBetsByMarket[k].push(b);
                    });

                    for (const k in childBetsByMarket) {
                        childInternalExp += calculateInvertedMarketExposure(childBetsByMarket[k][0].marketId, childBetsByMarket[k]);
                    }
                }
                childContribution = childInternalExp;
            } else {
                childContribution = Number(child.exp || 0);
            }

            const share = (childContribution * parentSharePercent) / 100;
            downlineExposure += share;

            downlineDetails.push({
                username: child.username,
                role: child.role,
                childExp: childContribution,
                sharePercent: parentSharePercent,
                contribution: share
            });
        }

        const totalCalculated = Number((directExposure + downlineExposure).toFixed(2));
        const storedExp = Number((targetUser.exp || 0).toFixed(2));

        res.status(httpStatus.OK).send(new APIResponse({
            user: {
                _id: targetUser._id.toString(),
                username: targetUser.username,
                role: targetUser.role,
                balance: targetUser.balance,
                storedExp
            },
            parents,
            direct: {
                total: directExposure,
                details: directDetails
            },
            downline: {
                total: downlineExposure,
                details: downlineDetails
            },
            totalCalculated,
            isMismatch: Math.abs(storedExp - totalCalculated) > 0.5
        }, "Exposure Proof Generated", httpStatus.OK));

    } catch (err) {
        next(err);
    }
};

module.exports = {
    getExposureAnalysis,
    fixUserExposure,
    getUserBalanceSheet,
    getAccountingSummary,
    scanExposure,
    fixAllExposure,
    getUserExposureProof
};
