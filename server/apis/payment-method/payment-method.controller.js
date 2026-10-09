const httpStatus = require("http-status");
const APIError = require("../../helpers/APIError");
const APIResponse = require("../../helpers/APIResponse");
const {
  createOrUpdatePaymentMethod: createOrUpdateHelper,
  getAllPaymentMethods,
  getPaymentMethodById,
  getPaymentMethodByName,
  deletePaymentMethod,
} = require("./payment-method.helper");
const transactionModel = require("../transaction/transaction.model");
const { deleteFile } = require("../../helpers/utils");

const createOrUpdate = async (req, res, next) => {
  try {
    const body = req.body;
    let paymentMethodd = null;

    if (body._id) {
      paymentMethodd = await getPaymentMethodById(body._id);
    }

    if (!["UPI", "IMPS","CRYPTO"].includes(body?.type)) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError("Invalid payment method type", httpStatus.BAD_REQUEST)
        );
    }

    if (req.files?.image) {
      if (paymentMethodd?.image) {
        deleteFile(paymentMethodd.image);
      }

      body.image = `/uploads/payment-methods/${req.files.image[0].filename}`;
    }

    const paymentMethod = await createOrUpdateHelper({
      ...body,
      createdBy: req.user?._id,
    });

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          paymentMethod,
          "Payment method created/updated successfully",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(err);
  }
};

const getMethods = async (req, res, next) => {
  try {
    const { _id } = req.user;
    const filter = { createdBy: _id };
    const { search } = req.query;

    if (search && search.trim() !== "") {
      const regex = new RegExp(search, "i");
      filter.$or = [
        { type: regex },
        { title: regex },
        { description: regex },
        { upiId: regex },
        { bankName: regex },
        { accountHolder: regex },
        { accountNumber: regex },
        { ifscCode: regex },
        { walletAddress: regex },
        { network: regex },
      ];
    }
    const methods = await getAllPaymentMethods(filter);
    res
      .status(httpStatus.OK)
      .send(new APIResponse(methods, "Payment methods fetched", httpStatus.OK));
  } catch (err) {
    next(err);
  }
};

const getMethodById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const method = await getPaymentMethodById(id);

    if (!method) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("Payment method not found", httpStatus.NOT_FOUND));
    }

    res
      .status(httpStatus.OK)
      .send(new APIResponse(method, "Payment method fetched", httpStatus.OK));
  } catch (err) {
    next(err);
  }
};

const getMethodByName = async (req, res, next) => {
  try {
    const { name } = req.params;
    const method = await getPaymentMethodByName(name);

    if (!method) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("Payment method not found", httpStatus.NOT_FOUND));
    }

    res
      .status(httpStatus.OK)
      .send(new APIResponse(method, "Payment method fetched", httpStatus.OK));
  } catch (err) {
    next(err);
  }
};
const getMethodByPartner = async (req, res, next) => {
  try {
    const { parent } = req.user;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const method = await getAllPaymentMethods({ createdBy: parent });

    if (!method) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("Payment method not found", httpStatus.NOT_FOUND));
    }
    const txns = await transactionModel.aggregate([
      {
        $match: {
          methodId: { $in: method.map((m) => m._id) },
          createdAt: { $gte: todayStart, $lte: todayEnd },
        },
      },
      {
        $group: {
          _id: "$methodId",
          totalAmount: { $sum: "$amount" },
        },
      },
    ]);

    const txnMap = txns.reduce((acc, cur) => {
      acc[cur._id.toString()] = cur.totalAmount;
      return acc;
    }, {});
    const availableMethods = method.filter((m) => {
      if (m.type !== "UPI") return true;
      const used = txnMap[m._id.toString()] || 0;
      return !m.upiLimitPerDay || used < m.upiLimitPerDay;
    });

    // return available;
    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          availableMethods,
          "Payment method fetched",
          httpStatus.OK
        )
      );
  } catch (err) {
    next(err);
  }
};
const removeMethod = async (req, res, next) => {
  try {
    const { id } = req.params;

    const method = await deletePaymentMethod(id);
    if (!method) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("Payment method not found", httpStatus.NOT_FOUND));
    }

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(method, "Payment method deactivated", httpStatus.OK)
      );
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createOrUpdate,
  getMethods,
  getMethodById,
  getMethodByName,
  removeMethod,
  getMethodByPartner,
};
