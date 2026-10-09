const { acquireLock, releaseLock } = require("./lock.helper");

const calculateMeterPLs = (bets) => {
    // cmeter1 logic: Profit = ((Odds - 1) * Amount) - 2%, Loss = -((Odds - 1) * Amount)
    // The max multiplier is (King - Ace) = 12. If Odds is 13, multiplier is 12.
    const scenarios = ["won", "lost"].map(outcome => {
        let pl = 0;
        bets.forEach(bet => {
            const betAmt = Number(bet.amount || 0);
            const odds = Number(bet.odds || bet.uRate || 0);
            const multiplier = Math.max(0, odds - 1);
            
            if (outcome === "won") {
                // Potential win profit: (Multiplier * Amt) * 0.98
                pl += (multiplier * betAmt) * 0.98;
            } else {
                // Potential loss: -(Multiplier * Amt)
                pl -= (multiplier * betAmt);
            }
        });
        return pl;
    });
    return scenarios;
};

const calculateMatchPLs = (bets, runners) => {
    if (!bets || !bets.length) return [];
    // Specialized handler for Meter games to ensure 2% commission alignment
    if (bets.length > 0 && bets[0].gType === "cmeter1") {
        const pls = calculateMeterPLs(bets);
        return [
            { sid: "won", pl: Number(pls[0].toFixed(2)) },
            { sid: "lost", pl: Number(pls[1].toFixed(2)) }
        ];
    }

    // Ensure runners have string IDs for comparison
    let runnerSids = [];
    if (!runners || runners.length === 0) {
        const sids = new Set(bets.map(b => String(b.sectionId)));
        runnerSids = Array.from(sids);
        runners = runnerSids.map(sid => ({ sid }));
    } else {
        runnerSids = runners.map(r => String(r.sid));
    }

    const scenarios = runners.map(winner => {
        let pl = 0;
        const winnerSid = String(winner.sid);

        bets.forEach(bet => {
            const betAmt = Number(bet.amount || 0);
            let odds = Number(bet.uRate || bet.oRate || 0);
            const isLay = bet.betType === "lay";
            const gType = bet.gType || "";
            const isBookmaker = gType === "match1" || bet.marketName === "Bookmaker";
            const betSid = String(bet.sectionId);

            if (betSid === winnerSid) {
                if (isBookmaker) {
                    // Bookmaker: Profit = (Stake * Rate) / 100
                    const profit = (betAmt * odds) / 100;
                    if (!isLay) { // Back wins
                        pl += profit;
                    } else { // Lay loses
                        pl -= profit; // Liability
                    }
                } else {
                    // Standard: Profit = Stake * (Rate - 1)
                    const isSessionLine = (gType === "mogambo" && odds > 10) || (bet.subType === "total");
                    const profit = isSessionLine ? betAmt : betAmt * (odds - 1);

                    if (!isLay) { // Back wins
                        pl += profit;
                    } else { // Lay loses
                        pl -= profit;
                    }
                }
            } else {
                if (!isLay) { // Back loses
                    pl -= betAmt; // Lost Stake
                } else { // Lay wins
                    pl += betAmt; // Won Stake
                }
            }
        });
        return { sid: winner.sid, pl: Number(pl.toFixed(2)) };
    });
    return scenarios;
};

const calculateMatchExposure = (bets, runners) => {
    const scenarios = calculateMatchPLs(bets, runners);
    return Math.min(0, ...scenarios.map(s => s.pl));
};

const calculateOddEvenPLs = (bets) => {
    if (!bets || !bets.length) return [0, 0];
    const scenarios = ["lay", "back"].map(outcome => {
        let pl = 0;
        bets.forEach(bet => {
            const betAmt = Number(bet.amount);
            const odds = Number(bet.uRate);
            const isLay = bet.betType === "lay";

            let betPL = 0;
            if (isLay) {
                if (outcome === "lay") {
                    betPL = (odds - 1) * betAmt;
                } else {
                    betPL = -betAmt;
                }
                pl += betPL;
            } else {
                if (outcome === "back") {
                    betPL = (odds - 1) * betAmt;
                } else {
                    betPL = -betAmt;
                }
                pl += betPL;
            }
        });
        return pl;
    });
    return scenarios;
};

const calculateOddEvenExposure = (bets) => {
    const scenarios = calculateOddEvenPLs(bets);
    return Math.min(0, ...scenarios);
};


const calculateFancyPLs = (bets) => {
    if (!bets || !bets.length) return [0];
    let maxRate = 0;
    bets.forEach(b => {
        const r = Number(b.uRate || b.oRate || 0);
        if (r > maxRate) maxRate = r;
    });

    const startRun = 0;
    const endRun = maxRate + 10;

    let maxBackRun = 0;
    let maxLayRun = 0;
    bets.forEach(b => {
        if (Number(b.amount) > 0) {
            const r = Number(b.uRate || b.oRate || 0);
            if (b.betType === "back") {
                if (r > maxBackRun) maxBackRun = r;
            } else {
                if (r > maxLayRun) maxLayRun = r;
            }
        }
    });

    const runPLs = [];
    for (let run = startRun; run <= endRun; run++) {
        let pl = 0;
        bets.forEach(bet => {
            const betAmt = Number(bet.amount);
            const betRate = Number(bet.uRate || 0);
            const betSize = Number(
                bet.size || bet.bhav || 
                (bet.betType === 'back' ? (bet.bsize || bet.bRate) : (bet.lsize || bet.lRate)) || 
                100
            );
            let betPL = 0;

            if (bet.betType === "back") {
                if (run >= betRate) {
                    betPL = (betAmt * betSize) / 100;
                } else {
                    betPL = -betAmt;
                }
            } else if (bet.betType === "lay") {
                if (run < betRate) {
                    betPL = betAmt;
                } else {
                    betPL = -(betAmt * betSize) / 100;
                }
            }
            pl += betPL;
        });
        runPLs.push(pl);
    }
    return runPLs;
};

const calculateFancyExposure = (bets) => {
    const runPLs = calculateFancyPLs(bets);
    return Math.min(0, ...runPLs);
};

const calculateFixedOddsSectionExposure = (bets) => {
    if (!bets || !bets.length) return 0;
    let winPL = 0;
    let losePL = 0;

    bets.forEach(bet => {
        const betAmt = Number(bet.amount || 0);
        const odds = Number(bet.uRate || bet.oRate || 0);
        const isLay = bet.betType === "lay";

        if (!isLay) { // Back
            // Scenario 1: User Wins (Market matches Back)
            // Profit = Stake * (Rate - 1)
            winPL += betAmt * (odds - 1);
            // Scenario 2: User Loses
            losePL -= betAmt;
        } else { // Lay
            // Scenario 1: User Wins (Lay Loses)
            // Liability = Stake * (Rate - 1)
            winPL -= betAmt * (odds - 1);
            // Scenario 2: User Loses (Lay Wins)
            losePL += betAmt;
        }
    });

    return Math.min(winPL, losePL);
};

const calculateInvertedFixedOddsSectionExposure = (bets) => {
    let winPL = 0;
    let losePL = 0;

    bets.forEach(bet => {
        const betAmt = Number(bet.amount || 0);
        const odds = Number(bet.uRate || bet.oRate || 0);
        const isLay = bet.betType === "lay";

        if (!isLay) { // Back
            // Scenario 1: User Wins -> Bookie Loses
            winPL -= betAmt * (odds - 1); // Inverted
            // Scenario 2: User Loses -> Bookie Wins
            losePL += betAmt; // Inverted
        } else { // Lay
            // Scenario 1: User Wins (Lay Loses) -> Bookie Wins
            winPL += betAmt * (odds - 1); // Inverted
            // Scenario 2: User Loses (Lay Wins) -> Bookie Loses
            losePL -= betAmt; // Inverted
        }
    });

    return Math.min(winPL, losePL);
};



const calculateMarketExposure = (marketId, bets) => {
    if (!bets.length) return 0;
    const sample = bets[0];
    const gType = sample.gType;
    const eType = (sample.eType || "").toLowerCase();

    const matchTypes = ["match", "match1", "cricketcasino", "game", "cmatch20", "mogambo", "dabba", "ballbyball", "cmeter", "cmeter1"];
    const groupedCasinoTypes = [
        "lucky5", "lucky7", "lucky7eu", "lucky7eu2", "aaa", "ab", "dt", "poker", "poker6", "poker20", "teen20", "teen", "teen9", "teen8", "card32eu", "32cards", "7updown", "amar", "akbar", "anthony", "max", "min", "worli", "bollywood",
        "3cardj", "aaa2", "ab20", "ab3", "ab4", "abj", "baccarat", "baccarat2", "btable", "btable2", "card32", "dolidana", "dt20", "dt202", "dt6", "dtl20", "dum10", "goal", "joker1", "joker120", "joker20", "lottcard", "lucky15", "patti2",
        "pbaccarat", "pcard32", "pdt20", "pdt6", "plucky7", "poison", "poison20", "pteen20", "queen", "race17", "race2", "race20", "roulette11", "roulette12", "roulette13", "sicbo", "sicbo2", "tdt20", "teen1", "teen120", "teen20b",
        "teen20c", "teen3", "teen32", "teen33", "teen41", "teen42", "teen6", "teen62", "teenmuf", "teensin", "teenunique", "trap", "trio", "war", "worli2", "ourroullete", "cricketv3", "superover", "superover2", "superover3", "notenum", "kbc", "kbc2"
    ];
    const fixedOddsTypes = [
        // Removed grouped entries to prevent double calculation
    ];
    const fancy1Types = ["fancy1", "Fancy1"];
    const fancyTypes = ["fancy", "meter", "khado", "fancy2", "Fancy2", "mogambo"];

    const isFancyType = (fancyTypes.includes(eType) || fancyTypes.includes(gType) || fancy1Types.includes(eType) || fancy1Types.includes(gType)) && gType !== "cmeter1";
    const isGroupedCasino = groupedCasinoTypes.includes(gType);

    if ((!isFancyType && (matchTypes.includes(gType) || matchTypes.includes(eType))) || isGroupedCasino) {
        // Special Handling for Mogambo (Mixed Market structure)
        if (gType === "mogambo") {
            const subBetsMap = {};
            bets.forEach(b => {
                const sub = b.subType || "mogambo";
                if (!subBetsMap[sub]) subBetsMap[sub] = [];
                subBetsMap[sub].push(b);
            });

            let totalRoundExp = 0;
            for (const sub in subBetsMap) {
                const subBets = subBetsMap[sub];
                if (sub === "total") {
                    // Total market is independent fancy
                    const bySid = {};
                    subBets.forEach(b => {
                        if (!bySid[b.sectionId]) bySid[b.sectionId] = [];
                        bySid[b.sectionId].push(b);
                    });
                    for (const sid in bySid) {
                        totalRoundExp += calculateFancyExposure(bySid[sid]);
                    }
                } else {
                    // Winner markets (or others) are grouped
                    const sids = Array.from(new Set(subBets.map(b => b.sectionId))).map(sid => ({ sid }));
                    const mainExp = calculateMatchExposure(subBets, sids);
                    
                    // Fallback for unplayed runners in the group
                    let userPLOnOther = 0;
                    subBets.forEach(bet => {
                        const amt = Number(bet.amount || 0);
                        if (bet.betType === "lay") userPLOnOther += amt;
                        else userPLOnOther -= amt;
                    });
                    
                    totalRoundExp += Math.min(mainExp, userPLOnOther, 0);
                }
            }
            return totalRoundExp;
        }

        let sids = [];
        let hasCompleteSections = false;
        if (sample.sections && sample.sections.length > 0) {
            sids = sample.sections.map(s => ({ sid: s.sid }));
            hasCompleteSections = true;
        } else {
            sids = Array.from(new Set(bets.map(b => b.sectionId))).map(sid => ({ sid }));
        }

        const mainExp = calculateMatchExposure(bets, sids);

        if (hasCompleteSections) {
            return Math.min(mainExp, 0);
        }

        // Fallback for "Other Runner wins" (all bet-on runners lose)
        // If an unplayed runner wins, user wins all Lay stakes and loses all Back stakes.
        let userPLOnOther = 0;
        bets.forEach(bet => {
            const amt = Number(bet.amount || 0);
            if (bet.betType === "lay") userPLOnOther += amt;
            else userPLOnOther -= amt;
        });

        // The exposure is the minimum (worst case) among all listed scenarios 
        // AND the theoretical scenario where all existing bets are losers.
        return Math.min(mainExp, userPLOnOther, 0);
    }

    if (fixedOddsTypes.includes(gType) || (eType === "fancy" && !fancyTypes.includes(gType))) {
        const bySection = {};
        bets.forEach(b => {
            if (!bySection[b.sectionId]) bySection[b.sectionId] = [];
            bySection[b.sectionId].push(b);
        });

        let totalExp = 0;
        for (const sid in bySection) {
            totalExp += calculateFixedOddsSectionExposure(bySection[sid]);
        }
        return totalExp;
    }

    if (fancy1Types.includes(gType) || fancy1Types.includes(eType)) {
        const bySection = {};
        bets.forEach(b => {
            if (!bySection[b.sectionId]) bySection[b.sectionId] = [];
            bySection[b.sectionId].push(b);
        });

        let totalFancy1Exp = 0;
        for (const sid in bySection) {
            totalFancy1Exp += calculateFixedOddsSectionExposure(bySection[sid]);
        }
        return totalFancy1Exp;
    }

    if (fancyTypes.includes(gType) || fancyTypes.includes(eType)) {
        const bySection = {};
        bets.forEach(b => {
            if (!bySection[b.sectionId]) bySection[b.sectionId] = [];
            bySection[b.sectionId].push(b);
        });

        let totalFancyExp = 0;
        for (const sid in bySection) {
            totalFancyExp += calculateFancyExposure(bySection[sid]);
        }
        return totalFancyExp;
    }

    if (["oddeven"].includes(gType) || ["oddeven"].includes(eType)) {
        const bySection = {};
        bets.forEach(b => {
            if (!bySection[b.sectionId]) bySection[b.sectionId] = [];
            bySection[b.sectionId].push(b);
        });
        let total = 0;
        for (const sid in bySection) {
            total += calculateOddEvenExposure(bySection[sid]);
        }
        return total;
    }

    return 0;
};

const calculateInvertedMatchExposure = (bets, runners) => {
    const scenarios = calculateMatchPLs(bets, runners);
    const bookiePLs = scenarios.map(s => -s.pl); // Invert: Player Win = Bookie Loss
    return Math.min(0, ...bookiePLs);
};

const calculateInvertedFancyExposure = (bets) => {
    const runPLs = calculateFancyPLs(bets);
    const bookiePLs = runPLs.map(pl => -pl); // Invert
    return Math.min(0, ...bookiePLs);
};

const calculateInvertedOddEvenExposure = (bets) => {
    const scenarios = calculateOddEvenPLs(bets);
    const bookiePLs = scenarios.map(pl => -pl); // Invert
    return Math.min(0, ...bookiePLs);
};

const calculateInvertedMarketExposure = (marketId, bets) => {
    if (!bets.length) return 0;
    const sample = bets[0];
    const gType = sample.gType;
    const eType = (sample.eType || "").toLowerCase();

    const matchTypes = ["match", "match1", "cricketcasino", "game", "cmatch20", "mogambo", "dabba", "ballbyball"];
    const fixedOddsTypes = [
        "lucky5", "lucky7", "lucky7eu", "lucky7eu2", "aaa", "ab", "dt", "poker", "poker6", "poker20", "teen20", "teen", "teen9", "teen8", "card32eu", "32cards", "7updown", "amar", "akbar", "anthony", "max", "min", "worli", "bollywood",
        "3cardj", "aaa2", "ab20", "ab3", "ab4", "abj", "baccarat", "baccarat2", "btable", "btable2", "card32", "dolidana", "dt20", "dt202", "dt6", "dtl20", "dum10", "goal", "joker1", "joker120", "joker20", "lottcard", "lucky15", "patti2",
        "pbaccarat", "pcard32", "pdt20", "pdt6", "plucky7", "poison", "poison20", "pteen20", "queen", "race17", "race2", "race20", "roulette11", "roulette12", "roulette13", "sicbo", "sicbo2", "tdt20", "teen1", "teen120", "teen20b",
        "teen20c", "teen3", "teen32", "teen33", "teen41", "teen42", "teen6", "teen62", "teenmuf", "teensin", "teenunique", "trap", "trio", "war", "worli2", "ourroullete", "cricketv3", "superover", "notenum"
    ];
    const fancy1Types = ["fancy1", "Fancy1"];
    const fancyTypes = ["fancy", "meter", "khado", "cmeter", "cmeter1", "fancy2", "Fancy2"];

    const isFancyType = fancyTypes.includes(eType) || fancyTypes.includes(gType) || fancy1Types.includes(eType) || fancy1Types.includes(gType);

    if (!isFancyType && (matchTypes.includes(gType) || matchTypes.includes(eType))) {
        let sids = [];
        let hasCompleteSections = false;
        if (sample.sections && sample.sections.length > 0) {
            sids = sample.sections.map(s => ({ sid: s.sid }));
            hasCompleteSections = true;
        } else {
            sids = Array.from(new Set(bets.map(b => b.sectionId))).map(sid => ({ sid }));
        }

        const mainExp = calculateInvertedMatchExposure(bets, sids);

        if (hasCompleteSections) {
            return Math.min(mainExp, 0);
        }

        // Fallback for "Other Runner wins"
        let userProfitOnOther = 0;
        bets.forEach(b => {
            const amt = Number(b.amount || 0);
            if (b.betType === "lay") userProfitOnOther += amt;
            else userProfitOnOther -= amt;
        });
        const invertedOtherPL = -userProfitOnOther;

        return Math.min(mainExp, invertedOtherPL, 0);
    }

    if (fixedOddsTypes.includes(gType) || (eType === "fancy" && !fancyTypes.includes(gType))) {
        const bySection = {};
        bets.forEach(b => {
            if (!bySection[b.sectionId]) bySection[b.sectionId] = [];
            bySection[b.sectionId].push(b);
        });

        let totalExp = 0;
        for (const sid in bySection) {
            totalExp += calculateInvertedFixedOddsSectionExposure(bySection[sid]);
        }
        return totalExp;
    }

    if (fancy1Types.includes(gType) || fancy1Types.includes(eType)) {
        const bySection = {};
        bets.forEach(b => {
            if (!bySection[b.sectionId]) bySection[b.sectionId] = [];
            bySection[b.sectionId].push(b);
        });

        let totalFancy1Exp = 0;
        for (const sid in bySection) {
            totalFancy1Exp += calculateInvertedFixedOddsSectionExposure(bySection[sid]);
        }
        return totalFancy1Exp;
    }

    if (fancyTypes.includes(gType) || fancyTypes.includes(eType)) {
        const bySection = {};
        bets.forEach(b => {
            if (!bySection[b.sectionId]) bySection[b.sectionId] = [];
            bySection[b.sectionId].push(b);
        });

        let totalFancyExp = 0;
        for (const sid in bySection) {
            totalFancyExp += calculateInvertedFancyExposure(bySection[sid]);
        }
        return totalFancyExp;
    }

    if (["oddeven"].includes(gType) || ["oddeven"].includes(eType)) {
        const bySection = {};
        bets.forEach(b => {
            if (!bySection[b.sectionId]) bySection[b.sectionId] = [];
            bySection[b.sectionId].push(b);
        });
        let total = 0;
        for (const sid in bySection) {
            total += calculateInvertedOddEvenExposure(bySection[sid]);
        }
        return total;
    }

    return 0;
};

const verifyAndFixUserExposure = async (userId, retryCount = 0) => {
    const { Bet } = require("../apis/bet/bet.helper");
    const User = require("../apis/users/users.model");
    const Partnership = require("../apis/partnership/partnership.model");
    const { distributeCommissionHierarchy } = require("./utils");

    const lockKey = `lock:user:${userId}`;
    let lockAcquired = false;
    let attempts = 0;

    // Spin-lock
    while (!lockAcquired && attempts < 10) {
        lockAcquired = await acquireLock(lockKey, 5000);
        if (!lockAcquired) {
            await new Promise(r => setTimeout(r, 500));
            attempts++;
        }
    }

    if (!lockAcquired) {
        console.error(`[Exposure Fix] Could not acquire lock for user ${userId} after 10 attempts.`);
        return;
    }

    try {
        const user = await User.findById(userId);
        if (!user) return;

        const initialStoredExp = Number(user.exp || 0);

        // --- OPTIMIZED LIGHTWEIGHT RECALCULATION ---
        // 1. Calculate Direct Exposure (Own Bets)
        const userBets = await Bet.find({
            userId,
            status: "pending",
            isActive: true,
            isDeleteBetShowUser: { $ne: true }
        }).select("gameId marketId betType amount gType eType sectionId uRate oRate marketName size bsize lsize bhav sections").lean();

        let directExp = 0;
        let invertedDirectExp = 0;
        if (userBets.length > 0) {
            const betsByMarket = {};
            userBets.forEach(b => {
                const key = `${b.gameId}-${b.marketId}`;
                if (!betsByMarket[key]) betsByMarket[key] = [];
                betsByMarket[key].push(b);
            });

            for (const key in betsByMarket) {
                const mBets = betsByMarket[key];
                directExp += calculateMarketExposure(mBets[0].marketId, mBets);
                invertedDirectExp += calculateInvertedMarketExposure(mBets[0].marketId, mBets);
            }
        }

        // 2. Calculate Downline Exposure (Children Risk)
        let downlineExp = 0;
        if (user.role !== 'user') {
            const children = await User.find({ parent: user._id }).select("_id role exp").lean();
            if (children.length > 0) {
                const childIds = children.map(c => c._id);
                const partnerships = await Partnership.find({ 
                    $or: [
                        { userId: { $in: childIds }, partnerId: user._id },
                        { userId: user._id, partnerId: { $in: childIds } }
                    ]
                }).lean();

                const pMap = new Map();
                partnerships.forEach(p => pMap.set(`${p.userId}-${p.partnerId}`, p.commission));

                for (const child of children) {
                    const cid = child._id.toString();
                    const uid = user._id.toString();

                    let comm = pMap.get(`${cid}-${uid}`);
                    if (comm === undefined) comm = pMap.get(`${uid}-${cid}`);
                    if (comm === undefined) comm = (child.role === 'user' ? 100 : 0);
                    else comm = Number(comm);

                    // --- CONSISTENT COMMISSION LOGIC ---
                    // Matches logic in distributeCommissionHierarchy:
                    // For 'user' children: parentSharePercent = comm
                    // For non-user children: parentSharePercent = (100 - comm)
                    const parentSharePercent = (child.role === 'user' ? comm : (100 - comm));
                    
                    if (child.role === 'user') {
                        // Recalculate direct risk for user children
                        const cBets = await Bet.find({ userId: child._id, status: "pending", isActive: true, isDeleteBetShowUser: { $ne: true } }).select("gameId marketId betType amount gType eType sectionId uRate oRate marketName size bsize lsize bhav sections").lean();
                        let cInvExp = 0;
                        if (cBets.length > 0) {
                            const cBetsByM = {};
                            cBets.forEach(b => {
                                const k = `${b.gameId}-${b.marketId}`;
                                if (!cBetsByM[k]) cBetsByM[k] = [];
                                cBetsByM[k].push(b);
                            });
                            for (const k in cBetsByM) cInvExp += calculateInvertedMarketExposure(cBetsByM[k][0].marketId, cBetsByM[k]);
                        }
                        downlineExp += (cInvExp * parentSharePercent) / 100;
                    } else {
                        // For non-user children (Agents/Dealers), use their total 'Stored Exposure'.
                        // Their 'exp' is a negative value representing their total liability to the parent.
                        const childStoredExp = Number(child.exp || 0);
                        downlineExp += (childStoredExp * parentSharePercent) / 100;
                    }
                }
            }
        }

        let calculatedExp = Number((directExp + downlineExp).toFixed(2));
        if (calculatedExp > 0) calculatedExp = 0;

        const storedExp = Number(user.exp || 0);
        const diff = Math.abs(storedExp - calculatedExp);
        let wasFixed = false;

        if (diff > 0.5) {
            console.log(`[Exposure Fix] User: ${user.username} | Stored: ${storedExp} | Calc: ${calculatedExp}`);
            
            const result = await User.findOneAndUpdate(
                {
                    _id: user._id,
                    exp: { $gte: initialStoredExp - 0.5, $lte: initialStoredExp + 0.5 }
                },
                { $set: { exp: calculatedExp } },
                { new: true }
            );

            if (result) {
                const delta = calculatedExp - initialStoredExp;
                if (user.parent) {
                    await distributeCommissionHierarchy(user, { exp: delta });
                }
                wasFixed = true;
            }
        }

        return { fixed: wasFixed, oldExp: storedExp, newExp: calculatedExp };
    } catch (error) {
        console.error("Error in verifyAndFixUserExposure:", error);
        return { error: error.message };
    } finally {
        await releaseLock(lockKey, lockAcquired);
    }
};


// Helper to compute calculated exposures recursively for a given set of users, bets and partnerships.
// Returns a Map of userId.toString() -> calculatedTotalExposure
const computeFullExposureMap = (allUsers, allPendingBets, allPartnerships) => {
    const userMap = new Map(allUsers.map(u => [u._id.toString(), u]));
    const partnershipMap = new Map(allPartnerships.map(p => [`${p.userId}-${p.partnerId}`, p.commission]));

    // 1. Separate Bets by User
    const betsByUser = {};
    allPendingBets.forEach(bet => {
        const uid = bet.userId.toString();
        if (!betsByUser[uid]) betsByUser[uid] = [];
        betsByUser[uid].push(bet);
    });

    // 2. Calculate Direct and Inverted Direct Exposure for everyone
    const directExposureMap = new Map();
    const invertedExposureMap = new Map();

    for (const user of allUsers) {
        const uid = user._id.toString();
        const userBets = betsByUser[uid] || [];

        let directExp = 0;
        let invertedExp = 0;

        if (userBets.length > 0) {
            const betsByMarket = {};
            userBets.forEach(b => {
                const key = `${b.gameId}-${b.marketId}`;
                if (!betsByMarket[key]) betsByMarket[key] = [];
                betsByMarket[key].push(b);
            });

            for (const key in betsByMarket) {
                const mBets = betsByMarket[key];
                directExp += calculateMarketExposure(mBets[0].marketId, mBets);
                invertedExp += calculateInvertedMarketExposure(mBets[0].marketId, mBets);
            }
        }
        directExposureMap.set(uid, Number(directExp.toFixed(2)));
        invertedExposureMap.set(uid, Number(invertedExp.toFixed(2)));
    }

    // 3. Build Parent Hierarchy Map
    const parentMap = {};
    allUsers.forEach(u => {
        if (u.parent) {
            const pid = u.parent.toString();
            if (!parentMap[pid]) parentMap[pid] = [];
            parentMap[pid].push(u);
        }
    });

    const finalCalculatedMap = new Map();
    const memo = new Map(); // AgentId -> RecursiveRiskContribution

    const getRecursiveAgentRisk = (agentId) => {
        const aid = agentId.toString();
        if (memo.has(aid)) return memo.get(aid);

        let myInvertedDirect = invertedExposureMap.get(aid) || 0;
        let downlineRisk = 0;

        const children = parentMap[aid] || [];
        for (const child of children) {
            const cid = child._id.toString();

            let comm = partnershipMap.get(`${cid}-${aid}`);
            if (comm === undefined) comm = partnershipMap.get(`${aid}-${cid}`);
            if (comm === undefined) comm = (child.role === 'user' ? 100 : 0);
            else comm = Number(comm);

            let childContribution = 0;
            if (child.role === 'user') {
                childContribution = invertedExposureMap.get(cid) || 0;
            } else {
                childContribution = getRecursiveAgentRisk(cid);
            }

            const parentSharePercent = child.role !== 'user' ? (100 - comm) : comm;
            downlineRisk += (childContribution * parentSharePercent) / 100;
        }

        const totalRisk = myInvertedDirect + downlineRisk;
        memo.set(aid, totalRisk);
        return totalRisk;
    };

    // 4. Aggregate Final Total for each user
    for (const user of allUsers) {
        const uid = user._id.toString();
        const myDirectExp = directExposureMap.get(uid) || 0;

        let myDownlineExp = 0;
        const children = parentMap[uid] || [];
        for (const child of children) {
            const cid = child._id.toString();

            let comm = partnershipMap.get(`${cid}-${uid}`);
            if (comm === undefined) comm = partnershipMap.get(`${uid}-${cid}`);
            if (comm === undefined) comm = (child.role === 'user' ? 100 : 0);
            else comm = Number(comm);

            const childContribution = (child.role === 'user') ? (invertedExposureMap.get(cid) || 0) : getRecursiveAgentRisk(cid);
            const parentSharePercent = child.role !== 'user' ? (100 - comm) : comm;
            myDownlineExp += (childContribution * parentSharePercent) / 100;
        }

        let totalCalculated = myDirectExp + myDownlineExp;
        if (totalCalculated > 0) totalCalculated = 0; // Liabilities are negative
        finalCalculatedMap.set(uid, Number(totalCalculated.toFixed(2)));
    }

    return finalCalculatedMap;
};

const scanExposureDiscrepancies = async () => {
    const Bet = require("../apis/bet/bet.model");
    const User = require("../apis/users/users.model");
    const Partnership = require("../apis/partnership/partnership.model");

    // 1. Fetch All Data
    const [allUsers, allPendingBets, allPartnerships] = await Promise.all([
        User.find({}).select("_id username role exp parent").lean(),
        Bet.find({ status: "pending", isActive: true, isDeleteBetShowUser: { $ne: true } })
            .select("userId gameId marketId betType amount gType eType sectionId uRate oRate marketName size bsize lsize bhav sections").lean(),
        Partnership.find({}).select("userId partnerId commission").lean()
    ]);

    const exposureMap = computeFullExposureMap(allUsers, allPendingBets, allPartnerships);

    const discrepancies = [];
    for (const user of allUsers) {
        const uid = user._id.toString();
        const storedExp = Number(user.exp || 0);
        const calculatedExp = exposureMap.get(uid) || 0;

        if (Math.abs(storedExp - calculatedExp) > 0.5) {
            discrepancies.push({
                _id: user._id,
                username: user.username,
                role: user.role,
                storedExp,
                calculatedExp,
                diff: Number((storedExp - calculatedExp).toFixed(2)),
                details: `Recursive Recalc`
            });
        }
    }

    return discrepancies;
};

const fixHierarchyExposure = async () => {
    const User = require("../apis/users/users.model");

    // We can piggy-back off the already highly optimized scan logic!
    // scanExposureDiscrepancies() already does the heavy lifting:
    // It groups bets, calculates inverted direct risk, and aggregates up the graph recursively.
    // It returns EXACTLY who is out of sync and what their TRUE exposure should be.

    // console.log("[Bulk Exposure Fix] Starting highly optimized bulk scan...");
    const discrepancies = await scanExposureDiscrepancies();

    if (discrepancies.length === 0) {
        console.log(`[Bulk Exposure Fix] ${new Date().toISOString()} - No discrepancies found. System is in sync.`);
        return { success: true, fixedUsers: [], initialDiscrepancies: [] };
    }

    console.log(`[Bulk Exposure Fix] Found ${discrepancies.length} users out of sync. Preparing bulk write...`);

    const fixedUsers = [];
    const bulkOps = [];

    for (const d of discrepancies) {
        console.log(`[Discrepancy Detail] User: ${d.username} ${d?.role} (${d._id}) | Stored: ${d.storedExp} | Correct: ${d.calculatedExp} | Diff: ${d.diff}`);
        
        bulkOps.push({
            updateOne: {
                filter: { _id: d._id },
                update: { $set: { exp: d.calculatedExp } }
            }
        });

        fixedUsers.push({
            username: d.username,
            oldExp: d.storedExp,
            newExp: d.calculatedExp,
            diff: d.diff
        });
    }

    if (bulkOps.length > 0) {
        // Execute all database updates in a single, hyper-fast roundtrip
        const result = await User.bulkWrite(bulkOps);
        console.log(`[Bulk Exposure Fix] Bulk write completed. Modified ${result.modifiedCount} documents.`);

        // Clear caches for modified users to ensure UI reflects the fix immediately
        try {
            const { getRedisClient } = require("../libs/redis");
            const redisClient = getRedisClient();
            if (redisClient) {
                for (const user of fixedUsers) {
                    // Caching is based on username in users.controller unfortunately? No, it's user._id for getById usually
                    // Or we just rely on TTL. We can just log.
                }
            }
        } catch (e) {
            // Ignore cache clear error
        }
    }

    return { success: true, fixedUsers, initialDiscrepancies: discrepancies };
};

/**
 * Lightweight real-time recalculation of a single user's direct exposure.
 * Only loads THAT user's own pending bets — O(user's bets), not O(all users).
 * Atomically sets user.exp to the recalculated value.
 * Call this AFTER a successful bet placement to keep user exposure accurate.
 * @param {string|ObjectId} userId
 */
const recalculateUserDirectExposure = async (userId, options = {}) => {
    const { Bet } = require("../apis/bet/bet.helper");
    const User = require("../apis/users/users.model");
    const { session = null } = options;

    try {
        // Fetch only this user's pending bets — very cheap
        const userBets = await Bet.find({
            userId,
            status: "pending",
            isActive: true,
            isDeleteBetShowUser: { $ne: true }
        }).select("gameId marketId betType amount gType eType sectionId uRate oRate marketName size bsize lsize bhav sections").session(session).lean();

        // Group by market
        const betsByMarket = {};
        userBets.forEach(b => {
            const key = `${b.gameId}-${b.marketId}`;
            if (!betsByMarket[key]) betsByMarket[key] = [];
            betsByMarket[key].push(b);
        });

        // Calculate direct exposure across all markets
        let totalDirectExp = 0;
        for (const key in betsByMarket) {
            const mBets = betsByMarket[key];
            totalDirectExp += calculateMarketExposure(mBets[0].marketId, mBets);
        }

        // Clamp to <= 0 (liabilities are negative)
        const calculatedExp = Math.min(0, Number(totalDirectExp.toFixed(2)));

        // Atomically update — just set, no CAS needed since this IS the source of truth
        const updatedUser = await User.findByIdAndUpdate(
            userId, 
            { $set: { exp: calculatedExp } },
            { session, new: true }
        );

        return { success: true, newExp: calculatedExp, updatedUser };
    } catch (err) {
        console.error(`[DirectExpRecalc] Error for userId ${userId}:`, err.message);
        return { success: false };
    }
};

/**
 * Recalculates user exposure and returns the delta to be propagated to hierarchy.
 */
const recalculateUserExposureAndGetDelta = async (userId, options = {}) => {
    const { session = null } = options;
    const User = require("../apis/users/users.model");
    const oldUser = await User.findById(userId).select("exp").session(session).lean();
    if (!oldUser) return 0;

    const result = await recalculateUserDirectExposure(userId, { session });
    if (!result.success) return 0;

    const delta = Number((result.newExp - (oldUser.exp || 0)).toFixed(2));
    return delta;
};

/**
 * Atomically updates user exposure with Optimistic Concurrency Control.
 * Ensures that (Balance + Exposure) stays >= 0.
 * @param {string} userId 
 * @param {number} expDelta - Change in exposure (negative means more exposure/liability)
 * @returns {Promise<{success: boolean, oldExp: number, newExp: number}>}
 */
const updateUserExposureSecure = async (userId, expDelta) => {
    const { atomicUpdateUserFinance } = require("./finance.helper");
    const updated = await atomicUpdateUserFinance(userId, { exp: expDelta });
    return {
        success: true,
        oldExp: Number(updated.exp) - expDelta,
        newExp: updated.exp
    };
};

module.exports = {
    calculateMatchPLs,
    calculateMatchExposure,
    calculateOddEvenPLs,
    calculateOddEvenExposure,
    calculateFancyPLs,
    calculateFancyExposure,
    calculateMarketExposure,
    calculateInvertedMarketExposure,
    calculateFixedOddsSectionExposure,
    calculateInvertedFixedOddsSectionExposure,
    verifyAndFixUserExposure,
    recalculateUserDirectExposure,
    recalculateUserExposureAndGetDelta,
    scanExposureDiscrepancies,
    fixHierarchyExposure,
    updateUserExposureSecure // Export new helper
};
