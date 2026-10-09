const { createBet } = require("../bet.helper");
const {
    distributeCommissionHierarchy,
} = require("../../../helpers/utils");
const { setCache } = require("../../../helpers/cache");
const APIResponse = require("../../../helpers/APIResponse");
const httpStatus = require("http-status");
const { updateSportsData } = require("../../sports-data/sports-data.helper");

const handleRandomBet = async (
    req,
    findSpotsData,
    expBal,
    partnerExpBal,
    id,
    user,
    eventType,
    odds,
    section
) => {
    let spotsData = [];
    if (["Fancy", "fancy", "Fancy"].includes(eventType)) {
        const currentRandomBetAmount = req?.body?.amount * req?.body?.ucard?.length;
        const profitCal = Number(
            ((parseFloat(odds) - 1) * currentRandomBetAmount).toFixed(2)
        );
        spotsData = findSpotsData?.sdata ? [...findSpotsData.sdata] : [];
        const targetSidStr = String(req?.body?.sectionId);
        const targetSubIdStr = String(req?.body?.subId || 0);

        const matchingEntries = spotsData.filter(
            (s) => String(s.sid) === targetSidStr && String(s?.subId || 0) === targetSubIdStr
        );
        const oldAmt = matchingEntries.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
        const oldProfit = matchingEntries.reduce((sum, entry) => sum + (Number(entry.profit) || 0), 0);

        const newEntry = {
            sid: req?.body?.sectionId,
            amount: oldAmt + -currentRandomBetAmount,
            profit: oldProfit + profitCal,
            subId: req?.body?.subId,
        };

        spotsData = spotsData.filter(
            (s) => !(String(s.sid) === targetSidStr && String(s?.subId || 0) === targetSubIdStr)
        );
        spotsData.push(newEntry);

        expBal = expBal - oldAmt + newEntry.amount;
        partnerExpBal = partnerExpBal - oldProfit + newEntry.profit;
    }
    const bets = [];
    for (let i = 0; i < req.body.ucard.length; i++) {
        const card = req.body.ucard[i];
        const betData = {
            ...req.body,
            uRate: odds,
            eType: eventType,
            sectionName: `${section?.nat} ${card?.join()}`,
            userId: id,
            selected: card?.join(),
            ip: req.clientIp || "",
            browserDetails: req.headers["user-agent"] || "",
            domain: req?.domainConfig?.domain,
        };
        bets.push(betData);
    }
    
    return { bets, spotsData, expBal, partnerExpBal };
};

module.exports = { handleRandomBet };
