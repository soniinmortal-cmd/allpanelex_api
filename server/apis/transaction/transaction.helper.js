const transactionModel = require("./transaction.model");
const { getUser, User } = require("../users/users.helper");
const APIError = require("../../helpers/APIError");
const httpStatus = require("http-status");
const mongoose = require("mongoose");

const getWallet = async (userId) => {
  const user = await getUser({ _id: userId });
  if (!user) throw new APIError("User not found", httpStatus.NOT_FOUND);
  return user;
};

const saveWalletTransaction = async ({
  methodId,
  utr,
  transactionId,
  userId,
  type,
  amount,
  before,
  after,
  createdBy,
  remarks,
}) => {
  await transactionModel.create({
    userId,
    type,
    amount,
    balanceBefore: before,
    balanceAfter: after,
    createdBy,
    remarks,
    methodId,
    utr,
    transactionId,
  });
};

const depositBalance = async (
  targetUserId,
  amount,
  createdBy,
  username,
  remarks
) => {
  const { atomicUpdateUserFinance } = require("../../helpers/finance.helper");
  const before = await getWallet(targetUserId).then(u => u.balance);
  
  const user = await atomicUpdateUserFinance(targetUserId, { balance: amount });

  await saveWalletTransaction({
    userId: user._id,
    type: "deposit",
    amount,
    before,
    after: user.balance,
    createdBy,
    remarks: `Deposit by ${username}: ${remarks || ""}`,
  });

  return user;
};

const withdrawBalance = async (
  targetUserId,
  amount,
  createdBy,
  username,
  remarks
) => {
  const { atomicUpdateUserFinance } = require("../../helpers/finance.helper");
  const before = await getWallet(targetUserId).then(u => u.balance);

  // atomicUpdateUserFinance will throw "Insufficient funds" if balance + exp < 0
  const user = await atomicUpdateUserFinance(targetUserId, { balance: -amount });

  await saveWalletTransaction({
    userId: user._id,
    type: "withdraw",
    amount: -amount,
    before,
    after: user.balance,
    createdBy,
    remarks: `Withdraw by ${username}: ${remarks || ""}`,
  });

  return user;
};

const transferBalance = async (
  fromUserId,
  toUserId,
  amount,
  remarks,
  transactionType = ["transfer", "deposit"]
  ) => {
  const { atomicUpdateUserFinance } = require("../../helpers/finance.helper");
  const { getSessionIfReplicaSet } = require("../../helpers/db-topology");

  const senderUser = await getWallet(fromUserId);
  const receiverUser = await getWallet(toUserId);

  const senderName = senderUser.username;
  const receiverName = receiverUser.username;

  const senderBefore = await getWallet(fromUserId).then(u => u.balance);
  const receiverBefore = await getWallet(toUserId).then(u => u.balance);

  const session = await getSessionIfReplicaSet();
  try {
    let sender, receiver;

    const doTransfer = async (s) => {
      const opts = s ? { session: s } : {};
      sender = await atomicUpdateUserFinance(fromUserId, { balance: -amount }, opts);
      receiver = await atomicUpdateUserFinance(toUserId, { balance: amount }, opts);
      await transactionModel.create([
        {
          userId: sender._id,
          type: transactionType[0] ?? "transfer",
          amount: -amount,
          balanceBefore: senderBefore,
          balanceAfter: sender.balance,
          createdBy: fromUserId,
          status: 'approved',
          remarks: `Transferred to ${receiverName}${remarks?.length > 0 ? ":" : ""}/${remarks}`,
        },
        {
          userId: receiver._id,
          type: transactionType[1] ?? "deposit",
          amount,
          balanceBefore: receiverBefore,
          balanceAfter: receiver.balance,
          createdBy: fromUserId,
          status: 'approved',
          remarks: `Received from ${senderName}${remarks?.length > 0 ? ":" : ""}/${remarks}`,
        },
      ], s ? { session: s } : {});
    };

    if (session) {
      await session.withTransaction(async () => doTransfer(session));
    } else {
      await doTransfer(null);
    }
    return { sender, receiver };
  } finally {
    if (session) await session.endSession();
  }
};

const getUserTransactions = async (userId, startDate, endDate) => {
  const now = new Date();
  const start = startDate
    ? new Date(new Date(startDate).setHours(0, 0, 0, 0))
    : new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
  const end = endDate
    ? new Date(new Date(endDate).setHours(23, 59, 59, 999))
    : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const filter = {
    userId,
    createdAt: { $gte: start, $lte: end },
    status: "approved",
    type: { $nin: ["correction", "reconciliation","commission"] },
  };

  const transactions = await transactionModel
    .find(filter)
    .populate("createdBy", "_id username")
    .populate("userId", "_id username")
    .populate("methodId")
    .sort({ createdAt: 1 })
    .lean();

  let openingBalance = 0;
  const lastBefore = await transactionModel.aggregate([
    {
      $match: {
        userId: mongoose.Types.ObjectId(userId),
        createdAt: { $lt: start },
        status: "approved",
      },
    },
    {
      $group: {
        _id: "$userId",
        totalAmount: { $sum: "$amount" },
      },
    },
  ]);

  if (lastBefore?.length > 0) {
    openingBalance = lastBefore[0].totalAmount ?? 0;
  } else {
    openingBalance = 0;
  }

  if (isNaN(openingBalance) || openingBalance == null) {
    openingBalance = 0;
  }

  transactions.unshift({
    _id: "opening_balance",
    type: "opening",
    amount: openingBalance,
    balanceBefore: openingBalance,
    balanceAfter: openingBalance,
    remarks: `Opening balance as of ${start.toLocaleDateString("en-GB")}`,
    createdAt: start,
    createdBy: null,
    userId,
    isSynthetic: true,
  });

  let runningTotal = 0;
  const transactionsWithPts = transactions.map((tx) => {
    runningTotal += tx.amount;
    return {
      ...tx,
      pts: runningTotal,
    };
  });

  return transactionsWithPts;
};

const getTransactionsStatement = async (
  filter,
  { page = 1, limit = 10, search }
) => {
  const skip = (page - 1) * limit;

  const query = { ...filter };
  // Force exclude system types
  if (query.type) {
    if (["correction", "reconciliation"].includes(query.type)) {
      query.type = "__HIDDEN__";
    }
  } else {
    query.type = { $nin: ["correction", "reconciliation"] };
  }

  if (search) {
    const searchNumber = Number(search);

    query.$or = [
      { status: { $regex: search, $options: "i" } },
      { remarks: { $regex: search, $options: "i" } },
    ];

    if (!isNaN(searchNumber)) {
      query.$or.push({ amount: searchNumber });
    }
  }

  const [transactions, total] = await Promise.all([
    transactionModel
      .find(query)
      .populate("createdBy", "_id username")
      .populate("userId", "_id username")
      .populate("methodId", "_id title type bankName upiId")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
    transactionModel.countDocuments(query),
  ]);

  return { transactions, total, page: Number(page), limit: Number(limit) };
};

const getWithdrawDepositRequest = async (
  filter,
  user_id,
  search,
  method,
  page,
  limit
) => {
  const query = { ...filter };
  if (query.type) {
    if (["correction", "reconciliation"].includes(query.type)) {
      query.type = "__HIDDEN__";
    }
  } else {
    query.type = { $nin: ["correction", "reconciliation"] };
  }
  const pipeline = [{ $match: query }];

  pipeline.push(
    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
    { $match: { "user.parent": user_id } }
  );

  pipeline.push(
    {
      $lookup: {
        from: "paymentmethods",
        localField: "methodId",
        foreignField: "_id",
        as: "paymentMethod",
      },
    },
    { $unwind: { path: "$paymentMethod", preserveNullAndEmptyArrays: true } }
  );

  if (search && search.trim() !== "") {
    const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "i");

    pipeline.push({
      $match: {
        $or: [
          { "user.username": regex },
          { transactionId: regex },
          { utr: regex },
          { "paymentMethod.accountNumber": regex },
          { "paymentMethod.ifscCode": regex },
          { "paymentMethod.accountHolder": regex },
          { "paymentMethod.upiId": regex },
          { "paymentMethod.bankName": regex },
        ],
      },
    });
  }

  if (method && method.trim() !== "") {
    pipeline.push({
      $match: { "paymentMethod.type": method },
    });
  }
  pipeline.push(
    { $sort: { createdAt: -1 } },
    {
      $project: {
        _id: 1,
        amount: 1,
        type: 1,
        createdAt: 1,
        transactionId: 1,
        utr: 1,
        status: 1,
        remarks: 1,
        "user._id": 1,
        "user.username": 1,
        "paymentMethod._id": 1,
        "paymentMethod.type": 1,
        "paymentMethod.ifscCode": 1,
        "paymentMethod.upiId": 1,
        "paymentMethod.bankName": 1,
        "paymentMethod.accountHolder": 1,
        "paymentMethod.accountNumber": 1,
      },
    }
  );

  if (page && limit) {
    const skip = (Number(page) - 1) * Number(limit);
    pipeline.push({
      $facet: {
        data: [{ $skip: skip }, { $limit: Number(limit) }],
        metadata: [{ $count: "total" }],
        stats: [
          {
            $group: {
              _id: null,
              totalRequests: { $sum: 1 },
              totalDeposits: {
                $sum: { $cond: [{ $eq: ["$type", "deposit"] }, 1, 0] },
              },
              totalWithdrawals: {
                $sum: { $cond: [{ $eq: ["$type", "withdraw"] }, 1, 0] },
              },
              totalApproved: {
                $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] },
              },
              totalRejected: {
                $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] },
              },
              totalAmount: { $sum: "$amount" },
              approvedAmount: {
                $sum: {
                  $cond: [{ $eq: ["$status", "approved"] }, "$amount", 0],
                },
              },
              rejectedAmount: {
                $sum: {
                  $cond: [{ $eq: ["$status", "rejected"] }, "$amount", 0],
                },
              },
            },
          },
        ],
      },
    });
    const result = await transactionModel.aggregate(pipeline);
    return result[0];
  }

  const transactions = await transactionModel.aggregate(pipeline);
  return transactions;
};

async function deleteManyTransaction(userId) {
  return transactionModel.deleteMany({ userId: userId });
}

async function getPaymentRequestById(id) {
  return transactionModel.findById(id).populate("methodId userId");
}

const transferBalanceUsingGateway = async (
  fromUserId,
  toUserId,
  amount,
  remarks,
  transactionType = ["transfer", "deposit"],
  paymentId,
  adminRemarks,
  status,
  utr
) => {
  const { atomicUpdateUserFinance } = require("../../helpers/finance.helper");
  const { getSessionIfReplicaSet } = require("../../helpers/db-topology");

  const senderUser = await getWallet(fromUserId);
  const receiverUser = await getWallet(toUserId);

  const senderName = senderUser.username;
  const receiverName = receiverUser.username;
  
  const senderBefore = await getWallet(fromUserId).then(u => u.balance);
  const receiverBefore = await getWallet(toUserId).then(u => u.balance);
  
  const session = await getSessionIfReplicaSet();
  try {
    let sender, receiver;

    const doGatewayTransfer = async (s) => {
      const opts = s ? { session: s } : {};
      if (status === "approved") {
        sender = await atomicUpdateUserFinance(fromUserId, { balance: -amount }, opts);
        receiver = await atomicUpdateUserFinance(toUserId, { balance: amount }, opts);
        await User.updateOne({ _id: fromUserId }, { $inc: { depositRequestsCount: -1 } }, opts);
        await transactionModel.create([{
          userId: sender._id,
          type: transactionType[0] ?? "transfer",
          amount: -amount,
          balanceBefore: senderBefore,
          balanceAfter: sender.balance,
          createdBy: fromUserId,
          status: 'approved',
          remarks: `Transferred to ${receiverName}${remarks?.length > 0 ? ":" : ""} ${remarks}`,
        }], s ? { session: s } : {});
      } else {
        sender = await User.findOneAndUpdate({ _id: fromUserId }, { $inc: { depositRequestsCount: -1 } }, { ...opts, new: true });
        receiver = s ? await User.findById(toUserId).session(s) : await User.findById(toUserId);
      }
      await transactionModel.findOneAndUpdate(
        { _id: paymentId },
        {
          userId: receiver._id,
          type: transactionType[1] ?? "deposit",
          balanceBefore: receiverBefore,
          balanceAfter: receiver.balance,
          createdBy: fromUserId,
          verifiedBy: fromUserId,
          adminRemarks: adminRemarks,
          status: status,
          remarks: adminRemarks?.length > 0 ? adminRemarks : `Bank Deposit ${utr}`,
        },
        { ...opts, new: true }
      );
    };

    if (session) {
      await session.withTransaction(async () => doGatewayTransfer(session));
    } else {
      await doGatewayTransfer(null);
    }
    return { sender, receiver };
  } finally {
    if (session) await session.endSession();
  }
};

const withdrawBalanceUsingGateway = async (
  fromUserId,
  toUserId,
  amount,
  remarks,
  transactionType = ["transfer", "deposit"],
  paymentId,
  adminRemarks,
  status,
  transactionId = ""
) => {
  const { atomicUpdateUserFinance } = require("../../helpers/finance.helper");
  const { getSessionIfReplicaSet } = require("../../helpers/db-topology");

  const senderUser = await getWallet(fromUserId);
  const receiverUser = await getWallet(toUserId);

  const senderName = senderUser.username;
  const receiverName = receiverUser.username;

  const senderBefore = await getWallet(fromUserId).then(u => u.balance);
  const receiverBefore = await getWallet(toUserId).then(u => u.balance);

  const session = await getSessionIfReplicaSet();
  try {
    let sender, receiver;

    const doWithdraw = async (s) => {
      const opts = s ? { session: s } : {};
      if (status === "approved") {
        receiver = await atomicUpdateUserFinance(toUserId, { balance: Math.abs(amount) }, opts);
        await User.updateOne({ _id: toUserId }, { $inc: { withdrawRequestsCount: -1 } }, opts);
        sender = s ? await User.findById(fromUserId).session(s) : await User.findById(fromUserId);
        await transactionModel.create([{
          userId: receiver._id,
          type: transactionType[0] ?? "transfer",
          amount: Math.abs(amount),
          balanceBefore: receiverBefore,
          balanceAfter: receiver.balance,
          createdBy: fromUserId,
          status: status,
          adminRemarks: adminRemarks,
          transactionId,
          remarks: adminRemarks?.length > 0 ? adminRemarks : `Transferred to ${receiverName}${remarks?.length > 0 ? ":" : ""} ${remarks}`,
        }], s ? { session: s } : {});
      } else {
        await User.updateOne({ _id: fromUserId }, { $inc: { withdrawRequestsCount: -1 } }, opts);
        sender = await atomicUpdateUserFinance(fromUserId, { balance: Math.abs(amount) }, opts);
        receiver = s ? await User.findById(toUserId).session(s) : await User.findById(toUserId);
      }
      await transactionModel.findOneAndUpdate(
        { _id: paymentId },
        {
          userId: sender._id,
          type: transactionType[1] ?? "deposit",
          balanceBefore: senderBefore,
          balanceAfter: sender.balance,
          amount: status === "rejected" ? 0 : -Math.abs(amount),
          createdBy: fromUserId,
          verifiedBy: fromUserId,
          adminRemarks: adminRemarks,
          status: status,
          transactionId,
          remarks: adminRemarks?.length > 0 ? adminRemarks : (status === "rejected" ? `Withdrawal Rejected` : `Received from ${senderName}${remarks?.length > 0 ? ":" : ""} ${remarks}`),
        },
        { ...opts, new: true }
      );
    };

    if (session) {
      await session.withTransaction(async () => doWithdraw(session));
    } else {
      await doWithdraw(null);
    }
    return { sender, receiver };
  } finally {
    if (session) await session.endSession();
  }
};

const getUserAllTransactions = async (userId) => {
  const transactions = await transactionModel
    .find({
      userId: mongoose.Types.ObjectId(userId),
      type: { $in: ["deposit", "withdraw", "transfer", "adjustment"] },
    })
    // .populate("methodId")
    .sort({ createdAt: 1 })
    .lean();
  return transactions;
};

module.exports = {
  getWallet,
  saveWalletTransaction,
  depositBalance,
  withdrawBalance,
  transferBalance,
  getUserTransactions,
  deleteManyTransaction,
  getPaymentRequestById,
  transferBalanceUsingGateway,
  getTransactionsStatement,
  getWithdrawDepositRequest,
  withdrawBalanceUsingGateway,
  getUserAllTransactions,
};
