const {
  depositBalance,
  withdrawBalance,
  transferBalance,
  getUserTransactions,
  saveWalletTransaction,
  getPaymentRequestById,
  transferBalanceUsingGateway,
  getTransactionsStatement,
  getWithdrawDepositRequest,
  withdrawBalanceUsingGateway,
  getUserAllTransactions,
} = require("./transaction.helper");
const APIResponse = require("../../helpers/APIResponse");
const httpStatus = require("http-status");
const {
  getPaymentMethodById,
} = require("../payment-method/payment-method.helper");
const APIError = require("../../helpers/APIError");
const { getUser, updateUser, User } = require("../users/users.helper");
const transactionModel = require("./transaction.model");

const adminDeposit = async (req, res, next) => {
  try {
    const { userId, amount, remarks } = req.body;
    await depositBalance(userId, amount, userId, req.user.username, remarks);
    res
      .status(httpStatus.OK)
      .send(new APIResponse({}, "Deposit successful", httpStatus.OK));
  } catch (e) {
    next(e);
  }
};

const depositToUser = async (req, res, next) => {
  try {
    const { userId, amount, remarks } = req.body;
    await transferBalance(req.user._id, userId, amount, remarks);
    const user = await User.findById(userId).select("balance");
    await updateUser(
      { _id: userId },
      {
        $set: {
          exp_limit: Number(user.balance),
        },
      }
    );
    res
      .status(httpStatus.OK)
      .send(new APIResponse({}, "Deposit successful", httpStatus.OK));
  } catch (e) {
    console.log("depositerror",e);
    next(e);
  }
};

const withdrawFromUser = async (req, res, next) => {
  try {
    const { userId, amount, remarks } = req.body;
    await transferBalance(userId, req.user._id, amount, remarks);
    res
      .status(httpStatus.OK)
      .send(new APIResponse({}, "Withdrawal successful", httpStatus.OK));
  } catch (e) {
    next(e);
  }
};

const getAccountStatement = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { startDate, endDate } = req.query;

    const transactions = await getUserTransactions(userId, startDate, endDate);

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          transactions,
          "Account statement fetched successfully",
          httpStatus.OK
        )
      );
  } catch (e) {
    next(e);
  }
};

const handleTransactions = async (req, res, next) => {
  try {
    let { transactions } = req.body;

    if (!Array.isArray(transactions)) {
      transactions = [transactions];
    }

    for (const t of transactions) {
      const { userId, amount, type } = t;

      if (!userId || !amount || !type) {
        return res
          .status(httpStatus.BAD_REQUEST)
          .send(
            new APIResponse(
              {},
              "Each transaction requires userId, amount, and type",
              httpStatus.BAD_REQUEST
            )
          );
      }

      if (!["deposit", "withdraw"].includes(type)) {
        return res
          .status(httpStatus.BAD_REQUEST)
          .send(
            new APIResponse(
              {},
              "Transaction type must be 'deposit' or 'withdraw'",
              httpStatus.BAD_REQUEST
            )
          );
      }
      if (type === "deposit") {
        await transferBalance(req.user._id, userId, amount, "Settlement", [
          "adjustment",
          "adjustment",
        ]);
      } else {
        await transferBalance(req.user._id, userId, amount, "Settlement", [
          "adjustment",
          "adjustment",
        ]);
      }
    }

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          {},
          "Transactions processed successfully",
          httpStatus.OK
        )
      );
  } catch (error) {
    next(error);
  }
};

//beforecrypto
// const paymentRequest = async (req, res, next) => {
//   try {
//     const { methodId, amount, utr, remarks, transactionId } = req.body;

//     const method = await getPaymentMethodById(methodId);
//     if (!method) {
//       return res
//         .status(httpStatus.NOT_FOUND)
//         .json(new APIError("Payment method not found", httpStatus.NOT_FOUND));
//     }

//     if (amount < method.minAmount || amount > method.maxAmount) {
//       return res
//         .status(httpStatus.BAD_REQUEST)
//         .json(
//           new APIError(
//             `Amount must be between ${method.minAmount} and ${method.maxAmount}`,
//             httpStatus.BAD_REQUEST
//           )
//         );
//     }

//     if (method.type === "UPI" && method.upiLimitPerDay) {
//       const todayStart = new Date();
//       todayStart.setHours(0, 0, 0, 0);
//       const todayEnd = new Date();
//       todayEnd.setHours(23, 59, 59, 999);

//       const totalTxn = await transactionModel.aggregate([
//         {
//           $match: {
//             methodId: method._id,
//             createdAt: { $gte: todayStart, $lte: todayEnd },
//           },
//         },
//         {
//           $group: { _id: null, total: { $sum: "$amount" } },
//         },
//       ]);

//       const usedAmount = totalTxn[0]?.total || 0;
//       const remainingLimit = method.upiLimitPerDay - usedAmount;

//       if (usedAmount >= method.upiLimitPerDay) {
//         return res
//           .status(httpStatus.BAD_REQUEST)
//           .json(
//             new APIError(
//               `Daily UPI limit reached (₹${method.upiLimitPerDay}). Try again tomorrow.`,
//               httpStatus.BAD_REQUEST
//             )
//           );
//       }

//       if (amount > remainingLimit) {
//         return res
//           .status(httpStatus.BAD_REQUEST)
//           .json(
//             new APIError(
//               `You can deposit only ₹${remainingLimit} more today via this UPI.`,
//               httpStatus.BAD_REQUEST
//             )
//           );
//       }
//     }
//     const user = await getUser({ _id: req.user?.parent });
//     user.depositRequestsCount += 1;
//     await user.save();
//     const payment = await saveWalletTransaction({
//       userId: req.user._id,
//       methodId,
//       amount,
//       utr,
//       remarks,
//       transactionId,
//       type: "deposit",
//     });

//     res
//       .status(httpStatus.OK)
//       .send(
//         new APIResponse(payment, "Manual payment submitted", httpStatus.OK)
//       );
//   } catch (error) {
//     next(error);
//   }
// };

const paymentRequest = async (req, res, next) => {
  try {
    const { methodId, amount, utr, remarks, transactionId } = req.body;

    const method = await getPaymentMethodById(methodId);
    if (!method) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("Payment method not found", httpStatus.NOT_FOUND));
    }
    if (method.type === "CRYPTO" && !transactionId) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "Transaction hash is required",
            httpStatus.BAD_REQUEST
          )
        );
    }

    if (method.type !== "CRYPTO" &&(amount < method.minAmount || amount > method.maxAmount)) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            `Amount must be between ${method.minAmount} and ${method.maxAmount}`,
            httpStatus.BAD_REQUEST
          )
        );
    }

    if (method.type === "UPI" && method.upiLimitPerDay) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const totalTxn = await transactionModel.aggregate([
        {
          $match: {
            methodId: method._id,
            createdAt: { $gte: todayStart, $lte: todayEnd },
          },
        },
        {
          $group: { _id: null, total: { $sum: "$amount" } },
        },
      ]);

      const usedAmount = totalTxn[0]?.total || 0;
      const remainingLimit = method.upiLimitPerDay - usedAmount;

      if (usedAmount >= method.upiLimitPerDay) {
        return res
          .status(httpStatus.BAD_REQUEST)
          .json(
            new APIError(
              `Daily UPI limit reached (₹${method.upiLimitPerDay}). Try again tomorrow.`,
              httpStatus.BAD_REQUEST
            )
          );
      }

      if (amount > remainingLimit) {
        return res
          .status(httpStatus.BAD_REQUEST)
          .json(
            new APIError(
              `You can deposit only ₹${remainingLimit} more today via this UPI.`,
              httpStatus.BAD_REQUEST
            )
          );
      }
    }
    const user = await getUser({ _id: req.user?.parent });
    user.depositRequestsCount += 1;
    await user.save();
    const payment = await saveWalletTransaction({
      userId: req.user._id,
      methodId,
      amount,
      utr,
      remarks,
      transactionId,
      type: "deposit",
    });

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(payment, "Manual payment submitted", httpStatus.OK)
      );
  } catch (error) {
    next(error);
  }
};

const withdrawRequest = async (req, res, next) => {
  try {
    const { methodId, amount, remarks } = req.body;

    if (!amount || amount <= 0) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError("Invalid withdrawal amount", httpStatus.BAD_REQUEST)
        );
    }

    const method = await getPaymentMethodById(methodId);
    if (!method) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("Payment method not found", httpStatus.NOT_FOUND));
    }
    // --- ATOMIC FINANCE UPDATE (REQUEST TIME) ---
    const { atomicUpdateUserFinance } = require("../../helpers/finance.helper");
    
    // We deduct the amount from the user's balance at the time of request.
    // atomicUpdateUserFinance will throw if (balance - amount) + exp < 0.
    const updatedUser = await atomicUpdateUserFinance(req.user._id, { balance: -amount });

    const before = updatedUser.balance + amount;
    const payment = await saveWalletTransaction({
      userId: req.user._id,
      methodId,
      amount: -amount,
      before,
      after: updatedUser.balance,
      remarks,
      type: "withdraw",
      status: "pending",
    });

    const parent = await getUser({ _id: req.user?.parent });
    parent.withdrawRequestsCount += 1;
    await parent.save();
    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(payment, "Withdraw request submitted", httpStatus.OK)
      );
  } catch (error) {
    next(error);
  }
};

const verifyDepositRequest = async (req, res, next) => {
  try {
    const { paymentId, status, adminRemarks } = req.body;

    const payment = await getPaymentRequestById(paymentId);

    if (!payment) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("Payment not found", httpStatus.NOT_FOUND));
    }

    if (payment.status !== "pending") {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(new APIError("Payment already verified", httpStatus.BAD_REQUEST));
    }
    const remarks =
      adminRemarks?.length > 0 ? adminRemarks : ` deposit approved`;
    await transferBalanceUsingGateway(
      req.user._id,
      payment.userId._id,
      payment.amount,
      remarks,
      ["transfer", "deposit"],
      paymentId,
      adminRemarks,
      status,
      payment?.utr
    );

    res
      .status(httpStatus.OK)
      .send(new APIResponse(payment, `Payment ${status}`, httpStatus.OK));
  } catch (error) {
    next(error);
  }
};
const verifyWithdrawRequest = async (req, res, next) => {
  try {
    const { paymentId, status, adminRemarks, transactionId } = req.body;

    const payment = await getPaymentRequestById(paymentId);

    if (!payment) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("Payment not found", httpStatus.NOT_FOUND));
    }

    if (payment.status !== "pending") {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(new APIError("Payment already verified", httpStatus.BAD_REQUEST));
    }
    const remarks =
      adminRemarks?.length > 0 ? adminRemarks : `withdraw approved`;
    await withdrawBalanceUsingGateway(
      payment.userId._id,
      req.user._id,
      payment.amount,
      remarks,
      ["transfer", "withdraw"],
      paymentId,
      adminRemarks,
      status,
      transactionId
    );

    res
      .status(httpStatus.OK)
      .send(new APIResponse(payment, `Payment ${status}`, httpStatus.OK));
  } catch (error) {
    next(error);
  }
};
const getDepositStatement = async (req, res, next) => {
  try {
    const { _id } = req.user;
    const { startDate, endDate, status, page, limit, search } = req.query;
    const now = new Date();

    const start = startDate
      ? new Date(new Date(startDate).setHours(0, 0, 0, 0))
      : new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);

    const end = endDate
      ? new Date(new Date(endDate).setHours(23, 59, 59, 999))
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const filter = {
      userId: _id,
      createdAt: { $gte: start, $lte: end },
      methodId: { $exists: true },
      type: "deposit",
    };

    if (status) filter.status = status;

    const result = await getTransactionsStatement(filter, {
      page,
      limit,
      search,
    });

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          result,
          "Deposit statement fetched successfully",
          httpStatus.OK
        )
      );
  } catch (e) {
    next(e);
  }
};
const getDepositWithdrawReport = async (req, res, next) => {
  try {
    const { _id } = req.user;
    const { status, search, type, startDate, endDate, page, limit } = req.query;
    const filter = {
      methodId: { $exists: true },
    };

    if (status?.length > 0) {
      filter.status = status;
    }

    if (type?.length > 0) {
      filter.type = type;
    }
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) {
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = endOfDay;
      }
    }
    const result = await getWithdrawDepositRequest(
      filter,
      _id,
      search,
      undefined,
      page,
      limit
    );

    if (page && limit) {
      const { data, metadata, stats } = result;
      const total = metadata[0]?.total || 0;
      return res.status(httpStatus.OK).send(
        new APIResponse(
          {
            docs: data,
            total,
            page: Number(page),
            limit: Number(limit),
            stats: stats[0] || {},
          },
          "Deposit-Withdraw report fetched successfully",
          httpStatus.OK
        )
      );
    }

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          result,
          "Deposit-Withdraw report fetched successfully",
          httpStatus.OK
        )
      );
  } catch (e) {
    next(e);
  }
};
const getWithdrawStatement = async (req, res, next) => {
  try {
    const { _id } = req.user;
    const { startDate, endDate, status, page, limit, search } = req.query;
    const now = new Date();

    const start = startDate
      ? new Date(new Date(startDate).setHours(0, 0, 0, 0))
      : new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);

    const end = endDate
      ? new Date(new Date(endDate).setHours(23, 59, 59, 999))
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const filter = {
      userId: _id,
      createdAt: { $gte: start, $lte: end },
      methodId: { $exists: true },
      type: "withdraw",
    };

    if (status) filter.status = status;

    const result = await getTransactionsStatement(filter, {
      page,
      limit,
      search,
    });

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          result,
          "Withdraw statement fetched successfully",
          httpStatus.OK
        )
      );
  } catch (e) {
    next(e);
  }
};

const getDepositRequest = async (req, res, next) => {
  try {
    // const { userId } = req.params;
    const { startDate, endDate, search, status, method, page, limit } =
      req.query;
    const now = new Date();
    const start = startDate
      ? new Date(startDate)
      : new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);

    const end = endDate
      ? new Date(endDate)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const filter = {
      // createdAt: { $gte: start, $lte: end },
      type: "deposit",
      methodId: { $exists: true },
    };
    if (status?.length > 0) {
      filter.status = status;
    }
    const transactions = await getWithdrawDepositRequest(
      filter,
      req.user._id,
      search,
      method,
      page,
      limit
    );

    if (page && limit) {
      const { data, metadata, stats } = transactions;
      const total = metadata[0]?.total || 0;
      return res.status(httpStatus.OK).send(
        new APIResponse(
          {
            docs: data,
            total,
            page: Number(page),
            limit: Number(limit),
            stats: stats[0] || {},
          },
          "Deposit Request fetched successfully",
          httpStatus.OK
        )
      );
    }

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          transactions,
          "Deposit Request fetched successfully",
          httpStatus.OK
        )
      );
  } catch (e) {
    next(e);
  }
};

const getWithdrawRequest = async (req, res, next) => {
  try {
    // const { userId } = req.params;
    const { startDate, endDate, search, status, method } = req.query;
    const now = new Date();
    const start = startDate
      ? new Date(startDate)
      : new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);

    const end = endDate
      ? new Date(endDate)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const filter = {
      // createdAt: { $gte: start, $lte: end },
      type: "withdraw",
      methodId: { $exists: true },
    };
    if (status?.length > 0) {
      filter.status = status;
    }
    const transactions = await getWithdrawDepositRequest(
      filter,
      req.user._id,
      search,
      method
    );

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          transactions,
          "Withdraw request fetched successfully",
          httpStatus.OK
        )
      );
  } catch (e) {
    next(e);
  }
};

const getUserHistory = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const transactions = await getUserAllTransactions(userId);
    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          transactions,
          "User transaction history fetched successfully",
          httpStatus.OK
        )
      );
  } catch (e) {
    next(e);
  }
};

module.exports = {
  adminDeposit,
  depositToUser,
  withdrawFromUser,
  getAccountStatement,
  handleTransactions,
  paymentRequest,
  getWithdrawRequest,
  getDepositRequest,
  getWithdrawStatement,
  getDepositStatement,
  withdrawRequest,
  verifyWithdrawRequest,
  verifyDepositRequest,
  getDepositWithdrawReport,
  getUserHistory,
};
