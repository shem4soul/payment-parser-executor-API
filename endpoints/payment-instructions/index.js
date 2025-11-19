const { createHandler } = require('@app-core/server');
const { appLogger } = require('@app-core/logger');
const processPaymentInstruction = require('@app/services/payment-instructions');

module.exports = createHandler({
  path: '/payment-instructions',
  method: 'post',
  middlewares: [],
  async onResponseEnd(rc, rs) {
    appLogger.info({ requestContext: rc, response: rs }, 'payment-instruction-request-completed');
  },
  async handler(rc, helpers) {
    const payload = rc.body;

    const response = await processPaymentInstruction(payload);
    
    // Determine HTTP status code
    let httpStatus = helpers.http_statuses.HTTP_200_OK;
    if (response.status === 'failed') {
      httpStatus = helpers.http_statuses.HTTP_400_BAD_REQUEST;
    }

    return {
      status: httpStatus,
      data: response,
    };
  },
});

