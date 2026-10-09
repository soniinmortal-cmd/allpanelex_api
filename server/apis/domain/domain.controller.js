const httpStatus = require("http-status");
const APIError = require("../../helpers/APIError");
const APIResponse = require("../../helpers/APIResponse");
const {
  createOrUpdateDomain,
  getAllDomains,
  Domain,
  getDomainByDomain,
} = require("./domain.helper");
const { deleteFile } = require("../../helpers/utils");

const createOrUpdate = async (req, res, next) => {
  try {
    const body = req.body;
    let domains;
    if (body?._id) {
      domains = await Domain.findById(body._id);
    } else {
      domains = await getDomainByDomain(body?.domain);
    }

    if (
      body?.maintenance_mode === "true" && body?.maintenance_deadline &&
      new Date(body?.maintenance_deadline) < new Date()
    ) {
      return res
        .status(httpStatus.BAD_REQUEST)
        .json(
          new APIError(
            "Maintenance deadline cannot be in the past",
            httpStatus.BAD_REQUEST
          )
        );
    }
    if (req.files?.logo) {
      if (domains?.logo) {
        deleteFile(domains.logo);
      }
      body.logo = `/uploads/${body.domain}/${req.files.logo[0].filename}`;
    } else if (body.logo && typeof body.logo !== "string") {
      body.logo = null;
    }

    if (req.files?.login_logo) {
      if (domains?.login_logo) {
        deleteFile(domains.login_logo);
      }
      body.login_logo = `/uploads/${body.domain}/${req.files.login_logo[0].filename}`;
    } else if (body.login_logo && typeof body.login_logo !== "string") {
      body.login_logo = null;
    }

    if (req.files?.favicon) {
      if (domains?.favicon) {
        deleteFile(domains.favicon);
      }
      body.favicon = `/uploads/${body.domain}/${req.files.favicon[0].filename}`;
    } else if (body.favicon && typeof body.favicon !== "string") {
      body.favicon = null;
    }
    if (typeof body?.bet_limit === "string") {
      body.bet_limit = JSON.parse(body?.bet_limit);
    }

    if (typeof body?.socialLinks === "string") {
      body.socialLinks = JSON.parse(body?.socialLinks);
    }
    if (typeof body?.domain_scheme === "string") {
      body.domain_scheme = JSON.parse(body?.domain_scheme);
    }
    if (
        body?.isTransactionpassword === undefined ||
        body?.isTransactionpassword === null ||
        body?.isTransactionpassword === ""
    ) {
      body.isTransactionpassword = true;
    } else if (typeof body.isTransactionpassword === "string") {
      body.isTransactionpassword =
        body.isTransactionpassword.toLowerCase() === "true";
    } else {
      body.isTransactionpassword = Boolean(body.isTransactionpassword);
    }

      if (
        body?.isSeat === undefined ||
        body?.isSeat === null ||
        body?.isSeat === ""
      ) {
        body.isSeat = true;
      } else if (typeof body.isSeat === "string") {
        body.isSeat =
          body.isSeat.toLowerCase() === "true";
      } else {
        body.isSeat = Boolean(body.isSeat);
      }

      if (
        body?.isMatchLock === undefined ||
        body?.isMatchLock === null ||
        body?.isMatchLock === ""
      ) {
        body.isMatchLock = true;
      } else if (typeof body.isMatchLock === "string") {
        body.isMatchLock =
          body.isMatchLock.toLowerCase() === "true";
      } else {
        body.isMatchLock = Boolean(body.isMatchLock);
      }

    if (body?.domain?.toLowerCase() === "allpanelexc7.com") {
      if (
        body.isCasinoThirdParty === undefined ||
        body.isCasinoThirdParty === null ||
        body.isCasinoThirdParty === ""
      ) {
        body.isCasinoThirdParty = false;
      } else if (typeof body.isCasinoThirdParty === "string") {
        body.isCasinoThirdParty =
          body.isCasinoThirdParty.toLowerCase() === "true";
      } else {
        body.isCasinoThirdParty = Boolean(body.isCasinoThirdParty);
      }
    } else {
      // All other domains must always be false
      body.isCasinoThirdParty = false;
    }
      
      if (
        body.api_data_type === undefined ||
        body.api_data_type === null ||
        body.api_data_type === ""
      ) {
        delete body.api_data_type;
      }

      if (
        body.video_link_type === undefined ||
        body.video_link_type === null ||
        body.video_link_type === ""
      ) {
        delete body.video_link_type;
      }

    //   console.log("========== AFTER BOOLEAN CONVERSION ==========");
    // console.log("isTransactionpassword:", body.isTransactionpassword);
    // console.log("isTransactionpassword type:", typeof body.isTransactionpassword);
    // console.log("isSeat:", body.isSeat);
    // console.log("isSeat type:", typeof body.isSeat);
    // console.log("isMatchLock:", body.isMatchLock);
    // console.log("isMatchLock type:", typeof body.isMatchLock);
    // console.log("===============================================");

   
    if (body?.maintenance_deadline) {
      body.maintenance_deadline = new Date(body?.maintenance_deadline);
    } else {
      body.maintenance_deadline = null;
    }

    // ADD THIS
    if (body.theme !== undefined && body.theme !== null) {
      body.theme = String(body.theme);
    }
    


    const domainDoc = await createOrUpdateDomain({
      ...body,
      isActive: true,
    });

    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(domainDoc, "Domain created/updated", httpStatus.OK)
      );
  } catch (err) {
    next(err);
  }
};

// const getDomains = async (req, res, next) => {
//   try {
//     let domains = await getAllDomains();
//     res
//       .status(httpStatus.OK)
//       .send(new APIResponse(domains, "Domains fetched", httpStatus.OK));
//   } catch (err) {
//     next(err);
//   }
// };

const getDomains = async (req, res, next) => {
  try {
    const domains = await getAllDomains();


    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(
          domains || [],
          "Domains fetched",
          httpStatus.OK
        )
      );
  } catch (err) {
    console.error("GET DOMAINS ERROR:", err);
    next(err);
  }
};

const removeDomain = async (req, res, next) => {
  try {
    const id = req.params.id;

    const domain = await Domain.findByIdAndUpdate(
      id,
      { isActive: false },
      { new: true }
    );

    if (!domain) {
      return res
        .status(httpStatus.NOT_FOUND)
        .json(new APIError("Domain not found", httpStatus.NOT_FOUND));
    }

    res
      .status(httpStatus.OK)
      .send(new APIResponse(domain, "Domain deactivated", httpStatus.OK));
  } catch (err) {
    next(err);
  }
};

const getDomain = async (req, res, next) => {
  try {
    res
      .status(httpStatus.OK)
      .send(
        new APIResponse(req.domainConfig, "Domains fetched", httpStatus.OK)
      );
  } catch (err) {
    next(err);
  }
};

const getDomainByDomainName = async (req, res, next) => {
  try {
    const domain = req.params.domain;
    let domains = await getDomainByDomain(domain);
    res
      .status(httpStatus.OK)
      .send(new APIResponse(domains, "Domains fetched", httpStatus.OK));
  } catch (err) {
    next(err);
  }
};
module.exports = {
  createOrUpdate,
  getDomains,
  removeDomain,
  getDomain,
  getDomainByDomainName,
};
