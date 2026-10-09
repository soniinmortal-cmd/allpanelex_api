const httpStatus = require("http-status");
const {
  updateButtonSettings,
  getButtonSettings,
  getAllSettings,
} = require("./settings.helper");
const Partnership=require("../partnership/partnership.model");
const {
  findPartnershipByUserAndPartner
} = require("../partnership/partnership.helper");
const User=require("../users/users.model");

const SettingMarket = require("./settingMarkets.model");
const GameSchema = require("../../scripts/gameSchema.model");

const getGameSchemaList = async (req, res, next) => {
  try {
    const games = await GameSchema.find({}).lean();

    return res.status(httpStatus.OK).json({
      data: games,
    });
  } catch (err) {
    console.log("getGameSchemaList error", err);
    next(err);
  }
};



// const getCommissionConfig = async (req, res, next) => {
//   try {
//     const { userId } = req.params;

//     // ------------------------------------------------------------
//     // GET USER
//     // userId is the actual USER ID
//     // ------------------------------------------------------------

//     const user = await User.findById(userId)
//       .select("_id role parent")
//       .lean();

//     if (!user) {
//       return res.status(httpStatus.NOT_FOUND).json({
//         message: "User not found",
//       });
//     }

//     // ------------------------------------------------------------
//     // ALL POSSIBLE COMMISSION TYPES
//     // ------------------------------------------------------------

//     const allCommissionOptions = {
//       bookmaker: [
//         { type: "NONE" },
//         { type: "ENTRY_WISE" },
//         { type: "ENTRY_LOOSING" },
//         { type: "NET_LOOSING" },
//       ],

//       fancy: [
//         { type: "NONE" },
//         { type: "ENTRY_WISE" },
//       ],

//       casino: [
//         { type: "NONE" },
//         { type: "ENTRY_LOOSING" },
//       ],
//     };

//     // ------------------------------------------------------------
//     // OWNER / SADMIN
//     // Return every possible option
//     // ------------------------------------------------------------

//     if (user.role === "owner" || user.role === "sadmin") {
//       return res.status(httpStatus.OK).json({
//         data: allCommissionOptions,
//       });
//     }

//     // ------------------------------------------------------------
//     // GET USER'S ACTUAL CONFIGURATION
//     // ------------------------------------------------------------

//     let userPartnership = null;

//     if (user.parent) {
//       userPartnership = await Partnership.findOne({
//         userId: user._id,
//         partnerId: user.parent,
//       }).lean();
//     }

//     // ------------------------------------------------------------
//     // NORMALIZE COMMISSION
//     // ------------------------------------------------------------

//     const normalizeCommission = (commission) => {
//       if (!commission) {
//         return [];
//       }

//       if (Array.isArray(commission)) {
//         return commission;
//       }

//       return [commission];
//     };

//     // ------------------------------------------------------------
//     // BOOKMAKER
//     // ------------------------------------------------------------

//     const bookmaker = normalizeCommission(
//       userPartnership?.bookmakerCommission
//     ).map((commission) => ({
//       type: commission.type,
//       percentage: Number(commission.percentage || 0),
//     }));

//     // ------------------------------------------------------------
//     // FANCY
//     // ------------------------------------------------------------

//     const fancy = normalizeCommission(
//       userPartnership?.fancyCommission
//     ).map((commission) => ({
//       type: commission.type,
//       percentage: Number(commission.percentage || 0),
//     }));

//     // ------------------------------------------------------------
//     // CASINO
//     // ------------------------------------------------------------

//     const casino = userPartnership?.casinoCommission
//       ? {
//           type: userPartnership.casinoCommission.type,
//           percentage: Number(
//             userPartnership.casinoCommission.percentage || 0
//           ),
//         }
//       : null;

//     // ------------------------------------------------------------
//     // RESPONSE
//     // ------------------------------------------------------------

//     return res.status(httpStatus.OK).json({
//       data: {
//         bookmaker,
//         fancy,
//         casino,
//       },
//     });
//   } catch (err) {
//     console.log("getCommissionConfig error", err);
//     next(err);
//   }
// };


const getCommissionConfig = async (req, res, next) => {
  console.log("getComissionCalled");
  try {
    const { userId } = req.params;
 
    // ------------------------------------------------------------
    // GET USER
    // userId is the actual USER ID
    // ------------------------------------------------------------
 
    // const user = await User.findById(userId)
    //   .select("_id role parent")
    //   .lean();

    const user = await User.findById(userId)
        .select("_id role parent partnershipValue")
        .lean();
 
    if (!user) {
      return res.status(httpStatus.NOT_FOUND).json({
        message: "User not found",
      });
    }

    // ------------------------------------------------------------
    // CALCULATE CUMULATIVE PARTNERSHIP VALUE
    // Current user + all parents up to owner
    // ------------------------------------------------------------

    let partnershipValueShortx = 0;

    if (user.role !== "owner") {
      let currentUser = user;

      while (currentUser) {
        partnershipValueShortx += Number(currentUser.partnershipValue || 0);

        if (!currentUser.parent) {
          break;
        }

        currentUser = await User.findById(currentUser.parent)
          .select("_id role parent partnershipValue")
          .lean();
      }
    }

    let downLineCommission = 0;

    if (user.role === "owner") {
      downLineCommission = 100;
    } else if (user.parent) {
      const userPartnership = await findPartnershipByUserAndPartner(
        user._id,
        user.parent
      );

      downLineCommission = userPartnership?.downLineCommission || 0;
    }

     // CLIENT COUNT
      const client_count = await User.countDocuments({
        parent: user._id,
      });

 
    // ------------------------------------------------------------
    // ALL POSSIBLE COMMISSION TYPES
    // ------------------------------------------------------------
 
    const allCommissionOptions = {
      bookmaker: [
        { type: "NONE" },
        { type: "ENTRY_WISE" },
        { type: "ENTRY_LOOSING" },
        { type: "NET_LOOSING" },
      ],
 
      fancy: [
        { type: "NONE" },
        { type: "ENTRY_WISE" },
      ],
 
      casino: [
        { type: "NONE" },
        { type: "ENTRY_LOOSING" },
      ],
    };
 
    // ------------------------------------------------------------
    // OWNER / SADMIN
    // Return every possible option
    // ------------------------------------------------------------
 
    if (user.role === "owner" || user.role === "sadmin") {
      const responseData = {
        data: allCommissionOptions,
        partnershipValue: user?.partnershipValue || 0,
        partnershipValueShortx: 0,
        client_count,
      };

      return res.status(httpStatus.OK).json(responseData);
    }
 
    // ------------------------------------------------------------
    // GET USER'S ACTUAL CONFIGURATION
    // ------------------------------------------------------------
 
    let userPartnership = null;
 
    if (user.parent) {
      userPartnership = await Partnership.findOne({
        userId: user._id,
        partnerId: user.parent,
      }).lean();
    }
 
    // ------------------------------------------------------------
    // NORMALIZE COMMISSION
    // ------------------------------------------------------------
 
    const normalizeCommission = (commission) => {
      if (!commission) {
        return [];
      }
 
      if (Array.isArray(commission)) {
        return commission;
      }
 
      return [commission];
    };
 
    // ------------------------------------------------------------
    // BOOKMAKER
    // ------------------------------------------------------------
 
    const bookmaker = normalizeCommission(
      userPartnership?.bookmakerCommission
    ).map((commission) => ({
      type: commission.type,
      percentage: Number(commission.percentage || 0),
    }));
 
    // ------------------------------------------------------------
    // FANCY
    // ------------------------------------------------------------
 
    const fancy = normalizeCommission(
      userPartnership?.fancyCommission
    ).map((commission) => ({
      type: commission.type,
      percentage: Number(commission.percentage || 0),
    }));
 
    // ------------------------------------------------------------
    // CASINO
    // ------------------------------------------------------------
 
    const casino = userPartnership?.casinoCommission
      ? {
          type: userPartnership.casinoCommission.type,
          percentage: Number(
            userPartnership.casinoCommission.percentage || 0
          ),
        }
      : null;
 
    // ------------------------------------------------------------
    // RESPONSE
    // ------------------------------------------------------------
 
    // return res.status(httpStatus.OK).json({
    //   data: {
    //     bookmaker,
    //     fancy,
    //     casino,
    //     client_count,
    //     partnershipValue: user?.partnershipValue || 0,
    //   },
    // });
    // ------------------------------------------------------------
      // RESPONSE
      // ------------------------------------------------------------

      const responseData = {
        bookmaker,
        fancy,
        casino,
        client_count,
        partnershipValue: user?.partnershipValue || 0,
        partnershipValueShortx,
      };

      

      return res.status(httpStatus.OK).json({
        data: responseData,
      });
  } catch (err) {
    console.log("getCommissionConfig error", err);
    next(err);
  }
};

const getCommissionOptions = async (req, res, next) => {
  try {
    const { adminId } = req.params;

    // ------------------------------------------------------------
    // GET TARGET USER
    // ------------------------------------------------------------

    const user = await User.findById(adminId)
      .select("_id role parent")
      .lean();

    if (!user) {
      return res.status(httpStatus.NOT_FOUND).json({
        message: "User not found",
      });
    }

    // ------------------------------------------------------------
    // ALL POSSIBLE COMMISSION TYPES
    // ------------------------------------------------------------

    const allCommissionOptions = {
      bookmaker: [
        { type: "NONE" },
        { type: "ENTRY_WISE" },
        { type: "ENTRY_LOOSING" },
        { type: "NET_LOOSING" },
      ],

      fancy: [
        { type: "NONE" },
        { type: "ENTRY_WISE" },
      ],

      casino: [
        { type: "NONE" },
        { type: "ENTRY_LOOSING" },
      ],
    };

    // ------------------------------------------------------------
    // GET USER'S CURRENT PARTNERSHIP
    // ------------------------------------------------------------

    const userPartnership = user.parent
      ? await Partnership.findOne({
          userId: user._id,
          partnerId: user.parent,
        }).lean()
      : null;

    // ------------------------------------------------------------
    // NORMALIZE COMMISSION
    // ------------------------------------------------------------

    const normalizeCommission = (commission) => {
      if (!commission) {
        return [];
      }

      if (Array.isArray(commission)) {
        return commission;
      }

      return [commission];
    };

    const userBookmaker = normalizeCommission(
      userPartnership?.bookmakerCommission
    );

    const userFancy = normalizeCommission(
      userPartnership?.fancyCommission
    );

    const userCasino =
      userPartnership?.casinoCommission || {
        type: "NONE",
        percentage: 0,
      };

    // ------------------------------------------------------------
    // BUILD CASINO OPTIONS
    // ------------------------------------------------------------

    const buildCasinoOptions = (
      availableOptions,
      currentCommission
    ) => {
      return availableOptions.map((option) => {
        if (
          option.type === currentCommission?.type &&
          option.type !== "NONE"
        ) {
          return {
            ...option,
            percentage: Number(
              currentCommission?.percentage || 0
            ),
          };
        }

        return option;
      });
    };

    // ------------------------------------------------------------
    // TARGET ITSELF IS OWNER / SADMIN
    // ------------------------------------------------------------

    if (
      user.role === "owner" ||
      user.role === "sadmin"
    ) {
      return res.status(httpStatus.OK).json({
        data: {
          bookmaker:
            allCommissionOptions.bookmaker.map(
              (option) => {
                const current =
                  userBookmaker.find(
                    (commission) =>
                      commission.type ===
                      option.type
                  );

                if (
                  current &&
                  option.type !== "NONE"
                ) {
                  return {
                    ...option,
                    percentage: Number(
                      current.percentage || 0
                    ),
                  };
                }

                return option;
              }
            ),

          fancy:
            allCommissionOptions.fancy.map(
              (option) => {
                const current =
                  userFancy.find(
                    (commission) =>
                      commission.type ===
                      option.type
                  );

                if (
                  current &&
                  option.type !== "NONE"
                ) {
                  return {
                    ...option,
                    percentage: Number(
                      current.percentage || 0
                    ),
                  };
                }

                return option;
              }
            ),

          casino: buildCasinoOptions(
            allCommissionOptions.casino,
            userCasino
          ),
        },
      });
    }

    // ------------------------------------------------------------
    // NO PARENT
    // ------------------------------------------------------------

    if (!user.parent) {
      return res.status(httpStatus.OK).json({
        data: allCommissionOptions,
      });
    }

    // ------------------------------------------------------------
    // GET PARENT
    // ------------------------------------------------------------

    const parentUser = await User.findById(user.parent)
      .select("_id role parent")
      .lean();

    if (!parentUser) {
      return res.status(httpStatus.NOT_FOUND).json({
        message: "Parent user not found",
      });
    }

    // ------------------------------------------------------------
    // PARENT IS OWNER / SADMIN
    // ------------------------------------------------------------

    if (
      parentUser.role === "owner" ||
      parentUser.role === "sadmin"
    ) {
      return res.status(httpStatus.OK).json({
        data: {
          bookmaker:
            allCommissionOptions.bookmaker.map(
              (option) => {
                const current =
                  userBookmaker.find(
                    (commission) =>
                      commission.type ===
                      option.type
                  );

                if (
                  current &&
                  option.type !== "NONE"
                ) {
                  return {
                    ...option,
                    percentage: Number(
                      current.percentage || 0
                    ),
                  };
                }

                return option;
              }
            ),

          fancy:
            allCommissionOptions.fancy.map(
              (option) => {
                const current =
                  userFancy.find(
                    (commission) =>
                      commission.type ===
                      option.type
                  );

                if (
                  current &&
                  option.type !== "NONE"
                ) {
                  return {
                    ...option,
                    percentage: Number(
                      current.percentage || 0
                    ),
                  };
                }

                return option;
              }
            ),

          casino: buildCasinoOptions(
            allCommissionOptions.casino,
            userCasino
          ),
        },
      });
    }

    // ------------------------------------------------------------
    // GET NORMAL PARENT'S PARTNERSHIP
    // ------------------------------------------------------------

    let parentPartnership = null;

    if (parentUser.parent) {
      parentPartnership =
        await Partnership.findOne({
          userId: parentUser._id,
          partnerId: parentUser.parent,
        }).lean();
    }

    // ------------------------------------------------------------
    // NORMALIZE PARENT COMMISSIONS
    // ------------------------------------------------------------

    const parentBookmaker =
      normalizeCommission(
        parentPartnership?.bookmakerCommission
      );

    const parentFancy =
      normalizeCommission(
        parentPartnership?.fancyCommission
      );

    const parentCasino =
      parentPartnership?.casinoCommission || {
        type: "NONE",
        percentage: 0,
      };

    // ------------------------------------------------------------
    // BUILD OPTIONS
    // ------------------------------------------------------------

    const buildOptions = (
      allOptions,
      parentCommissions,
      userCommissions
    ) => {
      const options = [{ type: "NONE" }];

      const parentTypes = [
        ...new Set(
          parentCommissions
            .map(
              (commission) =>
                commission.type
            )
            .filter(
              (type) =>
                type &&
                type !== "NONE"
            )
        ),
      ];

      for (const type of parentTypes) {
        const option = allOptions.find(
          (item) =>
            item.type === type
        );

        if (!option) {
          continue;
        }

        const current =
          userCommissions.find(
            (commission) =>
              commission.type === type
          );

        if (current) {
          options.push({
            ...option,
            percentage: Number(
              current.percentage || 0
            ),
          });
        } else {
          options.push({
            ...option,
          });
        }
      }

      return options;
    };

    // ------------------------------------------------------------
    // RESPONSE
    // ------------------------------------------------------------

    return res.status(httpStatus.OK).json({
      data: {
        bookmaker: buildOptions(
          allCommissionOptions.bookmaker,
          parentBookmaker,
          userBookmaker
        ),

        fancy: buildOptions(
          allCommissionOptions.fancy,
          parentFancy,
          userFancy
        ),

        casino: buildCasinoOptions(
          parentCasino?.type &&
          parentCasino.type !== "NONE"
            ? [
                { type: "NONE" },
                {
                  type: parentCasino.type,
                },
              ]
            : [{ type: "NONE" }],
          userCasino
        ),
      },
    });
  } catch (err) {
    console.log(
      "getCommissionOptions error",
      err
    );
    next(err);
  }
};

const setCommission = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const {
      bookmaker,
      fancy,
      casino,
    } = req.body;

    // ------------------------------------------------------------
    // GET USER
    // ------------------------------------------------------------

    const user = await User.findById(userId)
      .select("_id username parent role")
      .lean();

    if (!user) {
      return res.status(httpStatus.NOT_FOUND).json({
        message: "User not found",
      });
    }

    // ------------------------------------------------------------
    // GET PARENT
    // ------------------------------------------------------------

    if (!user.parent) {
      return res.status(httpStatus.BAD_REQUEST).json({
        message: "User does not have a parent",
      });
    }

    const admin = await User.findById(user.parent)
      .select("_id username role parent")
      .lean();

    if (!admin) {
      return res.status(httpStatus.NOT_FOUND).json({
        message: "Parent admin not found",
      });
    }

    console.log("\n========== COMMISSION DEBUG START ==========");

    console.log("[DEBUG] Target user:", {
      id: user._id?.toString(),
      username: user.username,
      role: user.role,
      parent: user.parent?.toString(),
    });

    console.log("[DEBUG] Parent/Admin:", {
      id: admin?._id?.toString(),
      username: admin?.username,
      role: admin?.role,
      parent: admin?.parent?.toString(),
    });

    console.log("[DEBUG] Raw request casino:", req.body.casino);

    // ------------------------------------------------------------
    // NORMALIZE COMMISSION
    // ------------------------------------------------------------

    const normalizeCommission = (commission) => {
      if (!commission) {
        return [];
      }

      if (Array.isArray(commission)) {
        return commission;
      }

      return [commission];
    };

    const bookmakerList =
      normalizeCommission(bookmaker);

    const fancyList =
      normalizeCommission(fancy);

    // Casino is a single object
    const casinoConfig = Array.isArray(casino)
    ? casino[0]
    : casino;

    // ------------------------------------------------------------
    // GET PARENT PARTNERSHIP
    // ------------------------------------------------------------

    let parentPartnership = null;

    if (
      admin.role !== "owner" &&
      admin.role !== "sadmin"
    ) {
      parentPartnership =
        await Partnership.findOne({
          userId: admin._id,
          partnerId: admin.parent,
        }).lean();
    }

    // ------------------------------------------------------------
    // PARENT BOOKMAKER
    // ------------------------------------------------------------

    const parentBookmakerCommissions =
      Array.isArray(
        parentPartnership?.bookmakerCommission
      )
        ? parentPartnership.bookmakerCommission
        : parentPartnership?.bookmakerCommission
        ? [
            parentPartnership.bookmakerCommission,
          ]
        : [];

    // ------------------------------------------------------------
    // PARENT FANCY
    // ------------------------------------------------------------

    const parentFancyCommissions =
      Array.isArray(
        parentPartnership?.fancyCommission
      )
        ? parentPartnership.fancyCommission
        : parentPartnership?.fancyCommission
        ? [parentPartnership.fancyCommission]
        : [];

    // ------------------------------------------------------------
    // PARENT CASINO
    // ------------------------------------------------------------

    const parentCasinoCommission =
      parentPartnership?.casinoCommission || {
        type: "NONE",
        percentage: 0,
      };

    // ------------------------------------------------------------
    // ALLOWED TYPES
    // ------------------------------------------------------------

    const allBookmakerTypes = [
      "NONE",
      "ENTRY_WISE",
      "ENTRY_LOOSING",
      "NET_LOOSING",
    ];

    const allFancyTypes = [
      "NONE",
      "ENTRY_WISE",
    ];

    const allCasinoTypes = [
      "NONE",
      "ENTRY_LOOSING",
    ];

    const isOwner =
      admin.role === "owner" ||
      admin.role === "sadmin";

    // ------------------------------------------------------------
    // BOOKMAKER ALLOWED TYPES
    // ------------------------------------------------------------

    const allowedBookmakerTypes = isOwner
      ? allBookmakerTypes
      : [
          "NONE",
          ...parentBookmakerCommissions
            .map(
              (commission) =>
                commission.type
            )
            .filter(
              (type) =>
                type &&
                type !== "NONE"
            ),
        ];

    // ------------------------------------------------------------
    // FANCY ALLOWED TYPES
    // ------------------------------------------------------------

    const allowedFancyTypes = isOwner
      ? allFancyTypes
      : [
          "NONE",
          ...parentFancyCommissions
            .map(
              (commission) =>
                commission.type
            )
            .filter(
              (type) =>
                type &&
                type !== "NONE"
            ),
        ];

    // ------------------------------------------------------------
    // CASINO ALLOWED TYPES
    // ------------------------------------------------------------

    const allowedCasinoTypes = isOwner
      ? allCasinoTypes
      : [
          "NONE",
          ...(parentCasinoCommission?.type &&
          parentCasinoCommission.type !== "NONE"
            ? [
                parentCasinoCommission.type,
              ]
            : []),
        ];

    // Remove duplicates
    const uniqueBookmakerTypes = [
      ...new Set(
        allowedBookmakerTypes
      ),
    ];

    const uniqueFancyTypes = [
      ...new Set(
        allowedFancyTypes
      ),
    ];

    const uniqueCasinoTypes = [
      ...new Set(
        allowedCasinoTypes
      ),
    ];

    console.log("[DEBUG] Casino parent/permissions:", {
      isOwner,
      parentPartnership: parentPartnership,
      parentCasinoCommission: parentCasinoCommission,
      allCasinoTypes,
      allowedCasinoTypes,
      uniqueCasinoTypes,
    });

    // ------------------------------------------------------------
    // VALIDATE BOOKMAKER
    // ------------------------------------------------------------

    const validatedBookmaker = [];

    for (const commission of bookmakerList) {
      const type =
        commission?.type || "NONE";

      const percentage = Number(
        commission?.percentage ?? 0
      );

      if (
        !uniqueBookmakerTypes.includes(
          type
        )
      ) {
        return res
          .status(httpStatus.BAD_REQUEST)
          .json({
            message: `You cannot assign ${type} bookmaker commission`,
            allowedTypes:
              uniqueBookmakerTypes,
          });
      }

      if (
        !Number.isFinite(percentage) ||
        percentage < 0 ||
        percentage > 100
      ) {
        return res
          .status(httpStatus.BAD_REQUEST)
          .json({
            message:
              "Bookmaker percentage must be between 0 and 100",
          });
      }

      // NONE always saves percentage 0
      if (type === "NONE") {
        validatedBookmaker.push({
          type: "NONE",
          percentage: 0,
        });

        continue;
      }

      // Non-owner cannot exceed parent's percentage
      if (!isOwner) {
        const parentCommission =
          parentBookmakerCommissions.find(
            (commission) =>
              commission.type === type
          );

        if (
          parentCommission &&
          percentage >
            Number(
              parentCommission.percentage || 0
            )
        ) {
          return res
            .status(httpStatus.BAD_REQUEST)
            .json({
              message: `Bookmaker ${type} percentage cannot exceed parent's ${parentCommission.percentage}%`,
              parentPercentage:
                Number(
                  parentCommission.percentage || 0
                ),
            });
        }
      }

      validatedBookmaker.push({
        type,
        percentage,
      });
    }

    // ------------------------------------------------------------
    // VALIDATE FANCY
    // ------------------------------------------------------------

    const validatedFancy = [];

    for (const commission of fancyList) {
      const type =
        commission?.type || "NONE";

      const percentage = Number(
        commission?.percentage ?? 0
      );

      if (
        !uniqueFancyTypes.includes(
          type
        )
      ) {
        return res
          .status(httpStatus.BAD_REQUEST)
          .json({
            message: `You cannot assign ${type} fancy commission`,
            allowedTypes:
              uniqueFancyTypes,
          });
      }

      if (
        !Number.isFinite(percentage) ||
        percentage < 0 ||
        percentage > 100
      ) {
        return res
          .status(httpStatus.BAD_REQUEST)
          .json({
            message:
              "Fancy percentage must be between 0 and 100",
          });
      }

      // NONE always saves percentage 0
      if (type === "NONE") {
        validatedFancy.push({
          type: "NONE",
          percentage: 0,
        });

        continue;
      }

      // Non-owner cannot exceed parent's percentage
      if (!isOwner) {
        const parentCommission =
          parentFancyCommissions.find(
            (commission) =>
              commission.type === type
          );

        if (
          parentCommission &&
          percentage >
            Number(
              parentCommission.percentage || 0
            )
        ) {
          return res
            .status(httpStatus.BAD_REQUEST)
            .json({
              message: `Fancy ${type} percentage cannot exceed parent's ${parentCommission.percentage}%`,
              parentPercentage:
                Number(
                  parentCommission.percentage || 0
                ),
            });
        }
      }

      validatedFancy.push({
        type,
        percentage,
      });
    }

    // ------------------------------------------------------------
    // VALIDATE CASINO
    // ------------------------------------------------------------

    let validatedCasino = null;

    if (casinoConfig) {
      const casinoType = casinoConfig?.type || "NONE";

      const casinoPercentage = Number(
        casinoConfig?.percentage ?? 0
      );

      if (!uniqueCasinoTypes.includes(casinoType)) {
        return res
          .status(httpStatus.BAD_REQUEST)
          .json({
            message: `You cannot assign ${casinoType} casino commission`,
            allowedTypes: uniqueCasinoTypes,
          });
      }

      if (
        !Number.isFinite(casinoPercentage) ||
        casinoPercentage < 0 ||
        casinoPercentage > 100
      ) {
        return res
          .status(httpStatus.BAD_REQUEST)
          .json({
            message:
              "Casino percentage must be between 0 and 100",
          });
      }

      validatedCasino = {
        type: casinoType,
        percentage:
          casinoType === "NONE"
            ? 0
            : casinoPercentage,
      };
    }

    // ------------------------------------------------------------
    // USER ROLE RESTRICTIONS
    // ------------------------------------------------------------

    if (user.role === "user") {
      if (
        validatedBookmaker.length > 1
      ) {
        return res
          .status(httpStatus.BAD_REQUEST)
          .json({
            message:
              "A user can have only one bookmaker commission type",
          });
      }

      if (
        validatedFancy.length > 1
      ) {
        return res
          .status(httpStatus.BAD_REQUEST)
          .json({
            message:
              "A user can have only one fancy commission type",
          });
      }
    }

    // ------------------------------------------------------------
    // REMOVE DUPLICATE BOOKMAKER / FANCY TYPES
    // ------------------------------------------------------------

    const removeDuplicateTypes = (
      commissions
    ) => {
      const map = new Map();

      for (const commission of commissions) {
        map.set(
          commission.type,
          commission
        );
      }

      return [...map.values()];
    };

    const finalBookmaker =
      removeDuplicateTypes(
        validatedBookmaker
      );

    const finalFancy =
      removeDuplicateTypes(
        validatedFancy
      );

    // ------------------------------------------------------------
    // FIND EXISTING PARTNERSHIP
    // ------------------------------------------------------------

    let partnership =
      await Partnership.findOne({
        userId: user._id,
        partnerId: admin._id,
      });

    console.log("[DEBUG] Partnership lookup:", {
      userId: user._id?.toString(),
      partnerId: admin._id?.toString(),
      found: !!partnership,
      partnershipId: partnership?._id?.toString(),
      casinoBefore: partnership?.casinoCommission,
    });

    console.log("[DEBUG] About to save casino:", validatedCasino);

    // ------------------------------------------------------------
    // CREATE
    // ------------------------------------------------------------

    if (!partnership) {
      partnership =
        await Partnership.create({
          userId: user._id,
          partnerId: admin._id,

          bookmakerCommission:
            finalBookmaker,

          fancyCommission:
            finalFancy,

          ...(validatedCasino
          ? { casinoCommission: validatedCasino }
          : {}),
        });
    }

    // ------------------------------------------------------------
    // UPDATE
    // ------------------------------------------------------------

    else {
      console.log(
        "[DEBUG] casinoCommission BEFORE assignment:",
        partnership.casinoCommission
      );

      partnership.bookmakerCommission =
        finalBookmaker;

      partnership.fancyCommission =
        finalFancy;

      if (validatedCasino) {
        partnership.casinoCommission = validatedCasino;
      }

      console.log(
        "[DEBUG] casinoCommission AFTER assignment BEFORE save:",
        partnership.casinoCommission
      );

      await partnership.save();

      console.log(
        "[DEBUG] casinoCommission AFTER save:",
        partnership.casinoCommission
      );
    }

    // ------------------------------------------------------------
    // RESPONSE
    // ------------------------------------------------------------

    return res.status(httpStatus.OK).json({
      message:
        "Commission updated successfully",

      data: partnership,
    });
  } catch (err) {
    console.log("*******SETcommissionerr",
      err
    );

    next(err);
  }
};

const updateSettings = async (req, res, next) => {
  try {
    const { category, values, domain } = req.body;
    const response = await updateButtonSettings(category, values, domain);
    res.status(httpStatus.OK).send(response);
  } catch (err) {
    next(err);
  }
};

const updateSpecificCategorySetting = async (req, res, next) => {
  try {
    const { category, values, domain } = req.body;
    console.log(req.body,"updatectegory");
    const response = await updateButtonSettings(category, values, domain);
    res.status(httpStatus.OK).send(response);
  } catch (err) {
    next(err);
  }
};

const addSettings = async (req, res, next) => {
  try {
    const { category, values, domain } = req.body;
    const response = await updateButtonSettings(category, values, domain);
    res.status(httpStatus.OK).send(response);
  } catch (err) {
    next(err);
  }
};

const getSettings = async (req, res, next) => {
  try {
    const { category, domain } = req.query;
    const response = await getButtonSettings(category, domain);
    res.status(httpStatus.OK).send(response);
  } catch (err) {
    next(err);
  }
};
const getSettingList = async (req, res, next) => {
  try {
    const response = await getAllSettings();
    res.status(httpStatus.OK).send(response);
  } catch (err) {
    next(err);
  }
};

const updateSettingMarket = async (req, res) => {
  try {
    const {
      gameId,
      type,
      label,
      value,
      domain
    } = req.body;

    const category = "bet-delay";

    if (!gameId || !type || !label || !domain) {
      return res.status(400).json({
        success: false,
        message: "gameId, type, label and domain are required"
      });
    }

    // gameId ko consistently string me store karenge
    const gameIdString = String(gameId);

    let setting = await SettingMarket.findOne({
      category
    });

    // First time category create hogi
    if (!setting) {
      setting = await SettingMarket.create({
        category,
        values: [
          {
            gameId: gameIdString,
            type,
            label,
            value,
            domain
          }
        ]
      });

      return res.status(200).json({
        success: true,
        message: "Setting market created successfully",
        data: setting
      });
    }

    // Same gameId + type + domain check
    const existingIndex = setting.values.findIndex(
      (item) =>
        String(item.gameId) === gameIdString &&
        item.type === type &&
        item.domain === domain
    );

    if (existingIndex !== -1) {

      // SAME RECORD -> only update
      setting.values[existingIndex].label = label;
      setting.values[existingIndex].value = value;

    } else {
      // NEW COMBINATION -> insert
      setting.values.push({
        gameId: gameIdString,
        type,
        label,
        value,
        domain
      });
    }

    await setting.save();

    return res.status(200).json({
      success: true,
      message:
        existingIndex !== -1
          ? "Setting market updated successfully"
          : "Setting market added successfully",
      data: setting
    });

  } catch (error) {
    console.error("updateSettingMarket error:", error);

    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// const getSettingMarket = async (req, res) => {
//   try {
//     const { gameId, domain } = req.body;

//     const category = "bet-delay";

//     if (!gameId || !domain) {
//       return res.status(400).json({
//         success: false,
//         message: "gameId and domain are required"
//       });
//     }

//     const setting = await SettingMarket.findOne({
//       category,
//       values: {
//         $elemMatch: {
//           gameId: String(gameId),
//           domain
//         }
//       }
//     });

//     if (!setting) {
//       return res.status(201).json({
//         success: false,
//         message: "Setting market not found"
//       });
//     }

//     const matchedValues = setting.values.filter(
//       (item) =>
//         String(item.gameId) === String(gameId) &&
//         item.domain === domain
//     );

//     return res.status(200).json({
//       success: true,
//       message: "Setting market fetched successfully",
//       data: matchedValues
//     });

//   } catch (error) {
//     console.error("getSettingMarket error:", error);

//     return res.status(500).json({
//       success: false,
//       message: error.message
//     });
//   }
// };

const getSettingMarket = async (req, res) => { 
  try { 
    const { gameId, domain, type } = req.body; 
 
    const category = "bet-delay"; 
 
    if (!gameId || !domain || !type) { 
      return res.status(400).json({ 
        success: false, 
        message: "gameId, domain and type are required" 
      }); 
    } 
 
    const setting = await SettingMarket.findOne({ 
      category, 
      values: { 
        $elemMatch: { 
          gameId: String(gameId), 
          domain,
          type
        } 
      } 
    }); 
 
    if (!setting) { 
      return res.status(201).json({ 
        success: false, 
        message: "Setting market not found" 
      }); 
    } 
 
    const matchedValues = setting.values.filter( 
      (item) => 
        String(item.gameId) === String(gameId) && 
        item.domain === domain &&
        item.type === type
    ); 
 
    return res.status(200).json({ 
      success: true, 
      message: "Setting market fetched successfully", 
      data: matchedValues 
    }); 
 
  } catch (error) { 
    console.error("getSettingMarket error:", error); 
 
    return res.status(500).json({ 
      success: false, 
      message: error.message 
    }); 
  } 
};


const getLoginUserCommission = async (
  req,
  res,
  next
  ) => {
  try {
    const { adminId } = req.params;

    /*
     * USERS COLLECTION 
     * adminId 
     */

    const user = await User.findById(adminId)
      .select("_id parent role")
      .lean();

    if (!user) {
      return res.status(httpStatus.NOT_FOUND).json({
        message: "User not found",
      });
    }

    /*
     * ALL COMMISSION TYPES
     */

    const commissionTypes = {
      bookmaker: [
        { type: "NONE" },
        { type: "ENTRY_WISE" },
        { type: "ENTRY_LOOSING" },
        { type: "NET_LOOSING" },
      ],

      fancy: [
        { type: "NONE" },
        { type: "ENTRY_WISE" },
      ],
      casino: [
        { type: "NONE" },
        { type: "ENTRY_LOOSING" },
      ],
    };

    /*
     * OWNER / SADMIN
     */

    if (
      user.role === "owner" ||
      user.role === "sadmin"
    ) {
      return res.status(httpStatus.OK).json({
        data: commissionTypes,
      });
    }

    /*
     * PARTNERSHIP COLLECTION SE
     * USER ID + 
     */

    const partnership = await Partnership.findOne({
      userId: user._id,
      partnerId: user.parent,
    }).lean();

    /*
     * NORMALIZE COMMISSION
     */

    const normalizeCommission = (commission) => {
      if (!commission) {
        return [];
      }

      return Array.isArray(commission)
        ? commission
        : [commission];
    };

    const bookmakerCommission = normalizeCommission(
      partnership?.bookmakerCommission
    );

    const fancyCommission = normalizeCommission(
      partnership?.fancyCommission
    );

    const casinoCommission = partnership?.casinoCommission || {
      type: "NONE",
      percentage: 0,
    };

    /*
     * ASSIGNED COMMISSION DATA BUILD
     */

    const buildCommission = (
      allTypes,
      assignedCommission
    ) => {
      const result = [{ type: "NONE" }];

      assignedCommission.forEach((commission) => {
        if (
          !commission?.type ||
          commission.type === "NONE"
        ) {
          return;
        }

        const validType = allTypes.find(
          (item) =>
            item.type === commission.type
        );

        if (!validType) {
          return;
        }

        result.push({
          type: commission.type,
          percentage: Number(
            commission.percentage || 0
          ),
        });
      });

      return result;
    };

    /*
     * RESPONSE
     */

    return res.status(httpStatus.OK).json({
      data: {
        bookmaker: buildCommission(
          commissionTypes.bookmaker,
          bookmakerCommission
        ),

        fancy: buildCommission(
          commissionTypes.fancy,
          fancyCommission
        ),

      // casino: {
      //   type: casinoCommission?.type || "NONE",
      //   percentage: Number(casinoCommission?.percentage || 0),
      // },

      casino: [
        {
          type: casinoCommission?.type || "NONE",
          percentage: Number(casinoCommission?.percentage || 0),
        },
      ],

      },
    });
  } catch (err) {
    console.log(
      "getLoginUserCommission error:",
      err
    );

    next(err);
  }
};

module.exports = {
  getCommissionOptions,
  setCommission,
  updateSettings,
  updateSpecificCategorySetting,
  addSettings,
  getSettings,
  getSettingList,
  updateSettingMarket,
  getSettingMarket,
  getLoginUserCommission,
  getCommissionConfig,
  getGameSchemaList
};
