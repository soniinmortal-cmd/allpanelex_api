const handleCasinoFancyBet = (
    req,
    findSpotsData,
    expBal,
    partnerExpBal,
    odds,
    sectionRecord
) => {
    let spotsData = findSpotsData?.sdata ? [...findSpotsData.sdata] : [];
    const idx = spotsData.findIndex(
        (s) => s.sid == req?.body?.sectionId && s?.subId == req?.body?.subId
    );
    const oldAmt = idx > -1 ? spotsData[idx].amount : 0;
    const oldProfit = idx > -1 ? spotsData[idx].profit : 0;
    const oldAbovePL = idx > -1 ? (spotsData[idx].abovePL || 0) : oldAmt;
    const oldBelowPL = idx > -1 ? (spotsData[idx].belowPL || 0) : oldAmt;

    // Detect if it's a Session Line (1:1 risk) vs Fixed Odds (Multi-odds liability)
    const isSessionLine =
        req?.body?.subType === "total" ||
        (req?.body?.gType !== "mogambo" && req?.body?.gType !== "cmeter1" && parseFloat(odds) > 10);
        
    const isLay = req?.body?.betType === "lay";
    
    const bhav = Number(req?.body?.bhav || 100);

    let newAbovePL = oldAbovePL;
    let newBelowPL = oldBelowPL;
    let newProfit = oldProfit;
    let uiAmountCal = 0;

    if (isSessionLine) {
        // SCENARIO-BASED OFFSET
        let currentAbovePL = 0;
        let currentBelowPL = 0;
        
        if (isLay) {
            currentAbovePL = -Number(((req.body.amount * bhav) / 100).toFixed(2));
            currentBelowPL = Number(req.body.amount);
        } else {
            currentAbovePL = Number(((req.body.amount * bhav) / 100).toFixed(2));
            currentBelowPL = -Number(req.body.amount);
        }
        
        newAbovePL = (isNaN(oldAbovePL) ? 0 : oldAbovePL) + currentAbovePL;
        newBelowPL = (isNaN(oldBelowPL) ? 0 : oldBelowPL) + currentBelowPL;
        
        uiAmountCal = Math.min(newAbovePL, newBelowPL);
        newProfit = Math.max(newAbovePL, newBelowPL);
    } else {
        // Winner Market (Standard Fixed Odds logic)
        const multiplier = parseFloat(odds) - 1;
        const amountCal = (isLay || req.body?.gType === "cmeter1")
            ? -Number((multiplier * req?.body?.amount).toFixed(2))
            : -req?.body?.amount;

        const profitCal = (isLay || req.body?.gType === "cmeter1")
            ? req?.body?.amount
            : Number((multiplier * req?.body?.amount).toFixed(2));

        // Note: For cmeter1, we want the UI amount on the runner to be the potential maximum win
        // According to settlement logic: Win = Stake * PointDifference (Max 12x)
        const cmeterProfit = Number((multiplier * req?.body?.amount).toFixed(2));
        const cmeterLiability = -Number((multiplier * req?.body?.amount).toFixed(2));

        if (req.body?.gType === "cmeter1") {
            uiAmountCal = isLay ? cmeterLiability : cmeterProfit;
        } else {
            uiAmountCal = isLay ? amountCal : profitCal;
        }

        if (isNaN(uiAmountCal)) uiAmountCal = 0;

        newAbovePL = oldAbovePL + uiAmountCal; 
        newBelowPL = newAbovePL;
        // profitCal logic for partner is simpler
        newProfit = oldProfit + (isLay ? req?.body?.amount : cmeterProfit); 
    }

    const newEntry = {
        sid: req?.body?.sectionId,
        amount: newAbovePL,
        profit: newProfit,
        abovePL: newAbovePL,
        belowPL: newBelowPL,
        subId: req?.body?.subId,
        subType: req?.body?.subType || "mogambo"
    };

    if (idx > -1) {
        spotsData[idx] = newEntry;
    } else {
        spotsData.push(newEntry);
    }
    
    // Updated Cross-Section Display for Balanced Markets (Mogambo, CMeter1)
    if ((req.body.gType === "mogambo" && req.body.subType === "mogambo") || req.body.gType === "cmeter1") {
        if (sectionRecord) {
            sectionRecord.forEach(item => {
                if (item.sid != req.body.sectionId) {
                    const otherIdx = spotsData.findIndex(s => s.sid == item.sid);
                    let otherPitting = isLay ? Number(req.body.amount) : -Number(req.body.amount);
                    
                    if (req.body.gType === "cmeter1") {
                        const multiplier = parseFloat(odds) - 1;
                        otherPitting = isLay ? Number(req.body.amount) : -Number((multiplier * req.body.amount).toFixed(2));
                    }

                    if (otherIdx > -1) {
                        spotsData[otherIdx].amount += otherPitting;
                        spotsData[otherIdx].abovePL = (spotsData[otherIdx].abovePL || 0) + otherPitting;
                        spotsData[otherIdx].belowPL = (spotsData[otherIdx].belowPL || 0) + otherPitting;
                    } else {
                        spotsData.push({ 
                            sid: item.sid, 
                            amount: otherPitting, 
                            abovePL: otherPitting, 
                            belowPL: otherPitting,
                            subId: item.subId || 0,
                            subType: req?.body?.subType || "mogambo"
                        });
                    }
                }
            });
        }
    }

    // --- ACCURATE RISK DELTA CALCULATION ---
    // User Exposure Delta = New Min PL - Old Min PL
    const currentSubType = req.body.subType || "mogambo";
    
    const oldAmounts = (findSpotsData?.sdata || [])
        .filter(s => (s.subType || "mogambo") === currentSubType)
        .map(s => Number(s.amount || 0));
    const oldMinPL = oldAmounts.length > 0 ? Math.min(0, ...oldAmounts) : 0;
    
    const newAmounts = spotsData
        .filter(s => (s.subType || "mogambo") === currentSubType)
        .map(s => Number(s.amount || 0));
    const newMinPL = newAmounts.length > 0 ? Math.min(0, ...newAmounts) : 0;
    
    // Safety Fallback: The exposure delta must be at least the negative of the current stake 
    // UNLESS the bet actually improves the user's position (e.g. hedging).
    // In Mogambo, every BACK bet on any runner increases the total risk.
    const calculatedDelta = Number((newMinPL - oldMinPL).toFixed(2));
    const stakeDelta = -Number(req.body.amount || 0);
    
    // We take the worst-case (most negative) of the calculated delta vs the stake.
    // This prevents "Free Bets" where the delta is 0 because of miscalculated scenarios.
    const exposureDelta = Math.min(calculatedDelta, stakeDelta);

    // Partner Exposure Delta = New Max Player Profit - Old Max Player Profit
    // CRITICAL: This represents the PARENT'S LIABILITY, so it must be NEGATIVE when profit increases.
    const oldMaxProfit = oldAmounts.length > 0 ? Math.max(0, ...oldAmounts) : 0;
    const newMaxProfit = newAmounts.length > 0 ? Math.max(0, ...newAmounts) : 0;
    const partnerDelta = -Number((newMaxProfit - oldMaxProfit).toFixed(2));

    return { 
        spotsData, 
        expBal: exposureDelta, 
        partnerExpBal: partnerDelta 
    };
};

module.exports = { handleCasinoFancyBet };
