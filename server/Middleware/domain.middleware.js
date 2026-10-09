const httpStatus = require("http-status");
const APIError = require("../helpers/APIError");
const { getDomainByDomain } = require("../apis/domain/domain.helper");


const requireDomain = async (req, res, next) => {
  try {
    const origin = req.headers.origin || null;
    const host = req.headers.host || null;
    const isLocalhost=(origin && ["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) || (host && ["localhost", "127.0.0.1"].includes(host.split(":")[0]));
    if (process.env.NODE_ENV === "development"||(process.env.NODE_ENV==="production"&&isLocalhost)) {
      req.domainConfig = {
        domain: "allpanelex.site"
      };
      return next();
    }
    if (req.originalUrl && req.originalUrl.includes("stream-sync-status")) {
      res.setHeader("X-Skip-Encryption", "1");
      return next();
    }
    let domainName = null;
    // console.log("origin:", origin, " → host:", host);
    if (origin) {
      try {
        domainName = new URL(origin).hostname;
      } catch (e) {
        console.warn("Invalid Origin URL:", origin);
      }
    }
    // console.log("Domain Middleware → domainName ->", domainName);
    if (!domainName && host) {
      domainName = host.split(":")[0];
    }

    if (!domainName) {
      console.log("Invalid domain ❌:", domainName);
      return res
        .status(httpStatus.FORBIDDEN)
        .send(
          new APIError(
           // "1To allow domain please contact to ",
            httpStatus.FORBIDDEN
          )
        );
    }

    let domain = await getDomainByDomain(domainName);
    // console.log("Domain Middleware → domain ->", domain);
    if (!domain && process.env.JSK_ADMIN_DOMAIN === domainName) {
      domain = { domain: process.env.JSK_ADMIN_DOMAIN };
    }
    if (!domain) {
      return res
        .status(httpStatus.FORBIDDEN)
        .send(
          new APIError(
           // "To allow domain please contact to ",
            httpStatus.FORBIDDEN
          )
        );
    }

    req.domainConfig = domain;
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
    }

    next();
  } catch (err) {
    next(err);
  }
};

module.exports = {
  requireDomain,
};
