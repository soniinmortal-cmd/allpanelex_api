const httpStatus = require('http-status');
/**
 * Class representing an API Resonse.
 */
class APIResponse {
  /**
   * Creates an API Response.
   * @param {JSONObjects} Data - data of API response.
   * @param {string} message - Response message.
   * @param {string} status - Application staus.
   * @param {JSONObjects} error - if status is partial.
   */
  constructor(data = null, message = '', status = '', error = null) {
    //     if (data && typeof data === "object" && !Array.isArray(data)) {
    //   Object.assign(this, data);
    // } else if (data) {
    //   this.data = data;
    // }


    if (data) {
      this.data = data;
    }
    
    if (message) {
      this.message = message;
    }

    if (!status) {
      this.status = httpStatus.OK;
    }

    if (error) {
      this.error = error;
    }
  }
}

module.exports = APIResponse;
